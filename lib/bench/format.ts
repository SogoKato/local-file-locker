import { CellResult } from "@/lib/bench/types";

export const toMarkdownTable = (results: CellResult[]): string => {
  const header =
    "| Impl | Op | Size | Warmup | Measured | Batch | Min (ms) | Median (ms) | Mean (ms) | Throughput (MB/s) | Flags |";
  const separator = "|---|---|---|---|---|---|---|---|---|---|---|";
  const rows = results.map((r) => {
    const flags = r.qualityFlags.length > 0 ? r.qualityFlags.join(", ") : "";
    return `| ${r.impl} | ${r.op} | ${r.sizeLabel} | ${r.warmupIters} | ${r.measuredIters} | ${r.batchSize} | ${r.minMs.toFixed(4)} | ${r.medianMs.toFixed(4)} | ${r.meanMs.toFixed(4)} | ${r.throughputMBps.toFixed(2)} | ${flags} |`;
  });
  return [header, separator, ...rows].join("\n");
};

export const toJson = (results: CellResult[]): string =>
  JSON.stringify(results, null, 2);

export const toConsoleRows = (results: CellResult[]): Record<string, unknown>[] =>
  results.map((r) => ({
    impl: r.impl,
    op: r.op,
    size: r.sizeLabel,
    warmupIters: r.warmupIters,
    measuredIters: r.measuredIters,
    batchSize: r.batchSize,
    minMs: Number(r.minMs.toFixed(4)),
    medianMs: Number(r.medianMs.toFixed(4)),
    meanMs: Number(r.meanMs.toFixed(4)),
    throughputMBps: Number(r.throughputMBps.toFixed(2)),
    flags: r.qualityFlags.join(", "),
  }));
