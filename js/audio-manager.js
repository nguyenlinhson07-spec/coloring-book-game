/* audio-manager.js — simple original sounds synthesized with the Web Audio API */
const AudioManager = (() => {
  let ctx = null;
  let enabled = true;
  let musicEnabled = false;
  let volume = 0.6;
  let musicNodes = null;

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function setEnabled(v) {
    enabled = v;
    if (!v) stopAmbient();
  }
  function isEnabled() { return enabled; }
  function setMusicEnabled(v) {
    musicEnabled = v;
    if (v) startMusic(); else stopMusic();
  }
  function isMusicEnabled() { return musicEnabled; }
  function setVolume(v) { volume = v; }

  function tone(freq, duration, type = 'sine', gainPeak = 0.25, delay = 0) {
    if (!enabled) return;
    const c = ensureContext();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = c.currentTime + delay;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak * volume, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function click() { tone(520, 0.09, 'square', 0.15); }

  function colorSelect() { tone(660, 0.1, 'sine', 0.18); }

  function fill() {
    tone(440, 0.08, 'sine', 0.2);
    tone(660, 0.12, 'sine', 0.15, 0.05);
  }

  function undo() { tone(300, 0.12, 'triangle', 0.18); }

  /* No "wrong answer" buzzer for kids — a near-miss tap still gets a soft,
     friendly nudge rather than an error sound (paired with the engine's
     touch-tolerance, real misses are rare anyway). */
  function invalid() { tone(700, 0.07, 'sine', 0.1); }

  const COMPLETION_MELODIES = [
    [523, 659, 784, 1046],
    [392, 523, 659, 784, 988],
    [440, 554, 659, 880],
    [523, 587, 659, 784, 1046, 1318]
  ];

  function completion() {
    const notes = COMPLETION_MELODIES[Math.floor(Math.random() * COMPLETION_MELODIES.length)];
    notes.forEach((f, i) => tone(f, 0.25, 'sine', 0.22, i * 0.12));
  }

  function startMusic() {
    if (!enabled || musicNodes) return;
    const c = ensureContext();
    const notes = [392, 440, 494, 523, 494, 440];
    let i = 0;
    const gain = c.createGain();
    gain.gain.value = 0.05 * volume;
    gain.connect(c.destination);
    const interval = setInterval(() => {
      if (!musicEnabled) return;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i % notes.length];
      const t0 = c.currentTime;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.06 * volume, t0 + 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + 1);
      i++;
    }, 700);
    musicNodes = { interval, gain };
  }

  function stopMusic() {
    if (musicNodes) {
      clearInterval(musicNodes.interval);
      musicNodes = null;
    }
  }

  /* ---------------- Ambient background (per picture-category) ---------------- */
  /* Generative, ultra-quiet soundscapes — no audio files needed, and each
     category gets its own mood so the editor feels tied to what's on screen. */
  let ambientNodes = null;
  let ambientCategory = null;

  const AMBIENT_PROFILES = {
    animals: { notes: [784, 988, 880, 1046], type: 'sine', gain: 0.035, minGap: 1400, maxGap: 3200, dur: 0.5 },
    brainrot: { notes: [392, 440, 523, 587, 659], type: 'triangle', gain: 0.05, minGap: 260, maxGap: 520, dur: 0.16 },
    dinosaurs: { notes: [98, 110, 87, 73], type: 'sine', gain: 0.06, minGap: 2200, maxGap: 4000, dur: 1.4 }
  };
  const AMBIENT_DEFAULT = { notes: [523, 587, 659, 698], type: 'sine', gain: 0.04, minGap: 1600, maxGap: 3000, dur: 0.6 };

  function startAmbient(category) {
    if (ambientNodes && ambientCategory === category) return; // already playing this mood
    stopAmbient();
    if (!enabled) return;
    ambientCategory = category;
    const profile = AMBIENT_PROFILES[category] || AMBIENT_DEFAULT;
    const c = ensureContext();

    let stopped = false;
    function scheduleNext() {
      if (stopped) return;
      const gap = profile.minGap + Math.random() * (profile.maxGap - profile.minGap);
      const timer = setTimeout(() => {
        if (stopped || !enabled) return;
        const freq = profile.notes[Math.floor(Math.random() * profile.notes.length)];
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = profile.type;
        osc.frequency.value = freq;
        const t0 = c.currentTime;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(profile.gain * volume, t0 + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + profile.dur);
        osc.connect(gain).connect(c.destination);
        osc.start(t0);
        osc.stop(t0 + profile.dur + 0.05);
        scheduleNext();
      }, gap);
      ambientNodes.timers.push(timer);
    }

    ambientNodes = { timers: [], stop: () => { stopped = true; } };
    scheduleNext();
  }

  function stopAmbient() {
    if (ambientNodes) {
      ambientNodes.stop();
      ambientNodes.timers.forEach(clearTimeout);
      ambientNodes = null;
    }
    ambientCategory = null;
  }

  return {
    setEnabled, isEnabled, setMusicEnabled, isMusicEnabled, setVolume,
    click, colorSelect, fill, undo, invalid, completion, ensureContext,
    startAmbient, stopAmbient
  };
})();
