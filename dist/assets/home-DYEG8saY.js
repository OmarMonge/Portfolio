import"./modulepreload-polyfill-B5Qt9EMX.js";import{G as Z,R as ee,D as te}from"./analyzer-BqE6BXwm.js";import{p as ne,S as v,e as oe,h as ie,T as o,b as re,a as ae,l as se,c as ce,m as le}from"./terrain-4tHJG0Lr.js";const B=Math.floor(Math.random()*4294967295)>>>0,_=v.POOL,I=v.DEPTH,G=document.getElementById("year");G&&(G.textContent=String(new Date().getFullYear()));const de=ne(B),x=de.fns,Y=[];for(let i=0;i<_;i++){const f=new ee((B^2654435769)+i*2654435761>>>0),S=new Z(f,te).genShaderAST(I);Y.push(oe(S))}const fe=Y.map((i,f)=>`  ${f?"else ":""}if (idx == ${f}) { c = ${i}; }`).join(`
`);console.log("%comar.shader — height and surface are both generated code","color:#5cf;font-weight:bold;");x.forEach((i,f)=>{console.log(`h fn${f}  seed 0x${i.seed.toString(16).toUpperCase().padStart(8,"0")}  ${i.stats.nodeCount} nodes
  h(uv) = ${i.expr}`)});console.log(`+ ${_} tile shaders draped on the surface (same grammar, depth ${I})`);const H=document.getElementById("shader-hud");let W=0;function ue(){if(!H)return{time:null,res:null,fn:null};const i="0x"+B.toString(16).toUpperCase().padStart(8,"0");return H.innerHTML=`<div><span class="k">u_time</span><b id="hud-time">0.00s</b></div><div><span class="k">u_res</span><b id="hud-res">—</b></div><div><span class="k">tiles</span><b>${_} ASTs · depth ${I}</b></div><div><span class="k">h(uv)</span><b id="hud-fn">—</b></div><div><span class="k">seed</span><b>${i}</b></div>`,{time:document.getElementById("hud-time"),res:document.getElementById("hud-res"),fn:document.getElementById("hud-fn")}}const a=document.getElementById("grid-canvas"),b=window.matchMedia("(prefers-reduced-motion: reduce)").matches;function V(){a&&(a.style.background="radial-gradient(140% 120% at 25% 30%, #11313d 0%, #0c1416 45%, #0a0a0a 100%)")}const e=a?a.getContext("webgl2",{antialias:!0,alpha:!1}):null;if(!a||!e)V();else{const i=`#version 300 es
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

${ie(x)}

void main() {
  float cr = ${Math.cos(o.ROT).toFixed(5)};
  float sr = ${Math.sin(o.ROT).toFixed(5)};
  vec2 rp = vec2(a_pos.x * cr - a_pos.y * sr, a_pos.x * sr + a_pos.y * cr);
  vec2 uv = rp * ${o.SPAN.toFixed(3)} + vec2(0.5, 0.5 + u_time * ${o.SCROLL.toFixed(4)});
  float h = mix(H(u_fnA, uv), H(u_fnB, uv), u_blend) * ${o.AMP.toFixed(3)};
  vec3 world = vec3(a_pos.x * ${o.WORLD.toFixed(2)}, h + u_lift, a_pos.y * ${o.WORLD.toFixed(2)});
  vec4 clip = u_mvp * vec4(world, 1.0);
  v_uv = uv;
  v_h = h / ${o.AMP.toFixed(3)};
  v_dist = clip.w;
  gl_Position = clip;
}`,f=`#version 300 es
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
${fe}
  return c;
}

void main(){
  // plane-stable tile coordinates: scroll with the terrain so tiles stick to it
  vec2 q = (v_uv - 0.5) / ${o.SPAN.toFixed(3)} + 0.5;
  vec2 g = q * ${v.TILES.toFixed(1)};
  vec2 cell = floor(g);
  vec2 f = fract(g);

  int idx = int(hash21(cell + 0.5) * float(${_}));
  idx = clamp(idx, 0, ${_-1});

  float u_t = u_timeAlias();
  vec3 col = tileColor(idx, f);
  col = clamp(col * 0.5 + 0.5, 0.0, 1.0);

  vec2 gut = smoothstep(0.0, ${v.GUTTER.toFixed(3)}, f) * smoothstep(0.0, ${v.GUTTER.toFixed(3)}, 1.0 - f);
  col *= mix(0.22, 1.0, gut.x * gut.y);      // seams between tiles

  float ht = clamp(v_h * 0.5 + 0.5, 0.0, 1.0);
  col *= 0.24 + 0.40 * ht;                   // peaks catch more light
  float fog = exp(-${o.FOG_K.toFixed(3)} * max(v_dist - 1.0, 0.0));
  fragColor = vec4(col * fog * 0.52, 1.0);
}`,S=`#version 300 es
precision highp float;
in float v_h;
in float v_dist;
in vec2 v_uv;
out vec4 fragColor;

void main(){
  float t = clamp(v_h * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.06, 0.16, 0.20), vec3(0.33, 0.80, 1.00), t * t);
  float fog = exp(-${o.FOG_K.toFixed(3)} * max(v_dist - 1.0, 0.0));
  fragColor = vec4(col * fog * 0.22, 1.0);
}`,D=(s,u)=>{const c=e.createShader(s);return c?(e.shaderSource(c,u),e.compileShader(c),e.getShaderParameter(c,e.COMPILE_STATUS)?c:(console.warn(`shader compile error:
`+e.getShaderInfoLog(c)),null)):null},y=s=>{const u=D(e.VERTEX_SHADER,i),c=D(e.FRAGMENT_SHADER,s);if(!u||!c)return null;const d=e.createProgram();return e.attachShader(d,u),e.attachShader(d,c),e.linkProgram(d),e.getProgramParameter(d,e.LINK_STATUS)?d:(console.warn(`link error:
`+e.getProgramInfoLog(d)),null)},g=y(f),E=y(S);if(!g||!E)V();else{const s=ue(),u=re(o.GRID_N),c=ae(o.GRID_N),d=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,d),e.bufferData(e.ARRAY_BUFFER,u.positions,e.STATIC_DRAW);const U=(t,n)=>{const l=e.createVertexArray();e.bindVertexArray(l),e.bindBuffer(e.ARRAY_BUFFER,d);const r=e.getAttribLocation(t,"a_pos");e.enableVertexAttribArray(r),e.vertexAttribPointer(r,2,e.FLOAT,!1,0,0);const m=e.createBuffer();return e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,m),e.bufferData(e.ELEMENT_ARRAY_BUFFER,n,e.STATIC_DRAW),e.bindVertexArray(null),l},K=U(g,c),q=U(E,u.indices),M=t=>({mvp:e.getUniformLocation(t,"u_mvp"),time:e.getUniformLocation(t,"u_time"),fnA:e.getUniformLocation(t,"u_fnA"),fnB:e.getUniformLocation(t,"u_fnB"),blend:e.getUniformLocation(t,"u_blend"),lift:e.getUniformLocation(t,"u_lift")}),j=M(g),z=M(E);e.clearColor(.039,.039,.039,1);let O=1,A=1;const L=()=>{A=Math.min(window.devicePixelRatio||1,2);const t=Math.floor(a.clientWidth*A),n=Math.floor(a.clientHeight*A);(a.width!==t||a.height!==n)&&(a.width=t,a.height=n,e.viewport(0,0,t,n),s.res&&(s.res.textContent=`${t}×${n}`)),O=t/Math.max(n,1)};window.addEventListener("resize",L),L(),s.res&&(s.res.textContent=`${a.width}×${a.height}`);let R=0,F=0,P=0,C=0;b||window.addEventListener("pointermove",t=>{P=t.clientX/window.innerWidth*2-1,C=t.clientY/window.innerHeight*2-1});const T=x.length,N=o.HOLD_S+o.BLEND_S,X=t=>{if(T<=1)return{a:0,b:0,blend:0};const n=Math.floor(t/N),l=t-n*N,r=n%T,m=(r+1)%T;let p=0;if(l>o.HOLD_S){const h=(l-o.HOLD_S)/o.BLEND_S;p=h*h*(3-2*h)}return{a:r,b:m,blend:p}},Q=t=>{const n=r=>String(r).padStart(2,"0"),l=x[t.blend>.5?t.b:t.a].stats.nodeCount;return t.blend>0&&t.blend<1?`fn ${n(t.a)}→${n(t.b)} · ${l} nodes`:`fn ${n(t.a)} · ${l} nodes`},k=(t,n,l,r,m)=>{e.uniformMatrix4fv(t.mvp,!1,n),e.uniform1f(t.time,l),e.uniform1i(t.fnA,r.a),e.uniform1i(t.fnB,r.b),e.uniform1f(t.blend,r.blend),e.uniform1f(t.lift,m)},J=performance.now();let $=!0;const w=()=>{if(!$)return;L();const t=b?8:(performance.now()-J)/1e3,n=X(t);R+=(P-R)*.04,F+=(C-F)*.04;const l=[Math.sin(t*.06)*.35+R*.25,1.02+F*.12,2.05],r=se(l,[0,-.18,-.55],[0,1,0]),m=ce(.9,O,.05,12),p=le(m,r);e.enable(e.DEPTH_TEST),e.depthFunc(e.LESS),e.depthMask(!0),e.disable(e.BLEND),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),e.useProgram(g),k(j,p,t,n,0),e.bindVertexArray(K),e.drawElements(e.TRIANGLES,c.length,e.UNSIGNED_SHORT,0),e.useProgram(E),k(z,p,t,n,v.LIFT),e.enable(e.BLEND),e.blendFunc(e.ONE,e.ONE),e.depthFunc(e.LEQUAL),e.depthMask(!1),e.bindVertexArray(q),e.drawElements(e.LINES,u.indices.length,e.UNSIGNED_SHORT,0),e.bindVertexArray(null);const h=performance.now();h-W>100&&(W=h,s.time&&(s.time.textContent=t.toFixed(2)+"s"),s.fn&&(s.fn.textContent=Q(n))),b||requestAnimationFrame(w)};document.addEventListener("visibilitychange",()=>{$=!document.hidden,$&&!b&&w()}),w()}}
