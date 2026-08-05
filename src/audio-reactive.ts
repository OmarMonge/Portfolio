// audio-reactive.ts — drives the Explorer's Bands with live FFT.
//
// This is the browser version of the Godot fft_mode wrapping. While music plays,
// the spectrum is split into bass/mid/high/energy exactly the way the Godot and
// Unity analyzers split it (bins 0-7 / 8-23 / 24-63), smoothed with a fast-attack
// slow-release envelope follower, and written straight into the four band fields
// the renderer already reads every frame. Toggle it off and the sliders take over
// again — nothing about the existing control system changes.
//
// Default mapping (tweak `base`, `gain`, or the four lines in loop()):
//   waves   <- bass     (sin · cos · mix · atan2)
//   vector  <- mid      (dot · length_vec2)
//   tiling  <- high     (floor · mod · step · fract · smoothstep)
//   shaping <- energy   (abs · clamp · hash · min · max · exp · pow)

import type { Renderer } from './renderer';

const BANDS = ['waves', 'vector', 'tiling', 'shaping'] as const;
export type BandLevels = Record<(typeof BANDS)[number], number>;

export class AudioReactive {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array<ArrayBuffer> | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private enabled = false;
  private raf = 0;
  private last = performance.now();

  // smoothed 0..1 levels (envelope follower state)
  private level = { bass: 0, mid: 0, high: 0, energy: 0 };

  // mapping knobs: band value = base + level * gain, clamped to [0, 2]
  base = 0.6;
  gain = 1.5;

  private static ATTACK = 0.03;   // s — fast rise on beats
  private static RELEASE = 0.25;  // s — slow fall after
  private static INPUT_GAIN = 1.6; // byte FFT is 0..255; small lift then clamp

  // hooks for the UI (optional)
  onUpdate: ((bands: BandLevels) => void) | null = null;
  onStatus: ((s: string) => void) | null = null;

  constructor(private renderer: Renderer) {}

  isEnabled(): boolean { return this.enabled; }

  private ensure(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 128;             // 64 bins — matches the Godot/Unity analyzers
    this.analyser.smoothingTimeConstant = 0; // we do our own envelope smoothing
    this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
  }

  async useMic(): Promise<void> {
    this.ensure();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.ctx!.createMediaStreamSource(stream).connect(this.analyser!); // analyse only, no playback
      this.setEnabled(true);
      this.onStatus?.('mic');
    } catch {
      this.onStatus?.('mic blocked');
    }
  }

  useFile(file: File): void {
    this.ensure();
    if (this.audioEl) { this.audioEl.pause(); this.audioEl.src = ''; }
    this.audioEl = new Audio(URL.createObjectURL(file));
    this.audioEl.loop = true;
    const src = this.ctx!.createMediaElementSource(this.audioEl);
    src.connect(this.analyser!);
    this.analyser!.connect(this.ctx!.destination); // hear it through speakers
    this.ctx!.resume();
    this.audioEl.play();
    this.setEnabled(true);
    this.onStatus?.(file.name);
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.last = performance.now();
      this.loop();
    } else {
      cancelAnimationFrame(this.raf);
      for (const b of BANDS) this.renderer.controls[b] = 1; // hand bands back to the sliders
      this.onUpdate?.({ waves: 1, vector: 1, tiling: 1, shaping: 1 });
    }
  }

  private loop = (): void => {
    if (!this.enabled || !this.analyser || !this.freq) return;

    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    this.analyser.getByteFrequencyData(this.freq);
    let b = 0, m = 0, h = 0;
    for (let i = 0;  i < 8;  i++) b += this.freq[i];
    for (let i = 8;  i < 24; i++) m += this.freq[i];
    for (let i = 24; i < 64; i++) h += this.freq[i];
    b = Math.min(1, (b / 8  / 255) * AudioReactive.INPUT_GAIN);
    m = Math.min(1, (m / 16 / 255) * AudioReactive.INPUT_GAIN);
    h = Math.min(1, (h / 40 / 255) * AudioReactive.INPUT_GAIN);
    const e = (b + m + h) / 3;

    const ka = 1 - Math.exp(-dt / AudioReactive.ATTACK);
    const kr = 1 - Math.exp(-dt / AudioReactive.RELEASE);
    const follow = (cur: number, tgt: number) => cur + (tgt - cur) * (tgt > cur ? ka : kr);
    this.level.bass   = follow(this.level.bass, b);
    this.level.mid    = follow(this.level.mid, m);
    this.level.high   = follow(this.level.high, h);
    this.level.energy = follow(this.level.energy, e);

    const map = (x: number) => Math.min(2, this.base + x * this.gain);
    const bands: BandLevels = {
      waves:   map(this.level.bass),
      vector:  map(this.level.mid),
      tiling:  map(this.level.high),
      shaping: map(this.level.energy),
    };
    for (const k of BANDS) this.renderer.controls[k] = bands[k];
    this.onUpdate?.(bands);

    this.raf = requestAnimationFrame(this.loop);
  };
}
