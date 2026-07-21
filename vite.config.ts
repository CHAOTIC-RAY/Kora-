import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const builtAt = new Date().toISOString();
const appChannel = process.env.VITE_APP_CHANNEL === 'beta' ? 'beta' : 'production';

export default defineConfig(() => {
  return {
    define: {
      __KORA_BUILD_ID__: JSON.stringify(buildId),
    },
    envPrefix: ['VITE_'],
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'kora-version-json',
        writeBundle() {
          const outDir = path.resolve(__dirname, 'dist');
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(
            path.join(outDir, 'version.json'),
            JSON.stringify({ buildId, builtAt, channel: appChannel }, null, 2)
          );
          // Also stamp sw.js so browsers always see a byte change after redeploy
          // (even when download logic is unchanged) and pick up the new worker.
          const swPath = path.join(outDir, 'sw.js');
          if (fs.existsSync(swPath)) {
            fs.appendFileSync(
              swPath,
              `\n// kora-build ${buildId} ${builtAt}\n`
            );
          }
        },
      },
    ],
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
    },
  };
});
