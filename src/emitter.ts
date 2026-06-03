// Emits WGSL fragment shader code from an AST.
// Key WGSL differences from GLSL:
//   - vec4<f32> instead of vec4, no implicit conversions (be strict with .0)
//   - fract() -> fract() same name, but mod is different
//   - mod in GLSL is `mod(x, y)` -> in WGSL use `x - y * floor(x / y)` or `x % y` for ints
//     For floats, we can use `(a - b * floor(a / b))` to match GLSL mod semantics.
//   - mix(a, b, t) -> mix() same
//   - step(edge, x) -> step() same
//   - clamp() same
//   - No built-in UV / TIME: we pass via uniform buffer and varying.

import type { ASTNode } from './ast';

export function emit(node: ASTNode): string {
  switch (node.type) {
    case 'uv':
      return 'uv';
    case 'time':
      return 'uniforms.time';
    case 'number': {
      let s = node.value.toString();
      if (!s.includes('.') && !s.includes('e')) s += '.0';
      return s;
    }
    case 'component_x':
      return `(${emit(node.expr)}).x`;
    case 'component_y':
      return `(${emit(node.expr)}).y`;
    case 'multiply':
      // vec2 * f32 is valid in WGSL when the vec and scalar types match.
      // We handle the UV*number case specially by letting the component_x/y unwrap it.
      return `(${emitScalar(node.left)} * ${emitScalar(node.right)})`;
    case 'add':
      return `((${emitScalar(node.left)} + ${emitScalar(node.right)}) * 0.5)`;
    case 'floor':
      return `floor(${emitScalar(node.expr)})`;
    case 'sin':
      return `sin(${emitScalar(node.expr)})`;
    case 'cos':
      return `cos(${emitScalar(node.expr)})`;
    case 'mod': {
      // GLSL-style mod: x - y * floor(x/y)
      const a = emitScalar(node.left);
      const b = emitScalar(node.right);
      return `(${a} - ${b} * floor(${a} / ${b}))`;
    }
    case 'step':
      return `step(${emitScalar(node.edge)}, ${emitScalar(node.value)})`;
    case 'mix':
      return `mix(${emitScalar(node.a)}, ${emitScalar(node.b)}, clamp(${emitScalar(node.t)}, 0.0, 1.0))`;
    case 'dot': {
      // Make a vec2 out of two scalars, dot it with itself-ish (matches GDScript dot behavior).
      const a = emitScalar(node.left);
      const b = emitScalar(node.right);
      return `dot(vec2<f32>(${a}), vec2<f32>(${b}))`;
    }
    case 'fract':
      return `fract(${emitScalar(node.expr)})`;
    case 'abs':
      return `abs(${emitScalar(node.expr)})`;
    case 'clamp':
      return `clamp(${emitScalar(node.expr)}, ${emitScalar(node.min)}, ${emitScalar(node.max)})`;
    case 'hash':
      return `fract(sin(${emitScalar(node.expr)} * 43758.5453))`;
    case 'vec4_rgb':
      return `vec4<f32>(${emitScalar(node.r)}, ${emitScalar(node.g)}, ${emitScalar(node.b)}, 1.0)`;
    case 'assign_color':
      // Inside our fragment entry point we set a `color` variable.
      return emit(node.expr);
  }
}

// Most nodes are scalar-valued. component_x/y unwrap vec2s. emitScalar wraps things for safety.
function emitScalar(node: ASTNode): string {
  return emit(node);
}

// Wraps the emitted expression in a full WGSL fragment shader.
export function buildShaderModule(ast: ASTNode): string {
  const colorExpr = emit(ast); // assign_color returns the vec4 expression
  return `
struct Uniforms {
  time: f32,
  aspect: f32,
  _pad0: f32,
  _pad1: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VSOut {
  // Fullscreen triangle
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

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let uv: vec2<f32> = in.uv;
  return ${colorExpr};
}
`;
}
