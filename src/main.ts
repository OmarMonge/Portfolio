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
import { AudioReactive } from './audio-reactive';
import {
  encodeSnapshot, decodeSnapshot, snapshotFromHash, shareUrl,
  captureThumb, saveToGallery, type Snapshot,
} from './snapshot';

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
const audioToggle = document.getElementById('audio-toggle') as HTMLButtonElement;
const audioMicBtn = document.getElementById('audio-mic') as HTMLButtonElement;
const audioFileBtn = document.getElementById('audio-file') as HTMLButtonElement;
const audioFileInput = document.getElementById('audio-file-input') as HTMLInputElement;
const audioStatus = document.getElementById('audio-status') as HTMLSpanElement;
const saveGalleryBtn = document.getElementById('save-gallery-btn') as HTMLButtonElement;
const shareLinkBtn = document.getElementById('share-link-btn') as HTMLButtonElement;
const keepStatus = document.getElementById('keep-status') as HTMLDivElement;

// --- Renderer ---
const renderer = new Renderer(canvas);

// --- Audio reactivity: feed live FFT bands into renderer.controls (fft_mode) ---
const audio = new AudioReactive(renderer);

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
    setupAudio();
    buildWeightSliders();
    buildTerminalSliders();
    if (!(await tryLoadFromHash())) regenerate();
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

// --- Drive the Bands with live FFT (the browser version of fft_mode) ---
function setupAudio() {
  audio.onStatus = (s) => { if (audioStatus) audioStatus.textContent = s; };

  // reflect the live band values on the sliders so they visibly track the music
  audio.onUpdate = (bands) => {
    (['waves', 'vector', 'tiling', 'shaping'] as const).forEach((k) => {
      const span = bandControlsDiv.querySelector(`span[data-live="${k}"]`);
      const input = bandControlsDiv.querySelector(`input[data-live="${k}"]`) as HTMLInputElement | null;
      if (span) span.textContent = bands[k].toFixed(2);
      if (input) input.value = String(bands[k]);
    });
  };

  const reflect = (on: boolean) => {
    audioToggle.classList.toggle('primary', on);
    audioToggle.textContent = on ? 'Music: on' : 'Drive with music';
    bandControlsDiv.classList.toggle('audio-driven', on);
    if (!on) buildLiveSliders(); // bands back to neutral, sliders live again
  };

  audioToggle.addEventListener('click', () => {
    const on = !audio.isEnabled();
    audio.setEnabled(on);
    reflect(on);
  });
  audioMicBtn.addEventListener('click', () => { audio.useMic(); reflect(true); });
  audioFileBtn.addEventListener('click', () => audioFileInput.click());
  audioFileInput.addEventListener('change', () => {
    if (audioFileInput.files?.[0]) { audio.useFile(audioFileInput.files[0]); reflect(true); }
  });
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

// --- Snapshots: save / share the exact shader on screen ---
// Seed alone isn't enough (mutations depend on RNG history, weights change
// what a seed grows into), so the snapshot carries the AST itself.

function currentSnapshot(): Snapshot | null {
  if (!currentAST) return null;
  return {
    v: 1,
    ast: currentAST,
    controls: { ...renderer.controls },
    seed: currentSeed,
    depth: currentDepth,
    mutations: mutationCount,
  };
}

async function copyShareLink() {
  const snap = currentSnapshot();
  if (!snap) return;
  const encoded = await encodeSnapshot(snap);
  history.replaceState(null, '', `#s=${encoded}`); // address bar now IS the shader
  await navigator.clipboard.writeText(shareUrl(encoded));
  keepStatus.textContent = 'link copied — anyone who opens it sees exactly this';
}

async function saveCurrentToGallery() {
  const snap = currentSnapshot();
  if (!snap) return;
  const [encoded, thumb] = await Promise.all([
    encodeSnapshot(snap),
    captureThumb(canvas), // must read the canvas in-frame — see snapshot.ts
  ]);
  const entry = saveToGallery({ title: `shader ${seedLabel()}`, thumb, data: encoded });
  keepStatus.innerHTML = entry
    ? 'saved · <a href="/gallery.html" style="color:#5cf;text-decoration:none;">open gallery</a>'
    : 'localStorage full — delete some saved shaders first';
}

// Restore a shared shader from the URL hash. Returns false → boot falls back
// to a normal regenerate().
async function tryLoadFromHash(): Promise<boolean> {
  const encoded = snapshotFromHash();
  if (!encoded) return false;
  const snap = await decodeSnapshot(encoded);
  if (!snap) return false;

  currentAST = snap.ast;
  currentSeed = snap.seed;
  currentDepth = snap.depth;
  mutationCount = snap.mutations;

  depthSlider.value = String(currentDepth);
  depthValue.textContent = String(currentDepth);
  renderer.controls = { ...snap.controls };
  buildLiveSliders();

  const wgsl = buildShaderModule(currentAST);
  const result = renderer.setShader(wgsl);
  if (!result.ok) return false;

  seedValue.textContent = seedLabel();
  seedDisplay.textContent = `seed: ${seedLabel()}`;
  refreshPanels(wgsl);
  return true;
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

shareLinkBtn.addEventListener('click', copyShareLink);
saveGalleryBtn.addEventListener('click', saveCurrentToGallery);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'g' || e.key === 'G') {
    seedInput.value = '';
    regenerate();
  }
  if (e.key === 's' || e.key === 'S') {
    saveCurrentToGallery();
  }
});

boot();