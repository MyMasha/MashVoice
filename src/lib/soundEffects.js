let audioCtx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playToneSequence(notes) {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const { freq, start, dur, gain = 0.06, type = 'sine' } of notes) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now + start);
    g.gain.setValueAtTime(0.0001, now + start);
    g.gain.exponentialRampToValueAtTime(gain, now + start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
  }
}

export const mashSounds = {
  unlockGate() {
    playToneSequence([
      { freq: 330, start: 0, dur: 0.12, gain: 0.05, type: 'triangle' },
      { freq: 495, start: 0.08, dur: 0.14, gain: 0.06, type: 'triangle' },
      { freq: 660, start: 0.16, dur: 0.24, gain: 0.07, type: 'sine' },
    ]);
  },
  joinVoice() {
    playToneSequence([
      { freq: 440, start: 0, dur: 0.09, gain: 0.05 },
      { freq: 587.33, start: 0.07, dur: 0.14, gain: 0.06 },
    ]);
  },
  leaveVoice() {
    playToneSequence([
      { freq: 523.25, start: 0, dur: 0.09, gain: 0.05 },
      { freq: 349.23, start: 0.07, dur: 0.15, gain: 0.05 },
    ]);
  },
  toggleMute(muted) {
    playToneSequence(
      muted
        ? [{ freq: 310, start: 0, dur: 0.09, gain: 0.04 }]
        : [{ freq: 520, start: 0, dur: 0.09, gain: 0.04 }]
    );
  },
  startStream() {
    playToneSequence([
      { freq: 392, start: 0, dur: 0.08, gain: 0.05 },
      { freq: 523.25, start: 0.06, dur: 0.09, gain: 0.05 },
      { freq: 783.99, start: 0.12, dur: 0.2, gain: 0.06 },
    ]);
  },
  messageTick() {
    playToneSequence([{ freq: 620, start: 0, dur: 0.05, gain: 0.025 }]);
  },
};
