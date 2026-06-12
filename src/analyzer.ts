// Walks an AST and collects structural statistics.
// This is the core of Omar's thesis contribution — analyzing structural
// properties of generated shaders rather than pixel-level output.

import type { ASTNode } from './ast';

export interface ASTStats {
  nodeCount: number;
  depth: number;
  hasTime: boolean;
  hasX: boolean;
  hasY: boolean;
  operations: Record<string, number>;
}

export function analyzeAST(root: ASTNode): ASTStats {
  const stats: ASTStats = {
    nodeCount: 0,
    depth: 0,
    hasTime: false,
    hasX: false,
    hasY: false,
    operations: {},
  };
  walk(root, stats, 0);
  return stats;
}

function walk(node: ASTNode, stats: ASTStats, depth: number) {
  stats.nodeCount++;
  if (depth > stats.depth) stats.depth = depth;
  stats.operations[node.type] = (stats.operations[node.type] ?? 0) + 1;

  switch (node.type) {
    case 'time':
      stats.hasTime = true;
      break;
    case 'component_x':
      stats.hasX = true;
      walk(node.expr, stats, depth + 1);
      break;
    case 'component_y':
      stats.hasY = true;
      walk(node.expr, stats, depth + 1);
      break;
    case 'sin': case 'cos': case 'floor': case 'fract': case 'abs': case 'hash': case 'exp':
      walk(node.expr, stats, depth + 1);
      break;
    case 'add': case 'multiply': case 'mod': case 'dot':
    case 'length_vec2': case 'min': case 'max':
      walk(node.left, stats, depth + 1);
      walk(node.right, stats, depth + 1);
      break;
    case 'pow':
      walk(node.base, stats, depth + 1);
      walk(node.exponent, stats, depth + 1);
      break;
    case 'smoothstep':
      walk(node.edge0, stats, depth + 1);
      walk(node.edge1, stats, depth + 1);
      walk(node.value, stats, depth + 1);
      break;
    case 'atan2':
      walk(node.y, stats, depth + 1);
      walk(node.x, stats, depth + 1);
      break;
    case 'polar_r': case 'polar_theta':
    case 'spherical_x': case 'spherical_y': case 'spherical_z':
    case 'mat_x': case 'mat_y':
      // projection terminals depend on both spatial axes
      stats.hasX = true;
      stats.hasY = true;
      break;
    case 'step':
      walk(node.edge, stats, depth + 1);
      walk(node.value, stats, depth + 1);
      break;
    case 'mix':
      walk(node.a, stats, depth + 1);
      walk(node.b, stats, depth + 1);
      walk(node.t, stats, depth + 1);
      break;
    case 'clamp':
      walk(node.expr, stats, depth + 1);
      walk(node.min, stats, depth + 1);
      walk(node.max, stats, depth + 1);
      break;
    case 'vec4_rgb':
      walk(node.r, stats, depth + 1);
      walk(node.g, stats, depth + 1);
      walk(node.b, stats, depth + 1);
      break;
    case 'assign_color':
      walk(node.expr, stats, depth + 1);
      break;
    // uv, time, number have no children
  }
}

// Pretty-print the AST as a text tree (ASCII art) for display.
// (The explorer now uses src/tree-view.ts for the interactive version;
// this stays for logging / debugging.)
export function astToText(node: ASTNode, indent = '', isLast = true): string {
  const prefix = indent + (isLast ? '└─ ' : '├─ ');
  const nextIndent = indent + (isLast ? '   ' : '│  ');
  let label = node.type;
  if (node.type === 'number') label += ` (${node.value.toFixed(3)})`;

  let out = prefix + label + '\n';

  const children = getChildren(node);
  children.forEach(([_, child], i) => {
    out += astToText(child, nextIndent, i === children.length - 1);
  });
  return out;
}

function getChildren(node: ASTNode): [string, ASTNode][] {
  switch (node.type) {
    case 'component_x': case 'component_y':
    case 'sin': case 'cos': case 'floor': case 'fract': case 'abs': case 'hash': case 'exp':
      return [['expr', node.expr]];
    case 'add': case 'multiply': case 'mod': case 'dot':
    case 'length_vec2': case 'min': case 'max':
      return [['left', node.left], ['right', node.right]];
    case 'pow':
      return [['base', node.base], ['exponent', node.exponent]];
    case 'smoothstep':
      return [['edge0', node.edge0], ['edge1', node.edge1], ['value', node.value]];
    case 'atan2':
      return [['y', node.y], ['x', node.x]];
    case 'step':
      return [['edge', node.edge], ['value', node.value]];
    case 'mix':
      return [['a', node.a], ['b', node.b], ['t', node.t]];
    case 'clamp':
      return [['expr', node.expr], ['min', node.min], ['max', node.max]];
    case 'vec4_rgb':
      return [['r', node.r], ['g', node.g], ['b', node.b]];
    case 'assign_color':
      return [['expr', node.expr]];
    default:
      return [];
  }
}
