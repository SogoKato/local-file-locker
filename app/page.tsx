"use client";
import NewFile from "@/components/buttons/NewFile";
import { useEffect, useState } from "react";
import init from "@/wasm-crypto/pkg/wasm_crypto";
import Finder from "@/components/Finder";
import { Entry, listEntries } from "@/lib/opfs";

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [password, setPassword] = useState<string>("");
  const [descriptionOpen, setDescriptionOpen] = useState<boolean>(true);

  useEffect(() => {
    init();
    listEntries("").then((rootEntries) => setEntries(rootEntries));
  }, []);

  return (
    <div>
      <main className="p-4 sm:p-8">
        <div className="bg-slate-300 dark:bg-slate-700 duration-300 mb-8 p-4 rounded-2xl transition-all">
          <h1
            className="font-bold text-xl"
            onClick={() => setDescriptionOpen(!descriptionOpen)}
          >
            Local File Locker
          </h1>
          <div
            className={
              "duration-300 grid transition-all" +
              (descriptionOpen ? " grid-rows-[1fr]" : " grid-rows-[0fr]")
            }
          >
            <div className="overflow-y-hidden">
              <p className="mb-1 mt-2">
                Local File Locker is an encrypted file manager that runs
                entirely within your browser. Files are encrypted on your device
                and stored using the browser&apos;s{" "}
                <a
                  className="text-violet-600 dark:text-violet-400"
                  href="https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system"
                  target="_blank"
                >
                  Origin Private File System
                </a>
                . Encryption is performed using symmetric encryption (AES-GCM
                mode), and the process is executed via WASM.
              </p>
              <p>
                The source code is available on{" "}
                <a
                  className="text-violet-600 dark:text-violet-400"
                  href="https://github.com/SogoKato/local-file-locker"
                  target="_blank"
                >
                  GitHub
                </a>
                . This app is intended for hobby use, and the author assumes no
                responsibility for any damages resulting from its use.
              </p>
              <h2 className="font-bold my-2 text-lg">How to Use</h2>
              <ol className="list-decimal pl-8">
                <li>Set a password for encryption and decryption.</li>
                <li>Select files.</li>
                <li>
                  Click the <b>encrypt</b> button to encrypt and save the file.
                </li>
                <li>To view a file, click its filename.</li>
              </ol>
              <div className="w-full">
                <button
                  className="bg-slate-300 dark:bg-slate-600 hover:bg-violet-400 hover:dark:bg-violet-700 block duration-300 font-semibold ml-auto mt-2 px-4 py-2 rounded-full hover:text-violet-700 hover:dark:text-violet-100 text-sm transition-all w-fit"
                  onClick={() => setDescriptionOpen(false)}
                >
                  I got it!
                </button>
              </div>
            </div>
          </div>
        </div>
        <label className="bg-slate-300 dark:bg-slate-700 flex items-center gap-4 mb-8 p-4 rounded-2xl">
          <div className="shrink-0 w-fit">Password:</div>
          <input
            className="bg-slate-100 dark:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 px-4 py-2 rounded-full w-full"
            type="password"
            placeholder="pa$$w0rd1234"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <NewFile
          className="bg-slate-300 dark:bg-slate-700 flex flex-wrap gap-4 items-center justify-between mb-8 p-4 rounded-2xl"
          entries={entries}
          setEntries={setEntries}
          password={password}
        />
        <Finder
          className="bg-slate-200 dark:bg-slate-800 p-4 rounded-2xl"
          entries={entries}
          setEntries={setEntries}
          password={password}
        />
      </main>
      <footer className="w-full">
        <div className="m-auto w-fit">
          {new Date().getFullYear()}{" "}🐶{" "}
          <a href="https://sogo.dev" target="_blank">
            SogoKato
          </a>
        </div>
      </footer>
    </div>
  );
}
