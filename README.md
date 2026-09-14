<div align="center">
  <p>
    <img src="https://raw.githubusercontent.com/CHAOTIC-RAY/Kora-/main/public/kora-wordmark.gif" alt="Kora - Your bookshelf, narrator, and morning paper" width="100%" />
  </p>

  # 📖 Kora

  ### *Your bookshelf, narrator, and morning paper. All in one place.*

  <p align="center">
    <a href="https://github.com/CHAOTIC-RAY/Kora-/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-2D2D2D?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/badge/React-19-blue?style=flat-square&logo=react&color=27272A" alt="React 19" />
    <img src="https://img.shields.io/badge/Vite-6-purple?style=flat-square&logo=vite&color=27272A" alt="Vite 6" />
    <img src="https://img.shields.io/badge/Tailwind-4-38BDF8?style=flat-square&logo=tailwind-css&color=27272A" alt="Tailwind 4" />
    <img src="https://img.shields.io/badge/Firebase-Auth%20%26%20Store-FFCA28?style=flat-square&logo=firebase&color=27272A" alt="Firebase Sync" />
    <img src="https://img.shields.io/badge/Neural%20TTS-On--Device-412991?style=flat-square" alt="Neural TTS" />
  </p>

  <p align="center">
  <b>Open-source ebook reader + audiobook player + news aggregator with on-device text-to-speech.</b><br />
  Read EPUB/PDF/TXT · Listen with neural voices · Browse RSS feeds · Sync across devices · Works offline · PWA + Android.<br />
  <a href="https://kora.chaoticstudio.workers.dev">🌐 Live Demo</a> · <a href="https://github.com/CHAOTIC-RAY/Kora-/wiki">📚 Docs</a> · <a href="https://github.com/CHAOTIC-RAY/Kora-/discussions">💬 Discussions</a>
  </p>

  <h4>
    <a href="https://kora.chaoticstudio.workers.dev">Live Application</a>
    <span> · </span>
    <a href="https://github.com/CHAOTIC-RAY/Kora-/issues">Report Bug</a>
    <span> · </span>
    <a href="https://github.com/CHAOTIC-RAY/Kora-/discussions">Request Feature</a>
  </h4>
</div>

---

## ✨ What Makes Kora Different

Kora isn't just a reader—it's a **unified content consumption platform** built for the modern digital life:

| Feature | Kora | Why It Matters |
|---------|------|---|
| **📚 EPUB + PDF + TXT** | Full-featured reader with typography controls | One app for all text formats |
| **🎧 Neural Text-to-Speech** | Convert any book to audiobook with system voices | Transform reading into listening, no API calls |
| **📰 RSS + News Feed** | Integrated news reader & morning briefing | Morning paper + library in one place |
| **☁️ Cross-Device Sync** | Firebase Firestore + peer-to-peer transfer | Your library follows you everywhere |
| **📡 Federated Search** | Rave Engine (another dev's project — a search relay querying LibGen + Anna's Archive) aggregated server-side via the Cloudflare Worker, + Google Books metadata enrichment (+ Open Library fallback) | Discover & download freely-available books |
| **🌍 Offline-First PWA** | Works completely offline with IndexedDB | Read anywhere, anytime, no connection needed |
| **📱 Cross-Platform** | Web (PWA) + Android + iOS | One codebase, installed on your device |
| **🎮 Workshop Lounge** | Crossword, Word Search, Linguist Guardian | Take reading breaks with word games |

---

## 🚀 Quick Start

### View Live
Visit **[kora.chaoticstudio.workers.dev](https://kora.chaoticstudio.workers.dev)** — no installation needed.

### Run Locally
```bash
git clone https://github.com/CHAOTIC-RAY/Kora-.git
cd Kora-
npm install
npm run dev
```

Open [http://localhost:5000](http://localhost:5000).

### Install as App

**🌐 Web (PWA):**
- Visit [kora.chaoticstudio.workers.dev](https://kora.chaoticstudio.workers.dev)
- Click "Install" in your browser (Chrome, Edge, Safari 16.4+)
- App installs to your home screen — works offline

**📱 Android:**
- Download the latest APK from [Releases](https://github.com/CHAOTIC-RAY/Kora-/releases?q=apk&expanded=true)
- Enable "Install from unknown sources" in Settings
- Open the `.apk` file and tap **Install**
- Full offline support, background narration, P2P file transfer

---

## 📚 Three Unified Experiences

### 1. 📖 Bookshelf
Your personal library—read offline, sync across devices.

**Features:**
- 📄 EPUB, PDF, TXT reading with bookmarks & highlights
- 🎨 Five display themes (Light, Sepia, Dark Grey, Dark Blue, E-Ink)
- 🔤 Typography: Lora, Lexend, OpenDyslexic, Lexica Ultralegible
- 📍 Progress tracking & resume reading
- 🎭 Reader archetypes (Midnight Reader, Cozy Tea Sipper, Bibliophile, Speed Scholar)
- 🔍 Full-text search within your library

**Discovery & Downloads:**
- 🌐 **Rave Book Search relay** — the Cloudflare Worker proxies all book search through [Rave Book Search](https://ravebooksearch.com/) (v1 API, server-side `RAVE_API_KEY`), which aggregates Anna's Archive, LibGen, Z-Library, Internet Archive, and Open Library results in one call
- 🎧 **Audiobooks** — streamed via Rave's audiobook sources (iAudio / HDAudiobooks / Internet Archive)
- 📥 Parallel downloads with automatic mirror fallback
- 🔗 **`get.php?md5=` resolution** — the Worker turns Rave's signed LibGen CDN links into working `booksdl.lc` downloads via `/api/proxy-file`
- 🛡️ CORS-safe cover image proxying (`/api/cover-redirect`, `/api/proxy-image`)
- ⭐ Goodreads integration for curated lists

> **Search architecture:** Kora does **not** independently scrape LibGen or call Z-Library's `eapi` from the client. All ebook/audiobook search flows through Rave as the sole relay engine (Worker route `/api/annas-archive/search` → Rave v1 with a server-side key). The one exception is the LibGen landing-page resolution in `/api/proxy-file` (`get.php?md5=`), which converts Rave's signed LibGen CDN links into working downloads. This keeps the API key server-side and the client code free of provider-specific scraping.

---

#### How the Book Engine Actually Works

Kora is a front-end reader and a search/download relay. It does **not** host books itself. Here is the exact data flow, traced through the source.

**Rave Engine (another dev's project)** — a search relay that queries LibGen and Anna's Archive. Kora talks to Rave from its Cloudflare Worker (`server.ts` / `src/worker.ts`) so the `RAVE_API_KEY` is never sent to the browser. The Worker exposes `/api/annas-archive/search`, which calls through to Rave's v1 API at `api.ravebooksearch.com` (`/src/worker.ts:244`, `server.ts:1114`), and returns the merged results.

**Google Books** — clean metadata, descriptions, professional cover images, and verified reader ratings. These aren't always downloadable (you'd buy or borrow them elsewhere), but the metadata makes Kora's search results much more useful. The Worker proxies Google Books via `/api/google-books/search` (`src/worker.ts:2159`), and if Google is down or quota-exhausted (HTTP 429), it synthesizes a volumes-like payload from Open Library (`googleBooksFallbackFromOpenLibrary`).

**Kora merges both:** it shows you Google's detailed catalog info alongside Rave's downloadable files, so you get both professional book metadata and the actual book files in one search. The `/api/search/stream` route (`src/worker.ts:1745`) races them in parallel — Google Books first for metadata, then Rave when Google returns nothing — and streams NDJSON back to the client (`src/lib/searchClient.ts:streamEbookSearch`).

**For the direct download link:** When you search in Kora, results come from Rave Engine which aggregates from LibGen + Anna's Archive. But Rave doesn't give Kora direct file links — it gives Kora a unique string (MD5). Kora takes that MD5 and builds a LibGen download URL like <code>@url:`https://libgen.li/get.php?md5=943105537`</code>. LibGen doesn't let you download directly by MD5 alone — you need a `key` parameter. So Kora makes two requests: one to resolve the signed key (via `resolveLibgenSigned` in `src/lib/libgenSigned.ts`, which races multiple LibGen mirrors in parallel), then another to actually download using both `md5` + `key`. The signed link is then streamed through `/api/proxy-file` (`server.ts:2988`, `src/worker.ts:3518`), which resolves landing pages, handles IPFS gateways, retries mirrors, and enforces SSRF guards.

**If Google Books is down** — Kora queries Open Library instead and maps results to the same Google-Books-shaped `volumeInfo` payload (`googleBooksFallbackFromOpenLibrary`), so enrichment on the detail page still works.

**Advanced search** — Skips metadata enrichment (Google Books / Open Library), goes straight to the MD5 hash with Rave. The `/api/annas-archive/download` route (`server.ts:3504`) resolves the MD5 into a ranked list of mirrors: Rave's signed direct URL first, then LibGen mirrors (`libgen.li`, `libgen.be`, `libgen.lc`, …), Anna's Archive manual lookup, and Internet Archive direct file links — deduplicated and sorted client-side (`DiscoverView.tsx:buildInstantMirrors` + `rankVariants`).

**When Rave is down** — Kora falls back to direct LibGen/Anna's Archive scraping. The Worker's `fetchPageHtmlWithProxies` (`src/worker.ts:419`) fetches ebook-site pages (LibGen, Anna's Archive, Z-Library) directly with rotating user-agents and a Puppeteer/Cloudflare-Browser bypass for anti-bot walls (`src/lib/libgenProxy.ts:fetchBinaryWithLibgenMirrors`). It extracts MD5 hashes and signed download URLs, racing multiple mirrors in parallel so one dead host doesn't kill the download.

**Context Warnings** — Kora logs diagnostic warnings when content extraction fails, e.g. <code>@url:`https://libgen.li/get.php?md5=943105537`: no content extracted</code>. These surface in the live API diagnostic export (see `fix(logger): export readable UTF-8 txt + live API diagnostic`). They mean a mirror returned HTML instead of a binary stream, so Kora moves on to the next candidate and records which host failed.

---

### 2. 🎧 Narrator
**On-device neural text-to-speech** — no cloud APIs, no subscriptions.

**How it works:**
- **Web/PWA:** Uses native Web Speech API (OS-level voices) — free, always available
- **Android:** Uses Android TextToSpeech engine (on-device neural voices) — no internet required
- **Voice selection:** Switch between system voices mid-playback with 0 latency
- **Playback controls:** 0.75x–2.0x speed, pitch adjustment, chapter navigation
- **Background audio:** Listen while phone is locked or using other apps (Android)

**Features:**
- 🗣️ **On-Device Neural Synthesis** — converts any ebook to audiobook
- ▶️ Full-screen + mini-player modes with track progress
- 💾 Automatic caching for re-reading without regeneration
- 📊 Session restore — continue where you left off
- ⏩ Speed control + chapter skip buttons
- 🔊 Live sync highlighting — see text as it's spoken

---

### 3. 📰 Morning Paper
RSS feeds + daily news briefing in one feed.

**Features:**
- 📰 RSS feed aggregation (Maldives, international sources)
- ✅ Mark-read, save articles, open in new tab
- 📄 Clean article reader with one-click formatting
- 📋 **Daily News Brief** — morning digest from your feeds
- 🎨 Per-source styling for visual distinction
- 📌 Pin important sources to top

---

### 4. 🎮 Workshop Lounge
Interactive games & tools to take reading breaks.

**Games:**
- **Crossword** — Literary word puzzles built from your library
- **Word Search** — Find hidden vocabulary with difficulty scaling
- **Linguist Guardian** — Word duels with strategic gameplay

**Research Tools:**
- **Wikipedia Hub** — Search articles & convert to custom ebooks with audio
- **Dictionary** — Searchable reference with definitions & examples
- **Score Tracker** — Track board game rounds with turn timers

---

### 5. ⚙️ Modular Feature Toggles
Fine-tune your reading environment on a per-device basis:
- **News Tab** — Toggle the entire RSS / Morning Paper tab and its background pollers
- **Discover Tab** — Toggle online search and curated feeds for a distraction-free library
- **Sound Effects** — Silence page-turn sounds and interactive puzzle audio
- **Getting Started Guide** — Hide or show the built-in Kora starter book on your shelf
- **Lounge Guides** — Show or hide the interactive walk-through cards on the Lounge home screen
- **Dynamic Navigation** — The bottom navigation automatically reorganizes and evenly spaces remaining items without gaps

---

## ☁️ Sync Across Devices

Your library follows you everywhere:

| Data | Location | Syncs? |
|------|----------|--------|
| Books, progress, bookmarks, highlights | Firebase Firestore | ✅ When signed in |
| Book files (EPUB/PDF bytes) | Local device (IndexedDB) | ✅ P2P transfer or WebDAV |
| RSS feeds & preferences | Firebase Firestore | ✅ When signed in |
| Settings & themes | Firebase Firestore | ✅ When signed in |

**Authentication:**
- 🔑 Email + password
- 🔐 Google Sign-In
- 👤 Guest mode (expires after 30 days)

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite 6, TypeScript |
| **Styling** | Tailwind CSS 4, Motion animations |
| **Local Storage** | IndexedDB (books), localStorage (UI state) |
| **Cloud Sync** | Firebase Firestore + Auth |
| **Backend** | Cloudflare Worker (API proxy + Rave Book Search relay) |
| **Book Rendering** | epub.js (EPUB), PDF.js (PDF) |
| **Text-to-Speech** | Web Speech API (web), Android TextToSpeech (native) |
| **Deployment** | Cloudflare Pages (frontend) + Workers (backend) |

---

## 📂 Project Structure

```
kora/
├── src/
│   ├── components/         # React UI components
│   ├── pages/              # Page-level views
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Core libraries (Firebase, TTS, storage)
│   ├── db/                 # IndexedDB helpers
│   ├── utils/              # Utility functions
│   ├── styles/             # Tailwind config & globals
│   └── App.tsx             # Root component
├── android/                # Android native code (Capacitor)
├── backend/                # Express/Workers API proxy
├── public/                 # Static assets
├── vite.config.ts          # Vite configuration
└── capacitor.config.ts     # Capacitor configuration
```

---

## 🚀 Getting Started (Development)

### Prerequisites
- **Node.js** v18+
- **npm** v9+

### Installation

```bash
# Clone the repository
git clone https://github.com/CHAOTIC-RAY/Kora-.git
cd Kora-

# Install dependencies
npm install

# Start development server
npm run dev

# Open browser to http://localhost:5000
```

### Build & Deploy

```bash
# Build for production
npm run build

# Preview production build locally
npm run preview

# Deploy to Cloudflare Pages
npm run deploy
```

### Build Android APK

```bash
# Build signed release APK
npm run apk:release

# APK output: android/app/build/outputs/apk/release/
```

### Environment Variables (Optional — Cloud Sync)

Create a `.env.local` file in the root:

```env
# Firebase Configuration (optional — enables cloud sync)
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Backend API (optional)
VITE_API_URL=http://localhost:5000

# Rave Book Search API key (server-side, for the Cloudflare Worker)
# Set as a Worker secret: `wrangler secret put RAVE_API_KEY`
RAVE_API_KEY=your_rave_api_key
```

> **Note:** Firebase is fully optional. Without it, Kora works entirely offline with IndexedDB.
> The `RAVE_API_KEY` is **server-side only** (a Cloudflare Worker secret) — it is never exposed to the client. Book search is relayed through Rave via the Worker so the key stays secret.

---

## 📦 Features by Version

### ✅ v1.0 (Current)
- ✅ EPUB/PDF/TXT reader with full UI customization & typography controls
- ✅ Multi-tier dictionary lookup with automatic popup overlay management
- ✅ Mobile viewport scaling protections (prevent accidental text zoom)
- ✅ Discover tab featuring prioritized New York Times (NYT) Bestsellers, Goodreads lists, NetGalley review titles, and audiobooks
- ✅ Device Feature Toggles (toggle News tab, Discover tab, Sound effects, Getting Started book, Lounge guides)
- ✅ Dynamic responsive mobile navigation bar (adapts spacing with zero gaps when features are toggled off)
- ✅ Background task optimization (news polling and widgets shut down when feature is toggled off)
- ✅ Firebase Firestore sync (cloud bookmarks, highlights, progress, custom tags)
- ✅ On-device neural text-to-speech (Web Speech API + Android TTS)
- ✅ RSS feed reader & morning news aggregator
- ✅ Offline PWA support with IndexedDB storage
- ✅ Cross-device P2P file transfer
- ✅ Workshop Lounge (Crossword, Word Search, Linguist Guardian, interactive guides)
- ✅ Wikipedia Hub & searchable dictionary
- ✅ Clean onboarding flow with fast Google / Guest sign-in

### 🔮 Planned (v1.1+)
- 📱 Native iOS app (React Native)
- 🔗 WebDAV sync backend
- 📊 Reading statistics & analytics
- 📅 Reading goals & streak tracking
- 💬 Community highlights & annotations
- 🎤 Voice commands (read aloud)
- 🐞 In-app bug reporting via Sentry User Feedback (error screen + Settings)

---

## 🤝 Contributing

We welcome contributions! Here's how to help:

1. **Fork** the repository
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes** and test locally
4. **Commit** with descriptive messages (`git commit -m 'Add: amazing feature'`)
5. **Push** to your branch (`git push origin feature/amazing-feature`)
6. **Open a Pull Request** — describe your changes clearly

**Report issues:** [GitHub Issues](https://github.com/CHAOTIC-RAY/Kora-/issues)  
**Discuss features:** [GitHub Discussions](https://github.com/CHAOTIC-RAY/Kora-/discussions)

---

## 📜 License

This project is licensed under the **MIT License** — see [LICENSE](./LICENSE) for details.

You're free to use Kora in personal, commercial, or educational projects.

---

## 🙏 Acknowledgments

- **[epub.js](https://github.com/futurepress/epub.js)** — EPUB rendering engine
- **[PDF.js](https://mozilla.github.io/pdf.js/)** — PDF viewer
- **[React](https://react.dev)** — UI framework
- **[Rave Search](https://ravebooksearch.com/)** — Federated book search relay (Anna's Archive, LibGen, Z-Library, Internet Archive, Open Library)
- **[Sentry](https://sentry.io)** — Error tracking + User Feedback bug reporting
- **[Tailwind CSS](https://tailwindcss.com)** — Utility-first CSS
- **[Firebase](https://firebase.google.com)** — Backend & sync infrastructure
- **[Capacitor](https://capacitorjs.com)** — Cross-platform native bridge
- **Web Speech API & Android TextToSpeech** — On-device voice synthesis

---

<p align="center">
  <i>Your bookshelf, your narrator, and your morning paper. Unified.</i><br />
  Built with ☕ and passion by <a href="https://github.com/CHAOTIC-RAY">CHAOTIC-RAY</a> · <a href="https://kora.chaoticstudio.workers.dev">Visit Kora →</a> · <a href="https://github.com/CHAOTIC-RAY/Kora-/issues/new?title=Report%20a%20bug">Report a bug →</a>
</p>
