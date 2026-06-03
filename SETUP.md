# Portfolio integration — setup

These files fold the portfolio into your existing Shader Explorer project as the
front page, sharing your real grammar code. Total time: a couple of minutes.

## One-time setup

1. **Rename your current tool page.** In your project root, rename the existing
   `index.html` to `explorer.html`. (It already loads `/src/main.ts`, so it keeps
   working as-is.)

2. **Drop in these files** at the matching paths:

   ```
   index.html              (project root)   ← portfolio home page
   vite.config.ts          (project root)   ← registers both pages
   src/emitter-glsl.ts                       ← GLSL emitter
   src/portfolio.ts                          ← hero logic
   ```

3. *(Optional, for the smooth cross-page fade)* add this one line to the very top
   of the `<style>` block in `explorer.html`:

   ```css
   @view-transition { navigation: auto; }
   ```

   `index.html` already has it. The fade shows in Chromium browsers and degrades
   to a normal click elsewhere.

4. Run it:

   ```bash
   npm install      # only if you haven't already
   npm run dev
   ```

   Vite prints a URL. `/` is the portfolio; `/explorer.html` is the tool. The
   "Shader Explorer" card on the portfolio links straight to it.

5. Build for deploy:

   ```bash
   npm run build    # outputs both pages to dist/
   ```

## Why this is the clean version

`src/portfolio.ts` imports your **actual** `rng.ts`, `grammar.ts`, and `ast.ts` —
no duplicated grammar. The only portfolio-specific addition is `emitter-glsl.ts`,
which is your `emitter.ts` retargeted from WGSL to GLSL (the hero is WebGL2; the
explorer is WebGPU). Change the grammar once and both update.

## Adding a future project (the repeatable recipe)

1. Create `whatever.html` in the project root (copy `explorer.html`'s shell).
2. Create `src/whatever.ts` for that project's logic.
3. Register it in `vite.config.ts` under `input` (one line).
4. Add a card linking to `/whatever.html` in `index.html`'s Work section.

### If that project needs 3D models

WebGL/WebGPU don't load models on their own. Add three.js:

```bash
npm install three
```

Then in `src/whatever.ts` use three.js's `GLTFLoader` to load `.glb`/`.gltf`
files (put the model in a `public/` folder so Vite serves it as-is). three.js
handles the camera, lights, materials, and orbit controls for you. Nothing else
in this structure changes — it's just another page.
