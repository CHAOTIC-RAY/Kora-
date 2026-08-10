# Plan — Pack more into the APK + seamless background tab loading

Status: Phases 0–4 **implemented**. Phase 5 remains proposed.

> **Correction after reading the code:** most of this plan was already built on
> main before I wrote it. `public/sw.js` (1004 lines) already precached the
> dictionary shards, covers, and API warm paths, and `pdfjs-dist` was already
> in its own lazy 372 KB chunk. The plan's Phase 2 claim that "Service Workers
> do not run on `file://`" was **wrong for this app**: `capacitor.config.ts`
> sets `androidScheme: "https"`, so the SW runs in the APK too. The one real
> gap was that **no hashed asset was precached** — see Phase 4.

Target: Kora Capacitor Android APK (WebView) + web build.

---

## Phase 0 — Background tab prewarming (DONE)

Implemented in `src/App.tsx` (`prewarmedRef` effect).

Tabs are `React.lazy` + keep-alive (`mountedTabs`), so the first visit to a tab
paid for *both* a chunk fetch and a full mount. Now, on idle:

| Stage | Delay (idle timeout) | Work |
|-------|----------------------|------|
| 1 | 2s | `import()` Discover, Feed, Library chunks |
| 2 | 4s | `import()` Settings, Lounge (if enabled) |
| 3 | 6s | Add library/discover/feed/tools to `mountedTabs` → panels mount offscreen |

After stage 3 a tab switch is a pure visibility flip (`display:none` →
visible), not a mount.

**Gated off** when any of: `kora_performance_mode === "1"`,
`deviceMemory <= 2`, `hardwareConcurrency <= 4`, or `connection.saveData`.
On those devices the extra resident DOM costs more than the switch it saves.

Relies on the existing `.kora-tab-panel[hidden]` rule
(`display:none; content-visibility:hidden; contain-intrinsic-size:0px`) so
inactive mounted panels cost no layout or paint.

---

## Phase 1 — Ship the data bundle inside the APK

Today the dictionary shards, dict index, and seed feed/catalog JSON are fetched
over the network on first use. In the APK they can be bundled as static assets
served from `file:///android_asset/`, making them instant and fully offline.

1. Extend `scripts/build-data-bundle.mjs` to emit an APK manifest listing every
   `/data/**` asset it produces.
2. In `capacitor.config.ts` / the copy step, ensure `dist/data/**` lands in
   `android/app/src/main/assets/public/data/`.
3. Add a build assertion: fail the APK build if `data/dict/index.json` is
   missing from the assets tree (catches a silent Vite `publicDir` change).

**Win:** zero-network dictionary lookups; removes the first-tap dictionary stall.

## Phase 2 — Precache the app shell with a Service Worker

- Add `sw.js` precaching: entry JS, inlined CSS, fonts, base SVG icons, the
  Kora logo set, and the offline fallback page.
- Strategy: **cache-first, immutable** for hashed assets; **stale-while-revalidate**
  for `/data/**`; **network-first** for `/api/**`.
- **Already implemented** in `public/sw.js`: shell/API/cover/data caches with
  cache-first for `/data/**`, stale-while-revalidate for warm API paths.
- APK note: because `androidScheme: "https"` (not `file://`), the SW **does**
  run inside the Capacitor WebView, so the APK gets this too.

## Phase 3 — Cover & image pipeline

- Route every remote cover through the existing `coverCache` IndexedDB layer
  (already LRU-capped at 200 MB on main) so a second view is local.
- Emit 20px blur-up placeholders inline (base64) at build time for seeded
  catalog covers; swap to full quality on load.
- Prefer WebP via the cover proxy `?fmt=webp` where the source allows it.

## Phase 4 — Precache the hashed assets (DONE — the real gap)

`SHELL_ASSETS` only listed unhashed files (`/`, `index.html`, manifest, fonts),
so on a cold start the **2.0 MB entry chunk and every lazy tab chunk still went
to the network** — defeating the Phase 0 prewarming, which can only import a
chunk the network can deliver.

- `vite.config.ts` gains a `kora-precache-manifest` plugin emitting
  `dist/precache-manifest.json` from the real rollup bundle (so hashes can
  never drift from what shipped). Verified: 56 assets, all present on disk.
- `public/sw.js` gains `warmShellCache()`, run during `install`, which fetches
  the manifest and caches every listed asset.
- Excluded from precache: `vendor-scraper`, `vendor-docs`, `BookReaderPDF` —
  reachable only behind an explicit user action, so precaching them would waste
  first-run data. Total precache: **3.14 MB**, of which 2.0 MB is the entry
  chunk needed to boot regardless.
- Cache version bumped `v6 → v7` so existing installs actually refill.
- Failure modes exercised against the real manifest (404, empty, malformed,
  offline throw): all degrade to 0 cached assets **without throwing**, so a bad
  manifest can never block SW install.

## Phase 4b — Bundle discipline

Current `vite.config.ts` deliberately does **not** split React/Firebase
(cross-chunk TDZ caused white screens — see the comment there). Keep that.
Safe wins only:

- Keep `vendor-scraper` / `vendor-docs` Worker-only splits as-is.
- Audit `lucide-react` imports — ensure named imports only (tree-shaken); no
  `import * as Icons`.
- ~~Move `pdfjs-dist` to a lazy `import()`~~ — **already done**: `BookReaderPDF`
  is a `React.lazy` route, so pdfjs is a separate 372 KB chunk off the boot path.
- `lucide-react` audited: 56 named-import sites, zero `import * as` — already
  tree-shaken.
- Keep `cssCodeSplit:false` and `crossOrigin:false` — both are APK white-screen
  guards, not perf knobs.

## Phase 5 — Offscreen work off the main thread

- `src/workers/sync.worker.ts` for RSS parsing, search indexing, and Firestore
  sync batching.
- Keeps scroll/touch at 60 FPS during a feed refresh.

---

## Verification for every phase

- `bun run lint` and `bun run build` clean.
- APK smoke: install, airplane-mode, confirm Library/Discover/Feed/Tools all
  open with no white screen and dictionary lookup still resolves.
- Measure: cold start to interactive, and tab-switch latency before/after
  (Chrome DevTools remote-debugging the WebView).

## Risks

- **More resident DOM** from prewarming can hurt low-RAM devices — hence the
  device gating in Phase 0. Revisit thresholds with real device data.
- **Bigger APK** from Phase 1: the dict bundle is ~2 MB pre-compression.
  Acceptable for offline-first; re-check against the Play Store size budget.
