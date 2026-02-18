import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { ensureDistAssets } from './scripts/ensure-dist-assets-core.mjs';

import tailwindcss from '@tailwindcss/vite';

function ensureDistAssetsPlugin() {
  let hasRun = false;
  const ensureOnce = () => {
    if (hasRun) return;
    hasRun = true;
    ensureDistAssets({ silent: true });
  };

  return {
    name: 'ensure-dist-assets',
    configResolved() {
      ensureOnce();
    },
    configureServer() {
      ensureOnce();
    },
    buildStart() {
      ensureOnce();
    },
  };
}

export default defineConfig({
  integrations: [react()],
  vite: {
    ssr: {
      noExternal: ['lucide-react']
    },

    plugins: [tailwindcss(), ensureDistAssetsPlugin()]
  }
});
