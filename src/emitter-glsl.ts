// GLSL emitter — the WGSL emitter (src/emitter.ts) retargeted to GLSL ES 3.00.
// Turns one AST into a `vec3` color expression for the portfolio hero grid.
//
// WGSL -> GLSL differences handled here:
//   - vec4<f32> / vec2<f32>  ->  vec4 / vec2
//   - uniforms.time          ->  u_time  (a plain uniform in the hero shader)
//   - color is a vec3 here (alpha is added by the hero shader itself)
// Everything else (sin, cos, mix, step, clamp, fract, abs, floor, dot, and the
// GLSL-style mod expansion) matches src/emitter.ts one-to-one.

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
    case 'vec4_rgb':
      return `vec3(${emitGLSL(node.r)}, ${emitGLSL(node.g)}, ${emitGLSL(node.b)})`;
    case 'assign_color':
      return emitGLSL(node.expr);
  }
}
