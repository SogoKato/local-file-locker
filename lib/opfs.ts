const APP_ROOT = "LocalFileLocker";

const getDirHandler = async (path: string[]) => {
  const opfsRoot = await navigator.storage.getDirectory();
  const appRoot = await opfsRoot.getDirectoryHandle(APP_ROOT, { create: true });

  let handler = appRoot;
  for (const dirName of path) {
    if (dirName === "") continue;
    handler = await handler.getDirectoryHandle(dirName, { create: true });
  }
  return handler;
};

const parseFilePath = (filePathString: string) => {
  const dirPath = filePathString.split("/");
  const fileName = dirPath.pop();

  if (!fileName) throw new Error("fileName is undefined");

  return {
    dirPath,
    fileName,
  };
};

export const writeFile = async (
  path: string,
  data: FileSystemWriteChunkType
) => {
  const { dirPath, fileName } = parseFilePath(path);
  const handler = await getDirHandler(dirPath);

  const fileHandle = await handler.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
};

export const readFile = async (path: string) => {
  const { dirPath, fileName } = parseFilePath(path);
  const handler = await getDirHandler(dirPath);

  const fileHandle = await handler.getFileHandle(fileName);
  return await fileHandle.getFile();
};

export const deleteFile = async (path: string) => {
  const { dirPath, fileName } = parseFilePath(path);
  const handler = await getDirHandler(dirPath);

  await handler.removeEntry(fileName);
};

export const deleteDir = async (path: string) => {
  const { dirPath, fileName } = parseFilePath(path);
  const handler = await getDirHandler(dirPath);

  await handler.removeEntry(fileName, { recursive: true });
};

export type Entry = FileEntry | DirEntry;

export type FileEntry = {
  kind: "file";
  name: string;
  size: number;
  path: string;
  plainData: Uint8Array | null;
  cipherData: Uint8Array;
};

export type DirEntry = {
  kind: "directory";
  name: string;
  path: string;
  children?: Entry[];
};

export const listEntries = async (path: string): Promise<Entry[]> => {
  const handler = await getDirHandler(path.split("/"));

  const ret: Entry[] = [];
  for await (const [key, value] of handler.entries()) {
    const entryPath = path === "" ? key : `${path}/${key}`;
    if (value instanceof FileSystemFileHandle) {
      const file = await value.getFile();
      ret.push({
        kind: "file",
        name: key,
        path: entryPath,
        size: file.size,
        plainData: null,
        cipherData: new Uint8Array(await file.arrayBuffer()),
      });
    } else if (value instanceof FileSystemDirectoryHandle) {
      ret.push({
        kind: "directory",
        name: key,
        path: entryPath,
      });
    }
  }
  return ret;
};
