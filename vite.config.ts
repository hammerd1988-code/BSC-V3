import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    // Expose Vercel/v0 integration env vars (NEXT_PUBLIC_*) to Vite's import.meta.env
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      strictPort: false,
      hmr: process.env.DISABLE_HMR !== 'true',
      // Proxy API + Socket.io to Express when running dev:full
      proxy: {
        '/api': 'http://localhost:3001',
        '/socket.io': { target: 'http://localhost:3001', ws: true },
      },
    },
    build: {
      rollupOptions: {
        output: {
          // IMPORTANT: every match below is anchored to a `/node_modules/<pkg>/`
          // path segment. Bare substring matches (e.g. id.includes('react'))
          // wrongly pulled `recharts`, `react-three`, and other unrelated
          // packages into `react-vendor`, which split shared deps across two
          // chunks and produced a runtime *circular* import between
          // `react-vendor` and `viz-vendor` that crashed React mount with
          // `Cannot read properties of undefined (reading 'forwardRef')`.
          manualChunks(id) {
            if (!id.includes('/node_modules/')) return;

            const segment = (pkg: string) => id.includes(`/node_modules/${pkg}/`);

            if (id.includes('/node_modules/@tiptap/')) return 'tiptap';

            // React core only \u2014 no react-* / *-react libs (recharts,
            // react-three-fiber, framer-motion, etc.) so this chunk has no
            // reason to import from any other vendor chunk.
            if (
              segment('react') ||
              segment('react-dom') ||
              segment('react-router') ||
              segment('react-router-dom') ||
              segment('scheduler')
            ) return 'react-vendor';

            if (id.includes('/node_modules/@supabase/')) return 'data-vendor';
            if (id.includes('/node_modules/@google/genai/') || segment('openai')) return 'ai-vendor';
            if (segment('recharts') || /\/node_modules\/d3-?[^/]*\//.test(id)) return 'viz-vendor';
          },
        },
      },
    },
  };
});
