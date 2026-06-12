// Main entry point — wires together grammar, renderer, and UI.
// Two kinds of sliders, stated right in the panel:
//   weight sliders (operators + terminals) change WHAT GETS GENERATED — press G
//   live controls + bands change the CURRENT shader instantly, no regenerate

import { DEFAULT_WEIGHTS, type Weights, type OperatorName, type TerminalName, type ASTNode } from './ast';
import { RNG } from './rng';
import { Grammar } from './grammar';
import { buildShaderModule } from './emitter';
import { analyzeAST } from './analyzer';
import { renderTree, replaceAtPath } from './tree-view';
import { Renderer, DEFAULT_CONTROLS, type Controls } from './renderer';

// --- State ---
const weights: Weights = structuredClone(DEFAULT_WEIGHTS);
let currentSeed = Math.floor(Math.random() * 0xFFFFFFFF);
let currentDepth = 4;
let currentAST: ASTNode | null = null;
let mutationCount = 0;

const rng = new RNG(currentSeed);
const grammar = new Grammar(rng, weights);

// --- DOM ---
const canvas = document.getElementById('shader-canvas') as HTMLCanvasElement;
const seedInput = document.getElementById('seed-input') as HTMLInputElement;
const seedValue = document.getElementById('seed-value') as HTMLSpanElement;
const seedDisplay = document.getElementById('seed-display') as HTMLDivElement;
const depthSlider = document.getElementById('depth-slider') as HTMLInputElement;
const depthValue = document.getElementById('depth-value') as HTMLSpanElement;
const regenerateBtn = document.getElementById('regenerate-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-weights-btn') as HTMLButtonElement;
const resetLiveBtn = document.getElementById('reset-live-btn') as HTMLButtonElement;
const liveControlsDiv = document.getElementById('live-controls') as HTMLDivElement;
const bandControlsDiv = document.getElementById('band-controls') as HTMLDivElement;
const operatorWeightsDiv = document.getElementById('operator-weights') as HTMLDivElement;
const terminalWeightsDiv = document.getElementById('terminal-weights') as HTMLDivElement;
const astTreeDiv = document.getElementById('ast-tree') as HTMLDivElement;
const codeOutputDiv = document.getElementById('code-output') as HTMLDivElement;
const statsDiv = document.getElementById('stats-output') as HTMLDivElement;

// --- Renderer ---
const renderer = new Renderer(canvas);

// --- Live control definitions (instant — written to the uniform buffer) ---
interface LiveDef { key: keyof Controls; min: number; max: number; step: number; desc: string; }

const LIVE_DEFS: LiveDef[] = [
  { key: 'speed',     min: 0,    max: 3, step: 0.01, desc: 'time multiplier — speed up or freeze all animation' },
  { key: 'zoom',      min: 0.2,  max: 3, step: 0.01, desc: 'magnification — higher = closer' },
  { key: 'panX',      min: -1,   max: 1, step: 0.01, desc: 'slide the pattern horizontally' },
  { key: 'panY',      min: -1,   max: 1, step: 0.01, desc: 'slide the pattern vertically' },
  { key: 'warp',      min: 0,    max: 2, step: 0.01, desc: 'wobble the coordinates over time' },
  { key: 'intensity', min: 0,    max: 2, step: 0.01, desc: 'output brightness multiplier' },
  { key: 'hue',       min: 0,    max: 1, step: 0.01, desc: 'rotate all colors around the wheel (1 = full turn)' },
  { key: 'freq',      min: 0,    max: 4, step: 0.01, desc: 'wave tightness — scales every sin/cos argument' },
];

const BAND_DEFS: LiveDef[] = [
  { key: 'waves',   min: 0, max: 2, step: 0.01, desc: 'sin · cos · mix · atan2' },
  { key: 'vector',  min: 0, max: 2, step: 0.01, desc: 'dot · length_vec2' },
  { key: 'tiling',  min: 0, max: 2, step: 0.01, desc: 'floor · mod · step · fract · smoothstep' },
  { key: 'shaping', min: 0, max: 2, step: 0.01, desc: 'abs · clamp · hash · min · max · exp · pow' },
];

async function boot() {
  try {
    await renderer.init();
    renderer.startLoop();
    buildLiveSliders();
    buildWeightSliders();
    buildTerminalSliders();
    regenerate();
  } catch (e) {
    const msg = (e as Error).message;
    document.body.innerHTML = `<div style="padding:40px;color:#f55;font-family:monospace;">
      <h1>WebGPU error</h1><p>${msg}</p>
      <p>Try Chrome 113+, Edge, or Safari 18+ on a device with a GPU.</p>
    </div>`;
  }
}

// --- Live sliders (controls + bands): write straight into renderer.controls ---
function makeLiveSlider(def: LiveDef, parent: HTMLElement) {
  const div = document.createElement('div');
  div.className = 'control';
  const v = renderer.controls[def.key];
  div.innerHTML = `
    <label>${def.key} <span data-live="${def.key}">${v.toFixed(2)}</span></label>
    <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${v}" data-live="${def.key}" />
    <div class="desc">${def.desc}</div>
  `;
  parent.appendChild(div);
  const slider = div.querySelector('input') as HTMLInputElement;
  const label = div.querySelector('span') as HTMLSpanElement;
  slider.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    renderer.controls[def.key] = val;
    label.textContent = val.toFixed(2);
  });
}

function buildLiveSliders() {
  liveControlsDiv.innerHTML = '';
  bandControlsDiv.innerHTML = '';
  LIVE_DEFS.forEach((d) => makeLiveSlider(d, liveControlsDiv));
  BAND_DEFS.forEach((d) => makeLiveSlider(d, bandControlsDiv));
}

function resetLiveControls() {
  renderer.controls = { ...DEFAULT_CONTROLS };
  buildLiveSliders();
}

// --- Weight sliders (generation-time): apply on next regenerate (G) ---
function buildWeightSliders() {
  operatorWeightsDiv.innerHTML = '';
  (Object.keys(weights.operators) as OperatorName[]).forEach((op) => {
    const div = document.createElement('div');
    div.className = 'control';
    div.innerHTML = `
      <label>${op} <span data-op="${op}">${weights.operators[op].toFixed(2)}</span></label>
      <input type="range" min="0" max="0.5" step="0.01" value="${weights.operators[op]}" data-op="${op}" />
    `;
    operatorWeightsDiv.appendChild(div);
    const slider = div.querySelector('input') as HTMLInputElement;
    const label = div.querySelector('span') as HTMLSpanElement;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      weights.operators[op] = v;
      label.textContent = v.toFixed(2);
    });
  });
}

function buildTerminalSliders() {
  terminalWeightsDiv.innerHTML = '';
  (Object.keys(weights.terminals) as TerminalName[]).forEach((term) => {
    const div = document.createElement('div');
    div.className = 'control';
    div.innerHTML = `
      <label>${term} <span data-term="${term}">${weights.terminals[term].toFixed(2)}</span></label>
      <input type="range" min="0" max="0.5" step="0.01" value="${weights.terminals[term]}" data-term="${term}" />
    `;
    terminalWeightsDiv.appendChild(div);
    const slider = div.querySelector('input') as HTMLInputElement;
    const label = div.querySelector('span') as HTMLSpanElement;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      weights.terminals[term] = v;
      label.textContent = v.toFixed(2);
    });
  });
}

// Shared by regenerate() and mutation: refresh every inspector panel.
function refreshPanels(wgsl: string) {
  if (!currentAST) return;
  const stats = analyzeAST(currentAST);
  renderTree(currentAST, astTreeDiv, mutateAtPath);
  codeOutputDiv.textContent = wgsl;
  statsDiv.innerHTML = `
    nodes: <span>${stats.nodeCount}</span> · depth: <span>${stats.depth}</span><br/>
    time: <span>${stats.hasTime}</span> · x: <span>${stats.hasX}</span> · y: <span>${stats.hasY}</span><br/>
    ops: ${Object.entries(stats.operations).map(([k, v]) => `${k}×${v}`).join(' ')}
  `;
}

function seedLabel(): string {
  return mutationCount > 0
    ? `${currentSeed} · ${mutationCount} mutation${mutationCount === 1 ? '' : 's'}`
    : String(currentSeed);
}

function regenerate() {
  // Read seed from input if set, else use current (freshly randomized)
  const inputVal = seedInput.value.trim();
  if (inputVal === '' || inputVal === 'random') {
    currentSeed = Math.floor(Math.random() * 0xFFFFFFFF);
  } else {
    const parsed = parseInt(inputVal, 10);
    if (!isNaN(parsed)) currentSeed = parsed;
  }

  rng.setSeed(currentSeed);
  grammar.setWeights(weights);

  currentAST = grammar.genShaderAST(currentDepth);
  mutationCount = 0;
  const wgsl = buildShaderModule(currentAST);

  seedValue.textContent = seedLabel();
  seedDisplay.textContent = `seed: ${seedLabel()}`;
  refreshPanels(wgsl);

  const result = renderer.setShader(wgsl);
  if (!result.ok) {
    console.warn('Shader error, regenerating:', result.error);
    // Retry once with a new seed if the shader fails to compile
    currentSeed = Math.floor(Math.random() * 0xFFFFFFFF);
    seedInput.value = '';
    setTimeout(regenerate, 50);
  }
}

// --- Subtree mutation ---
// Click a node in the tree -> regrow just that subtree with the current
// weights. Live controls are untouched: the emitter re-wraps the regrown
// ops in their band uniforms, so your knobs keep working on the new branch.
function mutateAtPath(path: number[]) {
  if (!currentAST) return;

  const remainingDepth = Math.max(1, currentDepth - (path.length - 2));
  grammar.setWeights(weights);
  const fresh = grammar.genFloatExpr(remainingDepth);

  const old = replaceAtPath(currentAST, path, fresh);
  if (!old) return; // invalid path — tree out of sync, ignore

  const wgsl = buildShaderModule(currentAST);
  const result = renderer.setShader(wgsl);
  if (!result.ok) {
    // Shouldn't happen (mutation sites are float-context only), but if the
    // shader is rejected, put the old subtree back instead of nuking the seed.
    replaceAtPath(currentAST, path, old);
    console.warn('Mutation produced an invalid shader, reverted:', result.error);
    return;
  }

  mutationCount++;
  seedValue.textContent = seedLabel();
  seedDisplay.textContent = `seed: ${seedLabel()}`;
  refreshPanels(wgsl);
}

// --- Events ---
regenerateBtn.addEventListener('click', () => {
  seedInput.value = ''; // force a new random seed
  regenerate();
});

resetBtn.addEventListener('click', () => {
  Object.assign(weights.operators, DEFAULT_WEIGHTS.operators);
  Object.assign(weights.terminals, DEFAULT_WEIGHTS.terminals);
  buildWeightSliders();
  buildTerminalSliders();
  regenerate();
});

resetLiveBtn.addEventListener('click', resetLiveControls);

depthSlider.addEventListener('input', () => {
  currentDepth = parseInt(depthSlider.value, 10);
  depthValue.textContent = String(currentDepth);
});
depthSlider.addEventListener('change', () => regenerate());

seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') regenerate();
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'g' || e.key === 'G') {
    seedInput.value = '';
    regenerate();
  }
});

boot();
