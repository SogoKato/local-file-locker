// AES-256-GCM encrypt/decrypt via SubtleCrypto, keyed by a per-blob
// PBKDF2-derived key.
//
// v2 blob format (current, must stay in sync with tools/recover-password.mjs):
//   blob = magic(4 bytes: "LFL2") || salt(16 bytes) || iterations(4 bytes, u32 BE)
//          || nonce(12 bytes) || ciphertext_and_tag
//   key  = PBKDF2-HMAC-SHA256(password utf8 bytes, salt, iterations, 32 bytes)
//
// AAD (when provided) is passed straight through to SubtleCrypto's
// additionalData and is never stored in the blob itself - callers must
// reconstruct the same bytes on both encrypt and decrypt.
//
// v1 (legacy, read-only via decryptLegacy, used only by the /legacy page):
//   file = nonce(12 bytes) || ciphertext || auth_tag(16 bytes)
//   key  = SHA-256(password utf8 bytes), no salt, no stretching, no AAD
//
// v1 is never written anymore; encrypt() always produces v2.

const MAGIC = new Uint8Array([0x4c, 0x46, 0x4c, 0x32]); // "LFL2"
const SALT_LENGTH = 16;
const ITERATIONS_LENGTH = 4;
const NONCE_LENGTH = 12;
const HEADER_LENGTH =
  MAGIC.length + SALT_LENGTH + ITERATIONS_LENGTH + NONCE_LENGTH;
const DEFAULT_ITERATIONS = 600_000; // OWASP minimum for PBKDF2-HMAC-SHA256 (2023 guidance)

const hasV2Magic = (data: Uint8Array): boolean =>
  data.length >= HEADER_LENGTH && MAGIC.every((b, i) => data[i] === b);

const deriveKey = async (
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<CryptoKey> => {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export const encrypt = async (
  password: string,
  plaintext: Uint8Array,
  aad?: Uint8Array<ArrayBuffer>
): Promise<Uint8Array> => {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iterations = DEFAULT_ITERATIONS;
  const key = await deriveKey(password, salt, iterations);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad },
    key,
    new Uint8Array(plaintext)
  );

  const iterationsBytes = new Uint8Array(ITERATIONS_LENGTH);
  new DataView(iterationsBytes.buffer).setUint32(0, iterations, false);

  const out = new Uint8Array(HEADER_LENGTH + ciphertext.byteLength);
  let offset = 0;
  out.set(MAGIC, offset);
  offset += MAGIC.length;
  out.set(salt, offset);
  offset += SALT_LENGTH;
  out.set(iterationsBytes, offset);
  offset += ITERATIONS_LENGTH;
  out.set(nonce, offset);
  offset += NONCE_LENGTH;
  out.set(new Uint8Array(ciphertext), offset);
  return out;
};

export const decrypt = async (
  password: string,
  blob: Uint8Array,
  aad?: Uint8Array<ArrayBuffer>
): Promise<Uint8Array> => {
  const data = new Uint8Array(blob);
  if (!hasV2Magic(data)) {
    throw new Error("Unrecognized or corrupt data: missing v2 magic bytes.");
  }

  let offset = MAGIC.length;
  const salt = data.slice(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const iterationsBytes = data.slice(offset, offset + ITERATIONS_LENGTH);
  offset += ITERATIONS_LENGTH;
  const iterations = new DataView(iterationsBytes.buffer).getUint32(0, false);
  const nonce = data.slice(offset, offset + NONCE_LENGTH);
  offset += NONCE_LENGTH;
  const rest = data.subarray(offset);

  const key = await deriveKey(password, salt, iterations);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad },
    key,
    rest
  );
  return new Uint8Array(plaintext);
};

// --- Legacy (v1) read path ------------------------------------------------
// Kept only so previously-encrypted files remain viewable on /legacy.
// Never used to produce new files.

const deriveKeyLegacy = async (password: string): Promise<CryptoKey> => {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(password)
  );
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]);
};

export const decryptLegacy = async (
  password: string,
  file: Uint8Array
): Promise<Uint8Array> => {
  const key = await deriveKeyLegacy(password);
  const data = new Uint8Array(file);
  const iv = data.subarray(0, 12);
  const rest = data.subarray(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    rest
  );
  return new Uint8Array(plaintext);
};
