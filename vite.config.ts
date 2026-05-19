import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    host: true,
    port: 5173,
  },
  optimizeDeps: {
    exclude: ['@tensorflow/tfjs-backend-wasm'],
  },
});
