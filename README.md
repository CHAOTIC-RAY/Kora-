<div align="center">
  <p>
    <img src="./public/kora_banner.png" alt="Kora - Your bookshelf, narrator, and morning paper" width="100%" />
  </p>

  # 📖 Kora

  ### *Your bookshelf, your narrator, and your morning paper. Unified.*

  <p align="center">
    <a href="https://github.com/CHAOTIC-RAY/Kora-/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-2D2D2D?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/badge/React-19-blue?style=flat-square&logo=react&color=27272A" alt="React 19" />
    <img src="https://img.shields.io/badge/Vite-6-purple?style=flat-square&logo=vite&color=27272A" alt="Vite 6" />
    <img src="https://img.shields.io/badge/Tailwind-4-38BDF8?style=flat-square&logo=tailwind-css&color=27272A" alt="Tailwind 4" />
    <img src="https://img.shields.io/badge/Firebase-Auth%20%26%20Store-FFCA28?style=flat-square&logo=firebase&color=27272A" alt="Firebase Sync" />
  </p>

  <p align="center">
  <b>One app for everything you read and listen to.</b><br />
  Build a personal library, listen with built-in narration, and catch up on the morning headlines — offline-first, synced across your devices, and designed to feel as calm as a well-stocked shelf.
  </p>

  <h4>
    <a href="https://kora.chaoticstudio.workers.dev">Live Application</a>
    <span> · </span>
    <a href="https://github.com/CHAOTIC-RAY/Kora-/issues">Report Bug</a>
    <span> · </span>
    <a href="https://github.com/CHAOTIC-RAY/Kora-/pulls">Submit Feature</a>
  </h4>
</div>

---

## 🌟 Three things, one home

| | What it is | What you get |
|---|---|---|
| **📚 Bookshelf** | Your private library | EPUB, PDF, and TXT reading · discovery & downloads · highlights & bookmarks · offline PWA |
| **🎧 Narrator** | Your listening layer | Audiobook playback · built-in TTS conversion · continue listening across sessions |
| **📰 Morning paper** | Your daily read | RSS feeds & news reader · save & mark-read · optional Daily News Brief |

---

## 📚 Bookshelf

Everything you own, in one place — elegant typography, reliable offline storage, and sync when you sign in.

### Onboarding & personalization
* **Reader archetypes** — Midnight Reader, Cozy Tea Sipper, Bibliophile Curator, or Speed Scholar, each with a matching display theme.
* **App skins** — Choose your chrome style during setup: **Kora**, **Paper**, **Studio**, or **Soft**. Skins are separate from color themes and can be changed anytime in Settings → Appearance.
* **Interactive walkthrough** — Lounge dashboard, Library, feeds, Discover, downloads & narrator, cross-device sync, and display skins.
* **Account step** — Sign in to keep your library, or continue as guest (guest sessions reset every 30 days).

### Immersive reading
* **Kindle-inspired layout** — Adjustable font size, line height, and margins.
* **Display themes** — Light White, Sepia, Dark Grey, and Dark Blue palettes.
* **Typography** — Lora body text, Lexend UI, JetBrains Mono data, plus OpenDyslexic and Lexica Ultralegible reader fonts.
* **Formats** — EPUB, PDF, TXT with bookmarks, highlights, and progress tracking.

### Discovery & downloads
* **Goodreads scraping** — Curated lists with CORS-safe cover proxying.
* **Federated search** — Public open-source titles via mirror intelligence.
* **Background downloads** — Multi-mirror progress tracking with manual retry.

### Offline-first
* **PWA** — Install on iOS/Android with offline reading from IndexedDB.
* **Cover designer** — Procedural typographic covers when metadata is missing.

---

## 🎧 Narrator

Turn pages into playback — listen in the app or on the go.

* **Audiobook player** — Full-screen and mini-player modes with track progress and offline caching.
* **Built-in TTS** — Convert ebooks to listenable audio from Tools → Read Aloud.
* **Session restore** — Pick up where you left off after reload or tab switch.

---

## 📰 Morning paper

Your feeds, your brief, your pace.

* **Read tab** — Maldives and international RSS sources with save, mark-read, and open-in-new-tab actions.
* **Article reader** — Clean full-page reading with scroll-to-advance and per-source styling.
* **Daily News Brief** — Optional morning headline digest from your selected feeds.

---

## ☁️ Cross-device sync

* **Firebase Firestore** — Library metadata, reading progress, bookmarks, and highlights sync when signed in.
* **Files stay local** — Book binaries are not uploaded to Firebase Storage.
* **Tools → Devices & Sync** — Device dashboard, peer-to-peer file transfer between your devices, and optional BYO WebDAV archive.

| Data | Where it lives |
|------|----------------|
| Book list, progress, highlights | Firebase (when signed in) |
| EPUB/PDF file bytes | IndexedDB on each device |
| Missing files on a new device | Pull from another device (P2P) or WebDAV |

**Guest mode:** Anonymous accounts work out of the box but expire after **30 days**, clearing the guest session. Sign in with email or Google to keep your library permanently.

---

## 🛠️ Built With

* **Framework**: [React 19](https://react.dev) & [Vite 6](https://vite.dev)
* **Styling**: [Tailwind CSS v4](https://tailwindcss.com)
* **Animations**: [Motion](https://motion.dev)
* **API Proxy**: Express / Cloudflare Workers (CORS bypass for covers & feed images)
* **Cloud Sync**: [Firebase](https://firebase.google.com) (Firestore + Auth)
* **Local Storage**: IndexedDB + localStorage

---

## 📂 Architecture Overview

```
 ┌──────────────────────────────────────────────────────────────┐
 │                     KORA CLIENT (Vite/React)                 │
 │  - Responsive Web / Installed PWA                            │
 │  - Book rendering (epub.js & pdfjs)                          │
 │  - Local Caches (IndexedDB for books, localStorage for UI)    │
 └──────────────┬───────────────────────────────▲───────────────┘
                │ Client Requests               │ Sync Data
                ▼ (Proxy API)                   │
 ┌──────────────────────────────────────────────┴───────────────┐
 │                    EXPRESS / WORKERS BACKEND                   │
 │  - Cover & feed image proxying (same-origin, CORS-safe)        │
 │  - Federated book search & mirror resolution                   │
 └──────────────┬───────────────────────────────▲───────────────┘
                │                               │
                ▼                               ▼
 ┌──────────────────────────────┐       ┌───────────────────────┐
 │      EXTERNAL BOOK SERVERS   │       │   FIREBASE FIRESTORE  │
 └──────────────────────────────┘       └───────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** `v18+`
* **npm** `v9+`

### Install & run
```bash
git clone https://github.com/CHAOTIC-RAY/Kora-.git
cd Kora-
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment (optional — cloud sync)
```env
PORT=3000
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### Production build
```bash
npm run build
npm run start
```

---

## 📜 License

MIT License — see [LICENSE](LICENSE).

---

<p align="center">
  <i>Your bookshelf, your narrator, and your morning paper. Unified.</i><br />
  Designed with ☕ and passion by <a href="https://github.com/CHAOTIC-RAY">CHAOTIC-RAY</a>.
</p>
