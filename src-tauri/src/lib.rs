use mashvoice_server::{build_router, AppState};
use serde_json::{json, Value};
use std::{net::SocketAddr, sync::Arc};
use tauri::{Emitter, Manager, State};

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
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("mashvoice-tauri"));

            let (router, app_state) = build_router(&data_dir, None);
            app.manage(Arc::clone(&app_state));

            // Spawn embedded Rust P2P Signaling & Gatekeeper Server on 127.0.0.1:3080
            tauri::async_runtime::spawn(async move {
                let addr = SocketAddr::from(([127, 0, 0, 1], 3080));
                if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
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
            window_control,
            get_hardware_info,
            save_hardware_config,
            vault_get,
            vault_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running MashVoice Tauri Rust application");
}
