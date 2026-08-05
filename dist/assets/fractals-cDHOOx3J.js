import"./modulepreload-polyfill-B5Qt9EMX.js";const l=document.getElementById("grid-canvas"),e=l.getContext("webgl2",{antialias:!1,alpha:!1});if(!e)throw new Error("WebGL2 unavailable");const X=`#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;                 // -1..1
  gl_Position = vec4(aPos, 0.0, 1.0);
}`,G=`#version 300 es
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
}`;function T(t,n){const o=e.createShader(t);if(e.shaderSource(o,n),e.compileShader(o),!e.getShaderParameter(o,e.COMPILE_STATUS))throw new Error(e.getShaderInfoLog(o)??"shader compile failed");return o}const i=e.createProgram();e.attachShader(i,T(e.VERTEX_SHADER,X));e.attachShader(i,T(e.FRAGMENT_SHADER,G));e.linkProgram(i);if(!e.getProgramParameter(i,e.LINK_STATUS))throw new Error(e.getProgramInfoLog(i)??"link failed");e.useProgram(i);const H=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,H);e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW);const B=e.getAttribLocation(i,"aPos");e.enableVertexAttribArray(B);e.vertexAttribPointer(B,2,e.FLOAT,!1,0,0);const c={res:e.getUniformLocation(i,"uRes"),time:e.getUniformLocation(i,"uTime"),scene:e.getUniformLocation(i,"uScene"),camPos:e.getUniformLocation(i,"uCamPos"),camFwd:e.getUniformLocation(i,"uCamFwd"),camRight:e.getUniformLocation(i,"uCamRight"),camUp:e.getUniformLocation(i,"uCamUp"),tanFov:e.getUniformLocation(i,"uTanFov"),bands:e.getUniformLocation(i,"uBands"),energy:e.getUniformLocation(i,"uEnergy"),react:e.getUniformLocation(i,"uReact")};let u=null,f=null,p=null,m=null;const a={bass:0,mid:0,high:0,energy:0},W=.03,V=.25,A=1.6;function C(){return u||(u=new AudioContext,f=u.createAnalyser(),f.fftSize=128,f.smoothingTimeConstant=0,p=new Uint8Array(new ArrayBuffer(f.frequencyBinCount))),u}function Y(){C(),navigator.mediaDevices.getUserMedia({audio:!0}).then(t=>{u.createMediaStreamSource(t).connect(f),z("mic")}).catch(()=>z("mic blocked"))}function j(t){C(),m&&(m.pause(),m.src=""),m=new Audio(URL.createObjectURL(t)),m.loop=!0,u.createMediaElementSource(m).connect(f),f.connect(u.destination),u.resume(),m.play(),z(t.name)}function $(t){if(!f||!p){a.bass=a.mid=a.high=a.energy=0;return}f.getByteFrequencyData(p);let n=0,o=0,s=0;for(let r=0;r<8;r++)n+=p[r];for(let r=8;r<24;r++)o+=p[r];for(let r=24;r<64;r++)s+=p[r];n=Math.min(1,n/8/255*A),o=Math.min(1,o/16/255*A),s=Math.min(1,s/40/255*A);const w=(n+o+s)/3,b=1-Math.exp(-t/W),S=1-Math.exp(-t/V),d=(r,h)=>r+(h-r)*(h>r?b:S);a.bass=d(a.bass,n),a.mid=d(a.mid,o),a.high=d(a.high,s),a.energy=d(a.energy,w)}const v=[{name:"mandelbulb",radius:2.6},{name:"kifs",radius:3.4},{name:"mandelbox",radius:5.5},{name:"menger",radius:3.8},{name:"apollonian",radius:2.2}];let x=0,k=1;function z(t){const n=document.getElementById("status");n&&(n.textContent=t)}function J(t){var n;(n=document.getElementById("live"))==null||n.classList.toggle("on",t)}const y=document.getElementById("scene");function I(t){x=(t+v.length)%v.length,y&&(y.textContent=`scene: ${v[x].name}`)}y==null||y.addEventListener("click",()=>I(x+1));window.addEventListener("keydown",t=>{const n=parseInt(t.key,10);!isNaN(n)&&n>=1&&n<=v.length&&I(n-1)});var U;(U=document.getElementById("mic"))==null||U.addEventListener("click",Y);const g=document.getElementById("file");var P;(P=document.getElementById("loadtrack"))==null||P.addEventListener("click",()=>g.click());g==null||g.addEventListener("change",()=>{var t;(t=g.files)!=null&&t[0]&&j(g.files[0])});const E=document.getElementById("react");E==null||E.addEventListener("input",()=>{k=parseFloat(E.value)});function q(){const t=Math.min(window.devicePixelRatio||1,1.75),n=Math.floor(l.clientWidth*t),o=Math.floor(l.clientHeight*t);(l.width!==n||l.height!==o)&&(l.width=n,l.height=o,e.viewport(0,0,n,o))}window.addEventListener("resize",q);let O=0,_=0;window.addEventListener("pointermove",t=>{O=(t.clientX/window.innerWidth-.5)*2,_=(t.clientY/window.innerHeight-.5)*2});let F=performance.now();function D(t){const n=Math.min(.05,(t-F)/1e3);F=t,q(),$(n),J(a.energy>.02);const o=t/1e3,s=v[x].radius,w=Math.sin(o*.15)*s+O*.6,b=Math.sin(o*.1)*s*.25-_*.5,S=Math.cos(o*.15)*s,d=[w,b,S],r=M([-w,-b,-S]),h=M(L([0,1,0],r)),K=L(r,h),N=Math.tan(55*Math.PI/180*.5);e.uniform2f(c.res,l.width,l.height),e.uniform1f(c.time,o),e.uniform1i(c.scene,x),e.uniform3fv(c.camPos,d),e.uniform3fv(c.camFwd,r),e.uniform3fv(c.camRight,h),e.uniform3fv(c.camUp,K),e.uniform1f(c.tanFov,N),e.uniform3f(c.bands,a.bass,a.mid,a.high),e.uniform1f(c.energy,a.energy),e.uniform1f(c.react,k),e.drawArrays(e.TRIANGLES,0,3),R("hud-bass",a.bass),R("hud-mid",a.mid),R("hud-high",a.high),R("hud-energy",a.energy),requestAnimationFrame(D)}requestAnimationFrame(D);function R(t,n){const o=document.getElementById(t);o&&(o.textContent=n.toFixed(2))}function M(t){const n=Math.hypot(t[0],t[1],t[2])||1;return[t[0]/n,t[1]/n,t[2]/n]}function L(t,n){return[t[1]*n[2]-t[2]*n[1],t[2]*n[0]-t[0]*n[2],t[0]*n[1]-t[1]*n[0]]}
