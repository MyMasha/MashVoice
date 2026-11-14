use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const ZYNTRA_RELAY_HTTP_BASE: &str = "https://zyntra.win/api/mashvoice";
pub const ZYNTRA_RELAY_WS_URL: &str = "wss://zyntra.win/api/mashvoice/ws";
const DOMAIN_SEP: &[u8] = b"mv-relay-v1:e2ee:";
const ENVELOPE_PREFIX: &str = "mv4e1.";

/// Normalize any topic or pseudo key identically to `mashvoice-relay.js` on `zyntra.win`.
pub fn norm_relay_key(raw: &str) -> String {
    let trimmed = raw.trim().trim_start_matches('@').to_lowercase();
    let replaced = trimmed.replace('#', "-tag-");
    replaced
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '-'))
        .take(96)
        .collect()
}

/// Normalize a bare pseudo (stripping `:` so it safely sits after `inbox:`).
pub fn norm_pseudo_key(raw: &str) -> String {
    norm_relay_key(raw).replace(':', "-")
}

pub fn user_subscription_keys(
    username: &str,
    display_name: &str,
    tag: &str,
    peer_id: &str,
) -> Vec<String> {
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

fn cipher_for_secret(context_secret: &str) -> Aes256Gcm {
    let mut hasher = Sha256::new();
    hasher.update(DOMAIN_SEP);
    hasher.update(context_secret.trim().as_bytes());
    let key_bytes = hasher.finalize();
    Aes256Gcm::new_from_slice(&key_bytes).expect("32-byte SHA-256 key")
}

/// Encrypts a JSON payload into an opaque `mv4e1.<base64url>` AES-256-GCM envelope
/// using a dynamic per-context secret (e.g. ECDH shared secret or private server invite code).
/// No static global encryption key exists in source code.
pub fn encrypt_relay_envelope(payload: &Value, context_secret: &str) -> Option<String> {
    if context_secret.trim().is_empty() {
        return None;
    }
    let plain = serde_json::to_vec(payload).ok()?;
    let cipher = cipher_for_secret(context_secret);
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

/// Decrypts an opaque `mv4e1.<base64url>` AES-256-GCM envelope using the matching context secret.
pub fn decrypt_relay_envelope(raw: &str, context_secret: &str) -> Option<Value> {
    if context_secret.trim().is_empty() {
        return None;
    }
    let encoded = raw.trim().strip_prefix(ENVELOPE_PREFIX)?;
    let combined = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    if combined.len() <= 12 {
        return None;
    }
    let (nonce_bytes, ct) = combined.split_at(12);
    let cipher = cipher_for_secret(context_secret);
    let plain = cipher.decrypt(Nonce::from_slice(nonce_bytes), ct).ok()?;
    serde_json::from_slice(&plain).ok()
}
