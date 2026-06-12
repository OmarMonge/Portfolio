// Terrain function selection for the portfolio hero.
// Generates candidate scalar fields with the real grammar, then uses the
// thesis analyzer to pick ones with good structural properties: must vary
// along both spatial axes and have enough nodes to be visually interesting.
// This is the thesis angle (structural selection, not pixel metrics) running
// live on every page load.

import { RNG } from './rng';
import { Grammar } from './grammar';
import { DEFAULT_WEIGHTS, type Weights, type ASTNode } from './ast';
import { analyzeAST, type ASTStats } from './analyzer';
import { emitGLSL } from './emitter-glsl';

// Terrain-tuned preset of the same grammar: `hash` is spatial white noise —
// great for texture in the explorer, unusable as a landscape — so it's off
// here. Smooth periodic ops get a nudge; hard-edge ops (step/floor) stay in
// because they read as mesas and cliffs.
export const TERRAIN_WEIGHTS: Weights = {
  operators: {
    ...structuredClone(DEFAULT_WEIGHTS.operators),
    sin: 0.24, cos: 0.24, hash: 0.0, dot: 0.05, step: 0.08,
  },
  terminals: {
    ...structuredClone(DEFAULT_WEIGHTS.terminals),
    // the projection terminals carry 2-15x multipliers — great texture in the
    // explorer, too high-frequency for a landscape. polar_r stays at a pinch:
    // radial bowls read beautifully as terrain.
    polar_r: 0.05, polar_theta: 0,
    spherical_x: 0, spherical_y: 0, spherical_z: 0,
    mat_x: 0, mat_y: 0,
  },
};

export const TERRAIN = {
  FN_COUNT: 4,      // height functions baked per load; hero crossfades through them
  DEPTH: 4,         // grammar recursion depth for terrain candidates
  MAX_TRIES: 96,    // candidate budget before falling back
  MIN_NODES: 12,    // structural floor — below this, fields tend to look flat
  MIN_SIGMA: 0.05,  // numeric floor — probed std-dev below this = visually flat
  MAX_GAIN: 6.0,    // cap on normalization gain so noise isn't over-amplified
  GRID_N: 120,      // grid cells per side (121×121 verts, Uint16-safe indices)
  WORLD: 4.2,       // world-space width/depth of the plane
  AMP: 0.95,        // height amplitude after soft-clamp
  SPAN: 0.32,       // uv window size — zooms into the field to tame aliasing
  ROT: 0.45,        // sample-space rotation (rad) so field ridges cut the mesh diagonally
  SCROLL: 0.02,     // uv scroll speed -> flythrough motion
  HOLD_S: 9,        // seconds to hold each function
  BLEND_S: 4,       // seconds to crossfade to the next
  FOG_K: 0.50,      // exponential distance fog factor
} as const;

export interface TerrainFn {
  expr: string;     // GLSL scalar expression in terms of `uv` and `u_time`
  seed: number;
  stats: ASTStats;
  mu: number;       // probed mean over the sample window
  gain: number;     // probed normalization gain (1 / k·sigma, capped)
}

export interface TerrainPick {
  fns: TerrainFn[];
  tried: number;    // candidates generated before filling the pool
}

export function pickTerrainFns(masterSeed: number): TerrainPick {
  const accepted: TerrainFn[] = [];
  const rejected: TerrainFn[] = [];
  let tried = 0;

  for (let i = 0; i < TERRAIN.MAX_TRIES && accepted.length < TERRAIN.FN_COUNT; i++) {
    tried++;
    const seed = (masterSeed + i * 2654435761) >>> 0;
    const rng = new RNG(seed);
    const grammar = new Grammar(rng, TERRAIN_WEIGHTS);
    const ast = grammar.genFloatExpr(TERRAIN.DEPTH);
    const stats = analyzeAST(ast);

    // Numeric probe: evaluate the field on the CPU over the actual sample
    // window. Rejects visually-flat candidates that structural metrics can't
    // see, and yields mean/sigma to normalize every accepted field to a
    // consistent height range.
    const { mu, sigma } = probeField(ast);
    const gain = Math.min(TERRAIN.MAX_GAIN, 1 / (1.4 * Math.max(sigma, 1e-6)));
    const fn: TerrainFn = { expr: emitGLSL(ast), seed, stats, mu, gain };

    // Structural selection: respond to both spatial axes, clear a complexity
    // floor, and actually vary inside the window. (hasTime is a bonus, not
    // required — the uv scroll guarantees motion either way.)
    if (stats.hasX && stats.hasY && stats.nodeCount >= TERRAIN.MIN_NODES && sigma >= TERRAIN.MIN_SIGMA) {
      accepted.push(fn);
    } else {
      rejected.push(fn);
    }
  }

  // Worst case: fill from rejects, best-first by node count.
  rejected.sort((a, b) => (b.stats.nodeCount * (b.gain < TERRAIN.MAX_GAIN ? 2 : 1)) - (a.stats.nodeCount * (a.gain < TERRAIN.MAX_GAIN ? 2 : 1)));
  while (accepted.length < TERRAIN.FN_COUNT && rejected.length) {
    accepted.push(rejected.shift()!);
  }

  return { fns: accepted, tried };
}

// ---- tiny column-major mat4 helpers (all the 3D math the hero needs) ----

export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function lookAt(eye: V3, center: V3, up: V3): Float32Array {
  const z = norm(sub(eye, center));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

export function mat4mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

// ---- mesh + shader assembly shared by the hero and the validation harness ----

export function buildGridMesh(n: number): { positions: Float32Array; indices: Uint16Array } {
  const verts = (n + 1) * (n + 1);
  const positions = new Float32Array(verts * 2);
  let p = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions[p++] = i / n - 0.5;
      positions[p++] = j / n - 0.5;
    }
  }
  // line segments along both axes — one LINES draw call
  const segs = 2 * n * (n + 1);
  const indices = new Uint16Array(segs * 2);
  let q = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      indices[q++] = a; indices[q++] = a + 1;
    }
  }
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j < n; j++) {
      const a = j * (n + 1) + i;
      indices[q++] = a; indices[q++] = a + (n + 1);
    }
  }
  return { positions, indices };
}

// Triangle indices for the same grid — the solid "quilt" pass.
// (Vertex count stays under 65536, so Uint16 index VALUES are safe.)
export function buildGridTriIndices(n: number): Uint16Array {
  const indices = new Uint16Array(n * n * 6);
  let q = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + (n + 1);
      const d = c + 1;
      indices[q++] = a; indices[q++] = c; indices[q++] = b;
      indices[q++] = b; indices[q++] = c; indices[q++] = d;
    }
  }
  return indices;
}

// Surface (tiles-on-terrain) settings for the composite hero.
export const SURF = {
  TILES: 8.0,       // tile count across the plane
  POOL: 24,         // distinct tile shaders (cells repeat via hash anyway;
                    // 48+ works in browsers but strains weak GLSL compilers)
  DEPTH: 3,         // tile grammar depth
  GUTTER: 0.06,     // seam width inside each tile (0..1 local)
  LIFT: 0.004,      // wireframe pass height offset to avoid z-fighting
} as const;

// The blendable height-function block: fn0..fnN + a selector. Soft-clamp
// x/(1+|x|) keeps any grammar output bounded without GLSL-ES-3-only builtins.
export function heightFnBlock(fns: TerrainFn[]): string {
  const defs = fns
    .map((f, i) =>
      `float fn${i}(vec2 uv){ float e = ${f.expr}; ` +
      `e = (e - ${f.mu.toFixed(5)}) * ${f.gain.toFixed(5)}; ` +
      `return e / (1.0 + abs(e)); }`)
    .join('\n');
  const sel = fns
    .map((_, i) => `  ${i ? 'else ' : ''}if (i == ${i}) { return fn${i}(uv); }`)
    .join('\n');
  return `${defs}\nfloat H(int i, vec2 uv){\n${sel}\n  return 0.0;\n}`;
}

// ---- CPU evaluator for the probe ----
// Matches the *emitter's* semantics exactly (add averages, dot doubles, etc.)
// so probed statistics describe what the GPU will actually compute.

type EvalVal = number | [number, number];

const asNum = (v: EvalVal): number => (typeof v === 'number' ? v : v[0]);
const fractf = (x: number): number => x - Math.floor(x);

export function evalAST(node: ASTNode, u: number, v: number, time: number): EvalVal {
  switch (node.type) {
    case 'uv': return [u, v];
    case 'time': return time;
    case 'number': return node.value;
    case 'component_x': {
      const e = evalAST(node.expr, u, v, time);
      return typeof e === 'number' ? e : e[0];
    }
    case 'component_y': {
      const e = evalAST(node.expr, u, v, time);
      return typeof e === 'number' ? e : e[1];
    }
    case 'multiply': {
      const a = evalAST(node.left, u, v, time);
      const b = evalAST(node.right, u, v, time);
      if (typeof a !== 'number' && typeof b === 'number') return [a[0] * b, a[1] * b];
      if (typeof b !== 'number' && typeof a === 'number') return [b[0] * a, b[1] * a];
      return asNum(a) * asNum(b);
    }
    case 'add':
      return (asNum(evalAST(node.left, u, v, time)) + asNum(evalAST(node.right, u, v, time))) * 0.5;
    case 'floor': return Math.floor(asNum(evalAST(node.expr, u, v, time)));
    case 'sin': return Math.sin(asNum(evalAST(node.expr, u, v, time)));
    case 'cos': return Math.cos(asNum(evalAST(node.expr, u, v, time)));
    case 'mod': {
      const a = asNum(evalAST(node.left, u, v, time));
      const b = asNum(evalAST(node.right, u, v, time));
      return a - b * Math.floor(a / b);
    }
    case 'step':
      return asNum(evalAST(node.value, u, v, time)) < asNum(evalAST(node.edge, u, v, time)) ? 0 : 1;
    case 'mix': {
      const a = asNum(evalAST(node.a, u, v, time));
      const b = asNum(evalAST(node.b, u, v, time));
      const t = Math.min(1, Math.max(0, asNum(evalAST(node.t, u, v, time))));
      return a + (b - a) * t;
    }
    case 'dot': {
      const a = asNum(evalAST(node.left, u, v, time));
      const b = asNum(evalAST(node.right, u, v, time));
      return a * b * 2.0; // dot(vec2(a), vec2(b))
    }
    case 'fract': return fractf(asNum(evalAST(node.expr, u, v, time)));
    case 'abs': return Math.abs(asNum(evalAST(node.expr, u, v, time)));
    case 'clamp': {
      const x = asNum(evalAST(node.expr, u, v, time));
      const lo = asNum(evalAST(node.min, u, v, time));
      const hi = asNum(evalAST(node.max, u, v, time));
      return Math.min(hi, Math.max(lo, x));
    }
    case 'hash': return fractf(Math.sin(asNum(evalAST(node.expr, u, v, time)) * 43758.5453));
    case 'length_vec2':
      return Math.hypot(asNum(evalAST(node.left, u, v, time)), asNum(evalAST(node.right, u, v, time)));
    case 'min':
      return Math.min(asNum(evalAST(node.left, u, v, time)), asNum(evalAST(node.right, u, v, time)));
    case 'max':
      return Math.max(asNum(evalAST(node.left, u, v, time)), asNum(evalAST(node.right, u, v, time)));
    case 'exp':
      return Math.exp(Math.min(10, Math.max(-10, asNum(evalAST(node.expr, u, v, time)))));
    case 'pow':
      return Math.pow(Math.abs(asNum(evalAST(node.base, u, v, time))) + 0.0001, asNum(evalAST(node.exponent, u, v, time)));
    case 'smoothstep': {
      const e0 = asNum(evalAST(node.edge0, u, v, time));
      const e1 = asNum(evalAST(node.edge1, u, v, time));
      const x = asNum(evalAST(node.value, u, v, time));
      const tt = Math.min(1, Math.max(0, (x - e0) / Math.max(e1 - e0, 1e-6)));
      return tt * tt * (3 - 2 * tt);
    }
    case 'atan2':
      return Math.atan2(asNum(evalAST(node.y, u, v, time)), asNum(evalAST(node.x, u, v, time)));
    case 'polar_r': return Math.hypot(u - 0.5, v - 0.5);
    case 'polar_theta': return Math.atan2(v - 0.5, u - 0.5);
    case 'spherical_x': return Math.sin(v * 3.1415927) * Math.cos(u * 6.2831853);
    case 'spherical_y': return Math.sin(v * 3.1415927) * Math.sin(u * 6.2831853);
    case 'spherical_z': return Math.cos(v * 3.1415927);
    case 'mat_x': return node.a * u + node.b * v;
    case 'mat_y': return node.c * u + node.d * v;
    case 'vec4_rgb': return asNum(evalAST(node.r, u, v, time));
    case 'assign_color': return evalAST(node.expr, u, v, time);
  }
}

// Probe the field over the actual sample window at a few timestamps.
// Sigma is computed *spatially per timestamp* and then averaged — a field
// whose variance lives in time but is flat in space must not pass.
export function probeField(ast: ASTNode): { mu: number; sigma: number } {
  const N = 14;
  const cr = Math.cos(TERRAIN.ROT), sr = Math.sin(TERRAIN.ROT);
  const mus: number[] = [];
  const sigmas: number[] = [];
  for (const t of [0, 8, 16]) {
    const samples: number[] = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const px = i / (N - 1) - 0.5;
        const py = j / (N - 1) - 0.5;
        const rx = px * cr - py * sr;
        const ry = px * sr + py * cr;
        const u = rx * TERRAIN.SPAN + 0.5;
        const v = ry * TERRAIN.SPAN + 0.5 + t * TERRAIN.SCROLL;
        const e = asNum(evalAST(ast, u, v, t));
        if (Number.isFinite(e)) samples.push(e);
      }
    }
    if (samples.length === 0) continue;
    const mu = samples.reduce((s, x) => s + x, 0) / samples.length;
    const sg = Math.sqrt(samples.reduce((s, x) => s + (x - mu) * (x - mu), 0) / samples.length);
    mus.push(mu);
    sigmas.push(sg);
  }
  if (mus.length === 0) return { mu: 0, sigma: 0 };
  return {
    mu: mus.reduce((s, x) => s + x, 0) / mus.length,
    sigma: sigmas.reduce((s, x) => s + x, 0) / sigmas.length,
  };
}
