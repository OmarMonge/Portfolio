// fractals.ts — browser port of the Unity FractalVisualizer.
//
// Two hand-authored SDF scenes (Mandelbulb, KIFS) raymarched in a WebGL2
// fragment shader, driven by the same bass/mid/high FFT bands the Unity
// AdvancedAudioAnalyzer computes, smoothed with the FullScreenRaymarching
// attack/release envelope follower. No frameworks, no imports — standalone.
//
// This is NOT grammar-generated work; it's the SDF/raymarching side of the
// portfolio. Keep it framed that way.

// ---------------------------------------------------------------- GL setup

const canvas = document.getElementById("grid-canvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
if (!gl) throw new Error("WebGL2 unavailable");

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;                 // -1..1
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 frag;

uniform vec2  uRes;
uniform float uTime;
uniform int   uScene;        // 0 = Mandelbulb, 1 = KIFS
uniform vec3  uCamPos;
uniform vec3  uCamFwd;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform float uTanFov;
uniform vec3  uBands;        // x=bass y=mid z=high (smoothed 0..1)
uniform float uEnergy;       // 0..1
uniform float uReact;        // reactivity gain

const int   MAX_STEPS = 110;
const float MAX_DIST  = 14.0;
const float EPS       = 0.0015;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(vec3(1.0), clamp(p - vec3(1.0), 0.0, 1.0), c.y);
}

// --- Scene 0: Mandelbulb. Power swings ~4..12 on bass+energy, exactly like
//     the Unity sdMandelbulb morph (decoupled from a fixed power so it always
//     reads as a shape change, not just rotation).
float deMandelbulb(vec3 p, out float trapOut) {
  vec3 w = p;
  float m = dot(w, w);
  float dz = 1.0;
  float trap = 1e10;
  float power = 4.0 + (uBands.x * 5.0 + uEnergy * 3.0) * uReact;

  for (int i = 0; i < 12; i++) {
    dz = power * pow(sqrt(m), power - 1.0) * dz + 1.0;
    float r = length(w);
    if (r < 0.001) break;
    float theta = power * acos(clamp(w.y / r, -1.0, 1.0));
    float phi   = power * atan(w.x, w.z);
    w = p + pow(r, power) * vec3(
      sin(theta) * sin(phi),
      cos(theta),
      sin(theta) * cos(phi));
    trap = min(trap, dot(w, w));
    m = dot(w, w);
    if (m > 256.0) break;
  }
  trapOut = trap;
  return 0.25 * log(m) * sqrt(m) / max(dz, 0.001);
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// --- Scene 1: KIFS. The fold offset drifts on time + audio, restructuring the
//     whole fractal (the "morph via offsets" look from the Unity sdKIFS).
float deKIFS(vec3 p, out float trapOut) {
  float t = uTime;
  float scale = 3.0;
  vec3 wobble = vec3(sin(t * 0.31), sin(t * 0.23 + 1.7), sin(t * 0.17 + 3.1));
  vec3 offset = vec3(0.93, 1.0, 0.66)
    + 0.18 * wobble
    + vec3(0.25 * uBands.x, 0.30 * uBands.y, 0.20 * uEnergy) * uReact;

  float s = 1.0;
  float orbit = 1e20;
  for (int n = 0; n < 9; n++) {
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.zy = p.yz;

    p.z -= 0.5 * offset.z * (scale - 1.0) / scale;
    p.z  = -abs(p.z);
    p.z += 0.5 * offset.z * (scale - 1.0) / scale;

    p *= scale;
    s /= scale;
    p.x -= offset.x * (scale - 1.0);
    p.y -= offset.y * (scale - 1.0);

    orbit = min(orbit, dot(p, p));
  }
  trapOut = orbit;
  return sdBox(p, vec3(1.0)) * s;
}

vec3 boxFold(vec3 p) { return clamp(p, -1.0, 1.0) * 2.0 - p; }
vec3 sphereFold(vec3 p, float minR, float maxR) {
  float r2 = dot(p, p);
  if (r2 < minR * minR) return p * (maxR * maxR) / (minR * minR);
  else if (r2 < maxR * maxR) return p * (maxR * maxR) / r2;
  return p;
}

// --- Scene 2: Mandelbox. Scale param swings on bass, like the Unity version.
float deMandelbox(vec3 p, out float trapOut) {
  vec3 offset = p;
  float dr = 1.0;
  float scale = 1.6 + uBands.x * 1.0 * uReact;
  float trap = 1e10;
  for (int i = 0; i < 12; i++) {
    p = boxFold(p);
    p = sphereFold(p, 0.5, 1.0);
    p = scale * p + offset;
    dr = dr * abs(scale) + 1.0;
    trap = min(trap, length(p));
  }
  trapOut = trap;
  return length(p) / abs(dr);
}

// --- Scene 3: Menger sponge.
float deMenger(vec3 p, out float trapOut) {
  float scale = 1.0;
  for (int i = 0; i < 5; i++) {
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;
    p *= 3.0; scale *= 3.0;
    p.x -= 2.0; p.y -= 2.0;
    if (p.z > 1.0) p.z -= 2.0;
  }
  trapOut = scale;
  return (length(p) - 1.5) / scale;
}

// --- Scene 4: Apollonian gasket. Ball radius breathes on bass.
float deApollonian(vec3 p, out float trapOut) {
  float scale = 1.0;
  float r = 0.15 + uBands.x * 0.25 * uReact;
  for (int i = 0; i < 8; i++) {
    p = -1.0 + 2.0 * fract(0.5 * p + 0.5);
    float r2 = dot(p, p);
    float k = max(r / r2, 1.0);
    p *= k; scale *= k;
  }
  trapOut = scale;
  return 0.25 * abs(p.y) / scale;
}

float scene(vec3 p, out float trap) {
  if (uScene == 0) return deMandelbulb(p, trap);
  if (uScene == 1) return deKIFS(p, trap);
  if (uScene == 2) return deMandelbox(p, trap);
  if (uScene == 3) return deMenger(p, trap);
  return deApollonian(p, trap);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0006, 0.0);
  float t;
  return normalize(vec3(
    scene(p + e.xyy, t) - scene(p - e.xyy, t),
    scene(p + e.yxy, t) - scene(p - e.yxy, t),
    scene(p + e.yyx, t) - scene(p - e.yyx, t)));
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  uv.x *= uRes.x / uRes.y;

  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamFwd
    + uv.x * uCamRight * uTanFov
    + uv.y * uCamUp    * uTanFov);

  float t = 0.0;
  float trap = 0.0;
  bool hit = false;
  for (int i = 0; i < MAX_STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = scene(p, trap);
    if (d < EPS) { hit = true; break; }
    t += d * 0.85;
    if (t > MAX_DIST) break;
  }

  vec3 col;
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    vec3 lightDir = normalize(vec3(0.6, 0.8, -0.4));
    float diff = max(0.0, dot(n, lightDir));
    float fres = pow(1.0 - max(0.0, dot(n, -rd)), 3.0);

    float hue = fract(trap * 0.08 + uTime * 0.03 + uBands.z * 0.2);
    vec3 base = hsv2rgb(vec3(hue, 0.8, 0.9));
    col = base * (0.18 + 0.75 * diff);
    col += vec3(0.35, 0.7, 1.0) * fres * (0.4 + uEnergy);     // cyan rim
    col *= 1.0 + uEnergy * 0.5;
  } else {
    // background: faint cyan field, lifts a touch on energy
    float g = 0.02 + uEnergy * 0.04;
    col = vec3(g * 0.4, g * 0.7, g) ;
  }

  col = col / (col + vec3(1.0));                  // tonemap
  col = pow(col, vec3(1.0 / 2.2));                // gamma
  frag = vec4(col, 1.0);
}`;

function compile(type: number, src: string): WebGLShader {
  const s = gl!.createShader(type)!;
  gl!.shaderSource(s, src);
  gl!.compileShader(s);
  if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
    throw new Error(gl!.getShaderInfoLog(s) ?? "shader compile failed");
  }
  return s;
}

const prog = gl.createProgram()!;
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(prog) ?? "link failed");
}
gl.useProgram(prog);

const quad = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, "aPos");
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

const U = {
  res:   gl.getUniformLocation(prog, "uRes"),
  time:  gl.getUniformLocation(prog, "uTime"),
  scene: gl.getUniformLocation(prog, "uScene"),
  camPos:   gl.getUniformLocation(prog, "uCamPos"),
  camFwd:   gl.getUniformLocation(prog, "uCamFwd"),
  camRight: gl.getUniformLocation(prog, "uCamRight"),
  camUp:    gl.getUniformLocation(prog, "uCamUp"),
  tanFov: gl.getUniformLocation(prog, "uTanFov"),
  bands:  gl.getUniformLocation(prog, "uBands"),
  energy: gl.getUniformLocation(prog, "uEnergy"),
  react:  gl.getUniformLocation(prog, "uReact"),
};

// ---------------------------------------------------------------- audio

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let freq: Uint8Array | null = null;
let audioEl: HTMLAudioElement | null = null;

// smoothed bands (envelope follower state)
const bands = { bass: 0, mid: 0, high: 0, energy: 0 };
const ATTACK = 0.03;   // seconds — fast rise on beats
const RELEASE = 0.25;  // seconds — slow fall after
const GAIN = 1.6;      // byte FFT is already 0..255; small lift then clamp

function ensureCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;                 // -> 64 frequency bins, matches Unity
    analyser.smoothingTimeConstant = 0.0;   // we do our own smoothing
    freq = new Uint8Array(analyser.frequencyBinCount);
  }
  return audioCtx;
}

function connectMic() {
  ensureCtx();
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    const src = audioCtx!.createMediaStreamSource(stream);
    src.connect(analyser!);                 // mic -> analyser only (no playback)
    setStatus("mic");
  }).catch(() => setStatus("mic blocked"));
}

function connectFile(file: File) {
  ensureCtx();
  if (audioEl) { audioEl.pause(); audioEl.src = ""; }
  audioEl = new Audio(URL.createObjectURL(file));
  audioEl.loop = true;
  const src = audioCtx!.createMediaElementSource(audioEl);
  src.connect(analyser!);
  analyser!.connect(audioCtx!.destination);  // file plays through speakers
  audioCtx!.resume();
  audioEl.play();
  setStatus(file.name);
}

// band split — identical bins to AdvancedAudioAnalyzer (bass 0-7, mid 8-23,
// high 24-63), then the FullScreenRaymarching attack/release follow().
function sampleAudio(dt: number) {
  if (!analyser || !freq) { bands.bass = bands.mid = bands.high = bands.energy = 0; return; }
  analyser.getByteFrequencyData(freq);

  let b = 0, m = 0, h = 0;
  for (let i = 0;  i < 8;  i++) b += freq[i];
  for (let i = 8;  i < 24; i++) m += freq[i];
  for (let i = 24; i < 64; i++) h += freq[i];
  b = Math.min(1, (b / 8  / 255) * GAIN);
  m = Math.min(1, (m / 16 / 255) * GAIN);
  h = Math.min(1, (h / 40 / 255) * GAIN);
  const e = (b + m + h) / 3;

  const ka = 1 - Math.exp(-dt / ATTACK);
  const kr = 1 - Math.exp(-dt / RELEASE);
  const follow = (cur: number, tgt: number) =>
    cur + (tgt - cur) * (tgt > cur ? ka : kr);

  bands.bass   = follow(bands.bass, b);
  bands.mid    = follow(bands.mid, m);
  bands.high   = follow(bands.high, h);
  bands.energy = follow(bands.energy, e);
}

// ---------------------------------------------------------------- UI wiring

// scene table — name + camera distance. radius is the one thing I can't verify
// without rendering; if a scene comes in clipped or tiny, nudge its radius.
const SCENES = [
  { name: "mandelbulb", radius: 2.6 },
  { name: "kifs",       radius: 3.4 },
  { name: "mandelbox",  radius: 5.5 },
  { name: "menger",     radius: 3.8 },
  { name: "apollonian", radius: 2.2 },
];
let sceneId = 0;
let react = 1.0;

function setStatus(s: string) {
  const el = document.getElementById("status");
  if (el) el.textContent = s;
}
function setLive(on: boolean) {
  document.getElementById("live")?.classList.toggle("on", on);
}

const sceneBtn = document.getElementById("scene");
function setScene(i: number) {
  sceneId = (i + SCENES.length) % SCENES.length;
  if (sceneBtn) sceneBtn.textContent = `scene: ${SCENES[sceneId].name}`;
}
sceneBtn?.addEventListener("click", () => setScene(sceneId + 1));
window.addEventListener("keydown", (e) => {
  const n = parseInt(e.key, 10);
  if (!isNaN(n) && n >= 1 && n <= SCENES.length) setScene(n - 1);
});
document.getElementById("mic")?.addEventListener("click", connectMic);
const fileInput = document.getElementById("file") as HTMLInputElement;
document.getElementById("loadtrack")?.addEventListener("click", () => fileInput.click());
fileInput?.addEventListener("change", () => {
  if (fileInput.files?.[0]) connectFile(fileInput.files[0]);
});
const reactInput = document.getElementById("react") as HTMLInputElement;
reactInput?.addEventListener("input", () => { react = parseFloat(reactInput.value); });

// ---------------------------------------------------------------- resize

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    gl!.viewport(0, 0, w, h);
  }
}
window.addEventListener("resize", resize);

// pointer parallax
let px = 0, py = 0;
window.addEventListener("pointermove", (e) => {
  px = (e.clientX / window.innerWidth - 0.5) * 2;
  py = (e.clientY / window.innerHeight - 0.5) * 2;
});

// ---------------------------------------------------------------- loop

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  resize();
  sampleAudio(dt);
  setLive(bands.energy > 0.02);

  const t = now / 1000;

  // orbit camera, per-scene distance; pointer nudges it
  const radius = SCENES[sceneId].radius;
  const ox = Math.sin(t * 0.15) * radius + px * 0.6;
  const oy = Math.sin(t * 0.1) * radius * 0.25 - py * 0.5;
  const oz = Math.cos(t * 0.15) * radius;
  const camPos: [number, number, number] = [ox, oy, oz];

  // basis: look at origin
  const fwd = norm([-ox, -oy, -oz]);
  const right = norm(cross([0, 1, 0], fwd));
  const up = cross(fwd, right);
  const tanFov = Math.tan((55 * Math.PI / 180) * 0.5);

  gl!.uniform2f(U.res, canvas.width, canvas.height);
  gl!.uniform1f(U.time, t);
  gl!.uniform1i(U.scene, sceneId);
  gl!.uniform3fv(U.camPos, camPos);
  gl!.uniform3fv(U.camFwd, fwd);
  gl!.uniform3fv(U.camRight, right);
  gl!.uniform3fv(U.camUp, up);
  gl!.uniform1f(U.tanFov, tanFov);
  gl!.uniform3f(U.bands, bands.bass, bands.mid, bands.high);
  gl!.uniform1f(U.energy, bands.energy);
  gl!.uniform1f(U.react, react);

  gl!.drawArrays(gl!.TRIANGLES, 0, 3);

  // band HUD (matches the terrain page's #shader-hud rows)
  setHud("hud-bass", bands.bass);
  setHud("hud-mid", bands.mid);
  setHud("hud-high", bands.high);
  setHud("hud-energy", bands.energy);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function setHud(id: string, v: number) {
  const el = document.getElementById(id);
  if (el) el.textContent = v.toFixed(2);
}

// ---------------------------------------------------------------- vec helpers
function norm(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
