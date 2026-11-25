import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Build id: the Git commit on Vercel, otherwise the build time. Written to /version.json so that open tabs can notice
// a new deploy (see src/version.ts).
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now());

const versionFile = (): Plugin => ({
  name: 'deckmate-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) });
  },
});

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: { chunkSizeWarningLimit: 1200 },
});
