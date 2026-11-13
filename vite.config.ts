import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// `vite build --mode standalone` produces the browser-only version (database
// inside the page, solo practice against bots) in dist-standalone/.
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    plugins: [react(), tailwindcss()],
    base: standalone ? './' : '/',
    define: { 'import.meta.env.VITE_STANDALONE': JSON.stringify(standalone ? 'true' : 'false') },
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(__dirname, './src') },
        // keep the in-browser database out of the normal Supabase build
        ...(standalone ? [] : [{ find: /^\.\/standalone\/client$/, replacement: path.resolve(__dirname, './src/lib/standalone/stub.ts') }]),
      ],
    },
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    build: {
      outDir: standalone ? 'dist-standalone' : 'dist',
      chunkSizeWarningLimit: 1200,
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          // claude.ai pages serve only standard web file types; the engine reads
          // its data bundle as raw bytes, so it can travel under a .wasm name
          assetFileNames: (info) =>
            standalone && [info.name, ...(info.names ?? [])].some((n) => n?.endsWith('.data')) ? 'assets/[name]-[hash].data.wasm' : 'assets/[name]-[hash][extname]',
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
  };
});
