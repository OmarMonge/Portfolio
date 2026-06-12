// AST node types mirroring shader_generator.gd
// Every node is a discriminated union on "type"

export type ASTNode =
  | { type: 'uv' }
  | { type: 'time' }
  | { type: 'number'; value: number }
  | { type: 'component_x'; expr: ASTNode }
  | { type: 'component_y'; expr: ASTNode }
  | { type: 'multiply'; left: ASTNode; right: ASTNode }
  | { type: 'add'; left: ASTNode; right: ASTNode }
  | { type: 'floor'; expr: ASTNode }
  | { type: 'sin'; expr: ASTNode }
  | { type: 'cos'; expr: ASTNode }
  | { type: 'mod'; left: ASTNode; right: ASTNode }
  | { type: 'step'; edge: ASTNode; value: ASTNode }
  | { type: 'mix'; a: ASTNode; b: ASTNode; t: ASTNode }
  | { type: 'dot'; left: ASTNode; right: ASTNode }
  | { type: 'fract'; expr: ASTNode }
  | { type: 'abs'; expr: ASTNode }
  | { type: 'clamp'; expr: ASTNode; min: ASTNode; max: ASTNode }
  | { type: 'hash'; expr: ASTNode }
  // -- extended operators (ported from the Godot thesis grammar) --
  | { type: 'length_vec2'; left: ASTNode; right: ASTNode }
  | { type: 'min'; left: ASTNode; right: ASTNode }
  | { type: 'max'; left: ASTNode; right: ASTNode }
  | { type: 'exp'; expr: ASTNode }
  | { type: 'pow'; base: ASTNode; exponent: ASTNode }
  | { type: 'smoothstep'; edge0: ASTNode; edge1: ASTNode; value: ASTNode }
  | { type: 'atan2'; y: ASTNode; x: ASTNode }
  // -- extended terminals (projection/coordinate leaves) --
  | { type: 'polar_r' }
  | { type: 'polar_theta' }
  | { type: 'spherical_x' }
  | { type: 'spherical_y' }
  | { type: 'spherical_z' }
  | { type: 'mat_x'; a: number; b: number }
  | { type: 'mat_y'; c: number; d: number }
  | { type: 'vec4_rgb'; r: ASTNode; g: ASTNode; b: ASTNode }
  | { type: 'assign_color'; expr: ASTNode };

export type OperatorName =
  | 'sin' | 'cos' | 'add' | 'multiply' | 'mod' | 'step'
  | 'dot' | 'fract' | 'abs' | 'clamp' | 'mix' | 'hash' | 'floor'
  | 'length_vec2' | 'min' | 'max' | 'exp' | 'pow' | 'smoothstep' | 'atan2';

export type TerminalName =
  | 'x' | 'y' | 'time' | 'constant'
  | 'polar_r' | 'polar_theta'
  | 'spherical_x' | 'spherical_y' | 'spherical_z'
  | 'mat_x' | 'mat_y';

export interface Weights {
  operators: Record<OperatorName, number>;
  terminals: Record<TerminalName, number>;
}

export const DEFAULT_WEIGHTS: Weights = {
  operators: {
    sin: 0.20, cos: 0.20, add: 0.15, multiply: 0.15,
    mod: 0.10, step: 0.10, dot: 0.08, fract: 0.04,
    abs: 0.04, clamp: 0.02, mix: 0.04, hash: 0.02, floor: 0.06,
    length_vec2: 0.03, min: 0.03, max: 0.03, exp: 0.02,
    pow: 0.03, smoothstep: 0.04, atan2: 0.03,
  },
  terminals: {
    x: 0.30, y: 0.30, time: 0.25, constant: 0.15,
    polar_r: 0.10, polar_theta: 0.08,
    spherical_x: 0.05, spherical_y: 0.05, spherical_z: 0.05,
    mat_x: 0.08, mat_y: 0.08,
  },
};
