// Áudio 100% procedural com WebAudio (sem arquivos).
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    // buffer de ruído
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // vento contínuo
    this.windSrc = this.loopNoise();
    this.windF = c.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 400; this.windF.Q.value = 0.7;
    this.windG = c.createGain(); this.windG.gain.value = 0;
    this.windSrc.connect(this.windF).connect(this.windG).connect(this.master);
    // gás contínuo
    this.gasSrc = this.loopNoise();
    this.gasF = c.createBiquadFilter(); this.gasF.type = 'highpass'; this.gasF.frequency.value = 2500;
    this.gasG = c.createGain(); this.gasG.gain.value = 0;
    this.gasSrc.connect(this.gasF).connect(this.gasG).connect(this.master);
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true; s.start();
    return s;
  }

  get t() { return this.ctx.currentTime; }

  env(node, a, peak, dec, t0 = this.t) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  }

  noiseHit({ type = 'bandpass', f = 1000, f2 = null, q = 1, peak = 0.4, a = 0.005, dec = 0.15, rate = 1 } = {}) {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.playbackRate.value = rate;
    const fl = this.ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, this.t + a + dec);
    const g = this.ctx.createGain();
    this.env(g, a, peak, dec);
    s.connect(fl).connect(g).connect(this.master);
    s.start(this.t, Math.random()); s.stop(this.t + a + dec + 0.05);
  }

  tone({ type = 'sine', f = 200, f2 = null, peak = 0.3, a = 0.005, dec = 0.2, detune = 0 } = {}) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, this.t + a + dec);
    const g = this.ctx.createGain();
    this.env(g, a, peak, dec);
    o.connect(g).connect(this.master);
    o.start(); o.stop(this.t + a + dec + 0.05);
  }

  setWind(speed) {
    if (!this.ctx) return;
    const k = Math.min(1, Math.max(0, (speed - 6) / 50));
    this.windG.gain.setTargetAtTime(k * k * 0.5, this.t, 0.15);
    this.windF.frequency.setTargetAtTime(300 + k * 900, this.t, 0.2);
  }
  setGas(on) {
    if (!this.ctx) return;
    this.gasG.gain.setTargetAtTime(on ? 0.13 : 0, this.t, on ? 0.03 : 0.08);
  }

  hookFire(side = 1) {
    this.noiseHit({ type: 'highpass', f: 3000, peak: 0.25, dec: 0.12 });
    this.tone({ type: 'square', f: 900 + side * 60, f2: 300, peak: 0.05, dec: 0.12 });
  }
  hookHit(kind) {
    if (kind === 'flesh') this.noiseHit({ type: 'lowpass', f: 600, peak: 0.4, dec: 0.12 });
    else { this.noiseHit({ type: 'bandpass', f: 2200, q: 3, peak: 0.35, dec: 0.08 }); this.tone({ type: 'triangle', f: 1400, f2: 900, peak: 0.08, dec: 0.08 }); }
  }
  hookRelease() { this.noiseHit({ type: 'highpass', f: 4000, peak: 0.08, dec: 0.08 }); }
  burst() { this.noiseHit({ type: 'highpass', f: 1800, peak: 0.35, a: 0.01, dec: 0.3 }); }
  lunge() { this.noiseHit({ type: 'bandpass', f: 1200, f2: 3500, q: 0.8, peak: 0.45, dec: 0.35 }); }
  slash() { this.noiseHit({ type: 'bandpass', f: 4500, f2: 1500, q: 1.5, peak: 0.3, a: 0.01, dec: 0.16, rate: 1.4 }); }
  spinSlash() {
    this.slash();
    setTimeout(() => this.slash(), 75);
    this.tone({ type: 'triangle', f: 1800, f2: 700, peak: 0.12, dec: 0.26 });
  }
  bladeThrow() {
    this.noiseHit({ type: 'bandpass', f: 5200, f2: 1800, q: 2.2, peak: 0.32, a: 0.008, dec: 0.25 });
    this.tone({ type: 'sawtooth', f: 2600, f2: 1100, peak: 0.09, dec: 0.22 });
  }
  apgShot(double = false) {
    const k = double ? 1.35 : 1;
    this.noiseHit({ type: 'lowpass', f: 1100, f2: 240, peak: 0.65 * k, a: 0.002, dec: 0.24 * k });
    this.noiseHit({ type: 'highpass', f: 2600, peak: 0.35 * k, a: 0.002, dec: 0.14 });
    this.tone({ type: 'sawtooth', f: 180, f2: 45, peak: 0.42 * k, a: 0.002, dec: 0.18 });
  }
  spearLaunch(double = false) {
    const k = double ? 1.3 : 1;
    this.noiseHit({ type: 'bandpass', f: 1600, f2: 3800, q: 0.9, peak: 0.48 * k, a: 0.01, dec: 0.42 });
    this.tone({ type: 'sawtooth', f: 320, f2: 920, peak: 0.16 * k, a: 0.01, dec: 0.35 });
  }
  spearExplode() {
    this.noiseHit({ type: 'lowpass', f: 650, f2: 90, peak: 0.85, a: 0.004, dec: 0.75 });
    this.noiseHit({ type: 'bandpass', f: 1800, f2: 350, q: 0.7, peak: 0.5, a: 0.005, dec: 0.45 });
    this.tone({ type: 'sine', f: 95, f2: 24, peak: 0.7, a: 0.004, dec: 0.65 });
  }
  overstress() {
    this.noiseHit({ type: 'highpass', f: 3600, peak: 0.32, a: 0.01, dec: 0.38 });
    this.tone({ type: 'sawtooth', f: 640, f2: 310, peak: 0.14, a: 0.01, dec: 0.32 });
  }
  reelBrake() {
    this.noiseHit({ type: 'bandpass', f: 4200, q: 3.5, peak: 0.08, a: 0.005, dec: 0.06 });
  }
  hit(strong = 1) {
    this.noiseHit({ type: 'lowpass', f: 900, peak: 0.6 * strong, dec: 0.18 });
    this.tone({ type: 'sine', f: 120, f2: 50, peak: 0.4 * strong, dec: 0.2 });
  }
  kill() {
    this.hit(1.2);
    this.tone({ type: 'triangle', f: 660, peak: 0.12, dec: 0.25 });
    setTimeout(() => this.tone({ type: 'triangle', f: 990, peak: 0.12, dec: 0.4 }), 90);
  }
  clang() { this.tone({ type: 'square', f: 1800, f2: 1200, peak: 0.12, dec: 0.15 }); this.noiseHit({ type: 'highpass', f: 5000, peak: 0.2, dec: 0.1 }); }
  bladeBreak() { this.clang(); this.tone({ type: 'sawtooth', f: 2400, f2: 400, peak: 0.08, dec: 0.3 }); }
  reload() { this.tone({ type: 'square', f: 500, peak: 0.06, dec: 0.05 }); this.noiseHit({ type: 'highpass', f: 3500, peak: 0.12, dec: 0.2 }); }
  reloadDone() { this.tone({ type: 'square', f: 1200, f2: 1600, peak: 0.08, dec: 0.1 }); }
  resupply() { this.tone({ type: 'sine', f: 520, peak: 0.15, dec: 0.2 }); setTimeout(() => this.tone({ type: 'sine', f: 780, peak: 0.15, dec: 0.35 }), 120); }
  hurt() { this.tone({ type: 'sawtooth', f: 180, f2: 90, peak: 0.15, dec: 0.25 }); }
  land(impact) { this.noiseHit({ type: 'lowpass', f: 400, peak: Math.min(0.5, impact / 60), dec: 0.15 }); }
  footstep(dist, s) {
    const k = Math.max(0, 1 - dist / 140);
    if (k <= 0) return;
    this.tone({ type: 'sine', f: 70 / Math.sqrt(s), f2: 30, peak: 0.5 * k * k * Math.min(1.5, s), dec: 0.35 });
    this.noiseHit({ type: 'lowpass', f: 250, peak: 0.25 * k * k, dec: 0.25 });
  }
  thud(k = 1, s = 1) {
    this.tone({ type: 'sine', f: 55, f2: 25, peak: 0.7 * k, dec: 0.8 });
    this.noiseHit({ type: 'lowpass', f: 300, peak: 0.5 * k, dec: 0.6 + s * 0.05 });
  }
  roar(s = 1, k = 1) {
    if (!this.ctx) return;
    const t = this.t, dur = 1.0 + k * 0.6;
    const o = this.ctx.createOscillator(), o2 = this.ctx.createOscillator();
    o.type = 'sawtooth'; o2.type = 'sawtooth';
    const f = 110 / Math.sqrt(s);
    o.frequency.setValueAtTime(f * 1.3, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + dur);
    o2.frequency.setValueAtTime(f * 1.32, t); o2.frequency.exponentialRampToValueAtTime(f * 0.68, t + dur);
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 18; lg.gain.value = 12; lfo.connect(lg).connect(o.frequency);
    const fl = this.ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 700;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18 * k, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl); o2.connect(fl); fl.connect(g).connect(this.master);
    o.start(t); o2.start(t); lfo.start(t); o.stop(t + dur); o2.stop(t + dur); lfo.stop(t + dur);
  }
  growl(s = 1) { this.tone({ type: 'sawtooth', f: 80 / Math.sqrt(s), f2: 60, peak: 0.12, a: 0.05, dec: 0.5 }); }
  hiss(dur = 1, peak = 0.3) { this.noiseHit({ type: 'highpass', f: 1500, peak, a: dur * 0.6, dec: dur * 0.5 }); }
  unsheath(on) {
    this.noiseHit({ type: 'highpass', f: on ? 5000 : 3000, f2: on ? 8000 : 2000, peak: 0.18, dec: 0.18 });
    this.tone({ type: 'triangle', f: on ? 2400 : 1600, peak: 0.05, dec: 0.2 });
  }
  flare(kind) {
    if (kind === 'acoustic') { this.tone({ type: 'square', f: 3200, f2: 2800, peak: 0.25, a: 0.01, dec: 1.4 }); this.tone({ type: 'square', f: 3350, peak: 0.15, dec: 1.2 }); }
    else this.noiseHit({ type: 'bandpass', f: 900, peak: 0.4, dec: 0.4 });
  }
  ui() { this.tone({ type: 'triangle', f: 880, peak: 0.08, dec: 0.06 }); }
  ring() { this.tone({ type: 'triangle', f: 1046, peak: 0.12, dec: 0.15 }); setTimeout(() => this.tone({ type: 'triangle', f: 1568, peak: 0.1, dec: 0.25 }), 70); }
  waveStart() { this.roar(2, 0.8); this.tone({ type: 'square', f: 220, peak: 0.08, dec: 0.6 }); }
}
