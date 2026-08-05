import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolves paths relative to this config file (works with "type": "module").
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),        // the portfolio (front page)
        explorer: resolve(root, 'explorer.html'), // the Shader Explorer tool
        terrain: resolve(root, 'terrain.html'),   // the Generated Terrain page
        fractals: resolve(root, 'fractals.html'), // the Fractal Visualizer
        gallery: resolve(root, 'gallery.html'),   // saved shaders
        // future project pages go here
      },
    },
  },
});