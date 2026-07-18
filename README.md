<div align="center">
  <img src="./public/kora_banner.jpg" alt="Kora - Next-Gen Ebook Reader" width="100%" style="border-radius: 12px; margin-bottom: 24px;" />

  # 📖 Kora - Next-Gen Ebook Reader

  ### *“I have always imagined that Paradise will be a kind of library.” — Jorge Luis Borges*

  <p align="center">
    <a href="https://github.com/CHAOTIC-RAY/Kora-/blob/main/LICENSE"><img src="https://img.shields.io/github/license/CHAOTIC-RAY/Kora-?style=flat-square&color=2D2D2D" alt="License" /></a>
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

### 🎭 Playful Bookworm Onboarding
* **Custom Reader Archetypes**: Define your literary identity! Choose from **The Midnight Reader** (lives in slate grey mode), **The Cozy Tea Sipper** (warm sepia presets), **The Bibliophile Curator** (perfectly ordered white pages), or **The Speed Scholar** (utilizing high-contrast navy presets).
* **Pseudonym Customization**: Personalize your application header with a custom pseudonym.
* **Interactive Guidebook**: A delightful, step-by-step carousel walking you through library drag-and-drop file ingestion, discovery feeds, background download alchemy, and aesthetic settings.
* **The Bookworm Oath & Guild Pact**: Transparency first. Agreements detailing Fair Use compliance, offline browser-contained data sovereignty, and open-source licenses.

### 📚 Immersive Reading Engine
* **Kindle-inspired Layout**: Clean text grids with adjustable font sizes, line heights, and margin widths to suit your reading habits.
* **Aesthetic Palette Presets**: Four eye-safe display presets: **Light White** (default crisp paper), **Sepia** (warm amber), **Dark Grey** (calm charcoal), and **Dark Blue** (deep twilight).
* **Elite Typography**: Features **Lora** as its primary body typeface, paired with **Lexend** for display elements and **JetBrains Mono** for data fields.
* **Full Ebook Format Support**: Seamlessly parse and render standard EPUB and PDF books with chapter-to-chapter tracking, bookmarking, and highlighting.

### 🔍 Unified Ebook Discovery
* **Resilient Goodreads Scraping (Zero-AI/Zero-API)**: Direct, high-speed cheerio extraction of Goodreads curation lists with auto-retry and multiple CORS/Cloudflare bypass proxies (including corsproxy.io, codetabs, and allorigins). Loaded instantly, kept fully private.
* **Federated Book Search**: Real-time crawling and searching of millions of public, open-source titles.
* **Direct Mirror Intelligence**: Automatically resolves fast, direct mirrors (such as Library.lol and Libgen) to offer instant auto-download streams.
* **Intelligent Landing Page Detection**: Recognizes slow links (such as Anna's Archive manual pages), safely labeling them to prevent script timeouts while supporting manual-download fallbacks.
* **Curated Recommendations**: Displays dynamic trending book listings with beautiful book jackets and personalized recommendations.

### 📦 Offline-First & Mobile Ready
* **Full PWA Capabilities**: Instant home-screen installations on iOS and Android with custom vector icons and standard black-translucent status bar immersion.
* **Local IndexedDB Engine**: Automatically caches download streams and stores physical book binaries directly in browser local storage. Enter Kora completely offline and read your library uninterrupted.
* **Cover Designer**: Generate stunning, minimalist procedurally rendered typographic book covers for downloaded books that lack metadata jackets.

### ☁️ Cross-Device Cloud Sync
* **Seamless Library Sync**: Powered by Firebase Firestore, your personal bookshelf is automatically kept in lockstep.
* **Live Progress Tracking**: Syncs active books, reading progress percentages, precise reading location states, bookmarks, and annotated highlights across your mobile, tablet, and desktop browsers.

---

## 🛠️ Built With

Kora's codebase is designed for raw performance, utilizing state-of-the-art libraries:

* **Framework**: [React 19](https://react.dev) & [Vite 6](https://vite.dev) (Single-page app with lightning-fast asset builds)
* **Styling**: [Tailwind CSS v4](https://tailwindcss.com) (Modern CSS variables, ultra-fast precompiled utility engine)
* **Animations**: [Motion](https://motion.dev) (Custom-designed micro-animations, fade effects, and sheet transitions)
* **API Proxy**: [Express.js](https://expressjs.com) (Secure backend routing layer to resolve external covers and files without exposing secret keys or hitting CORS restrictions)
* **Cloud Sync**: [Firebase Core SDK](https://firebase.google.com) (Serverless Realtime Firestore and Secure Anonymous Auth)
* **Local Storage**: [IndexedDB Wrapper](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (High-capacity offline caching engine)

---

## 📂 Architecture Overview

Kora operates on a **hybrid client-worker server architecture**:

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
 │                       EXPRESS BACKEND                        │
 │  - Handles cover art /file proxying (CORS-bypass)            │
 │  - Aggregates searches from federated books engines          │
 │  - Resolves direct download mirror pointers                  │
 └──────────────┬───────────────────────────────▲───────────────┘
                │ Fetch Covers                  │ Store Reading State
                ▼                               ▼
 ┌──────────────────────────────┐       ┌───────────────────────┐
 │      EXTERNAL BOOK SERVERS   │       │   FIREBASE FIRESTORE  │
 │  (Libgen / OpenLibrary / IA) │       │   - User Bookshelf    │
 │                              │       │   - Synced Progress   │
 └──────────────────────────────┘       └───────────────────────┘
```

---

## 🚀 Getting Started

Follow these steps to spin up Kora on your local machine.

### Prerequisites
* **Node.js**: `v18.0.0` or higher
* **npm**: `v9.0.0` or higher

### 1. Clone & Install
```bash
# Clone the repository
git clone https://github.com/CHAOTIC-RAY/Kora-.git

# Navigate into the project folder
cd Kora-

# Install required dependencies
npm install
```

### 2. Configure Environment Variables
Create a `.env` file at the root of your project:
```env
# Server Ingress Port
PORT=3000

# Firebase Client Configuration (Optional - for Cloud Sync features)
# If left blank, Kora will fallback to offline-only IndexedDB mode
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser to interact with your local library.

### 4. Production Build & Execution
To pre-compile and bundle the application into production-optimized assets:
```bash
# Compile client assets and bundle Express backend
npm run build

# Start production server
npm run start
```

---

## 📜 License

Kora is open-source software licensed under the **MIT License**. Check the [LICENSE](LICENSE) file for more information.

---

<p align="center">
  Designed with ☕ and passion by <a href="https://github.com/CHAOTIC-RAY">CHAOTIC-RAY</a>.
</p>
