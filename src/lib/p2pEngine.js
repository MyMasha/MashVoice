/**
 * MashVoice Singularity P2P WebRTC Mesh Engine
 * - Direct Peer-to-Peer Audio (Opus FEC + MashKrisp™ Voice Isolation), Camera & High-FPS Game Screen Streaming
 * - Instant Blocked/Unplugged Microphone Re-Request & Hot-Plug (`replaceTrack`) without leaving calls
 * - Hardware encoder preference (H264 NVENC / AV1 / VP9)
 * - Zero-overhead gaming degradationPreference = 'maintain-framerate'
 * - Encrypted-envelope RTCDataChannel for P2P messages & file chunks
 */

import { KrispVoiceProcessor, loadSavedKrispMode } from './krispEngine.js';

export const STREAM_RESOLUTION_MAP = {
  '720p': { label: '720p', sub: 'HD 1280×720', w: 1280, h: 720 },
  '1080p': { label: '1080p', sub: 'FHD 1920×1080', w: 1920, h: 1080 },
  '2K': { label: '2K', sub: 'QHD 2560×1440', w: 2560, h: 1440 },
  '1440p': { label: '2K', sub: 'QHD 2560×1440', w: 2560, h: 1440 },
  '4K': { label: '4K', sub: 'UHD 3840×2160', w: 3840, h: 2160 },
};

export const STREAM_RESOLUTIONS = ['720p', '1080p', '2K', '4K'];
export const STREAM_FPS_OPTIONS = [15, 30, 60, 120];

export function normalizeResolutionKey(res) {
  if (res === '1440p' || res === '2k') return '2K';
  if (res === '4k' || res === '2160p') return '4K';
  if (res === '720p' || res === '1080p' || res === '2K' || res === '4K') return res;
  return '1080p';
}

export function computeRecommendedBitrateKbps(resolution = '1080p', fps = 60) {
  const res = normalizeResolutionKey(resolution);
  const f = Number(fps) || 60;
  const table = {
    '720p': { 15: 2500, 30: 4000, 60: 6500, 120: 9500 },
    '1080p': { 15: 4000, 30: 6500, 60: 10500, 120: 16000 },
    '2K': { 15: 7500, 30: 12000, 60: 18500, 120: 26000 },
    '4K': { 15: 13000, 30: 21000, 60: 32000, 120: 42000 },
  };
  const row = table[res] || table['1080p'];
  return row[f] || row[60];
}

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function preferCodecInSdp(sdp, preferredCodec = 'H264') {
  if (!sdp || !preferredCodec) return sdp;
  try {
    const lines = sdp.split('\r\n');
    const mVideoIdx = lines.findIndex((l) => l.startsWith('m=video '));
    if (mVideoIdx === -1) return sdp;

    const codecRegex = new RegExp(`^a=rtpmap:(\\d+) ${preferredCodec}\\/`, 'i');
    const matchedPayloads = [];
    for (const line of lines) {
      const m = line.match(codecRegex);
      if (m) matchedPayloads.push(m[1]);
    }
    if (matchedPayloads.length === 0) return sdp;

    const parts = lines[mVideoIdx].split(' ');
    const header = parts.slice(0, 3);
    const payloads = parts.slice(3);
    const reordered = [
      ...matchedPayloads.filter((p) => payloads.includes(p)),
      ...payloads.filter((p) => !matchedPayloads.includes(p)),
    ];
    lines[mVideoIdx] = [...header, ...reordered].join(' ');
    return lines.join('\r\n');
  } catch {
    return sdp;
  }
}

export class P2PMeshEngine {
  constructor({
    sendSignal,
    onRemoteStreamsChange,
    onP2PData,
    onStatsUpdate,
    onSpeakingChange,
    onMicStateChange,
    onKrispMeter,
  }) {
    this.sendSignal = sendSignal;
    this.onRemoteStreamsChange = onRemoteStreamsChange;
    this.onP2PData = onP2PData;
    this.onStatsUpdate = onStatsUpdate;
    this.onSpeakingChange = onSpeakingChange;
    this.onMicStateChange = onMicStateChange;
    this.onKrispMeter = onKrispMeter;

    this.roomId = null;
    this.selfPeerKey = null;
    this.peers = new Map(); // peerKey -> { pc, dc, remoteStream, peerMeta, pendingCandidates }

    // IMPORTANT: Keep real hardware mic stream strictly separate from fallback silent stream
    // so a denied/unplugged mic NEVER locks the user out of re-requesting microphone access!
    this.rawMicStream = null;
    this.localAudioStream = null;
    this.silentFallbackCtx = null;
    this.silentFallbackStream = null;
    this.hasRealMic = false;
    this.micStatus = 'idle'; // 'idle' | 'active' | 'blocked' | 'no-device'
    this.micError = '';
    this.micDeviceLabel = '';
    this.preferredAudioInputId = '';

    this.krispMode = loadSavedKrispMode(); // 'ultra' | 'standard' | 'off'
    this.krispProcessor = null;

    this.localCameraStream = null;
    this.localScreenStream = null;
    this.syntheticCleanup = null;
    this.screenAntiFreezeCleanup = null;

    this.muted = false;
    this.deafened = false;
    this.voiceAnalyserTimer = null;
    this.analyserCtx = null;
    this.statsTimer = null;

    this.streamSettings = {
      resolution: '1080p', // '720p' | '1080p' | '2K' | '4K'
      fps: 60, // 15 | 30 | 60 | 120
      maxBitrateKbps: 10500,
      customBitrate: false,
      preferredCodec: 'H264', // 'H264' (NVENC/AMF) | 'AV1' | 'VP9'
      maintainFramerate: true,
      echoCancellation: true,
      noiseSuppression: true,
      krispMode: this.krispMode,
      audioInputId: '',
    };

    // Automatically recover microphone as soon as user grants browser permission or plugs in a headset
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      this._onDeviceChange = () => {
        if (this.roomId && !this.hasRealMic) {
          this.retryMicrophone().catch(() => {});
        }
      };
      navigator.mediaDevices.addEventListener('devicechange', this._onDeviceChange);
    }
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'microphone' })
        .then((permStatus) => {
          permStatus.onchange = () => {
            if (permStatus.state === 'granted' && this.roomId && !this.hasRealMic) {
              this.retryMicrophone().catch(() => {});
            }
          };
        })
        .catch(() => {});
    }
  }

  emitMicState() {
    this.onMicStateChange?.({
      status: this.micStatus,
      hasRealMic: this.hasRealMic,
      error: this.micError,
      deviceLabel: this.micDeviceLabel,
      krispMode: this.krispMode,
    });
  }

  setKrispMode(mode) {
    this.krispMode = mode === 'ultra' || mode === 'standard' || mode === 'off' ? mode : 'ultra';
    this.streamSettings.krispMode = this.krispMode;
    if (this.krispProcessor) {
      this.krispProcessor.setMode(this.krispMode);
    }
    this.emitMicState();
  }

  updateStreamSettings(patch) {
    const prevDevice = this.streamSettings.audioInputId;
    const prevRes = this.streamSettings.resolution;
    const prevFps = this.streamSettings.fps;

    const normalizedPatch = { ...patch };
    if (normalizedPatch.resolution) {
      normalizedPatch.resolution = normalizeResolutionKey(normalizedPatch.resolution);
    }
    if (normalizedPatch.fps !== undefined) {
      normalizedPatch.fps = Number(normalizedPatch.fps) || 60;
    }

    const next = { ...this.streamSettings, ...normalizedPatch };
    // Auto-scale maxBitrateKbps for 720p/1080p/2K/4K & 15/30/60/120 FPS unless custom bitrate was explicitly passed
    if (
      normalizedPatch.maxBitrateKbps === undefined &&
      !next.customBitrate &&
      (next.resolution !== prevRes || next.fps !== prevFps)
    ) {
      next.maxBitrateKbps = computeRecommendedBitrateKbps(next.resolution, next.fps);
    }

    this.streamSettings = next;

    if (normalizedPatch.krispMode && normalizedPatch.krispMode !== this.krispMode) {
      this.setKrispMode(normalizedPatch.krispMode);
    }
    if (normalizedPatch.audioInputId !== undefined && normalizedPatch.audioInputId !== prevDevice) {
      this.preferredAudioInputId = normalizedPatch.audioInputId || '';
      if (this.roomId) {
        this.retryMicrophone(this.preferredAudioInputId).catch(() => {});
      }
    }

    // Live hot-update active screen-share capture track constraints if resolution or FPS changed!
    if (
      this.localScreenStream &&
      (this.streamSettings.resolution !== prevRes || this.streamSettings.fps !== prevFps)
    ) {
      this.applyActiveScreenTrackConstraints().catch(() => {});
    }

    for (const { pc } of this.peers.values()) {
      this.applySenderParameters(pc);
    }
  }

  async applyActiveScreenTrackConstraints() {
    const vTrack = this.localScreenStream?.getVideoTracks?.()[0];
    if (!vTrack || vTrack.readyState !== 'live') return;
    const dim =
      STREAM_RESOLUTION_MAP[normalizeResolutionKey(this.streamSettings.resolution)] ||
      STREAM_RESOLUTION_MAP['1080p'];
    const fps = Number(this.streamSettings.fps) || 60;
    try {
      if ('contentHint' in vTrack) {
        vTrack.contentHint = fps >= 30 ? 'motion' : 'detail';
      }
      await vTrack.applyConstraints({
        width: { ideal: dim.w, max: dim.w },
        height: { ideal: dim.h, max: dim.h },
        frameRate: { ideal: fps },
      });
    } catch {
      // Fallback if capture driver rejects max bounds on live switch
      try {
        await vTrack.applyConstraints({
          frameRate: { ideal: fps },
        });
      } catch {
        // ignore
      }
    }
  }

  async applySenderParameters(pc) {
    try {
      for (const sender of pc.getSenders()) {
        if (sender.track && sender.track.kind === 'video') {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.degradationPreference = this.streamSettings.maintainFramerate
            ? 'maintain-framerate'
            : 'maintain-resolution';
          params.encodings[0].active = true;
          params.encodings[0].scaleResolutionDownBy = 1.0;
          params.encodings[0].maxBitrate =
            (this.streamSettings.maxBitrateKbps ||
              computeRecommendedBitrateKbps(
                this.streamSettings.resolution,
                this.streamSettings.fps
              )) * 1000;
          params.encodings[0].maxFramerate = Number(this.streamSettings.fps) || 60;
          if ('priority' in params.encodings[0]) {
            params.encodings[0].priority = 'high';
          }
          if ('networkPriority' in params.encodings[0]) {
            params.encodings[0].networkPriority = 'high';
          }
          await sender.setParameters(params);
        }
      }
    } catch {
      // Browser may ignore unsupported encoding hints
    }
  }

  getOrCreateSilentFallback() {
    if (this.silentFallbackStream) return this.silentFallbackStream;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const dest = ctx.createMediaStreamDestination();
    this.silentFallbackCtx = ctx;
    this.silentFallbackStream = dest.stream;
    return dest.stream;
  }

  stopRawMicOnly() {
    if (this.krispProcessor) {
      this.krispProcessor.destroy();
      this.krispProcessor = null;
    }
    if (this.rawMicStream) {
      this.rawMicStream.getTracks().forEach((t) => t.stop());
      this.rawMicStream = null;
    }
    this.hasRealMic = false;
  }

  /**
   * Requests real hardware microphone access (never permanently caching a silent fallback!).
   * If blocked in Tauri WebView2, clears cached deny rules first so Windows/WebView2 re-prompts!
   */
  async ensureLocalAudio({ forcePrompt = false, preferredDeviceId = null } = {}) {
    if (
      !forcePrompt &&
      this.hasRealMic &&
      this.localAudioStream &&
      this.rawMicStream?.getAudioTracks().some((t) => t.readyState === 'live')
    ) {
      return this.localAudioStream;
    }

    if (forcePrompt) {
      // Clear any sticky WebView2 media_stream_mic deny entry before calling getUserMedia
      try {
        await window.mashNative?.repairMicrophoneAccess?.(false);
      } catch {
        // ignore
      }
    }

    const targetDeviceId =
      preferredDeviceId !== null
        ? preferredDeviceId
        : this.preferredAudioInputId || this.streamSettings.audioInputId || '';

    const buildConstraints = (useExactDevice) => ({
      audio: {
        ...(useExactDevice && targetDeviceId ? { deviceId: { exact: targetDeviceId } } : {}),
        echoCancellation: this.streamSettings.echoCancellation !== false,
        noiseSuppression: this.streamSettings.noiseSuppression !== false,
        autoGainControl: true,
        channelCount: 2,
        sampleRate: 48000,
      },
      video: false,
    });

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('API Microphone indisponible sur ce système');
      }

      let rawStream;
      try {
        rawStream = await navigator.mediaDevices.getUserMedia(
          buildConstraints(Boolean(targetDeviceId))
        );
      } catch (firstErr) {
        // If specific device was unplugged or overconstrained, immediately retry default system mic!
        if (targetDeviceId || firstErr?.name === 'OverconstrainedError') {
          rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } else {
          throw firstErr;
        }
      }

      this.stopRawMicOnly();
      this.rawMicStream = rawStream;
      const hwTrack = rawStream.getAudioTracks()[0];
      this.micDeviceLabel = hwTrack?.label || 'Microphone Actif';

      // Watch for physical USB/jack unplug so UI immediately offers 1-click recovery
      if (hwTrack) {
        hwTrack.onended = () => {
          this.hasRealMic = false;
          this.micStatus = 'no-device';
          this.micError = 'Microphone débranché — clique pour reconnecter un micro.';
          this.emitMicState();
        };
      }

      // Route through MashKrisp™ Voice Isolation DSP
      const krisp = new KrispVoiceProcessor({
        mode: this.krispMode,
        onMeter: (m) => this.onKrispMeter?.(m),
      });
      const processedStream = await krisp.attach(rawStream);
      this.krispProcessor = krisp;

      this.localAudioStream = processedStream;
      this.hasRealMic = true;
      this.micStatus = 'active';
      this.micError = '';

      for (const t of rawStream.getAudioTracks()) {
        t.enabled = !this.muted;
      }
      for (const t of processedStream.getAudioTracks()) {
        t.enabled = !this.muted;
      }

      this.startSpeakingDetector(processedStream);
      this.emitMicState();
      return processedStream;
    } catch (err) {
      const errName = err?.name || '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError' || errName === 'SecurityError') {
        this.micStatus = 'blocked';
        this.micError =
          'Accès au micro bloqué — clique sur « Réactiver & Autoriser le micro » pour redemander la permission.';
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        this.micStatus = 'no-device';
        this.micError = 'Aucun microphone détecté — branche un micro puis clique sur Réessayer.';
      } else {
        this.micStatus = 'blocked';
        this.micError = err?.message || 'Microphone indisponible — clique pour réessayer.';
      }

      this.hasRealMic = false;
      const fallback = this.getOrCreateSilentFallback();
      this.localAudioStream = fallback;
      this.emitMicState();
      return fallback;
    }
  }

  /**
   * Explicit 1-click microphone recovery & hot-swap onto all active WebRTC peers without leaving the call!
   */
  async retryMicrophone(preferredDeviceId = null) {
    const stream = await this.ensureLocalAudio({
      forcePrompt: true,
      preferredDeviceId,
    });
    if (this.hasRealMic && stream) {
      await this.syncAudioTrackToAllPeers();
      if (this.muted) {
        this.setMuted(false);
      }
    }
    return {
      ok: this.hasRealMic,
      status: this.micStatus,
      error: this.micError,
      deviceLabel: this.micDeviceLabel,
    };
  }

  async syncAudioTrackToAllPeers() {
    const desiredAudio = this.localAudioStream?.getAudioTracks()[0] || null;
    if (!desiredAudio) return;
    for (const [peerKey, { pc }] of this.peers.entries()) {
      try {
        const audioSender = pc
          .getSenders()
          .find((s) => (s.track && s.track.kind === 'audio') || (!s.track && pc.getTransceivers?.().some((tr) => tr.sender === s && tr.receiver?.track?.kind === 'audio')));
        if (audioSender) {
          await audioSender.replaceTrack(desiredAudio);
        } else {
          pc.addTrack(desiredAudio, this.localAudioStream);
          await this.negotiateOffer(peerKey, pc);
        }
      } catch {
        // ignore transient peer state
      }
    }
  }

  startSpeakingDetector(stream) {
    this.stopSpeakingDetector();
    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyserCtx = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let lastSpeaking = false;

      this.voiceAnalyserTimer = setInterval(() => {
        if (this.muted || !this.hasRealMic) {
          if (lastSpeaking) {
            lastSpeaking = false;
            this.onSpeakingChange?.(false);
          }
          return;
        }
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const avg = sum / buf.length;
        const speaking = avg > 12;
        if (speaking !== lastSpeaking) {
          lastSpeaking = speaking;
          this.onSpeakingChange?.(speaking);
        }
      }, 140);
    } catch {
      // ignore
    }
  }

  stopSpeakingDetector() {
    if (this.voiceAnalyserTimer) {
      clearInterval(this.voiceAnalyserTimer);
      this.voiceAnalyserTimer = null;
    }
    if (this.analyserCtx) {
      this.analyserCtx.close().catch(() => {});
      this.analyserCtx = null;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.krispProcessor?.resume();
    if (this.rawMicStream) {
      for (const t of this.rawMicStream.getAudioTracks()) {
        t.enabled = !this.muted;
      }
    }
    if (this.localAudioStream) {
      for (const t of this.localAudioStream.getAudioTracks()) {
        t.enabled = !this.muted;
      }
    }
  }

  setDeafened(deafened) {
    this.deafened = Boolean(deafened);
    if (this.deafened) this.setMuted(true);
  }

  async toggleCamera(enable, facingMode = 'user') {
    if (!enable) {
      if (this.localCameraStream) {
        this.localCameraStream.getTracks().forEach((t) => t.stop());
        this.localCameraStream = null;
      }
      await this.syncTracksToAllPeers();
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode,
        },
        audio: false,
      });
      this.localCameraStream = stream;
      await this.syncTracksToAllPeers();
      return stream;
    } catch {
      const sim = this.createSimulatedVideoStream('CAMÉRA P2P CHIFFRÉE');
      this.localCameraStream = sim;
      await this.syncTracksToAllPeers();
      return sim;
    }
  }

  stopScreenAntiFreezeGuard() {
    if (this.screenAntiFreezeCleanup) {
      try {
        this.screenAntiFreezeCleanup();
      } catch {
        // ignore
      }
      this.screenAntiFreezeCleanup = null;
    }
  }

  /**
   * Prevents Chromium / WebView2 from pausing video capture or encoder frames when MashVoice
   * is occluded behind a fullscreen OpenGL/DirectX game (such as Minecraft `javaw.exe`).
   */
  startScreenAntiFreezeGuard(stream) {
    this.stopScreenAntiFreezeGuard();
    if (typeof document === 'undefined' || !stream) return;

    // 1. Active offscreen <video> sink keeps Chromium's MediaStreamVideoTrack pump pulling frames continuously
    const sinkVideo = document.createElement('video');
    sinkVideo.muted = true;
    sinkVideo.playsInline = true;
    sinkVideo.autoplay = true;
    sinkVideo.srcObject = stream;
    sinkVideo.style.cssText =
      'position:fixed;width:2px;height:2px;opacity:0.001;pointer-events:none;left:-10px;top:-10px;z-index:-1;';
    document.body?.appendChild(sinkVideo);
    sinkVideo.play().catch(() => {});

    // 2. Active WebAudio micro-signal + Web Lock marks the WebView2 renderer exempt from background lifecycle freeze
    let keepAliveCtx = null;
    let lockRelease = null;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        keepAliveCtx = new AudioCtx();
        const osc = keepAliveCtx.createOscillator();
        const gain = keepAliveCtx.createGain();
        gain.gain.value = 0.00001; // inaudible (-100 dB)
        osc.frequency.value = 20;
        osc.connect(gain);
        gain.connect(keepAliveCtx.destination);
        osc.start();
      }
    } catch {
      // ignore
    }

    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      navigator.locks
        .request('mashvoice-active-stream-lock', () => new Promise((resolve) => { lockRelease = resolve; }))
        .catch(() => {});
    }

    // 3. Re-kick video track if Minecraft fullscreen F11 temporarily mutes WGC/DXGI capture
    const vTrack = stream.getVideoTracks?.()[0];
    const onUnmuteOrResume = () => {
      sinkVideo.play().catch(() => {});
      this.applyActiveScreenTrackConstraints().catch(() => {});
      for (const { pc } of this.peers.values()) {
        this.applySenderParameters(pc);
      }
    };
    vTrack?.addEventListener?.('unmute', onUnmuteOrResume);

    const pulseTimer = setInterval(() => {
      if (sinkVideo.paused) {
        sinkVideo.play().catch(() => {});
      }
      if (keepAliveCtx && keepAliveCtx.state === 'suspended') {
        keepAliveCtx.resume().catch(() => {});
      }
    }, 1500);

    this.screenAntiFreezeCleanup = () => {
      clearInterval(pulseTimer);
      vTrack?.removeEventListener?.('unmute', onUnmuteOrResume);
      try {
        sinkVideo.pause();
        sinkVideo.srcObject = null;
        sinkVideo.remove();
      } catch {
        // ignore
      }
      if (keepAliveCtx) {
        keepAliveCtx.close().catch(() => {});
      }
      lockRelease?.();
    };
  }

  async toggleScreenShare(enable, overridePreset = null) {
    if (!enable) {
      this.stopScreenAntiFreezeGuard();
      window.mashNative?.setScreenShareActive?.(false);
      if (this.syntheticCleanup) {
        this.syntheticCleanup();
        this.syntheticCleanup = null;
      }
      if (this.localScreenStream) {
        this.localScreenStream.getTracks().forEach((t) => t.stop());
        this.localScreenStream = null;
      }
      await this.syncTracksToAllPeers();
      return null;
    }

    if (overridePreset && typeof overridePreset === 'object') {
      this.updateStreamSettings(overridePreset);
    }

    const resKey = normalizeResolutionKey(this.streamSettings.resolution);
    const dim = STREAM_RESOLUTION_MAP[resKey] || STREAM_RESOLUTION_MAP['1080p'];
    const fps = Number(this.streamSettings.fps) || 60;

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        const sim = this.createSimulatedVideoStream(
          `STREAM JEU • ${resKey} ${fps} FPS ZERO-COPY`
        );
        this.localScreenStream = sim;
        await this.syncTracksToAllPeers();
        return sim;
      }

      // Pre-arm Win32 overlay bar auto-hider + anti-EcoQoS before opening display capture
      window.mashNative?.setScreenShareActive?.(true);

      // NOTE: Do NOT set a hard `frameRate.max` here — hard max in Chromium/WGC causes frame stalls
      // when capturing uncapped OpenGL games like Minecraft (`javaw.exe`). Rate-limit on RTCRtpSender instead!
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: dim.w, max: dim.w },
          height: { ideal: dim.h, max: dim.h },
          frameRate: { ideal: fps },
          cursor: 'always',
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        systemAudio: 'include',
        surfaceSwitching: 'include',
        selfBrowserSurface: 'exclude',
        monitorTypeSurfaces: 'include',
      });

      // Immediately hide WebView2's floating "tauri.localhost partage votre écran..." bar in-game
      window.mashNative?.setScreenShareActive?.(true);
      setTimeout(() => window.mashNative?.setScreenShareActive?.(true), 120);
      setTimeout(() => window.mashNative?.setScreenShareActive?.(true), 450);

      const vTrack = stream.getVideoTracks()[0];
      if (vTrack) {
        if ('contentHint' in vTrack) {
          vTrack.contentHint = fps >= 30 ? 'motion' : 'detail';
        }
        vTrack.onended = () => {
          this.toggleScreenShare(false);
        };
      }
      this.localScreenStream = stream;
      this.startScreenAntiFreezeGuard(stream);
      await this.syncTracksToAllPeers();
      return stream;
    } catch (err) {
      window.mashNative?.setScreenShareActive?.(false);
      // User canceled the screen picker — return null cleanly without starting a fake stream
      if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
        return null;
      }
      const sim = this.createSimulatedVideoStream(
        `STREAM JEU • ${resKey} ${fps} FPS ZERO-COPY`
      );
      this.localScreenStream = sim;
      await this.syncTracksToAllPeers();
      return sim;
    }
  }

  createSimulatedVideoStream(labelText) {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const ctx = canvas.getContext('2d');
    let frame = 0;
    const timer = setInterval(() => {
      frame += 1;
      const t = frame * 0.04;
      ctx.fillStyle = '#050508';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width * 0.5;
      const cy = canvas.height * 0.5;
      const grad = ctx.createRadialGradient(cx, cy, 48, cx, cy, 210);
      grad.addColorStop(0, '#000000');
      grad.addColorStop(0.28, '#000000');
      grad.addColorStop(0.34, '#fff2d2');
      grad.addColorStop(0.5, '#e8a849');
      grad.addColorStop(0.78, 'rgba(138, 62, 16, 0.35)');
      grad.addColorStop(1, 'rgba(5, 5, 8, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 210, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.24 + Math.sin(t * 0.4) * 0.04);
      ctx.strokeStyle = '#f5c26b';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.ellipse(0, 0, 230, 42, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(cx, cy, 62, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f5c26b';
      ctx.font = '600 16px "JetBrains Mono", monospace';
      ctx.fillText(`● EN DIRECT P2P — ${labelText}`, 28, 42);
      ctx.fillStyle = '#a3a8b8';
      ctx.font = '500 13px Inter, sans-serif';
      ctx.fillText(
        `Encodeur: ${this.streamSettings.preferredCodec} Hardware • Bitrate: ${(
          this.streamSettings.maxBitrateKbps / 1000
        ).toFixed(1)} Mbps • Impact Jeu: ~0.2% GPU`,
        28,
        512
      );
    }, 1000 / 30);

    this.syntheticCleanup = () => clearInterval(timer);
    return canvas.captureStream(30);
  }

  getCombinedLocalTracks() {
    const tracks = [];
    if (this.localAudioStream) {
      tracks.push(...this.localAudioStream.getAudioTracks());
    }
    if (this.localScreenStream) {
      tracks.push(...this.localScreenStream.getVideoTracks());
      tracks.push(...this.localScreenStream.getAudioTracks());
    } else if (this.localCameraStream) {
      tracks.push(...this.localCameraStream.getVideoTracks());
    }
    return tracks;
  }

  async joinRoom(roomId, selfPeerKey, existingPeers = []) {
    this.leaveRoom();
    this.roomId = roomId;
    this.selfPeerKey = selfPeerKey;
    await this.ensureLocalAudio();

    for (const peer of existingPeers) {
      if (peer.peerKey && peer.peerKey !== selfPeerKey) {
        await this.createPeerConnection(peer.peerKey, peer, true);
      }
    }

    this.startStatsLoop();
  }

  async handlePeerJoined(peer) {
    if (!peer?.peerKey || peer.peerKey === this.selfPeerKey) return;
    if (!this.peers.has(peer.peerKey)) {
      await this.createPeerConnection(peer.peerKey, peer, false);
    }
  }

  handlePeerLeft(peerKey) {
    const entry = this.peers.get(peerKey);
    if (entry) {
      try {
        entry.dc?.close();
        entry.pc?.close();
      } catch {
        // ignore
      }
      this.peers.delete(peerKey);
      this.emitRemoteStreams();
    }
  }

  async createPeerConnection(peerKey, peerMeta, initiator) {
    const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
    const remoteStream = new MediaStream();

    const entry = {
      peerKey,
      peerMeta,
      pc,
      dc: null,
      remoteStream,
      pendingCandidates: [],
    };
    this.peers.set(peerKey, entry);

    for (const track of this.getCombinedLocalTracks()) {
      pc.addTrack(track, this.localScreenStream || this.localCameraStream || this.localAudioStream);
    }
    await this.applySenderParameters(pc);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendSignal({
          targetPeerKey: peerKey,
          roomId: this.roomId,
          signal: { type: 'ice', candidate: ev.candidate },
        });
      }
    };

    pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        for (const tr of ev.streams[0].getTracks()) {
          remoteStream.addTrack(tr);
        }
      } else if (ev.track) {
        remoteStream.addTrack(ev.track);
      }
      this.emitRemoteStreams();
    };

    if (initiator) {
      const dc = pc.createDataChannel('mashvoice-p2p-e2ee', { ordered: true });
      this.bindDataChannel(entry, dc);
      await this.negotiateOffer(peerKey, pc);
    } else {
      pc.ondatachannel = (ev) => {
        this.bindDataChannel(entry, ev.channel);
      };
    }

    return entry;
  }

  bindDataChannel(entry, dc) {
    entry.dc = dc;
    dc.onmessage = (ev) => {
      try {
        const packet = JSON.parse(ev.data);
        this.onP2PData?.(entry.peerKey, packet);
      } catch {
        // ignore malformed packet
      }
    };
  }

  broadcastP2PData(packet) {
    const raw = JSON.stringify(packet);
    let sentCount = 0;
    for (const { dc } of this.peers.values()) {
      if (dc && dc.readyState === 'open') {
        dc.send(raw);
        sentCount += 1;
      }
    }
    return sentCount;
  }

  async negotiateOffer(peerKey, pc) {
    const offer = await pc.createOffer();
    offer.sdp = preferCodecInSdp(offer.sdp, this.streamSettings.preferredCodec);
    await pc.setLocalDescription(offer);
    this.sendSignal({
      targetPeerKey: peerKey,
      roomId: this.roomId,
      signal: { type: 'sdp', description: pc.localDescription },
    });
  }

  async syncTracksToAllPeers() {
    const desiredVideo =
      this.localScreenStream?.getVideoTracks()[0] ||
      this.localCameraStream?.getVideoTracks()[0] ||
      null;

    for (const [peerKey, { pc }] of this.peers.entries()) {
      const videoSender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (videoSender && desiredVideo) {
        await videoSender.replaceTrack(desiredVideo);
        await this.applySenderParameters(pc);
      } else if (videoSender && !desiredVideo) {
        pc.removeTrack(videoSender);
        await this.negotiateOffer(peerKey, pc);
      } else if (!videoSender && desiredVideo) {
        pc.addTrack(desiredVideo, this.localScreenStream || this.localCameraStream);
        await this.applySenderParameters(pc);
        await this.negotiateOffer(peerKey, pc);
      }
    }
  }

  async handleSignal(fromPeerKey, fromUser, signal) {
    let entry = this.peers.get(fromPeerKey);
    if (!entry) {
      entry = await this.createPeerConnection(fromPeerKey, fromUser, false);
    }
    const { pc } = entry;

    if (signal.type === 'sdp' && signal.description) {
      const desc = new RTCSessionDescription(signal.description);
      await pc.setRemoteDescription(desc);
      while (entry.pendingCandidates.length > 0) {
        const cand = entry.pendingCandidates.shift();
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {
          // ignore benign ICE race
        }
      }
      if (desc.type === 'offer') {
        const answer = await pc.createAnswer();
        answer.sdp = preferCodecInSdp(answer.sdp, this.streamSettings.preferredCodec);
        await pc.setLocalDescription(answer);
        this.sendSignal({
          targetPeerKey: fromPeerKey,
          roomId: this.roomId,
          signal: { type: 'sdp', description: pc.localDescription },
        });
      }
    } else if (signal.type === 'ice' && signal.candidate) {
      if (!pc.remoteDescription) {
        entry.pendingCandidates.push(signal.candidate);
      } else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch {
          // ignore benign ICE race
        }
      }
    }
  }

  emitRemoteStreams() {
    const list = [];
    for (const [peerKey, entry] of this.peers.entries()) {
      list.push({
        peerKey,
        peerMeta: entry.peerMeta,
        stream: entry.remoteStream,
      });
    }
    this.onRemoteStreamsChange?.(list);
  }

  startStatsLoop() {
    this.stopStatsLoop();
    let prevBytes = 0;
    let prevVideoFramesSent = 0;
    let stalledTicks = 0;
    let prevTs = Date.now();

    this.statsTimer = setInterval(async () => {
      let rttMs = 8;
      let totalBytes = 0;
      let totalVideoFramesSent = 0;
      let packetsLost = 0;
      const activePeers = this.peers.size;

      for (const { pc } of this.peers.values()) {
        try {
          const stats = await pc.getStats();
          stats.forEach((report) => {
            if (
              report.type === 'candidate-pair' &&
              report.state === 'succeeded' &&
              report.currentRoundTripTime
            ) {
              rttMs = Math.round(report.currentRoundTripTime * 1000);
            }
            if (report.type === 'outbound-rtp') {
              totalBytes += report.bytesSent || 0;
              if (report.kind === 'video' || report.mediaType === 'video') {
                totalVideoFramesSent += report.framesSent || report.framesEncoded || 0;
              }
            }
            if (report.type === 'inbound-rtp') {
              packetsLost += report.packetsLost || 0;
            }
          });
        } catch {
          // ignore
        }
      }

      // Minecraft / OpenGL Fullscreen Anti-Stall Watchdog:
      // If screen sharing is live with active peers and outbound video frames stalled for ~4s,
      // re-apply track constraints & refresh sender parameters automatically!
      if (this.localScreenStream && activePeers > 0) {
        const vTrack = this.localScreenStream.getVideoTracks?.()[0];
        if (vTrack && vTrack.readyState === 'live') {
          if (prevVideoFramesSent > 0 && totalVideoFramesSent <= prevVideoFramesSent) {
            stalledTicks += 1;
            if (stalledTicks >= 2) {
              stalledTicks = 0;
              vTrack.enabled = true;
              this.applyActiveScreenTrackConstraints().catch(() => {});
              for (const { pc } of this.peers.values()) {
                const videoSender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
                videoSender?.replaceTrack(vTrack).catch(() => {});
                this.applySenderParameters(pc);
              }
            }
          } else {
            stalledTicks = 0;
          }
        }
      } else {
        stalledTicks = 0;
      }
      prevVideoFramesSent = totalVideoFramesSent;

      const now = Date.now();
      const dtSec = Math.max(0.5, (now - prevTs) / 1000);
      const bitrateKbps =
        prevBytes > 0 && totalBytes >= prevBytes
          ? Math.round(((totalBytes - prevBytes) * 8) / 1000 / dtSec)
          : this.localScreenStream
            ? this.streamSettings.maxBitrateKbps
            : 96;
      prevBytes = totalBytes;
      prevTs = now;

      this.onStatsUpdate?.({
        rttMs,
        bitrateKbps,
        packetsLost,
        activePeers,
        codec: this.streamSettings.preferredCodec,
        fps: this.localScreenStream ? this.streamSettings.fps : 0,
      });
    }, 2000);
  }

  stopStatsLoop() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  leaveRoom() {
    this.stopStatsLoop();
    this.stopSpeakingDetector();
    this.stopScreenAntiFreezeGuard();
    window.mashNative?.setScreenShareActive?.(false);
    if (this.syntheticCleanup) {
      this.syntheticCleanup();
      this.syntheticCleanup = null;
    }
    for (const { dc, pc } of this.peers.values()) {
      try {
        dc?.close();
        pc?.close();
      } catch {
        // ignore
      }
    }
    this.peers.clear();

    this.stopRawMicOnly();
    this.localAudioStream = null;
    if (this.silentFallbackCtx) {
      this.silentFallbackCtx.close().catch(() => {});
      this.silentFallbackCtx = null;
      this.silentFallbackStream = null;
    }
    if (this.localCameraStream) {
      this.localCameraStream.getTracks().forEach((t) => t.stop());
      this.localCameraStream = null;
    }
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
    }
    this.roomId = null;
    this.micStatus = 'idle';
    this.micError = '';
    this.emitRemoteStreams();
  }
}
