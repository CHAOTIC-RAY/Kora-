/**
 * Built-in "Getting started with Kora" EPUB — always available in the library
 * (can be hidden). In-reader spotlights cover settings and Narrator;
 * terms, P2P sync, and next steps live in the book (no final popup).
 */

import { buildEpubFromText } from "./epubTools";
import { syncBookToCloud, getLocalLibrary, type BookMetadata } from "./firebase";
import { storeBookFile, getBookFile } from "../db/indexedDB";

export const WALKTHROUGH_BOOK_ID = "kora-walkthrough-guide";
export const WALKTHROUGH_BOOK_TITLE = "Getting started with Kora";
/** Bump to rebuild EPUB for users who already have an older copy */
export const WALKTHROUGH_CONTENT_VERSION = 7;

const HIDDEN_KEY = "kora_walkthrough_book_hidden";
const VERSION_KEY = "kora_walkthrough_book_version";
const ADVANCED_MENU_KEY = "kora_walkthrough_book_advanced_menu";

const CHAPTERS: Array<{ title: string; text?: string; html?: string }> = [
  {
    title: "Welcome",
    html: `<div class="kora-guide-wrap">
<section class="kora-guide-card">
<p class="kora-lead"><strong>Welcome to Kora.</strong> This short guide lives on your shelf — read it at your own pace.</p>
<p>Spotlight tips appear inside the reader for settings and Voice Narrator. After that, keep scrolling here for sync, terms, and next steps.</p>
</section>
<section class="kora-guide-card kora-guide-muted">
<p class="kora-label">Quick map</p>
<ul class="kora-checklist">
<li><strong>Library</strong> — your shelf</li>
<li><strong>Discover</strong> — search &amp; download</li>
<li><strong>Lounge</strong> — resume &amp; optional tours</li>
<li><strong>Tools</strong> — P2P sync &amp; devices</li>
</ul>
</section>
</div>`,
  },
  {
    title: "Library & Discover",
    html: `<div class="kora-guide-wrap">
<section class="kora-guide-card">
<p class="kora-label">Library</p>
<p>Every downloaded or imported title lands here. Tap a cover to open it. Progress bars show how far you have read.</p>
<p>This guide book sits near the top of <strong>Newest</strong>. Hide it from the library menu (⋯) anytime — <strong>Show book</strong> appears when hidden.</p>
</section>
<section class="kora-guide-card">
<p class="kora-label">Discover</p>
<p>Search by title or author, pick a format, and download. Finished downloads appear in Library. Pause or stop downloads from the shelf while they run.</p>
</section>
</div>`,
  },
  {
    title: "P2P sync & devices",
    html: `<div class="kora-guide-wrap">
<section class="kora-guide-card">
<p class="kora-lead"><strong>How sync works in Kora</strong></p>
<p>Kora keeps <strong>book files on your device</strong>. Sign-in syncs shelf metadata, reading progress, highlights, and notes — not the raw EPUB bytes.</p>
</section>
<section class="kora-guide-card">
<p class="kora-label">Peer-to-peer (P2P) transfer</p>
<p>When a title shows a <strong>P2P</strong> badge, another nearby device running Kora may share the file directly — no cloud upload of the book itself.</p>
<ul class="kora-checklist">
<li>Open <strong>Tools → Devices &amp; Sync</strong></li>
<li>Enable sharing on both devices on the same network</li>
<li>Tap a cloud-only book — proximity transfer can fill the local copy</li>
</ul>
<p class="kora-note">P2P is optional and device-local. It speeds up moving files you already own between your own phones or tablets.</p>
</section>
<section class="kora-guide-card kora-guide-muted">
<p class="kora-label">Account sync</p>
<p>Sign in to align progress across devices. WebDAV and manual export also live under Devices &amp; Sync for power users.</p>
<p class="kora-cta-row">
<button type="button" data-kora-guide-cta="start-guide" data-guide-id="sync-setup">Start sync setup tour</button>
</p>
</section>
</div>`,
  },
  {
    title: "Reading & Narrator",
    html: `<div class="kora-guide-wrap">
<section class="kora-guide-card">
<p class="kora-label">Reader settings</p>
<p>Tap the <strong>gear</strong> in any book for font size, theme, spacing, and scroll vs pages. The spotlight tour will ask you to try a couple of settings.</p>
</section>
<section class="kora-guide-card">
<p class="kora-label">Voice Narrator</p>
<p>Tap <strong>headphones</strong> to hear the current chapter. Pause anytime from the panel or mini player.</p>
</section>
<section class="kora-guide-card kora-guide-muted">
<p class="kora-label">Highlights &amp; notes</p>
<p>Long-press any word to highlight, add a note, or look up a definition. Works in every book once the tour finishes.</p>
</section>
</div>`,
  },
  {
    title: "Terms (summary)",
    html: `<div class="kora-guide-wrap">
<section class="kora-guide-card">
<p class="kora-lead">You agreed to these during setup. Key points:</p>
<ol class="kora-terms-list">
<li><strong>Client only</strong> — Kora queries third-party indices; it does not host files.</li>
<li><strong>Your responsibility</strong> — Only access works you have the right to use.</li>
<li><strong>No piracy</strong> — Do not infringe copyright.</li>
<li><strong>Takedowns</strong> — Contact the host platform, not Kora.</li>
<li><strong>Privacy</strong> — Files and notes stay on your device unless you sync metadata.</li>
<li><strong>No warranty</strong> — Use third-party links at your own risk.</li>
</ol>
</section>
</div>`,
  },
  {
    title: "What's next",
    html: `<div class="kora-guide-wrap">
<section class="kora-guide-card">
<p class="kora-lead"><strong>Tour complete.</strong> Pick a next step:</p>
<p class="kora-cta-row">
<button type="button" data-kora-guide-cta="first-book">Download your first book</button>
</p>
</section>
<section class="kora-guide-card kora-guide-muted">
<p class="kora-label">More guides (Lounge → Guides)</p>
<ul class="kora-guide-list">
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="first-book-search">Find your first book</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="sync-setup">Setup &amp; sync</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="news-feed">Morning paper — Read tab</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="narrator-mode">Voice Narrator deep dive</button></li>
</ul>
<p class="kora-cta-row">
<button type="button" data-kora-guide-cta="more-guides" class="kora-cta-secondary">Open Lounge guides</button>
</p>
</section>
<p class="kora-footnote">Hide this guide from its library menu anytime. Reopen from Library when you want a refresher.</p>
</div>`,
  },
];

function buildMetadata(): BookMetadata {
  const now = Date.now();
  return {
    id: WALKTHROUGH_BOOK_ID,
    title: WALKTHROUGH_BOOK_TITLE,
    author: "Kora",
    filename: "getting-started-with-kora.epub",
    extension: "epub",
    size: "—",
    language: "en",
    source: "kora-guide",
    tags: ["Guide", "Kora"],
    status: "to-read",
    progress: {
      percent: 0,
      lastReadTime: now,
    },
    dateAdded: now + 1_000_000_000,
    description: "Interactive walkthrough: settings, Narrator, P2P sync, terms, and next steps.",
  };
}

export function isWalkthroughBookHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function setWalkthroughBookHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, "true");
    else localStorage.removeItem(HIDDEN_KEY);
    window.dispatchEvent(new CustomEvent("kora-walkthrough-visibility"));
  } catch {
    /* ignore */
  }
}

/** When false (default), the walkthrough book only offers Hide in library menus. */
export function isWalkthroughAdvancedMenuEnabled(): boolean {
  try {
    return localStorage.getItem(ADVANCED_MENU_KEY) === "true";
  } catch {
    return false;
  }
}

export function setWalkthroughAdvancedMenuEnabled(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(ADVANCED_MENU_KEY, "true");
    else localStorage.removeItem(ADVANCED_MENU_KEY);
    window.dispatchEvent(new CustomEvent("kora-walkthrough-visibility"));
  } catch {
    /* ignore */
  }
}

function storedContentVersion(): number {
  try {
    return Number(localStorage.getItem(VERSION_KEY) || "0") || 0;
  } catch {
    return 0;
  }
}

function setStoredContentVersion(v: number) {
  try {
    localStorage.setItem(VERSION_KEY, String(v));
  } catch {
    /* ignore */
  }
}

/** Ensure the walkthrough EPUB exists in library + IndexedDB. Returns metadata. */
export async function ensureWalkthroughBook(userId: string): Promise<BookMetadata> {
  const existingMeta = getLocalLibrary().find((b) => b.id === WALKTHROUGH_BOOK_ID);
  const cached = await getBookFile(WALKTHROUGH_BOOK_ID);
  const needsRebuild = !cached?.blob || storedContentVersion() < WALKTHROUGH_CONTENT_VERSION;

  if (existingMeta && cached?.blob && !needsRebuild) {
    return existingMeta;
  }

  const blob = await buildEpubFromText({
    title: WALKTHROUGH_BOOK_TITLE,
    creator: "Kora",
    language: "en",
    chapters: CHAPTERS as Array<{ title: string; text: string; html?: string }>,
  });

  const meta = existingMeta
    ? { ...existingMeta, size: `${(blob.size / 1024).toFixed(1)} KB`, dateModified: Date.now() }
    : { ...buildMetadata(), size: `${(blob.size / 1024).toFixed(1)} KB` };

  await storeBookFile(WALKTHROUGH_BOOK_ID, blob, meta.filename || "getting-started-with-kora.epub", "epub");
  await syncBookToCloud(userId || "", meta);
  setStoredContentVersion(WALKTHROUGH_CONTENT_VERSION);
  return meta;
}

/** Soft-hide from library UI (file stays on device for instant reopen). */
export function hideWalkthroughBookFromLibrary() {
  setWalkthroughBookHidden(true);
}

/** Un-hide and ensure the book is seeded. */
export async function showWalkthroughBookInLibrary(userId: string): Promise<BookMetadata> {
  setWalkthroughBookHidden(false);
  return ensureWalkthroughBook(userId);
}

export function isWalkthroughBook(book: { id?: string } | null | undefined): boolean {
  return book?.id === WALKTHROUGH_BOOK_ID;
}
