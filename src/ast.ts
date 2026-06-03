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
  | { type: 'vec4_rgb'; r: ASTNode; g: ASTNode; b: ASTNode }
  | { type: 'assign_color'; expr: ASTNode };

export type OperatorName =
  | 'sin' | 'cos' | 'add' | 'multiply' | 'mod' | 'step'
  | 'dot' | 'fract' | 'abs' | 'clamp' | 'mix' | 'hash' | 'floor';

export type TerminalName = 'x' | 'y' | 'time' | 'constant';

export interface Weights {
  operators: Record<OperatorName, number>;
  terminals: Record<TerminalName, number>;
}

export const DEFAULT_WEIGHTS: Weights = {
  operators: {
    sin: 0.20, cos: 0.20, add: 0.15, multiply: 0.15,
    mod: 0.10, step: 0.10, dot: 0.08, fract: 0.04,
    abs: 0.04, clamp: 0.02, mix: 0.04, hash: 0.02, floor: 0.06,
  },
  terminals: {
    x: 0.30, y: 0.30, time: 0.25, constant: 0.15,
  },
};
