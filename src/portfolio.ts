// Portfolio hero background.
// Generates a pool of REAL shaders using the same grammar as the Shader
// Explorer (src/grammar.ts + src/rng.ts + src/ast.ts), emits each to GLSL,
// and bakes them into one WebGL2 background shader. Each tile in the grid is
// a genuine grammar output, chosen per cell by a hash.

import { RNG } from './rng';
import { Grammar } from './grammar';
import { DEFAULT_WEIGHTS } from './ast';
import { emitGLSL } from './emitter-glsl';

// ---- knobs you can safely change ----
const TILE_PX = 220;     // target tile size in CSS px; smaller = more tiles
const POOL = 48;         // how many distinct ASTs to generate (256 still fine)
const DEPTH = 3;         // grammar recursion depth (3 reads well small, 4 busier)
// Fresh set of shaders on every reload. To pin a fixed, reproducible set
// instead, replace this with a constant number, e.g. const MASTER_SEED = 73127;
const MASTER_SEED = Math.floor(Math.random() * 0xFFFFFFFF);

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// ---- generate the pool of real shaders ----
const tileExprs: string[] = [];
for (let i = 0; i < POOL; i++) {
  const rng = new RNG((MASTER_SEED + i * 2654435761) >>> 0);
  const ast = new Grammar(rng, DEFAULT_WEIGHTS).genShaderAST(DEPTH);
  tileExprs.push(emitGLSL(ast));
}
const branches = tileExprs
  .map((e, i) => `  ${i ? 'else ' : ''}if (idx == ${i}) { c = ${e}; }`)
  .join('\n');

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
  in vec2 p;
  void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

  const FRAG = `#version 300 es
  precision highp float;
  out vec4 fragColor;
  uniform vec2 u_res;
  uniform float u_time;
  uniform float u_tilepx;

  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  // every branch below is one generated AST, emitted to GLSL
  vec3 tileColor(int idx, vec2 uv){
    vec3 c = vec3(0.0);
${branches}
    return c;
  }

  void main(){
    vec2 uv = gl_FragCoord.xy / u_res;
    vec2 grid = max(vec2(2.0, 1.0), floor(u_res / u_tilepx));
    vec2 g = uv * grid;
    vec2 cell = floor(g);
    vec2 f = fract(g);                       // local coords 0..1 in the tile

    int idx = int(hash21(cell + 0.5) * float(${POOL}));
    idx = idx % ${POOL};

    vec3 col = tileColor(idx, f);            // <-- real grammar output
    col = clamp(col * 0.5 + 0.5, 0.0, 1.0);  // signed range -> viewable

    vec2 gut = smoothstep(0.0, 0.045, f) * smoothstep(0.0, 0.045, 1.0 - f);
    col *= gut.x * gut.y;                     // gutters between tiles
    col *= 0.6;                               // keep it a background
    float vig = 1.0 - 0.65 * length(uv - 0.5);
    col *= clamp(vig, 0.0, 1.0);

    fragColor = vec4(col, 1.0);
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
    gradientFallback();                      // emitter bug? never show black
  } else {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uTile = gl.getUniformLocation(prog, 'u_tilepx');

    let dpr = 1;
    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTile, TILE_PX * dpr);
    };
    window.addEventListener('resize', resize);
    resize();

    const start = performance.now();
    let visible = true;
    const frame = (): void => {
      if (!visible) return;
      resize();
      gl.uniform1f(uTime, reduceMotion ? 8.0 : (performance.now() - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduceMotion) requestAnimationFrame(frame);
    };
    document.addEventListener('visibilitychange', () => {
      visible = !document.hidden;
      if (visible && !reduceMotion) frame();
    });
    frame();
  }
}