"use client";
import { writeFile, refreshEntries, Entry, FileEntry } from "@/lib/opfs";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { encrypt } from "@/lib/crypto";

type NewFileProps = {
  className?: string;
  entries: Entry[];
  setEntries: (v: Entry[]) => void;
  password: string;
};

const collectDirPaths = (entries: Entry[]): string[] =>
  entries.flatMap((entry) => {
    if (entry.kind !== "directory") return [];
    const childPaths = entry.children ? collectDirPaths(entry.children) : [];
    return [entry.path, ...childPaths];
  });

const NewFile: React.FC<NewFileProps> = ({
  className,
  entries,
  setEntries,
  password,
}) => {
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [hasEncFile, setHasEncFile] = useState<boolean>(false);
  const [encFileOnly, setEncFileOnly] = useState<boolean>(false);
  const [dirPath, setDirPath] = useState<string>("");
  const [isEncrypting, setIsEncrypting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const disabled =
    newFiles.length === 0 || (password === "" && !encFileOnly) || isEncrypting;
  const dirPaths = useMemo(() => collectDirPaths(entries), [entries]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    setNewFiles(files);
    const encFiles = files.filter((f) => f.name.endsWith(".enc"));
    setHasEncFile(encFiles.length > 0);
    setEncFileOnly(encFiles.length === files.length);
  };

  const encryptFiles = async () => {
    setIsEncrypting(true);
    setSuccessMessage(null);
    try {
      const newEntries: FileEntry[] = await Promise.all(
        Array.from(newFiles).map(async (file) => {
          if (file.name.endsWith(".enc")) {
            const nameWithoutEnc = file.name.replace(new RegExp(".enc$"), "");
            return {
              kind: "file",
              name: file.name,
              path: `${dirPath}/${nameWithoutEnc}`,
              size: file.size,
              plainData: null,
              cipherData: new Uint8Array(await file.arrayBuffer()),
            };
          }
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

      await refreshEntries("", entries).then((rootEntries) =>
        setEntries(rootEntries)
      );

      if (fileInputRef.current) fileInputRef.current.value = "";
      setNewFiles([]);
      setHasEncFile(false);
      setEncFileOnly(false);
      setSuccessMessage(
        `✅ ${newEntries.length} file${
          newEntries.length === 1 ? "" : "s"
        } saved successfully.`
      );
    } finally {
      setIsEncrypting(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 grow">
        <input
          className="file:bg-violet-300 file:dark:bg-violet-600 file:hover:bg-violet-400 file:hover:dark:bg-violet-700 file:border-0 file:cursor-pointer file:duration-300 file:mr-4 file:rounded-full file:px-4 file:py-2 file:text-sm file:font-semibold file:text-violet-700 dark:file:text-violet-100 file:transition-all"
          type="file"
          multiple
          ref={fileInputRef}
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
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              list="dir-path-list"
              onChange={(event) => setDirPath(event.target.value)}
            />
            <datalist id="dir-path-list">
              {dirPaths.map((path) => (
                <option key={path} value={path} />
              ))}
            </datalist>
          </div>
        </label>
        {hasEncFile ? (
          <div>
            ℹ️ <code>.enc</code> file(s) are loaded without encryption.
          </div>
        ) : null}
        {successMessage ? (
          <div className="text-green-600 dark:text-green-400 font-semibold">
            {successMessage}
          </div>
        ) : null}
      </div>
      <div className="flex grow justify-end">
        <button
          className="bg-violet-300 dark:bg-violet-600 disabled:bg-slate-500 disabled:dark:bg-slate-600 hover:bg-violet-400 hover:dark:bg-violet-700 duration-300 font-semibold px-4 py-2 rounded-full text-violet-700 dark:text-violet-100 hover:dark:text-violet-100 disabled:text-slate-600 disabled:dark:text-slate-400 transition-all"
          disabled={disabled}
          onClick={encryptFiles}
        >
          {isEncrypting
            ? "encrypting..."
            : hasEncFile && encFileOnly
            ? "load"
            : hasEncFile
            ? "encrypt/load"
            : "encrypt"}
        </button>
      </div>
    </div>
  );
};

export default NewFile;
