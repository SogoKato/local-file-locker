"use client";
import Link from "next/link";
import LegacyFinder from "@/components/LegacyFinder";
import { Entry, listEntries } from "@/lib/opfs";
import { useEffect, useState } from "react";

export default function Legacy() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [password, setPassword] = useState<string>("");

  useEffect(() => {
    listEntries("").then((rootEntries) => setEntries(rootEntries));
  }, []);

  return (
    <div>
      <main className="p-4 sm:p-8">
        <div className="bg-slate-300 dark:bg-slate-700 mb-8 p-4 rounded-2xl">
          <h1 className="font-bold text-xl">Legacy Files</h1>
          <p className="mb-1 mt-2">
            This page opens files encrypted by an older version of Local File
            Locker, which derived its key from a single unsalted SHA-256 hash
            of your password. It exists so you can still read those files —
            it is read-only, there is no upload/encrypt here. New files
            should be created on the{" "}
            <Link className="text-violet-600 dark:text-violet-400" href="/">
              main page
            </Link>
            , which uses a stronger, salted key derivation and does not show
            files created here.
          </p>
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
        <LegacyFinder
          className="bg-slate-200 dark:bg-slate-800 p-4 rounded-2xl"
          entries={entries}
          setEntries={setEntries}
          password={password}
        />
      </main>
      <footer className="w-full">
        <div className="m-auto w-fit">
          <Link
            className="text-violet-600 dark:text-violet-400"
            href="/"
          >
            Back to main page
          </Link>
        </div>
      </footer>
    </div>
  );
}
