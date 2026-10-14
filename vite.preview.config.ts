import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// A UI-only sandbox. The extension itself is built by WXT with Vite.
export default defineConfig({
  root: 'entrypoints/popup',
  define: { __HEADERPILOT_PREVIEW__: 'true' },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url))] },
  },
});
