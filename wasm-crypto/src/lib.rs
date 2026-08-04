use aes_gcm::{AeadCore, Aes256Gcm, Key};
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use sha2::digest::generic_array::GenericArray;
use sha2::{Sha256, Digest};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn encrypt(password: &str, file: &[u8]) -> Box<[u8]> {
    let key = hash_password(password);
    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let ciphertext = cipher.encrypt(&nonce, file).expect("encryption failure!");
    [nonce.as_slice(), &ciphertext].concat().into_boxed_slice()
}

#[wasm_bindgen]
pub fn decrypt(password: &str, file: &[u8]) -> Box<[u8]> {
    let key = hash_password(password);
    let cipher = Aes256Gcm::new(&key.into());

    let (nonce_bytes, ciphertext) = file.split_at(12);
    let nonce = GenericArray::from_slice(nonce_bytes);

    let plaintext = cipher.decrypt(&nonce, ciphertext).expect("decryption failure!");
    plaintext.into_boxed_slice()
}

fn hash_password(password: &str) -> Key<Aes256Gcm> {
    let hash = Sha256::digest(password.as_bytes());
    Key::<Aes256Gcm>::from_slice(&hash).clone()
}

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
