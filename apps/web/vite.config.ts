import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // NOTE: the IPv4 binding is set with `--host 127.0.0.1` in the dev script,
    // not here — Vite 6 ignores `server.host` from the config file in this setup.
    // It matters because Vite's default `localhost` binds ::1 only on macOS, so
    // http://127.0.0.1:5173 would refuse connections. Browsers and curl fall back
    // from ::1 to 127.0.0.1, so http://localhost:5173 works either way.
    proxy: {
      // Dev convenience: same-origin API and websocket, so no CORS in development.
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:4000', ws: true, changeOrigin: true },
    },
  },
  // Monaco's own ESM entry points are large; Vite's default warning threshold is
  // not useful here, so it is raised to a level that still flags real regressions.
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Monaco is ~3MB and changes only when the dependency does, so it gets
          // its own long-lived chunk rather than invalidating the app bundle.
          if (id.includes('monaco-editor')) return 'monaco';
          if (/node_modules\/(react|react-dom|react-router|zustand|socket\.io-client|engine\.io-client)/.test(id)) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
});
