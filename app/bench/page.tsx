"use client";
import { useEffect, useState } from "react";
import init from "@/wasm-crypto/pkg/wasm_crypto";
import BenchmarkPanel from "@/components/bench/BenchmarkPanel";

export default function Bench() {
  const [wasmReady, setWasmReady] = useState<boolean>(false);

  useEffect(() => {
    init().then(() => setWasmReady(true));
  }, []);

  return (
    <div>
      <main className="p-4 sm:p-8">
        <BenchmarkPanel
          className="bg-slate-200 dark:bg-slate-800 p-4 rounded-2xl"
          wasmReady={wasmReady}
        />
      </main>
    </div>
  );
}
