import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolves paths relative to this config file (works with "type": "module").
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Deploying under a subpath? e.g. GitHub Pages project site "/repo-name/":
  // base: '/your-repo-name/',
  build: {
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),        // the portfolio (front page)
        explorer: resolve(root, 'explorer.html'), // the Shader Explorer tool
        terrain: resolve(root, 'terrain.html'),   // the Generated Terrain page
        // future project pages go here, e.g.:
        // models: resolve(root, 'models.html'),
      },
    },
  },
});
