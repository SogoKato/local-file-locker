import { BenchCipher } from "@/wasm-crypto/pkg/wasm_crypto";
import { Prepared, prepare, encryptOnce } from "@/lib/bench/adapters";
import { makeAesKey, makeFillerBuffer, makeNonce, makeNonces, SIZES } from "@/lib/bench/fixtures";
import { BenchImpl, BenchOp, CellResult, SizeSpec } from "@/lib/bench/types";

const WARMUP_TIME_BUDGET_MS = 300;
const WARMUP_MIN_ITERS = 5;
const WARMUP_MAX_ITERS = 100;

const MEASURE_TIME_BUDGET_MS = 1000;
const MEASURE_MIN_ITERS = 5;
const MEASURE_MAX_ITERS = 200;

// Below this per-call duration, performance.now() resolution makes
// individual samples unreliable, so we switch to batched sampling.
const MIN_RELIABLE_SAMPLE_MS = 1;
const BATCH_SIZE = 50;

const min = (xs: number[]): number => xs.reduce((a, b) => Math.min(a, b));
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

type SampleFn = (batchSize: number) => number | Promise<number>;

const timedLoop = async (
  sampleOnce: SampleFn,
  timeBudgetMs: number,
  minIters: number,
  maxIters: number,
  batchSize: number
): Promise<number[]> => {
  const samples: number[] = [];
  const start = performance.now();
  while (
    samples.length < maxIters &&
    (samples.length < minIters || performance.now() - start < timeBudgetMs)
  ) {
    samples.push(await sampleOnce(batchSize));
  }
  return samples;
};

// The WASM measured region is a tight synchronous loop, including the
// wasm-bindgen linear-memory copy in/out on every call — that copy is real
// overhead of "using WASM from JS" and is intentionally left in.
const sampleEncryptWasm = (
  cipher: BenchCipher,
  plaintext: Uint8Array,
  batchSize: number
): number => {
  const nonces = makeNonces(batchSize);
  const t0 = performance.now();
  for (let i = 0; i < batchSize; i++) cipher.encrypt(nonces[i], plaintext);
  return (performance.now() - t0) / batchSize;
};

const sampleDecryptWasm = (
  cipher: BenchCipher,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  batchSize: number
): number => {
  const t0 = performance.now();
  for (let i = 0; i < batchSize; i++) cipher.decrypt(nonce, ciphertext);
  return (performance.now() - t0) / batchSize;
};

// Each SubtleCrypto call is awaited so the timer captures when the work
// actually finished; this await/microtask cost is real integration
// overhead, kept in the timed region for the same reason as the WASM copy.
const sampleEncryptSubtle = async (
  key: CryptoKey,
  plaintext: Uint8Array,
  batchSize: number
): Promise<number> => {
  const nonces = makeNonces(batchSize);
  const t0 = performance.now();
  for (let i = 0; i < batchSize; i++) {
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonces[i] }, key, plaintext);
  }
  return (performance.now() - t0) / batchSize;
};

const sampleDecryptSubtle = async (
  key: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  batchSize: number
): Promise<number> => {
  const t0 = performance.now();
  for (let i = 0; i < batchSize; i++) {
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
  }
  return (performance.now() - t0) / batchSize;
};

const buildSampleFn = (
  prepared: Prepared,
  op: BenchOp,
  plaintext: Uint8Array,
  fixedNonce: Uint8Array | undefined,
  fixedCiphertext: Uint8Array | undefined
): SampleFn => {
  if (prepared.kind === "wasm") {
    return op === "encrypt"
      ? (batchSize) => sampleEncryptWasm(prepared.cipher, plaintext, batchSize)
      : (batchSize) =>
          sampleDecryptWasm(prepared.cipher, fixedNonce!, fixedCiphertext!, batchSize);
  }
  return op === "encrypt"
    ? (batchSize) => sampleEncryptSubtle(prepared.key, plaintext, batchSize)
    : (batchSize) =>
        sampleDecryptSubtle(prepared.key, fixedNonce!, fixedCiphertext!, batchSize);
};

const runCell = async (
  impl: BenchImpl,
  op: BenchOp,
  size: SizeSpec,
  key: Uint8Array
): Promise<CellResult> => {
  const prepared = await prepare(impl, key);
  const plaintext = makeFillerBuffer(size.bytes);

  let fixedNonce: Uint8Array | undefined;
  let fixedCiphertext: Uint8Array | undefined;
  if (op === "decrypt") {
    fixedNonce = makeNonce();
    fixedCiphertext = await encryptOnce(prepared, fixedNonce, plaintext);
  }

  const sampleAt = buildSampleFn(prepared, op, plaintext, fixedNonce, fixedCiphertext);

  const warmupSamples = await timedLoop(
    sampleAt,
    WARMUP_TIME_BUDGET_MS,
    WARMUP_MIN_ITERS,
    WARMUP_MAX_ITERS,
    1
  );

  let batchSize = 1;
  const qualityFlags: string[] = [];
  if (median(warmupSamples) < MIN_RELIABLE_SAMPLE_MS) {
    batchSize = BATCH_SIZE;
    qualityFlags.push("batched");
  }

  const rawSamples = await timedLoop(
    sampleAt,
    MEASURE_TIME_BUDGET_MS,
    MEASURE_MIN_ITERS,
    MEASURE_MAX_ITERS,
    batchSize
  );

  if (batchSize === 1 && rawSamples.some((s) => s === 0)) {
    qualityFlags.push("possible-timer-quantization");
  }

  const medianMs = median(rawSamples);
  const throughputMBps = size.bytes / (1024 * 1024) / (medianMs / 1000);

  if (throughputMBps < 5 || throughputMBps > 5000) {
    qualityFlags.push("implausible-throughput");
  }

  return {
    impl,
    op,
    sizeLabel: size.label,
    sizeBytes: size.bytes,
    warmupIters: warmupSamples.length,
    measuredIters: rawSamples.length,
    batchSize,
    samplesMs: rawSamples,
    minMs: min(rawSamples),
    medianMs,
    meanMs: mean(rawSamples),
    throughputMBps,
    qualityFlags,
  };
};

export const runMatrix = async (
  onProgress: (label: string) => void
): Promise<CellResult[]> => {
  const key = makeAesKey();
  const results: CellResult[] = [];

  for (const op of ["encrypt", "decrypt"] as const) {
    for (const size of SIZES) {
      for (const impl of ["wasm", "subtle"] as const) {
        onProgress(`${impl} / ${op} / ${size.label}`);
        results.push(await runCell(impl, op, size, key));
        // Yield so React can repaint the progress label between cells.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  return results;
};
