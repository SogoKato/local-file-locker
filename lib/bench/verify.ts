import { decryptOnce, encryptOnce, prepare } from "@/lib/bench/adapters";
import { makeFillerBuffer, makeNonce, SIZES } from "@/lib/bench/fixtures";
import { BenchImpl, SizeSpec, VerificationResult } from "@/lib/bench/types";

const GCM_TAG_BYTES = 16;

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const verifyImplAtSize = async (
  impl: BenchImpl,
  size: SizeSpec,
  key: Uint8Array
): Promise<VerificationResult> => {
  const prepared = await prepare(impl, key);
  const plaintext = makeFillerBuffer(size.bytes);
  const nonce = makeNonce();

  const ciphertext = await encryptOnce(prepared, nonce, plaintext);
  const lengthOk = ciphertext.length === plaintext.length + GCM_TAG_BYTES;

  const roundTrip = await decryptOnce(prepared, nonce, ciphertext);
  const roundTripOk = bytesEqual(roundTrip, plaintext);

  return { impl, sizeLabel: size.label, roundTripOk, lengthOk };
};

export const verifyAllImplsAndSizes = async (
  key: Uint8Array
): Promise<VerificationResult[]> => {
  const results: VerificationResult[] = [];
  for (const impl of ["wasm", "subtle"] as const) {
    for (const size of SIZES) {
      results.push(await verifyImplAtSize(impl, size, key));
    }
  }
  return results;
};

// Confirms ciphertext produced by one implementation decrypts correctly
// under the other, using the same key/nonce. Catches format mismatches
// (e.g. an accidental nonce prefix) that a same-impl round trip would miss.
export const verifyCrossImplInterop = async (
  key: Uint8Array
): Promise<boolean> => {
  const plaintext = makeFillerBuffer(SIZES[0].bytes);
  const nonce = makeNonce();

  const wasmPrepared = await prepare("wasm", key);
  const subtlePrepared = await prepare("subtle", key);

  const ciphertextFromWasm = await encryptOnce(wasmPrepared, nonce, plaintext);
  const plaintextFromSubtle = await decryptOnce(
    subtlePrepared,
    nonce,
    ciphertextFromWasm
  );

  const ciphertextFromSubtle = await encryptOnce(
    subtlePrepared,
    nonce,
    plaintext
  );
  const plaintextFromWasm = await decryptOnce(
    wasmPrepared,
    nonce,
    ciphertextFromSubtle
  );

  return (
    bytesEqual(plaintextFromSubtle, plaintext) &&
    bytesEqual(plaintextFromWasm, plaintext)
  );
};
