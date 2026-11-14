pub mod hardware;
pub mod security;
pub mod store;
pub mod updater;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn mandatory_token_hmac_and_revocation_work() {
        let tmp = std::env::temp_dir().join(format!("mashvoice-test-{}", uuid::Uuid::new_v4()));
        let sec = security::SecurityEngine::new(&tmp);

        let minted = sec.mint_connection_token(None, "Ami Test", "MEMBER", 365, None);
        assert!(minted.token.starts_with("MASH-SV4."));

        let empty_revoked = HashSet::new();
        let verified = sec
            .verify_connection_token(&minted.token, &empty_revoked)
            .expect("valid token should pass");
        assert_eq!(verified.lbl, "Ami Test");

        // Tampered token must fail
        let tampered = format!("{}x", minted.token);
        assert!(sec
            .verify_connection_token(&tampered, &empty_revoked)
            .is_err());

        // Revoked token must fail both token check and session check
        let mut revoked = HashSet::new();
        revoked.insert(verified.jti.clone());
        assert!(sec
            .verify_connection_token(&minted.token, &revoked)
            .is_err());

        let (sess_jwt, _) = sec.mint_session_jwt(
            "usr-1",
            "rawsq",
            "desktop",
            "PC",
            &verified.jti,
            "FOUNDER",
        );
        assert!(sec.verify_session_jwt(&sess_jwt, &empty_revoked).is_ok());
        assert!(sec.verify_session_jwt(&sess_jwt, &revoked).is_err());

        // AES-256-GCM Vault roundtrip
        sec.write_encrypted_vault(serde_json::json!({ "connectionToken": minted.token }))
            .expect("vault write");
        let loaded = sec.read_encrypted_vault();
        assert_eq!(loaded["connectionToken"], minted.token);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn qr_challenge_and_prefilled_github_url_work() {
        let qr = security::QrChallengeManager::new(120_000);
        let ch = qr.create("MashVoice Rust Desktop").expect("QR generation");
        assert!(ch.qr_data_url.starts_with("data:image/svg+xml;base64,"));

        let (cid, nonce) =
            security::parse_qr_payload(Some(&ch.qr_payload), None, None).expect("parse QR");
        assert!(qr.inspect(&cid, &nonce).is_ok());
        assert!(qr.approve(&cid, &nonce).is_ok());
        // Replay must be rejected
        assert!(qr.approve(&cid, &nonce).is_err());

        assert!(updater::PREFILLED_GITHUB_TOKEN_URL.contains("target_name=MyMasha"));
        assert!(updater::PREFILLED_GITHUB_TOKEN_URL.contains("expires_in=365"));
        assert!(updater::PREFILLED_GITHUB_TOKEN_URL.contains("contents=read"));
    }
}
