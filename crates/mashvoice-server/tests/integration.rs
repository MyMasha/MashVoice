use futures_util::{SinkExt, StreamExt};
use mashvoice_core::updater::PUBLIC_RELEASES_URL;
use mashvoice_server::build_router;
use serde_json::{json, Value};
use std::net::SocketAddr;
use tokio_tungstenite::{connect_async, tungstenite::Message};

async fn spawn_test_server() -> (String, String, std::path::PathBuf) {
    let tmp_dir =
        std::env::temp_dir().join(format!("mashvoice-int-test-{}", uuid::Uuid::new_v4()));
    let (router, st) = build_router(&tmp_dir, None);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    st.set_listen_port(port);

    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });

    (
        format!("http://127.0.0.1:{}", port),
        format!("ws://127.0.0.1:{}/ws", port),
        tmp_dir,
    )
}

#[tokio::test]
async fn zero_trust_token_and_live_ws_revocation() {
    let (base, ws_url, tmp_dir) = spawn_test_server().await;
    let client = reqwest::Client::new();

    // 1. Missing token -> 401
    let res_missing = client
        .post(format!("{}/api/auth/login", base))
        .json(&json!({ "username": "intruder" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res_missing.status().as_u16(), 401);

    // 2. Forged token -> 401
    let res_forged = client
        .post(format!("{}/api/auth/login", base))
        .json(&json!({
            "username": "intruder",
            "connectionToken": "MASH-SV4.eyJ2Ijo0fQ.forged_sig"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res_forged.status().as_u16(), 401);

    // 3. Fetch valid starter token from bootstrap and log in -> 200
    let boot: Value = client
        .get(format!("{}/api/bootstrap/public", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let valid_token = boot["starterTokens"][0]["token"].as_str().unwrap();
    let valid_jti = boot["starterTokens"][0]["jti"].as_str().unwrap();

    let login_res: Value = client
        .post(format!("{}/api/auth/login", base))
        .json(&json!({
            "username": "rawsq",
            "connectionToken": valid_token
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let session_tok = login_res["sessionToken"].as_str().unwrap().to_string();

    // 4. Connect authenticated WebSocket, revoke token, verify live kick + 401
    let (mut ws, _) = connect_async(format!("{}?token={}", ws_url, session_tok))
        .await
        .unwrap();

    let first_msg: Value =
        serde_json::from_str(&ws.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(first_msg["type"], "ws:ready");

    let revoke_resp = client
        .post(format!("{}/api/security/tokens/revoke", base))
        .bearer_auth(&session_tok)
        .json(&json!({ "jti": valid_jti }))
        .send()
        .await
        .unwrap();
    assert_eq!(revoke_resp.status().as_u16(), 200);

    let kicked_msg: Value =
        serde_json::from_str(&ws.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(kicked_msg["type"], "auth:force_disconnect");

    let state_after = client
        .get(format!("{}/api/state", base))
        .bearer_auth(&session_tok)
        .send()
        .await
        .unwrap();
    assert_eq!(state_after.status().as_u16(), 401);

    let _ = std::fs::remove_dir_all(tmp_dir);
}

#[tokio::test]
async fn mobile_qr_scan_authenticates_pc_and_p2p_signaling_works() {
    let (base, ws_url, tmp_dir) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let boot: Value = client
        .get(format!("{}/api/bootstrap/public", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let valid_token = boot["starterTokens"][0]["token"].as_str().unwrap();

    // Mobile logs in
    let mob_login: Value = client
        .post(format!("{}/api/auth/login", base))
        .json(&json!({
            "username": "rawsq",
            "connectionToken": valid_token,
            "deviceType": "mobile-app"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let mob_sess = mob_login["sessionToken"].as_str().unwrap();

    // PC Launcher creates QR Code challenge
    let qr_create: Value = client
        .post(format!("{}/api/auth/qr/create", base))
        .json(&json!({ "deviceName": "PC Gaming Rust" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let cid = qr_create["challengeId"].as_str().unwrap();
    let qr_payload = qr_create["qrPayload"].as_str().unwrap();

    let (mut pc_ws, _) = connect_async(format!("{}?mode=qr&challengeId={}", ws_url, cid))
        .await
        .unwrap();

    // Mobile inspects QR
    let ins_res = client
        .post(format!("{}/api/auth/qr/inspect", base))
        .bearer_auth(mob_sess)
        .json(&json!({ "qrPayload": qr_payload }))
        .send()
        .await
        .unwrap();
    assert_eq!(ins_res.status().as_u16(), 200);

    let scanned_ev: Value =
        serde_json::from_str(&pc_ws.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(scanned_ev["type"], "qr:scanned");

    // Mobile approves PC login
    let app_res = client
        .post(format!("{}/api/auth/qr/approve", base))
        .bearer_auth(mob_sess)
        .json(&json!({
            "qrPayload": qr_payload,
            "mobileConnectionToken": valid_token
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(app_res.status().as_u16(), 200);

    let approved_ev: Value =
        serde_json::from_str(&pc_ws.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(approved_ev["type"], "qr:approved");
    let pc_sess = approved_ev["auth"]["sessionToken"].as_str().unwrap();

    // Verify P2P WebRTC signaling between Mobile and PC
    let (mut ws_a, _) = connect_async(format!("{}?token={}", ws_url, mob_sess))
        .await
        .unwrap();
    let (mut ws_b, _) = connect_async(format!("{}?token={}", ws_url, pc_sess))
        .await
        .unwrap();

    let _ = ws_a.next().await; // ws:ready
    let _ = ws_b.next().await; // ws:ready

    ws_a.send(Message::Text(
        json!({ "type": "p2p:join-room", "roomId": "ch-voice-gaming" })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let _ = ws_a.next().await; // p2p:room-joined
    let _ = ws_a.next().await; // voice:rooms

    ws_b.send(Message::Text(
        json!({ "type": "p2p:join-room", "roomId": "ch-voice-gaming" })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();

    // Find peer-joined on ws_a
    let mut target_pk = String::new();
    while let Some(Ok(frame)) = ws_a.next().await {
        let v: Value = serde_json::from_str(&frame.into_text().unwrap()).unwrap();
        if v["type"] == "p2p:peer-joined" {
            target_pk = v["peer"]["peerKey"].as_str().unwrap().to_string();
            break;
        }
    }
    assert!(!target_pk.is_empty());

    ws_a.send(Message::Text(
        json!({
            "type": "p2p:signal",
            "targetPeerKey": target_pk,
            "roomId": "ch-voice-gaming",
            "signal": { "type": "sdp", "sdp": "v=0-rust-p2p" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    let mut got_signal = false;
    while let Some(Ok(frame)) = ws_b.next().await {
        let v: Value = serde_json::from_str(&frame.into_text().unwrap()).unwrap();
        if v["type"] == "p2p:signal" {
            assert_eq!(v["signal"]["sdp"], "v=0-rust-p2p");
            got_signal = true;
            break;
        }
    }
    assert!(got_signal);

    // Verify Auto-Updater endpoint & Native Rust Hardware Telemetry
    let upd: Value = client
        .get(format!("{}/api/updater/status", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(upd["owner"], "MyMasha");
    assert_eq!(upd["repo"], "MashVoice");
    assert_eq!(upd["publicReleasesUrl"], PUBLIC_RELEASES_URL);
    assert_eq!(upd["openSourceSigned"], true);
    assert!(upd.get("maskedToken").is_none());

    // Verify non-admin (MEMBER) cannot read admin tokens or revoke tokens
    let member_token = boot["starterTokens"][1]["token"].as_str().unwrap();
    let member_login: Value = client
        .post(format!("{}/api/auth/login", base))
        .json(&json!({
            "username": "friend_member",
            "connectionToken": member_token
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let member_sess = member_login["sessionToken"].as_str().unwrap();

    let member_sec: Value = client
        .get(format!("{}/api/security/tokens", base))
        .bearer_auth(member_sess)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(member_sec["isAdmin"], false);
    assert_eq!(member_sec["tokens"].as_array().unwrap().len(), 0);

    let member_revoke = client
        .post(format!("{}/api/security/tokens/revoke", base))
        .bearer_auth(member_sess)
        .json(&json!({ "jti": boot["starterTokens"][0]["jti"] }))
        .send()
        .await
        .unwrap();
    assert_eq!(member_revoke.status().as_u16(), 403);

    let telem: Value = client
        .get(format!("{}/api/hardware/telemetry", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(telem["rssMb"].as_u64().unwrap() > 0);

    let _ = std::fs::remove_dir_all(tmp_dir);
}

#[test]
fn tauri_gui_main_thread_setup_never_panics_outside_tokio() {
    let join = std::thread::spawn(|| {
        let tmp = std::env::temp_dir().join(format!("mashvoice-gui-test-{}", uuid::Uuid::new_v4()));
        let (_router, state) = build_router(&tmp, None);
        let specs = state.hardware.host_specs();
        assert!(specs.cpu_cores >= 1);
        let _ = std::fs::remove_dir_all(&tmp);
    });
    join.join()
        .expect("build_router on non-Tokio GUI thread must never panic");
}

#[tokio::test]
async fn global_p2p_peer_sync_and_friend_input_validation() {
    let (base, _ws_url, tmp_dir) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let boot: Value = client
        .get(format!("{}/api/bootstrap/public", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let valid_token = boot["starterTokens"][0]["token"].as_str().unwrap();

    let login_res: Value = client
        .post(format!("{}/api/auth/login", base))
        .json(&json!({
            "username": "rawsq",
            "connectionToken": valid_token
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let session_tok = login_res["sessionToken"].as_str().unwrap();

    // Reject accidental token or IP paste in Add Friend
    let bad_tok = client
        .post(format!("{}/api/friends/add", base))
        .bearer_auth(session_tok)
        .json(&json!({ "query": valid_token }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_tok.status().as_u16(), 400);

    let bad_ip = client
        .post(format!("{}/api/friends/add", base))
        .bearer_auth(session_tok)
        .json(&json!({ "query": "127.0.0.1:3080" }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad_ip.status().as_u16(), 400);

    // Sync remote friend v0dka across P2P mesh
    let sync_res: Value = client
        .post(format!("{}/api/p2p/sync-peer", base))
        .bearer_auth(session_tok)
        .json(&json!({
            "peer": {
                "id": "usr-v0dka99",
                "username": "v0dka",
                "displayName": "v0dka",
                "tag": "4921",
                "peerId": "p2p-mash-v0dka-d93b",
                "avatarColor": "#5ec2a6",
                "status": "online",
                "customStatus": "Connecté en P2P Rust",
                "activity": null,
                "createdAt": "2026-11-14T16:00:00Z"
            }
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(sync_res["ok"], true);
    let dm_id = sync_res["dmChannelId"].as_str().unwrap().to_string();
    assert_eq!(dm_id, "dm:usr-rawsq:usr-v0dka99");

    // Sync incoming encrypted DM from v0dka
    let msg_res: Value = client
        .post(format!("{}/api/p2p/sync-message", base))
        .bearer_auth(session_tok)
        .json(&json!({
            "channelId": dm_id,
            "message": {
                "id": "msg-remote-1",
                "channelId": dm_id,
                "authorId": "usr-v0dka99",
                "content": "Salut rawsq ! P2P Internet OK",
                "attachment": null,
                "replyTo": null,
                "createdAt": "2026-11-14T16:01:00Z",
                "pinned": false,
                "p2pVerified": true,
                "reactions": {}
            }
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(msg_res["inserted"], true);

    // Delete friend
    let del_res = client
        .delete(format!("{}/api/friends/usr-v0dka99", base))
        .bearer_auth(session_tok)
        .send()
        .await
        .unwrap();
    assert_eq!(del_res.status().as_u16(), 200);

    let _ = std::fs::remove_dir_all(tmp_dir);
}

#[tokio::test]
async fn direct_ip_p2p_friend_request_accept_and_dm_between_two_pcs() {
    let (base_a, ws_url_a, tmp_a) = spawn_test_server().await;
    let (base_b, ws_url_b, tmp_b) = spawn_test_server().await;
    let port_a: u16 = base_a.rsplit(':').next().unwrap().parse().unwrap();
    let port_b: u16 = base_b.rsplit(':').next().unwrap().parse().unwrap();

    let client = reqwest::Client::new();

    // Log in rawsq on PC A
    let boot_a: Value = client
        .get(format!("{}/api/bootstrap/public", base_a))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let tok_a = boot_a["starterTokens"][0]["token"].as_str().unwrap();
    let login_a: Value = client
        .post(format!("{}/api/auth/login", base_a))
        .json(&json!({ "username": "rawsq", "connectionToken": tok_a }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let sess_a = login_a["sessionToken"].as_str().unwrap().to_string();
    let user_a = login_a["user"].clone();

    // Log in v0dka on PC B
    let boot_b: Value = client
        .get(format!("{}/api/bootstrap/public", base_b))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let tok_b = boot_b["starterTokens"][0]["token"].as_str().unwrap();
    let login_b: Value = client
        .post(format!("{}/api/auth/login", base_b))
        .json(&json!({ "username": "v0dka", "connectionToken": tok_b }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let sess_b = login_b["sessionToken"].as_str().unwrap().to_string();
    let user_b = login_b["user"].clone();

    // Connect UI WebSockets on both PC A and PC B
    let (mut ws_a, _) = connect_async(format!("{}?token={}", ws_url_a, sess_a))
        .await
        .unwrap();
    let (mut ws_b, _) = connect_async(format!("{}?token={}", ws_url_b, sess_b))
        .await
        .unwrap();
    let _ = ws_a.next().await; // ws:ready
    let _ = ws_b.next().await; // ws:ready

    // Self-connection guard: typing bare 127.0.0.1 or own port must return 400
    let self_err = client
        .post(format!("{}/api/p2p/connect-ip", base_a))
        .bearer_auth(&sess_a)
        .json(&json!({ "address": "127.0.0.1" }))
        .send()
        .await
        .unwrap();
    assert_eq!(self_err.status().as_u16(), 400);

    let self_port_err = client
        .post(format!("{}/api/p2p/connect-ip", base_a))
        .bearer_auth(&sess_a)
        .json(&json!({ "address": format!("127.0.0.1:{}", port_a) }))
        .send()
        .await
        .unwrap();
    assert_eq!(self_port_err.status().as_u16(), 400);

    // PC A (rawsq) adds PC B (v0dka) directly by IP:port!
    let connect_res = client
        .post(format!("{}/api/p2p/connect-ip", base_a))
        .bearer_auth(&sess_a)
        .json(&json!({ "address": format!("127.0.0.1:{}", port_b) }))
        .send()
        .await
        .unwrap();
    assert_eq!(connect_res.status().as_u16(), 200);

    // Verify PC B (v0dka) receives p2p:direct_event -> friend:request from rawsq
    let mut got_req = false;
    for _ in 0..8 {
        let frame = tokio::time::timeout(std::time::Duration::from_secs(3), ws_b.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let ev: Value = serde_json::from_str(&frame.into_text().unwrap()).unwrap();
        if ev["type"] == "p2p:direct_event" && ev["data"]["type"] == "friend:request" {
            assert_eq!(ev["data"]["from"]["username"], "rawsq");
            got_req = true;
            break;
        }
    }
    assert!(got_req, "PC B must receive friend:request over Direct IP tunnel");

    // PC B (v0dka) accepts friend request & sends a DM back over the SAME open tunnel!
    let accept_send: Value = client
        .post(format!("{}/api/p2p/tunnel-send", base_b))
        .bearer_auth(&sess_b)
        .json(&json!({
            "targetPeerId": user_a["peerId"],
            "payload": {
                "type": "friend:accept",
                "from": user_b
            }
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(accept_send["ok"], true);
    assert!(accept_send["deliveredTunnels"].as_u64().unwrap() >= 1);

    let dm_send: Value = client
        .post(format!("{}/api/p2p/tunnel-send", base_b))
        .bearer_auth(&sess_b)
        .json(&json!({
            "targetPeerId": user_a["peerId"],
            "payload": {
                "type": "dm:message",
                "from": user_b,
                "message": {
                    "id": "msg-ip-direct-1",
                    "authorId": user_b["id"],
                    "content": "Yo rawsq ! Connecté direct par IP !",
                    "createdAt": "2026-11-14T18:00:00Z"
                }
            }
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(dm_send["ok"], true);

    // Verify PC A (rawsq) receives both friend:accept and dm:message from v0dka!
    let mut got_accept = false;
    let mut got_dm = false;
    for _ in 0..10 {
        let frame = tokio::time::timeout(std::time::Duration::from_secs(3), ws_a.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let ev: Value = serde_json::from_str(&frame.into_text().unwrap()).unwrap();
        if ev["type"] == "p2p:direct_event" {
            if ev["data"]["type"] == "friend:accept" {
                assert_eq!(ev["data"]["from"]["username"], "v0dka");
                got_accept = true;
            } else if ev["data"]["type"] == "dm:message" {
                assert_eq!(
                    ev["data"]["message"]["content"],
                    "Yo rawsq ! Connecté direct par IP !"
                );
                got_dm = true;
            }
        }
        if got_accept && got_dm {
            break;
        }
    }
    assert!(got_accept, "PC A must receive friend:accept over Direct IP tunnel");
    assert!(got_dm, "PC A must receive dm:message over Direct IP tunnel");

    let _ = std::fs::remove_dir_all(tmp_a);
    let _ = std::fs::remove_dir_all(tmp_b);
}

