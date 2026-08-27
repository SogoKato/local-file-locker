// AES-256-GCM encrypt/decrypt via SubtleCrypto.
//
// File format (must stay in sync with wasm-crypto/src/lib.rs and
// tools/recover-password.mjs):
//   file = nonce(12 bytes) || ciphertext || auth_tag(16 bytes)
//   key  = SHA-256(password utf8 bytes), used as AES-256-GCM key

const deriveKey = async (password: string): Promise<CryptoKey> => {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(password)
  );
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
};

export const encrypt = async (
  password: string,
  file: Uint8Array
): Promise<Uint8Array> => {
  const key = await deriveKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new Uint8Array(file)
  );
  const out = new Uint8Array(iv.length + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), iv.length);
  return out;
};

export const decrypt = async (
  password: string,
  file: Uint8Array
): Promise<Uint8Array> => {
  const key = await deriveKey(password);
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
