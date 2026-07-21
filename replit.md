# Kora — Your Reading Lounge

A Kindle-inspired ebook reader built with React 19, Vite 6, Tailwind CSS 4, and an Express backend. Supports offline-first reading via IndexedDB, with optional Firebase cloud sync.

## How to run

The dev workflow (`Start application`) runs `npm run dev`, which boots the Express + Vite dev server on **port 5000**.

```bash
npm run dev       # development (Express + Vite HMR)
npm run build     # production build
npm run start     # serve production build
```

## Environment variables

Firebase is **optional** — without it the app falls back to offline-only IndexedDB mode.

| Variable | Description |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase project API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |
| `GEMINI_API_KEY` | Google Gemini API key (for AI features) |

See `.env.example` for reference.

## Stack

- **Frontend**: React 19, Vite 6, Tailwind CSS 4, Lucide React, Motion
- **Backend**: Express (TypeScript, `server.ts`)
- **Storage**: IndexedDB (offline-first) + optional Firebase Firestore sync
- **Auth**: Firebase Auth (optional)
- **Build**: esbuild (server bundle), Vite (client bundle)

## User preferences

_None recorded yet._
