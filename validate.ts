// Validation harness — run with: xvfb-run -a npx tsx validate.ts
//
// A) Terrain: for many master seeds, build the exact height-function block
//    the hero uses and compile it with a real GLSL compiler (headless-gl,
//    ES 1.00 translation of the ES 3.00 hero shaders — the generated
//    expressions are version-agnostic).
// B) Mutation: generate trees, mutate random legal paths repeatedly, and
//    after every mutation (1) emit WGSL and sanity-check it, (2) emit GLSL
//    for all three channels and compile it for real.
// C) Render: draw the actual terrain mesh with the real camera at a few
//    seeds/timestamps and write PNGs for visual review.

import createGL from 'gl';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';

import { RNG } from './src/rng';
import { Grammar } from './src/grammar';
import { DEFAULT_WEIGHTS, type ASTNode } from './src/ast';
import { analyzeAST } from './src/analyzer';
import { emitGLSL } from './src/emitter-glsl';
import { buildShaderModule } from './src/emitter';
import { collectMutablePaths, replaceAtPath } from './src/tree-view';
import {
  TERRAIN, SURF, pickTerrainFns, perspective, lookAt, mat4mul,
  buildGridMesh, buildGridTriIndices, heightFnBlock,
} from './src/terrain';
import { emitGLSL as emitTileGLSL } from './src/emitter-glsl';

const W = 1280, H = 720;
const gl = createGL(W, H);
if (!gl) { console.error('no GL context'); process.exit(1); }

function compileProgram(vertSrc: string, fragSrc: string): { prog: WebGLProgram | null; log: string } {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      return { s: null, log: gl.getShaderInfoLog(s) ?? '?' };
    }
    return { s, log: '' };
  };
  const v = mk(gl.VERTEX_SHADER, vertSrc);
  if (!v.s) return { prog: null, log: 'VS: ' + v.log };
  const f = mk(gl.FRAGMENT_SHADER, fragSrc);
  if (!f.s) return { prog: null, log: 'FS: ' + f.log };
  const p = gl.createProgram()!;
  gl.attachShader(p, v.s);
  gl.attachShader(p, f.s);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    return { prog: null, log: 'LINK: ' + (gl.getProgramInfoLog(p) ?? '?') };
  }
  return { prog: p, log: '' };
}

// ES 1.00 translation of the hero shaders (same body, same constants).
function terrainVert(fnBlock: string): string {
  return `precision highp float;
attribute vec2 a_pos;
uniform mat4 u_mvp;
uniform float u_time;
uniform int u_fnA;
uniform int u_fnB;
uniform float u_blend;
varying float v_h;
varying float v_dist;
${fnBlock}
void main() {
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
}

const TERRAIN_FRAG = `precision highp float;
varying float v_h;
varying float v_dist;
void main() {
  float t = clamp(v_h * 0.5 + 0.5, 0.0, 1.0);
  vec3 low  = vec3(0.07, 0.20, 0.26);
  vec3 high = vec3(0.33, 0.80, 1.00);
  vec3 col = mix(low, high, t * t);
  float fog = exp(-${TERRAIN.FOG_K.toFixed(3)} * max(v_dist - 1.0, 0.0));
  gl_FragColor = vec4(col * fog * 1.3, 1.0);
}`;

// ---------- A) terrain compile sweep ----------
const SEEDS = 400;
let terrainFails = 0;
let acceptedTotal = 0, triedTotal = 0;
const testRng = new RNG(987654321);
for (let i = 0; i < SEEDS; i++) {
  const master = testRng.randi() >>> 0;
  const pick = pickTerrainFns(master);
  acceptedTotal += pick.fns.length;
  triedTotal += pick.tried;
  if (pick.fns.length !== TERRAIN.FN_COUNT) {
    console.log(`seed ${master}: only ${pick.fns.length} fns picked`);
  }
  const { prog, log } = compileProgram(terrainVert(heightFnBlock(pick.fns)), TERRAIN_FRAG);
  if (!prog) {
    terrainFails++;
    if (terrainFails <= 3) console.log(`TERRAIN COMPILE FAIL seed ${master}:\n${log}`);
  }
}
console.log(`A) terrain: ${SEEDS - terrainFails}/${SEEDS} master seeds compiled OK ` +
  `(avg ${(triedTotal / SEEDS).toFixed(1)} candidates tried per load)`);

// ---------- B) mutation stress ----------
const MUT_SEEDS = 200;
const MUTS_PER = 5;
let mutFails = 0, wgslFails = 0, glslFails = 0, mutationsDone = 0;
const balanced = (s: string) => {
  let d = 0;
  for (const c of s) { if (c === '(') d++; else if (c === ')') d--; if (d < 0) return false; }
  return d === 0;
};
const pickRng = new RNG(13371337);

for (let i = 0; i < MUT_SEEDS; i++) {
  const seed = pickRng.randi() >>> 0;
  const depth = 2 + (i % 5); // depths 2..6, same range as the explorer slider
  const rng = new RNG(seed);
  const grammar = new Grammar(rng, DEFAULT_WEIGHTS);
  const ast = grammar.genShaderAST(depth);

  for (let m = 0; m < MUTS_PER; m++) {
    const paths = collectMutablePaths(ast);
    if (paths.length === 0) { mutFails++; break; }
    const path = paths[Math.floor(pickRng.randf() * paths.length)];
    const remaining = Math.max(1, depth - (path.length - 2));
    const fresh = grammar.genFloatExpr(remaining);
    const old = replaceAtPath(ast, path, fresh);
    if (!old) { mutFails++; continue; }
    mutationsDone++;

    // WGSL emit sanity
    const wgsl = buildShaderModule(ast);
    if (!balanced(wgsl) || wgsl.includes('undefined') || wgsl.includes('NaN') || !wgsl.includes('@fragment')) {
      wgslFails++;
      if (wgslFails <= 3) console.log(`WGSL SANITY FAIL seed ${seed} mut ${m}`);
    }
    analyzeAST(ast); // must not throw on mutated trees

    // real GLSL compile of all three mutated channels
    if (ast.type === 'assign_color' && ast.expr.type === 'vec4_rgb') {
      const { r, g, b } = ast.expr;
      const frag = `precision highp float;
varying vec2 uv;
uniform float u_time;
void main() {
  vec3 c = vec3(${emitGLSL(r)}, ${emitGLSL(g)}, ${emitGLSL(b)});
  gl_FragColor = vec4(c, 1.0);
}`;
      const vert = `precision highp float;\nattribute vec2 p;\nvarying vec2 uv;\nvoid main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
      const { prog, log } = compileProgram(vert, frag);
      if (!prog) {
        glslFails++;
        if (glslFails <= 3) console.log(`GLSL COMPILE FAIL seed ${seed} mut ${m}:\n${log}`);
      }
    }
  }
}
console.log(`B) mutation: ${mutationsDone} mutations across ${MUT_SEEDS} trees | ` +
  `path fails: ${mutFails} | WGSL sanity fails: ${wgslFails} | GLSL compile fails: ${glslFails}`);

// ---------- D) live-control system checks (recovered validation pattern) ----------
import { readFileSync } from 'node:fs';
{
  const sample = buildShaderModule(new Grammar(new RNG(424242), DEFAULT_WEIGHTS).genShaderAST(4));
  const bandsInStruct = ['waves', 'vector', 'tiling', 'shaping'].every((b) => sample.includes(b + ': f32'));
  const knobsUsed = ['zoom', 'warp', 'intensity', 'hue', 'freq', 'panX', 'panY'].every((k) => sample.includes('uniforms.' + k));
  const hasHue = sample.includes('fn hueRotate');
  const mainSrc = readFileSync('src/main.ts', 'utf8');
  const rendSrc = readFileSync('src/renderer.ts', 'utf8');
  const keys = ['speed', 'zoom', 'panX', 'panY', 'warp', 'intensity', 'hue', 'freq', 'waves', 'vector', 'tiling', 'shaping'];
  const mainOk = keys.every((k) => mainSrc.includes(`'${k}'`));
  const rendOk = keys.every((k) => new RegExp('\\b' + k + '\\b').test(rendSrc));
  const uiOk = mainSrc.includes('function resetLiveControls') && mainSrc.includes('function buildTerminalSliders');

  // op + terminal coverage across many generations
  const opHits: Record<string, number> = {};
  const cov = new RNG(24681357);
  for (let i = 0; i < 400; i++) {
    const ast = new Grammar(new RNG(cov.randi() >>> 0), DEFAULT_WEIGHTS).genShaderAST(4);
    const st = analyzeAST(ast);
    for (const k of Object.keys(st.operations)) opHits[k] = (opHits[k] ?? 0) + 1;
  }
  const mustExist = ['length_vec2', 'min', 'max', 'exp', 'pow', 'smoothstep', 'atan2',
    'polar_r', 'polar_theta', 'spherical_x', 'spherical_y', 'spherical_z', 'mat_x', 'mat_y'];
  const missing = mustExist.filter((k) => !opHits[k]);

  console.log(`D) controls: bands in struct: ${bandsInStruct} | knobs used: ${knobsUsed} | hueRotate: ${hasHue}`);
  console.log(`   12 keys in main.ts: ${mainOk} | in renderer.ts: ${rendOk} | reset + terminal sliders: ${uiOk}`);
  console.log(`   new ops/terminals seen across 400 gens: ${mustExist.length - missing.length}/${mustExist.length}` +
    (missing.length ? ` MISSING: ${missing.join(',')}` : ''));
}

// ---------- C) render previews ----------
function renderPreview(master: number, t: number, file: string): void {
  const pick = pickTerrainFns(master);
  const { prog, log } = compileProgram(terrainVert(heightFnBlock(pick.fns)), TERRAIN_FRAG);
  if (!prog) { console.log('preview compile fail:', log); return; }
  gl.useProgram(prog);

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

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.disable(gl.DEPTH_TEST);
  gl.viewport(0, 0, W, H);
  gl.clearColor(0.039, 0.039, 0.039, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // same schedule/camera math as the hero at time t, mouse at rest
  const K = pick.fns.length;
  const PERIOD = TERRAIN.HOLD_S + TERRAIN.BLEND_S;
  const cyc = Math.floor(t / PERIOD);
  const ph = t - cyc * PERIOD;
  const a = cyc % K, b = (a + 1) % K;
  let blend = 0;
  if (ph > TERRAIN.HOLD_S) { const x = (ph - TERRAIN.HOLD_S) / TERRAIN.BLEND_S; blend = x * x * (3 - 2 * x); }

  const eye: [number, number, number] = [Math.sin(t * 0.06) * 0.35, 1.02, 2.05];
  const view = lookAt(eye, [0, -0.18, -0.55], [0, 1, 0]);
  const proj = perspective(0.9, W / H, 0.05, 12);
  const mvp = mat4mul(proj, view);

  gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'u_mvp'), false, mvp);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_time'), t);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_fnA'), a);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_fnB'), b);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_blend'), blend);

  gl.drawElements(gl.LINES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);

  const pixels = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // quick stats + flip vertically for PNG
  let sum = 0, max = 0;
  for (let i = 0; i < pixels.length; i += 4) { const v = pixels[i] + pixels[i + 1] + pixels[i + 2]; sum += v; if (v > max) max = v; }
  console.log(`   ${file}: mean ${(sum / (W * H * 3)).toFixed(1)}/255, peak ${(max / 3).toFixed(0)}/255`);

  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4;
    pixels.copyWithin ? png.data.set(pixels.subarray(src, src + W * 4), y * W * 4) : null;
  }
  writeFileSync(file, PNG.sync.write(png));
}

// composite preview: tile quilt draped on the heightfield (ES100 translation)
function renderComposite(master: number, t: number, file: string): void {
  const pick = pickTerrainFns(master);
  const TILE_POOL = SURF.POOL;
  const tileExprs: string[] = [];
  for (let i = 0; i < TILE_POOL; i++) {
    const rng = new RNG((master ^ 0x9E3779B9) + i * 2654435761 >>> 0);
    const ast = new Grammar(rng, DEFAULT_WEIGHTS).genShaderAST(SURF.DEPTH);
    tileExprs.push(emitTileGLSL(ast));
  }
  const branches = tileExprs
    .map((e, i) => `  ${i ? 'else ' : ''}if (idx == ${i}) { c = ${e}; }`)
    .join('\n');

  const vert = `precision highp float;
attribute vec2 a_pos;
uniform mat4 u_mvp;
uniform float u_time;
uniform int u_fnA;
uniform int u_fnB;
uniform float u_blend;
uniform float u_lift;
varying float v_h;
varying float v_dist;
varying vec2 v_uv;
${heightFnBlock(pick.fns)}
void main() {
  float cr = ${Math.cos(TERRAIN.ROT).toFixed(5)};
  float sr = ${Math.sin(TERRAIN.ROT).toFixed(5)};
  vec2 rp = vec2(a_pos.x * cr - a_pos.y * sr, a_pos.x * sr + a_pos.y * cr);
  vec2 uv = rp * ${TERRAIN.SPAN.toFixed(3)} + vec2(0.5, 0.5 + u_time * ${TERRAIN.SCROLL.toFixed(4)});
  float h = mix(H(u_fnA, uv), H(u_fnB, uv), u_blend) * ${TERRAIN.AMP.toFixed(3)};
  vec3 world = vec3(a_pos.x * ${TERRAIN.WORLD.toFixed(2)}, h + u_lift, a_pos.y * ${TERRAIN.WORLD.toFixed(2)});
  vec4 clip = u_mvp * vec4(world, 1.0);
  v_uv = uv; v_h = h / ${TERRAIN.AMP.toFixed(3)}; v_dist = clip.w;
  gl_Position = clip;
}`;

  const fragSolid = `precision highp float;
varying float v_h;
varying float v_dist;
varying vec2 v_uv;
uniform float u_time;
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
vec3 tileColor(int idx, vec2 uv){
  vec3 c = vec3(0.0);
${branches}
  return c;
}
void main(){
  vec2 q = (v_uv - 0.5) / ${TERRAIN.SPAN.toFixed(3)} + 0.5;
  vec2 g = q * ${SURF.TILES.toFixed(1)};
  vec2 cell = floor(g);
  vec2 f = fract(g);
  int idx = int(min(hash21(cell + 0.5) * float(${TILE_POOL}), float(${TILE_POOL}) - 0.5));
  vec3 col = tileColor(idx, f);
  col = clamp(col * 0.5 + 0.5, 0.0, 1.0);
  vec2 gut = smoothstep(0.0, ${SURF.GUTTER.toFixed(3)}, f) * smoothstep(0.0, ${SURF.GUTTER.toFixed(3)}, 1.0 - f);
  col *= mix(0.22, 1.0, gut.x * gut.y);
  float ht = clamp(v_h * 0.5 + 0.5, 0.0, 1.0);
  col *= 0.24 + 0.40 * ht;
  float fog = exp(-${TERRAIN.FOG_K.toFixed(3)} * max(v_dist - 1.0, 0.0));
  gl_FragColor = vec4(col * fog * 0.52, 1.0);
}`;

  const fragWire = `precision highp float;
varying float v_h;
varying float v_dist;
varying vec2 v_uv;
void main(){
  float t = clamp(v_h * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.06, 0.16, 0.20), vec3(0.33, 0.80, 1.00), t * t);
  float fog = exp(-${TERRAIN.FOG_K.toFixed(3)} * max(v_dist - 1.0, 0.0));
  gl_FragColor = vec4(col * fog * 0.22, 1.0);
}`;

  const solid = compileProgram(vert, fragSolid);
  const wire = compileProgram(vert, fragWire);
  if (!solid.prog || !wire.prog) { console.log('composite compile fail:', solid.log || wire.log); return; }

  const lineMesh = buildGridMesh(TERRAIN.GRID_N);
  const triIndices = buildGridTriIndices(TERRAIN.GRID_N);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, lineMesh.positions, gl.STATIC_DRAW);
  const triIbo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, triIndices, gl.STATIC_DRAW);
  const lineIbo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineMesh.indices, gl.STATIC_DRAW);

  const K = pick.fns.length;
  const PERIOD = TERRAIN.HOLD_S + TERRAIN.BLEND_S;
  const cyc = Math.floor(t / PERIOD);
  const ph = t - cyc * PERIOD;
  const a = cyc % K, b = (a + 1) % K;
  let blend = 0;
  if (ph > TERRAIN.HOLD_S) { const x = (ph - TERRAIN.HOLD_S) / TERRAIN.BLEND_S; blend = x * x * (3 - 2 * x); }

  const eye: [number, number, number] = [Math.sin(t * 0.06) * 0.35, 1.02, 2.05];
  const view = lookAt(eye, [0, -0.18, -0.55], [0, 1, 0]);
  const proj = perspective(0.9, W / H, 0.05, 12);
  const mvp = mat4mul(proj, view);

  const draw = (prog: WebGLProgram, ibo: WebGLBuffer, mode: number, count: number, lift: number) => {
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'u_mvp'), false, mvp);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_time'), t);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_fnA'), a);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_fnB'), b);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_blend'), blend);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_lift'), lift);
    gl.drawElements(mode, count, gl.UNSIGNED_SHORT, 0);
  };

  gl.viewport(0, 0, W, H);
  gl.clearColor(0.039, 0.039, 0.039, 1);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  draw(solid.prog, triIbo!, gl.TRIANGLES, triIndices.length, 0.0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.depthFunc(gl.LEQUAL);
  gl.depthMask(false);
  draw(wire.prog, lineIbo!, gl.LINES, lineMesh.indices.length, SURF.LIFT);
  gl.depthMask(true);
  gl.disable(gl.BLEND);

  const pixels = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let sum = 0, max = 0;
  for (let i = 0; i < pixels.length; i += 4) { const vv = pixels[i] + pixels[i + 1] + pixels[i + 2]; sum += vv; if (vv > max) max = vv; }
  console.log(`   ${file}: mean ${(sum / (W * H * 3)).toFixed(1)}/255, peak ${(max / 3).toFixed(0)}/255`);

  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4;
    png.data.set(pixels.subarray(src, src + W * 4), y * W * 4);
  }
  writeFileSync(file, PNG.sync.write(png));
}

console.log('C) rendering previews…');
renderComposite(0xA1B2C3D4, 8.0, '/home/claude/composite_a.png');
renderComposite(0x1337BEEF, 8.0, '/home/claude/composite_b.png');
renderPreview(0x1337BEEF, 8.0, '/home/claude/preview_wire.png'); // terrain page look
console.log('done');
