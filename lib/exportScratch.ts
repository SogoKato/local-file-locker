// Scratch space for building zip exports, as its own OPFS root alongside the
// vault (lib/opfsStore.ts) and the legacy tree (lib/opfs.ts). It has to sit
// outside the vault root: anything under that gets enumerated by listEntries
// as a (broken) entry, and would then be packed into the next export.
//
// Archives are streamed to disk here instead of being assembled in memory. A
// folder export is roughly the size of the folder - encrypted bytes don't
// compress, so the archive is stored uncompressed - and holding that on the
// heap is what kills the tab on iOS. A File handed back by OPFS is backed by
// the file on disk, so passing it to URL.createObjectURL keeps it off the
// heap as well, and peak memory stops scaling with the folder's size.

const SCRATCH_ROOT = "LocalFileLockerExports";

const countBytes = (
  onProgress: (written: number) => void
): TransformStream<Uint8Array, Uint8Array> => {
  let written = 0;
  return new TransformStream({
    transform(chunk, controller) {
      written += chunk.byteLength;
      onProgress(written);
      controller.enqueue(chunk);
    },
  });
};

const getScratchRoot = async (): Promise<FileSystemDirectoryHandle> => {
  const opfsRoot = await navigator.storage.getDirectory();
  return opfsRoot.getDirectoryHandle(SCRATCH_ROOT, { create: true });
};

// Best-effort cleanup of every archive except `keep`; a failed delete leaves
// disk in use but must not fail the export that triggered it.
//
// Callers sweep on startup (clearing whatever the last session left behind)
// and right after writing a new archive. A download still transferring when a
// sweep runs would lose the file out from under it, which is why the archive
// just written is always the one kept - and why an in-flight download does
// not survive a page reload.
export const sweep = async (keep?: string): Promise<void> => {
  const root = await getScratchRoot();
  const stale: string[] = [];
  for await (const key of root.keys()) {
    if (key !== keep) stale.push(key);
  }
  await Promise.all(
    stale.map((name) => root.removeEntry(name, { recursive: true }).catch(() => {}))
  );
};

// Drains `zipStream` into a fresh file and returns it. The returned File is a
// lazy handle onto that file - nothing here reads the archive back.
//
// `onProgress` is called with the running byte total as chunks pass through,
// once per chunk - client-zip emits a lot of them, so a caller that renders
// the value must throttle it.
export const writeZip = async (
  zipStream: ReadableStream<Uint8Array>,
  onProgress?: (written: number) => void
): Promise<File> => {
  const root = await getScratchRoot();
  const name = `${crypto.randomUUID()}.zip`;
  const handle = await root.getFileHandle(name, { create: true });
  const counted = onProgress
    ? zipStream.pipeThrough(countBytes(onProgress))
    : zipStream;
  try {
    await counted.pipeTo(await handle.createWritable());
  } catch (e) {
    await root.removeEntry(name).catch(() => {}); // don't leave a partial archive behind
    throw e;
  }
  await sweep(name);
  return handle.getFile();
};
