use chrono::Utc;
use parking_lot::Mutex;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU8, Ordering},
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

pub const BUNDLED_CHANGELOG_NOTES: &str = "\
### ✨ Nouveautés MashVoice Singularity v1.0.7\n\
- **🚫 Suppression Automatique de la Barre en Jeu** : La barre flottante Windows/WebView2 (`tauri.localhost partage votre écran...`) est désormais détectée et masquée instantanément en arrière-plan (< 75 ms) sans couper le partage.\n\
- **🎞️ Sélecteur Stream Complet (`720p, 1080p, 2K, 4K` & `15, 30, 60, 120 FPS`)** : Nouvelle fenêtre « Configurer ton Stream P2P » + sélecteurs rapides en direct jusqu'à **4K UHD @ 120 FPS** (42 Mbps).\n\
- **🧊 Correctif Anti-Freeze Minecraft & Jeux Plein Écran** : Désactivation native de `CalculateNativeWinOcclusion`, du bridage Windows 11 `EcoQoS` sur les processus WebView2 et ajout d'un Watchdog anti-gel WebRTC OpenGL.\n\
- **⚡ Build Local Instantané & Release Rapide** : Nouveau script `npm run release:local` (`scripts/publish-local-release.ps1`) pour builder en local sur votre PC et publier directement sur GitHub Releases + profil Rust parallèle 16 unités.\n\
- **🛡️ MashKrisp™ IA, Réparation Micro 1-Clic & Auto-Updater Sans SmartScreen** : Toujours inclus et actifs.";

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
pub struct ChangelogEntry {
    pub version: String,
    pub title: String,
    pub notes: String,
    pub published_at: String,
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
    #[serde(default)]
    pub last_seen_version: Option<String>,
    #[serde(default)]
    pub pending_changelog: Option<ChangelogEntry>,
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
            last_seen_version: Some(CURRENT_VERSION.to_string()),
            pending_changelog: None,
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
    pub install_state: String,
    pub download_percent: u8,
    pub pending_changelog: Option<ChangelogEntry>,
    pub current_changelog: ChangelogEntry,
    pub last_checked_at: Option<String>,
    pub last_status: Option<UpdateCheckStatus>,
}

fn with_appended_ext(base: &Path, suffix: &str) -> PathBuf {
    let mut os = base.as_os_str().to_os_string();
    os.push(".");
    os.push(suffix);
    PathBuf::from(os)
}

/// Silently removes any leftover `.exe.old` binary created by a previous atomic hot-swap update.
pub fn cleanup_old_binary() {
    if let Ok(current_exe) = std::env::current_exe() {
        let _ = fs::remove_file(with_appended_ext(&current_exe, "old"));
        let _ = fs::remove_file(current_exe.with_extension("exe.old"));
    }
}

pub struct UpdaterService {
    cfg_path: PathBuf,
    inner: Mutex<StoredUpdaterConfig>,
    install_state: Mutex<String>,
    download_percent: AtomicU8,
    http: reqwest::Client,
    dl_http: reqwest::Client,
}

impl UpdaterService {
    pub fn new(data_dir: &Path) -> Self {
        cleanup_old_binary();
        let _ = fs::create_dir_all(data_dir);
        let cfg_path = data_dir.join("updater-config.json");
        let existed_on_disk = cfg_path.is_file();

        let mut loaded = fs::read_to_string(&cfg_path)
            .ok()
            .and_then(|s| serde_json::from_str::<StoredUpdaterConfig>(&s).ok())
            .unwrap_or_default();

        let launched_after_update = std::env::args().any(|a| a == "--after-update");
        let upgraded_from_older = existed_on_disk
            && loaded
                .last_seen_version
                .as_deref()
                .map(|prev| {
                    let p = Version::parse(prev.trim_start_matches('v'))
                        .unwrap_or_else(|_| Version::new(0, 0, 0));
                    let c = Version::parse(CURRENT_VERSION)
                        .unwrap_or_else(|_| Version::new(1, 0, 0));
                    c > p
                })
                .unwrap_or(true);

        if (launched_after_update || upgraded_from_older) && loaded.pending_changelog.is_none() {
            let notes = loaded
                .last_status
                .as_ref()
                .and_then(|st| st.release_notes.clone())
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| BUNDLED_CHANGELOG_NOTES.to_string());

            loaded.pending_changelog = Some(ChangelogEntry {
                version: CURRENT_VERSION.to_string(),
                title: format!("MashVoice Singularity v{} — Notes de mise à jour", CURRENT_VERSION),
                notes,
                published_at: Utc::now().to_rfc3339(),
            });
        }
        loaded.last_seen_version = Some(CURRENT_VERSION.to_string());

        let initial_state = if loaded
            .last_status
            .as_ref()
            .map(|s| {
                let lat = Version::parse(s.latest_version.trim_start_matches('v'))
                    .unwrap_or_else(|_| Version::new(0, 0, 0));
                let cur =
                    Version::parse(CURRENT_VERSION).unwrap_or_else(|_| Version::new(1, 0, 0));
                lat > cur
            })
            .unwrap_or(false)
        {
            "available".to_string()
        } else {
            "idle".to_string()
        };

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent(format!("MashVoice-OpenSource-AutoUpdater/{}", CURRENT_VERSION))
            .build()
            .unwrap_or_default();

        let dl_http = reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .user_agent(format!("MashVoice-OpenSource-AutoUpdater/{}", CURRENT_VERSION))
            .build()
            .unwrap_or_default();

        let svc = Self {
            cfg_path,
            inner: Mutex::new(loaded),
            install_state: Mutex::new(initial_state),
            download_percent: AtomicU8::new(0),
            http,
            dl_http,
        };
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

    pub fn current_bundled_changelog(&self) -> ChangelogEntry {
        let cfg = self.inner.lock();
        let notes = cfg
            .pending_changelog
            .as_ref()
            .map(|c| c.notes.clone())
            .or_else(|| {
                cfg.last_status
                    .as_ref()
                    .and_then(|s| {
                        if s.latest_version == CURRENT_VERSION {
                            s.release_notes.clone()
                        } else {
                            None
                        }
                    })
            })
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| BUNDLED_CHANGELOG_NOTES.to_string());

        ChangelogEntry {
            version: CURRENT_VERSION.to_string(),
            title: format!("MashVoice Singularity v{} — Notes de version", CURRENT_VERSION),
            notes,
            published_at: Utc::now().to_rfc3339(),
        }
    }

    pub fn ack_changelog(&self) -> SanitizedUpdaterConfig {
        {
            let mut cfg = self.inner.lock();
            cfg.pending_changelog = None;
            cfg.last_seen_version = Some(CURRENT_VERSION.to_string());
            self.save_locked(&cfg);
        }
        self.get_sanitized()
    }

    pub fn get_sanitized(&self) -> SanitizedUpdaterConfig {
        let current_changelog = self.current_bundled_changelog();
        let cfg = self.inner.lock();
        let state = self.install_state.lock().clone();
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
            install_state: state,
            download_percent: self.download_percent.load(Ordering::Relaxed),
            pending_changelog: cfg.pending_changelog.clone(),
            current_changelog,
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
                    "Nouvelle version MashVoice v{} prête à installer en 1 clic !",
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

        {
            let mut st = self.install_state.lock();
            if *st != "downloading" && *st != "ready_restart" {
                *st = if update_available {
                    "available".into()
                } else {
                    "idle".into()
                };
            }
        }

        self.record_status(checked_at, status.clone());
        status
    }

    /// Downloads the portable Windows `.exe` asset directly via Rust (`reqwest` — zero browser
    /// `Zone.Identifier` Mark-of-the-Web so SmartScreen never triggers!), verifies its `MZ` PE
    /// header, atomically swaps `current_exe -> .exe.old` and `.exe.new -> current_exe`, and
    /// persists `pending_changelog` so the Changelog modal opens right after restart.
    pub async fn install_update(&self) -> Result<SanitizedUpdaterConfig, String> {
        let mut status_opt = self.inner.lock().last_status.clone();
        if status_opt.as_ref().map(|s| !s.update_available).unwrap_or(true) {
            status_opt = Some(self.check_github_updates().await);
        }
        let status = status_opt.ok_or_else(|| "Aucune information de mise à jour disponible.".to_string())?;
        if !status.update_available {
            return Err(format!("MashVoice v{} est déjà à jour.", CURRENT_VERSION));
        }

        // Prefer portable `mashvoice-tauri_windows_x64.exe` for zero-UI atomic hot-swap (like MashClient),
        // falling back to `setup.exe` if needed.
        let target_asset = status
            .assets
            .iter()
            .find(|a| {
                let n = a.name.to_ascii_lowercase();
                n.ends_with(".exe") && !n.contains("setup") && !n.ends_with(".sig")
            })
            .or_else(|| {
                status
                    .assets
                    .iter()
                    .find(|a| a.name.to_ascii_lowercase().ends_with("-setup.exe"))
            })
            .cloned()
            .ok_or_else(|| "Aucun exécutable Windows (.exe) trouvé dans la Release GitHub.".to_string())?;

        *self.install_state.lock() = "downloading".into();
        self.download_percent.store(2, Ordering::Relaxed);

        let dl_res = async {
            let mut resp = self
                .dl_http
                .get(&target_asset.browser_download_url)
                .send()
                .await
                .map_err(|e| format!("Échec du téléchargement GitHub Releases: {e}"))?;

            if !resp.status().is_success() {
                return Err(format!(
                    "Serveur GitHub Releases a répondu HTTP {}",
                    resp.status().as_u16()
                ));
            }

            let total_size = resp
                .content_length()
                .filter(|&n| n > 0)
                .unwrap_or(target_asset.size.max(1));

            let current_exe = std::env::current_exe()
                .map_err(|e| format!("Chemin de l'exécutable courant inaccessible: {e}"))?;

            // Only hot-swap on Windows `.exe`; on non-Windows dev preview, write to data_dir staging
            let is_windows_exe = cfg!(windows)
                || current_exe
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case("exe"))
                    .unwrap_or(false);

            let new_exe = if is_windows_exe {
                with_appended_ext(&current_exe, "new")
            } else {
                self.cfg_path.with_file_name("mashvoice-staged-update.bin")
            };
            let _ = fs::remove_file(&new_exe);

            let mut file = fs::File::create(&new_exe)
                .map_err(|e| format!("Impossible de préparer le fichier de mise à jour: {e}"))?;

            let mut received: u64 = 0;
            let mut header_probe = Vec::with_capacity(4);

            while let Some(chunk) = resp
                .chunk()
                .await
                .map_err(|e| format!("Interruption du flux de téléchargement: {e}"))?
            {
                if header_probe.len() < 2 {
                    let take = (2 - header_probe.len()).min(chunk.len());
                    header_probe.extend_from_slice(&chunk[..take]);
                }
                file.write_all(&chunk)
                    .map_err(|e| format!("Erreur d'écriture disque: {e}"))?;
                received += chunk.len() as u64;
                let pct = ((received.saturating_mul(96)) / total_size.max(1)).clamp(2, 97) as u8;
                self.download_percent.store(pct, Ordering::Relaxed);
            }
            file.flush().ok();
            drop(file);

            if header_probe.len() < 2 || &header_probe[..2] != b"MZ" || received < 256 * 1024 {
                let _ = fs::remove_file(&new_exe);
                return Err("Le binaire téléchargé est incomplet ou invalide (en-tête PE manquant).".into());
            }

            // Explicitly strip NTFS Zone.Identifier Mark-of-the-Web if present so SmartScreen never pops up
            let ads_path = format!("{}:Zone.Identifier", new_exe.display());
            let _ = fs::remove_file(&ads_path);

            if is_windows_exe {
                let is_setup_installer = target_asset.name.to_ascii_lowercase().contains("setup");
                if is_setup_installer {
                    // Launch silent current-user NSIS update without SmartScreen
                    Command::new(&new_exe)
                        .arg("/S")
                        .spawn()
                        .map_err(|e| format!("Impossible de lancer l'installateur silencieux: {e}"))?;
                } else {
                    let old_exe = with_appended_ext(&current_exe, "old");
                    let _ = fs::remove_file(&old_exe);
                    fs::rename(&current_exe, &old_exe).map_err(|e| {
                        let _ = fs::remove_file(&new_exe);
                        format!("Impossible de renommer l'exécutable actif: {e}")
                    })?;

                    if let Err(e) = fs::rename(&new_exe, &current_exe) {
                        let _ = fs::rename(&old_exe, &current_exe);
                        let _ = fs::remove_file(&new_exe);
                        return Err(format!("Échec du remplacement atomique de l'exécutable: {e}"));
                    }
                    let cur_ads = format!("{}:Zone.Identifier", current_exe.display());
                    let _ = fs::remove_file(&cur_ads);
                }
            }

            Ok(())
        }
        .await;

        if let Err(err) = dl_res {
            *self.install_state.lock() = "available".into();
            self.download_percent.store(0, Ordering::Relaxed);
            return Err(err);
        }

        let notes = status
            .release_notes
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| BUNDLED_CHANGELOG_NOTES.to_string());

        {
            let mut cfg = self.inner.lock();
            cfg.pending_changelog = Some(ChangelogEntry {
                version: status.latest_version.clone(),
                title: format!(
                    "MashVoice Singularity v{} — Nouveautés installées",
                    status.latest_version
                ),
                notes,
                published_at: Utc::now().to_rfc3339(),
            });
            cfg.last_seen_version = Some(status.latest_version.clone());
            self.save_locked(&cfg);
        }

        self.download_percent.store(100, Ordering::Relaxed);
        *self.install_state.lock() = "ready_restart".into();
        Ok(self.get_sanitized())
    }

    pub fn restart_application(&self) -> Result<(), String> {
        let current_exe =
            std::env::current_exe().map_err(|e| format!("Exécutable introuvable: {e}"))?;
        if cfg!(windows)
            || current_exe
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("exe"))
                .unwrap_or(false)
        {
            Command::new(&current_exe)
                .arg("--after-update")
                .spawn()
                .map_err(|e| format!("Impossible de relancer MashVoice: {e}"))?;
            std::thread::spawn(|| {
                std::thread::sleep(Duration::from_millis(350));
                std::process::exit(0);
            });
        }
        Ok(())
    }

    fn record_status(&self, checked_at: String, status: UpdateCheckStatus) {
        let mut cfg = self.inner.lock();
        cfg.last_checked_at = Some(checked_at);
        cfg.last_status = Some(status);
        self.save_locked(&cfg);
    }
}
