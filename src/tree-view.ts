// Interactive AST tree view + subtree mutation plumbing.
//
// Renders the AST as clickable DOM rows. Clicking a mutable node regrows
// that subtree with the current weights (handled by main.ts). A node is
// mutable only where the grammar expects a *scalar float expression* —
// inside the r/g/b channels, but not inside the vec2 machinery under
// component_x / component_y, and never the structural root nodes. That
// guarantee is what keeps every mutation emit-safe.

import type { ASTNode } from './ast';

export function getChildren(node: ASTNode): [string, ASTNode][] {
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

// Mirrors getChildren's ordering. Returns false if the slot doesn't exist.
function setChild(node: ASTNode, index: number, child: ASTNode): boolean {
  switch (node.type) {
    case 'component_x': case 'component_y':
    case 'sin': case 'cos': case 'floor': case 'fract': case 'abs': case 'hash': case 'exp':
      if (index === 0) { node.expr = child; return true; }
      return false;
    case 'add': case 'multiply': case 'mod': case 'dot':
    case 'length_vec2': case 'min': case 'max':
      if (index === 0) { node.left = child; return true; }
      if (index === 1) { node.right = child; return true; }
      return false;
    case 'pow':
      if (index === 0) { node.base = child; return true; }
      if (index === 1) { node.exponent = child; return true; }
      return false;
    case 'smoothstep':
      if (index === 0) { node.edge0 = child; return true; }
      if (index === 1) { node.edge1 = child; return true; }
      if (index === 2) { node.value = child; return true; }
      return false;
    case 'atan2':
      if (index === 0) { node.y = child; return true; }
      if (index === 1) { node.x = child; return true; }
      return false;
    case 'step':
      if (index === 0) { node.edge = child; return true; }
      if (index === 1) { node.value = child; return true; }
      return false;
    case 'mix':
      if (index === 0) { node.a = child; return true; }
      if (index === 1) { node.b = child; return true; }
      if (index === 2) { node.t = child; return true; }
      return false;
    case 'clamp':
      if (index === 0) { node.expr = child; return true; }
      if (index === 1) { node.min = child; return true; }
      if (index === 2) { node.max = child; return true; }
      return false;
    case 'vec4_rgb':
      if (index === 0) { node.r = child; return true; }
      if (index === 1) { node.g = child; return true; }
      if (index === 2) { node.b = child; return true; }
      return false;
    case 'assign_color':
      if (index === 0) { node.expr = child; return true; }
      return false;
    default:
      return false;
  }
}

// Swap in `next` at `path` (child indices from the root). Returns the old
// subtree so the caller can revert, or null if the path is invalid.
export function replaceAtPath(root: ASTNode, path: number[], next: ASTNode): ASTNode | null {
  if (path.length === 0) return null;
  let parent: ASTNode = root;
  for (let i = 0; i < path.length - 1; i++) {
    const kids = getChildren(parent);
    const k = kids[path[i]];
    if (!k) return null;
    parent = k[1];
  }
  const idx = path[path.length - 1];
  const kids = getChildren(parent);
  if (!kids[idx]) return null;
  const old = kids[idx][1];
  if (!setChild(parent, idx, next)) return null;
  return old;
}

interface WalkInfo {
  node: ASTNode;
  path: number[];
  depth: number;
  mutable: boolean;
}

// Single source of truth for "where is mutation legal".
function walkTree(root: ASTNode, visit: (info: WalkInfo) => void): void {
  const rec = (node: ASTNode, path: number[], depth: number, floatCtx: boolean): void => {
    const mutable =
      floatCtx &&
      depth >= 2 &&
      node.type !== 'assign_color' &&
      node.type !== 'vec4_rgb' &&
      node.type !== 'uv';
    visit({ node, path, depth, mutable });

    const childCtx =
      node.type === 'component_x' || node.type === 'component_y'
        ? false                       // vec2 territory — hands off
        : node.type === 'vec4_rgb'
          ? true                      // r/g/b channels are float roots
          : floatCtx;

    getChildren(node).forEach(([, child], i) => {
      rec(child, [...path, i], depth + 1, childCtx);
    });
  };
  rec(root, [], 0, false);
}

// For the Node.js stress test: every legal mutation target in a tree.
export function collectMutablePaths(root: ASTNode): number[][] {
  const out: number[][] = [];
  walkTree(root, (info) => { if (info.mutable) out.push(info.path); });
  return out;
}

function label(node: ASTNode): string {
  if (node.type === 'number') return `number (${node.value.toFixed(3)})`;
  if (node.type === 'mat_x') return `mat_x (${node.a.toFixed(2)}, ${node.b.toFixed(2)})`;
  if (node.type === 'mat_y') return `mat_y (${node.c.toFixed(2)}, ${node.d.toFixed(2)})`;
  return node.type;
}

// Render the tree as DOM rows. Mutable rows get a class + click handler.
export function renderTree(
  root: ASTNode,
  container: HTMLElement,
  onMutate: (path: number[]) => void,
): void {
  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  walkTree(root, (info) => {
    const row = document.createElement('div');
    row.className = 'ast-row' + (info.mutable ? ' mutable' : '');
    row.style.paddingLeft = `${info.depth * 12}px`;
    row.textContent = label(info.node);
    if (info.mutable) {
      row.title = 'click to regrow this subtree';
      row.addEventListener('click', () => onMutate(info.path));
    }
    frag.appendChild(row);
  });
  container.appendChild(frag);
}
