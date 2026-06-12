// Grammar ported from shader_generator.gd
// Generates random ASTs based on weighted probabilities.

import type { ASTNode, Weights, OperatorName, TerminalName } from './ast';
import { RNG } from './rng';

export class Grammar {
  constructor(private rng: RNG, private weights: Weights) {}

  setWeights(weights: Weights) {
    this.weights = weights;
  }

  // Normalize + pick based on weighted probabilities.
  // Mirrors the GDScript _weighted_pick: sort desc, normalize, cumulative roll.
  private weightedPick<K extends string>(weightMap: Record<K, number>): K {
    const entries = (Object.entries(weightMap) as [K, number][])
      .filter(([_, w]) => w > 0)
      .sort((a, b) => b[1] - a[1]);

    const total = entries.reduce((s, [_, w]) => s + w, 0);
    if (total <= 0) return entries[0][0]; // fallback

    const roll = this.rng.randf() * total;
    let cumulative = 0;
    for (const [k, w] of entries) {
      cumulative += w;
      if (roll < cumulative) return k;
    }
    return entries[entries.length - 1][0];
  }

  // Terminal nodes: leaves of the expression tree.
  genTerminal(): ASTNode {
    const pick = this.weightedPick<TerminalName>(this.weights.terminals);
    const uvScaled = (): ASTNode => ({
      type: 'multiply',
      left: { type: 'uv' },
      right: { type: 'number', value: this.rng.randfRange(-20, 20) },
    });
    switch (pick) {
      case 'x':
        return { type: 'component_x', expr: uvScaled() };
      case 'y':
        return { type: 'component_y', expr: uvScaled() };
      case 'time':
        return { type: 'time' };
      case 'constant':
        return { type: 'number', value: this.rng.randfRange(-1, 1) };
      case 'polar_r':
        return { type: 'multiply', left: { type: 'polar_r' }, right: { type: 'number', value: this.rng.randfRange(2, 15) } };
      case 'polar_theta':
        return { type: 'multiply', left: { type: 'polar_theta' }, right: { type: 'number', value: this.rng.randfRange(1, 8) } };
      case 'spherical_x':
        return { type: 'multiply', left: { type: 'spherical_x' }, right: { type: 'number', value: this.rng.randfRange(2, 10) } };
      case 'spherical_y':
        return { type: 'multiply', left: { type: 'spherical_y' }, right: { type: 'number', value: this.rng.randfRange(2, 10) } };
      case 'spherical_z':
        return { type: 'multiply', left: { type: 'spherical_z' }, right: { type: 'number', value: this.rng.randfRange(2, 10) } };
      case 'mat_x': {
        const angle = this.rng.randfRange(0, 6.28);
        const s = this.rng.randfRange(1, 15);
        return { type: 'mat_x', a: Math.cos(angle) * s, b: -Math.sin(angle) * s };
      }
      case 'mat_y': {
        const angle = this.rng.randfRange(0, 6.28);
        const s = this.rng.randfRange(1, 15);
        return { type: 'mat_y', c: Math.sin(angle) * s, d: Math.cos(angle) * s };
      }
    }
  }

  // Float expression: recursive.
  genFloatExpr(depth: number): ASTNode {
    if (depth <= 0) return this.genTerminal();

    const pick = this.weightedPick<OperatorName>(this.weights.operators);
    const child = () => this.genFloatExpr(depth - 1);

    switch (pick) {
      case 'sin':      return { type: 'sin', expr: child() };
      case 'cos':      return { type: 'cos', expr: child() };
      case 'add':      return { type: 'add', left: child(), right: child() };
      case 'multiply': return { type: 'multiply', left: child(), right: child() };
      case 'mod':      return { type: 'mod', left: child(), right: { type: 'number', value: this.rng.randfRange(0.5, 3.0) } };
      case 'step':     return { type: 'step', edge: { type: 'number', value: this.rng.randfRange(0, 1) }, value: child() };
      case 'dot':      return { type: 'dot', left: child(), right: child() };
      case 'fract':    return { type: 'fract', expr: child() };
      case 'abs':      return { type: 'abs', expr: child() };
      case 'clamp':    return { type: 'clamp', expr: child(), min: { type: 'number', value: 0 }, max: { type: 'number', value: 1 } };
      case 'mix':      return { type: 'mix', a: child(), b: child(), t: child() };
      case 'hash':     return { type: 'hash', expr: child() };
      case 'floor':    return { type: 'floor', expr: child() };
      case 'length_vec2': return { type: 'length_vec2', left: child(), right: child() };
      case 'min':      return { type: 'min', left: child(), right: child() };
      case 'max':      return { type: 'max', left: child(), right: child() };
      case 'exp':      return { type: 'exp', expr: child() };
      case 'pow':      return { type: 'pow', base: child(), exponent: { type: 'number', value: this.rng.randfRange(0.5, 3.0) } };
      case 'smoothstep': {
        const e0 = this.rng.randfRange(0.0, 0.5);
        return {
          type: 'smoothstep',
          edge0: { type: 'number', value: e0 },
          edge1: { type: 'number', value: e0 + this.rng.randfRange(0.2, 0.5) },
          value: child(),
        };
      }
      case 'atan2':    return { type: 'atan2', y: child(), x: child() };
    }
  }

  // Top-level: three independent float expressions for R, G, B.
  genShaderAST(depth: number): ASTNode {
    const r = this.genFloatExpr(depth);
    const g = this.genFloatExpr(depth);
    const b = this.genFloatExpr(depth);
    return {
      type: 'assign_color',
      expr: { type: 'vec4_rgb', r, g, b },
    };
  }
}
