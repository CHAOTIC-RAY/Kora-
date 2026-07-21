/**
 * Built-in "Getting started with Kora" EPUB — always available in the library
 * (can be hidden). Opening it runs the interactive in-book guide.
 */

import { buildEpubFromText } from "./epubTools";
import { syncBookToCloud, getLocalLibrary, type BookMetadata } from "./firebase";
import { storeBookFile, getBookFile } from "../db/indexedDB";

export const WALKTHROUGH_BOOK_ID = "kora-walkthrough-guide";
export const WALKTHROUGH_BOOK_TITLE = "Getting started with Kora";
/** Bump to rebuild EPUB for users who already have an older copy */
export const WALKTHROUGH_CONTENT_VERSION = 3;

const HIDDEN_KEY = "kora_walkthrough_book_hidden";
const VERSION_KEY = "kora_walkthrough_book_version";

const CHAPTERS: Array<{ title: string; text?: string; html?: string }> = [
  {
    title: "Welcome to Kora",
    text: `Welcome — this short book is your interactive tour of the reader.

You'll learn how to tune the reading interface, listen with Narrator, and highlight passages. Follow the spotlight tips as they appear; each step unlocks the next.

Take your time. There is no quiz at the end — only better reading.

When the guide card appears, tap Next to start exploring features. You can Skip step anytime without leaving the book.`,
  },
  {
    title: "What you can do here",
    text: `Kora is built around a few everyday reading habits:

Display settings — font size, theme, margins, and tap versus scroll. Open the gear in the reader chrome (top bar) to try them. The guide will ask you to change the font size and one other setting.

Voice Narrator — tap the headphones icon in the toolbar to hear this page read aloud. Pause anytime from the mini player.

Highlights & notes — long-press a word on the page to select it, then choose Highlight, Note, or Dictionary.

Library & Discover — your shelf lives under Library; new titles arrive from Discover.

Read tab — headlines and Daily Brief for when you want news beside your books.

Keep this book open while you follow the spotlight — the practice chapter ahead is for highlighting.`,
  },
  {
    title: "Reading settings",
    text: `Open the gear icon to reveal in-reader settings.

Font size — tap A+ or A− until the text feels comfortable. The guide waits for a size change.

Theme & spacing — try a reading theme, line spacing, or continuous scroll. Changing any of these continues the tour.

Margins, page-turn zones, and swipe options live in the same panel. Explore freely; your preferences sync with the rest of Kora.

When you're done adjusting, the guide moves on to Voice Narrator.`,
  },
  {
    title: "Voice Narrator",
    text: `Tap the headphones button in the reader toolbar to start Narrator on this page.

Narrator reads the current chapter aloud using your device voices. You can pause from the mini player at the bottom of the screen.

For longer conversions (full audiobooks from text), open Tools → Read Aloud later.

The next chapter is a practice paragraph — use it for highlighting.`,
  },
  {
    title: "Practice — try a highlight",
    text: `Use this paragraph for practice. Long-press any word below to select it — try “whisper,” “lantern,” or “chapter.”

The evening light settled across the desk like a soft whisper. A single lantern threw a warm pool onto the open chapter, and the page waited — patient, familiar, ready for whatever came next.

When the selection toolbar appears, tap Highlight (or Note / Dictionary). That finishes the interactive part of this tour.

Turn to the last chapter for shortcuts to download your first real book and open more guides.`,
  },
  {
    title: "What's next",
    html: `<p>You've got the reader basics. Use the buttons below — or the guide card — to keep going.</p>
<p><strong>Download your first book</strong> opens Discover and starts the first-book download tour.</p>
<p><strong>More guides</strong> takes you to Lounge, where remaining guide cards live (sync, news, audiobook tools, and more).</p>
<p class="kora-cta-row">
<button type="button" data-kora-guide-cta="first-book">First book tour</button>
<button type="button" data-kora-guide-cta="more-guides" class="kora-cta-secondary">More guides</button>
</p>
<p>You can hide this guide book anytime from its library menu (⋯). Show it again from Library filters when you want a refresher.</p>`,
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
    description: "Interactive walkthrough of the Kora reader — settings, Narrator, and highlights.",
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
