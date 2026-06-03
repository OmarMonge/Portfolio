// Simple seeded RNG (mulberry32) — deterministic from a 32-bit seed.
// Note: this won't produce identical sequences to Godot's RNG,
// but it is reproducible within the web app.

export class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 1;
  }

  setSeed(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 1;
  }

  // Returns float in [0, 1)
  randf(): number {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  randfRange(min: number, max: number): number {
    return min + this.randf() * (max - min);
  }

  randi(): number {
    return Math.floor(this.randf() * 0xFFFFFFFF);
  }
}
