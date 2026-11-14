use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde_json::Value;
use sha2::{Digest, Sha256};

const MESH_KEY_SEED: &[u8] = b"MashVoice-Singularity-4.1-Global-E2EE-Mesh-Key";
const TOPIC_SALT: &str = "MashVoice-Singularity-v4-ZeroIP-Topic:";
const ENVELOPE_PREFIX: &str = "mv4e1.";

pub fn norm_pseudo_key(raw: &str) -> String {
    let trimmed = raw.trim().trim_start_matches('@').trim().to_lowercase();
    let replaced = trimmed.replace('#', "-tag-").replace(':', "-");
    replaced
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        .collect()
}

pub fn derive_relay_topic(logical_key: &str) -> String {
    let clean = logical_key.trim().to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(TOPIC_SALT.as_bytes());
    hasher.update(clean.as_bytes());
    let digest = hasher.finalize();
    let mut hex_str = String::with_capacity(28);
    hex_str.push_str("mv4_");
    for b in &digest[..12] {
        hex_str.push_str(&format!("{:02x}", b));
    }
    hex_str
}

pub fn user_subscription_keys(username: &str, display_name: &str, tag: &str, peer_id: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let u = norm_pseudo_key(username);
    if !u.is_empty() {
        keys.push(format!("inbox:{u}"));
        let t = tag.trim();
        if !t.is_empty() {
            let utag = norm_pseudo_key(&format!("{username}#{t}"));
            if !utag.is_empty() && utag != u {
                keys.push(format!("inbox:{utag}"));
            }
        }
    }
    let d = norm_pseudo_key(display_name);
    if !d.is_empty() && d != u {
        keys.push(format!("inbox:{d}"));
    }
    let p = norm_pseudo_key(peer_id);
    if !p.is_empty() {
        keys.push(format!("inbox:{p}"));
    }
    keys
}

fn cipher_instance() -> Aes256Gcm {
    let key_bytes = Sha256::digest(MESH_KEY_SEED);
    Aes256Gcm::new_from_slice(&key_bytes).expect("32-byte SHA-256 key")
}

pub fn encrypt_relay_envelope(payload: &Value) -> Option<String> {
    let plain = serde_json::to_vec(payload).ok()?;
    let cipher = cipher_instance();
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, plain.as_ref()).ok()?;

    let mut combined = Vec::with_capacity(12 + ct.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ct);
    Some(format!(
        "{}{}",
        ENVELOPE_PREFIX,
        URL_SAFE_NO_PAD.encode(combined)
    ))
}

pub fn decrypt_relay_envelope(raw: &str) -> Option<Value> {
    let encoded = raw.trim().strip_prefix(ENVELOPE_PREFIX)?;
    let combined = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    if combined.len() <= 12 {
        return None;
    }
    let (nonce_bytes, ct) = combined.split_at(12);
    let cipher = cipher_instance();
    let plain = cipher.decrypt(Nonce::from_slice(nonce_bytes), ct).ok()?;
    serde_json::from_slice(&plain).ok()
}
