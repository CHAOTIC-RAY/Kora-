# Kora — New Features & Improvements Plan

_Last updated: 2026-07-19 · baseline commit `cc7e8da`_

Kora today: React + Vite + Cloudflare Workers/Pages, Firebase sync, Rave book
search, background downloads (Background Fetch + SW), offline app shell,
KOReader-style EPUB reader. This plan is the **next wave of features** on top of
that foundation, ordered by user impact.

---

## 1. Reading Experience (the KOReader north star)

### F1 — Reading themes & typography engine
- Sepia / Night / Paper / Black (OLED) themes, one-tap switch.
- Bundled reading fonts: serif (Bookerly-like), sans, **OpenDyslexic**.
- Presets for margin / line-height / justification, KOReader-style.
- Per-book overrides remembered.

### F2 — Highlights, notes & annotations hub
- Long-press to highlight (4 colors) + inline note.
- Per-book "Annotations" drawer listing all highlights/notes with jump-to.
- **Export to Markdown / clipboard** (great for Obsidian users).
- Sync via Firebase (schema already stores highlights).

### F3 — TOC & quick navigation drawer
- Slide-over chapter list with current-chapter highlight.
- Progress scrubber with chapter tick marks.
- "Back to previous location" after a TOC jump.

### F4 — Reading stats & streaks
- Time-read tracking, pages/day, streak calendar (extend existing stats card).
- Per-book "time left in chapter / book" estimate.

### F5 — Text-to-speech (read aloud)
- Web Speech API narration with play/pause, speed, sentence highlight.
- Optional background playback with media-session controls.

---

## 2. Library & Organization

### F6 — Collections / shelves
- User-created shelves beyond tags; drag-to-shelf.
- Smart shelves (Unread, In Progress, Finished, By author).

### F7 — In-library search & sort
- Instant client-side filter (title/author/tag), sort by added/last-read/title.

### F8 — Bulk actions & library health
- Multi-select delete/tag/move (manage-mode exists — extend it).
- "Storage used" view + clear-cache per book.

### F9 — Import / export
- Sideload local EPUB/PDF from device.
- Export library metadata (JSON) + re-import for backup/migration.

---

## 3. Discovery & Content

### F10 — Fix & expand Discover
- Resolve NYT key properly (`wrangler secret put NYT_BOOKS_API_KEY`) OR commit
  fully to Rave and drop NYT (stop masking with fallback).
- Add more feeds: Trending, By genre, "Because you read X".

### F11 — Author & series pages
- Tap author → all their books; detect & group series.

### F12 — Recommendations
- Simple "readers also downloaded" / genre-based suggestions.

---

## 4. Sync, Offline & Reliability

### F13 — Download resume & queue
- HTTP Range-based resume for interrupted downloads (no restart).
- A real download **queue** (sequential, with reorder/cancel).

### F14 — Cross-device continuity
- "Continue reading" surfaced on launch; last-position sync verified.
- Conflict resolution for highlights/notes edited on two devices.

### F15 — Offline cover cache
- Cache proxied covers in the SW so library loads instantly offline.

---

## 5. Platform & Polish

### F16 — PWA install & onboarding
- "Add to Home Screen" prompt (manifest is already standalone).
- First-run walkthrough (onboarding hook already exists).

### F17 — Performance
- Lazy-load the reader + heavy views; audit lucide-react tree-shaking.
- Virtualize the library grid for large collections.

### F18 — Accessibility
- Full keyboard nav, ARIA labels, focus rings, reduced-motion support.

---

## Suggested sequencing

| Phase | Items | Why |
|-------|-------|-----|
| **A** | F13 (resume/queue), F2 (annotations hub), F3 (TOC drawer) | Fixes the recurring download pain + biggest reader wins |
| **B** | F1 (themes/fonts), F6 (shelves), F7 (search/sort) | Daily-use polish |
| **C** | F10 (Discover/NYT), F14 (continuity), F15 (cover cache) | Content + reliability |
| **D** | F4, F5, F9, F16, F17, F18 | Depth & platform |

**Recommended first:** Phase A — start with **F13 (download resume/queue)** since
downloads are the most-reported issue, then **F2 (annotations hub)** as the
highest-value reader feature.
