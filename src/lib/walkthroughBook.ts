/**
 * Built-in "Getting started with Kora" EPUB — always available in the library
 * (can be hidden). In-reader spotlights cover settings and Narrator;
 * terms and next steps live in the last chapters (no final popup).
 */

import { buildEpubFromText } from "./epubTools";
import { syncBookToCloud, getLocalLibrary, type BookMetadata } from "./firebase";
import { storeBookFile, getBookFile } from "../db/indexedDB";

export const WALKTHROUGH_BOOK_ID = "kora-walkthrough-guide";
export const WALKTHROUGH_BOOK_TITLE = "Getting started with Kora";
/** Bump to rebuild EPUB for users who already have an older copy */
export const WALKTHROUGH_CONTENT_VERSION = 6;

const HIDDEN_KEY = "kora_walkthrough_book_hidden";
const VERSION_KEY = "kora_walkthrough_book_version";
const ADVANCED_MENU_KEY = "kora_walkthrough_book_advanced_menu";

const CHAPTERS: Array<{ title: string; text?: string; html?: string }> = [
  {
    title: "Welcome",
    text: `Welcome — this short guide walks you through Kora.

Spotlight tips appear as you read. They cover display settings and Voice Narrator. Tap Next on each tip, or Skip step if you already know the gesture.

After Narrator, the spotlights stop. Keep scrolling for terms and what to do next — everything is in this book, with no final popup.`,
  },
  {
    title: "Library & Discover",
    text: `Library is home — every title you download or import lands on the shelf. Tap a cover to open it; progress bars show how far you have read.

Discover is where new reading starts. Search by title or author, pick a format, and download. Finished downloads appear in Library.

This guide book sits near the top of Newest. Hide it from the library menu anytime — Show book appears at the top when it is hidden.`,
  },
  {
    title: "Lounge",
    text: `Lounge is an optional home screen: Continue resumes your latest book, and Guides cards offer extra spotlight tours later (sync, news, audiobooks).

You do not need Lounge to read. It is there when you want one place to resume and explore.`,
  },
  {
    title: "Reading & Narrator",
    text: `Tap the gear in the reader for font size, theme, spacing, and scroll vs pages. The spotlight tour will ask you to try a couple of settings.

Tap headphones to hear the current chapter with Voice Narrator. Pause anytime from the panel or mini player.

Long-press text in any book to highlight, add a note, or look up a word — try it whenever you like.`,
  },
  {
    title: "Terms (summary)",
    text: `Important points — full legal text appears during onboarding. By using Kora you agree that:

1. Client only — Kora is a reader and search client. It does not host book files; it queries third-party indices you choose.

2. Your responsibility — Comply with copyright where you live. Only access works you have the right to use.

3. No piracy — Do not infringe copyright or distribute protected works without permission.

4. Takedowns — Kora cannot remove files at their source; rights holders contact the host platform.

5. Privacy — Progress and notes stay in your browser. Optional sign-in syncs metadata, not your files.

6. No warranty — Kora is provided as-is; third-party links are at your own risk.`,
  },
  {
    title: "What's next",
    html: `<p><strong>You're done with the tour.</strong> Use the buttons below when you're ready.</p>
<p class="kora-cta-row">
<button type="button" data-kora-guide-cta="first-book">Download your first book</button>
</p>
<p><strong>More optional guides</strong> (Lounge → Guides):</p>
<ul class="kora-guide-list">
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="first-book-search">Find your first book</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="sync-setup">Setup &amp; sync</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="news-feed">Morning paper — Read tab</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="narrator-mode">Voice Narrator deep dive</button></li>
</ul>
<p class="kora-cta-row">
<button type="button" data-kora-guide-cta="more-guides" class="kora-cta-secondary">Open Lounge guides</button>
</p>
<p>Hide this guide from its library menu (⋯) anytime. Reopen from Library when you want a refresher.</p>`,
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
    description: "Short interactive walkthrough: settings, Narrator, terms, and next steps in the book.",
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
