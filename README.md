# Shader Explorer

Web-based portfolio piece for the procedural shader grammar thesis. Ports the
GDScript PCFG → AST → shader pipeline to TypeScript + WebGPU.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints. **Requires a WebGPU-capable browser**
(Chrome 113+, Edge, Safari 18+). Firefox support is behind a flag.

## Build for deploy

```bash
npm run build
```

Output goes to `dist/`. Deploy to Vercel, Netlify, or GitHub Pages.

## What's here

- `src/ast.ts` — AST node types + default weights (mirrors `weights.json`)
- `src/rng.ts` — seeded RNG (mulberry32)
- `src/grammar.ts` — AST generator, ported from `shader_generator.gd`
- `src/emitter.ts` — WGSL code emitter (the main GLSL → WGSL translation)
- `src/analyzer.ts` — AST structural stats + text tree print (the thesis angle)
- `src/renderer.ts` — WebGPU pipeline, uniform buffer, render loop
- `src/main.ts` — wires UI, grammar, renderer together

## WGSL vs GLSL — what changed

- `vec4` → `vec4<f32>`
- `void fragment()` → `@fragment fn fs_main(...) -> @location(0) vec4<f32>`
- No built-in `UV` / `TIME` — passed as uniforms and vertex attributes
- `mod(x, y)` → `(x - y * floor(x / y))` (WGSL `%` is integer-only)
- Everything else (sin, cos, mix, step, clamp, fract, abs, floor, dot) is
  identical in name

## Next steps — ordered by impact

1. **Interactive AST tree.** Right now it's ASCII text. Swap to D3 tree layout
   or a custom canvas renderer. Make nodes hoverable — hovering a subtree
   highlights the corresponding chunk of WGSL code.
2. **Subtree mutation on click.** Click any node in the tree → regenerate just
   that subtree with the current weights. Feels magical and shows off the
   grammar's compositional structure.
3. **Weight histogram.** Show a histogram of operator frequencies from the
   last N generations vs the configured weights. Makes the probabilistic
   nature of the grammar visible.
4. **Gallery mode (the WebGPU compute angle).** Render 16–64 candidates in
   parallel using a compute shader or parallel render passes, rank them by
   structural metrics, show top N. This is the thesis contribution made
   interactive.
5. **Shader error recovery.** Currently if WGSL fails validation the app
   just retries with a new seed. Log failures to help catch emitter bugs.
6. **Rating UI.** Click good/bad/meh on any generated shader, persist to
   localStorage, export as CSV. Same workflow as the Godot gallery but
   browsable by anyone.

## Deployment tip

When deploying, set the Vite `base` option in `vite.config.ts` if serving
from a subpath (e.g., GitHub Pages `/repo-name/`).

## Known caveats

- The mulberry32 RNG produces *different* sequences than Godot's RNG — a
  seed that looked great in Godot won't look identical here. That's fine
  for a standalone web demo; if you ever need cross-platform reproducibility,
  port Godot's RNG algorithm (it's xoshiro256++ under the hood).
- Some generated ASTs produce numerically unstable shaders (NaN, huge
  gradients). The renderer currently swallows these and retries. You may
  want to add bounds checking in the emitter later.
