use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        ConnectInfo, Path as AxumPath, Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use mashvoice_core::{
    hardware::HardwareController,
    security::{
        parse_qr_payload, LoginRateLimiter, QrChallengeManager, SecurityEngine, SessionPayload,
    },
    store::{MashStore, UserProfile},
    updater::{UpdaterService, CURRENT_VERSION, GITHUB_ORG, GITHUB_REPO, PREFILLED_GITHUB_TOKEN_URL},
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::mpsc;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomPeerState {
    pub peer_key: String,
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub avatar_color: String,
    pub device_type: String,
    pub muted: bool,
    pub deafened: bool,
    pub camera_on: bool,
    pub screen_on: bool,
    pub stream_spec: String,
    pub encoder: String,
    pub speaking: bool,
}

#[derive(Clone)]
struct ConnectedClient {
    peer_key: String,
    user_id: String,
    username: String,
    device_type: String,
    device_name: String,
    token_jti: String,
    connected_at: String,
    tx: mpsc::UnboundedSender<String>,
}

pub struct AppState {
    pub security: SecurityEngine,
    pub store: MashStore,
    pub hardware: HardwareController,
    pub updater: UpdaterService,
    pub rate_limiter: LoginRateLimiter,
    pub qr_manager: QrChallengeManager,
    clients: RwLock<HashMap<String, ConnectedClient>>,
    qr_watchers: RwLock<HashMap<String, Vec<mpsc::UnboundedSender<String>>>>,
    voice_rooms: RwLock<HashMap<String, HashMap<String, RoomPeerState>>>,
    raw_tokens_by_jti: RwLock<HashMap<String, String>>,
}

impl AppState {
    pub fn new(data_dir: &Path) -> Arc<Self> {
        let security = SecurityEngine::new(data_dir);
        let store = MashStore::new(data_dir, &security);
        let hardware = HardwareController::new(data_dir);
        let updater = UpdaterService::new(data_dir);

        let mut raw_map = HashMap::new();
        for tok in &store.state.read().issued_tokens {
            if !tok.revoked {
                if let Some(raw) = &tok.token_value {
                    raw_map.insert(tok.jti.clone(), raw.clone());
                }
            }
        }

        let state = Arc::new(Self {
            security,
            store,
            hardware,
            updater,
            rate_limiter: LoginRateLimiter::new(10, 60_000),
            qr_manager: QrChallengeManager::new(120_000),
            clients: RwLock::new(HashMap::new()),
            qr_watchers: RwLock::new(HashMap::new()),
            voice_rooms: RwLock::new(HashMap::new()),
            raw_tokens_by_jti: RwLock::new(raw_map),
        });

        if tokio::runtime::Handle::try_current().is_ok() {
            state.spawn_revocation_watchdog();
        }

        state
    }

    pub fn spawn_revocation_watchdog(self: &Arc<Self>) {
        let bg = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(15));
            loop {
                interval.tick().await;
                let revoked = bg.store.revoked_set();
                let mut to_kick = Vec::new();
                for c in bg.clients.read().values() {
                    if revoked.contains(&c.token_jti) {
                        to_kick.push(c.token_jti.clone());
                    }
                }
                for jti in to_kick {
                    bg.force_disconnect_by_jti(
                        &jti,
                        "Session verrouillée : Token de connexion obligatoire révoqué.",
                    );
                }
            }
        });
    }

    fn broadcast_all(&self, payload: &Value, exclude_peer: Option<&str>) {
        let raw = payload.to_string();
        let clients = self.clients.read();
        for (pk, c) in clients.iter() {
            if exclude_peer == Some(pk.as_str()) {
                continue;
            }
            let _ = c.tx.send(raw.clone());
        }
    }

    fn send_to_peer(&self, peer_key: &str, payload: &Value) {
        if let Some(c) = self.clients.read().get(peer_key) {
            let _ = c.tx.send(payload.to_string());
        }
    }

    fn serialize_voice_rooms(&self) -> Value {
        let rooms = self.voice_rooms.read();
        let mut map = serde_json::Map::new();
        for (room_id, peers) in rooms.iter() {
            let list: Vec<RoomPeerState> = peers.values().cloned().collect();
            map.insert(room_id.clone(), serde_json::to_value(list).unwrap_or_default());
        }
        Value::Object(map)
    }

    fn remove_peer_from_rooms(&self, peer_key: &str) {
        let mut changed = false;
        let mut notify_peers: Vec<(String, String)> = Vec::new();

        {
            let mut rooms = self.voice_rooms.write();
            rooms.retain(|room_id, peers| {
                if peers.remove(peer_key).is_some() {
                    changed = true;
                    for remaining_pk in peers.keys() {
                        notify_peers.push((remaining_pk.clone(), room_id.clone()));
                    }
                }
                !peers.is_empty()
            });
        }

        for (target_pk, room_id) in notify_peers {
            self.send_to_peer(
                &target_pk,
                &json!({
                    "type": "p2p:peer-left",
                    "roomId": room_id,
                    "peerKey": peer_key,
                }),
            );
        }

        if changed {
            let snapshot = self.serialize_voice_rooms();
            self.broadcast_all(&json!({ "type": "voice:rooms", "rooms": snapshot }), None);
        }
    }

    pub fn force_disconnect_by_jti(&self, jti: &str, reason: &str) {
        let mut target_keys = Vec::new();
        {
            let clients = self.clients.read();
            for (pk, c) in clients.iter() {
                if c.token_jti == jti {
                    let _ = c.tx.send(
                        json!({
                            "type": "auth:force_disconnect",
                            "reason": reason,
                        })
                        .to_string(),
                    );
                    target_keys.push(pk.clone());
                }
            }
        }
        for pk in target_keys {
            self.remove_peer_from_rooms(&pk);
            self.clients.write().remove(&pk);
        }
    }

    fn extract_auth(
        &self,
        headers: &HeaderMap,
    ) -> Result<(SessionPayload, UserProfile), (StatusCode, Json<Value>)> {
        let raw_hdr = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let token = raw_hdr.strip_prefix("Bearer ").unwrap_or("").trim();
        let sess = self
            .security
            .verify_session_jwt(token, &self.store.revoked_set())
            .map_err(|reason| {
                (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({ "error": reason, "code": "TOKEN_REQUIRED_OR_REVOKED" })),
                )
            })?;

        let user = self.store.get_user_by_id(&sess.uid).ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Utilisateur introuvable.", "code": "USER_NOT_FOUND" })),
            )
        })?;

        Ok((sess, user))
    }
}

pub fn build_router(data_dir: &Path, dist_dir: Option<PathBuf>) -> (Router, Arc<AppState>) {
    let state = AppState::new(data_dir);

    let api = Router::new()
        .route("/bootstrap/public", get(api_bootstrap_public))
        .route("/auth/login", post(api_auth_login))
        .route("/auth/verify", post(api_auth_verify))
        .route("/auth/qr/create", post(api_qr_create))
        .route("/auth/qr/pending", get(api_qr_pending))
        .route("/auth/qr/inspect", post(api_qr_inspect))
        .route("/auth/qr/approve", post(api_qr_approve))
        .route("/security/tokens", get(api_security_tokens))
        .route("/security/tokens/mint", post(api_security_mint))
        .route("/security/tokens/revoke", post(api_security_revoke))
        .route("/updater/status", get(api_updater_status))
        .route("/updater/config", post(api_updater_config))
        .route("/updater/check", post(api_updater_check))
        .route("/hardware/telemetry", get(api_hardware_telemetry))
        .route("/hardware/config", post(api_hardware_config))
        .route("/state", get(api_workspace_state))
        .route("/profile", patch(api_profile_update))
        .route("/friends/add", post(api_friends_add))
        .route("/messages/:channel_id", get(api_messages_get).post(api_messages_post))
        .route("/messages/:channel_id/:message_id/react", post(api_messages_react))
        .route("/servers", post(api_servers_create))
        .route("/servers/join", post(api_servers_join))
        .route("/servers/:server_id/channels", post(api_channels_create))
        .route("/servers/:server_id/roles", post(api_roles_create))
        .route(
            "/servers/:server_id/members/:target_user_id/roles",
            post(api_member_role_toggle),
        );

    let mut router = Router::new()
        .nest("/api", api)
        .route("/ws", get(ws_upgrade_handler))
        .layer(CorsLayer::permissive())
        .with_state(Arc::clone(&state));

    if let Some(dist) = dist_dir {
        let index_html = dist.join("index.html");
        if index_html.exists() {
            let serve_dir = ServeDir::new(&dist).not_found_service(ServeFile::new(index_html));
            router = router.fallback_service(serve_dir);
        }
    }

    (router, state)
}

// --- HANDLERS ---

fn detect_lan_ip() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("1.1.1.1:80")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into())
}

async fn api_bootstrap_public(
    State(st): State<Arc<AppState>>,
    addr: Option<ConnectInfo<SocketAddr>>,
) -> Json<Value> {
    let is_local_owner = addr.map(|a| a.0.ip().is_loopback()).unwrap_or(true);
    let hide = !is_local_owner
        || std::env::var("MASHVOICE_HIDE_STARTER_TOKENS").unwrap_or_default() == "true";
    let starter: Vec<Value> = st
        .store
        .state
        .read()
        .issued_tokens
        .iter()
        .filter(|t| !t.revoked)
        .take(2)
        .map(|t| {
            json!({
                "jti": t.jti,
                "label": t.label,
                "tier": t.tier,
                "token": if hide { Value::Null } else { json!(t.token_value) },
            })
        })
        .collect();

    Json(json!({
        "name": "MashVoice",
        "edition": "SINGULARITY 4.1 • RUST ENGINE",
        "version": CURRENT_VERSION,
        "securityMode": "ZERO_TRUST_MANDATORY_TOKEN",
        "githubRepo": format!("{}/{}", GITHUB_ORG, GITHUB_REPO),
        "prefilledGithubTokenUrl": PREFILLED_GITHUB_TOKEN_URL,
        "hostSpecs": st.hardware.host_specs(),
        "lanIp": detect_lan_ip(),
        "starterTokens": starter,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginReq {
    connection_token: Option<String>,
    username: Option<String>,
    display_name: Option<String>,
    device_type: Option<String>,
    device_name: Option<String>,
}

async fn api_auth_login(
    State(st): State<Arc<AppState>>,
    addr: Option<ConnectInfo<SocketAddr>>,
    Json(body): Json<LoginReq>,
) -> Response {
    let ip_key = addr
        .map(|a| a.0.ip().to_string())
        .unwrap_or_else(|| "local".into());

    if let Err(retry_sec) = st.rate_limiter.check(&ip_key) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "error": format!("Protection anti-bruteforce Rust activée. Réessayez dans {}s.", retry_sec),
                "code": "RATE_LIMITED"
            })),
        )
            .into_response();
    }

    let raw_tok = body.connection_token.unwrap_or_default();
    let verified = match st
        .security
        .verify_connection_token(&raw_tok, &st.store.revoked_set())
    {
        Ok(p) => p,
        Err(reason) => {
            st.rate_limiter.record_failure(&ip_key);
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": reason, "code": "INVALID_CONNECTION_TOKEN" })),
            )
                .into_response();
        }
    };

    if let (Some(bound), Some(req_usr)) = (&verified.usr, &body.username) {
        if !bound.eq_ignore_ascii_case(req_usr.trim()) {
            st.rate_limiter.record_failure(&ip_key);
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "error": format!("Ce token est lié exclusivement au compte '{}'.", bound),
                    "code": "TOKEN_USER_MISMATCH"
                })),
            )
                .into_response();
        }
    }

    st.rate_limiter.reset(&ip_key);
    let chosen_usr = verified
        .usr
        .as_deref()
        .or(body.username.as_deref())
        .unwrap_or("rawsq");
    let user = st
        .store
        .find_or_create_user(chosen_usr, body.display_name.as_deref());

    st.raw_tokens_by_jti
        .write()
        .insert(verified.jti.clone(), raw_tok.trim().to_string());

    let (session_token, session) = st.security.mint_session_jwt(
        &user.id,
        &user.username,
        body.device_type.as_deref().unwrap_or("desktop"),
        body.device_name.as_deref().unwrap_or("MashVoice Rust Client"),
        &verified.jti,
        &verified.tier,
    );

    Json(json!({
        "ok": true,
        "sessionToken": session_token,
        "user": user,
        "tokenInfo": {
            "jti": verified.jti,
            "label": verified.lbl,
            "tier": verified.tier,
            "expiresAt": chrono::DateTime::from_timestamp(verified.exp as i64, 0)
                .map(|d| d.to_rfc3339())
                .unwrap_or_default(),
        },
        "session": session,
    }))
    .into_response()
}

async fn api_auth_verify(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (session, user) = st.extract_auth(&headers)?;
    Ok(Json(json!({
        "ok": true,
        "user": user,
        "session": session,
    })))
}

async fn api_qr_create(
    State(st): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> Response {
    let dev_name = body["deviceName"]
        .as_str()
        .unwrap_or("MashVoice PC (Moteur Rust)");
    match st.qr_manager.create(dev_name) {
        Ok(ch) => Json(json!({
            "ok": true,
            "challengeId": ch.challenge_id,
            "fingerprint": ch.fingerprint,
            "qrPayload": ch.qr_payload,
            "qrDataUrl": ch.qr_data_url,
            "expiresAt": ch.expires_at,
        }))
        .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response(),
    }
}

async fn api_qr_pending(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _ = st.extract_auth(&headers)?;
    if let Some(ch) = st.qr_manager.get_latest_pending() {
        Ok(Json(json!({
            "pending": {
                "challengeId": ch.challenge_id,
                "fingerprint": ch.fingerprint,
                "deviceName": ch.device_name,
                "qrPayload": ch.qr_payload,
                "expiresAt": ch.expires_at,
            }
        })))
    } else {
        Ok(Json(json!({ "pending": Value::Null })))
    }
}

async fn api_qr_inspect(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let (_sess, user) = st.extract_auth(&headers)?;
    let Some((cid, nonce)) = parse_qr_payload(
        body["qrPayload"].as_str(),
        body["challengeId"].as_str(),
        body["nonce"].as_str(),
    ) else {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "QR Code invalide." })),
        )
            .into_response());
    };

    let ch = match st.qr_manager.inspect(&cid, &nonce) {
        Ok(c) => c,
        Err(e) => return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response()),
    };

    if let Some(watchers) = st.qr_watchers.read().get(&cid) {
        let msg = json!({
            "type": "qr:scanned",
            "challengeId": cid,
            "scannedBy": {
                "username": user.username,
                "displayName": user.display_name,
                "avatarColor": user.avatar_color,
            }
        })
        .to_string();
        for tx in watchers {
            let _ = tx.send(msg.clone());
        }
    }

    Ok(Json(json!({
        "ok": true,
        "challenge": {
            "challengeId": ch.challenge_id,
            "fingerprint": ch.fingerprint,
            "deviceName": ch.device_name,
            "expiresAt": ch.expires_at,
        }
    }))
    .into_response())
}

async fn api_qr_approve(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let (sess, user) = st.extract_auth(&headers)?;
    let Some((cid, nonce)) = parse_qr_payload(
        body["qrPayload"].as_str(),
        body["challengeId"].as_str(),
        body["nonce"].as_str(),
    ) else {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "QR Code invalide." })),
        )
            .into_response());
    };

    let raw_conn = body["mobileConnectionToken"]
        .as_str()
        .map(|s| s.to_string())
        .or_else(|| st.raw_tokens_by_jti.read().get(&sess.jti).cloned());

    if let Some(ref raw) = raw_conn {
        if let Err(reason) = st.security.verify_connection_token(raw, &st.store.revoked_set()) {
            return Ok((StatusCode::UNAUTHORIZED, Json(json!({ "error": reason }))).into_response());
        }
    }

    let ch = match st.qr_manager.approve(&cid, &nonce) {
        Ok(c) => c,
        Err(e) => return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response()),
    };

    let (pc_session_tok, pc_session) = st.security.mint_session_jwt(
        &user.id,
        &user.username,
        "desktop-qr",
        "PC Authentifié via QR Mobile",
        &sess.jti,
        &sess.tier,
    );

    let auth_bundle = json!({
        "sessionToken": pc_session_tok,
        "connectionToken": raw_conn,
        "user": user,
        "tokenInfo": {
            "jti": sess.jti,
            "label": "Synchronisé via Mobile QR",
            "tier": sess.tier,
        },
        "session": pc_session,
    });

    if let Some(watchers) = st.qr_watchers.write().remove(&cid) {
        let msg = json!({
            "type": "qr:approved",
            "challengeId": cid,
            "auth": auth_bundle,
        })
        .to_string();
        for tx in watchers {
            let _ = tx.send(msg.clone());
        }
    }

    Ok(Json(json!({
        "ok": true,
        "approvedDevice": ch.device_name,
    }))
    .into_response())
}

async fn api_security_tokens(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (sess, _user) = st.extract_auth(&headers)?;
    let active_sessions: Vec<Value> = st
        .clients
        .read()
        .values()
        .map(|c| {
            json!({
                "peerKey": c.peer_key,
                "userId": c.user_id,
                "username": c.username,
                "deviceType": c.device_type,
                "deviceName": c.device_name,
                "tokenJti": c.token_jti,
                "connectedAt": c.connected_at,
            })
        })
        .collect();

    let tokens = st.store.state.read().issued_tokens.clone();
    Ok(Json(json!({
        "currentTokenJti": sess.jti,
        "currentTier": sess.tier,
        "tokens": tokens,
        "activeSessions": active_sessions,
    })))
}

async fn api_security_mint(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (sess, user) = st.extract_auth(&headers)?;
    let label = body["label"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Invitation de {}", user.username));
    let days = body["days"].as_u64().unwrap_or(365).clamp(1, 366);
    let tier = if sess.tier == "FOUNDER" {
        body["tier"].as_str().unwrap_or("MEMBER")
    } else {
        "MEMBER"
    };
    let bound_usr = body["boundUsername"]
        .as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let minted = st
        .security
        .mint_connection_token(None, &label, tier, days, bound_usr);
    st.raw_tokens_by_jti
        .write()
        .insert(minted.payload.jti.clone(), minted.token.clone());
    let rec = st.store.register_issued_token(&minted);

    Ok(Json(json!({
        "ok": true,
        "token": minted.token,
        "record": rec,
    })))
}

async fn api_security_revoke(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let _ = st.extract_auth(&headers)?;
    let Some(jti) = body["jti"].as_str() else {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": "JTI requis." }))).into_response());
    };
    let rec = st.store.revoke_token(jti);
    st.raw_tokens_by_jti.write().remove(jti);
    st.force_disconnect_by_jti(
        jti,
        "Accès verrouillé : votre Token de Connexion obligatoire a été révoqué.",
    );
    Ok(Json(json!({ "ok": true, "revokedJti": jti, "record": rec })).into_response())
}

async fn api_updater_status(State(st): State<Arc<AppState>>) -> Json<Value> {
    Json(serde_json::to_value(st.updater.get_sanitized()).unwrap_or_default())
}

async fn api_updater_config(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _ = st.extract_auth(&headers)?;
    st.updater.update_settings(
        body["readOnlyToken"].as_str().map(|s| s.to_string()),
        body["autoCheck"].as_bool(),
        body["autoDownload"].as_bool(),
        body["channel"].as_str().map(|s| s.to_string()),
    );
    let status = st.updater.check_github_updates().await;
    Ok(Json(json!({
        "ok": true,
        "config": st.updater.get_sanitized(),
        "status": status,
    })))
}

async fn api_updater_check(State(st): State<Arc<AppState>>) -> Json<Value> {
    let status = st.updater.check_github_updates().await;
    Json(json!({
        "ok": true,
        "config": st.updater.get_sanitized(),
        "status": status,
    }))
}

async fn api_hardware_telemetry(State(st): State<Arc<AppState>>) -> Json<Value> {
    Json(serde_json::to_value(st.hardware.sample_telemetry()).unwrap_or_default())
}

async fn api_hardware_config(
    State(st): State<Arc<AppState>>,
    Json(patch): Json<Value>,
) -> Json<Value> {
    let updated = st.hardware.update_config(patch);
    Json(json!({
        "ok": true,
        "config": updated,
        "telemetry": st.hardware.sample_telemetry(),
    }))
}

async fn api_workspace_state(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (_sess, me) = st.extract_auth(&headers)?;
    let servers = st.store.get_servers_for_user(&me.id);
    let friends = st.store.get_friends_for_user(&me.id);
    let dm_channels: Vec<Value> = friends
        .iter()
        .map(|f| {
            json!({
                "id": MashStore::dm_channel_id(&me.id, &f.id),
                "peer": f,
            })
        })
        .collect();
    let users = st.store.state.read().users.clone();

    Ok(Json(json!({
        "me": me,
        "lanIp": detect_lan_ip(),
        "users": users,
        "friends": friends,
        "dmChannels": dm_channels,
        "servers": servers,
        "voiceRooms": st.serialize_voice_rooms(),
        "updater": st.updater.get_sanitized(),
        "telemetry": st.hardware.sample_telemetry(),
    })))
}

async fn api_profile_update(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (_sess, me) = st.extract_auth(&headers)?;
    let mut updated_user = me.clone();
    {
        let mut guard = st.store.state.write();
        if let Some(u) = guard.users.iter_mut().find(|x| x.id == me.id) {
            if let Some(dn) = body["displayName"].as_str() {
                if !dn.trim().is_empty() {
                    u.display_name = dn.trim().chars().take(32).collect();
                }
            }
            if let Some(status) = body["status"].as_str() {
                if ["online", "idle", "dnd", "invisible"].contains(&status) {
                    u.status = status.to_string();
                }
            }
            if let Some(cs) = body["customStatus"].as_str() {
                u.custom_status = cs.chars().take(80).collect();
            }
            updated_user = u.clone();
        }
    }
    st.store.save();
    st.broadcast_all(&json!({ "type": "user:updated", "user": updated_user }), None);
    Ok(Json(json!({ "ok": true, "user": updated_user })))
}

async fn api_friends_add(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let (_sess, me) = st.extract_auth(&headers)?;
    let q = body["query"].as_str().unwrap_or("").trim();
    if q.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Entrez un pseudo ou un Peer ID P2P." })),
        )
            .into_response());
    }

    let found = {
        let guard = st.store.state.read();
        guard
            .users
            .iter()
            .find(|u| {
                u.username.eq_ignore_ascii_case(q)
                    || u.peer_id.eq_ignore_ascii_case(q)
                    || format!("{}#{}", u.username, u.tag).eq_ignore_ascii_case(q)
            })
            .cloned()
    };

    let target = found.unwrap_or_else(|| st.store.find_or_create_user(q, Some(q)));
    if target.id == me.id {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Vous ne pouvez pas vous ajouter vous-même." })),
        )
            .into_response());
    }

    st.store.add_friendship(&me.id, &target.id);
    let dm_id = MashStore::dm_channel_id(&me.id, &target.id);
    st.broadcast_all(
        &json!({ "type": "friendship:added", "users": [me.id, target.id], "peer": target }),
        None,
    );

    Ok(Json(json!({ "ok": true, "friend": target, "dmChannelId": dm_id })).into_response())
}

async fn api_messages_get(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(channel_id): AxumPath<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _ = st.extract_auth(&headers)?;
    let list = st
        .store
        .state
        .read()
        .messages
        .get(&channel_id)
        .cloned()
        .unwrap_or_default();
    Ok(Json(json!({ "channelId": channel_id, "messages": list })))
}

async fn api_messages_post(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(channel_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let (_sess, me) = st.extract_auth(&headers)?;
    let content = body["content"].as_str().unwrap_or("");
    let attachment = if body["attachment"].is_null() {
        None
    } else {
        Some(body["attachment"].clone())
    };
    if content.trim().is_empty() && attachment.is_none() {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": "Message vide." }))).into_response());
    }
    let reply_to = body["replyTo"].as_str().map(|s| s.to_string());
    let msg = st
        .store
        .add_message(&channel_id, &me.id, content, attachment, reply_to);

    st.broadcast_all(
        &json!({ "type": "chat:message", "channelId": channel_id, "message": msg }),
        None,
    );
    Ok(Json(json!({ "ok": true, "message": msg })).into_response())
}

async fn api_messages_react(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath((channel_id, message_id)): AxumPath<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let (_sess, me) = st.extract_auth(&headers)?;
    let Some(emoji) = body["emoji"].as_str() else {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": "Emoji requis." }))).into_response());
    };
    let Some(msg) = st
        .store
        .toggle_reaction(&channel_id, &message_id, &me.id, emoji)
    else {
        return Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "Message introuvable." }))).into_response());
    };
    st.broadcast_all(
        &json!({ "type": "chat:reaction", "channelId": channel_id, "message": msg }),
        None,
    );
    Ok(Json(json!({ "ok": true, "message": msg })).into_response())
}

async fn api_servers_create(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let (_sess, me) = st.extract_auth(&headers)?;
    let name = body["name"].as_str().unwrap_or("").trim();
    if name.is_empty() {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": "Nom requis." }))).into_response());
    }
    let icon = body["iconType"].as_str().unwrap_or("blackhole");
    let srv = st.store.create_server(&me.id, name, icon);
    st.broadcast_all(&json!({ "type": "server:updated", "server": srv }), None);
    Ok(Json(json!({ "ok": true, "server": srv })).into_response())
}

async fn api_servers_join(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let (_sess, me) = st.extract_auth(&headers)?;
    let code = body["inviteCode"].as_str().unwrap_or("");
    let Some(srv) = st.store.join_server_by_invite(&me.id, code) else {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Code d'invitation P2P introuvable." })),
        )
            .into_response());
    };
    st.broadcast_all(&json!({ "type": "server:updated", "server": srv }), None);
    Ok(Json(json!({ "ok": true, "server": srv })).into_response())
}

async fn api_channels_create(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(server_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let _ = st.extract_auth(&headers)?;
    let name = body["name"].as_str().unwrap_or("salon");
    let kind = body["type"].as_str().unwrap_or("text");
    let Some((ch, srv)) = st.store.create_channel(&server_id, name, kind) else {
        return Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "Serveur introuvable." }))).into_response());
    };
    st.broadcast_all(&json!({ "type": "server:updated", "server": srv }), None);
    Ok(Json(json!({ "ok": true, "channel": ch, "server": srv })).into_response())
}

async fn api_roles_create(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(server_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let _ = st.extract_auth(&headers)?;
    let name = body["name"].as_str().unwrap_or("Nouveau Rôle");
    let color = body["color"].as_str().unwrap_or("#e8a849");
    let perms: Vec<String> = body["permissions"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_else(|| vec!["SEND_MESSAGES".into(), "CONNECT_VOICE".into()]);

    let Some((role, srv)) = st.store.create_role(&server_id, name, color, perms) else {
        return Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "Serveur introuvable." }))).into_response());
    };
    st.broadcast_all(&json!({ "type": "server:updated", "server": srv }), None);
    Ok(Json(json!({ "ok": true, "role": role, "server": srv })).into_response())
}

async fn api_member_role_toggle(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath((server_id, target_user_id)): AxumPath<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let _ = st.extract_auth(&headers)?;
    let role_id = body["roleId"].as_str().unwrap_or("");
    let Some(srv) = st
        .store
        .toggle_member_role(&server_id, &target_user_id, role_id)
    else {
        return Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "Membre introuvable." }))).into_response());
    };
    st.broadcast_all(&json!({ "type": "server:updated", "server": srv }), None);
    Ok(Json(json!({ "ok": true, "server": srv })).into_response())
}

// --- AXUM WEBSOCKET P2P SIGNALING & QR WATCHER ---

#[derive(Deserialize)]
struct WsQuery {
    mode: Option<String>,
    #[serde(rename = "challengeId")]
    challenge_id: Option<String>,
    token: Option<String>,
}

async fn ws_upgrade_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(st): State<Arc<AppState>>,
) -> Response {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, q, st))
}

async fn handle_ws_connection(socket: WebSocket, q: WsQuery, st: Arc<AppState>) {
    let (mut ws_sink, mut ws_stream) = socket.split();

    // Mode 1: Scoped QR Challenge Watcher on the Launcher Gatekeeper
    if q.mode.as_deref() == Some("qr") {
        let Some(cid) = q.challenge_id else {
            return;
        };
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        st.qr_watchers
            .write()
            .entry(cid)
            .or_default()
            .push(tx);

        while let Some(msg) = rx.recv().await {
            if ws_sink.send(WsMessage::Text(msg.into())).await.is_err() {
                break;
            }
        }
        return;
    }

    // Mode 2: Authenticated P2P Mesh & Workspace Socket (Mandatory Token Required)
    let raw_tok = q.token.unwrap_or_default();
    let sess = match st
        .security
        .verify_session_jwt(&raw_tok, &st.store.revoked_set())
    {
        Ok(s) => s,
        Err(reason) => {
            let _ = ws_sink
                .send(WsMessage::Text(
                    json!({ "type": "auth:force_disconnect", "reason": reason })
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };

    let Some(user) = st.store.get_user_by_id(&sess.uid) else {
        return;
    };

    let short_sid: String = sess.sid.chars().take(8).collect();
    let peer_key = format!("{}:{}", user.id, short_sid);
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    st.clients.write().insert(
        peer_key.clone(),
        ConnectedClient {
            peer_key: peer_key.clone(),
            user_id: user.id.clone(),
            username: user.username.clone(),
            device_type: sess.device_type.clone(),
            device_name: sess.device_name.clone(),
            token_jti: sess.jti.clone(),
            connected_at: Utc::now().to_rfc3339(),
            tx: tx.clone(),
        },
    );

    let _ = tx.send(
        json!({
            "type": "ws:ready",
            "peerKey": peer_key,
            "voiceRooms": st.serialize_voice_rooms(),
        })
        .to_string(),
    );

    let writer_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sink.send(WsMessage::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(frame)) = ws_stream.next().await {
        let WsMessage::Text(txt) = frame else {
            continue;
        };
        let Ok(msg) = serde_json::from_str::<Value>(&txt) else {
            continue;
        };

        // Continuous mandatory Connection Token check on every frame
        if st.store.revoked_set().contains(&sess.jti) {
            st.force_disconnect_by_jti(
                &sess.jti,
                "Votre Token de Connexion obligatoire a été révoqué.",
            );
            break;
        }

        match msg["type"].as_str().unwrap_or("") {
            "auth:heartbeat" => {
                let _ = tx.send(json!({ "type": "auth:heartbeat_ack", "valid": true }).to_string());
            }
            "chat:typing" => {
                if let Some(ch_id) = msg["channelId"].as_str() {
                    st.broadcast_all(
                        &json!({
                            "type": "chat:typing",
                            "channelId": ch_id,
                            "user": { "id": user.id, "displayName": user.display_name }
                        }),
                        Some(&peer_key),
                    );
                }
            }
            "p2p:join-room" => {
                let Some(room_id) = msg["roomId"].as_str() else {
                    continue;
                };
                st.remove_peer_from_rooms(&peer_key);

                let media = &msg["mediaState"];
                let peer_record = RoomPeerState {
                    peer_key: peer_key.clone(),
                    user_id: user.id.clone(),
                    username: user.username.clone(),
                    display_name: user.display_name.clone(),
                    avatar_color: user.avatar_color.clone(),
                    device_type: sess.device_type.clone(),
                    muted: media["muted"].as_bool().unwrap_or(false),
                    deafened: media["deafened"].as_bool().unwrap_or(false),
                    camera_on: media["cameraOn"].as_bool().unwrap_or(false),
                    screen_on: media["screenOn"].as_bool().unwrap_or(false),
                    stream_spec: media["streamSpec"]
                        .as_str()
                        .unwrap_or("1080p • 60 FPS • P2P")
                        .to_string(),
                    encoder: media["encoder"]
                        .as_str()
                        .unwrap_or("GPU Hardware Zero-Copy")
                        .to_string(),
                    speaking: false,
                };

                let existing_peers: Vec<RoomPeerState> = {
                    let mut rooms = st.voice_rooms.write();
                    let room_map = rooms.entry(room_id.to_string()).or_default();
                    let existing: Vec<RoomPeerState> = room_map.values().cloned().collect();
                    room_map.insert(peer_key.clone(), peer_record.clone());
                    existing
                };

                let _ = tx.send(
                    json!({
                        "type": "p2p:room-joined",
                        "roomId": room_id,
                        "selfPeerKey": peer_key,
                        "existingPeers": existing_peers,
                    })
                    .to_string(),
                );

                for existing in &existing_peers {
                    st.send_to_peer(
                        &existing.peer_key,
                        &json!({
                            "type": "p2p:peer-joined",
                            "roomId": room_id,
                            "peer": peer_record,
                        }),
                    );
                }

                let snap = st.serialize_voice_rooms();
                st.broadcast_all(&json!({ "type": "voice:rooms", "rooms": snap }), None);
            }
            "p2p:leave-room" => {
                st.remove_peer_from_rooms(&peer_key);
            }
            "p2p:media-state" => {
                if let Some(room_id) = msg["roomId"].as_str() {
                    let patch = &msg["patch"];
                    let mut updated = false;
                    {
                        let mut rooms = st.voice_rooms.write();
                        if let Some(room_map) = rooms.get_mut(room_id) {
                            if let Some(rec) = room_map.get_mut(&peer_key) {
                                if let Some(b) = patch["muted"].as_bool() {
                                    rec.muted = b;
                                }
                                if let Some(b) = patch["deafened"].as_bool() {
                                    rec.deafened = b;
                                }
                                if let Some(b) = patch["cameraOn"].as_bool() {
                                    rec.camera_on = b;
                                }
                                if let Some(b) = patch["screenOn"].as_bool() {
                                    rec.screen_on = b;
                                }
                                if let Some(b) = patch["speaking"].as_bool() {
                                    rec.speaking = b;
                                }
                                if let Some(s) = patch["streamSpec"].as_str() {
                                    rec.stream_spec = s.to_string();
                                }
                                updated = true;
                            }
                        }
                    }
                    if updated {
                        let snap = st.serialize_voice_rooms();
                        st.broadcast_all(&json!({ "type": "voice:rooms", "rooms": snap }), None);
                    }
                }
            }
            "p2p:signal" => {
                if let Some(target_pk) = msg["targetPeerKey"].as_str() {
                    st.send_to_peer(
                        target_pk,
                        &json!({
                            "type": "p2p:signal",
                            "fromPeerKey": peer_key,
                            "fromUser": {
                                "id": user.id,
                                "displayName": user.display_name,
                                "avatarColor": user.avatar_color,
                            },
                            "roomId": msg["roomId"],
                            "signal": msg["signal"],
                        }),
                    );
                }
            }
            _ => {}
        }
    }

    st.remove_peer_from_rooms(&peer_key);
    st.clients.write().remove(&peer_key);
    writer_task.abort();
}
