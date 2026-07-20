<div align="center">
  <p>
    <img src="./public/kora_banner.png" alt="Kora - Next-Gen Ebook Reader" width="100%" />
  </p>

  # 📖 Kora - Next-Gen Ebook Reader

  ### *“I have always imagined that Paradise will be a kind of library.” — Jorge Luis Borges*

  <p align="center">
    <a href="https://github.com/CHAOTIC-RAY/Kora-/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-2D2D2D?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/badge/React-19-blue?style=flat-square&logo=react&color=27272A" alt="React 19" />
    <img src="https://img.shields.io/badge/Vite-6-purple?style=flat-square&logo=vite&color=27272A" alt="Vite 6" />
    <img src="https://img.shields.io/badge/Tailwind-4-38BDF8?style=flat-square&logo=tailwind-css&color=27272A" alt="Tailwind 4" />
    <img src="https://img.shields.io/badge/Firebase-Auth%20%26%20Store-FFCA28?style=flat-square&logo=firebase&color=27272A" alt="Firebase Sync" />
  </p>

  <p align="center">
    <b>A highly polished, Kindle-inspired next-generation ebook reader.</b><br />
    Designed for digital bibliophiles who demand elegant typography, offline-first reliability, and seamless multi-device cloud synchronization.
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

## 🌟 Core Features

Kora combines the simplicity of an e-ink Kindle device with the power of modern full-stack web applications.

### 🎭 Onboarding & Personalization
* **Reader archetypes** — Midnight Reader, Cozy Tea Sipper, Bibliophile Curator, or Speed Scholar, each with a matching display theme.
* **App skins** — Choose your chrome style during setup: **Kora** (frosted), **Paper** (matte reader), **Studio** (editorial), or **Soft** (rounded & elevated). Skins are separate from color themes and can be changed anytime in Settings → Appearance.
* **Interactive walkthrough** — Library, RSS feeds, Discover, downloads, cross-device sync, and display settings.
* **Account step** — Sign in to keep your library, or continue as guest (guest sessions reset every 30 days).

### 📚 Immersive Reading Engine
* **Kindle-inspired layout** — Adjustable font size, line height, and margins.
* **Display themes** — Light White, Sepia, Dark Grey, and Dark Blue palettes.
* **Typography** — Lora body text, Lexend UI, JetBrains Mono data, plus OpenDyslexic and Lexica Ultralegible reader fonts.
* **Formats** — EPUB, PDF, TXT with bookmarks, highlights, and progress tracking.

### 📰 News & RSS
* **Read tab** — Maldives and international RSS sources with save, mark-read, and open-in-new-tab actions.
* **Daily News Brief** — Optional morning headline digest from your selected feeds.

### 🔍 Unified Ebook Discovery
* **Goodreads scraping** — Curated lists with CORS-safe cover proxying.
* **Federated search** — Public open-source titles via mirror intelligence.
* **Background downloads** — Multi-mirror progress tracking.

### 📦 Offline-First & Mobile Ready
* **PWA** — Install on iOS/Android with offline reading from IndexedDB.
* **Cover designer** — Procedural typographic covers when metadata is missing.

### ☁️ Cross-Device Sync
* **Firebase Firestore** — Library metadata, reading progress, bookmarks, and highlights sync when signed in.
* **Files stay local** — Book binaries are not uploaded to Firebase Storage.
* **Tools → Devices & Sync** — Device dashboard, peer-to-peer file transfer between your devices, and optional BYO WebDAV archive.

#### How sync works
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
  Designed with ☕ and passion by <a href="https://github.com/CHAOTIC-RAY">CHAOTIC-RAY</a>.
</p>
