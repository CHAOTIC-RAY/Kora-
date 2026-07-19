import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Allow Replit's proxied iframe to reach the dev server
      allowedHosts: true as true,
      proxy: {
        '/voxlibri-api': {
          target: 'http://localhost:7861',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/voxlibri-api/, ''),
        },
        '/vocalbook-api': {
          target: 'http://localhost:7862',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/vocalbook-api/, ''),
        },
      },
    },
  };
});
