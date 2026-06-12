// Portfolio hero — the composite: generated tiles ON generated terrain.
//
// One grammar does both jobs. It writes the height function of the landscape
// (candidates screened by the analyzer + a CPU probe, normalized) AND the 48
// shader tiles draped across the surface as its color. A faint wireframe pass
// sits on top. Hand-rolled WebGL2: mesh, matrices, two passes, no framework.
// Reseeds on every load.

import { RNG } from './rng';
import { Grammar } from './grammar';
import { DEFAULT_WEIGHTS } from './ast';
import { emitGLSL } from './emitter-glsl';
import {
  TERRAIN, SURF, pickTerrainFns, perspective, lookAt, mat4mul,
  buildGridMesh, buildGridTriIndices, heightFnBlock,
} from './terrain';

// Fresh landscape + tile set on every reload. To pin a reproducible scene,
// replace this with a constant number, e.g. 73127.
const MASTER_SEED = Math.floor(Math.random() * 0xffffffff) >>> 0;

const TILE_POOL = SURF.POOL;   // distinct tile shaders draped on the surface
const TILE_DEPTH = SURF.DEPTH; // tile grammar depth (terrain fns use TERRAIN.DEPTH)

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// ---- generate: height functions (selected) + tile pool (raw grammar) ----
const pick = pickTerrainFns(MASTER_SEED);
const fns = pick.fns;

const tileExprs: string[] = [];
for (let i = 0; i < TILE_POOL; i++) {
  const rng = new RNG((MASTER_SEED ^ 0x9E3779B9) + i * 2654435761 >>> 0);
  const ast = new Grammar(rng, DEFAULT_WEIGHTS).genShaderAST(TILE_DEPTH);
  tileExprs.push(emitGLSL(ast));
}
const tileBranches = tileExprs
  .map((e, i) => `  ${i ? 'else ' : ''}if (idx == ${i}) { c = ${e}; }`)
  .join('\n');

console.log('%comar.shader — height and surface are both generated code', 'color:#5cf;font-weight:bold;');
fns.forEach((f, i) => {
  console.log(`h fn${i}  seed 0x${f.seed.toString(16).toUpperCase().padStart(8, '0')}  ${f.stats.nodeCount} nodes\n  h(uv) = ${f.expr}`);
});
console.log(`+ ${TILE_POOL} tile shaders draped on the surface (same grammar, depth ${TILE_DEPTH})`);

// ---- HUD ----
const hudEl = document.getElementById('shader-hud');
let lastHudUpdate = 0;

interface Hud { time: HTMLElement | null; res: HTMLElement | null; fn: HTMLElement | null; }

function initHud(): Hud {
  if (!hudEl) return { time: null, res: null, fn: null };
  const seedHex = '0x' + MASTER_SEED.toString(16).toUpperCase().padStart(8, '0');
  hudEl.innerHTML =
    `<div><span class="k">u_time</span><b id="hud-time">0.00s</b></div>` +
    `<div><span class="k">u_res</span><b id="hud-res">—</b></div>` +
    `<div><span class="k">tiles</span><b>${TILE_POOL} ASTs · depth ${TILE_DEPTH}</b></div>` +
    `<div><span class="k">h(uv)</span><b id="hud-fn">—</b></div>` +
    `<div><span class="k">seed</span><b>${seedHex}</b></div>`;
  return {
    time: document.getElementById('hud-time'),
    res: document.getElementById('hud-res'),
    fn: document.getElementById('hud-fn'),
  };
}

// ---- WebGL2 setup ----
const canvas = document.getElementById('grid-canvas') as HTMLCanvasElement | null;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function gradientFallback(): void {
  if (canvas) {
    canvas.style.background =
      'radial-gradient(140% 120% at 25% 30%, #11313d 0%, #0c1416 45%, #0a0a0a 100%)';
  }
}

const gl = canvas
  ? canvas.getContext('webgl2', { antialias: true, alpha: false })
  : null;

if (!canvas || !gl) {
  gradientFallback();
} else {
  // Shared vertex shader: height displacement + uv/height/depth varyings.
  // u_lift raises the wireframe pass slightly to avoid z-fighting.
  const VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
uniform mat4 u_mvp;
uniform float u_time;
uniform int u_fnA;
uniform int u_fnB;
uniform float u_blend;
uniform float u_lift;

out float v_h;
out float v_dist;
out vec2 v_uv;

${heightFnBlock(fns)}

void main() {
  float cr = ${Math.cos(TERRAIN.ROT).toFixed(5)};
  float sr = ${Math.sin(TERRAIN.ROT).toFixed(5)};
  vec2 rp = vec2(a_pos.x * cr - a_pos.y * sr, a_pos.x * sr + a_pos.y * cr);
  vec2 uv = rp * ${TERRAIN.SPAN.toFixed(3)} + vec2(0.5, 0.5 + u_time * ${TERRAIN.SCROLL.toFixed(4)});
  float h = mix(H(u_fnA, uv), H(u_fnB, uv), u_blend) * ${TERRAIN.AMP.toFixed(3)};
  vec3 world = vec3(a_pos.x * ${TERRAIN.WORLD.toFixed(2)}, h + u_lift, a_pos.y * ${TERRAIN.WORLD.toFixed(2)});
  vec4 clip = u_mvp * vec4(world, 1.0);
  v_uv = uv;
  v_h = h / ${TERRAIN.AMP.toFixed(3)};
  v_dist = clip.w;
  gl_Position = clip;
}`;

  // Solid pass: the tile quilt, draped over the heightfield.
  const FRAG_SOLID = `#version 300 es
precision highp float;
in float v_h;
in float v_dist;
in vec2 v_uv;
uniform float u_time;
out vec4 fragColor;

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float u_timeAlias() { return u_time; } // keep uniform alive even if no tile uses time

// every branch below is one generated AST, emitted to GLSL
vec3 tileColor(int idx, vec2 uv){
  vec3 c = vec3(0.0);
${tileBranches}
  return c;
}

void main(){
  // plane-stable tile coordinates: scroll with the terrain so tiles stick to it
  vec2 q = (v_uv - 0.5) / ${TERRAIN.SPAN.toFixed(3)} + 0.5;
  vec2 g = q * ${SURF.TILES.toFixed(1)};
  vec2 cell = floor(g);
  vec2 f = fract(g);

  int idx = int(hash21(cell + 0.5) * float(${TILE_POOL}));
  idx = clamp(idx, 0, ${TILE_POOL - 1});

  float u_t = u_timeAlias();
  vec3 col = tileColor(idx, f);
  col = clamp(col * 0.5 + 0.5, 0.0, 1.0);

  vec2 gut = smoothstep(0.0, ${SURF.GUTTER.toFixed(3)}, f) * smoothstep(0.0, ${SURF.GUTTER.toFixed(3)}, 1.0 - f);
  col *= mix(0.22, 1.0, gut.x * gut.y);      // seams between tiles

  float ht = clamp(v_h * 0.5 + 0.5, 0.0, 1.0);
  col *= 0.24 + 0.40 * ht;                   // peaks catch more light
  float fog = exp(-${TERRAIN.FOG_K.toFixed(3)} * max(v_dist - 1.0, 0.0));
  fragColor = vec4(col * fog * 0.52, 1.0);
}`;

  // Wire pass: faint cyan grid floating just above the quilt.
  const FRAG_WIRE = `#version 300 es
precision highp float;
in float v_h;
in float v_dist;
in vec2 v_uv;
out vec4 fragColor;

void main(){
  float t = clamp(v_h * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.06, 0.16, 0.20), vec3(0.33, 0.80, 1.00), t * t);
  float fog = exp(-${TERRAIN.FOG_K.toFixed(3)} * max(v_dist - 1.0, 0.0));
  fragColor = vec4(col * fog * 0.22, 1.0);
}`;

  const compile = (type: number, src: string): WebGLShader | null => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('shader compile error:\n' + gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };

  const link = (frag: string): WebGLProgram | null => {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return null;
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('link error:\n' + gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  };

  const progSolid = link(FRAG_SOLID);
  const progWire = link(FRAG_WIRE);

  if (!progSolid || !progWire) {
    gradientFallback();                  // emitter bug? never show black
  } else {
    const hud = initHud();

    // ---- mesh + VAOs (one VBO, two index buffers) ----
    const lineMesh = buildGridMesh(TERRAIN.GRID_N);
    const triIndices = buildGridTriIndices(TERRAIN.GRID_N);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, lineMesh.positions, gl.STATIC_DRAW);

    const makeVAO = (prog: WebGLProgram, indices: Uint16Array): WebGLVertexArrayObject => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      const loc = gl.getAttribLocation(prog, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return vao;
    };

    const vaoSolid = makeVAO(progSolid, triIndices);
    const vaoWire = makeVAO(progWire, lineMesh.indices);

    interface Uniforms {
      mvp: WebGLUniformLocation | null; time: WebGLUniformLocation | null;
      fnA: WebGLUniformLocation | null; fnB: WebGLUniformLocation | null;
      blend: WebGLUniformLocation | null; lift: WebGLUniformLocation | null;
    }
    const getU = (p: WebGLProgram): Uniforms => ({
      mvp: gl.getUniformLocation(p, 'u_mvp'),
      time: gl.getUniformLocation(p, 'u_time'),
      fnA: gl.getUniformLocation(p, 'u_fnA'),
      fnB: gl.getUniformLocation(p, 'u_fnB'),
      blend: gl.getUniformLocation(p, 'u_blend'),
      lift: gl.getUniformLocation(p, 'u_lift'),
    });
    const uSolid = getU(progSolid);
    const uWire = getU(progWire);

    gl.clearColor(0.039, 0.039, 0.039, 1); // #0a0a0a

    // ---- camera / resize ----
    let aspect = 1;
    let dpr = 1;
    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        if (hud.res) hud.res.textContent = `${w}×${h}`;
      }
      aspect = w / Math.max(h, 1);
    };
    window.addEventListener('resize', resize);
    resize();
    if (hud.res) hud.res.textContent = `${canvas.width}×${canvas.height}`;

    let mx = 0, my = 0, tmx = 0, tmy = 0;
    if (!reduceMotion) {
      window.addEventListener('pointermove', (e) => {
        tmx = (e.clientX / window.innerWidth) * 2 - 1;
        tmy = (e.clientY / window.innerHeight) * 2 - 1;
      });
    }

    // ---- crossfade schedule ----
    const K = fns.length;
    const PERIOD = TERRAIN.HOLD_S + TERRAIN.BLEND_S;
    const schedule = (t: number): { a: number; b: number; blend: number } => {
      if (K <= 1) return { a: 0, b: 0, blend: 0 };
      const cyc = Math.floor(t / PERIOD);
      const ph = t - cyc * PERIOD;
      const a = cyc % K;
      const b = (a + 1) % K;
      let blend = 0;
      if (ph > TERRAIN.HOLD_S) {
        const x = (ph - TERRAIN.HOLD_S) / TERRAIN.BLEND_S;
        blend = x * x * (3 - 2 * x);
      }
      return { a, b, blend };
    };

    const fnLabel = (s: { a: number; b: number; blend: number }): string => {
      const pad = (n: number) => String(n).padStart(2, '0');
      const nodes = fns[s.blend > 0.5 ? s.b : s.a].stats.nodeCount;
      return s.blend > 0 && s.blend < 1
        ? `fn ${pad(s.a)}→${pad(s.b)} · ${nodes} nodes`
        : `fn ${pad(s.a)} · ${nodes} nodes`;
    };

    const setU = (u: Uniforms, mvp: Float32Array, t: number, s: { a: number; b: number; blend: number }, lift: number) => {
      gl.uniformMatrix4fv(u.mvp, false, mvp);
      gl.uniform1f(u.time, t);
      gl.uniform1i(u.fnA, s.a);
      gl.uniform1i(u.fnB, s.b);
      gl.uniform1f(u.blend, s.blend);
      gl.uniform1f(u.lift, lift);
    };

    const start = performance.now();
    let visible = true;
    const frame = (): void => {
      if (!visible) return;
      resize();

      const t = reduceMotion ? 8.0 : (performance.now() - start) / 1000;
      const s = schedule(t);

      mx += (tmx - mx) * 0.04;
      my += (tmy - my) * 0.04;

      const eye: [number, number, number] = [
        Math.sin(t * 0.06) * 0.35 + mx * 0.25,
        1.02 + my * 0.12,
        2.05,
      ];
      const view = lookAt(eye, [0, -0.18, -0.55], [0, 1, 0]);
      const proj = perspective(0.9, aspect, 0.05, 12);
      const mvp = mat4mul(proj, view);

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // pass 1 — solid tile quilt
      gl.useProgram(progSolid);
      setU(uSolid, mvp, t, s, 0.0);
      gl.bindVertexArray(vaoSolid);
      gl.drawElements(gl.TRIANGLES, triIndices.length, gl.UNSIGNED_SHORT, 0);

      // pass 2 — faint wireframe floating just above
      gl.useProgram(progWire);
      setU(uWire, mvp, t, s, SURF.LIFT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.bindVertexArray(vaoWire);
      gl.drawElements(gl.LINES, lineMesh.indices.length, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);

      const now = performance.now();
      if (now - lastHudUpdate > 100) {
        lastHudUpdate = now;
        if (hud.time) hud.time.textContent = t.toFixed(2) + 's';
        if (hud.fn) hud.fn.textContent = fnLabel(s);
      }

      if (!reduceMotion) requestAnimationFrame(frame);
    };
    document.addEventListener('visibilitychange', () => {
      visible = !document.hidden;
      if (visible && !reduceMotion) frame();
    });
    frame();
  }
}
