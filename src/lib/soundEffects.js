/**
 * MashVoice Singularity Musical Sound & Call Ringtone Engine (Zero-Asset WebAudio)
 * - Polyphonic Discord-inspired looping Incoming Call music & Outgoing Call waiting music
 * - Crisp UI sounds for messages, friend requests, voice join/leave, peer join/leave,
 *   mute/deafen, screen share, MashKrisp toggle, and post-update Changelog fanfare
 * - Persistent user volume & per-category mute settings (`mashvoice.sfxConfig`)
 */

const DEFAULT_SFX_CONFIG = {
  enabled: true,
  volume: 0.75, // 0.0 -> 1.0
  callMusic: true,
  messageSounds: true,
  voiceSounds: true,
};

class SoundEffects {
  constructor() {
    this.ctx = null;
    this.incomingRingTimer = null;
    this.outgoingRingTimer = null;
    this.config = this.loadConfig();
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

  updateConfig(patch) {
    this.config = { ...this.config, ...patch };
    try {
      localStorage.setItem('mashvoice.sfxConfig', JSON.stringify(this.config));
    } catch {
      // ignore
    }
    if (!this.config.enabled || !this.config.callMusic) {
      this.stopIncomingRing();
      this.stopOutgoingRing();
    }
    return this.getConfig();
  }

  ensureCtx() {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  masterGain(baseGain) {
    if (!this.config.enabled) return 0;
    return Math.max(0, Math.min(0.45, baseGain * (this.config.volume ?? 0.75)));
  }

  tone(freq, duration = 0.14, type = 'sine', gainVal = 0.08, delay = 0, detuneCents = 0) {
    const g = this.masterGain(gainVal);
    if (g <= 0.0001) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (detuneCents) osc.detune.setValueAtTime(detuneCents, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.max(1600, freq * 4.2), now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(g, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.025);
  }

  // Warm polyphonic Rhodes/Pluck note for Discord-style call music
  musicNote(freq, duration = 0.34, gainVal = 0.075, delay = 0) {
    this.tone(freq, duration, 'triangle', gainVal, delay, 0);
    this.tone(freq * 2, duration * 0.65, 'sine', gainVal * 0.32, delay, 4);
  }

  /* =========================================================================
     LOOPING CALL RINGTONES (INCOMING & OUTGOING — DISCORD INSPIRED)
     ========================================================================= */

  playIncomingRingPhrase() {
    if (!this.config.enabled || !this.config.callMusic) return;
    // Iconic upbeat melodic arpeggio + warm bass pad (Fmaj7 -> G6 -> Am9)
    // Bass foundation
    this.tone(174.61, 0.85, 'sine', 0.065, 0.0); // F3
    this.tone(196.0, 0.85, 'sine', 0.065, 0.9); // G3
    // Sparkly lead melody
    this.musicNote(523.25, 0.24, 0.085, 0.0); // C5
    this.musicNote(659.25, 0.24, 0.085, 0.18); // E5
    this.musicNote(783.99, 0.28, 0.09, 0.36); // G5
    this.musicNote(1046.5, 0.42, 0.095, 0.56); // C6
    // Second bar answer
    this.musicNote(987.77, 0.22, 0.08, 1.02); // B5
    this.musicNote(783.99, 0.22, 0.08, 1.2); // G5
    this.musicNote(880.0, 0.52, 0.09, 1.4); // A5
  }

  startIncomingRing() {
    this.stopOutgoingRing();
    if (this.incomingRingTimer) return;
    if (!this.config.enabled || !this.config.callMusic) return;
    this.playIncomingRingPhrase();
    this.incomingRingTimer = setInterval(() => {
      this.playIncomingRingPhrase();
    }, 2500);
  }

  stopIncomingRing() {
    if (this.incomingRingTimer) {
      clearInterval(this.incomingRingTimer);
      this.incomingRingTimer = null;
    }
  }

  playOutgoingRingPhrase() {
    if (!this.config.enabled || !this.config.callMusic) return;
    // Smooth dreamy Discord-style outgoing waiting motif (Dmaj9 / Aadd9 pulse)
    this.tone(220.0, 0.7, 'sine', 0.05, 0.0); // A3 soft sub
    this.musicNote(440.0, 0.36, 0.068, 0.0); // A4
    this.musicNote(554.37, 0.36, 0.068, 0.24); // C#5
    this.musicNote(659.25, 0.58, 0.074, 0.48); // E5
    this.musicNote(587.33, 0.48, 0.058, 1.18); // D5 gentle resolve
  }

  startOutgoingRing() {
    this.stopIncomingRing();
    if (this.outgoingRingTimer) return;
    if (!this.config.enabled || !this.config.callMusic) return;
    this.playOutgoingRingPhrase();
    this.outgoingRingTimer = setInterval(() => {
      this.playOutgoingRingPhrase();
    }, 2800);
  }

  stopOutgoingRing() {
    if (this.outgoingRingTimer) {
      clearInterval(this.outgoingRingTimer);
      this.outgoingRingTimer = null;
    }
  }

  stopAllRings() {
    this.stopIncomingRing();
    this.stopOutgoingRing();
  }

  /* =========================================================================
     UI, CHAT, FRIEND, VOICE & STREAM EVENT SOUNDS
     ========================================================================= */

  unlockGate() {
    this.musicNote(440, 0.14, 0.07, 0);
    this.musicNote(554.37, 0.16, 0.07, 0.07);
    this.musicNote(659.25, 0.24, 0.08, 0.14);
  }

  joinVoice() {
    this.stopAllRings();
    if (!this.config.voiceSounds) return;
    this.musicNote(523.25, 0.12, 0.08, 0);
    this.musicNote(783.99, 0.18, 0.085, 0.075);
  }

  leaveVoice() {
    this.stopAllRings();
    if (!this.config.voiceSounds) return;
    this.musicNote(659.25, 0.11, 0.075, 0);
    this.musicNote(392.0, 0.18, 0.08, 0.075);
  }

  peerJoinVoice() {
    if (!this.config.voiceSounds) return;
    this.musicNote(587.33, 0.1, 0.065, 0);
    this.musicNote(880.0, 0.15, 0.07, 0.065);
  }

  peerLeaveVoice() {
    if (!this.config.voiceSounds) return;
    this.musicNote(587.33, 0.1, 0.06, 0);
    this.musicNote(440.0, 0.15, 0.065, 0.065);
  }

  toggleMute(muted) {
    if (!this.config.voiceSounds) return;
    if (muted) {
      this.tone(420, 0.08, 'triangle', 0.065, 0);
      this.tone(300, 0.09, 'triangle', 0.065, 0.055);
    } else {
      this.tone(330, 0.08, 'triangle', 0.065, 0);
      this.tone(495, 0.09, 'triangle', 0.065, 0.055);
    }
  }

  toggleDeafen(deafened) {
    if (!this.config.voiceSounds) return;
    if (deafened) {
      this.tone(392, 0.08, 'sine', 0.07, 0);
      this.tone(311.13, 0.08, 'sine', 0.07, 0.055);
      this.tone(233.08, 0.13, 'sine', 0.075, 0.11);
    } else {
      this.tone(261.63, 0.08, 'sine', 0.07, 0);
      this.tone(349.23, 0.08, 'sine', 0.07, 0.055);
      this.tone(523.25, 0.13, 0.075, 0.11);
    }
  }

  krispToggle(enabled) {
    if (!this.config.voiceSounds) return;
    if (enabled) {
      this.musicNote(659.25, 0.09, 0.065, 0);
      this.musicNote(987.77, 0.14, 0.07, 0.06);
    } else {
      this.tone(480, 0.1, 'sine', 0.055, 0);
    }
  }

  startStream() {
    if (!this.config.voiceSounds) return;
    this.musicNote(587.33, 0.1, 0.07, 0);
    this.musicNote(783.99, 0.12, 0.075, 0.065);
    this.musicNote(1174.66, 0.22, 0.085, 0.13);
  }

  stopStream() {
    if (!this.config.voiceSounds) return;
    this.musicNote(880.0, 0.09, 0.065, 0);
    this.musicNote(523.25, 0.16, 0.07, 0.065);
  }

  // Incoming chat message pop (Discord double-droplet)
  messageIn() {
    if (!this.config.messageSounds) return;
    this.tone(740, 0.065, 'sine', 0.065, 0);
    this.tone(1046.5, 0.095, 'sine', 0.075, 0.05);
  }

  // Outgoing chat message subtle soft tick
  messageOut() {
    if (!this.config.messageSounds) return;
    this.tone(560, 0.045, 'sine', 0.038, 0);
    this.tone(720, 0.05, 'sine', 0.035, 0.028);
  }

  // Backwards-compatible alias
  messageTick() {
    this.messageIn();
  }

  friendRequest() {
    if (!this.config.messageSounds) return;
    this.musicNote(587.33, 0.12, 0.08, 0);
    this.musicNote(739.99, 0.12, 0.08, 0.09);
    this.musicNote(880.0, 0.14, 0.085, 0.18);
    this.musicNote(1174.66, 0.28, 0.09, 0.27);
  }

  updateAvailable() {
    this.musicNote(659.25, 0.13, 0.07, 0);
    this.musicNote(880.0, 0.16, 0.075, 0.09);
    this.musicNote(1318.5, 0.26, 0.08, 0.19);
  }

  changelogFanfare() {
    this.musicNote(523.25, 0.14, 0.075, 0);
    this.musicNote(659.25, 0.14, 0.075, 0.08);
    this.musicNote(783.99, 0.16, 0.08, 0.16);
    this.musicNote(1046.5, 0.36, 0.09, 0.25);
  }
}

export const mashSounds = new SoundEffects();
