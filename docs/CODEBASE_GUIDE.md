# Kora codebase guide

This guide describes the current application structure and the checks available in this repository. It replaces the old UX backlog, whose recommendations had become mixed with implemented behavior.

## Runtime entry points

- `src/main.tsx` mounts the React application and initializes browser and native integrations.
- `src/App.tsx` owns top-level navigation, app-wide state, library orchestration, and feature routing. Keep feature-specific data transforms and interaction state in the owning feature module.
- `server.ts` runs the local Node server. `worker.ts` is the Cloudflare Worker entry point. API changes that affect both deployments should be checked in both paths.
- `wrangler.toml` contains Worker bindings and environment configuration. Secrets belong in runtime configuration, never in Vite-exposed variables.

## Source layout

| Path | Responsibility |
|---|---|
| `src/components/` | Screens and user-facing feature components |
| `src/components/discover/` | Reusable Discover presentation components |
| `src/lib/` | Shared feature logic, parsing, API clients, validation, and state helpers |
| `src/lib/formats/` | File-format parsers and conversion helpers |
| `src/lib/sources/` | Catalog/source adapters and outbound delivery integrations |
| `src/hooks/` | Shared React lifecycle and device interaction hooks |
| `src/db/` | IndexedDB access for local content and metadata |
| `src/styles/` | Global styles and theme behavior |
| `docs/` | User-facing guides, deployment notes, and this map |

Large screens should be split by stable responsibility: view, data/API logic, and reusable subcomponents. Avoid moving code only to reduce line count if it remains coupled to the same screen state. Keep public interfaces small and preserve the existing feature owner as the place that composes them.

## Current feature boundaries

- **Reading:** `BookReaderEPUB.tsx` handles EPUB and Kindle MOBI/AZW3 content; `BookReaderPDF.tsx` owns PDF viewing; `BookReaderText.tsx` handles text-oriented files.
- **Library:** `LibraryManager.tsx` owns shelf presentation and local book actions; `src/db/` owns persistent file access.
- **Discover:** `DiscoverView.tsx` composes catalog search, book details, and edition actions. Shared request/category helpers live in `src/lib/discoverApi.ts` and `src/lib/discoverCategories.ts`.
- **News:** `FeedView.tsx` and the feed storage/location modules own feed selection, articles, and country-specific defaults.
- **Plugins:** the application integrates with the separate [Kora-Plugins registry](https://github.com/CHAOTIC-RAY/Kora-Plugins). Theme and source-plugin implementation belongs there when it is plugin-owned; app-level plugin loading and rendering belongs here.
- **Workshop:** game screens and demo surfaces live under `src/components/` with shared game rules in `src/lib/` where applicable.

Comic and manga source metadata may exist in plugin manifests, but the current Kora app does not expose an in-app comic reader. See the [feature guide](./features.html#comics) for supported formats and limits.

## Working in a large feature

1. Find the active route in `src/App.tsx` before editing an old component. A file that exists is not proof that the UI is reachable.
2. Search imports, lazy imports, dynamic imports, route conditions, and event-driven mounts before deleting code. Keep libraries and tests that still have active consumers.
3. Extract pure helpers first. Move React components only when their props clearly represent a reusable boundary.
4. Keep network, storage, and rendering responsibilities separate. Put source-specific request logic in a client/helper, not inside a card or modal's JSX.
5. Update README and feature/deployment docs in the same change when supported behavior changes.

## Local checks

```bash
pnpm lint
pnpm exec vite build
pnpm test:scrabble-scoring
```

`pnpm build` runs the data bundle, Vite build, and Node server bundle, and currently invokes `npm` internally. If npm is unavailable in the environment, run `pnpm run build:data`, `pnpm exec vite build`, and `pnpm exec esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs` separately.

Linting is a TypeScript no-emit check. The focused Scrabble script is the only test command declared in `package.json`; it is not a full browser or Android integration suite. External catalogs, Firebase configuration, offline behavior, and mobile gestures still need environment-specific verification.
