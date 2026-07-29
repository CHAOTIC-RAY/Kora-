<div align="center">
  <p>
    <img src="./public/kora-wordmark.gif" alt="Kora - Your bookshelf, narrator, and morning paper" width="100%" />
  </p>

  # 📖 Kora
  ### *Your bookshelf, narrator, and morning paper. All in one place.*

  <p align="center">
    <a href="https://github.com/CHAOTIC-RAY/Kora-/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-2D2D2D?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/badge/React-19-blue?style=flat-square&logo=react&color=27272A" alt="React 19" />
    <img src="https://img.shields.io/badge/Vite-6-purple?style=flat-square&logo=vite&color=27272A" alt="Vite 6" />
    <img src="https://img.shields.io/badge/Tailwind-4-38BDF8?style=flat-square&logo=tailwind-css&color=27272A" alt="Tailwind 4" />
    <img src="https://img.shields.io/badge/Firebase-Auth%20%26%20Store-FFCA28?style=flat-square&logo=firebase&color=27272A" alt="Firebase Sync" />
    <img src="https://img.shields.io/badge/AI%20TTS-OpenAI%20%2F%20ElevenLabs-412991?style=flat-square" alt="AI TTS" />
  </p>

  <p align="center">
  <b>Open-source ebook reader + audiobook player + news aggregator with AI narration.</b><br />
  Read EPUB/PDF/TXT · Listen with AI text-to-speech · Browse RSS feeds · Sync across devices · Works offline · PWA + Android.<br />
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
| **🎧 AI Text-to-Speech** | Convert any book to audiobook on-the-fly | Transform reading into listening |
| **📰 RSS + News Feed** | Integrated news reader & morning briefing | Morning paper + library in one place |
| **☁️ Cross-Device Sync** | Firebase Firestore + peer-to-peer transfer | Your library follows you everywhere |
| **📡 Federated Search** | Query Rave, LibGen, Anna's Archive simultaneously | Discover & download freely-available books |
| **🌍 Offline-First PWA** | Works completely offline with IndexedDB | Read anywhere, anytime, no connection needed |
| **📱 Cross-Platform** | Web (PWA) + Android + iOS | One codebase, installed on your device |

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

Open [http://localhost:3000](http://localhost:3000).

### Install as App
1. **Web:** Click "Install" in your browser (Chrome, Edge, Safari 16.4+)
2. **Android:** Build APK with `npm run build:android` or use Play Store (coming soon)

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
- 🌐 **Federated book search** across multiple open-source indexes
  - [Rave Search Engine](https://github.com/IdleEndeavor/rave) — comprehensive open-source title index
  - LibGen & Anna's Archive — free ebook mirrors with auto-retry
  - iAudio — audiobook streaming backend
- 📥 Parallel downloads with automatic mirror fallback
- 🛡️ CORS-safe cover image proxying
- ⭐ Goodreads integration for curated lists

---

### 2. 🎧 Narrator
Listen to your library with AI-powered voices.

**Features:**
- 🗣️ **AI Text-to-Speech** — convert any ebook to audiobook in seconds
  - OpenAI TTS (HD voice quality)
  - ElevenLabs (emotional intonation)
  - Browser-native Web Speech API (free, always available)
- ▶️ Full-screen + mini-player modes
- 💾 Offline caching for uninterrupted listening
- 📊 Session restore — continue where you left off
- ⏩ Speed control & chapter navigation

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
| **Backend** | Express / Cloudflare Workers (API proxy) |
| **Book Rendering** | epub.js (EPUB), PDF.js (PDF) |
| **AI Audio** | Web Speech API, OpenAI TTS, ElevenLabs |
| **Deployment** | Cloudflare Pages (frontend) + Workers (backend) |

---

## 📂 Project Structure

```
kora/
├── src/
│   ├── components/         # React UI components
│   ├── pages/              # Page-level views
│   ├── hooks/              # Custom React hooks
│   ├── services/           # Firebase, API, storage logic
│   ├── utils/              # Helpers & utilities
│   ├── styles/             # Tailwind config & globals
│   └── App.tsx             # Root component
├── backend/                # Express/Workers API proxy
├── public/                 # Static assets
├── vite.config.ts          # Vite configuration
└── firebase.config.ts      # Firebase setup
```

---

## 🚀 Getting Started (Development)

### Prerequisites
- **Node.js** v18+
- **npm** v9+ or **pnpm**

### Installation

```bash
# Clone the repository
git clone https://github.com/CHAOTIC-RAY/Kora-.git
cd Kora-

# Install dependencies
npm install

# Start development server
npm run dev

# Open browser to http://localhost:3000
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

### Environment Variables (Optional — Cloud Sync)

Create a `.env.local` file in the root:

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Backend API (optional)
VITE_API_URL=http://localhost:5000

# Optional: AI TTS API Keys
VITE_OPENAI_API_KEY=your_key
VITE_ELEVENLABS_API_KEY=your_key
```

---

## 📦 Features by Version

### ✅ v1.0 (Current)
- ✅ EPUB/PDF/TXT reader with full UI customization
- ✅ Firebase Firestore sync
- ✅ AI text-to-speech (Web Speech + OpenAI API)
- ✅ RSS feed reader & news aggregator
- ✅ Offline PWA support
- ✅ Cross-device P2P file transfer

### 🔮 Planned (v1.1+)
- 📱 Native Android app (React Native)
- 📱 iOS app (React Native)
- 🎮 Lounge games suite (multiplayer reading challenges)
- 🔗 WebDAV sync backend
- 📊 Reading statistics & analytics
- 🤖 AI book recommendations
- 💬 Community highlights & annotations
- 🎤 Voice commands (read aloud)

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
- **[Rave Search](https://github.com/IdleEndeavor/rave)** — Federated search engine
- **[Tailwind CSS](https://tailwindcss.com)** — Utility-first CSS
- **[Firebase](https://firebase.google.com)** — Backend & sync infrastructure

---

<p align="center">
  <i>Your bookshelf, your narrator, and your morning paper. Unified.</i><br />
  Built with ☕ and passion by <a href="https://github.com/CHAOTIC-RAY">CHAOTIC-RAY</a> · <a href="https://kora.chaoticstudio.workers.dev">Visit Kora →</a>
</p>