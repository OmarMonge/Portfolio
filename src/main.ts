// Main entry point — wires together grammar, renderer, and UI.

import { DEFAULT_WEIGHTS, type Weights, type OperatorName } from './ast';
import { RNG } from './rng';
import { Grammar } from './grammar';
import { buildShaderModule } from './emitter';
import { analyzeAST, astToText } from './analyzer';
import { Renderer } from './renderer';

// --- State ---
const weights: Weights = structuredClone(DEFAULT_WEIGHTS);
let currentSeed = Math.floor(Math.random() * 0xFFFFFFFF);
let currentDepth = 4;

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
const operatorWeightsDiv = document.getElementById('operator-weights') as HTMLDivElement;
const astTreeDiv = document.getElementById('ast-tree') as HTMLDivElement;
const codeOutputDiv = document.getElementById('code-output') as HTMLDivElement;
const statsDiv = document.getElementById('stats-output') as HTMLDivElement;

// --- Renderer ---
const renderer = new Renderer(canvas);

async function boot() {
  try {
    await renderer.init();
    renderer.startLoop();
    buildWeightSliders();
    regenerate();
  } catch (e) {
    const msg = (e as Error).message;
    document.body.innerHTML = `<div style="padding:40px;color:#f55;font-family:monospace;">
      <h1>WebGPU error</h1><p>${msg}</p>
      <p>Try Chrome 113+, Edge, or Safari 18+ on a device with a GPU.</p>
    </div>`;
  }
}

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

  const ast = grammar.genShaderAST(currentDepth);
  const wgsl = buildShaderModule(ast);
  const stats = analyzeAST(ast);

  seedValue.textContent = String(currentSeed);
  seedDisplay.textContent = `seed: ${currentSeed}`;
  astTreeDiv.textContent = astToText(ast);
  codeOutputDiv.textContent = wgsl;
  statsDiv.innerHTML = `
    nodes: <span>${stats.nodeCount}</span> · depth: <span>${stats.depth}</span><br/>
    time: <span>${stats.hasTime}</span> · x: <span>${stats.hasX}</span> · y: <span>${stats.hasY}</span><br/>
    ops: ${Object.entries(stats.operations).map(([k, v]) => `${k}×${v}`).join(' ')}
  `;

  const result = renderer.setShader(wgsl);
  if (!result.ok) {
    console.warn('Shader error, regenerating:', result.error);
    // Retry once with a new seed if the shader fails to compile
    currentSeed = Math.floor(Math.random() * 0xFFFFFFFF);
    seedInput.value = '';
    setTimeout(regenerate, 50);
  }
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
  regenerate();
});

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
