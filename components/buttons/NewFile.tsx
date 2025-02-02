"use client";
import { writeFile, listEntries, Entry, FileEntry } from "@/lib/opfs";
import { ChangeEvent, useState } from "react";
import { encrypt } from "@/wasm-crypto/pkg/wasm_crypto";

type NewFileProps = {
  className?: string;
  entries: Entry[];
  setEntries: (v: Entry[]) => void;
  password: string;
};

const NewFile: React.FC<NewFileProps> = ({
  className,
  setEntries,
  password,
}) => {
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [dirPath, setDirPath] = useState<string>("");
  const disabled = newFiles.length === 0 || password === "";

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    setNewFiles(files);
  };

  const encryptFiles = async () => {
    const newEntries: FileEntry[] = await Promise.all(
      Array.from(newFiles).map(async (file) => {
        const plainData = new Uint8Array(await file.arrayBuffer());
        return {
          kind: "file",
          name: file.name,
          path: `${dirPath}/${file.name}`,
          size: file.size,
          plainData: plainData,
          cipherData: await encrypt(password, plainData),
        };
      })
    );

    for (const entry of newEntries) {
      if (!entry.cipherData) throw new Error("cipher data is empty");
      await writeFile(entry.path, entry.cipherData);
    }

    listEntries("").then((rootEntries) => setEntries(rootEntries));
  };

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 grow">
        <input
          className="file:bg-violet-300 file:dark:bg-violet-600 file:hover:bg-violet-400 file:hover:dark:bg-violet-700 file:border-0 file:cursor-pointer file:duration-300 file:mr-4 file:rounded-full file:px-4 file:py-2 file:text-sm file:font-semibold file:text-violet-700 dark:file:text-violet-100 file:transition-all"
          type="file"
          multiple
          onChange={onChange}
        />
        <label className="flex gap-4 items-center">
          <div>Directory:</div>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-gray-500">
              /
            </span>
            <input
              className="bg-slate-100 dark:bg-slate-800 grow focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 pl-6 pr-4 py-2 rounded-full w-full"
              type="text"
              placeholder="path/to/dir (optional)"
              onChange={(event) => setDirPath(event.target.value)}
            />
          </div>
        </label>
      </div>
      <div className="flex grow justify-end">
        <button
          className="bg-violet-300 dark:bg-violet-600 disabled:bg-slate-500 disabled:dark:bg-slate-600 hover:bg-violet-400 hover:dark:bg-violet-700 duration-300 font-semibold px-4 py-2 rounded-full text-violet-700 dark:text-violet-100 hover:dark:text-violet-100 disabled:text-slate-600 disabled:dark:text-slate-400 transition-all"
          disabled={disabled}
          onClick={encryptFiles}
        >
          encrypt
        </button>
      </div>
    </div>
  );
};

export default NewFile;
