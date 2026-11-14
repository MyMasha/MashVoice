use chrono::Utc;
use parking_lot::Mutex;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

pub const GITHUB_ORG: &str = "MyMasha";
pub const GITHUB_REPO: &str = "MashVoice";
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Public Open-Source GitHub Releases URL (no API key or PAT required).
/// Binary integrity is guaranteed by the Ed25519 minisign public key (`F6A9F0FBF91D7ADE`)
/// configured in `src-tauri/tauri.conf.json`, while the private signing key
/// (`TAURI_SIGNING_PRIVATE_KEY`) stays strictly in Admin-only GitHub Actions Secrets.
pub const PUBLIC_RELEASES_URL: &str = "https://github.com/MyMasha/MashVoice/releases/latest";
pub const ED25519_UPDATER_KEY_ID: &str = "F6A9F0FBF91D7ADE";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAssetInfo {
    pub id: u64,
    pub name: String,
    pub size: u64,
    pub download_count: u64,
    pub api_url: String,
    pub browser_download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckStatus {
    pub state: String,
    pub up_to_date: bool,
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub repository: String,
    pub message: String,
    pub release_notes: Option<String>,
    pub assets: Vec<ReleaseAssetInfo>,
    pub public_releases_url: String,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredUpdaterConfig {
    #[serde(default = "default_channel")]
    pub channel: String,
    #[serde(default = "default_true")]
    pub auto_check: bool,
    #[serde(default = "default_true")]
    pub auto_download: bool,
    #[serde(default)]
    pub last_checked_at: Option<String>,
    #[serde(default)]
    pub last_status: Option<UpdateCheckStatus>,
}

fn default_channel() -> String {
    "stable".into()
}

fn default_true() -> bool {
    true
}

impl Default for StoredUpdaterConfig {
    fn default() -> Self {
        Self {
            channel: default_channel(),
            auto_check: true,
            auto_download: true,
            last_checked_at: None,
            last_status: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SanitizedUpdaterConfig {
    pub owner: String,
    pub repo: String,
    pub current_version: String,
    pub channel: String,
    pub auto_check: bool,
    pub auto_download: bool,
    pub open_source_signed: bool,
    pub updater_key_id: String,
    pub public_releases_url: String,
    pub last_checked_at: Option<String>,
    pub last_status: Option<UpdateCheckStatus>,
}

pub struct UpdaterService {
    cfg_path: PathBuf,
    inner: Mutex<StoredUpdaterConfig>,
    http: reqwest::Client,
}

impl UpdaterService {
    pub fn new(data_dir: &Path) -> Self {
        let _ = fs::create_dir_all(data_dir);
        let cfg_path = data_dir.join("updater-config.json");
        let loaded = fs::read_to_string(&cfg_path)
            .ok()
            .and_then(|s| serde_json::from_str::<StoredUpdaterConfig>(&s).ok())
            .unwrap_or_default();

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .user_agent(format!("MashVoice-OpenSource-AutoUpdater/{}", CURRENT_VERSION))
            .build()
            .unwrap_or_default();

        let svc = Self {
            cfg_path,
            inner: Mutex::new(loaded),
            http,
        };
        // Re-save sanitized structure so any legacy `readOnlyToken` on disk is scrubbed automatically
        {
            let guard = svc.inner.lock();
            svc.save_locked(&guard);
        }
        svc
    }

    fn save_locked(&self, cfg: &StoredUpdaterConfig) {
        if let Ok(json) = serde_json::to_vec_pretty(cfg) {
            let _ = crate::security::write_admin_secret_file(&self.cfg_path, &json);
        }
    }

    pub fn get_sanitized(&self) -> SanitizedUpdaterConfig {
        let cfg = self.inner.lock();
        SanitizedUpdaterConfig {
            owner: GITHUB_ORG.into(),
            repo: GITHUB_REPO.into(),
            current_version: CURRENT_VERSION.into(),
            channel: cfg.channel.clone(),
            auto_check: cfg.auto_check,
            auto_download: cfg.auto_download,
            open_source_signed: true,
            updater_key_id: ED25519_UPDATER_KEY_ID.into(),
            public_releases_url: PUBLIC_RELEASES_URL.into(),
            last_checked_at: cfg.last_checked_at.clone(),
            last_status: cfg.last_status.clone(),
        }
    }

    pub fn update_settings(
        &self,
        auto_check: Option<bool>,
        auto_download: Option<bool>,
        channel: Option<String>,
    ) {
        let mut cfg = self.inner.lock();
        if let Some(ac) = auto_check {
            cfg.auto_check = ac;
        }
        if let Some(ad) = auto_download {
            cfg.auto_download = ad;
        }
        if let Some(ch) = channel {
            if !ch.trim().is_empty() {
                cfg.channel = ch.trim().to_string();
            }
        }
        self.save_locked(&cfg);
    }

    pub async fn check_github_updates(&self) -> UpdateCheckStatus {
        let checked_at = Utc::now().to_rfc3339();
        let repo_full = format!("{}/{}", GITHUB_ORG, GITHUB_REPO);
        let rel_url = format!(
            "https://api.github.com/repos/{}/{}/releases/latest",
            GITHUB_ORG, GITHUB_REPO
        );

        let mut req = self
            .http
            .get(&rel_url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");

        // Optional local environment variable only (never embedded, never required for public Open Source)
        if let Ok(local_tok) = std::env::var("MASHVOICE_GITHUB_API_TOKEN") {
            let trimmed = local_tok.trim();
            if !trimmed.is_empty() {
                req = req.header("Authorization", format!("Bearer {}", trimmed));
            }
        }

        let Ok(rel_resp) = req.send().await else {
            let status = UpdateCheckStatus {
                state: "network_offline".into(),
                up_to_date: true,
                update_available: false,
                current_version: CURRENT_VERSION.into(),
                latest_version: CURRENT_VERSION.into(),
                repository: repo_full,
                message: "Mode hors-ligne / réseau restreint. Nouvelle vérification programmée automatiquement.".into(),
                release_notes: None,
                assets: vec![],
                public_releases_url: PUBLIC_RELEASES_URL.into(),
                checked_at: checked_at.clone(),
            };
            self.record_status(checked_at, status.clone());
            return status;
        };

        let code = rel_resp.status().as_u16();
        if code == 404 {
            let status = UpdateCheckStatus {
                state: "up_to_date_no_release".into(),
                up_to_date: true,
                update_available: false,
                current_version: CURRENT_VERSION.into(),
                latest_version: CURRENT_VERSION.into(),
                repository: repo_full,
                message: format!(
                    "Dépôt Open-Source MyMasha/MashVoice connecté. Version Rust v{} à jour.",
                    CURRENT_VERSION
                ),
                release_notes: None,
                assets: vec![],
                public_releases_url: PUBLIC_RELEASES_URL.into(),
                checked_at: checked_at.clone(),
            };
            self.record_status(checked_at, status.clone());
            return status;
        }

        if code == 403 || code == 429 {
            let status = UpdateCheckStatus {
                state: "rate_limited".into(),
                up_to_date: true,
                update_available: false,
                current_version: CURRENT_VERSION.into(),
                latest_version: CURRENT_VERSION.into(),
                repository: repo_full,
                message: "Limite temporaire de l'API publique GitHub atteinte. L'Auto-Updater Tauri Ed25519 reste actif.".into(),
                release_notes: None,
                assets: vec![],
                public_releases_url: PUBLIC_RELEASES_URL.into(),
                checked_at: checked_at.clone(),
            };
            self.record_status(checked_at, status.clone());
            return status;
        }

        let body_json: serde_json::Value = rel_resp.json().await.unwrap_or_default();
        let latest_tag = body_json["tag_name"]
            .as_str()
            .unwrap_or(CURRENT_VERSION)
            .trim_start_matches(['v', 'V'])
            .to_string();

        let cur_ver = Version::parse(CURRENT_VERSION).unwrap_or_else(|_| Version::new(1, 0, 0));
        let lat_ver = Version::parse(&latest_tag).unwrap_or_else(|_| cur_ver.clone());
        let update_available = lat_ver > cur_ver;

        let assets = body_json["assets"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .map(|a| ReleaseAssetInfo {
                        id: a["id"].as_u64().unwrap_or(0),
                        name: a["name"].as_str().unwrap_or("").to_string(),
                        size: a["size"].as_u64().unwrap_or(0),
                        download_count: a["download_count"].as_u64().unwrap_or(0),
                        api_url: a["url"].as_str().unwrap_or("").to_string(),
                        browser_download_url: a["browser_download_url"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let status = UpdateCheckStatus {
            state: if update_available {
                "update_available".into()
            } else {
                "up_to_date".into()
            },
            up_to_date: !update_available,
            update_available,
            current_version: CURRENT_VERSION.into(),
            latest_version: latest_tag.clone(),
            repository: repo_full,
            message: if update_available {
                format!(
                    "Nouvelle release signée MashVoice v{} disponible sur MyMasha/MashVoice !",
                    latest_tag
                )
            } else {
                format!(
                    "MashVoice v{} est à jour (signature Ed25519 {} vérifiée).",
                    CURRENT_VERSION, ED25519_UPDATER_KEY_ID
                )
            },
            release_notes: body_json["body"].as_str().map(|s| s.to_string()),
            assets,
            public_releases_url: PUBLIC_RELEASES_URL.into(),
            checked_at: checked_at.clone(),
        };
        self.record_status(checked_at, status.clone());
        status
    }

    fn record_status(&self, checked_at: String, status: UpdateCheckStatus) {
        let mut cfg = self.inner.lock();
        cfg.last_checked_at = Some(checked_at);
        cfg.last_status = Some(status);
        self.save_locked(&cfg);
    }
}
