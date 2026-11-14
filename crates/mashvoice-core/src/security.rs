use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use parking_lot::Mutex;
use qrcode::{render::svg, EcLevel, QrCode};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn unix_ms_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTokenPayload {
    pub v: u8,
    pub jti: String,
    pub lbl: String,
    pub tier: String,
    pub usr: Option<String>,
    pub iat: u64,
    pub exp: u64,
    pub scp: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MintedToken {
    pub token: String,
    pub payload: ConnectionTokenPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPayload {
    pub sid: String,
    pub uid: String,
    pub usr: String,
    #[serde(rename = "dev")]
    pub device_type: String,
    #[serde(rename = "dnm")]
    pub device_name: String,
    pub jti: String,
    pub tier: String,
    pub iat: u64,
    pub exp: u64,
}

#[derive(Clone)]
pub struct SecurityEngine {
    master_secret: String,
    vault_path: PathBuf,
}

impl SecurityEngine {
    pub fn new(data_dir: &Path) -> Self {
        let _ = fs::create_dir_all(data_dir);
        let secret_file = data_dir.join("master.secret");
        let master_secret = if let Ok(env_sec) = std::env::var("MASHVOICE_MASTER_SECRET") {
            env_sec
        } else if let Ok(existing) = fs::read_to_string(&secret_file) {
            existing.trim().to_string()
        } else {
            let mut bytes = [0u8; 48];
            rand::thread_rng().fill_bytes(&mut bytes);
            let s = URL_SAFE_NO_PAD.encode(bytes);
            let _ = fs::write(&secret_file, &s);
            s
        };

        Self {
            master_secret,
            vault_path: data_dir.join("secure-vault.bin"),
        }
    }

    fn sign_hmac(&self, data: &str, domain: &str) -> Vec<u8> {
        let key = format!("{}:{}", self.master_secret, domain);
        let mut mac = <HmacSha256 as Mac>::new_from_slice(key.as_bytes())
            .expect("HMAC accepts arbitrary key size");
        mac.update(data.as_bytes());
        mac.finalize().into_bytes().to_vec()
    }

    /// Mint a mandatory cryptographic MashVoice Connection Token (`MASH-SV4.<payload>.<sig>`)
    pub fn mint_connection_token(
        &self,
        jti: Option<String>,
        label: &str,
        tier: &str,
        days: u64,
        bound_username: Option<String>,
    ) -> MintedToken {
        let now = unix_now();
        let payload = ConnectionTokenPayload {
            v: 4,
            jti: jti.unwrap_or_else(|| Uuid::new_v4().to_string()),
            lbl: label.to_string(),
            tier: tier.to_string(),
            usr: bound_username,
            iat: now,
            exp: now + days.max(1) * 86_400,
            scp: vec![
                "connect".into(),
                "p2p".into(),
                "stream".into(),
                "qr_auth".into(),
            ],
        };
        let json = serde_json::to_string(&payload).expect("valid token payload");
        let encoded = URL_SAFE_NO_PAD.encode(json.as_bytes());
        let sig = URL_SAFE_NO_PAD.encode(self.sign_hmac(&encoded, "conn-token"));
        MintedToken {
            token: format!("MASH-SV4.{}.{}", encoded, sig),
            payload,
        }
    }

    /// Constant-time cryptographic verification of mandatory Connection Token + revocation check
    pub fn verify_connection_token(
        &self,
        raw_token: &str,
        revoked_jtis: &HashSet<String>,
    ) -> Result<ConnectionTokenPayload, String> {
        let trimmed = raw_token.trim();
        if trimmed.is_empty() {
            return Err("Accès refusé : le Token de Connexion obligatoire est manquant.".into());
        }
        if !trimmed.starts_with("MASH-SV4.") {
            return Err("Format de token invalide (préfixe MASH-SV4 requis).".into());
        }
        let parts: Vec<&str> = trimmed.split('.').collect();
        if parts.len() != 3 {
            return Err("Structure cryptographique du token corrompue.".into());
        }
        let encoded_payload = parts[1];
        let provided_sig = URL_SAFE_NO_PAD
            .decode(parts[2])
            .map_err(|_| "Signature du token illisible.".to_string())?;
        let expected_sig = self.sign_hmac(encoded_payload, "conn-token");

        if provided_sig.len() != expected_sig.len()
            || !bool::from(provided_sig.ct_eq(&expected_sig))
        {
            return Err("Signature cryptographique invalide — accès refusé.".into());
        }

        let decoded_bytes = URL_SAFE_NO_PAD
            .decode(encoded_payload)
            .map_err(|_| "Payload du token illisible.".to_string())?;
        let payload: ConnectionTokenPayload = serde_json::from_slice(&decoded_bytes)
            .map_err(|_| "Payload JSON du token invalide.".to_string())?;

        if payload.exp <= unix_now() {
            return Err("Ce Token de Connexion a expiré.".into());
        }
        if revoked_jtis.contains(&payload.jti) {
            return Err(
                "Ce Token de Connexion obligatoire a été révoqué par un administrateur.".into(),
            );
        }
        Ok(payload)
    }

    pub fn mint_session_jwt(
        &self,
        user_id: &str,
        username: &str,
        device_type: &str,
        device_name: &str,
        token_jti: &str,
        tier: &str,
    ) -> (String, SessionPayload) {
        let now = unix_now();
        let session = SessionPayload {
            sid: Uuid::new_v4().to_string(),
            uid: user_id.to_string(),
            usr: username.to_string(),
            device_type: device_type.to_string(),
            device_name: device_name.to_string(),
            jti: token_jti.to_string(),
            tier: tier.to_string(),
            iat: now,
            exp: now + 30 * 86_400,
        };
        let encoded =
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&session).expect("valid session"));
        let sig = URL_SAFE_NO_PAD.encode(self.sign_hmac(&encoded, "session-jwt"));
        (format!("{}.{}", encoded, sig), session)
    }

    pub fn verify_session_jwt(
        &self,
        session_token: &str,
        revoked_jtis: &HashSet<String>,
    ) -> Result<SessionPayload, String> {
        let trimmed = session_token.trim();
        let parts: Vec<&str> = trimmed.split('.').collect();
        if parts.len() != 2 {
            return Err("Jeton de session invalide.".into());
        }
        let provided_sig = URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|_| "Signature de session illisible.".to_string())?;
        let expected_sig = self.sign_hmac(parts[0], "session-jwt");
        if provided_sig.len() != expected_sig.len()
            || !bool::from(provided_sig.ct_eq(&expected_sig))
        {
            return Err("Signature de session falsifiée.".into());
        }

        let decoded = URL_SAFE_NO_PAD
            .decode(parts[0])
            .map_err(|_| "Payload de session illisible.".to_string())?;
        let session: SessionPayload = serde_json::from_slice(&decoded)
            .map_err(|_| "Session JSON invalide.".to_string())?;

        if session.exp <= unix_now() {
            return Err("Session expirée.".into());
        }
        if revoked_jtis.contains(&session.jti) {
            return Err(
                "Token de connexion obligatoire révoqué — déconnexion immédiate.".into(),
            );
        }
        Ok(session)
    }

    /// AES-256-GCM Encrypted Local Vault in Rust (for Tauri Desktop & Mobile)
    fn derive_aes_key(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(self.master_secret.as_bytes());
        hasher.update(b":aes-256-gcm-vault");
        hasher.finalize().into()
    }

    pub fn read_encrypted_vault(&self) -> serde_json::Value {
        let Ok(raw) = fs::read(&self.vault_path) else {
            return serde_json::json!({});
        };
        if raw.len() < 13 {
            return serde_json::json!({});
        }
        let key = self.derive_aes_key();
        let cipher = Aes256Gcm::new((&key).into());
        let nonce = Nonce::from_slice(&raw[..12]);
        let Ok(plaintext) = cipher.decrypt(nonce, &raw[12..]) else {
            return serde_json::json!({});
        };
        serde_json::from_slice(&plaintext).unwrap_or_else(|_| serde_json::json!({}))
    }

    pub fn write_encrypted_vault(&self, patch: serde_json::Value) -> Result<(), String> {
        let mut current = self.read_encrypted_vault();
        if let (Some(cur_obj), Some(patch_obj)) = (current.as_object_mut(), patch.as_object()) {
            for (k, v) in patch_obj {
                cur_obj.insert(k.clone(), v.clone());
            }
        }
        let serialized = serde_json::to_vec(&current).map_err(|e| e.to_string())?;
        let key = self.derive_aes_key();
        let cipher = Aes256Gcm::new((&key).into());
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, serialized.as_ref())
            .map_err(|e| e.to_string())?;
        let mut out = Vec::with_capacity(12 + ciphertext.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        fs::write(&self.vault_path, out).map_err(|e| e.to_string())
    }
}

/// Sliding-window anti-brute-force rate limiter in Rust
pub struct LoginRateLimiter {
    max_attempts: usize,
    window_ms: u64,
    buckets: Mutex<HashMap<String, Vec<u64>>>,
}

impl LoginRateLimiter {
    pub fn new(max_attempts: usize, window_ms: u64) -> Self {
        Self {
            max_attempts,
            window_ms,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn check(&self, ip_key: &str) -> Result<(), u64> {
        let now = unix_ms_now();
        let mut map = self.buckets.lock();
        let entry = map.entry(ip_key.to_string()).or_default();
        entry.retain(|ts| now.saturating_sub(*ts) < self.window_ms);
        if entry.len() >= self.max_attempts {
            let oldest = entry[0];
            let retry_sec = (self.window_ms.saturating_sub(now.saturating_sub(oldest))).div_ceil(1000);
            return Err(retry_sec.max(1));
        }
        Ok(())
    }

    pub fn record_failure(&self, ip_key: &str) {
        let mut map = self.buckets.lock();
        map.entry(ip_key.to_string()).or_default().push(unix_ms_now());
    }

    pub fn reset(&self, ip_key: &str) {
        self.buckets.lock().remove(ip_key);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrChallenge {
    pub challenge_id: String,
    pub nonce: String,
    pub fingerprint: String,
    pub device_name: String,
    pub status: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub qr_payload: String,
    pub qr_data_url: String,
}

pub struct QrChallengeManager {
    ttl_ms: u64,
    challenges: Mutex<HashMap<String, QrChallenge>>,
}

impl QrChallengeManager {
    pub fn new(ttl_ms: u64) -> Self {
        Self {
            ttl_ms,
            challenges: Mutex::new(HashMap::new()),
        }
    }

    fn cleanup_locked(map: &mut HashMap<String, QrChallenge>) {
        let now = unix_ms_now();
        map.retain(|_, ch| ch.expires_at > now);
    }

    pub fn create(&self, device_name: &str) -> Result<QrChallenge, String> {
        let mut id_bytes = [0u8; 12];
        let mut nonce_bytes = [0u8; 24];
        rand::thread_rng().fill_bytes(&mut id_bytes);
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        let challenge_id = URL_SAFE_NO_PAD.encode(id_bytes);
        let nonce = URL_SAFE_NO_PAD.encode(nonce_bytes);

        let mut sha = Sha256::new();
        sha.update(format!("{}:{}", challenge_id, nonce).as_bytes());
        let hex_fp = format!("{:X}", sha.finalize());
        let fingerprint = format!("{}-{}-{}", &hex_fp[0..4], &hex_fp[4..8], &hex_fp[8..12]);

        let qr_payload = format!("mashvoice://qr-auth?c={}&n={}", challenge_id, nonce);
        let code = QrCode::with_error_correction_level(qr_payload.as_bytes(), EcLevel::M)
            .map_err(|e| e.to_string())?;
        let svg_xml = code
            .render::<svg::Color>()
            .min_dimensions(240, 240)
            .dark_color(svg::Color("#f5c26b"))
            .light_color(svg::Color("#09090d"))
            .build();
        let qr_data_url = format!(
            "data:image/svg+xml;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(svg_xml.as_bytes())
        );

        let now = unix_ms_now();
        let ch = QrChallenge {
            challenge_id: challenge_id.clone(),
            nonce,
            fingerprint,
            device_name: device_name.to_string(),
            status: "pending".into(),
            created_at: now,
            expires_at: now + self.ttl_ms,
            qr_payload,
            qr_data_url,
        };

        let mut map = self.challenges.lock();
        Self::cleanup_locked(&mut map);
        map.insert(challenge_id, ch.clone());
        Ok(ch)
    }

    pub fn get_latest_pending(&self) -> Option<QrChallenge> {
        let mut map = self.challenges.lock();
        Self::cleanup_locked(&mut map);
        map.values()
            .filter(|c| c.status == "pending" || c.status == "scanned")
            .max_by_key(|c| c.created_at)
            .cloned()
    }

    pub fn inspect(&self, challenge_id: &str, nonce: &str) -> Result<QrChallenge, String> {
        let mut map = self.challenges.lock();
        Self::cleanup_locked(&mut map);
        let ch = map
            .get_mut(challenge_id)
            .ok_or_else(|| "QR Code expiré ou introuvable.".to_string())?;
        if ch.nonce != nonce {
            return Err("Nonce cryptographique QR invalide.".into());
        }
        if ch.status == "approved" {
            return Err("Ce QR Code a déjà été utilisé.".into());
        }
        ch.status = "scanned".into();
        Ok(ch.clone())
    }

    pub fn approve(&self, challenge_id: &str, nonce: &str) -> Result<QrChallenge, String> {
        let mut map = self.challenges.lock();
        Self::cleanup_locked(&mut map);
        let ch = map
            .get_mut(challenge_id)
            .ok_or_else(|| "QR Code expiré ou introuvable.".to_string())?;
        if ch.nonce != nonce {
            return Err("Nonce cryptographique QR invalide.".into());
        }
        if ch.status == "approved" {
            return Err("Déjà autorisé.".into());
        }
        ch.status = "approved".into();
        Ok(ch.clone())
    }
}

pub fn parse_qr_payload(qr_payload: Option<&str>, explicit_c: Option<&str>, explicit_n: Option<&str>) -> Option<(String, String)> {
    if let (Some(c), Some(n)) = (explicit_c, explicit_n) {
        if !c.is_empty() && !n.is_empty() {
            return Some((c.to_string(), n.to_string()));
        }
    }
    let raw = qr_payload?;
    let query_start = raw.find('?')?;
    let query = &raw[query_start + 1..];
    let mut c_val = None;
    let mut n_val = None;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == "c" {
                c_val = Some(v.to_string());
            } else if k == "n" {
                n_val = Some(v.to_string());
            }
        }
    }
    Some((c_val?, n_val?))
}
