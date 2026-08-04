"use client";
import { useState } from "react";
import { makeAesKey } from "@/lib/bench/fixtures";
import { toConsoleRows, toJson, toMarkdownTable } from "@/lib/bench/format";
import { runMatrix } from "@/lib/bench/runner";
import { CellResult, VerificationResult } from "@/lib/bench/types";
import { verifyAllImplsAndSizes, verifyCrossImplInterop } from "@/lib/bench/verify";

type Status = "idle" | "verifying" | "running" | "done" | "error";

type BenchmarkPanelProps = {
  className?: string;
  wasmReady: boolean;
};

const BenchmarkPanel: React.FC<BenchmarkPanelProps> = ({
  className,
  wasmReady,
}) => {
  const [status, setStatus] = useState<Status>("idle");
  const [progressLabel, setProgressLabel] = useState<string>("");
  const [verificationResults, setVerificationResults] = useState<
    VerificationResult[]
  >([]);
  const [interopOk, setInteropOk] = useState<boolean | null>(null);
  const [results, setResults] = useState<CellResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const run = async () => {
    setStatus("verifying");
    setErrorMessage(null);
    setResults([]);

    try {
      const key = makeAesKey();

      const verification = await verifyAllImplsAndSizes(key);
      setVerificationResults(verification);
      const interop = await verifyCrossImplInterop(key);
      setInteropOk(interop);

      const allVerified =
        verification.every((v) => v.roundTripOk && v.lengthOk) && interop;
      if (!allVerified) {
        setStatus("error");
        setErrorMessage(
          "Verification failed — aborting before timing to avoid untrustworthy numbers."
        );
        return;
      }

      setStatus("running");
      const cellResults = await runMatrix(setProgressLabel);
      setResults(cellResults);
      console.table(toConsoleRows(cellResults));
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const copyMarkdown = () => {
    navigator.clipboard.writeText(toMarkdownTable(results));
  };

  const copyJson = () => {
    navigator.clipboard.writeText(toJson(results));
  };

  const busy = status === "verifying" || status === "running";

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">AES-256-GCM Benchmark</h2>
          <p className="text-sm">
            WASM (aes-gcm crate) vs SubtleCrypto, crypto processing only.
          </p>
        </div>
        <button
          className="bg-violet-300 dark:bg-violet-600 disabled:bg-slate-500 disabled:dark:bg-slate-600 hover:bg-violet-400 hover:dark:bg-violet-700 duration-300 font-semibold px-4 py-2 rounded-full text-violet-700 dark:text-violet-100 hover:dark:text-violet-100 disabled:text-slate-600 disabled:dark:text-slate-400 transition-all"
          disabled={!wasmReady || busy}
          onClick={run}
        >
          {status === "verifying"
            ? "verifying..."
            : status === "running"
            ? "running..."
            : "run benchmark"}
        </button>
      </div>

      {busy ? <p className="mt-4 text-sm">{progressLabel || "verifying..."}</p> : null}

      {errorMessage ? (
        <p className="mt-4 text-red-600 dark:text-red-400 font-semibold">
          {errorMessage}
        </p>
      ) : null}

      {verificationResults.length > 0 ? (
        <div className="mt-4">
          <h3 className="font-semibold">Verification</h3>
          <ul className="text-sm">
            {verificationResults.map((v) => (
              <li key={`${v.impl}-${v.sizeLabel}`}>
                {v.roundTripOk && v.lengthOk ? "✅" : "❌"} {v.impl} / {v.sizeLabel}
              </li>
            ))}
            <li>{interopOk ? "✅" : "❌"} cross-impl interop</li>
          </ul>
        </div>
      ) : null}

      {status === "done" && results.length > 0 ? (
        <div className="mt-4">
          <div className="flex gap-2 mb-2">
            <button
              className="bg-slate-300 dark:bg-slate-600 hover:bg-violet-400 hover:dark:bg-violet-700 duration-300 font-semibold px-4 py-2 rounded-full text-sm transition-all"
              onClick={copyMarkdown}
            >
              copy as markdown
            </button>
            <button
              className="bg-slate-300 dark:bg-slate-600 hover:bg-violet-400 hover:dark:bg-violet-700 duration-300 font-semibold px-4 py-2 rounded-full text-sm transition-all"
              onClick={copyJson}
            >
              copy as json
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm text-left w-full">
              <thead>
                <tr>
                  <th className="pr-4">Impl</th>
                  <th className="pr-4">Op</th>
                  <th className="pr-4">Size</th>
                  <th className="pr-4">Warmup</th>
                  <th className="pr-4">Measured</th>
                  <th className="pr-4">Batch</th>
                  <th className="pr-4">Min (ms)</th>
                  <th className="pr-4">Median (ms)</th>
                  <th className="pr-4">Mean (ms)</th>
                  <th className="pr-4">MB/s</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={`${r.impl}-${r.op}-${r.sizeLabel}`}>
                    <td className="pr-4">{r.impl}</td>
                    <td className="pr-4">{r.op}</td>
                    <td className="pr-4">{r.sizeLabel}</td>
                    <td className="pr-4">{r.warmupIters}</td>
                    <td className="pr-4">{r.measuredIters}</td>
                    <td className="pr-4">{r.batchSize}</td>
                    <td className="pr-4">{r.minMs.toFixed(4)}</td>
                    <td className="pr-4">{r.medianMs.toFixed(4)}</td>
                    <td className="pr-4">{r.meanMs.toFixed(4)}</td>
                    <td className="pr-4">{r.throughputMBps.toFixed(2)}</td>
                    <td>{r.qualityFlags.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <pre className="bg-slate-100 dark:bg-slate-800 mt-4 overflow-x-auto p-4 rounded-2xl text-xs">
            {toJson(results)}
          </pre>
        </div>
      ) : null}
    </div>
  );
};

export default BenchmarkPanel;
