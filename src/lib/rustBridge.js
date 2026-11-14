/**
 * Bridge between MashVoice UI and the Native Rust Engine (Tauri v2 IPC + Rust Axum Telemetry)
 */
export function installRustBridge() {
  if (typeof window === 'undefined') return;
  if (window.mashNative) return;

  const isTauri = Boolean(window.__TAURI_INTERNALS__);

  if (isTauri) {
    import('@tauri-apps/api/core')
      .then(({ invoke }) => {
        window.mashNative = {
          isTauri: true,
          isElectron: true, // enables custom frameless Singularity window controls
          windowControl: (action) => invoke('window_control', { action }),
          getHardwareInfo: () => invoke('get_hardware_info'),
          saveHardwareConfig: (patch) => invoke('save_hardware_config', { patch }),
          getVault: () => invoke('vault_get'),
          setVault: (patch) => invoke('vault_set', { patch }),
          onHardwareTelemetry: (cb) => {
            let unlisten = null;
            import('@tauri-apps/api/event').then(({ listen }) => {
              listen('hardware:telemetry', (ev) => cb(ev.payload)).then((fn) => {
                unlisten = fn;
              });
            });
            return () => unlisten?.();
          },
        };
      })
      .catch(() => {});
  } else {
    // Web / Remote Preview mode connected directly to the Rust Axum P2P Engine
    window.mashNative = {
      isTauri: false,
      isElectron: false,
      saveHardwareConfig: (patch) =>
        fetch('/api/hardware/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).then((r) => r.json()),
      onHardwareTelemetry: (cb) => {
        const poll = () => {
          fetch('/api/hardware/telemetry')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d) cb(d);
            })
            .catch(() => {});
        };
        poll();
        const timer = setInterval(poll, 5000);
        return () => clearInterval(timer);
      },
    };
  }
}
