// SANDLINE audio: every sound is synthesized with WebAudio. No audio files,
// no network. Created lazily on the first user gesture (browsers block audio
// before interaction); shot modes and headless runs never touch it.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  // Call from a user gesture (click / keydown). Safe to call repeatedly.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      // 1 s of white noise, reused by every percussive sound.
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  get on() {
    return !!this.ctx;
  }

  // Short filtered noise burst: the body of a gunshot, explosion or footstep.
  _noise(dur, filterFreq, filterType, gain, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // Short oscillator blip: clicks, beeps, hit ticks and the round sting.
  _tone(freq, dur, gain, type = 'sine', when = 0, slideTo = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  shot(kind, dist = 0) {
    if (!this.ctx) return;
    // Distant shots are quieter and duller.
    const att = Math.max(0.25, 1 - dist / 60);
    if (kind === 'sniper') {
      this._noise(0.28, 900, 'lowpass', 0.9 * att);
      this._tone(160, 0.16, 0.5 * att, 'square', 0, 55);
    } else if (kind === 'rifle') {
      this._noise(0.14, 1600, 'bandpass', 0.75 * att);
      this._tone(190, 0.08, 0.4 * att, 'square', 0, 70);
    } else if (kind === 'smg') {
      this._noise(0.09, 2200, 'bandpass', 0.55 * att);
      this._tone(240, 0.05, 0.3 * att, 'square', 0, 90);
    } else {
      this._noise(0.11, 1400, 'bandpass', 0.65 * att);
      this._tone(210, 0.06, 0.35 * att, 'square', 0, 80);
    }
  }

  dryFire() {
    this._tone(900, 0.04, 0.2, 'square');
  }

  reload() {
    this._tone(500, 0.04, 0.25, 'square');
    this._tone(700, 0.04, 0.25, 'square', 0.12);
    this._tone(420, 0.05, 0.3, 'square', 0.3);
  }

  hit(headshot) {
    this._tone(headshot ? 2100 : 1500, 0.06, 0.35, 'sine');
  }

  hurt() {
    this._noise(0.12, 500, 'lowpass', 0.5);
    this._tone(110, 0.14, 0.4, 'sawtooth', 0, 60);
  }

  kill() {
    this._tone(880, 0.09, 0.3, 'sine');
    this._tone(1320, 0.14, 0.3, 'sine', 0.08);
  }

  explosion(dist = 0) {
    const att = Math.max(0.3, 1 - dist / 50);
    this._noise(0.9, 320, 'lowpass', 1.0 * att);
    this._tone(70, 0.7, 0.7 * att, 'sine', 0, 30);
  }

  footstep(run) {
    this._noise(0.05, 700, 'lowpass', run ? 0.12 : 0.08);
  }

  beep(freq = 1200) {
    this._tone(freq, 0.09, 0.3, 'sine');
  }

  buy() {
    this._tone(990, 0.07, 0.25, 'sine');
    this._tone(1480, 0.1, 0.25, 'sine', 0.07);
  }

  roundStart() {
    this._tone(392, 0.16, 0.3, 'triangle');
    this._tone(523, 0.22, 0.3, 'triangle', 0.14);
  }

  roundWin() {
    this._tone(523, 0.14, 0.3, 'triangle');
    this._tone(659, 0.14, 0.3, 'triangle', 0.12);
    this._tone(784, 0.28, 0.35, 'triangle', 0.24);
  }

  roundLose() {
    this._tone(392, 0.18, 0.3, 'triangle');
    this._tone(311, 0.3, 0.3, 'triangle', 0.16);
  }

  plant() {
    this._tone(1560, 0.05, 0.25, 'square');
  }
}
