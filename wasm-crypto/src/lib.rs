use aes_gcm::{Aes256Gcm, Key};
use aes_gcm::aead::{generic_array::GenericArray, Aead, KeyInit};
use wasm_bindgen::prelude::*;

/// Benchmark-only AES-256-GCM cipher over a raw key, used to compare this
/// crate's throughput against SubtleCrypto without password-hashing cost
/// in the timed path. Not used by the app's encrypt/decrypt flow.
#[wasm_bindgen]
pub struct BenchCipher {
    cipher: Aes256Gcm,
}

#[wasm_bindgen]
impl BenchCipher {
    #[wasm_bindgen(constructor)]
    pub fn new(key: &[u8]) -> BenchCipher {
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
        BenchCipher { cipher }
    }

    pub fn encrypt(&self, nonce: &[u8], plaintext: &[u8]) -> Box<[u8]> {
        let nonce = GenericArray::from_slice(nonce);
        self.cipher
            .encrypt(nonce, plaintext)
            .expect("bench encryption failure!")
            .into_boxed_slice()
    }

    pub fn decrypt(&self, nonce: &[u8], ciphertext: &[u8]) -> Box<[u8]> {
        let nonce = GenericArray::from_slice(nonce);
        self.cipher
            .decrypt(nonce, ciphertext)
            .expect("bench decryption failure!")
            .into_boxed_slice()
    }
}
