import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';
import compression from 'vite-plugin-compression2';
import apkHtml from './scripts/vite-apk-html-plugin.ts';

// NOTE: We deliberately do NOT split React / Firebase / other boot-critical
// vendors into separate chunks via manualChunks. Isolating them (e.g. a
// `vendor-react` or `vendor-firebase` chunk) causes ES-module evaluation-order
// bugs at boot — Firebase throws "Cannot access 'X' before initialization" and
// React throws "Cannot read properties of undefined (reading 'createContext')"
// because the app chunk runs before the isolated vendor chunk finishes
// initializing. Keeping framework code in the entry chunk avoids cross-chunk
// TDZ. Route-level code splitting is still handled by React.lazy in the app.
// Only truly leaf/Worker-only libraries are split below.
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  // Worker-only / non-boot leaf libraries (safe to isolate — never imported on
  // the client boot path).
  if (id.includes('puppeteer') || id.includes('cheerio') || id.includes('linkedom') || id.includes('readability')) return 'vendor-scraper';
  if (id.includes('jszip') || id.includes('pdf-lib') || id.includes('jsdom') || id.includes('crawlee')) return 'vendor-docs';
  return undefined;
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
      compression({ algorithms: ['brotliCompress'], exclude: [/\\.(?:png|jpe?g|gif|webp|svg|woff2?)$/i] }),
      apkHtml(),
      {
        // Perf plan Phase 4: emit a precache manifest of the hashed build
        // assets (entry chunk, CSS, lazy tab chunks, fonts). Without this the
        // service worker only precached unhashed shell files, so the 2 MB entry
        // chunk and every lazy tab chunk still went to the network on a cold
        // start — the exact cost the tab prewarming is trying to avoid.
        //
        // Emitted as a separate JSON file (not inlined into sw.js) so the SW
        // itself stays byte-stable across builds except for its version stamp.
        name: 'kora-precache-manifest',
        writeBundle(_options: any, bundle: Record<string, any>) {
          const outDir = path.resolve(__dirname, 'dist');
          // Only precache what's actually needed to boot + switch tabs. Big
          // leaf chunks that are only reachable behind an explicit user action
          // (the PDF engine, scraper/doc vendors) stay on-demand so we don't
          // blow the cache budget or the APK's first-run data use.
          const EXCLUDE = /(vendor-scraper|vendor-docs|BookReaderPDF)/;
          const files = Object.keys(bundle)
            .filter((f) => /\.(?:js|css)$/.test(f))
            .filter((f) => !EXCLUDE.test(f))
            .map((f) => `/${f}`);
          const manifest = {
            buildId,
            version: pkgVersion,
            assets: files.sort(),
            generatedAt: builtAt,
          };
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(
            path.join(outDir, 'precache-manifest.json'),
            JSON.stringify(manifest, null, 2)
          );
          console.log(`[kora-precache-manifest] ${files.length} hashed assets`);
        },
      },
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
      // APK CRITICAL: cssCodeSplit=false inlines ALL CSS into the JS bundle.
      // When cssCodeSplit=true, Vite emits a separate .css file loaded via
      // <link crossorigin>. On Android WebView (file:// origin), the crossorigin
      // attribute + async CSS <link> can fail silently, leaving the page
      // render-blocked with no stylesheet → white screen. Inlining CSS into
      // the JS bundle eliminates that failure mode.
      cssCodeSplit: false,
      reportCompressedSize: true,
      chunkSizeWarningLimit: 900,
      // Remove crossorigin attributes on <script>/<link> tags in the output HTML.
      // The APK serves all assets from the same origin (file:///android_asset/).
      // The crossorigin attribute forces a CORS fetch which fails silently on
      // some Android WebView versions, preventing JS/CSS from loading → white screen.
      // https://vite.dev/config/build-options.html#build-crossorigin
      crossOrigin: false,
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
