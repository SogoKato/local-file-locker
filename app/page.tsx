"use client";
import NewFile from "@/components/buttons/NewFile";
import { useEffect, useState } from "react";
import init from "@/wasm-crypto/pkg/wasm_crypto";
import Finder from "@/components/Finder";
import { Entry, listFilesInDirectory } from "@/lib/opfs";

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [password, setPassword] = useState<string>("");

  useEffect(() => {
    init();
    listFilesInDirectory().then((rootEntries) => setEntries(rootEntries));
  }, []);

  return (
    <div>
      <main className="p-4 sm:p-8">
        <div className="bg-slate-300 dark:bg-slate-700 flex items-center mb-8 p-4 rounded-2xl">
          <input
            className="bg-slate-100 dark:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 px-4 py-2 rounded-full w-full"
            type="password"
            placeholder="pa$$w0rd1234"
            onChange={event => setPassword(event.target.value)}
          />
        </div>
        <NewFile
          className="bg-slate-300 dark:bg-slate-700 flex flex-wrap gap-1 items-center justify-between mb-8 p-4 rounded-2xl"
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
    </div>
  );
}
