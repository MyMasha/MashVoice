use mashvoice_server::{build_router, AppState};
use serde_json::{json, Value};
use std::{
    fs,
    net::{SocketAddr, TcpListener as StdTcpListener},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{Emitter, Manager, State};

static SCREEN_SHARE_ACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
mod win32_overlay_guard {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};

    type HWND = isize;
    type BOOL = i32;
    type LPARAM = isize;
    type DWORD = u32;

    #[repr(C)]
    struct RECT {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct PROCESSENTRY32W {
        dw_size: DWORD,
        cnt_usage: DWORD,
        th32_process_id: DWORD,
        th32_default_heap_id: usize,
        th32_module_id: DWORD,
        cnt_threads: DWORD,
        th32_parent_process_id: DWORD,
        pc_pri_class_base: i32,
        dw_flags: DWORD,
        sz_exe_file: [u16; 260],
    }

    #[repr(C)]
    struct PROCESS_POWER_THROTTLING_STATE {
        version: DWORD,
        control_mask: DWORD,
        state_mask: DWORD,
    }

    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOPMOST: isize = 0x0000_0008;
    const WS_EX_NOACTIVATE: isize = 0x0800_0000;
    const SW_HIDE: i32 = 0;

    const TH32CS_SNAPPROCESS: DWORD = 0x0000_0002;
    const INVALID_HANDLE_VALUE: *mut c_void = -1isize as *mut c_void;

    const PROCESS_SET_INFORMATION: DWORD = 0x0200;
    const PROCESS_QUERY_LIMITED_INFORMATION: DWORD = 0x1000;
    const NORMAL_PRIORITY_CLASS: DWORD = 0x0000_0020;
    const ABOVE_NORMAL_PRIORITY_CLASS: DWORD = 0x0000_8000;

    const PROCESS_POWER_THROTTLING_CLASS: u32 = 4;
    const PROCESS_POWER_THROTTLING_CURRENT_VERSION: DWORD = 1;
    const PROCESS_POWER_THROTTLING_EXECUTION_SPEED: DWORD = 0x1;

    const ES_CONTINUOUS: DWORD = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: DWORD = 0x0000_0001;
    const ES_DISPLAY_REQUIRED: DWORD = 0x0000_0002;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(
            lp_enum_func: unsafe extern "system" fn(HWND, LPARAM) -> BOOL,
            l_param: LPARAM,
        ) -> BOOL;
        fn IsWindowVisible(hwnd: HWND) -> BOOL;
        fn GetWindowTextW(hwnd: HWND, lp_string: *mut u16, n_max_count: i32) -> i32;
        fn GetClassNameW(hwnd: HWND, lp_class_name: *mut u16, n_max_count: i32) -> i32;
        fn GetWindowRect(hwnd: HWND, lp_rect: *mut RECT) -> BOOL;
        fn GetWindowLongPtrW(hwnd: HWND, n_index: i32) -> isize;
        fn GetWindowThreadProcessId(hwnd: HWND, lpdw_process_id: *mut DWORD) -> DWORD;
        fn ShowWindow(hwnd: HWND, n_cmd_show: i32) -> BOOL;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(dw_flags: DWORD, th32_process_id: DWORD) -> *mut c_void;
        fn Process32FirstW(h_snapshot: *mut c_void, lppe: *mut PROCESSENTRY32W) -> BOOL;
        fn Process32NextW(h_snapshot: *mut c_void, lppe: *mut PROCESSENTRY32W) -> BOOL;
        fn OpenProcess(
            dw_desired_access: DWORD,
            b_inherit_handle: BOOL,
            dw_process_id: DWORD,
        ) -> *mut c_void;
        fn CloseHandle(h_object: *mut c_void) -> BOOL;
        fn GetCurrentProcess() -> *mut c_void;
        fn SetPriorityClass(h_process: *mut c_void, dw_priority_class: DWORD) -> BOOL;
        fn SetProcessInformation(
            h_process: *mut c_void,
            process_information_class: u32,
            process_information: *const c_void,
            process_information_size: DWORD,
        ) -> BOOL;
        fn SetThreadExecutionState(es_flags: DWORD) -> DWORD;
    }

    /// Collects MashVoice's own PID plus all descendant WebView2 (`msedgewebview2.exe`) PIDs.
    fn collect_process_tree_pids() -> Vec<DWORD> {
        let root_pid = std::process::id();
        let mut pairs: Vec<(DWORD, DWORD)> = Vec::with_capacity(64);

        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap != INVALID_HANDLE_VALUE && !snap.is_null() {
                let mut entry: PROCESSENTRY32W = zeroed();
                entry.dw_size = size_of::<PROCESSENTRY32W>() as DWORD;
                if Process32FirstW(snap, &mut entry) != 0 {
                    loop {
                        pairs.push((entry.th32_process_id, entry.th32_parent_process_id));
                        if Process32NextW(snap, &mut entry) == 0 {
                            break;
                        }
                    }
                }
                let _ = CloseHandle(snap);
            }
        }

        let mut tree = vec![root_pid];
        let mut added = true;
        while added {
            added = false;
            for &(pid, ppid) in &pairs {
                if tree.contains(&ppid) && !tree.contains(&pid) {
                    tree.push(pid);
                    added = true;
                }
            }
        }
        tree
    }

    /// Disables Windows 11 EcoQoS background throttling and boosts priority on MashVoice + WebView2
    /// child processes so fullscreen OpenGL/DirectX games (like Minecraft `javaw.exe`) never freeze streams.
    pub fn apply_stream_power_mode(active: bool) {
        let pids = collect_process_tree_pids();
        let priority = if active {
            ABOVE_NORMAL_PRIORITY_CLASS
        } else {
            NORMAL_PRIORITY_CLASS
        };
        let power_state = PROCESS_POWER_THROTTLING_STATE {
            version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            control_mask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            state_mask: 0, // 0 = never throttle execution speed (disable EcoQoS green leaf)
        };

        unsafe {
            if active {
                let _ = SetThreadExecutionState(
                    ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED,
                );
            } else {
                let _ = SetThreadExecutionState(ES_CONTINUOUS);
            }

            let self_h = GetCurrentProcess();
            let _ = SetPriorityClass(self_h, priority);
            let _ = SetProcessInformation(
                self_h,
                PROCESS_POWER_THROTTLING_CLASS,
                &power_state as *const _ as *const c_void,
                size_of::<PROCESS_POWER_THROTTLING_STATE>() as DWORD,
            );

            for pid in pids {
                if pid == std::process::id() {
                    continue;
                }
                let h = OpenProcess(
                    PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION,
                    0,
                    pid,
                );
                if !h.is_null() {
                    let _ = SetPriorityClass(h, priority);
                    let _ = SetProcessInformation(
                        h,
                        PROCESS_POWER_THROTTLING_CLASS,
                        &power_state as *const _ as *const c_void,
                        size_of::<PROCESS_POWER_THROTTLING_STATE>() as DWORD,
                    );
                    let _ = CloseHandle(h);
                }
            }
        }
    }

    struct EnumCtx {
        tree_pids: Vec<DWORD>,
        strict_tree_mode: bool,
        hidden_count: u32,
    }

    unsafe extern "system" fn enum_windows_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }

        let mut rect: RECT = zeroed();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return 1;
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        // The Chromium/WebView2 floating screen-share bar ("tauri.localhost partage votre écran...")
        // is ~320-850px wide and ~32-115px tall; MashVoice's main window is >= 680px tall.
        if !(20..=145).contains(&height) || !(180..=1300).contains(&width) {
            return 1;
        }

        let mut class_buf = [0u16; 128];
        let class_len = GetClassNameW(hwnd, class_buf.as_mut_ptr(), class_buf.len() as i32);
        if class_len <= 0 {
            return 1;
        }
        let class_name = String::from_utf16_lossy(&class_buf[..class_len as usize]);
        if !class_name.starts_with("Chrome_WidgetWin_") {
            return 1;
        }

        let mut title_buf = [0u16; 256];
        let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
        let title_lower = if title_len > 0 {
            String::from_utf16_lossy(&title_buf[..title_len as usize]).to_lowercase()
        } else {
            String::new()
        };

        let ctx = &mut *(lparam as *mut EnumCtx);
        let mut win_pid: DWORD = 0;
        let _ = GetWindowThreadProcessId(hwnd, &mut win_pid);
        let in_our_tree = ctx.tree_pids.contains(&win_pid);

        let explicit_title_match = title_lower.contains("tauri.localhost")
            || (in_our_tree
                && (title_lower.contains("partage votre")
                    || title_lower.contains("partage d")
                    || title_lower.contains("sharing your")
                    || title_lower.contains("is sharing")
                    || title_lower.contains("arrêter le partage")
                    || title_lower.contains("stop sharing")));

        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        // Dropdown <select> popups and tooltips always set WS_EX_NOACTIVATE; the screen-share
        // notification bar is topmost WITHOUT WS_EX_NOACTIVATE so its buttons can be clicked.
        let topmost_bar_match = ctx.strict_tree_mode
            && in_our_tree
            && height <= 125
            && (ex_style & WS_EX_TOPMOST) != 0
            && (ex_style & WS_EX_NOACTIVATE) == 0;

        if explicit_title_match || topmost_bar_match {
            // Identical to clicking "Masquer" on the bar: hides the overlay while keeping capture live!
            let _ = ShowWindow(hwnd, SW_HIDE);
            ctx.hidden_count += 1;
        }

        1
    }

    /// Sweeps top-level windows and hides WebView2's in-game floating screen-capture bar.
    pub fn hide_webview_capture_bars(strict_tree_mode: bool) -> u32 {
        let mut ctx = EnumCtx {
            tree_pids: collect_process_tree_pids(),
            strict_tree_mode,
            hidden_count: 0,
        };
        unsafe {
            let _ = EnumWindows(enum_windows_cb, &mut ctx as *mut EnumCtx as LPARAM);
        }
        ctx.hidden_count
    }
}

#[derive(Clone)]
struct BackendEndpoint {
    port: u16,
    http_origin: String,
    ws_origin: String,
}

#[tauri::command]
fn get_backend_url(state: State<'_, BackendEndpoint>) -> Value {
    json!({
        "port": state.port,
        "httpOrigin": state.http_origin,
        "wsOrigin": state.ws_origin,
    })
}

#[tauri::command]
fn window_control(window: tauri::Window, action: String) -> Result<(), String> {
    match action.as_str() {
        "minimize" => window.minimize().map_err(|e| e.to_string())?,
        "maximize" => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize().map_err(|e| e.to_string())?;
            } else {
                window.maximize().map_err(|e| e.to_string())?;
            }
        }
        "close" => window.close().map_err(|e| e.to_string())?,
        _ => {}
    }
    Ok(())
}

#[tauri::command]
fn get_hardware_info(state: State<'_, Arc<AppState>>) -> Value {
    json!({
        "config": state.hardware.get_config(),
        "specs": state.hardware.host_specs(),
        "telemetry": state.hardware.sample_telemetry(),
    })
}

#[tauri::command]
fn save_hardware_config(state: State<'_, Arc<AppState>>, patch: Value) -> Value {
    json!(state.hardware.update_config(patch))
}

#[tauri::command]
fn vault_get(state: State<'_, Arc<AppState>>) -> Value {
    let v = state.security.read_encrypted_vault();
    json!({
        "connectionToken": v["connectionToken"].as_str().unwrap_or(""),
        "savedUsername": v["savedUsername"].as_str().unwrap_or(""),
    })
}

#[tauri::command]
fn vault_set(state: State<'_, Arc<AppState>>, patch: Value) -> Result<Value, String> {
    state.security.write_encrypted_vault(patch)?;
    Ok(json!({ "ok": true }))
}

/// Activates/deactivates the in-game screen-share overlay auto-hider & anti-EcoQoS boost on Windows.
#[tauri::command]
fn set_screen_share_active(active: bool) -> Value {
    SCREEN_SHARE_ACTIVE.store(active, Ordering::Relaxed);
    #[cfg(target_os = "windows")]
    {
        win32_overlay_guard::apply_stream_power_mode(active);
        let hidden = win32_overlay_guard::hide_webview_capture_bars(active);
        return json!({ "ok": true, "active": active, "hiddenBars": hidden });
    }
    #[cfg(not(target_os = "windows"))]
    json!({ "ok": true, "active": active, "hiddenBars": 0 })
}

/// Clears any cached WebView2 "Deny" (`setting == 2`) rule on `media_stream_mic` / `media_stream_camera`
/// inside `EBWebView/Default/Preferences` so WebView2 immediately re-prompts the user for microphone access,
/// and optionally opens Windows Microphone Privacy settings (`ms-settings:privacy-microphone`).
#[tauri::command]
fn repair_microphone_access(app: tauri::AppHandle, open_os_settings: Option<bool>) -> Value {
    let mut cleared_webview = false;
    if let Ok(local_dir) = app.path().app_local_data_dir() {
        let prefs_path = local_dir
            .join("EBWebView")
            .join("Default")
            .join("Preferences");
        if let Ok(raw) = fs::read_to_string(&prefs_path) {
            if let Ok(mut doc) = serde_json::from_str::<Value>(&raw) {
                if let Some(exceptions) = doc
                    .pointer_mut("/profile/content_settings/exceptions")
                    .and_then(|v| v.as_object_mut())
                {
                    exceptions.remove("media_stream_mic");
                    exceptions.remove("media_stream_camera");
                    if let Ok(serialized) = serde_json::to_string(&doc) {
                        let _ = fs::write(&prefs_path, serialized);
                        cleared_webview = true;
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    if open_os_settings == Some(true) {
        let _ = std::process::Command::new("explorer.exe")
            .arg("ms-settings:privacy-microphone")
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    let _ = open_os_settings;

    json!({
        "ok": true,
        "clearedWebviewCache": cleared_webview,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        let log_path = std::env::temp_dir().join("mashvoice-crash.log");
        let _ = fs::write(&log_path, format!("MashVoice panic: {info}\n"));
    }));

    // Prevent WebView2 occlusion/background renderer throttling when fullscreen games (Minecraft, CS2, etc.) cover MashVoice
    if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-ipc-flooding-protection --autoplay-policy=no-user-gesture-required --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,WebRtcHideLocalIpsWithMdns",
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("mashvoice-tauri"));
            let _ = fs::create_dir_all(&data_dir);

            let (router, app_state) = build_router(&data_dir, None);
            app.manage(Arc::clone(&app_state));

            // Bind strictly on 127.0.0.1 loopback by default (Zero-IP P2P runs over wss://zyntra.win)
            // so no local port is exposed on public Wi-Fi and Windows Firewall never prompts.
            let bind_host = if std::env::var("MASHVOICE_BIND_PUBLIC").unwrap_or_default() == "true"
            {
                "0.0.0.0"
            } else {
                "127.0.0.1"
            };
            let std_listener = StdTcpListener::bind((bind_host, 3080))
                .or_else(|_| StdTcpListener::bind((bind_host, 0)))?;
            std_listener.set_nonblocking(true)?;
            let port = std_listener.local_addr().map(|a| a.port()).unwrap_or(3080);
            app_state.set_listen_port(port);

            let endpoint = BackendEndpoint {
                port,
                http_origin: format!("http://127.0.0.1:{port}"),
                ws_origin: format!("ws://127.0.0.1:{port}"),
            };
            app.manage(endpoint.clone());

            if let Some(win) = app.get_webview_window("main") {
                let js = format!(
                    "window.__MASH_API_ORIGIN__ = '{}'; window.__MASH_WS_ORIGIN__ = '{}';",
                    endpoint.http_origin, endpoint.ws_origin
                );
                let _ = win.eval(&js);
            }

            // Spawn embedded Rust P2P Signaling & Gatekeeper Server inside Tauri's Tokio runtime
            let server_state = Arc::clone(&app_state);
            tauri::async_runtime::spawn(async move {
                server_state.spawn_revocation_watchdog();
                if let Ok(listener) = tokio::net::TcpListener::from_std(std_listener) {
                    let _ = axum::serve(
                        listener,
                        router.into_make_service_with_connect_info::<SocketAddr>(),
                    )
                    .await;
                }
            });

            // Windows In-Game Screen-Share Overlay Bar Hider + Anti-EcoQoS Stream Keeper
            #[cfg(target_os = "windows")]
            tauri::async_runtime::spawn(async move {
                let mut tick: u32 = 0;
                loop {
                    let active = SCREEN_SHARE_ACTIVE.load(Ordering::Relaxed);
                    win32_overlay_guard::hide_webview_capture_bars(active);
                    if active && tick % 40 == 0 {
                        // Refresh anti-EcoQoS on any newly spawned WebView2 GPU/video child processes
                        win32_overlay_guard::apply_stream_power_mode(true);
                    }
                    tick = tick.wrapping_add(1);
                    let delay_ms = if active { 75 } else { 300 };
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
            });

            // Periodic 5s Native Rust Game Detector & RAM Guard telemetry emitter
            let handle = app.handle().clone();
            let telem_state = Arc::clone(&app_state);
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
                loop {
                    interval.tick().await;
                    let snap = telem_state.hardware.sample_telemetry();
                    let _ = handle.emit("hardware:telemetry", snap);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            window_control,
            get_hardware_info,
            save_hardware_config,
            vault_get,
            vault_set,
            set_screen_share_active,
            repair_microphone_access
        ])
        .run(tauri::generate_context!())
        .expect("error while running MashVoice Tauri Rust application");
}
