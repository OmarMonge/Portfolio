// Emits WGSL fragment shader code from an AST, with the live-control uniform
// system: global transform/color knobs (speed is applied CPU-side to time;
// zoom/panX/panY/warp reshape the coordinates; intensity/hue post-process the
// color; freq scales every sin/cos argument) plus four operator-group "band"
// uniforms that scale each group's output at runtime — the same architecture
// as the Godot fft_mode wrapping. Changing a control never regenerates or
// recompiles the shader.
//
// Band groups:
//   waves   -> sin · cos · mix · atan2
//   vector  -> dot · length_vec2
//   tiling  -> floor · mod · step · fract · smoothstep
//   shaping -> abs · clamp · hash · min · max · exp · pow
// (add/multiply stay unwrapped — scaling those would double-hit everything.)

import type { ASTNode } from './ast';

function fnum(n: number): string {
  let s = n.toString();
  if (!s.includes('.') && !s.includes('e')) s += '.0';
  return s;
}

export function emit(node: ASTNode): string {
  switch (node.type) {
    case 'uv':
      return 'uv';
    case 'time':
      return 't';
    case 'number':
      return fnum(node.value);
    case 'component_x':
      return `(${emit(node.expr)}).x`;
    case 'component_y':
      return `(${emit(node.expr)}).y`;
    case 'multiply':
      return `(${emit(node.left)} * ${emit(node.right)})`;
    case 'add':
      return `((${emit(node.left)} + ${emit(node.right)}) * 0.5)`;
    case 'floor':
      return `(uniforms.tiling * floor(${emit(node.expr)}))`;
    case 'sin':
      return `(uniforms.waves * sin(uniforms.freq * (${emit(node.expr)})))`;
    case 'cos':
      return `(uniforms.waves * cos(uniforms.freq * (${emit(node.expr)})))`;
    case 'mod': {
      const a = emit(node.left);
      const b = emit(node.right);
      return `(uniforms.tiling * (${a} - ${b} * floor(${a} / ${b})))`;
    }
    case 'step':
      return `(uniforms.tiling * step(${emit(node.edge)}, ${emit(node.value)}))`;
    case 'mix':
      return `(uniforms.waves * mix(${emit(node.a)}, ${emit(node.b)}, clamp(${emit(node.t)}, 0.0, 1.0)))`;
    case 'dot': {
      const a = emit(node.left);
      const b = emit(node.right);
      return `(uniforms.vector * dot(vec2<f32>(${a}), vec2<f32>(${b})))`;
    }
    case 'fract':
      return `(uniforms.tiling * fract(${emit(node.expr)}))`;
    case 'abs':
      return `(uniforms.shaping * abs(${emit(node.expr)}))`;
    case 'clamp':
      return `(uniforms.shaping * clamp(${emit(node.expr)}, ${emit(node.min)}, ${emit(node.max)}))`;
    case 'hash':
      return `(uniforms.shaping * fract(sin(${emit(node.expr)} * 43758.5453)))`;
    case 'length_vec2':
      return `(uniforms.vector * length(vec2<f32>(${emit(node.left)}, ${emit(node.right)})))`;
    case 'min':
      return `(uniforms.shaping * min(${emit(node.left)}, ${emit(node.right)}))`;
    case 'max':
      return `(uniforms.shaping * max(${emit(node.left)}, ${emit(node.right)}))`;
    case 'exp':
      return `(uniforms.shaping * exp(clamp(${emit(node.expr)}, -10.0, 10.0)))`;
    case 'pow':
      return `(uniforms.shaping * pow(abs(${emit(node.base)}) + 0.0001, ${emit(node.exponent)}))`;
    case 'smoothstep':
      return `(uniforms.tiling * smoothstep(${emit(node.edge0)}, ${emit(node.edge1)}, ${emit(node.value)}))`;
    case 'atan2':
      return `(uniforms.waves * atan2(${emit(node.y)}, ${emit(node.x)}))`;
    case 'polar_r':
      return `length(uv - vec2<f32>(0.5, 0.5))`;
    case 'polar_theta':
      return `atan2(uv.y - 0.5, uv.x - 0.5)`;
    case 'spherical_x':
      return `(sin(uv.y * 3.1415927) * cos(uv.x * 6.2831853))`;
    case 'spherical_y':
      return `(sin(uv.y * 3.1415927) * sin(uv.x * 6.2831853))`;
    case 'spherical_z':
      return `cos(uv.y * 3.1415927)`;
    case 'mat_x':
      return `(${fnum(node.a)} * uv.x + ${fnum(node.b)} * uv.y)`;
    case 'mat_y':
      return `(${fnum(node.c)} * uv.x + ${fnum(node.d)} * uv.y)`;
    case 'vec4_rgb':
      return `vec4<f32>(${emit(node.r)}, ${emit(node.g)}, ${emit(node.b)}, 1.0)`;
    case 'assign_color':
      return emit(node.expr);
  }
}

// Wraps the emitted expression in a full WGSL fragment shader.
export function buildShaderModule(ast: ASTNode): string {
  const colorExpr = emit(ast);
  return `
struct Uniforms {
  time: f32,
  aspect: f32,
  zoom: f32,
  warp: f32,
  intensity: f32,
  hue: f32,
  freq: f32,
  panX: f32,
  panY: f32,
  waves: f32,
  vector: f32,
  tiling: f32,
  shaping: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VSOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(2.0, 1.0),
    vec2<f32>(0.0, -1.0),
  );
  var out: VSOut;
  out.pos = vec4<f32>(positions[idx], 0.0, 1.0);
  out.uv = uvs[idx];
  return out;
}

fn hueRotate(col: vec3<f32>, h: f32) -> vec3<f32> {
  let a: f32 = h * 6.2831853;
  let k: vec3<f32> = vec3<f32>(0.57735027);
  let cosA: f32 = cos(a);
  return col * cosA + cross(k, col) * sin(a) + k * dot(k, col) * (1.0 - cosA);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let t: f32 = uniforms.time;
  var uv: vec2<f32> = (in.uv - vec2<f32>(0.5, 0.5)) / max(uniforms.zoom, 0.0001)
                      + vec2<f32>(0.5, 0.5) + vec2<f32>(uniforms.panX, uniforms.panY);
  uv = uv + uniforms.warp * 0.12 * vec2<f32>(sin(uv.y * 6.2831853 + t), cos(uv.x * 6.2831853 + t));

  let base: vec4<f32> = ${colorExpr};
  var rgb: vec3<f32> = base.rgb * uniforms.intensity;
  rgb = hueRotate(rgb, uniforms.hue);
  return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
}
