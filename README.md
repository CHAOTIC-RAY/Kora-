<div align="center">

  <a href="./public/kora-banner-v3.mp4"><img src="./public/kora-banner-preview.gif" alt="Kora banner animation" width="100%" /></a>

  # Kora

  **Your bookshelf, narrator, and morning paper. All in one place.**

  [![License: MIT](https://img.shields.io/badge/License-MIT-2D2D2D?style=flat-square)](./LICENSE)
  ![React 19](https://img.shields.io/badge/React-19-27272A?style=flat-square&logo=react)
  ![TypeScript](https://img.shields.io/badge/TypeScript-5-27272A?style=flat-square&logo=typescript)
  ![Vite](https://img.shields.io/badge/Vite-6-27272A?style=flat-square&logo=vite)
  ![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-27272A?style=flat-square&logo=cloudflare)

  A reading and content workspace for ebooks, audiobooks, news, discovery, plugins, and word games.

  [Live app](https://kora.chaoticstudio.workers.dev) · [Documentation](https://chaotic-ray.github.io/Kora-/) · [Report a bug](https://github.com/CHAOTIC-RAY/Kora-/issues) · [Discussions](https://github.com/CHAOTIC-RAY/Kora-/discussions)

</div>

---

## What Kora does

Kora brings reading, listening, discovery, and lightweight games into one interface. The browser app is designed to work as an installable PWA; the Android application packages the same web experience with Capacitor native integrations.

| Area | Capabilities |
|---|---|
| **Reading** | EPUB, MOBI, AZW3, PDF, and text readers; reading progress; bookmarks, highlights, annotations, typography controls, themes, and in-book search where supported |
| **PDF workflow** | Dedicated PDF reader and PDF-to-EPUB conversion workflow when text extraction is possible; scanned/image-only PDFs may require OCR and may not convert cleanly |
| **Library** | Local book files in IndexedDB, metadata, progress tracking, and optional cloud metadata sync |
| **Discover** | Book metadata and covers, catalog search, duplicate reduction, book details, editions/mirrors, and source-dependent download options |
| **Audiobooks** | Track playback, seek controls, speed, sleep and smart-skip features where supported, playback progress, minimized player, and browser text-to-speech tracks |
| **News** | RSS feeds, article reading, feed management, and reading status |
| **Comics and manga** | Community plugin metadata can describe manga sources, but this app build does not currently include an in-app comic reader |
| **Workshop games** | Chess against the Kora CPU or pass-and-play, Scrabble, Uno, Crossword, Word Search, and Linguist Guardian |
| **Plugins** | Community source definitions, integrations, tools, and themes through the separate plugin registry |
| **Sync and transfer** | Firebase Authentication/Firestore for supported user metadata; device-local book bytes; available peer-to-peer or WebDAV transfer flows |
| **Installability** | PWA, Android package, service-worker caching, and offline access to content already stored locally |

Feature availability depends on the source, the media format, network conditions, browser capabilities, and optional services configured for a deployment. Kora does not guarantee that every catalog item has a working file or playable audio stream.

## Quick start

### Use Kora

- Open the [live application](https://kora.chaoticstudio.workers.dev).
- Install it from your browser if the PWA install option is available.
- For Android, see the [APK releases](https://github.com/CHAOTIC-RAY/Kora-/releases?q=apk&expanded=true).

### Run locally

**Requirements:** a current Node.js LTS release and npm.

```bash
git clone https://github.com/CHAOTIC-RAY/Kora-.git
cd Kora-
npm install
npm run dev
```

The development server starts through `tsx server.ts`. Open the local URL printed by the server (the current configuration normally uses port 5000).

### Common scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Run the local application/server |
| `npm run lint` | Run the TypeScript no-emit check |
| `npm run test:scrabble-scoring` | Run deterministic Scrabble CPU scoring regression checks |
| `npm run build` | Build the data bundle, web assets, and bundled server |
| `npm run build:prod` | Build with the production app channel |
| `npm run build:beta` | Build with the beta app channel |
| `npm run cf-dev` | Run the Cloudflare Worker locally with Wrangler |
| `npm run apk:debug` | Build the web assets, sync Capacitor, and assemble a debug APK |
| `npm run apk:release` | Build the web assets, sync Capacitor, and assemble a release APK |

Deployment needs the correct Cloudflare account, bindings, Firebase project settings, and secrets. Review [self-hosting documentation](https://chaotic-ray.github.io/Kora-/self-hosting.html) before deploying. Do not copy production secrets into client-side `VITE_*` variables.

## Architecture at a glance

```text
React + TypeScript UI
  ├─ Reading, library, discovery, audio, games, settings
  ├─ Client libraries and feature-specific hooks
  ├─ IndexedDB ── local book bytes and offline data
  └─ Firebase ── authentication and supported synced metadata
          │
          ▼
Cloudflare Worker / local server
  ├─ API routing and upstream adapters
  ├─ guarded image and file proxying
  ├─ search/catalog metadata endpoints
  ├─ source-plugin relay
  └─ optional cache / R2 / KV bindings
          │
          ▼
External catalogs, media hosts, feeds, and plugin sources
```

The app's root orchestration lives in `src/App.tsx`; the large feature surfaces are implemented in `src/components/`; reusable logic, API clients, validators, and state helpers live in `src/lib/`; IndexedDB helpers live in `src/db/`; the Worker implementation is in `src/worker.ts`; and the Node-compatible server entry point is `server.ts`. Cloudflare routing and bindings are configured in `wrangler.toml`.

The production Worker and the local server have overlapping responsibilities but are separate entry points. When adding an API route, check both implementations and any shared helper before assuming the behavior is identical.

## Data and privacy model

- **Book files:** normally stored on the current device in IndexedDB. They are not automatically uploaded as raw files merely because metadata sync is enabled.
- **User metadata:** Firebase sync is optional and depends on project configuration and authentication.
- **Search and external media:** requests may reach third-party catalog, feed, cover, download, or audio hosts through the configured backend. Their availability and privacy practices are outside Kora's control.
- **Session search history:** Discover's recent-search suggestions are temporary to the current browser session.
- **Secrets:** private API credentials belong in Worker secrets or server-side environment configuration, never in a public client bundle.
- **Offline:** content must already be cached or stored locally to be available without a connection. External search and streaming require a working network.

## Documentation

- [Overview](https://chaotic-ray.github.io/Kora-/)
- [Feature guide](https://chaotic-ray.github.io/Kora-/features.html)
- [Architecture and request flow](https://chaotic-ray.github.io/Kora-/architecture.html)
- [Self-hosting and deployment](https://chaotic-ray.github.io/Kora-/self-hosting.html)
- [Plugin development](https://chaotic-ray.github.io/Kora-/plugins.html)
- [Codebase guide](./docs/CODEBASE_GUIDE.md)
- [Source plugin registry](https://github.com/CHAOTIC-RAY/Kora-Plugins)

## Testing and quality checks

The repository contains focused verification scripts under `scripts/` for areas such as source registries, reader behavior, search deduplication, downloads, and game interactions. Check `package.json` for the scripts currently available in your checkout. Run the TypeScript check and relevant feature tests before opening a pull request. A passing type-check is not a substitute for testing media playback, offline behavior, Android touch interactions, or upstream-dependent flows on a real device.

```bash
npm run lint
npm run build
```

If a test script fails, distinguish code failures from external-service failures, missing secrets, and Firebase rules that are not deployed to the tested project. Report the exact command and output with a bug report.

## Contributing

1. Reproduce the issue and record the affected surface, platform, and relevant console/diagnostic output.
2. Identify the feature component and any shared library or Worker route involved.
3. Make the smallest cohesive change and add a regression check when practical.
4. Run `npm run lint`, `npm run build`, and the focused tests related to the change.
5. Include manual test steps for touch, audio, offline, and network-dependent behavior.

Please do not commit API keys, tokens, personal data, downloaded copyrighted books, or generated build output.

## Credits

Thank you to the **[RaveBSD project](https://github.com/IdleEndeavor/RaveBSD)** for the support and for open-sourcing your work. We appreciate the time and effort that goes into making projects like this available to the community.

Kora also uses and builds on open-source software, including React, Vite, TypeScript, Tailwind CSS, epub.js, PDF.js, Firebase, Capacitor, and other libraries listed in the package manifests.

## License

Kora is distributed under the [MIT License](./LICENSE). Third-party dependencies and external content remain subject to their respective licenses and terms.
