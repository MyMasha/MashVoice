use crate::security::{MintedToken, SecurityEngine};
use chrono::Utc;
use parking_lot::RwLock;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserActivity {
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub tag: String,
    pub peer_id: String,
    pub avatar_color: String,
    pub status: String,
    pub custom_status: String,
    pub activity: Option<UserActivity>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRole {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i32,
    pub hoist: bool,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMember {
    pub user_id: String,
    pub role_ids: Vec<String>,
    pub joined_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCategory {
    pub id: String,
    pub name: String,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerChannel {
    pub id: String,
    pub category_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String, // "text" | "voice" | "stage"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitrate_kbps: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_quality: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityServer {
    pub id: String,
    pub name: String,
    pub short_name: String,
    pub icon_type: String,
    pub invite_code: String,
    pub owner_id: String,
    pub banner_style: String,
    pub roles: Vec<ServerRole>,
    pub members: Vec<ServerMember>,
    pub categories: Vec<ChannelCategory>,
    pub channels: Vec<ServerChannel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub channel_id: String,
    pub author_id: String,
    pub content: String,
    pub attachment: Option<serde_json::Value>,
    pub reply_to: Option<String>,
    pub created_at: String,
    pub pinned: bool,
    pub p2p_verified: bool,
    pub reactions: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedTokenRecord {
    pub jti: String,
    pub label: String,
    pub tier: String,
    pub token_preview: String,
    pub token_value: Option<String>,
    pub created_at: String,
    pub expires_at: String,
    pub revoked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    pub users: Vec<UserProfile>,
    pub friendships: Vec<(String, String)>,
    pub servers: Vec<CommunityServer>,
    pub messages: HashMap<String, Vec<ChatMessage>>,
    pub issued_tokens: Vec<IssuedTokenRecord>,
    pub revoked_token_jtis: Vec<String>,
}

fn short_hex(len: usize) -> String {
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| format!("{:x}", rng.gen_range(0..16)))
        .collect()
}

fn token_preview(tok: &str) -> String {
    if tok.len() > 30 {
        format!("{}...{}", &tok[..22], &tok[tok.len() - 8..])
    } else {
        tok.to_string()
    }
}

fn build_initial_state(sec: &SecurityEngine) -> PersistedState {
    let founder = sec.mint_connection_token(
        Some("tok-founder-singularity".into()),
        "Token Maître Fondateur (MyMasha)",
        "FOUNDER",
        365,
        None,
    );
    let squad = sec.mint_connection_token(
        Some("tok-squad-friends".into()),
        "Token Escouade Amis P2P",
        "MEMBER",
        365,
        None,
    );

    let now = Utc::now().to_rfc3339();

    let users = vec![
        UserProfile {
            id: "usr-rawsq".into(),
            username: "rawsq".into(),
            display_name: "rawsq".into(),
            tag: "0001".into(),
            peer_id: "p2p-mash-rawsq-9f4a".into(),
            avatar_color: "#e8a849".into(),
            status: "online".into(),
            custom_status: "Moteur Rust Natif • Singularity 4.1".into(),
            activity: Some(UserActivity {
                kind: "playing".into(),
                name: "MashClient 1.8.9".into(),
                detail: Some("Borderless • 680 FPS (Rust 0% CPU)".into()),
            }),
            created_at: now.clone(),
        },
        UserProfile {
            id: "usr-nyx".into(),
            username: "nyx_orbital".into(),
            display_name: "Nyx".into(),
            tag: "0404".into(),
            peer_id: "p2p-mash-nyx-3c8e".into(),
            avatar_color: "#5ec2a6".into(),
            status: "online".into(),
            custom_status: "Stream 1080p 60FPS NVENC Zero-Copy".into(),
            activity: Some(UserActivity {
                kind: "streaming".into(),
                name: "Valorant Ranked".into(),
                detail: Some("P2P Direct • 12 Mo RAM".into()),
            }),
            created_at: now.clone(),
        },
        UserProfile {
            id: "usr-kael".into(),
            username: "kael_vortex".into(),
            display_name: "Kael".into(),
            tag: "7710".into(),
            peer_id: "p2p-mash-kael-51d2".into(),
            avatar_color: "#d97b43".into(),
            status: "idle".into(),
            custom_status: "Connecté depuis MashVoice Mobile 📱".into(),
            activity: None,
            created_at: now.clone(),
        },
    ];

    let servers = vec![
        CommunityServer {
            id: "srv-singularity".into(),
            name: "MyMasha • Singularity HQ".into(),
            short_name: "MM".into(),
            icon_type: "blackhole".into(),
            invite_code: "MASH-HQ-2026".into(),
            owner_id: "usr-rawsq".into(),
            banner_style: "schwarzschild".into(),
            roles: vec![
                ServerRole {
                    id: "role-founder".into(),
                    name: "Fondateur Singularity".into(),
                    color: "#f0b659".into(),
                    position: 100,
                    hoist: true,
                    permissions: vec![
                        "ADMINISTRATOR".into(),
                        "MANAGE_SERVER".into(),
                        "MANAGE_ROLES".into(),
                        "MANAGE_CHANNELS".into(),
                        "STREAM_ULTRA".into(),
                        "KICK_MEMBERS".into(),
                    ],
                },
                ServerRole {
                    id: "role-admin".into(),
                    name: "Garde Horizon".into(),
                    color: "#e07a3c".into(),
                    position: 80,
                    hoist: true,
                    permissions: vec![
                        "MANAGE_CHANNELS".into(),
                        "MANAGE_ROLES".into(),
                        "STREAM_ULTRA".into(),
                        "KICK_MEMBERS".into(),
                    ],
                },
                ServerRole {
                    id: "role-streamer".into(),
                    name: "Streamer P2P 120FPS".into(),
                    color: "#5ec2a6".into(),
                    position: 60,
                    hoist: true,
                    permissions: vec!["STREAM_ULTRA".into()],
                },
                ServerRole {
                    id: "role-member".into(),
                    name: "Explorateur".into(),
                    color: "#9aa0ad".into(),
                    position: 10,
                    hoist: true,
                    permissions: vec![
                        "SEND_MESSAGES".into(),
                        "CONNECT_VOICE".into(),
                        "STREAM_HD".into(),
                    ],
                },
            ],
            members: vec![
                ServerMember {
                    user_id: "usr-rawsq".into(),
                    role_ids: vec!["role-founder".into(), "role-streamer".into()],
                    joined_at: now.clone(),
                },
                ServerMember {
                    user_id: "usr-nyx".into(),
                    role_ids: vec!["role-admin".into(), "role-streamer".into()],
                    joined_at: now.clone(),
                },
                ServerMember {
                    user_id: "usr-kael".into(),
                    role_ids: vec!["role-member".into()],
                    joined_at: now.clone(),
                },
            ],
            categories: vec![
                ChannelCategory {
                    id: "cat-info".into(),
                    name: "HORIZON DES ÉVÉNEMENTS".into(),
                    order: 1,
                },
                ChannelCategory {
                    id: "cat-text".into(),
                    name: "SALONS COMMUNAUTAIRES".into(),
                    order: 2,
                },
                ChannelCategory {
                    id: "cat-voice".into(),
                    name: "VOCAL & STREAMS P2P".into(),
                    order: 3,
                },
            ],
            channels: vec![
                ServerChannel {
                    id: "ch-annonces".into(),
                    category_id: "cat-info".into(),
                    name: "annonces-officielles".into(),
                    kind: "text".into(),
                    topic: Some("Moteur Rust + Tauri v2 & Auto-Updater MyMasha/MashVoice".into()),
                    bitrate_kbps: None,
                    max_quality: None,
                },
                ServerChannel {
                    id: "ch-regles".into(),
                    category_id: "cat-info".into(),
                    name: "sécurité-zero-trust".into(),
                    kind: "text".into(),
                    topic: Some("Tokens de Connexion obligatoires HMAC-SHA256 & Coffre AES-256-GCM".into()),
                    bitrate_kbps: None,
                    max_quality: None,
                },
                ServerChannel {
                    id: "ch-general".into(),
                    category_id: "cat-text".into(),
                    name: "général".into(),
                    kind: "text".into(),
                    topic: Some("Discussion principale P2P chiffrée entre potes".into()),
                    bitrate_kbps: None,
                    max_quality: None,
                },
                ServerChannel {
                    id: "ch-clips".into(),
                    category_id: "cat-text".into(),
                    name: "clips-et-screens".into(),
                    kind: "text".into(),
                    topic: Some("Partagez vos clips gaming & benchmarks FPS".into()),
                    bitrate_kbps: None,
                    max_quality: None,
                },
                ServerChannel {
                    id: "ch-voice-lobby".into(),
                    category_id: "cat-voice".into(),
                    name: "Salon Gravitationnel".into(),
                    kind: "voice".into(),
                    topic: None,
                    bitrate_kbps: Some(128),
                    max_quality: Some("1080p60".into()),
                },
                ServerChannel {
                    id: "ch-voice-gaming".into(),
                    category_id: "cat-voice".into(),
                    name: "Escouade Turbo FPS".into(),
                    kind: "voice".into(),
                    topic: None,
                    bitrate_kbps: Some(256),
                    max_quality: Some("1440p120".into()),
                },
                ServerChannel {
                    id: "ch-voice-cinema".into(),
                    category_id: "cat-voice".into(),
                    name: "Cinéma & Stream Pro".into(),
                    kind: "stage".into(),
                    topic: None,
                    bitrate_kbps: Some(384),
                    max_quality: Some("4K60".into()),
                },
            ],
        },
        CommunityServer {
            id: "srv-mashclient".into(),
            name: "MashClient Competitive".into(),
            short_name: "MC".into(),
            icon_type: "goldring".into(),
            invite_code: "MASH-PVP-189".into(),
            owner_id: "usr-rawsq".into(),
            banner_style: "accretion".into(),
            roles: vec![
                ServerRole {
                    id: "role-mc-lead".into(),
                    name: "Staff MashClient".into(),
                    color: "#f0b659".into(),
                    position: 100,
                    hoist: true,
                    permissions: vec!["ADMINISTRATOR".into(), "STREAM_ULTRA".into()],
                },
                ServerRole {
                    id: "role-mc-player".into(),
                    name: "Joueur Ranked".into(),
                    color: "#7fa8d6".into(),
                    position: 20,
                    hoist: true,
                    permissions: vec![
                        "SEND_MESSAGES".into(),
                        "CONNECT_VOICE".into(),
                        "STREAM_HD".into(),
                    ],
                },
            ],
            members: vec![
                ServerMember {
                    user_id: "usr-rawsq".into(),
                    role_ids: vec!["role-mc-lead".into()],
                    joined_at: now.clone(),
                },
                ServerMember {
                    user_id: "usr-nyx".into(),
                    role_ids: vec!["role-mc-player".into()],
                    joined_at: now.clone(),
                },
            ],
            categories: vec![
                ChannelCategory {
                    id: "cat-mc-txt".into(),
                    name: "COMPÉTITION".into(),
                    order: 1,
                },
                ChannelCategory {
                    id: "cat-mc-voc".into(),
                    name: "ESCOUADES P2P".into(),
                    order: 2,
                },
            ],
            channels: vec![
                ServerChannel {
                    id: "ch-mc-chat".into(),
                    category_id: "cat-mc-txt".into(),
                    name: "scrims-1v1".into(),
                    kind: "text".into(),
                    topic: Some("Organisation des matchs classés & optimisations FPS".into()),
                    bitrate_kbps: None,
                    max_quality: None,
                },
                ServerChannel {
                    id: "ch-mc-voc1".into(),
                    category_id: "cat-mc-voc".into(),
                    name: "Duo Ranked #1".into(),
                    kind: "voice".into(),
                    topic: None,
                    bitrate_kbps: Some(192),
                    max_quality: Some("1080p60".into()),
                },
            ],
        },
    ];

    let mut messages = HashMap::new();
    let mut ann_reacts = HashMap::new();
    ann_reacts.insert(
        "🔥".to_string(),
        vec!["usr-rawsq".into(), "usr-nyx".into(), "usr-kael".into()],
    );
    ann_reacts.insert("🦀".to_string(), vec!["usr-rawsq".into(), "usr-nyx".into()]);

    messages.insert(
        "ch-annonces".into(),
        vec![ChatMessage {
            id: "msg-1".into(),
            channel_id: "ch-annonces".into(),
            author_id: "usr-rawsq".into(),
            content: "Bienvenue sur **MashVoice — Singularity 4.1 (Moteur Rust Natif 🦀)**.\n\n• **Empreinte mémoire ultra-légère (~12 Mo RAM backend Rust / Tokio)** sans Garbage Collector pour zéro saccade en plein jeu.\n• **Sécurité Zero-Trust Rust** : Token de connexion obligatoire `MASH-SV4` signé HMAC-SHA256 + coffre local `AES-256-GCM` + connexion PC instantanée par **QR Code Mobile**.\n• **Streams P2P WebRTC 60/120 FPS** : encodage matériel NVENC/AMF Zero-Copy et mise en veille auto du shader 3D Schwarzschild quand un jeu tourne.".into(),
            attachment: None,
            reply_to: None,
            created_at: now.clone(),
            pinned: true,
            p2p_verified: true,
            reactions: ann_reacts,
        }],
    );

    let mut gen_reacts = HashMap::new();
    gen_reacts.insert("⚡".to_string(), vec!["usr-rawsq".into(), "usr-kael".into()]);
    messages.insert(
        "ch-general".into(),
        vec![
            ChatMessage {
                id: "msg-gen-1".into(),
                channel_id: "ch-general".into(),
                author_id: "usr-nyx".into(),
                content: "Le passage en **Rust** change tout : le processus prend ~12 Mo de RAM à côté de MashClient et le stream 1080p 60 FPS ne bouge pas d'une frame !".into(),
                attachment: None,
                reply_to: None,
                created_at: now.clone(),
                pinned: false,
                p2p_verified: true,
                reactions: gen_reacts,
            },
            ChatMessage {
                id: "msg-gen-2".into(),
                channel_id: "ch-general".into(),
                author_id: "usr-kael".into(),
                content: "Et le scan du QR Code généré en Rust SVG depuis l'app mobile déverrouille le PC en moins d'une seconde 👌".into(),
                attachment: None,
                reply_to: None,
                created_at: now.clone(),
                pinned: false,
                p2p_verified: true,
                reactions: HashMap::new(),
            },
        ],
    );

    messages.insert(
        "dm:usr-nyx:usr-rawsq".into(),
        vec![ChatMessage {
            id: "msg-dm-1".into(),
            channel_id: "dm:usr-nyx:usr-rawsq".into(),
            author_id: "usr-nyx".into(),
            content: "Dispo pour tester le stream P2P 120 FPS en message privé dès que tu lances le jeu !".into(),
            attachment: None,
            reply_to: None,
            created_at: now.clone(),
            pinned: false,
            p2p_verified: true,
            reactions: HashMap::new(),
        }],
    );

    let issued_tokens = vec![
        IssuedTokenRecord {
            jti: founder.payload.jti,
            label: founder.payload.lbl,
            tier: founder.payload.tier,
            token_preview: token_preview(&founder.token),
            token_value: Some(founder.token),
            created_at: now.clone(),
            expires_at: chrono::DateTime::from_timestamp(founder.payload.exp as i64, 0)
                .map(|d| d.to_rfc3339())
                .unwrap_or_else(|| now.clone()),
            revoked: false,
        },
        IssuedTokenRecord {
            jti: squad.payload.jti,
            label: squad.payload.lbl,
            tier: squad.payload.tier,
            token_preview: token_preview(&squad.token),
            token_value: Some(squad.token),
            created_at: now.clone(),
            expires_at: chrono::DateTime::from_timestamp(squad.payload.exp as i64, 0)
                .map(|d| d.to_rfc3339())
                .unwrap_or_else(|| now.clone()),
            revoked: false,
        },
    ];

    PersistedState {
        users,
        friendships: vec![
            ("usr-rawsq".into(), "usr-nyx".into()),
            ("usr-rawsq".into(), "usr-kael".into()),
            ("usr-nyx".into(), "usr-kael".into()),
        ],
        servers,
        messages,
        issued_tokens,
        revoked_token_jtis: vec![],
    }
}

pub struct MashStore {
    db_file: PathBuf,
    pub state: RwLock<PersistedState>,
}

impl MashStore {
    pub fn new(data_dir: &Path, sec: &SecurityEngine) -> Self {
        let _ = fs::create_dir_all(data_dir);
        let db_file = data_dir.join("mashvoice-state.json");
        let initial = fs::read_to_string(&db_file)
            .ok()
            .and_then(|s| serde_json::from_str::<PersistedState>(&s).ok())
            .unwrap_or_else(|| build_initial_state(sec));

        let store = Self {
            db_file,
            state: RwLock::new(initial),
        };
        store.save();
        store
    }

    pub fn save(&self) {
        let guard = self.state.read();
        if let Ok(json) = serde_json::to_string_pretty(&*guard) {
            let _ = fs::write(&self.db_file, json);
        }
    }

    pub fn revoked_set(&self) -> HashSet<String> {
        self.state
            .read()
            .revoked_token_jtis
            .iter()
            .cloned()
            .collect()
    }

    pub fn find_or_create_user(&self, username_input: &str, display_name: Option<&str>) -> UserProfile {
        let cleaned: String = username_input
            .trim()
            .to_lowercase()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '.' || *c == '-')
            .take(24)
            .collect();
        let clean_name = if cleaned.is_empty() {
            "explorateur".to_string()
        } else {
            cleaned
        };

        {
            let mut st = self.state.write();
            if let Some(existing) = st
                .users
                .iter_mut()
                .find(|u| u.username.eq_ignore_ascii_case(&clean_name))
            {
                existing.status = "online".into();
                let cloned = existing.clone();
                drop(st);
                self.save();
                return cloned;
            }

            let palette = ["#e8a849", "#5ec2a6", "#d97b43", "#7fa8d6", "#e06c75"];
            let color = palette[st.users.len() % palette.len()].to_string();
            let tag = format!("{:04}", rand::thread_rng().gen_range(1000..9999));
            let short_u: String = clean_name.chars().take(8).collect();
            let user = UserProfile {
                id: format!("usr-{}", short_hex(8)),
                username: clean_name.clone(),
                display_name: display_name
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(username_input.trim())
                    .to_string(),
                tag,
                peer_id: format!("p2p-mash-{}-{}", short_u, short_hex(4)),
                avatar_color: color,
                status: "online".into(),
                custom_status: "Connecté en P2P Rust".into(),
                activity: None,
                created_at: Utc::now().to_rfc3339(),
            };

            let uid = user.id.clone();
            st.users.push(user.clone());

            if let Some(hq) = st.servers.iter_mut().find(|s| s.id == "srv-singularity") {
                if !hq.members.iter().any(|m| m.user_id == uid) {
                    hq.members.push(ServerMember {
                        user_id: uid.clone(),
                        role_ids: vec!["role-member".into()],
                        joined_at: Utc::now().to_rfc3339(),
                    });
                }
            }

            for def_friend in ["usr-rawsq", "usr-nyx", "usr-kael"] {
                if def_friend != uid {
                    st.friendships.push((uid.clone(), def_friend.to_string()));
                }
            }

            drop(st);
            self.save();
            user
        }
    }

    pub fn get_user_by_id(&self, user_id: &str) -> Option<UserProfile> {
        self.state
            .read()
            .users
            .iter()
            .find(|u| u.id == user_id)
            .cloned()
    }

    pub fn dm_channel_id(a: &str, b: &str) -> String {
        if a <= b {
            format!("dm:{}:{}", a, b)
        } else {
            format!("dm:{}:{}", b, a)
        }
    }

    pub fn get_friends_for_user(&self, user_id: &str) -> Vec<UserProfile> {
        let st = self.state.read();
        let mut ids = HashSet::new();
        for (a, b) in &st.friendships {
            if a == user_id {
                ids.insert(b.as_str());
            } else if b == user_id {
                ids.insert(a.as_str());
            }
        }
        st.users
            .iter()
            .filter(|u| ids.contains(u.id.as_str()))
            .cloned()
            .collect()
    }

    pub fn add_friendship(&self, user_a: &str, user_b: &str) {
        if user_a == user_b {
            return;
        }
        let mut st = self.state.write();
        let exists = st
            .friendships
            .iter()
            .any(|(a, b)| (a == user_a && b == user_b) || (a == user_b && b == user_a));
        if !exists {
            st.friendships.push((user_a.to_string(), user_b.to_string()));
            drop(st);
            self.save();
        }
    }

    pub fn get_servers_for_user(&self, user_id: &str) -> Vec<CommunityServer> {
        self.state
            .read()
            .servers
            .iter()
            .filter(|s| s.members.iter().any(|m| m.user_id == user_id))
            .cloned()
            .collect()
    }

    pub fn create_server(&self, owner_id: &str, name: &str, icon_type: &str) -> CommunityServer {
        let srv_id = format!("srv-{}", short_hex(8));
        let short_name: String = name
            .split_whitespace()
            .take(2)
            .filter_map(|w| w.chars().next())
            .map(|c| c.to_ascii_uppercase())
            .collect();
        let short_name = if short_name.is_empty() {
            "SV".into()
        } else {
            short_name
        };
        let invite_code = format!("MASH-{}", short_hex(6).to_uppercase());
        let now = Utc::now().to_rfc3339();
        let admin_role_id = format!("{}-role-admin", srv_id);
        let gen_ch_id = format!("{}-ch-gen", srv_id);

        let srv = CommunityServer {
            id: srv_id.clone(),
            name: name.trim().chars().take(48).collect(),
            short_name,
            icon_type: icon_type.to_string(),
            invite_code: invite_code.clone(),
            owner_id: owner_id.to_string(),
            banner_style: "schwarzschild".into(),
            roles: vec![
                ServerRole {
                    id: admin_role_id.clone(),
                    name: "Commandant".into(),
                    color: "#f0b659".into(),
                    position: 100,
                    hoist: true,
                    permissions: vec![
                        "ADMINISTRATOR".into(),
                        "MANAGE_CHANNELS".into(),
                        "MANAGE_ROLES".into(),
                        "STREAM_ULTRA".into(),
                    ],
                },
                ServerRole {
                    id: format!("{}-role-member", srv_id),
                    name: "Membre P2P".into(),
                    color: "#9aa0ad".into(),
                    position: 10,
                    hoist: true,
                    permissions: vec!["SEND_MESSAGES".into(), "CONNECT_VOICE".into()],
                },
            ],
            members: vec![ServerMember {
                user_id: owner_id.to_string(),
                role_ids: vec![admin_role_id],
                joined_at: now.clone(),
            }],
            categories: vec![
                ChannelCategory {
                    id: format!("{}-cat-txt", srv_id),
                    name: "SALONS TEXTUELS".into(),
                    order: 1,
                },
                ChannelCategory {
                    id: format!("{}-cat-voc", srv_id),
                    name: "VOCAL & STREAMS P2P".into(),
                    order: 2,
                },
            ],
            channels: vec![
                ServerChannel {
                    id: gen_ch_id.clone(),
                    category_id: format!("{}-cat-txt", srv_id),
                    name: "général".into(),
                    kind: "text".into(),
                    topic: Some(format!("Salon principal de {}", name.trim())),
                    bitrate_kbps: None,
                    max_quality: None,
                },
                ServerChannel {
                    id: format!("{}-ch-voc", srv_id),
                    category_id: format!("{}-cat-voc", srv_id),
                    name: "Vocal & Stream HD".into(),
                    kind: "voice".into(),
                    topic: None,
                    bitrate_kbps: Some(256),
                    max_quality: Some("1080p60".into()),
                },
            ],
        };

        let mut st = self.state.write();
        st.servers.push(srv.clone());
        st.messages.insert(
            gen_ch_id.clone(),
            vec![ChatMessage {
                id: format!("msg-{}", Uuid::new_v4()),
                channel_id: gen_ch_id,
                author_id: owner_id.to_string(),
                content: format!(
                    "Serveur communautaire **{}** propulsé par Rust initialisé ! Code d'invitation P2P : `{}`",
                    srv.name, invite_code
                ),
                attachment: None,
                reply_to: None,
                created_at: now,
                pinned: true,
                p2p_verified: true,
                reactions: HashMap::new(),
            }],
        );
        drop(st);
        self.save();
        srv
    }

    pub fn join_server_by_invite(&self, user_id: &str, invite_code: &str) -> Option<CommunityServer> {
        let code = invite_code.trim().to_uppercase();
        let mut st = self.state.write();
        let srv = st
            .servers
            .iter_mut()
            .find(|s| s.invite_code.to_uppercase() == code)?;
        if !srv.members.iter().any(|m| m.user_id == user_id) {
            let lowest_role = srv
                .roles
                .iter()
                .min_by_key(|r| r.position)
                .map(|r| vec![r.id.clone()])
                .unwrap_or_default();
            srv.members.push(ServerMember {
                user_id: user_id.to_string(),
                role_ids: lowest_role,
                joined_at: Utc::now().to_rfc3339(),
            });
        }
        let out = srv.clone();
        drop(st);
        self.save();
        Some(out)
    }

    pub fn create_channel(
        &self,
        server_id: &str,
        name: &str,
        kind: &str,
    ) -> Option<(ServerChannel, CommunityServer)> {
        let mut st = self.state.write();
        let srv = st.servers.iter_mut().find(|s| s.id == server_id)?;
        let cat_id = srv
            .categories
            .iter()
            .find(|c| {
                if kind == "text" {
                    !c.name.contains("VOCAL")
                } else {
                    c.name.contains("VOCAL")
                }
            })
            .or_else(|| srv.categories.first())
            .map(|c| c.id.clone())
            .unwrap_or_default();

        let formatted_name = if kind == "text" {
            name.trim().to_lowercase().replace(' ', "-")
        } else {
            name.trim().to_string()
        };

        let ch = ServerChannel {
            id: format!("ch-{}", short_hex(8)),
            category_id: cat_id,
            name: formatted_name.chars().take(32).collect(),
            kind: kind.to_string(),
            topic: if kind == "text" {
                Some("Salon P2P chiffré".into())
            } else {
                None
            },
            bitrate_kbps: if kind != "text" { Some(256) } else { None },
            max_quality: if kind != "text" {
                Some("1080p60".into())
            } else {
                None
            },
        };

        srv.channels.push(ch.clone());
        let srv_clone = srv.clone();
        if kind == "text" {
            st.messages.entry(ch.id.clone()).or_default();
        }
        drop(st);
        self.save();
        Some((ch, srv_clone))
    }

    pub fn create_role(
        &self,
        server_id: &str,
        name: &str,
        color: &str,
        permissions: Vec<String>,
    ) -> Option<(ServerRole, CommunityServer)> {
        let mut st = self.state.write();
        let srv = st.servers.iter_mut().find(|s| s.id == server_id)?;
        let role = ServerRole {
            id: format!("role-{}", short_hex(8)),
            name: name.trim().chars().take(32).collect(),
            color: color.to_string(),
            position: 40,
            hoist: true,
            permissions,
        };
        srv.roles.push(role.clone());
        srv.roles.sort_by(|a, b| b.position.cmp(&a.position));
        let srv_clone = srv.clone();
        drop(st);
        self.save();
        Some((role, srv_clone))
    }

    pub fn toggle_member_role(
        &self,
        server_id: &str,
        target_user_id: &str,
        role_id: &str,
    ) -> Option<CommunityServer> {
        let mut st = self.state.write();
        let srv = st.servers.iter_mut().find(|s| s.id == server_id)?;
        let member = srv
            .members
            .iter_mut()
            .find(|m| m.user_id == target_user_id)?;
        if let Some(pos) = member.role_ids.iter().position(|r| r == role_id) {
            member.role_ids.remove(pos);
        } else {
            member.role_ids.push(role_id.to_string());
        }
        let out = srv.clone();
        drop(st);
        self.save();
        Some(out)
    }

    pub fn add_message(
        &self,
        channel_id: &str,
        author_id: &str,
        content: &str,
        attachment: Option<serde_json::Value>,
        reply_to: Option<String>,
    ) -> ChatMessage {
        let msg = ChatMessage {
            id: format!("msg-{}", Uuid::new_v4()),
            channel_id: channel_id.to_string(),
            author_id: author_id.to_string(),
            content: content.chars().take(4000).collect(),
            attachment,
            reply_to,
            created_at: Utc::now().to_rfc3339(),
            pinned: false,
            p2p_verified: true,
            reactions: HashMap::new(),
        };
        let mut st = self.state.write();
        let list = st.messages.entry(channel_id.to_string()).or_default();
        list.push(msg.clone());
        if list.len() > 300 {
            let drain = list.len() - 300;
            list.drain(0..drain);
        }
        drop(st);
        self.save();
        msg
    }

    pub fn toggle_reaction(
        &self,
        channel_id: &str,
        message_id: &str,
        user_id: &str,
        emoji: &str,
    ) -> Option<ChatMessage> {
        let mut st = self.state.write();
        let list = st.messages.get_mut(channel_id)?;
        let msg = list.iter_mut().find(|m| m.id == message_id)?;
        let users = msg.reactions.entry(emoji.to_string()).or_default();
        if let Some(pos) = users.iter().position(|u| u == user_id) {
            users.remove(pos);
            if users.is_empty() {
                msg.reactions.remove(emoji);
            }
        } else {
            users.push(user_id.to_string());
        }
        let cloned = msg.clone();
        drop(st);
        self.save();
        Some(cloned)
    }

    pub fn register_issued_token(&self, minted: &MintedToken) -> IssuedTokenRecord {
        let now = Utc::now().to_rfc3339();
        let rec = IssuedTokenRecord {
            jti: minted.payload.jti.clone(),
            label: minted.payload.lbl.clone(),
            tier: minted.payload.tier.clone(),
            token_preview: token_preview(&minted.token),
            token_value: Some(minted.token.clone()),
            created_at: now.clone(),
            expires_at: chrono::DateTime::from_timestamp(minted.payload.exp as i64, 0)
                .map(|d| d.to_rfc3339())
                .unwrap_or(now),
            revoked: false,
        };
        let mut st = self.state.write();
        st.issued_tokens.insert(0, rec.clone());
        drop(st);
        self.save();
        rec
    }

    pub fn revoke_token(&self, jti: &str) -> Option<IssuedTokenRecord> {
        let mut st = self.state.write();
        if !st.revoked_token_jtis.iter().any(|x| x == jti) {
            st.revoked_token_jtis.push(jti.to_string());
        }
        let mut updated = None;
        if let Some(item) = st.issued_tokens.iter_mut().find(|t| t.jti == jti) {
            item.revoked = true;
            updated = Some(item.clone());
        }
        drop(st);
        self.save();
        updated
    }
}
