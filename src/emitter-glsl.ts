// GLSL emitter — the WGSL emitter (src/emitter.ts) retargeted to GLSL ES.
// Used by the portfolio hero (terrain height functions). Deliberately PLAIN:
// no live-control uniforms here — controls are an explorer feature, the hero
// emits raw fields. Keep node coverage in sync with src/emitter.ts.

import type { ASTNode } from './ast';

function fnum(n: number): string {
  if (!isFinite(n)) return '0.0';
  return n.toFixed(6);
}

export function emitGLSL(node: ASTNode): string {
  switch (node.type) {
    case 'uv':
      return 'uv';
    case 'time':
      return 'u_time';
    case 'number':
      return fnum(node.value);
    case 'component_x':
      return `(${emitGLSL(node.expr)}).x`;
    case 'component_y':
      return `(${emitGLSL(node.expr)}).y`;
    case 'multiply':
      return `(${emitGLSL(node.left)} * ${emitGLSL(node.right)})`;
    case 'add':
      return `((${emitGLSL(node.left)} + ${emitGLSL(node.right)}) * 0.5)`;
    case 'floor':
      return `floor(${emitGLSL(node.expr)})`;
    case 'sin':
      return `sin(${emitGLSL(node.expr)})`;
    case 'cos':
      return `cos(${emitGLSL(node.expr)})`;
    case 'mod': {
      const a = emitGLSL(node.left);
      const b = emitGLSL(node.right);
      return `(${a} - ${b} * floor(${a} / ${b}))`;
    }
    case 'step':
      return `step(${emitGLSL(node.edge)}, ${emitGLSL(node.value)})`;
    case 'mix':
      return `mix(${emitGLSL(node.a)}, ${emitGLSL(node.b)}, clamp(${emitGLSL(node.t)}, 0.0, 1.0))`;
    case 'dot': {
      const a = emitGLSL(node.left);
      const b = emitGLSL(node.right);
      return `dot(vec2(${a}), vec2(${b}))`;
    }
    case 'fract':
      return `fract(${emitGLSL(node.expr)})`;
    case 'abs':
      return `abs(${emitGLSL(node.expr)})`;
    case 'clamp':
      return `clamp(${emitGLSL(node.expr)}, ${emitGLSL(node.min)}, ${emitGLSL(node.max)})`;
    case 'hash':
      return `fract(sin(${emitGLSL(node.expr)} * 43758.5453))`;
    case 'length_vec2':
      return `length(vec2(${emitGLSL(node.left)}, ${emitGLSL(node.right)}))`;
    case 'min':
      return `min(${emitGLSL(node.left)}, ${emitGLSL(node.right)})`;
    case 'max':
      return `max(${emitGLSL(node.left)}, ${emitGLSL(node.right)})`;
    case 'exp':
      return `exp(clamp(${emitGLSL(node.expr)}, -10.0, 10.0))`;
    case 'pow':
      return `pow(abs(${emitGLSL(node.base)}) + 0.0001, ${emitGLSL(node.exponent)})`;
    case 'smoothstep':
      return `smoothstep(${emitGLSL(node.edge0)}, ${emitGLSL(node.edge1)}, ${emitGLSL(node.value)})`;
    case 'atan2':
      return `atan(${emitGLSL(node.y)}, ${emitGLSL(node.x)})`;
    case 'polar_r':
      return `length(uv - vec2(0.5))`;
    case 'polar_theta':
      return `atan(uv.y - 0.5, uv.x - 0.5)`;
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
      return `vec3(${emitGLSL(node.r)}, ${emitGLSL(node.g)}, ${emitGLSL(node.b)})`;
    case 'assign_color':
      return emitGLSL(node.expr);
  }
}
