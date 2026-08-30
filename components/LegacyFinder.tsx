"use client";

import { getMimeType } from "@/lib/mime";
import {
  deleteFile,
  deleteDir,
  listEntries,
  refreshEntries,
  Entry,
} from "@/lib/opfs";
import { getPreviewKind } from "@/lib/preview";
import { decryptLegacy } from "@/lib/crypto";
import { downloadZip } from "client-zip";
import { JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";

type LegacyFinderProps = {
  className?: string;
  entries: Entry[];
  setEntries: (v: Entry[]) => void;
  password: string;
};

const LegacyFinder: React.FC<LegacyFinderProps> = ({
  className,
  entries,
  setEntries,
  password,
}) => {
  const [visible, setVisible] = useState<boolean>(false);
  const [preview, setPreview] = useState<JSX.Element>();
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const previewObjectUrlRef = useRef<string | null>(null);

  const revokePreviewObjectUrl = useCallback(() => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
  }, []);

  const closePreview = useCallback(() => {
    revokePreviewObjectUrl();
    setVisible(false);
  }, [revokePreviewObjectUrl]);

  useEffect(() => () => revokePreviewObjectUrl(), [revokePreviewObjectUrl]);

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

  // Recursively decrypts every file under `path` with the current
  // password, for the "download folder (decrypted)" migration helper.
  // Files that don't decrypt with this password are skipped and reported,
  // rather than aborting the whole folder.
  const collectLegacyForDownload = async (
    path: string
  ): Promise<{ items: { relativePath: string; bytes: Uint8Array }[]; skipped: string[] }> => {
    const targetEntries = await listEntries(path);
    const items: { relativePath: string; bytes: Uint8Array }[] = [];
    const skipped: string[] = [];
    for (const entry of targetEntries) {
      if (entry.kind === "file") {
        try {
          const plain = await decryptLegacy(password, entry.cipherData);
          items.push({ relativePath: entry.path, bytes: plain });
        } catch {
          skipped.push(entry.path);
        }
      } else {
        const nested = await collectLegacyForDownload(entry.path);
        items.push(...nested.items);
        skipped.push(...nested.skipped);
      }
    }
    return { items, skipped };
  };

  const downloadFolderAsZip = async (path: string, zipBaseName: string) => {
    setIsZipping(true);
    try {
      const { items, skipped } = await collectLegacyForDownload(path);
      if (items.length === 0) {
        alert(
          skipped.length > 0
            ? `No files could be decrypted with the current password (${skipped.length} skipped).`
            : "This folder has no files to download."
        );
        return;
      }
      const blob = await downloadZip(
        items.map((item) => ({ name: item.relativePath, input: item.bytes }))
      ).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      document.body.appendChild(a);
      a.download = `${zipBaseName}.zip`;
      a.href = url;
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (skipped.length > 0) {
        alert(
          `${skipped.length} file(s) skipped (could not decrypt with the current password):\n${skipped.join("\n")}`
        );
      }
    } catch (e) {
      console.error(e);
      alert("failed to build the zip download!");
    } finally {
      setIsZipping(false);
    }
  };

  const openEntry = useCallback(async (entry: Entry) => {
    if (entry.kind === "file") {
      if (entry.plainData === null) {
        try {
          entry.plainData = await decryptLegacy(password, entry.cipherData);
        } catch (e) {
          console.error(e);
          alert("failed to decrypt!");
          return;
        }
        setEntries([...entries]);
      }

      revokePreviewObjectUrl();

      const mimeType = getMimeType(entry.plainData);
      const blob = new Blob([entry.plainData], { type: mimeType });

      switch (getPreviewKind(mimeType)) {
        case "image":
        case "svg": {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (typeof event.target?.result === "string") {
              setPreview(
                <img
                  className="max-h-dvh max-w-dvw z-10"
                  alt={entry.name}
                  src={event.target.result}
                />
              );
              setPreviewPath(entry.path);
              setVisible(true);
            }
          };
          reader.readAsDataURL(blob);
          break;
        }
        case "text": {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (typeof event.target?.result === "string") {
              setPreview(
                <pre className="bg-slate-950 break-all max-h-full max-w-full overflow-x-scroll p-8 text-slate-50 text-wrap whitespace-pre-wrap z-10">
                  {event.target.result}
                </pre>
              );
              setPreviewPath(entry.path);
              setVisible(true);
            }
          };
          reader.readAsText(blob);
          break;
        }
        case "audio": {
          const url = URL.createObjectURL(blob);
          previewObjectUrlRef.current = url;
          setPreview(<audio className="z-10" controls src={url} />);
          setPreviewPath(entry.path);
          setVisible(true);
          break;
        }
        case "video": {
          const url = URL.createObjectURL(blob);
          previewObjectUrlRef.current = url;
          setPreview(
            <video
              className="max-h-dvh max-w-dvw z-10"
              controls
              src={url}
            />
          );
          setPreviewPath(entry.path);
          setVisible(true);
          break;
        }
        case "pdf": {
          const url = URL.createObjectURL(blob);
          previewObjectUrlRef.current = url;
          setPreview(
            <iframe
              className="bg-white h-[90dvh] w-[90dvw] z-10"
              title={entry.name}
              src={url}
            />
          );
          setPreviewPath(entry.path);
          setVisible(true);
          break;
        }
        case "unsupported": {
          setPreview(
            <div className="bg-slate-950 max-w-md p-8 rounded text-slate-50 z-10">
              <div className="font-semibold">{entry.name}</div>
              <div className="text-slate-400 text-sm mt-1">
                {entry.size.toLocaleString()} bytes
              </div>
              <div className="text-slate-400 text-sm">
                {mimeType === "application/octet-stream" ? "unknown" : mimeType}
              </div>
              <p className="mt-4">No preview available for this file type.</p>
              <button
                className="bg-slate-700 hover:bg-violet-700 duration-300 font-semibold mt-4 px-4 py-2 rounded-full text-sm transition-all"
                onClick={() => downloadEntry(entry)}
              >
                download
              </button>
            </div>
          );
          setPreviewPath(entry.path);
          setVisible(true);
          break;
        }
      }
    } else if (entry.kind === "directory") {
      if (entry.children !== undefined) {
        entry.children = undefined;
      } else {
        entry.children = await listEntries(entry.path);
      }
      setEntries([...entries]);
    }
  }, [entries, password, setEntries, revokePreviewObjectUrl]);

  const previewFiles = useMemo(() => {
    const flattenFiles = (targetEntries: Entry[]): Entry[] =>
      targetEntries.flatMap((targetEntry) => {
        if (targetEntry.kind === "file") return [targetEntry];
        if (targetEntry.children) return flattenFiles(targetEntry.children);
        return [];
      });
    return flattenFiles(entries);
  }, [entries]);

  const previewIndex = useMemo(
    () => previewFiles.findIndex((entry) => entry.path === previewPath),
    [previewFiles, previewPath]
  );

  const movePreview = useCallback(
    (offset: -1 | 1): boolean => {
      if (previewIndex === -1) return false;
      const target = previewFiles[previewIndex + offset];
      if (target) {
        void openEntry(target);
        return true;
      }
      return false;
    },
    [openEntry, previewFiles, previewIndex]
  );

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePreview();
      } else if (event.key === "ArrowLeft") {
        if (movePreview(-1)) event.preventDefault();
      } else if (event.key === "ArrowRight") {
        if (movePreview(1)) event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [visible, movePreview, closePreview]);

  const deleteEntry = async (entry: Entry) => {
    if (!confirm(`Are you sure want to delete "${entry.path}"?`)) return;
    if (entry.kind === "file") {
      await deleteFile(entry.path);
    } else if (entry.kind === "directory") {
      await deleteDir(entry.path);
    }
    refreshEntries("", entries).then((rootEntries) => setEntries(rootEntries));
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
            className="bg-slate-300 dark:bg-slate-600 disabled:opacity-50 hover:bg-violet-400 hover:dark:bg-violet-700 duration-300 font-semibold ml-2 px-4 py-2 rounded-full hover:text-violet-700 hover:dark:text-violet-100 text-sm transition-all"
            disabled={isZipping}
            onClick={() => downloadFolderAsZip(entry.path, entry.name)}
          >
            download folder
          </button>
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
      {entries.length > 0 ? (
        <div className="flex justify-end mb-2">
          <button
            className="bg-slate-300 dark:bg-slate-600 disabled:opacity-50 hover:bg-violet-400 hover:dark:bg-violet-700 duration-300 font-semibold px-4 py-2 rounded-full hover:text-violet-700 hover:dark:text-violet-100 text-sm transition-all"
            disabled={isZipping}
            onClick={() => downloadFolderAsZip("", "legacy")}
          >
            {isZipping ? "zipping..." : "download all (decrypted, .zip)"}
          </button>
        </div>
      ) : null}
      <ul>{entryList}</ul>
      <div
        className={
          "duration-300 fixed flex group h-dvh items-center justify-center left-0 top-0 transition-all w-dvw" +
          (visible ? " opacity-100 visible" : " collapse opacity-0")
        }
      >
        <div
          className="absolute bg-black h-full opacity-50 w-full z-0"
          onClick={closePreview}
        />
        {previewFiles.length > 1 ? (
          <>
            <button
              type="button"
              className="absolute disabled:opacity-0 disabled:pointer-events-none duration-300 flex h-full items-center justify-center left-0 transition-all w-[20vw] z-20 group/prev hover:bg-white/5"
              onClick={() => movePreview(-1)}
              aria-label="Previous file"
              disabled={previewIndex <= 0}
            >
              <span className="bg-black/40 backdrop-blur-sm duration-300 flex h-12 items-center justify-center rounded-full text-white/70 transition-all w-12 group-hover/prev:bg-black/60 group-hover/prev:scale-110 group-hover/prev:text-white">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true" focusable="false">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </span>
            </button>
            <button
              type="button"
              className="absolute disabled:opacity-0 disabled:pointer-events-none duration-300 flex h-full items-center justify-center right-0 transition-all w-[20vw] z-20 group/next hover:bg-white/5"
              onClick={() => movePreview(1)}
              aria-label="Next file"
              disabled={previewIndex >= previewFiles.length - 1}
            >
              <span className="bg-black/40 backdrop-blur-sm duration-300 flex h-12 items-center justify-center rounded-full text-white/70 transition-all w-12 group-hover/next:bg-black/60 group-hover/next:scale-110 group-hover/next:text-white">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true" focusable="false">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </button>
          </>
        ) : null}
        {preview}
        <button
          type="button"
          className="absolute bg-red-500 duration-300 h-12 hover:bg-red-600 m-1 right-0 rounded-full text-3xl text-white top-0 transition-colors w-12 z-30"
          onClick={closePreview}
          aria-label="Close preview"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default LegacyFinder;
