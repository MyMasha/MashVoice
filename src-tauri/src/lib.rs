use mashvoice_server::{build_router, AppState};
use serde_json::{json, Value};
use std::{
    fs,
    net::{SocketAddr, TcpListener as StdTcpListener},
    sync::Arc,
};
use tauri::{Emitter, Manager, State};

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
        "hasGithubToken": v["githubReadOnlyToken"].as_str().map(|s| !s.is_empty()).unwrap_or(false),
    })
}

#[tauri::command]
fn vault_set(state: State<'_, Arc<AppState>>, patch: Value) -> Result<Value, String> {
    if let Some(gh_tok) = patch["githubReadOnlyToken"].as_str() {
        state
            .updater
            .update_settings(Some(gh_tok.to_string()), None, None, None);
    }
    state.security.write_encrypted_vault(patch)?;
    Ok(json!({ "ok": true }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        let log_path = std::env::temp_dir().join("mashvoice-crash.log");
        let _ = fs::write(&log_path, format!("MashVoice panic: {info}\n"));
    }));

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

            // Bind synchronously on 0.0.0.0:3080 (with automatic free-port fallback if 3080 is busy)
            // so friends on LAN / VPN / Port-Forward can join this P2P host, and WebView2 connects via 127.0.0.1.
            let std_listener = StdTcpListener::bind(("0.0.0.0", 3080))
                .or_else(|_| StdTcpListener::bind(("0.0.0.0", 0)))?;
            std_listener.set_nonblocking(true)?;
            let port = std_listener.local_addr().map(|a| a.port()).unwrap_or(3080);

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
            vault_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running MashVoice Tauri Rust application");
}
