import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Bridge between MashVoice UI and the Native Rust Engine (Tauri v2 IPC + Rust Axum Telemetry)
 */
export function installRustBridge() {
  if (typeof window === 'undefined') return;
  if (window.mashNative) return;

  const isTauri = Boolean(
    window.__TAURI_INTERNALS__ ||
      window.location?.hostname === 'tauri.localhost' ||
      window.location?.protocol === 'tauri:'
  );

  if (isTauri) {
    let localApiOrigin = window.__MASH_API_ORIGIN__ || 'http://127.0.0.1:3080';
    let localWsOrigin = window.__MASH_WS_ORIGIN__ || 'ws://127.0.0.1:3080';
    let remoteNodeHttp = (localStorage.getItem('mashvoice.remoteNodeUrl') || '').trim();

    const normalizeRemote = (raw) => {
      const s = (raw || '').trim().replace(/\/+$/, '');
      if (!s) return '';
      if (/^https?:\/\//i.test(s)) return s;
      return `http://${s.includes(':') ? s : `${s}:3080`}`;
    };
    remoteNodeHttp = normalizeRemote(remoteNodeHttp);

    const resolveApiOrigin = () =>
      remoteNodeHttp || window.__MASH_API_ORIGIN__ || localApiOrigin;
    const resolveWsOrigin = () => {
      if (remoteNodeHttp) {
        return remoteNodeHttp.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
      }
      return window.__MASH_WS_ORIGIN__ || localWsOrigin;
    };

    const backendReady = invoke('get_backend_url')
      .then((info) => {
        if (info?.httpOrigin) localApiOrigin = info.httpOrigin;
        if (info?.wsOrigin) localWsOrigin = info.wsOrigin;
      })
      .catch(() => {});

    // Rewrite relative /api/... calls to either local Rust server or friend's P2P host
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

    // Rewrite WebSocket /ws... to local Rust server or friend's P2P host
    const NativeWebSocket = window.WebSocket;
    const PatchedWebSocket = function (url, protocols) {
      let target = String(url);
      const curWs = resolveWsOrigin();
      if (target.includes('tauri.localhost/ws') || target.startsWith('/ws') || remoteNodeHttp) {
        const idx = target.indexOf('/ws');
        if (idx !== -1) {
          target = `${curWs}${target.slice(idx)}`;
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
      getRemoteNode: () => remoteNodeHttp,
      setRemoteNode: (url) => {
        remoteNodeHttp = normalizeRemote(url);
        if (remoteNodeHttp) {
          localStorage.setItem('mashvoice.remoteNodeUrl', remoteNodeHttp);
        } else {
          localStorage.removeItem('mashvoice.remoteNodeUrl');
        }
        return remoteNodeHttp;
      },
      windowControl: (action) => invoke('window_control', { action }),
      getHardwareInfo: () => invoke('get_hardware_info'),
      saveHardwareConfig: (patch) => invoke('save_hardware_config', { patch }),
      getVault: () => invoke('vault_get'),
      setVault: (patch) => invoke('vault_set', { patch }),
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
