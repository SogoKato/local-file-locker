"use client";
import {
  VaultEntry,
  importExportedFile,
  refreshEntries,
  resolveOrCreateDirPath,
  writeNewFile,
  writeRawImportedFile,
} from "@/lib/vault";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type NewFileProps = {
  className?: string;
  entries: VaultEntry[];
  setEntries: (v: VaultEntry[]) => void;
  password: string;
};

const collectDirPaths = (entries: VaultEntry[], prefix: string): string[] =>
  entries.flatMap((entry) => {
    if (entry.kind !== "directory" || entry.name === null) return [];
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const childPaths = entry.children ? collectDirPaths(entry.children, path) : [];
    return [path, ...childPaths];
  });

const NewFile: React.FC<NewFileProps> = ({
  className,
  entries,
  setEntries,
  password,
}) => {
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [hasEncFile, setHasEncFile] = useState<boolean>(false);
  const [hasLflFile, setHasLflFile] = useState<boolean>(false);
  const [lflOnly, setLflOnly] = useState<boolean>(false);
  const [dirPath, setDirPath] = useState<string>("");
  const [isEncrypting, setIsEncrypting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const disabled =
    newFiles.length === 0 || (password === "" && !lflOnly) || isEncrypting;
  const dirPaths = useMemo(() => collectDirPaths(entries, ""), [entries]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    setNewFiles(files);
    const encFiles = files.filter((f) => f.name.endsWith(".enc"));
    const lflFiles = files.filter((f) => f.name.endsWith(".lfl"));
    setHasEncFile(encFiles.length > 0);
    setHasLflFile(lflFiles.length > 0);
    setLflOnly(files.length > 0 && lflFiles.length === files.length);
  };

  const encryptFiles = async () => {
    setIsEncrypting(true);
    setSuccessMessage(null);
    try {
      const segments = dirPath.split("/").filter((s) => s.trim() !== "");
      const parentPath = await resolveOrCreateDirPath(segments, password);

      for (const file of newFiles) {
        if (file.name.endsWith(".lfl")) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          await importExportedFile(parentPath, bytes);
        } else if (file.name.endsWith(".enc")) {
          const nameWithoutExt = file.name.replace(/\.enc$/, "");
          const rawBytes = new Uint8Array(await file.arrayBuffer());
          await writeRawImportedFile(parentPath, nameWithoutExt, rawBytes, password);
        } else {
          const plainData = new Uint8Array(await file.arrayBuffer());
          await writeNewFile(parentPath, file.name, plainData, password);
        }
      }

      const rootEntries = await refreshEntries([], password, entries);
      setEntries(rootEntries);

      const count = newFiles.length;
      if (fileInputRef.current) fileInputRef.current.value = "";
      setNewFiles([]);
      setHasEncFile(false);
      setHasLflFile(false);
      setLflOnly(false);
      setSuccessMessage(
        `✅ ${count} file${count === 1 ? "" : "s"} saved successfully.`
      );
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "failed to save file(s)!");
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
            ℹ️ <code>.enc</code> file(s): content is stored as-is and cannot
            be previewed in-app, but the filename will still be encrypted
            with your password.
          </div>
        ) : null}
        {hasLflFile ? (
          <div>
            ℹ️ <code>.lfl</code> file(s) previously exported from this app
            will be restored as-is.
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
            : lflOnly
            ? "load"
            : hasEncFile || hasLflFile
            ? "encrypt/load"
            : "encrypt"}
        </button>
      </div>
    </div>
  );
};

export default NewFile;
