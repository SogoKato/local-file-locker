import { SizeSpec } from "@/lib/bench/types";

export const SIZES: SizeSpec[] = [
  { label: "1KB", bytes: 1024 },
  { label: "10KB", bytes: 10 * 1024 },
  { label: "100KB", bytes: 100 * 1024 },
  { label: "1MB", bytes: 1024 * 1024 },
  { label: "10MB", bytes: 10 * 1024 * 1024 },
];

// Browsers throw QuotaExceededError above this many bytes per
// crypto.getRandomValues() call.
const GET_RANDOM_VALUES_MAX = 65536;

export const randomBytes = (n: number): Uint8Array => {
  if (n > GET_RANDOM_VALUES_MAX) {
    throw new Error(
      `randomBytes: ${n} exceeds crypto.getRandomValues limit of ${GET_RANDOM_VALUES_MAX}`
    );
  }
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const makeAesKey = (): Uint8Array => randomBytes(32);

export const makeNonce = (): Uint8Array => randomBytes(12);

export const makeNonces = (count: number): Uint8Array[] =>
  Array.from({ length: count }, () => makeNonce());

// Plaintext filler for the timed encrypt/decrypt calls. Doesn't need to be
// cryptographically random (it's not a key/nonce), just needs to exist at
// the target size. Generates one <=64KiB random tile and repeats it via
// .set() to avoid the crypto.getRandomValues per-call limit above, and to
// keep setup fast even at 10MB.
export const makeFillerBuffer = (size: number): Uint8Array => {
  const tileSize = Math.min(size, GET_RANDOM_VALUES_MAX);
  const tile = randomBytes(tileSize);
  const buffer = new Uint8Array(size);
  for (let offset = 0; offset < size; offset += tileSize) {
    buffer.set(tile.subarray(0, Math.min(tileSize, size - offset)), offset);
  }
  return buffer;
};
