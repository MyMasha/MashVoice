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
    '720p': { 15: 3500, 30: 5500, 60: 9000, 120: 13500 },
    '1080p': { 15: 6000, 30: 10000, 60: 16500, 120: 24000 },
    '2K': { 15: 10000, 30: 16500, 60: 26000, 120: 38000 },
    '4K': { 15: 18000, 30: 28000, 60: 45000, 120: 62000 },
  };
  const row = table[res] || table['1080p'];
  return row[f] || row[60];
}

const DEFAULT_ICE_SERVERS = [
  {
    urls: [
      'stun:stun.cloudflare.com:3478',
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun.nextcloud.com:443',
    ],
  },
];

/**
 * Scores H.264/VP9/AV1 RTP payload profiles so High Profile Level 5.x (CABAC, 1080p60-4K120 capable)
 * is negotiated FIRST instead of Constrained Baseline Level 3.1 (`42e01f`, which caps resolution at 720p30!).
 */
function scoreVideoFmtp(codecUpper, fmtpLine = '') {
  if (codecUpper === 'H264') {
    const m = fmtpLine.match(/profile-level-id=([0-9a-fA-F]{6})/);
    if (!m) return 50;
    const hex = m[1].toLowerCase();
    const profileIdc = hex.slice(0, 2);
    const levelHex = parseInt(hex.slice(4, 6), 16) || 0x1f;
    // 64 = High Profile (CABAC + 8x8 DCT), 4d = Main Profile (CABAC), 42 = Baseline (no CABAC)
    const profileRank = profileIdc === '64' ? 300 : profileIdc === '4d' ? 200 : 100;
    const packetizationBonus = fmtpLine.includes('packetization-mode=1') ? 25 : 0;
    return profileRank + packetizationBonus + levelHex;
  }
  if (codecUpper === 'VP9') {
    return fmtpLine.includes('profile-id=0') ? 200 : 120;
  }
  return 150;
}

/**
 * Enhances Offer & Answer SDPs for razor-sharp, zero-blur P2P game streaming:
 * 1. Prioritizes High-Profile hardware codecs (H.264 High L5.x CABAC / AV1 / VP9) while keeping RTX pairs intact.
 * 2. Injects `b=AS:` and `b=TIAS:` bandwidth ceilings in `m=video` so the receiver never throttles REMB/TWCC to 2 Mbps.
 * 3. Injects `x-google-max-bitrate`, `x-google-start-bitrate`, and `x-google-min-bitrate` so WebRTC starts sharp at frame #1
 *    instead of ramping up from a blurry 300 kbps webcam floor.
 * 4. Tunes Opus audio for 128 kbps stereo, CBR, 10 ms low-latency ptime, and DTX disabled.
 */
function enhanceMediaSdp(sdp, preferredCodec = 'H264', { maxBitrateKbps = 16500 } = {}) {
  if (!sdp) return sdp;
  try {
    const codecUpper = String(preferredCodec || 'H264').toUpperCase();
    const maxKbps = Math.max(2500, Math.round(Number(maxBitrateKbps) || 16500));
    const startKbps = Math.max(2000, Math.round(maxKbps * 0.72));
    const minKbps = Math.max(1500, Math.round(maxKbps * 0.35));

    const lines = sdp.split('\r\n');
    const fmtpByPt = new Map();
    const rtxAptByPt = new Map(); // rtxPt -> primaryPt
    const codecByPt = new Map(); // pt -> codecUpper
    const opusPts = new Set();

    for (const line of lines) {
      const rtpMatch = line.match(/^a=rtpmap:(\d+)\s+([^/\s]+)\//i);
      if (rtpMatch) {
        const pt = rtpMatch[1];
        const name = rtpMatch[2].toUpperCase();
        codecByPt.set(pt, name);
        if (name === 'OPUS') opusPts.add(pt);
      }
      const fmtpMatch = line.match(/^a=fmtp:(\d+)\s+(.*)$/i);
      if (fmtpMatch) {
        const pt = fmtpMatch[1];
        const params = fmtpMatch[2];
        fmtpByPt.set(pt, params);
        const aptMatch = params.match(/\bapt=(\d+)/);
        if (aptMatch) {
          rtxAptByPt.set(pt, aptMatch[1]);
        }
      }
    }

    // 1. Reorder m=video payload types: Preferred Codec (High Profile first) + their RTX payloads, then remaining codecs
    const mVideoIdx = lines.findIndex((l) => l.startsWith('m=video '));
    if (mVideoIdx !== -1) {
      const parts = lines[mVideoIdx].split(' ');
      const header = parts.slice(0, 3);
      const payloads = parts.slice(3);

      const matchedPrimary = payloads
        .filter((pt) => codecByPt.get(pt) === codecUpper && !rtxAptByPt.has(pt))
        .sort(
          (a, b) =>
            scoreVideoFmtp(codecUpper, fmtpByPt.get(b) || '') -
            scoreVideoFmtp(codecUpper, fmtpByPt.get(a) || '')
        );

      if (matchedPrimary.length > 0) {
        const prioritized = [];
        const used = new Set();
        for (const pt of matchedPrimary) {
          prioritized.push(pt);
          used.add(pt);
          for (const [rtxPt, aptPt] of rtxAptByPt.entries()) {
            if (aptPt === pt && payloads.includes(rtxPt) && !used.has(rtxPt)) {
              prioritized.push(rtxPt);
              used.add(rtxPt);
            }
          }
        }
        for (const pt of payloads) {
          if (!used.has(pt)) prioritized.push(pt);
        }
        lines[mVideoIdx] = [...header, ...prioritized].join(' ');
      }
    }

    // 2. Inject video bandwidth lines + fmtp start/min/max bitrates + Opus low-latency stereo params
    const out = [];
    let section = 'session';
    let injectedVideoBw = false;
    const seenFmtpPts = new Set();

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (line.startsWith('m=video ')) {
        section = 'video';
        injectedVideoBw = false;
      } else if (line.startsWith('m=')) {
        section = 'other';
      }

      if (section === 'video' && (line.startsWith('b=AS:') || line.startsWith('b=TIAS:'))) {
        continue; // replaced cleanly below
      }

      if (line.startsWith('a=fmtp:')) {
        const m = line.match(/^a=fmtp:(\d+)\s+(.*)$/);
        if (m) {
          const pt = m[1];
          let params = m[2];
          seenFmtpPts.add(pt);
          const codecName = codecByPt.get(pt);
          const isVideoCodec =
            codecName === 'H264' || codecName === 'VP8' || codecName === 'VP9' || codecName === 'AV1';

          if (isVideoCodec && !rtxAptByPt.has(pt)) {
            params = params
              .replace(/;?x-google-(?:max|min|start)-bitrate=\d+/g, '')
              .replace(/^;+|;+$/g, '');
            params = `${params};x-google-max-bitrate=${maxKbps};x-google-start-bitrate=${startKbps};x-google-min-bitrate=${minKbps}`;
            line = `a=fmtp:${pt} ${params}`;
          } else if (opusPts.has(pt)) {
            if (!params.includes('maxaveragebitrate=')) {
              params += ';stereo=1;sprop-stereo=1;maxaveragebitrate=128000;cbr=1;usedtx=0';
            }
            line = `a=fmtp:${pt} ${params}`;
          }
        }
      }

      out.push(line);

      // Add fmtp bitrate hints even for codecs (like VP8/VP9/AV1) that had an rtpmap line without an existing fmtp line
      const rtpMatch = line.match(/^a=rtpmap:(\d+)\s+(VP8|VP9|AV1)\//i);
      if (rtpMatch && !fmtpByPt.has(rtpMatch[1]) && !seenFmtpPts.has(rtpMatch[1])) {
        const pt = rtpMatch[1];
        seenFmtpPts.add(pt);
        out.push(
          `a=fmtp:${pt} x-google-max-bitrate=${maxKbps};x-google-start-bitrate=${startKbps};x-google-min-bitrate=${minKbps}`
        );
      }

      if (section === 'video' && !injectedVideoBw && line.startsWith('c=IN ')) {
        out.push(`b=AS:${maxKbps}`);
        out.push(`b=TIAS:${maxKbps * 1000}`);
        injectedVideoBw = true;
      }
    }

    // If m=video had session-level c=IN only (no media-level c=IN), inject b=AS right after m=video
    if (mVideoIdx !== -1 && !injectedVideoBw) {
      const outVideoIdx = out.findIndex((l) => l.startsWith('m=video '));
      if (outVideoIdx !== -1) {
        out.splice(outVideoIdx + 1, 0, `b=AS:${maxKbps}`, `b=TIAS:${maxKbps * 1000}`);
      }
    }

    return out.join('\r\n');
  } catch {
    return sdp;
  }
}

function extractOfferVideoHints(sdp) {
  if (!sdp) return {};
  try {
    const lines = sdp.split(/\r?\n/);
    const mVideo = lines.find((l) => l.startsWith('m=video '));
    let codec = null;
    if (mVideo) {
      const firstPt = mVideo.trim().split(/\s+/)[3];
      if (firstPt) {
        const rtp = lines.find((l) => l.startsWith(`a=rtpmap:${firstPt} `));
        const m = rtp?.match(/^a=rtpmap:\d+\s+([^/\s]+)\//i);
        if (m) codec = m[1].toUpperCase();
      }
    }
    let maxBitrateKbps = 0;
    const bAs = sdp.match(/\bb=AS:(\d+)/);
    if (bAs) maxBitrateKbps = Math.max(maxBitrateKbps, Number(bAs[1]) || 0);
    const xMax = sdp.match(/x-google-max-bitrate=(\d+)/);
    if (xMax) maxBitrateKbps = Math.max(maxBitrateKbps, Number(xMax[1]) || 0);
    return { codec, maxBitrateKbps };
  } catch {
    return {};
  }
}

/**
 * Minimizes receiver jitter-buffer delay on incoming WebRTC tracks so the viewer sees
 * game actions in ~25 ms instead of a sluggish 300-500 ms buffer.
 */
function tuneReceiverLowLatency(receiver, kind) {
  if (!receiver) return;
  try {
    if ('playoutDelayHint' in receiver) {
      receiver.playoutDelayHint = kind === 'video' ? 0.025 : 0.02;
    }
  } catch {
    // ignore unsupported hint
  }
  try {
    if ('jitterBufferTarget' in receiver) {
      receiver.jitterBufferTarget = kind === 'video' ? 25 : 20;
    }
  } catch {
    // ignore unsupported target
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
    this.peers = new Map(); // peerKey -> { pc, dc, remoteStream, peerMeta, pendingCandidates, makingOffer, ignoreOffer, disconnectTimer }

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
    this.congestionDegradeActive = false;

    this.streamSettings = {
      resolution: '1080p', // '720p' | '1080p' | '2K' | '4K'
      fps: 60, // 15 | 30 | 60 | 120
      maxBitrateKbps: computeRecommendedBitrateKbps('1080p', 60),
      customBitrate: false,
      preferredCodec: 'H264', // 'H264' (High Profile NVENC/AMF) | 'AV1' | 'VP9'
      maintainFramerate: false, // false = 'maintain-resolution' (1:1 Anti-Blur default!)
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
    const prevCodec = this.streamSettings.preferredCodec;
    const prevMaxBitrate = this.streamSettings.maxBitrateKbps;

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

    // Live hot-update active screen-share capture track constraints if resolution, FPS, or sharpness mode changed!
    if (
      this.localScreenStream &&
      (this.streamSettings.resolution !== prevRes ||
        this.streamSettings.fps !== prevFps ||
        normalizedPatch.maintainFramerate !== undefined)
    ) {
      this.applyActiveScreenTrackConstraints().catch(() => {});
    }

    const needsSdpRefresh =
      Boolean(this.localScreenStream || this.localCameraStream) &&
      (this.streamSettings.preferredCodec !== prevCodec ||
        this.streamSettings.maxBitrateKbps > prevMaxBitrate);

    for (const [peerKey, { pc }] of this.peers.entries()) {
      this.applySenderParameters(pc);
      if (needsSdpRefresh) {
        this.negotiateOffer(peerKey, pc).catch(() => {});
      }
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
      // CRITICAL: Never set contentHint = 'motion' on screen share!
      // In Chromium/libwebrtc, 'motion' overrides VideoContentType::SCREENSHARE into webcam mode,
      // unlocking QP=56 macroblocking and aggressive 360p spatial downscaling.
      // Leaving '' (native screencast) or 'detail' preserves 1:1 crisp HUD/textures at full 60/120 FPS!
      if ('contentHint' in vTrack) {
        vTrack.contentHint = this.streamSettings.maintainFramerate ? '' : fps <= 30 ? 'detail' : '';
      }
      await vTrack.applyConstraints({
        width: { ideal: dim.w, max: dim.w },
        height: { ideal: dim.h, max: dim.h },
        frameRate: { ideal: fps },
      });
    } catch {
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
    if (!pc) return;
    for (const sender of pc.getSenders()) {
      if (!sender.track) continue;
      if (sender.track.kind === 'video') {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          // Default ('maintain-resolution') locks 1:1 native resolution so fast games like Minecraft
          // never get crushed into 360p macroblocks; falls back to 'balanced' only under heavy packet loss.
          params.degradationPreference = this.streamSettings.maintainFramerate
            ? 'maintain-framerate'
            : this.congestionDegradeActive
              ? 'balanced'
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
        } catch {
          // Sender parameters may not be ready until SDP negotiation completes; re-applied post-SDP
        }
      } else if (sender.track.kind === 'audio') {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].active = true;
          params.encodings[0].maxBitrate = 128_000;
          if ('priority' in params.encodings[0]) {
            params.encodings[0].priority = 'high';
          }
          if ('networkPriority' in params.encodings[0]) {
            params.encodings[0].networkPriority = 'high';
          }
          await sender.setParameters(params);
        } catch {
          // ignore
        }
      }
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
          // CRITICAL: Keep '' (native VideoContentType::SCREENSHARE) or 'detail' — never 'motion',
          // which forces libwebrtc into blurry 360p QP=56 webcam mode on fast Minecraft camera movement!
          vTrack.contentHint = this.streamSettings.maintainFramerate ? '' : fps <= 30 ? 'detail' : '';
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
      if (entry.disconnectTimer) {
        clearTimeout(entry.disconnectTimer);
        entry.disconnectTimer = null;
      }
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
    const pc = new RTCPeerConnection({
      iceServers: DEFAULT_ICE_SERVERS,
      iceCandidatePoolSize: 8,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    const remoteStream = new MediaStream();

    const entry = {
      peerKey,
      peerMeta,
      pc,
      dc: null,
      remoteStream,
      pendingCandidates: [],
      makingOffer: false,
      ignoreOffer: false,
      disconnectTimer: null,
      screenAudioSender: null,
      negotiatedBitrateKbps: 0,
      negotiatedCodec: '',
    };
    this.peers.set(peerKey, entry);

    if (this.localAudioStream) {
      for (const track of this.localAudioStream.getAudioTracks()) {
        pc.addTrack(track, this.localAudioStream);
      }
    }
    if (this.localScreenStream) {
      for (const track of this.localScreenStream.getVideoTracks()) {
        pc.addTrack(track, this.localScreenStream);
      }
      const sysAudio = this.localScreenStream.getAudioTracks()[0];
      if (sysAudio) {
        entry.screenAudioSender = pc.addTrack(sysAudio, this.localScreenStream);
      }
    } else if (this.localCameraStream) {
      for (const track of this.localCameraStream.getVideoTracks()) {
        pc.addTrack(track, this.localCameraStream);
      }
    }

    await this.applySenderParameters(pc);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const candStr = ev.candidate.candidate || '';
        // Skip unusable APIPA link-local addresses (169.254.x.x) that slow down ICE checks
        if (candStr.includes(' 169.254.')) return;
        this.sendSignal({
          targetPeerKey: peerKey,
          roomId: this.roomId,
          signal: { type: 'ice', candidate: ev.candidate },
        });
      }
    };

    pc.ontrack = (ev) => {
      tuneReceiverLowLatency(ev.receiver, ev.track?.kind);
      if (ev.streams && ev.streams[0]) {
        for (const tr of ev.streams[0].getTracks()) {
          if (!remoteStream.getTracks().some((t) => t.id === tr.id)) {
            remoteStream.addTrack(tr);
          }
        }
      } else if (ev.track) {
        if (!remoteStream.getTracks().some((t) => t.id === ev.track.id)) {
          remoteStream.addTrack(ev.track);
        }
      }
      if (ev.track) {
        ev.track.onunmute = () => {
          tuneReceiverLowLatency(ev.receiver, ev.track?.kind);
          this.emitRemoteStreams();
        };
        ev.track.onmute = () => {
          this.emitRemoteStreams();
        };
        ev.track.onended = () => {
          try {
            remoteStream.removeTrack(ev.track);
          } catch {
            // ignore
          }
          this.emitRemoteStreams();
        };
      }
      this.emitRemoteStreams();
    };

    const refreshMediaPipelines = () => {
      this.applySenderParameters(pc);
      for (const receiver of pc.getReceivers()) {
        tuneReceiverLowLatency(receiver, receiver.track?.kind);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        refreshMediaPipelines();
        setTimeout(() => refreshMediaPipelines(), 350);
        setTimeout(() => refreshMediaPipelines(), 1200);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        if (entry.disconnectTimer) {
          clearTimeout(entry.disconnectTimer);
          entry.disconnectTimer = null;
        }
        refreshMediaPipelines();
      } else if (state === 'failed') {
        const isImpolite = String(this.selfPeerKey || '') > String(peerKey || '');
        if (isImpolite || initiator) {
          try {
            pc.restartIce?.();
          } catch {
            // ignore
          }
          this.negotiateOffer(peerKey, pc, { iceRestart: true }).catch(() => {});
        }
      } else if (state === 'disconnected') {
        if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);
        entry.disconnectTimer = setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            const isImpolite = String(this.selfPeerKey || '') > String(peerKey || '');
            if (isImpolite || initiator) {
              try {
                pc.restartIce?.();
              } catch {
                // ignore
              }
              this.negotiateOffer(peerKey, pc, { iceRestart: true }).catch(() => {});
            }
          }
        }, 3500);
      }
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

  async negotiateOffer(peerKey, pc, options = {}) {
    const entry = this.peers.get(peerKey);
    if (!pc || pc.signalingState === 'closed') return;
    if (entry) entry.makingOffer = true;
    try {
      const offer = await pc.createOffer(options);
      if (pc.signalingState !== 'stable') return;
      offer.sdp = enhanceMediaSdp(offer.sdp, this.streamSettings.preferredCodec, {
        maxBitrateKbps: this.streamSettings.maxBitrateKbps,
      });
      await pc.setLocalDescription(offer);
      if (entry) {
        entry.negotiatedBitrateKbps = this.streamSettings.maxBitrateKbps;
        entry.negotiatedCodec = this.streamSettings.preferredCodec;
      }
      await this.applySenderParameters(pc);
      this.sendSignal({
        targetPeerKey: peerKey,
        roomId: this.roomId,
        signal: { type: 'sdp', description: pc.localDescription },
      });
    } catch {
      // ignore transient negotiation race
    } finally {
      if (entry) entry.makingOffer = false;
    }
  }

  async syncTracksToAllPeers() {
    const activeVideoStream = this.localScreenStream || this.localCameraStream || null;
    const desiredVideo =
      this.localScreenStream?.getVideoTracks()[0] ||
      this.localCameraStream?.getVideoTracks()[0] ||
      null;
    const desiredScreenAudio = this.localScreenStream?.getAudioTracks?.()[0] || null;

    for (const [peerKey, entry] of this.peers.entries()) {
      const { pc } = entry;
      if (!pc || pc.signalingState === 'closed') continue;
      let needsRenegotiation = false;

      // 1. Sync Video Track (reuse existing video transceiver when available so SDP stays clean)
      const videoTransceiver = pc
        .getTransceivers?.()
        ?.find(
          (t) =>
            !t.stopped &&
            (t.sender?.track?.kind === 'video' || t.receiver?.track?.kind === 'video')
        );
      const videoSender =
        pc.getSenders().find((s) => s.track && s.track.kind === 'video') ||
        videoTransceiver?.sender ||
        null;

      if (videoSender && desiredVideo) {
        const hadTrack = Boolean(videoSender.track);
        await videoSender.replaceTrack(desiredVideo);
        if (videoTransceiver && videoTransceiver.direction !== 'sendrecv') {
          try {
            videoTransceiver.direction = 'sendrecv';
            needsRenegotiation = true;
          } catch {
            // ignore
          }
        } else if (!hadTrack) {
          needsRenegotiation = true;
        }
        if (
          this.streamSettings.maxBitrateKbps > (entry.negotiatedBitrateKbps || 0) ||
          this.streamSettings.preferredCodec !== entry.negotiatedCodec
        ) {
          needsRenegotiation = true;
        }
      } else if (videoSender && !desiredVideo && videoSender.track) {
        try {
          pc.removeTrack(videoSender);
        } catch {
          await videoSender.replaceTrack(null).catch(() => {});
        }
        needsRenegotiation = true;
      } else if (!videoSender && desiredVideo && activeVideoStream) {
        pc.addTrack(desiredVideo, activeVideoStream);
        needsRenegotiation = true;
      }

      // 2. Sync System/Game Audio Track separately from microphone sender
      if (desiredScreenAudio && this.localScreenStream) {
        if (entry.screenAudioSender) {
          await entry.screenAudioSender.replaceTrack(desiredScreenAudio).catch(() => {});
        } else {
          try {
            entry.screenAudioSender = pc.addTrack(desiredScreenAudio, this.localScreenStream);
            needsRenegotiation = true;
          } catch {
            // ignore
          }
        }
      } else if (entry.screenAudioSender && !desiredScreenAudio) {
        try {
          pc.removeTrack(entry.screenAudioSender);
        } catch {
          // ignore
        }
        entry.screenAudioSender = null;
        needsRenegotiation = true;
      }

      await this.applySenderParameters(pc);
      if (needsRenegotiation) {
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
    if (!pc || pc.signalingState === 'closed') return;

    if (signal.type === 'sdp' && signal.description) {
      const desc = new RTCSessionDescription(signal.description);
      const polite = String(this.selfPeerKey || '') < String(fromPeerKey || '');
      const offerCollision =
        desc.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');

      entry.ignoreOffer = !polite && offerCollision;
      if (entry.ignoreOffer) return;

      try {
        if (offerCollision) {
          await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
        }
        await pc.setRemoteDescription(desc);
      } catch {
        return;
      }

      while (entry.pendingCandidates.length > 0) {
        const cand = entry.pendingCandidates.shift();
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {
          // ignore benign ICE race
        }
      }

      if (desc.type === 'offer') {
        const offerHints = extractOfferVideoHints(desc.sdp);
        const isLocalSendingVideo = Boolean(this.localScreenStream || this.localCameraStream);
        const answerCodec = isLocalSendingVideo
          ? this.streamSettings.preferredCodec
          : offerHints.codec || this.streamSettings.preferredCodec;
        const answerMaxBitrateKbps = Math.max(
          this.streamSettings.maxBitrateKbps || 16500,
          offerHints.maxBitrateKbps || 16500
        );

        const answer = await pc.createAnswer();
        answer.sdp = enhanceMediaSdp(answer.sdp, answerCodec, {
          maxBitrateKbps: answerMaxBitrateKbps,
        });
        await pc.setLocalDescription(answer);
        this.sendSignal({
          targetPeerKey: fromPeerKey,
          roomId: this.roomId,
          signal: { type: 'sdp', description: pc.localDescription },
        });
      }

      // Apply sender encoding bitrates & receiver 25ms low-latency jitter target right after SDP negotiation!
      await this.applySenderParameters(pc);
      for (const receiver of pc.getReceivers()) {
        tuneReceiverLowLatency(receiver, receiver.track?.kind);
      }
      this.emitRemoteStreams();
    } else if (signal.type === 'ice' && signal.candidate) {
      if (entry.ignoreOffer) return;
      if (!pc.remoteDescription) {
        entry.pendingCandidates.push(signal.candidate);
      } else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch {
          // ignore benign ICE race
        }
      }
    } else if (signal.type === 'ice-batch' && Array.isArray(signal.candidates)) {
      if (entry.ignoreOffer) return;
      for (const cand of signal.candidates) {
        if (!cand) continue;
        if (!pc.remoteDescription) {
          entry.pendingCandidates.push(cand);
        } else {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch {
            // ignore
          }
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
    let prevTxBytes = 0;
    let prevRxBytes = 0;
    let prevVideoFramesSent = 0;
    let prevPacketsLost = 0;
    let prevPacketsTotal = 0;
    let highLossTicks = 0;
    let cleanLossTicks = 0;
    let stalledTicks = 0;
    let prevTs = Date.now();

    this.statsTimer = setInterval(async () => {
      let rttMs = 8;
      let txBytes = 0;
      let rxBytes = 0;
      let totalVideoFramesSent = 0;
      let packetsLost = 0;
      let packetsReceived = 0;
      let txWidth = 0;
      let txHeight = 0;
      let txFps = 0;
      let rxWidth = 0;
      let rxHeight = 0;
      let rxFps = 0;
      let jitterMs = 0;
      let qualityLimitationReason = 'none';
      let negotiatedCodec = '';
      let hasConnectedPeer = false;
      const activePeers = this.peers.size;

      for (const { pc } of this.peers.values()) {
        if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected') {
          hasConnectedPeer = true;
        }
        try {
          const stats = await pc.getStats();
          const codecsById = new Map();
          stats.forEach((report) => {
            if (report.type === 'codec' && report.mimeType) {
              codecsById.set(report.id, report.mimeType);
            }
          });

          stats.forEach((report) => {
            if (
              report.type === 'candidate-pair' &&
              report.state === 'succeeded' &&
              report.currentRoundTripTime !== undefined
            ) {
              rttMs = Math.max(1, Math.round(report.currentRoundTripTime * 1000));
            }
            if (report.type === 'outbound-rtp') {
              txBytes += report.bytesSent || 0;
              if (report.kind === 'video' || report.mediaType === 'video') {
                totalVideoFramesSent += report.framesSent || report.framesEncoded || 0;
                if (report.frameWidth) txWidth = report.frameWidth;
                if (report.frameHeight) txHeight = report.frameHeight;
                if (report.framesPerSecond) txFps = Math.round(report.framesPerSecond);
                if (report.qualityLimitationReason) {
                  qualityLimitationReason = report.qualityLimitationReason;
                }
                if (report.codecId && codecsById.has(report.codecId)) {
                  negotiatedCodec = codecsById.get(report.codecId).split('/')[1] || '';
                }
              }
            }
            if (report.type === 'inbound-rtp') {
              rxBytes += report.bytesReceived || 0;
              packetsLost += report.packetsLost || 0;
              packetsReceived += report.packetsReceived || 0;
              if (report.kind === 'video' || report.mediaType === 'video') {
                if (report.frameWidth) rxWidth = report.frameWidth;
                if (report.frameHeight) rxHeight = report.frameHeight;
                if (report.framesPerSecond) rxFps = Math.round(report.framesPerSecond);
                if (report.jitter !== undefined) {
                  jitterMs = Math.max(jitterMs, Math.round(report.jitter * 1000));
                }
                if (!negotiatedCodec && report.codecId && codecsById.has(report.codecId)) {
                  negotiatedCodec = codecsById.get(report.codecId).split('/')[1] || '';
                }
              }
            }
          });
        } catch {
          // ignore
        }
      }

      // Adaptive Congestion Safety Guard:
      // Keep 1:1 native sharpness ('maintain-resolution') unless real packet loss > 8% for 2s
      const curTotalPkts = packetsLost + packetsReceived;
      if (prevPacketsTotal > 0 && curTotalPkts > prevPacketsTotal + 30) {
        const dLost = Math.max(0, packetsLost - prevPacketsLost);
        const dTotal = curTotalPkts - prevPacketsTotal;
        const lossRatio = dLost / dTotal;
        if (lossRatio > 0.08) {
          highLossTicks += 1;
          cleanLossTicks = 0;
          if (highLossTicks >= 2 && !this.congestionDegradeActive) {
            this.congestionDegradeActive = true;
            for (const { pc } of this.peers.values()) {
              this.applySenderParameters(pc);
            }
          }
        } else if (lossRatio < 0.02) {
          cleanLossTicks += 1;
          highLossTicks = 0;
          if (cleanLossTicks >= 2 && this.congestionDegradeActive) {
            this.congestionDegradeActive = false;
            for (const { pc } of this.peers.values()) {
              this.applySenderParameters(pc);
            }
          }
        }
      }
      prevPacketsLost = packetsLost;
      prevPacketsTotal = curTotalPkts;

      // Non-destructive Minecraft / OpenGL Fullscreen Anti-Stall Watchdog (only on connected peers):
      if (this.localScreenStream && hasConnectedPeer) {
        const vTrack = this.localScreenStream.getVideoTracks?.()[0];
        if (vTrack && vTrack.readyState === 'live') {
          if (prevVideoFramesSent > 0 && totalVideoFramesSent <= prevVideoFramesSent) {
            stalledTicks += 1;
            if (stalledTicks === 3) {
              vTrack.enabled = true;
              for (const { pc } of this.peers.values()) {
                this.applySenderParameters(pc);
              }
            } else if (stalledTicks >= 6) {
              stalledTicks = 0;
              vTrack.enabled = true;
              this.applyActiveScreenTrackConstraints().catch(() => {});
              for (const { pc } of this.peers.values()) {
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
      const dtSec = Math.max(0.4, (now - prevTs) / 1000);
      const txBitrateKbps =
        prevTxBytes > 0 && txBytes >= prevTxBytes
          ? Math.round(((txBytes - prevTxBytes) * 8) / 1000 / dtSec)
          : 0;
      const rxBitrateKbps =
        prevRxBytes > 0 && rxBytes >= prevRxBytes
          ? Math.round(((rxBytes - prevRxBytes) * 8) / 1000 / dtSec)
          : 0;
      prevTxBytes = txBytes;
      prevRxBytes = rxBytes;
      prevTs = now;

      const isSendingVideo = Boolean(this.localScreenStream || this.localCameraStream);
      const bitrateKbps = isSendingVideo
        ? txBitrateKbps > 0
          ? txBitrateKbps
          : this.streamSettings.maxBitrateKbps
        : rxBitrateKbps > 0
          ? rxBitrateKbps
          : txBitrateKbps > 0
            ? txBitrateKbps
            : 96;

      this.onStatsUpdate?.({
        rttMs,
        bitrateKbps,
        txBitrateKbps,
        rxBitrateKbps,
        txWidth,
        txHeight,
        txFps,
        rxWidth,
        rxHeight,
        rxFps,
        jitterMs,
        qualityLimitationReason,
        packetsLost,
        activePeers,
        codec: (negotiatedCodec || this.streamSettings.preferredCodec).toUpperCase(),
        fps: isSendingVideo ? txFps || this.streamSettings.fps : rxFps || 0,
      });
    }, 1000);
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
    this.congestionDegradeActive = false;
    window.mashNative?.setScreenShareActive?.(false);
    if (this.syntheticCleanup) {
      this.syntheticCleanup();
      this.syntheticCleanup = null;
    }
    for (const entry of this.peers.values()) {
      if (entry.disconnectTimer) {
        clearTimeout(entry.disconnectTimer);
      }
      try {
        entry.dc?.close();
        entry.pc?.close();
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
