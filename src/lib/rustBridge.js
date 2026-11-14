import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Bridge between MashVoice UI and the Native Local Rust Engine (Tauri v2 IPC + Loopback Axum).
 * External relay traffic (`https://zyntra.win` & `wss://zyntra.win`) passes directly untouched.
 */
export function installRustBridge() {
  if (typeof window === 'undefined') return;
  if (window.mashNative) return;

  // Purge any legacy IP remote-node override from older versions
  try {
    localStorage.removeItem('mashvoice.remoteNodeUrl');
  } catch {
    // ignore
  }

  const isTauri = Boolean(
    window.__TAURI_INTERNALS__ ||
      window.location?.hostname === 'tauri.localhost' ||
      window.location?.protocol === 'tauri:'
  );

  if (isTauri) {
    let localApiOrigin = window.__MASH_API_ORIGIN__ || 'http://127.0.0.1:3080';
    let localWsOrigin = window.__MASH_WS_ORIGIN__ || 'ws://127.0.0.1:3080';

    const resolveApiOrigin = () => window.__MASH_API_ORIGIN__ || localApiOrigin;
    const resolveWsOrigin = () => window.__MASH_WS_ORIGIN__ || localWsOrigin;

    const backendReady = invoke('get_backend_url')
      .then((info) => {
        if (info?.httpOrigin) localApiOrigin = info.httpOrigin;
        if (info?.wsOrigin) localWsOrigin = info.wsOrigin;
      })
      .catch(() => {});

    // Rewrite relative /api/... calls strictly to local loopback Rust engine;
    // external HTTPS URLs (e.g. https://zyntra.win/api/mashvoice/*) pass straight through.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      await backendReady;
      const curApi = resolveApiOrigin();
      if (typeof input === 'string') {
        if (input.startsWith('/api/') || input === '/api') {
          return nativeFetch(`${curApi}${input}`, init);
        }
        if (input.includes('tauri.localhost/api/')) {
          const idx = input.indexOf('/api/');
          return nativeFetch(`${curApi}${input.slice(idx)}`, init);
        }
      }
      return nativeFetch(input, init);
    };

    // Rewrite local /ws strictly to local loopback Rust engine;
    // external WSS URLs (e.g. wss://zyntra.win/api/mashvoice/ws) pass straight through.
    const NativeWebSocket = window.WebSocket;
    const PatchedWebSocket = function (url, protocols) {
      let target = String(url);
      const curWs = resolveWsOrigin();
      const isExternalRelay =
        /^wss?:\/\//i.test(target) &&
        !target.includes('tauri.localhost') &&
        !(window.location?.host && target.includes(window.location.host));

      if (!isExternalRelay) {
        const isLocalWs =
          target.startsWith('/ws') ||
          target.includes('tauri.localhost/ws') ||
          (window.location?.host && target.includes(`${window.location.host}/ws`));
        if (isLocalWs) {
          const idx = target.indexOf('/ws');
          if (idx !== -1) {
            target = `${curWs}${target.slice(idx)}`;
          }
        }
      }
      return protocols !== undefined
        ? new NativeWebSocket(target, protocols)
        : new NativeWebSocket(target);
    };
    PatchedWebSocket.prototype = NativeWebSocket.prototype;
    PatchedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
    PatchedWebSocket.OPEN = NativeWebSocket.OPEN;
    PatchedWebSocket.CLOSING = NativeWebSocket.CLOSING;
    PatchedWebSocket.CLOSED = NativeWebSocket.CLOSED;
    window.WebSocket = PatchedWebSocket;

    window.mashNative = {
      isTauri: true,
      isElectron: true, // enables custom frameless Singularity window controls
      windowControl: (action) => invoke('window_control', { action }),
      getHardwareInfo: () => invoke('get_hardware_info'),
      saveHardwareConfig: (patch) => invoke('save_hardware_config', { patch }),
      getVault: () => invoke('vault_get'),
      setVault: (patch) => invoke('vault_set', { patch }),
      setScreenShareActive: (active) =>
        invoke('set_screen_share_active', { active: Boolean(active) }).catch(() => ({ ok: false })),
      repairMicrophoneAccess: (openOsSettings = false) =>
        invoke('repair_microphone_access', { openOsSettings }),
      onHardwareTelemetry: (cb) => {
        let unlisten = null;
        listen('hardware:telemetry', (ev) => cb(ev.payload))
          .then((fn) => {
            unlisten = fn;
          })
          .catch(() => {});
        return () => unlisten?.();
      },
    };
  } else {
    window.mashNative = {
      isTauri: false,
      isElectron: false,
      setScreenShareActive: async () => ({ ok: true, hiddenBars: 0 }),
      repairMicrophoneAccess: async () => ({ ok: true, clearedWebviewDenials: 0 }),
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
