use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use sysinfo::{Pid, ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareConfig {
    pub render_backend: String,   // "gpu-dedicated" | "gpu-integrated" | "cpu-software"
    pub video_encoder: String,    // "nvenc-av1-h264" | "av1-hw" | "cpu-x264"
    pub max_ram_mb: u64,          // 512..=8192
    pub cpu_threads: usize,       // 1..=max_cores
    pub process_priority: String, // "below_normal_in_game" | "normal" | "high_stream"
    pub shader_preset: String,    // "turbo" | "balanced" | "quality"
    pub turbo_fps_mode: bool,
    pub auto_detect_games: bool,
    pub pause_shader_in_game: bool,
    pub zero_copy_capture: bool,
}

impl Default for HardwareConfig {
    fn default() -> Self {
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        Self {
            render_backend: "gpu-dedicated".into(),
            video_encoder: "nvenc-av1-h264".into(),
            max_ram_mb: 2048,
            cpu_threads: (cores / 2).clamp(2, 8),
            process_priority: "below_normal_in_game".into(),
            shader_preset: "balanced".into(),
            turbo_fps_mode: true,
            auto_detect_games: true,
            pause_shader_in_game: true,
            zero_copy_capture: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSpecs {
    pub cpu_cores: usize,
    pub cpu_model: String,
    pub total_mem_mb: u64,
    pub platform: String,
    pub engine: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareTelemetry {
    pub rss_mb: u64,
    pub max_ram_mb: u64,
    pub detected_game: Option<String>,
    pub render_backend: String,
    pub video_encoder: String,
    pub cpu_threads: usize,
}

const KNOWN_GAMES: &[(&str, &str)] = &[
    ("javaw", "Minecraft / MashClient"),
    ("minecraft", "Minecraft"),
    ("mashclient", "MashClient Singularity"),
    ("valorant", "VALORANT"),
    ("cs2", "Counter-Strike 2"),
    ("fortniteclient", "Fortnite"),
    ("gta5", "Grand Theft Auto V"),
    ("eldenring", "Elden Ring"),
    ("rocketleague", "Rocket League"),
    ("league of legends", "League of Legends"),
];

pub struct HardwareController {
    cfg_path: PathBuf,
    config: Mutex<HardwareConfig>,
    sys: Mutex<System>,
}

impl HardwareController {
    pub fn new(data_dir: &Path) -> Self {
        let _ = fs::create_dir_all(data_dir);
        let cfg_path = data_dir.join("hardware-config.json");
        let initial = fs::read_to_string(&cfg_path)
            .ok()
            .and_then(|s| serde_json::from_str::<HardwareConfig>(&s).ok())
            .unwrap_or_default();

        let mut sys = System::new_all();
        sys.refresh_memory();

        Self {
            cfg_path,
            config: Mutex::new(initial),
            sys: Mutex::new(sys),
        }
    }

    pub fn get_config(&self) -> HardwareConfig {
        self.config.lock().clone()
    }

    pub fn update_config(&self, patch: serde_json::Value) -> HardwareConfig {
        let mut guard = self.config.lock();
        let mut as_val = serde_json::to_value(&*guard).unwrap_or_else(|_| serde_json::json!({}));
        if let (Some(dst), Some(src)) = (as_val.as_object_mut(), patch.as_object()) {
            for (k, v) in src {
                dst.insert(k.clone(), v.clone());
            }
        }
        if let Ok(mut parsed) = serde_json::from_value::<HardwareConfig>(as_val) {
            parsed.max_ram_mb = parsed.max_ram_mb.clamp(512, 16_384);
            parsed.cpu_threads = parsed.cpu_threads.clamp(1, 64);
            *guard = parsed;
            if let Ok(json) = serde_json::to_string_pretty(&*guard) {
                let _ = fs::write(&self.cfg_path, json);
            }
        }
        guard.clone()
    }

    pub fn host_specs(&self) -> HostSpecs {
        let sys = self.sys.lock();
        let cpu_cores = sys.cpus().len().max(1);
        let cpu_model = sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "x86_64 Multi-Core Processor".into());
        let total_mem_mb = sys.total_memory() / (1024 * 1024);

        HostSpecs {
            cpu_cores,
            cpu_model,
            total_mem_mb,
            platform: std::env::consts::OS.to_string(),
            engine: format!("Rust Native ({})", std::env::consts::ARCH),
        }
    }

    /// Ultra-fast native Rust process scan for active games & MashVoice RSS memory footprint
    pub fn sample_telemetry(&self) -> HardwareTelemetry {
        let cfg = self.get_config();
        let mut sys = self.sys.lock();
        sys.refresh_processes(ProcessesToUpdate::All);

        let self_pid = Pid::from_u32(std::process::id());
        let rss_mb = sys
            .process(self_pid)
            .map(|p| (p.memory() / (1024 * 1024)).max(8))
            .unwrap_or(14);

        let mut detected_game = None;
        if cfg.auto_detect_games {
            'outer: for proc_info in sys.processes().values() {
                let name = proc_info.name().to_string_lossy().to_lowercase();
                for (needle, title) in KNOWN_GAMES {
                    if name.contains(needle) {
                        detected_game = Some((*title).to_string());
                        break 'outer;
                    }
                }
            }
        }

        HardwareTelemetry {
            rss_mb,
            max_ram_mb: cfg.max_ram_mb,
            detected_game,
            render_backend: cfg.render_backend,
            video_encoder: cfg.video_encoder,
            cpu_threads: cfg.cpu_threads,
        }
    }
}
