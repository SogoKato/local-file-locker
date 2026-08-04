import { BenchCipher } from "@/wasm-crypto/pkg/wasm_crypto";
import { BenchImpl } from "@/lib/bench/types";

export type Prepared =
  | { kind: "wasm"; cipher: BenchCipher }
  | { kind: "subtle"; key: CryptoKey };

// Untimed setup: WASM cipher construction (key schedule) or SubtleCrypto
// key import. Called once per (impl, cell), never inside a timed loop.
export const prepare = async (
  impl: BenchImpl,
  key: Uint8Array
): Promise<Prepared> => {
  if (impl === "wasm") {
    return { kind: "wasm", cipher: new BenchCipher(key) };
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
  return { kind: "subtle", key: cryptoKey };
};

// Single, un-batched calls used by verification. The hot timed loop in
// runner.ts calls BenchCipher/crypto.subtle directly, not through these.
export const encryptOnce = async (
  prepared: Prepared,
  nonce: Uint8Array,
  plaintext: Uint8Array
): Promise<Uint8Array> => {
  if (prepared.kind === "wasm") {
    return prepared.cipher.encrypt(nonce, plaintext);
  }
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    prepared.key,
    plaintext
  );
  return new Uint8Array(ciphertext);
};

export const decryptOnce = async (
  prepared: Prepared,
  nonce: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> => {
  if (prepared.kind === "wasm") {
    return prepared.cipher.decrypt(nonce, ciphertext);
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    prepared.key,
    ciphertext
  );
  return new Uint8Array(plaintext);
};
