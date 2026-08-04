export type BenchImpl = "wasm" | "subtle";

export type BenchOp = "encrypt" | "decrypt";

export type SizeLabel = "1KB" | "10KB" | "100KB" | "1MB" | "10MB";

export type SizeSpec = {
  label: SizeLabel;
  bytes: number;
};

export type CellResult = {
  impl: BenchImpl;
  op: BenchOp;
  sizeLabel: SizeLabel;
  sizeBytes: number;
  warmupIters: number;
  measuredIters: number;
  batchSize: number;
  samplesMs: number[];
  minMs: number;
  medianMs: number;
  meanMs: number;
  throughputMBps: number;
  qualityFlags: string[];
};

export type VerificationResult = {
  impl: BenchImpl;
  sizeLabel: SizeLabel;
  roundTripOk: boolean;
  lengthOk: boolean;
};
