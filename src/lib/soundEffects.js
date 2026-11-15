/**
 * MashVoice Singularity UI Sound Design & Call Ringtone Engine (WebAudio + Pre-Decoded Stereo MP3s)
 * - Uses curated Discord-style stereo UI Sound Design assets stored in `/public/sfx/*.mp3`
 * - Sample-accurate seamless WebAudio looping for Incoming & Outgoing P2P call ringtones
 * - Zero-latency RAM-cached `AudioBuffer` playback for voice, mute/deafen, MashKrisp™, 120 FPS stream,
 *   encrypted DMs, and Zero-IP friend invites
 * - Persistent user volume & per-category mute gates (`mashvoice.sfxConfig`)
 */

const DEFAULT_SFX_CONFIG = {
  enabled: true,
  volume: 0.75, // 0.0 -> 1.0
  callMusic: true,
  messageSounds: true,
  voiceSounds: true,
};

const SFX_MANIFEST = [
  'incomingRing',
  'outgoingRing',
  'unlockGate',
  'joinVoice',
  'leaveVoice',
  'peerJoinVoice',
  'peerLeaveVoice',
  'muteOn',
  'muteOff',
  'deafenOn',
  'deafenOff',
  'krispOn',
  'krispOff',
  'startStream',
  'stopStream',
  'messageIn',
  'messageOut',
  'friendRequest',
];

function resolveSfxUrl(id) {
  const base =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL.replace(/\/$/, '')
      : '';
  return `${base}/sfx/${id}.mp3`;
}

class SoundEffects {
  constructor() {
    this.ctx = null;
    this.masterBus = null;
    this.rawCache = new Map();
    this.bufferCache = new Map();
    this.inflightDecode = new Map();
    this.activeRings = {
      incoming: null,
      outgoing: null,
      preview: null,
    };
    this.config = this.loadConfig();

    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      // Pre-fetch compact SFX binaries (~168 KB total) in idle time for zero-latency first trigger
      const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 120));
      schedule(() => this.prefetchBinaries());
    }
  }

  loadConfig() {
    try {
      const raw = localStorage.getItem('mashvoice.sfxConfig');
      return raw ? { ...DEFAULT_SFX_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_SFX_CONFIG };
    } catch {
      return { ...DEFAULT_SFX_CONFIG };
    }
  }

  getConfig() {
    return { ...this.config };
  }

  effectiveMasterVolume() {
    if (!this.config.enabled) return 0;
    const v = Number(this.config.volume ?? DEFAULT_SFX_CONFIG.volume);
    return Math.max(0, Math.min(1, Number.isFinite(v) ? v : DEFAULT_SFX_CONFIG.volume));
  }

  updateConfig(patch) {
    this.config = { ...this.config, ...patch };
    try {
      localStorage.setItem('mashvoice.sfxConfig', JSON.stringify(this.config));
    } catch {
      // ignore storage quota errors
    }
    if (this.masterBus && this.ctx) {
      this.masterBus.gain.setValueAtTime(this.effectiveMasterVolume(), this.ctx.currentTime);
    }
    if (!this.config.enabled || !this.config.callMusic) {
      this.stopAllRings();
    }
    return this.getConfig();
  }

  ensureCtx() {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterBus = this.ctx.createGain();
      this.masterBus.gain.value = this.effectiveMasterVolume();
      this.masterBus.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  async prefetchBinaries() {
    await Promise.allSettled(
      SFX_MANIFEST.map(async (id) => {
        if (this.rawCache.has(id) || this.bufferCache.has(id)) return;
        const res = await fetch(resolveSfxUrl(id));
        if (res.ok) {
          const ab = await res.arrayBuffer();
          this.rawCache.set(id, ab);
        }
      })
    );
  }

  async getBuffer(id) {
    if (this.bufferCache.has(id)) return this.bufferCache.get(id);
    if (this.inflightDecode.has(id)) return this.inflightDecode.get(id);

    const ctx = this.ensureCtx();
    if (!ctx) return null;

    const promise = (async () => {
      try {
        let ab = this.rawCache.get(id);
        if (!ab) {
          const res = await fetch(resolveSfxUrl(id));
          if (!res.ok) return null;
          ab = await res.arrayBuffer();
        } else {
          this.rawCache.delete(id);
        }
        // Slice buffer copy in case decodeAudioData detaches the ArrayBuffer
        const decoded = await ctx.decodeAudioData(ab.slice(0));
        this.bufferCache.set(id, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        this.inflightDecode.delete(id);
      }
    })();

    this.inflightDecode.set(id, promise);
    return promise;
  }

  playSample(id, { gain = 1.0, loop = false, ringSlot = null } = {}) {
    if (!this.config.enabled || this.effectiveMasterVolume() <= 0.0001) return;
    const ctx = this.ensureCtx();
    if (!ctx || !this.masterBus) return;

    if (ringSlot) {
      this.stopRingSlot(ringSlot);
    }

    const token = ringSlot ? Symbol(ringSlot) : null;
    if (ringSlot) {
      this.activeRings[ringSlot] = { token, src: null, gainNode: null };
    }

    const trigger = (buffer) => {
      if (!buffer || !this.config.enabled) return;
      if (ringSlot && this.activeRings[ringSlot]?.token !== token) return;
      if (ringSlot && !this.config.callMusic) return;

      const src = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      src.buffer = buffer;
      src.loop = Boolean(loop);
      gainNode.gain.setValueAtTime(Math.max(0, gain), ctx.currentTime);

      src.connect(gainNode);
      gainNode.connect(this.masterBus);

      if (ringSlot) {
        this.activeRings[ringSlot] = { token, src, gainNode };
      }

      src.onended = () => {
        if (ringSlot && this.activeRings[ringSlot]?.token === token) {
          this.activeRings[ringSlot] = null;
        }
        try {
          src.disconnect();
          gainNode.disconnect();
        } catch {
          // ignore
        }
      };

      src.start(0);
    };

    const cached = this.bufferCache.get(id);
    if (cached) {
      trigger(cached);
    } else {
      this.getBuffer(id).then(trigger);
    }
  }

  stopRingSlot(slot) {
    const entry = this.activeRings[slot];
    if (!entry) return;
    this.activeRings[slot] = null;

    const { src, gainNode } = entry;
    if (!src) return;

    if (this.ctx && gainNode) {
      try {
        const now = this.ctx.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(Math.max(0.0001, gainNode.gain.value), now);
        gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.03);
        src.stop(now + 0.035);
        return;
      } catch {
        // fall through to immediate stop
      }
    }
    try {
      src.stop();
    } catch {
      // ignore
    }
  }

  /* =========================================================================
     LOOPING CALL RINGTONES (INCOMING & OUTGOING — SEAMLESS WEBAUDIO LOOPS)
     ========================================================================= */

  playIncomingRingPhrase() {
    if (!this.config.enabled || !this.config.callMusic) return;
    this.playSample('incomingRing', { gain: 1.0, loop: false, ringSlot: 'preview' });
  }

  startIncomingRing() {
    this.stopOutgoingRing();
    this.stopRingSlot('preview');
    if (this.activeRings.incoming) return;
    if (!this.config.enabled || !this.config.callMusic) return;
    this.playSample('incomingRing', { gain: 1.0, loop: true, ringSlot: 'incoming' });
  }

  stopIncomingRing() {
    this.stopRingSlot('incoming');
  }

  playOutgoingRingPhrase() {
    if (!this.config.enabled || !this.config.callMusic) return;
    this.playSample('outgoingRing', { gain: 1.0, loop: false, ringSlot: 'preview' });
  }

  startOutgoingRing() {
    this.stopIncomingRing();
    this.stopRingSlot('preview');
    if (this.activeRings.outgoing) return;
    if (!this.config.enabled || !this.config.callMusic) return;
    this.playSample('outgoingRing', { gain: 1.0, loop: true, ringSlot: 'outgoing' });
  }

  stopOutgoingRing() {
    this.stopRingSlot('outgoing');
  }

  stopAllRings() {
    this.stopRingSlot('incoming');
    this.stopRingSlot('outgoing');
    this.stopRingSlot('preview');
  }

  /* =========================================================================
     UI, CHAT, FRIEND, VOICE & STREAM EVENT SOUNDS
     ========================================================================= */

  unlockGate() {
    this.playSample('unlockGate', { gain: 1.0 });
  }

  joinVoice() {
    this.stopAllRings();
    if (!this.config.voiceSounds) return;
    this.playSample('joinVoice', { gain: 1.0 });
  }

  leaveVoice() {
    this.stopAllRings();
    if (!this.config.voiceSounds) return;
    this.playSample('leaveVoice', { gain: 1.0 });
  }

  peerJoinVoice() {
    if (!this.config.voiceSounds) return;
    this.playSample('peerJoinVoice', { gain: 1.0 });
  }

  peerLeaveVoice() {
    if (!this.config.voiceSounds) return;
    this.playSample('peerLeaveVoice', { gain: 1.0 });
  }

  toggleMute(muted) {
    if (!this.config.voiceSounds) return;
    this.playSample(muted ? 'muteOn' : 'muteOff', { gain: 1.0 });
  }

  toggleDeafen(deafened) {
    if (!this.config.voiceSounds) return;
    this.playSample(deafened ? 'deafenOn' : 'deafenOff', { gain: 1.0 });
  }

  krispToggle(enabled) {
    if (!this.config.voiceSounds) return;
    this.playSample(enabled ? 'krispOn' : 'krispOff', { gain: 1.0 });
  }

  startStream() {
    if (!this.config.voiceSounds) return;
    this.playSample('startStream', { gain: 1.0 });
  }

  stopStream() {
    if (!this.config.voiceSounds) return;
    this.playSample('stopStream', { gain: 1.0 });
  }

  // Incoming chat message pop (Velvet Bubble double pop)
  messageIn() {
    if (!this.config.messageSounds) return;
    this.playSample('messageIn', { gain: 1.0 });
  }

  // Outgoing chat message discreet tactile micro-bubble
  messageOut() {
    if (!this.config.messageSounds) return;
    this.playSample('messageOut', { gain: 1.0 });
  }

  // Backwards-compatible alias
  messageTick() {
    this.messageIn();
  }

  friendRequest() {
    if (!this.config.messageSounds) return;
    this.playSample('friendRequest', { gain: 1.0 });
  }

  updateAvailable() {
    this.playSample('friendRequest', { gain: 0.85 });
  }

  changelogFanfare() {
    this.playSample('unlockGate', { gain: 1.0 });
  }
}

export const mashSounds = new SoundEffects();
