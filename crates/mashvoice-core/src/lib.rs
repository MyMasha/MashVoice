pub mod hardware;
pub mod relay;
pub mod security;
pub mod store;
pub mod updater;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn mandatory_token_hmac_vault_and_secret_permissions_work() {
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

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let meta = std::fs::metadata(tmp.join("master.secret")).expect("master.secret exists");
            assert_eq!(meta.permissions().mode() & 0o777, 0o600);
        }

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn qr_challenge_updater_and_zyntra_relay_envelopes_work() {
        let qr = security::QrChallengeManager::new(120_000);
        let ch = qr.create("MashVoice Rust Desktop").expect("QR generation");
        assert!(ch.qr_data_url.starts_with("data:image/svg+xml;base64,"));

        let (cid, nonce) =
            security::parse_qr_payload(Some(&ch.qr_payload), None, None).expect("parse QR");
        assert!(qr.inspect(&cid, &nonce).is_ok());
        assert!(qr.approve(&cid, &nonce).is_ok());
        // Replay must be rejected
        assert!(qr.approve(&cid, &nonce).is_err());

        assert_eq!(
            updater::PUBLIC_RELEASES_URL,
            "https://github.com/MyMasha/MashVoice/releases/latest"
        );
        assert_eq!(updater::ED25519_UPDATER_KEY_ID, "F6A9F0FBF91D7ADE");

        // Zyntra mv-relay-v1 key normalization & dynamic AES-256-GCM envelope roundtrip
        assert_eq!(relay::norm_relay_key("@V0dka#4921"), "v0dka-tag-4921");
        let payload = serde_json::json!({ "type": "friend:request", "from": "rawsq" });
        let env = relay::encrypt_relay_envelope(&payload, "ecdh-ephemeral-secret-xyz")
            .expect("encrypt mv4e1");
        assert!(env.starts_with("mv4e1."));
        assert!(relay::decrypt_relay_envelope(&env, "wrong-secret").is_none());
        let dec =
            relay::decrypt_relay_envelope(&env, "ecdh-ephemeral-secret-xyz").expect("decrypt");
        assert_eq!(dec["from"], "rawsq");
    }
}
