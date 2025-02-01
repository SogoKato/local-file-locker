"use client";
import { writeFile, Entry } from "@/lib/opfs";
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
  entries,
  setEntries,
  password,
}) => {
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const disabled = newFiles.length === 0 || password === "";

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    setNewFiles(files);
  };

  const encryptFiles = async () => {
    const newEntries: Entry[] = await Promise.all(
      Array.from(newFiles).map(async (file) => {
        const plainData = new Uint8Array(await file.arrayBuffer());
        return {
          type: "file",
          name: file.name,
          size: file.size,
          plainData: plainData,
          cipherData: await encrypt(password, plainData),
        };
      })
    );
    newEntries.forEach((entry) => {
      if (!entry.cipherData) throw new Error("cipher data is empty");
      writeFile(entry.name, entry.cipherData);
    });
    setEntries([...entries, ...newEntries]);
  };

  return (
    <div className={className}>
      <input className="file:bg-violet-300 file:dark:bg-violet-600 file:hover:bg-violet-400 file:hover:dark:bg-violet-700 file:border-0 file:cursor-pointer file:duration-300 file:mr-4 file:rounded-full file:px-4 file:py-2 file:text-sm file:font-semibold file:text-violet-700 dark:file:text-violet-100 file:transition-all" type="file" multiple onChange={onChange} />
      <div className="flex grow justify-end">
      <button className="bg-violet-300 dark:bg-violet-600 disabled:bg-slate-500 disabled:dark:bg-slate-600 hover:bg-violet-400 hover:dark:bg-violet-700 duration-300 font-semibold px-4 py-2 rounded-full text-violet-700 dark:text-violet-100 hover:dark:text-violet-100 disabled:text-slate-600 disabled:dark:text-slate-400 transition-all" disabled={disabled} onClick={encryptFiles}>
        encrypt
      </button>
      </div>
    </div>
  );
};

export default NewFile;
