// Thin OPFS wrapper for the vault. Knows nothing about passwords, real
// names, or encryption - segments are just opaque path components.

const VAULT_ROOT = "LocalFileLockerVault";

const getRootHandle = async (): Promise<FileSystemDirectoryHandle> => {
  const opfsRoot = await navigator.storage.getDirectory();
  return opfsRoot.getDirectoryHandle(VAULT_ROOT, { create: true });
};

const getDirHandle = async (
  segments: string[],
  create: boolean
): Promise<FileSystemDirectoryHandle> => {
  let handle = await getRootHandle();
  for (const segment of segments) {
    handle = await handle.getDirectoryHandle(segment, { create });
  }
  return handle;
};

const splitParent = (segments: string[]): { parent: string[]; name: string } => {
  const name = segments[segments.length - 1];
  if (!name) throw new Error("segments must not be empty");
  return { parent: segments.slice(0, -1), name };
};

export type OpfsEntry =
  | { kind: "file"; id: string }
  | { kind: "directory"; id: string };

export const listChildren = async (segments: string[]): Promise<OpfsEntry[]> => {
  const handle = await getDirHandle(segments, false);
  const ret: OpfsEntry[] = [];
  for await (const [key, value] of handle.entries()) {
    if (value instanceof FileSystemFileHandle) {
      ret.push({ kind: "file", id: key });
    } else if (value instanceof FileSystemDirectoryHandle) {
      ret.push({ kind: "directory", id: key });
    }
  }
  return ret;
};

export const readFile = async (segments: string[]): Promise<File> => {
  const { parent, name } = splitParent(segments);
  const dirHandle = await getDirHandle(parent, false);
  const fileHandle = await dirHandle.getFileHandle(name);
  return fileHandle.getFile();
};

export const writeFile = async (
  segments: string[],
  data: FileSystemWriteChunkType
): Promise<void> => {
  const { parent, name } = splitParent(segments);
  const dirHandle = await getDirHandle(parent, true);
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
};

export const ensureDir = async (segments: string[]): Promise<void> => {
  await getDirHandle(segments, true);
};

export const removeEntry = async (
  segments: string[],
  opts?: { recursive?: boolean }
): Promise<void> => {
  const { parent, name } = splitParent(segments);
  const dirHandle = await getDirHandle(parent, false);
  await dirHandle.removeEntry(name, opts);
};
