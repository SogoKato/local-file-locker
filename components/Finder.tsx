"use client";

import { getMimeType } from "@/lib/mime";
import { deleteFile, deleteDir, listEntries, Entry } from "@/lib/opfs";
import { decrypt } from "@/wasm-crypto/pkg/wasm_crypto";
import { JSX, useState } from "react";

type FinderProps = {
  className?: string;
  entries: Entry[];
  setEntries: (v: Entry[]) => void;
  password: string;
};

const Finder: React.FC<FinderProps> = ({
  className,
  entries,
  setEntries,
  password,
}) => {
  const [visible, setVisible] = useState<boolean>();
  const [preview, setPreview] = useState<JSX.Element>();

  const openEntry = async (entry: Entry) => {
    if (entry.kind === "file") {
      if (entry.plainData === null) {
        try {
          entry.plainData = await decrypt(password, entry.cipherData);
        } catch (e) {
          console.error(e);
          alert("failed to decrypt!");
          return;
        }
        setEntries([...entries]);
      }
      const mimeType = getMimeType(entry.plainData);
      const reader = new FileReader();
      const blob = new Blob([entry.plainData], { type: mimeType });
      if (mimeType.startsWith("image/")) {
        reader.onload = (event) => {
          if (typeof event.target?.result === "string") {
            setPreview(
              <img
                className="max-h-dvh max-w-dvw z-10"
                src={event.target.result}
              />
            );
            setVisible(true);
          }
        };
        reader.readAsDataURL(blob);
      } else if (mimeType.startsWith("text/")) {
        reader.onload = (event) => {
          if (typeof event.target?.result === "string") {
            setPreview(
              <pre className="bg-slate-950 break-all max-h-full max-w-full overflow-x-scroll p-8 text-slate-50 text-wrap whitespace-pre-wrap z-10">
                {event.target.result}
              </pre>
            );
            setVisible(true);
          }
        };
        reader.readAsText(blob);
      }
    } else if (entry.kind === "directory") {
      const subEntries = await listEntries(entry.path);
      entry.children = subEntries;
      setEntries([...entries]);
    }
  };

  const downloadEntry = async (entry: Entry) => {
    if (entry.kind === "directory") return;
    const url = URL.createObjectURL(
      new Blob([entry.cipherData], { type: "application/octet-streams" })
    );
    const a = document.createElement("a");
    document.body.appendChild(a);
    a.download = `${entry.name}.enc`;
    a.href = url;
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const deleteEntry = async (entry: Entry) => {
    if (!confirm(`Are you sure want to delete "${entry.path}"?`)) return;
    if (entry.kind === "file") {
      await deleteFile(entry.path);
    } else if (entry.kind === "directory") {
      await deleteDir(entry.path);
    }
    listEntries("").then((rootEntries) => setEntries(rootEntries));
  };

  const makeEntryList = (accumulator: JSX.Element[], entry: Entry) => {
    const liClassName =
      "border-b last:border-0 border-slate-400 dark:border-slate-500 flex flex-wrap sm:flex-nowrap gap-1 items-center justify-between mb-1 last:mb-0 pl-2 py-2";

    const action =
      entry.kind === "file" ? (
        <div className="flex grow items-center justify-end">
          <div>{entry.size.toLocaleString()} bytes</div>
          <button
            className="bg-slate-300 dark:bg-slate-600 hover:bg-violet-400 hover:dark:bg-violet-700 duration-300 font-semibold ml-2 px-4 py-2 rounded-full hover:text-violet-700 hover:dark:text-violet-100 text-sm transition-all"
            onClick={() => downloadEntry(entry)}
          >
            download
          </button>
          <button
            className="bg-slate-300 dark:bg-slate-600 hover:bg-red-300 hover:dark:bg-red-600 duration-300 font-semibold ml-2 px-4 py-2 rounded-full hover:text-red-700 hover:dark:text-red-100 text-sm transition-all"
            onClick={() => deleteEntry(entry)}
          >
            delete
          </button>
        </div>
      ) : (
        <div className="flex grow items-center justify-end">
          <button
            className="bg-slate-300 dark:bg-slate-600 hover:bg-red-300 hover:dark:bg-red-600 duration-300 font-semibold ml-2 px-4 py-2 rounded-full hover:text-red-700 hover:dark:text-red-100 text-sm transition-all"
            onClick={() => deleteEntry(entry)}
          >
            delete
          </button>
        </div>
      );

    accumulator.push(
      <li className={liClassName} key={entry.path}>
        <div
          className="cursor-pointer flex grow justify-between"
          onClick={() => openEntry(entry)}
        >
          <div className="font-semibold">
            {entry.kind === "directory" ? "📁 " : ""}
            {entry.name}
          </div>
        </div>
        {action}
      </li>
    );

    if (
      entry.kind === "directory" &&
      entry.children &&
      entry.children.length > 0
    ) {
      accumulator.push(
        <li className={liClassName} key={`${entry.path}--sub`}>
          <ul className="grow">{entry.children.reduce(makeEntryList, [])}</ul>
        </li>
      );
    }

    return accumulator;
  };

  const entryList = entries.reduce(makeEntryList, []);

  return (
    <div className={className}>
      <ul>{entryList}</ul>
      <div
        className={
          "duration-300 fixed flex group h-dvh items-center justify-center left-0 top-0 transition-all w-dvw" +
          (visible ? " opacity-100 visible" : " collapse opacity-0")
        }
      >
        <div
          className="absolute bg-black h-full opacity-50 w-full z-0"
          onClick={() => setVisible(false)}
        />
        {preview}
        <button
          className="absolute bg-red-500 h-[24] m-1 p-1 right-0 rounded-full w-[24] top-0 z-20"
          onClick={() => setVisible(false)}
        />
      </div>
    </div>
  );
};

export default Finder;
