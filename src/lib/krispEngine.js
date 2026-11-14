/**
 * MashKrisp™ — Real-Time Voice Isolation & Anti-Keyboard DSP Engine
 *
 * Suppresses:
 *  - Mechanical keyboard clacks & mouse clicks (high crest-factor transients 3.5–12 kHz)
 *  - Desk bumps & mic stand vibrations (< 95 Hz high-order sub-cut)
 *  - PC fan hum & stationary room hiss (adaptive spectral voice-band gate)
 *
 * Latency: ~2.66 ms (single 128-sample WebAudio AudioWorklet quantum @ 48 kHz).
 */

const WORKLET_CODE = `
class MashKrispProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = 'ultra'; // 'ultra' | 'standard' | 'off'
    this.noiseFloor = 0.0022;
    this.gainEnv = 0.0;
    this.holdSamples = 0;
    this.lpVocal = 0.0;
    this.hpVocalPrev = 0.0;
    this.prevSample = 0.0;
    this.frameCounter = 0;

    this.port.onmessage = (ev) => {
      if (ev.data && ev.data.mode) {
        this.mode = ev.data.mode;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;

    const numChannels = Math.min(input.length, output.length);
    const ch0 = input[0];
    const n = ch0.length;

    if (this.mode === 'off') {
      let sumSq = 0;
      for (let c = 0; c < numChannels; c++) {
        output[c].set(input[c]);
      }
      for (let i = 0; i < n; i++) sumSq += ch0[i] * ch0[i];
      const rms = Math.sqrt(sumSq / n);
      this.frameCounter += 1;
      if (this.frameCounter >= 28) {
        this.frameCounter = 0;
        this.port.postMessage({
          inputLevel: Math.min(1, rms * 5.5),
          outputLevel: Math.min(1, rms * 5.5),
          suppressedDb: 0,
          voiceActive: rms > 0.012,
        });
      }
      return true;
    }

    // Analyze 128-sample quantum: separate vocal band (~120-2600 Hz) from keyboard transient band (>3.5 kHz)
    let rawSumSq = 0;
    let vocalSumSq = 0;
    let hiTransSumSq = 0;
    let peak = 0;

    for (let i = 0; i < n; i++) {
      const x = ch0[i];
      rawSumSq += x * x;
      const absX = x < 0 ? -x : x;
      if (absX > peak) peak = absX;

      // Fast 1-pole vocal lowpass (~2.4 kHz @ 48 kHz: alpha ≈ 0.27) + DC/sub reject
      this.lpVocal += 0.27 * (x - this.lpVocal);
      const vocal = this.lpVocal - 0.985 * this.hpVocalPrev;
      this.hpVocalPrev = this.lpVocal * 0.015 + this.hpVocalPrev * 0.985;
      vocalSumSq += vocal * vocal;

      // High-frequency derivative captures sharp mechanical switch transients
      const diff = x - this.prevSample;
      this.prevSample = x;
      hiTransSumSq += diff * diff;
    }

    const rawRms = Math.sqrt(rawSumSq / n);
    const vocalRms = Math.sqrt(vocalSumSq / n);
    const hiRms = Math.sqrt(hiTransSumSq / n);
    const crest = peak / (rawRms + 1e-5);

    // Track stationary background fan noise floor conservatively
    if (vocalRms < this.noiseFloor * 1.65) {
      this.noiseFloor = this.noiseFloor * 0.985 + vocalRms * 0.015;
    } else {
      this.noiseFloor = Math.min(0.025, this.noiseFloor * 0.9994 + vocalRms * 0.0006);
    }
    this.noiseFloor = Math.max(0.0007, Math.min(0.022, this.noiseFloor));

    const snr = vocalRms / (this.noiseFloor + 1e-5);
    const isSharpClick =
      (hiRms > vocalRms * 1.18 && snr < 5.2) ||
      (crest > 4.4 && hiRms > vocalRms * 0.95 && this.holdSamples === 0);

    const snrThreshold = this.mode === 'ultra' ? 2.85 : 2.05;
    const minFloorGain = this.mode === 'ultra' ? 0.012 : 0.06;
    const holdDuration = this.mode === 'ultra' ? 2600 : 3400; // ~55-70 ms syllable hold @ 48 kHz

    let targetGain = minFloorGain;
    if (!isSharpClick && snr >= snrThreshold && vocalRms > 0.0032) {
      targetGain = 1.0;
      this.holdSamples = holdDuration;
    } else if (this.holdSamples > 0) {
      this.holdSamples = Math.max(0, this.holdSamples - n);
      targetGain = isSharpClick ? 0.28 : 0.92;
    } else if (isSharpClick) {
      targetGain = this.mode === 'ultra' ? 0.006 : 0.035;
    } else if (snr > 1.45) {
      // Soft knee transition
      const ratio = (snr - 1.45) / Math.max(0.4, snrThreshold - 1.45);
      targetGain = minFloorGain + Math.min(1, ratio * ratio) * (0.65 - minFloorGain);
    }

    const attackCoeff = 0.045; // fast ~1.6ms voice opening so first consonant is crisp
    const releaseCoeff = isSharpClick ? 0.08 : 0.0022; // fast clamp on clicks, smooth tail on speech

    let outSumSq = 0;
    for (let i = 0; i < n; i++) {
      const coeff = targetGain > this.gainEnv ? attackCoeff : releaseCoeff;
      this.gainEnv += coeff * (targetGain - this.gainEnv);

      for (let c = 0; c < numChannels; c++) {
        let s = input[c][i] * this.gainEnv;
        // De-click transient limiter when non-voiced spike occurs
        if (isSharpClick && Math.abs(s) > 0.04) {
          s *= 0.22;
        }
        output[c][i] = s;
        if (c === 0) outSumSq += s * s;
      }
    }

    const outRms = Math.sqrt(outSumSq / n);
    this.frameCounter += 1;
    if (this.frameCounter >= 28) {
      this.frameCounter = 0;
      const suppressedDb =
        rawRms > 0.001 && outRms < rawRms
          ? Math.min(42, Math.round(20 * Math.log10((rawRms + 1e-6) / (outRms + 1e-6))))
          : 0;
      this.port.postMessage({
        inputLevel: Math.min(1, rawRms * 5.5),
        outputLevel: Math.min(1, outRms * 5.5),
        suppressedDb,
        voiceActive: this.gainEnv > 0.45 && outRms > 0.008,
      });
    }

    return true;
  }
}
registerProcessor('mash-krisp-processor', MashKrispProcessor);
`;

export function loadSavedKrispMode() {
  try {
    const saved = localStorage.getItem('mashvoice.krispMode');
    if (saved === 'ultra' || saved === 'standard' || saved === 'off') return saved;
  } catch {
    // ignore
  }
  return 'ultra';
}

export function saveKrispMode(mode) {
  try {
    localStorage.setItem('mashvoice.krispMode', mode);
  } catch {
    // ignore
  }
}

export class KrispVoiceProcessor {
  constructor({ mode = loadSavedKrispMode(), onMeter } = {}) {
    this.mode = mode;
    this.onMeter = onMeter || null;
    this.ctx = null;
    this.sourceNode = null;
    this.highpassNode = null;
    this.presenceNode = null;
    this.deClickShelf = null;
    this.workletNode = null;
    this.compressorNode = null;
    this.destNode = null;
    this.fallbackTimer = null;
  }

  async attach(rawStream) {
    this.destroy();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !rawStream || rawStream.getAudioTracks().length === 0) {
      return rawStream;
    }

    const ctx = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' });
    this.ctx = ctx;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const source = ctx.createMediaStreamSource(rawStream);
    this.sourceNode = source;

    // 1. Sub-bass desk-thud & mechanical keyboard bottom-out rejection (< 92 Hz)
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = this.mode === 'off' ? 20 : 92;
    hp.Q.value = 0.707;
    this.highpassNode = hp;

    // 2. Human voice intelligibility boost (2.65 kHz)
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2650;
    presence.Q.value = 1.1;
    presence.gain.value = this.mode === 'off' ? 0 : 2.4;
    this.presenceNode = presence;

    // 3. Keycap clack / sibilance tamer (> 5.2 kHz)
    const deClick = ctx.createBiquadFilter();
    deClick.type = 'highshelf';
    deClick.frequency.value = 5200;
    deClick.gain.value = this.mode === 'ultra' ? -6.5 : this.mode === 'standard' ? -3.5 : 0;
    this.deClickShelf = deClick;

    // 4. Broadcast leveling compressor so voice stays steady even when turning head
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.knee.value = 18;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.003;
    comp.release.value = 0.16;
    this.compressorNode = comp;

    const dest = ctx.createMediaStreamDestination();
    this.destNode = dest;

    // Try attaching inline AudioWorklet processor
    let workletReady = false;
    if (ctx.audioWorklet && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
      try {
        const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        try {
          await ctx.audioWorklet.addModule(blobUrl);
          const wn = new AudioWorkletNode(ctx, 'mash-krisp-processor');
          wn.port.postMessage({ mode: this.mode });
          wn.port.onmessage = (ev) => {
            if (ev.data) this.onMeter?.(ev.data);
          };
          this.workletNode = wn;
          workletReady = true;
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } catch {
        workletReady = false;
      }
    }

    source.connect(hp);
    if (workletReady && this.workletNode) {
      hp.connect(this.workletNode);
      this.workletNode.connect(presence);
    } else {
      hp.connect(presence);
      this.startFallbackMeter(hp, comp);
    }
    presence.connect(deClick);
    deClick.connect(comp);
    comp.connect(dest);

    return dest.stream;
  }

  startFallbackMeter(inNode, outNode) {
    if (!this.ctx) return;
    try {
      const aIn = this.ctx.createAnalyser();
      const aOut = this.ctx.createAnalyser();
      aIn.fftSize = 256;
      aOut.fftSize = 256;
      inNode.connect(aIn);
      outNode.connect(aOut);
      const bIn = new Uint8Array(aIn.frequencyBinCount);
      const bOut = new Uint8Array(aOut.frequencyBinCount);
      this.fallbackTimer = setInterval(() => {
        aIn.getByteFrequencyData(bIn);
        aOut.getByteFrequencyData(bOut);
        let s1 = 0;
        let s2 = 0;
        for (let i = 0; i < bIn.length; i++) {
          s1 += bIn[i];
          s2 += bOut[i];
        }
        const lvlIn = Math.min(1, s1 / bIn.length / 90);
        const lvlOut = Math.min(1, s2 / bOut.length / 90);
        this.onMeter?.({
          inputLevel: lvlIn,
          outputLevel: lvlOut,
          suppressedDb: this.mode === 'off' ? 0 : Math.max(0, Math.round((lvlIn - lvlOut) * 24)),
          voiceActive: lvlOut > 0.14,
        });
      }, 100);
    } catch {
      // ignore
    }
  }

  setMode(nextMode) {
    const valid = nextMode === 'ultra' || nextMode === 'standard' || nextMode === 'off' ? nextMode : 'ultra';
    this.mode = valid;
    saveKrispMode(valid);

    if (this.highpassNode) {
      this.highpassNode.frequency.value = valid === 'off' ? 20 : 92;
    }
    if (this.presenceNode) {
      this.presenceNode.gain.value = valid === 'off' ? 0 : 2.4;
    }
    if (this.deClickShelf) {
      this.deClickShelf.gain.value = valid === 'ultra' ? -6.5 : valid === 'standard' ? -3.5 : 0;
    }
    if (this.workletNode) {
      this.workletNode.port.postMessage({ mode: valid });
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  destroy() {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    try {
      this.workletNode?.disconnect();
      this.sourceNode?.disconnect();
      this.highpassNode?.disconnect();
      this.presenceNode?.disconnect();
      this.deClickShelf?.disconnect();
      this.compressorNode?.disconnect();
      this.ctx?.close();
    } catch {
      // ignore
    }
    this.workletNode = null;
    this.sourceNode = null;
    this.highpassNode = null;
    this.presenceNode = null;
    this.deClickShelf = null;
    this.compressorNode = null;
    this.destNode = null;
    this.ctx = null;
  }
}
