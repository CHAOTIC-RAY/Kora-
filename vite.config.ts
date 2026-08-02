import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';
import compression from 'vite-plugin-compression2';

// Heavy, rarely-changing vendors are split out so the app shell loads without
// parsing the whole graph on first paint (Phase 1.1 of the perf plan).
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
  if (id.includes('firebase')) return 'vendor-firebase';
  if (id.includes('puppeteer') || id.includes('cheerio') || id.includes('linkedom') || id.includes('readability')) return 'vendor-scraper';
  if (id.includes('jszip') || id.includes('pdf-lib') || id.includes('jsdom') || id.includes('crawlee')) return 'vendor-docs';
  return 'vendor-misc';
}

const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const builtAt = new Date().toISOString();
const appChannel = process.env.VITE_APP_CHANNEL === 'beta' ? 'beta' : 'production';

// Pull the real semver from package.json so the update banner compares versions,
// not the random per-build buildId (which previously caused constant false prompts).
let pkgVersion = '0.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
  if (pkg?.version) pkgVersion = String(pkg.version);
} catch { /* keep default */ }

export default defineConfig(() => {
  return {
    define: {
      __KORA_BUILD_ID__: JSON.stringify(buildId),
      __KORA_VERSION__: JSON.stringify(pkgVersion),
    },
    envPrefix: ['VITE_'],
    plugins: [
      react(),
      tailwindcss(),
      // Emit .br (brotli) companions for static assets so the SW / CDN can serve
      // them; also shrinks what Capacitor bundles into the APK (Phase 1.1 / 3.5).
      compression({ algorithms: ['brotliCompress'], exclude: [/\.(?:png|jpe?g|gif|webp|svg|woff2?)$/i] }),
      {
        name: 'kora-version-json',
        writeBundle() {
          const outDir = path.resolve(__dirname, 'dist');
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(
            path.join(outDir, 'version.json'),
            JSON.stringify({ buildId, version: pkgVersion, builtAt, channel: appChannel }, null, 2)
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
    build: {
      target: 'es2020',
      cssCodeSplit: true,
      reportCompressedSize: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks,
        },
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
