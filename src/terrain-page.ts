// Generated Terrain — standalone project page (/terrain.html).
//
// The grammar (src/grammar.ts) generates candidate scalar fields, the thesis
// analyzer (src/analyzer.ts) selects ones with good structural properties,
// and this file renders the winners as a 3D heightfield: a wireframe grid
// displaced *in the vertex shader* by the generated expression itself.
// Hand-rolled WebGL2 — mesh, matrices, pipeline — no framework.
//
// The hero crossfades through FN_COUNT functions per load and reseeds on
// every reload, so no two visitors see the same landscape.

import {
  TERRAIN, pickTerrainFns, perspective, lookAt, mat4mul,
  buildGridMesh, heightFnBlock,
} from './terrain';

// Fresh landscape on every reload. To pin a fixed, reproducible set instead,
// replace this with a constant number, e.g. 73127.
const MASTER_SEED = Math.floor(Math.random() * 0xffffffff) >>> 0;

// G = new landscape (the seed is random per load, so a reload IS a regenerate)
window.addEventListener('keydown', (e) => {
  if (e.key === 'g' || e.key === 'G') location.reload();
});

// ---- generate + structurally select the height functions ----
const pick = pickTerrainFns(MASTER_SEED);
const fns = pick.fns;

console.log(
  '%comar.shader — this terrain is generated code',
  'color:#5cf;font-weight:bold;'
);
fns.forEach((f, i) => {
  console.log(
    `fn${i}  seed 0x${f.seed.toString(16).toUpperCase().padStart(8, '0')}  ` +
    `${f.stats.nodeCount} nodes  depth ${f.stats.depth}\n  h(uv) = ${f.expr}`
  );
});
console.log(
  `structural selection kept ${fns.length}/${pick.tried} candidates ` +
  `(need x+y dependence, >=${TERRAIN.MIN_NODES} nodes)`
);

// ---- live uniforms HUD (hero, bottom-right) ----
const hudEl = document.getElementById('shader-hud');
let lastHudUpdate = 0;

interface Hud { time: HTMLElement | null; res: HTMLElement | null; fn: HTMLElement | null; }

function initHud(): Hud {
  if (!hudEl) return { time: null, res: null, fn: null };
  const seedHex = '0x' + MASTER_SEED.toString(16).toUpperCase().padStart(8, '0');
  hudEl.innerHTML =
    `<div><span class="k">u_time</span><b id="hud-time">0.00s</b></div>` +
    `<div><span class="k">u_res</span><b id="hud-res">—</b></div>` +
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
  const VERT = `#version 300 es
precision highp float;
in vec2 a_pos;                       // grid xz in [-0.5, 0.5]
uniform mat4 u_mvp;
uniform float u_time;
uniform int u_fnA;
uniform int u_fnB;
uniform float u_blend;

out float v_h;                       // normalized height, -1..1
out float v_dist;                    // view-space depth for fog

${heightFnBlock(fns)}

void main() {
  // zoomed + rotated sample window, scrolled over time -> flythrough
  float cr = ${Math.cos(TERRAIN.ROT).toFixed(5)};
  float sr = ${Math.sin(TERRAIN.ROT).toFixed(5)};
  vec2 rp = vec2(a_pos.x * cr - a_pos.y * sr, a_pos.x * sr + a_pos.y * cr);
  vec2 uv = rp * ${TERRAIN.SPAN.toFixed(3)} + vec2(0.5, 0.5 + u_time * ${TERRAIN.SCROLL.toFixed(4)});
  float h = mix(H(u_fnA, uv), H(u_fnB, uv), u_blend) * ${TERRAIN.AMP.toFixed(3)};
  vec3 world = vec3(a_pos.x * ${TERRAIN.WORLD.toFixed(2)}, h, a_pos.y * ${TERRAIN.WORLD.toFixed(2)});
  vec4 clip = u_mvp * vec4(world, 1.0);
  v_h = h / ${TERRAIN.AMP.toFixed(3)};
  v_dist = clip.w;
  gl_Position = clip;
}`;

  const FRAG = `#version 300 es
precision highp float;
in float v_h;
in float v_dist;
out vec4 fragColor;

void main() {
  float t = clamp(v_h * 0.5 + 0.5, 0.0, 1.0);
  vec3 low  = vec3(0.07, 0.20, 0.26);   // dim teal valleys
  vec3 high = vec3(0.33, 0.80, 1.00);   // #5cf peaks
  vec3 col = mix(low, high, t * t);
  float fog = exp(-${TERRAIN.FOG_K.toFixed(3)} * max(v_dist - 1.0, 0.0));
  fragColor = vec4(col * fog * 1.3, 1.0); // additive blend -> crossings glow
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

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);

  if (!vs || !fs) {
    gradientFallback();                  // emitter bug? never show black
  } else {
    const hud = initHud();

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // ---- mesh ----
    const mesh = buildGridMesh(TERRAIN.GRID_N);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    // additive line blending: overlapping segments brighten
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0.039, 0.039, 0.039, 1); // #0a0a0a

    const uMvp = gl.getUniformLocation(prog, 'u_mvp');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uFnA = gl.getUniformLocation(prog, 'u_fnA');
    const uFnB = gl.getUniformLocation(prog, 'u_fnB');
    const uBlend = gl.getUniformLocation(prog, 'u_blend');

    // ---- camera ----
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

    // gentle mouse parallax (lerped so it never snaps)
    let mx = 0, my = 0, tmx = 0, tmy = 0;
    if (!reduceMotion) {
      window.addEventListener('pointermove', (e) => {
        tmx = (e.clientX / window.innerWidth) * 2 - 1;
        tmy = (e.clientY / window.innerHeight) * 2 - 1;
      });
    }

    // ---- function crossfade schedule ----
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
        blend = x * x * (3 - 2 * x); // smoothstep
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

      gl.uniformMatrix4fv(uMvp, false, mvp);
      gl.uniform1f(uTime, t);
      gl.uniform1i(uFnA, s.a);
      gl.uniform1i(uFnB, s.b);
      gl.uniform1f(uBlend, s.blend);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.LINES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);

      // throttle HUD text to ~10 Hz so it doesn't churn the DOM every frame
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
