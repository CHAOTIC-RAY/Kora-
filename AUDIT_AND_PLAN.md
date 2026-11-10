# Kora Application Audit & Remediation Plan

**Date:** 2026-11-10  
**Auditor:** Cursor Cloud Agent (investigation only — no application code changed)  
**Repository:** [CHAOTIC-RAY/Kora-](https://github.com/CHAOTIC-RAY/Kora-)  
**Local run:** `npm install` → `npm run build` → `npm run dev` → `http://127.0.0.1:5000`  
**Production reference:** `https://kora.chaoticstudio.workers.dev` (`wrangler.toml`, `workers_dev = true`)

---

## Executive summary

Kora is a large React 19 + TypeScript PWA with a **dual backend** (Node `server.ts` for local dev, Cloudflare Worker `src/worker.ts` for production), Capacitor Android packaging, Firebase metadata sync, and a plugin registry for community sources. Core flows **work in the browser**: navigation, Discover search (Google Books metadata + shadow-library results via the Anna’s/Rave engine), Plugin Hub install/remove, Settings, Workshop tiles, news feed, and mobile layout at 375px.

**Top risks to address first:**

| Priority | Issue | Severity |
|----------|--------|----------|
| 1 | **`/api/source-fetch` missing** — all registry **source** plugins return zero results (404 on prod + `wrangler dev`; dev server serves SPA HTML) | **Critical** |
| 2 | **Unit test suite not green** (4 files / 2 assertion failures + 2 Node crashes) | High |
| 3 | **Library series grouping merges same-series books from different plugin sources** | High |
| 4 | **Firestore rules: open P2P/game rooms + loose `publicBooks` writes** | High |
| 5 | **`@capacitor/android@8.4.2` below patched range** (GHSA-rvm3-566m-v7fv) | Critical (Android) |
| 6 | **Built-in Discover search** (Google / Rave stream) works on Node dev; **Worker Google Books can 429** on shared quota | Medium |
| 7 | **No automated CI** for plugins or `run-all-tests.mjs` | Medium |
| 8 | **Main JS chunk ~1.94 MB** — cold-load performance | Medium |
| 9 | **Unsanitized `dangerouslySetInnerHTML`** in news/Wikipedia/community surfaces | Medium |
| 10 | **`server.ts` vs `worker.ts` drift** (~4.9k vs ~4.2k lines) | Medium (long-term) |

Screenshots: general audit (`kora-discover-search-dune.png`, etc.) plus plugin lifecycle (`kora-plugins-discover-hub.png`, `kora-plugin-gutenberg-lifecycle.png`, `kora-plugin-theme-copper.png`, `kora-plugin-shadow-opt-in.png`). Machine-readable plugin harness output: `/opt/cursor/artifacts/plugin-audit-results.json`.

---

## 1. Codebase structure

### 1.1 Layout

| Area | Role |
|------|------|
| `src/App.tsx` | Root orchestration (~4k LOC) — routing, feature flags, global state |
| `src/components/` | Feature UI (Discover, Library, readers, Workshop, Settings, Plugin Hub) |
| `src/lib/` | Business logic, API clients, games, plugins, guards (`ssrfGuard.ts`) |
| `src/db/` | IndexedDB helpers (local book bytes) |
| `src/worker.ts` | Cloudflare Worker API + static asset fallback |
| `server.ts` | Express-compatible dev/prod Node server (mirrors many Worker routes) |
| `wrangler.toml` | Worker name `kora`, SPA assets in `dist/`, R2 `RELAY_BUCKET`, Browser binding |
| `scripts/run-all-tests.mjs` | Glob-based test runner (not wired into `npm test`) |
| `firebase-applet-config.json` | Client Firebase config (committed) |
| `public/data/dict/` | Sharded dictionary built by `npm run build:data` |

### 1.2 Deployment (Cloudflare Workers)

From `wrangler.toml`:

- **Entry:** `src/worker.ts`
- **Static:** `dist/` with SPA `not_found_handling`
- **Worker-first routes:** `/api/*`, `/send`
- **Environments:** `production` (`kora`), `beta` (`kora-beta`)
- **Bindings:** R2 relay bucket, Browser (Puppeteer), optional secrets (`GOOGLE_BOOKS_API_KEY`, `NYT_*`, `RAVE_BOOK_SEARCH_API_KEY`, `GEMINI_API_KEY`, etc. — see `src/worker.ts` `Env` interface)

Build pipeline: `npm run build:prod` → Vite client + `esbuild` bundle of `server.ts` → `dist/` consumed by Wrangler.

### 1.3 Major features (mapped to code)

| Feature | Primary locations |
|---------|-------------------|
| **Discover / search** | `DiscoverView.tsx`, `searchClient.ts`, `/api/search/stream`, `/api/google-books/search`, Rave/Anna’s paths in `server.ts` / `worker.ts` |
| **Google Books** | `server.ts` ~4674+, `bookRating.ts` |
| **Rave / direct links** | Rave upstream in `server.ts` (~1073+), `DiscoverView.tsx` mirror sorting, `bookIdentity.ts`, `raveDownloadOptions` |
| **Plugin Hub** | `SourcePluginsHub.tsx` → `PluginBrowser.tsx`, `lib/sources/store.ts` |
| **Library / readers** | `LibraryManager`, `BookReaderEPUB`, comic/PDF/text paths |
| **News** | `FeedView`, `feedServer.ts`, `/api/feed/fetch` |
| **Workshop / P2P games** | Uno/Scrabble + Firestore signaling |

Plugins are **JSON data only** (no arbitrary code execution); fetches go through Worker relay per `store.ts` comments.

---

## 2. Build, lint, and automated tests

### 2.1 Commands run

| Command | Result |
|---------|--------|
| `npm install` | Success (820 packages; **52 npm audit** findings: 2 critical, 33 high, 17 moderate) |
| `npm run build` | Success with Vite chunk-size warnings; main chunk **1,937 KB** minified |
| `npm run lint` (`tsc --noEmit`) | **Pass** |
| `node scripts/run-all-tests.mjs` | **Fail** — 61 files, **3302 pass, 2 fail**, **4 problematic files** |

There is **no ESLint** script and **no `npm test`** entry in `package.json`. GitHub Actions build APK/docs but **do not run** `run-all-tests.mjs`.

### 2.2 Test failures (detail)

#### A. `src/lib/__tests__/gamePresets.test.ts` — 1 failing assertion

- **Test:** “a whitespace-only stored name still yields a usable label” (lines 412–413)
- **Expected:** `Unknown game`
- **Actual:** `Settlers of Catan` (preset name from `gameId: "catan"`)
- **Cause:** `resolveMatchGame` in `src/lib/gamePresets.ts:683–694` treats whitespace-only `gameName` as empty but still resolves a live preset by `gameId`, ignoring the intent that blank stored names should degrade.

#### B. `src/lib/__tests__/libraryGrouping.test.ts` — 1 failing assertion

- **Test:** “different sources with the same series name stay apart” (lines 107–118)
- **Expected:** 2 book tiles (`MangaDex` vs `Mangakat`)
- **Actual:** 1 series tile (merged)
- **Cause:** `buildLibraryGroups` in `src/lib/seriesHelper.ts:212–232` keys only by normalized **series title**, not **`book.source`**. Two “Solo Leveling Vol. 1” entries become one 2-volume series group.

#### C. `src/lib/__tests__/pluginImage.test.ts` — crash (0 tests counted)

- **Error:** `TypeError: Cannot read properties of undefined (reading 'VITE_API_BASE_URL')` at `capacitorNative.ts:27` via `resolvePluginImageSrc`.
- **Cause:** Tests run under plain Node without Vite’s `import.meta.env` shim.

#### D. `src/lib/__tests__/preloadRouting.test.ts` — same crash as (C).

---

## 3. Manual / browser testing

### 3.1 Environment

- Dev server: `tsx server.ts` on **port 5000**
- Exercised: Lounge, Library, Discover (+ search “Dune Frank Herbert”), book detail modal, Plugin Hub (install/remove Project Gutenberg), Settings, Workshop, Read/Feed, **375px** viewport

### 3.2 API spot checks (terminal)

| Endpoint | Result |
|----------|--------|
| `GET /api/google-books/search?q=dune` | 200 — volumes with Open Library cover URLs |
| `GET /api/search/stream?q=dune` | NDJSON chunks `google` + `annas` (LibGen/Rave-backed editions) |
| `GET /api/nytimes/overview` | **500** — `NYT API Key not configured` (no `.env` secrets in audit VM) |

### 3.3 UI outcomes

| Flow | Result |
|------|--------|
| Navigation | OK across main tabs |
| Discover search | OK — Google + Libgen mirrors; detail modal with download options |
| Plugin Hub | OK — install/remove + toasts |
| Settings | OK — themes, storage, sync, WebDAV, diagnostics |
| News feed | Loads content; **console errors** for NYT overview (500) and some feed/cover fetches |
| Mobile 375px | Layout usable; screenshots captured |

**Note:** Some console lines in the saved notes show corrupted paths (`/SBN/api/...`); verified actual requests are `/api/nytimes/overview`, `/api/feed/fetch`, etc.

### 3.4 Screenshots (artifacts)

| File | Description |
|------|-------------|
| `kora-home-desktop.png` | Lounge / home |
| `kora-library-desktop.png` | Empty library |
| `kora-discover-desktop.png` | Discover shelves |
| `kora-discover-search-dune.png` | Search results |
| `kora-book-detail-dune.png` | Book detail modal |
| `kora-plugin-hub.png` / `kora-plugin-installed.png` | Plugin Hub |
| `kora-settings-desktop.png` | Settings |
| `kora-workshop-desktop.png` | Workshop |
| `kora-read-feed-desktop.png` | News feed |
| `kora-mobile-375-feed.png` / `kora-mobile-375-general.png` | Mobile |

---

## 4. Issue register (prioritized)

Severity: **Critical** = exploit/data loss/production down; **High** = wrong behavior or blocked release quality; **Medium** = UX/security hardening; **Low** = polish/debt.

### 4.1 Critical

| ID | Severity | Category | Summary | Location | Reproduction |
|----|----------|----------|---------|----------|--------------|
| SEC-01 | Critical | Security (Android) | `@capacitor/android@8.4.2` in vulnerable range **< 8.4.3** (GHSA-rvm3-566m-v7fv — remote content via internal HTTP proxy) | `package.json` L33, lockfile | `npm audit` / `npm ls @capacitor/android` → 8.4.2 |
| PLUG-01 | **Critical** | Plugins | **`/api/source-fetch` not implemented** in `src/worker.ts` or `server.ts`; client always calls it (`client.ts:48`) | `src/lib/sources/client.ts`, `docs/architecture.html` | `curl …/api/source-fetch?u=…` → **404** prod and `wrangler dev`; `:5000` → **SPA HTML** |
| PLUG-02 | High | Plugins | Registry source search silently empty (defensive client returns `[]`, no user-visible error) | `client.ts:228–229`, `SourceBrowseView.tsx:38–40` | Install Gutenberg → browse/search → empty grid |
| PLUG-03 | Medium | Plugins / UX | Shadow sources install **without blocking opt-in modal** (warning text only) | `PluginBrowser.tsx`, `store.ts:426–429` | Install MangaReadOrg from Restricted list |
| PLUG-04 | Medium | UX | Cover / `cover-redirect` 404 noise during Discover (unrelated to plugins but masks diagnosis) | Worker `cover-redirect` route, console in browser | Open Discover with feeds enabled |

### 4.2 High

| ID | Severity | Category | Summary | Location | Reproduction |
|----|----------|----------|---------|----------|--------------|
| TEST-01 | High | Tests | Suite red: `gamePresets` whitespace label | `gamePresets.ts:683–694`, test L412–413 | `node scripts/run-all-tests.mjs` |
| TEST-02 | High | Tests | Suite red: library grouping by source | `seriesHelper.ts:224–232`, test L107–118 | Same |
| TEST-03 | High | Tests | `pluginImage` / `preloadRouting` crash in Node | `capacitorNative.ts:27`, tests import chain | Same |
| LIB-01 | High | Functional | Same series name from **different sources** collapses to one series tile (hides a book) | `seriesHelper.ts` grouping key | Add two “Vol. 1” manga from two plugins → one grouped tile |
| SEC-02 | High | Security | Firestore **P2P/game rooms** (`blipRooms`, `p2pRooms`, `battleRooms`, `scrabbleRooms`, `unoRooms`) allow **unauthenticated** read/write with weak room-id rules | `firestore.rules` L9–64 | Any client can read/write arbitrary room IDs (6-digit Scrabble/battle brute-force) |
| SEC-03 | High | Security | `publicBooks/{bookId}` **write: any authenticated user** (not owner-scoped) | `firestore.rules` L83–86 | Auth as user A, `setDoc` on B’s public book id |
| CI-01 | High | Process | No CI gate for unit tests; `npm test` undefined | `package.json`, `.github/workflows/*` | Clone repo, run tests only manually |

### 4.3 Medium

| ID | Severity | Category | Summary | Location | Reproduction |
|----|----------|----------|---------|----------|--------------|
| PERF-01 | Medium | Performance | Main bundle **~1.94 MB** minified; Discover/Create chunks **~510 / 486 KB** | Vite build output, `vite.config` | Production build + Lighthouse |
| DEP-01 | Medium | Dependencies | **52** transitive npm audit issues (Firebase, crawlee, puppeteer chain, etc.) | `npm audit` | `npm audit` |
| API-01 | Medium | Runtime | Missing `NYT_*` keys → **500** on `/api/nytimes/overview` (console noise) | `server.ts:1656–1664`, `DiscoverView.tsx:959` | Local dev without `.env` |
| XSS-01 | Medium | Security | Wikipedia snippets / article HTML without DOMPurify | `WikipediaWidget.tsx:536,737` | Malicious Wikipedia snippet in search API response |
| XSS-02 | Medium | Security | Hardcover reviews rendered raw HTML | `HardcoverCommunity.tsx:256` | Hostile review body from API |
| XSS-03 | Medium | Security | Feed article body: DOM cleanup only, no sanitizer | `FeedArticleReader.tsx:486`, `feedArticle.ts:214–235` | RSS HTML with `<script>` / event handlers |
| A11Y-01 | Medium | Accessibility | `maximum-scale=1` disables pinch-zoom | `index.html` L11 | WCAG 1.4.4 / 1.4.10 — **Owner decision (2026-11-10): pinch zoom intentionally disabled app-wide** (`maximum-scale=1` restored on `main` after a brief Phase 3.3 experiment; no `user-scalable=no` in the original meta). |
| ARCH-01 | Medium | Maintainability | Duplicate API logic **`server.ts` (~4934 LOC) vs `worker.ts` (~4155 LOC)** | both files | Add route in one, forget the other |
| CORS-01 | Medium | Security | OPTIONS response sets `Allow-Origin: *` **and** `Allow-Credentials: true` | `worker.ts:521–528` | Browser CORS preflight on Worker |
| GAME-01 | Medium | Functional | `resolveMatchGame` ignores whitespace-only `gameName` when `gameId` valid (user-visible mislabel risk in tracker) | `gamePresets.ts:684` | Save match with blank custom name |
| DH-01 | Medium | Dead code | `OnlineScrabbleGame.tsx.bak` committed | `src/components/` | Search `*.bak` |
| DOC-01 | Medium | Docs debt | `store.ts` comment claims Kora-Plugins URL “NOT yet live” but URL **returns 200** (2026-11-10) | `store.ts` L40–44 | `curl` raw index.json |

### 4.4 Low

| ID | Severity | Category | Summary | Location |
|----|----------|----------|---------|----------|
| UX-01 | Low | UX | Discover comment typo `havingrave` | `DiscoverView.tsx:3042` |
| LINT-01 | Low | Quality | No ESLint — only `tsc --noEmit` | `package.json` |
| SEC-04 | Low | Security | Firebase **client API key** in repo (expected for Firebase; depends on rules + App Check) | `firebase-applet-config.json` |
| FEED-01 | Low | Runtime | Feed cover / refresh 404s in console during audit (external RSS/proxy) | Feed UI, console notes |
| VITE-01 | Low | Build | libarchive-wasm `fs`/`crypto` externalized warnings | Vite build log |

### 4.5 Security notes (positive)

- **`ssrfGuard.ts`** documents layered SSRF protection for proxy/mirror endpoints (shared module).
- **Plugin model** is declarative JSON; network egress funnels through Worker relay (`lib/sources/client.ts`, `store.ts`).
- **Relay handler tests** assert minimal `innerHTML` use (`relay/__tests__/handler.test.ts`).
- **`dompurify`** used in some surfaces (e.g. `FeedTikTokScroll.tsx:811`) but not uniformly.

---

## 5. Remediation plan (phased)

Effort: **S** ≈ 0.5–1 day, **M** ≈ 1–3 days, **L** ≈ 3–7 days (engineering time, one developer familiar with the repo).

### Phase 0 — Stop the bleeding (S–M, no dependencies)

| # | Task | Effort | Issues | Deps |
|---|------|--------|--------|------|
| 0.1 | Bump `@capacitor/android` (and aligned `@capacitor/*`) to **≥ 8.4.3**; rebuild APK | S | SEC-01 | — |
| 0.2 | Add `npm test` → `node scripts/run-all-tests.mjs` | S | CI-01 | — |
| 0.3 | GitHub Action: `npm ci && npm run lint && npm test` on PR/push | S | CI-01 | 0.2 |
| 0.4 | Fix `import.meta.env` in Node tests (test bootstrap or guard in `getApiBaseUrl`) | S | TEST-03 | — |
| 0.5 | Fix `resolveMatchGame` whitespace `gameName` behavior **or** align test if product intent changed | S | TEST-01, GAME-01 | — |
| 0.6 | Include `source` (or `sourcePluginId`) in library group key when volumes share series name | M | TEST-02, LIB-01 | — |
| **0.7** | **Restore `/api/source-fetch`** (JSON relay + SSRF guard, shared by Worker and Node) and wire `scripts/verify-registry-readable.mts` in CI | **L** | **PLUG-01, PLUG-02** | ssrfGuard |
| 0.8 | Surface relay failures in UI (toast when search returns 0 due to HTTP error, not empty catalog) | M | PLUG-02 | 0.7 |
| 0.9 | Re-run `plugin-audit-results.json` harness after 0.7; gate release on ≥1 hit per legal source | S | — | 0.7 |

**Suggested order:** **0.7** → 0.1 → 0.2 → 0.4 → 0.5 → 0.6 → 0.8 → 0.9 → 0.3

### Phase 1 — Security & data integrity (M–L)

| # | Task | Effort | Issues | Deps |
|---|------|--------|--------|------|
| 1.1 | Tighten Firestore rules: require `request.auth` for game/P2P rooms; optional membership claims | L | SEC-02 | Firebase deploy |
| 1.2 | Scope `publicBooks` / `communityBooks` writes to `authorId == auth.uid` | M | SEC-03 | 1.1 |
| 1.3 | Roll DOMPurify (or strip tags) on Wikipedia, Hardcover, feed reader HTML paths | M | XSS-01–03 | — |
| 1.4 | Fix Worker CORS preflight: echo specific origin or drop credentials flag with `*` | S | CORS-01 | — |
| 1.5 | `npm audit` remediation plan (prioritize direct deps: Firebase, crawlee, puppeteer) | M | DEP-01 | — |

**Suggested order:** 1.1 → 1.2 → 1.3 → 1.4 → 1.5

### Phase 2 — Runtime quality & self-hosting (M)

| # | Task | Effort | Issues | Deps |
|---|------|--------|--------|------|
| 2.1 | NYT routes: return **200 + empty payload** or `503` with structured `{ configured: false }` instead of 500 when keys missing | S | API-01 | — |
| 2.2 | Align Discover UI to treat missing NYT as non-error (reduce Sentry/console noise) | S | API-01 | 2.1 |
| 2.3 | Document required Worker secrets in README/self-hosting (NYT, Google Books, Rave key) | S | API-01 | — |
| 2.4 | Remove `OnlineScrabbleGame.tsx.bak` | S | DH-01 | — |
| 2.5 | Fix typo `havingrave` | S | UX-01 | — |

### Phase 3 — Performance & architecture (L)

| # | Task | Effort | Issues | Deps |
|---|------|--------|--------|------|
| 3.1 | Route-level code splitting for Discover/Create/Settings (reduce initial `index-*.js`) | L | PERF-01 | — |
| 3.2 | Extract shared API router used by **both** `server.ts` and `worker.ts` | L | ARCH-01 | — |
| 3.3 | ~~Revisit `maximum-scale=1`~~ — **cancelled by owner**: keep global pinch-zoom lock | — | A11Y-01 | — |
| 3.4 | Add ESLint + incremental strict rules | M | LINT-01 | — |

### Phase 4 — Verification & monitoring (M)

| # | Task | Effort | Issues | Deps |
|---|------|--------|--------|------|
| 4.1 | Playwright/Cypress smoke: Discover search, Plugin install, Settings open | M | — | 0.3 |
| 4.2 | Production synthetic checks: `/api/search/health`, `google-books`, **`/api/source-fetch`**, Worker secrets present | S | PLUG-01 | 0.7 |
| 4.3 | Update stale comments (`store.ts` registry URL note) | S | DOC-01 | — |
| 4.4 | Plugin Hub E2E: install Gutenberg + theme + one Madara source; assert non-zero `createSourceClient.search` | M | — | 0.7, 4.1 |

---

## 6. Dependency on Cloudflare / third parties

| Integration | Config | Audit note |
|-------------|--------|------------|
| **Workers** | `wrangler.toml`, `npm run deploy:prod` | SPA + API split clear; R2/Browser bindings required for full feature set |
| **Rave / Anna’s** | Worker relay, `RAVE_BOOK_SEARCH_API_KEY` optional | Search stream label `annas` carries LibGen/Rave results; direct links exercised in UI |
| **Google Books** | `/api/google-books/search` | Works without client key (Open Library covers in sample response) |
| **NYT Books** | `NYT_BOOKS_API_KEY` / `NYT_API_KEY` | Fails closed with 500 locally without secrets |
| **Firebase** | `firebase-applet-config.json` | Rules need hardening for ephemeral multiplayer (see SEC-02/03) |
| **Plugin registry** | `DEFAULT_REPO` → Kora-Plugins `index.json` | HTTP 200 as of audit date |

---

## 7. Suggested execution order (rollup)

1. **Week-equivalent 0:** Phase 0 — **restore `source-fetch` first**, then green tests, CI, Capacitor CVE, library grouping fix.  
2. **Next:** Phase 1 security (Firestore + HTML sanitization).  
3. **Then:** Phase 2 operational polish (NYT behavior, housekeeping).  
4. **Parallel track:** Phase 3 performance/architecture as capacity allows.  
5. **Close loop:** Phase 4 automated smoke in CI.

---

## 8. Plugin test results (follow-up)

**Scope:** Investigation only (no app code changed). Environments: `npm run dev` (`:5000`), `npx wrangler dev` (`:8787`), production Worker `https://kora.chaoticstudio.workers.dev`. Search queries: *Pride and Prejudice*, *Project Hail Mary*, *xyzzyqqqnotabook* (no full book downloads).

### 8.1 Registries and URLs in code

| Registry / source | URL / constant | Role |
|-------------------|----------------|------|
| **Default plugin registry** | `DEFAULT_REPO` → `https://raw.githubusercontent.com/CHAOTIC-RAY/Kora-Plugins/main/index.json` | Plugin Hub catalog (`store.ts:46`) |
| **Legacy registry (purged on read)** | `LEGACY_DEFAULT_REPO` → `…/Kora-Sources/main/index.json` | Migrated users (`store.ts:49`, `RETIRED_REPOS`) |
| **Retired test registry** | `/data/test-registry.json` | Stripped via `RETIRED_REPOS` (`store.ts:206–208`) |
| **Custom repos** | User-supplied HTTPS `index.json` via Plugin Hub “Add repo” | `addRepo()` — self-trusted (`types.ts:49–50`) |
| **Built-in Discover engines** (not JSON plugins) | `/api/search/stream`, `/api/google-books/search`, `shadowSources.ts`, Goodreads/NYT routes in `worker.ts` / `server.ts` | Unified ebook search; Rave/Libgen/Anna’s pipeline |
| **Plugin network relay (required)** | `/api/source-fetch` | **Documented** (`client.ts:4–5`, `docs/architecture.html`) — **not present in Worker or Node in this tree** |

The shipped registry contains **16 extensions / 16 plugin entries** (verified 2026-11-10). There are **no bundled source JSON files** inside the Kora app repo; definitions live on GitHub (`Kora-Plugins`). `sources-readable.json` in the app repo is a **frozen readability report** from `scripts/verify-registry-readable.mts`, not a second registry.

### 8.2 Catalog enumeration (all registry plugins)

| ID | Name | Category | Gated (piracy) | Registry `readable` | Definition URL |
|----|------|----------|----------------|---------------------|----------------|
| `kora-book-oceanofepub` | Ocean of EPUB | source | yes | **false** (by design: links only) | `sources/books/oceanofepub.json` |
| `kora-integration-calibre` | Calibre | integration | no | n/a | `sources/integrations/calibre.json` |
| `kora-integration-croc` | croc | integration | no | n/a | `sources/integrations/croc.json` |
| `kora-integration-kindle` | Send to Kobo/Kindle | integration | no | n/a | `sources/integrations/send-to-kindle.json` |
| `kora-legal-gutenberg` | Project Gutenberg | source | no | default | `sources/legal/gutenberg.json` |
| `kora-legal-internet-archive` | Internet Archive (Texts) | source | no | default | `sources/legal/internet-archive.json` |
| `kora-book-libretexts-chem` | LibreTexts Chemistry | source | no | default | `sources/legal/libretexts-chem.json` |
| `4503604002548978580` | MangaReadOrg | source | yes | default | `sources/manga/mangaread-org.json` |
| `4503604003186470944` | MangaZin | source | yes | default | `sources/manga/mangazin.json` |
| `kora-manga-manhuahot` | ManhwaHot | source | yes | default | `sources/manga/manhuahot.json` |
| `4503604002226619223` | ManhuaPlus | source | yes | default | `sources/manga/manhuaplus.json` |
| `4503604002575350979` | Manhuaus | source | yes | default | `sources/manga/manhuaus.json` |
| `kora-manga-s2read` | S2Read | source | yes | default | `sources/manga/s2read.json` |
| `kora-theme-copper-night` | Copper Night | theme | no | n/a | `sources/themes/copper-night.json` |
| `kora-theme-cyberui-operator` | CyberUI // Operator | theme | no | n/a | `sources/themes/cyberui-operator.json` |
| `kora-theme-mint-terminal` | Mint Terminal | theme | no | n/a | `sources/themes/mint-terminal.json` |

Built-in **Discover** search (always on, no install): Google Books metadata stream, Anna’s/Libgen/Rave shadow search (`annas` NDJSON chunk), Goodreads shelves, optional NYT (keys), audiobook streams — see §1.3 and `/api/search/stream`.

### 8.3 Install / enable / disable / uninstall (UI)

| Plugin type | Install | Enable | Disable | Uninstall | Observed |
|-------------|---------|--------|---------|-----------|----------|
| **Source** (e.g. Gutenberg) | Hub → INSTALL | Appears in Discover **FILTERS** chip when installed; piracy sources need **opt-in** (`setSourceOptIn`, `store.ts:332`) | Remove chip / uninstall | REMOVE + toast | **Lifecycle OK**; search/browse **empty** (relay) |
| **Shadow source** (MangaReadOrg) | INSTALL from Restricted section | Same | Uninstall | REMOVE | **Lifecycle OK**; no blocking opt-in modal; **search “solo” → no manga rows** |
| **Theme** (Copper Night) | INSTALL | Auto-**APPLY** on install | Apply another theme / built-in skin | REMOVE reverts UI | **Works** — immediate visual change (screenshot) |
| **Integration** (Calibre, croc, Kindle) | INSTALL | Workshop bento tile + Settings panel | Uninstall extension | REMOVE | **Partial** — needs user server/credentials; not search-tested |

“Disable” for sources is effectively **uninstall** or **withhold piracy opt-in**; there is no separate paused flag beyond removal from `localStorage` (`kora.sourcePlugins.v1` / `kora.plugins.v1`).

### 8.4 Per-plugin runtime status (search + metadata)

Status key: **works** / **partially works** / **broken** / **blocked by network or keys**.

Harness: `createSourceClient` + patched `fetch` to production/local Worker (`plugin-audit-results.json`). Pride / Hail Mary / nonsense queries — result **counts** only (no downloads).

| Name | Status | Pride & Prejudice | Project Hail Mary | Nonsense query | Root-cause hypothesis (files) |
|------|--------|-------------------|-------------------|----------------|------------------------------|
| **Built-in Google Books** (Discover) | **works** on `:5000` dev | metadata + covers | metadata | empty/irrelevant | `server.ts` `/api/google-books/search`; Open Library fallback when no API key |
| **Built-in Rave/Anna’s** (Discover stream) | **works** on dev | Libgen rows + direct URLs | rows | junk rows | `server.ts` `/api/search/stream`, `shadowSources.ts` |
| **Built-in Google Books** (Worker) | **blocked** (audit window) | 429 quota | 429 | 429 | Shared Books API consumer `project_number:624717413613` on Worker path |
| Ocean of EPUB | **broken** (would be **partial** when relay works) | 0 | 0 | 0 | Missing relay; registry marks `readable: false` (`oceanofepub.json`, hub note) |
| Calibre | **partially works** | n/a | n/a | n/a | Integration only — `calibreClient.ts`, user Content Server |
| croc | **partially works** | n/a | n/a | n/a | `lib/croc/client.ts`, device transfer |
| Send to Kobo/Kindle | **partially works** | n/a | n/a | n/a | `koboKindleSender.ts` |
| Project Gutenberg | **broken** | 0 | 0 | 0 | **`/api/source-fetch` 404** — JSON client never gets Gutendex body (`client.ts:240–247`) |
| Internet Archive (Texts) | **broken** | 0 | 0 | 0 | Same missing relay |
| LibreTexts Chemistry | **broken** | 0 | 0 | 0 | Same missing relay |
| MangaReadOrg | **broken** | 0 | 0 | 0 | Madara engine OK in unit tests; **relay missing** at runtime |
| MangaZin | **broken** | 0 | 0 | 0 | Same |
| ManhwaHot | **broken** | 0 | 0 | 0 | Same |
| ManhuaPlus | **broken** | 0 | 0 | 0 | Same |
| Manhuaus | **broken** | 0 | 0 | 0 | Same |
| S2Read | **broken** | 0 | 0 | 0 | Same |
| Copper Night | **works** | n/a | n/a | n/a | Tokens validate (`themeRuntime.ts`); UI apply verified |
| CyberUI // Operator | **works** | n/a | n/a | n/a | Manifest + optional `styleUrl` |
| Mint Terminal | **works** | n/a | n/a | n/a | Manifest |

**Relay verification (all environments tested):**

```text
GET https://kora.chaoticstudio.workers.dev/api/source-fetch?u=…  → 404 Not Found
GET http://127.0.0.1:8787/api/source-fetch?u=…                   → 404 Not Found
GET http://127.0.0.1:5000/api/source-fetch?u=…                     → 200 text/html (Vite SPA, not JSON)
```

Grep of `src/worker.ts` and `server.ts` shows **no route handler** for `source-fetch` despite architecture docs and `scripts/verify-registry-readable.mts` assuming production provides it (`verify-registry-readable.mts:64`).

### 8.5 Plugin-specific issues (new / updated)

| ID | Severity | Summary |
|----|----------|---------|
| PLUG-01 | Critical | Missing `/api/source-fetch` breaks **all** registry source plugins |
| PLUG-02 | High | Silent empty search — no distinction between “no hits” and “relay down” |
| PLUG-03 | Medium | Shadow source opt-in is informational, not gated at install time |
| PLUG-04 | Medium | `cover-redirect` / feed cover 404s clutter console during plugin testing |
| PLUG-05 | Low | Hub UI during prior audit listed LibriVox; **not** in current `index.json` (registry drift vs screenshots) |

### 8.6 Evidence artifacts

| Artifact | Description |
|----------|-------------|
| `kora-plugins-discover-hub.png` | Full Plugin Hub |
| `kora-plugin-gutenberg-lifecycle.png` | Gutenberg installed (REMOVE visible) |
| `kora-plugin-theme-copper.png` | Copper Night applied |
| `kora-plugin-shadow-opt-in.png` | Restricted / shadow library section |
| `plugin-audit-results.json` | Automated per-plugin search counts |
| `PLUGIN-LIFECYCLE-REPORT.md` | UI lifecycle narrative (computer-use) |

### 8.7 Folded into remediation plan

See **Phase 0.7–0.9** (restore relay, UI errors, CI plugin smoke) and **Phase 4.2 / 4.4** (synthetic `source-fetch` + Hub E2E).

---

## 9. Appendix — commands for reproducing this audit

```bash
git clone https://github.com/CHAOTIC-RAY/Kora-.git
cd Kora-
npm install
npm run build
npm run lint
node scripts/run-all-tests.mjs
npm run dev   # http://127.0.0.1:5000
```

```bash
curl -sS "http://127.0.0.1:5000/api/google-books/search?q=dune&maxResults=3"
curl -sS "http://127.0.0.1:5000/api/search/stream?q=dune&page=1"
curl -sS "http://127.0.0.1:5000/api/nytimes/overview"
curl -sS -o /dev/null -w "%{http_code}\n" "https://kora.chaoticstudio.workers.dev/api/source-fetch?u=https%3A%2F%2Fexample.com"
node /opt/cursor/artifacts/plugin-audit-runner.mjs   # writes plugin-audit-results.json
```

---

*End of audit document.*
