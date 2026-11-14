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

pub const PREFILLED_GITHUB_TOKEN_URL: &str = concat!(
    "https://github.com/settings/personal-access-tokens/new",
    "?name=MashVoice+Auto-Updater",
    "&description=Token+Read-Only+(365+jours)+pour+l%27auto-updater+MashVoice+sur+MyMasha",
    "&target_name=MyMasha",
    "&expires_in=365",
    "&contents=read",
    "&metadata=read"
);

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
    pub token_expiration: Option<String>,
    pub release_notes: Option<String>,
    pub assets: Vec<ReleaseAssetInfo>,
    pub prefilled_token_url: String,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredUpdaterConfig {
    pub channel: String,
    pub auto_check: bool,
    pub auto_download: bool,
    pub read_only_token: String,
    pub last_checked_at: Option<String>,
    pub last_status: Option<UpdateCheckStatus>,
}

impl Default for StoredUpdaterConfig {
    fn default() -> Self {
        Self {
            channel: "stable".into(),
            auto_check: true,
            auto_download: true,
            read_only_token: std::env::var("MASHVOICE_UPDATER_TOKEN").unwrap_or_default(),
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
    pub has_token: bool,
    pub masked_token: Option<String>,
    pub prefilled_token_url: String,
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
            .user_agent(format!("MashVoice-Rust-AutoUpdater/{}", CURRENT_VERSION))
            .build()
            .unwrap_or_default();

        Self {
            cfg_path,
            inner: Mutex::new(loaded),
            http,
        }
    }

    fn save_locked(&self, cfg: &StoredUpdaterConfig) {
        if let Ok(json) = serde_json::to_string_pretty(cfg) {
            let _ = fs::write(&self.cfg_path, json);
        }
    }

    pub fn get_sanitized(&self) -> SanitizedUpdaterConfig {
        let cfg = self.inner.lock();
        let tok = if !cfg.read_only_token.is_empty() {
            cfg.read_only_token.clone()
        } else {
            std::env::var("MASHVOICE_UPDATER_TOKEN").unwrap_or_default()
        };

        let masked = if tok.len() > 14 {
            Some(format!("{}••••••••••••{}", &tok[..11], &tok[tok.len() - 4..]))
        } else if !tok.is_empty() {
            Some("••••••••••••".into())
        } else {
            None
        };

        SanitizedUpdaterConfig {
            owner: GITHUB_ORG.into(),
            repo: GITHUB_REPO.into(),
            current_version: CURRENT_VERSION.into(),
            channel: cfg.channel.clone(),
            auto_check: cfg.auto_check,
            auto_download: cfg.auto_download,
            has_token: !tok.is_empty(),
            masked_token: masked,
            prefilled_token_url: PREFILLED_GITHUB_TOKEN_URL.into(),
            last_checked_at: cfg.last_checked_at.clone(),
            last_status: cfg.last_status.clone(),
        }
    }

    pub fn update_settings(
        &self,
        read_only_token: Option<String>,
        auto_check: Option<bool>,
        auto_download: Option<bool>,
        channel: Option<String>,
    ) {
        let mut cfg = self.inner.lock();
        if let Some(t) = read_only_token {
            let trimmed = t.trim();
            if !trimmed.is_empty() {
                cfg.read_only_token = trimmed.to_string();
            }
        }
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
        let token = {
            let cfg = self.inner.lock();
            if !cfg.read_only_token.is_empty() {
                cfg.read_only_token.clone()
            } else {
                std::env::var("MASHVOICE_UPDATER_TOKEN").unwrap_or_default()
            }
        };

        let checked_at = Utc::now().to_rfc3339();
        let repo_full = format!("{}/{}", GITHUB_ORG, GITHUB_REPO);

        if token.trim().is_empty() {
            let status = UpdateCheckStatus {
                state: "token_required".into(),
                up_to_date: true,
                update_available: false,
                current_version: CURRENT_VERSION.into(),
                latest_version: CURRENT_VERSION.into(),
                repository: repo_full,
                message: "Dépôt privé MyMasha/MashVoice détecté : ajoutez votre token GitHub Read-Only (365 jours) pour activer l'Auto-Updater Rust.".into(),
                token_expiration: None,
                release_notes: None,
                assets: vec![],
                prefilled_token_url: PREFILLED_GITHUB_TOKEN_URL.into(),
                checked_at: checked_at.clone(),
            };
            self.record_status(checked_at, status.clone());
            return status;
        }

        let repo_url = format!("https://api.github.com/repos/{}/{}", GITHUB_ORG, GITHUB_REPO);
        let repo_resp = self
            .http
            .get(&repo_url)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {}", token.trim()))
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await;

        let Ok(resp) = repo_resp else {
            let status = UpdateCheckStatus {
                state: "network_offline".into(),
                up_to_date: true,
                update_available: false,
                current_version: CURRENT_VERSION.into(),
                latest_version: CURRENT_VERSION.into(),
                repository: repo_full,
                message: "Mode hors-ligne / réseau restreint. Nouvelle vérification programmée automatiquement.".into(),
                token_expiration: None,
                release_notes: None,
                assets: vec![],
                prefilled_token_url: PREFILLED_GITHUB_TOKEN_URL.into(),
                checked_at: checked_at.clone(),
            };
            self.record_status(checked_at, status.clone());
            return status;
        };

        let exp_header = resp
            .headers()
            .get("github-authentication-token-expiration")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let code = resp.status().as_u16();
        if code == 401 || code == 403 {
            let status = UpdateCheckStatus {
                state: "auth_error".into(),
                up_to_date: false,
                update_available: false,
                current_version: CURRENT_VERSION.into(),
                latest_version: CURRENT_VERSION.into(),
                repository: repo_full,
                message: "Token GitHub refusé ou expiré. Vérifiez que Resource Owner = MyMasha et Contents = Read-only.".into(),
                token_expiration: exp_header,
                release_notes: None,
                assets: vec![],
                prefilled_token_url: PREFILLED_GITHUB_TOKEN_URL.into(),
                checked_at: checked_at.clone(),
            };
            self.record_status(checked_at, status.clone());
            return status;
        }
        if code == 404 {
            let status = UpdateCheckStatus {
                state: "repo_not_accessible".into(),
                up_to_date: false,
                update_available: false,
                current_version: CURRENT_VERSION.into(),
                latest_version: CURRENT_VERSION.into(),
                repository: repo_full,
                message: "Ce token n'a pas accès à MyMasha/MashVoice. Sélectionnez MyMasha comme Resource Owner.".into(),
                token_expiration: exp_header,
                release_notes: None,
                assets: vec![],
                prefilled_token_url: PREFILLED_GITHUB_TOKEN_URL.into(),
                checked_at: checked_at.clone(),
            };
            self.record_status(checked_at, status.clone());
            return status;
        }

        let rel_url = format!(
            "https://api.github.com/repos/{}/{}/releases/latest",
            GITHUB_ORG, GITHUB_REPO
        );
        let Ok(rel_resp) = self
            .http
            .get(&rel_url)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {}", token.trim()))
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
        else {
            let status = UpdateCheckStatus {
                state: "up_to_date".into(),
                up_to_date: true,
                update_available: false,
                current_version: CURRENT_VERSION.into(),
                latest_version: CURRENT_VERSION.into(),
                repository: repo_full,
                message: format!("MashVoice Rust v{} connecté à MyMasha/MashVoice.", CURRENT_VERSION),
                token_expiration: exp_header,
                release_notes: None,
                assets: vec![],
                prefilled_token_url: PREFILLED_GITHUB_TOKEN_URL.into(),
                checked_at: checked_at.clone(),
            };
            self.record_status(checked_at, status.clone());
            return status;
        };

        if rel_resp.status().as_u16() == 404 {
            let status = UpdateCheckStatus {
                state: "up_to_date_no_release".into(),
                up_to_date: true,
                update_available: false,
                current_version: CURRENT_VERSION.into(),
                latest_version: CURRENT_VERSION.into(),
                repository: repo_full,
                message: format!(
                    "Connecté en Read-Only à MyMasha/MashVoice. Version Rust v{} à jour.",
                    CURRENT_VERSION
                ),
                token_expiration: exp_header,
                release_notes: None,
                assets: vec![],
                prefilled_token_url: PREFILLED_GITHUB_TOKEN_URL.into(),
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
                    "Nouvelle release MashVoice Rust v{} disponible sur MyMasha/MashVoice !",
                    latest_tag
                )
            } else {
                format!(
                    "MashVoice Rust v{} est à jour via MyMasha/MashVoice.",
                    CURRENT_VERSION
                )
            },
            token_expiration: exp_header,
            release_notes: body_json["body"].as_str().map(|s| s.to_string()),
            assets,
            prefilled_token_url: PREFILLED_GITHUB_TOKEN_URL.into(),
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
