export const writeFile = async (
  fileName: string,
  data: FileSystemWriteChunkType
) => {
  const opfsRoot = await navigator.storage.getDirectory();
  const fileHandle = await opfsRoot.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
};

export const readFile = async (fileName: string) => {
  const opfsRoot = await navigator.storage.getDirectory();
  const fileHandle = await opfsRoot.getFileHandle(fileName);
  return await fileHandle.getFile();
};

export const deleteFile = async (fileName: string) => {
  const opfsRoot = await navigator.storage.getDirectory();
  await opfsRoot.removeEntry(fileName);
};

export type Entry = {
  type: "file" | "directory";
  name: string;
  size: number;
  plainData: Uint8Array | null;
  cipherData: Uint8Array;
};

export const listFilesInDirectory = async (): Promise<Entry[]> => {
  const opfsRoot = await navigator.storage.getDirectory();
  const ret: Entry[] = [];
  for await (const [key, value] of opfsRoot.entries()) {
    if (value instanceof FileSystemFileHandle) {
      const file = await value.getFile();
      ret.push({
        type: "file",
        name: key,
        size: file.size,
        plainData: null,
        cipherData: new Uint8Array(await (file).arrayBuffer()),
      });
    }
  }
  return ret
};
