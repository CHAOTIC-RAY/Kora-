/**
 * Built-in "Getting started with Kora" EPUB — injected into the library
 * after onboarding so the interactive tour lives inside a real book.
 */

import { buildEpubFromText } from "./epubTools";
import { syncBookToCloud, getLocalLibrary, type BookMetadata } from "./firebase";
import { storeBookFile, getBookFile } from "../db/indexedDB";

export const WALKTHROUGH_BOOK_ID = "kora-walkthrough-guide";
export const WALKTHROUGH_BOOK_TITLE = "Getting started with Kora";

const CHAPTERS = [
  {
    title: "Welcome to Kora",
    text: `Welcome — this short book is your interactive tour of the reader.

You'll learn how to tune the reading interface, listen with Narrator, and highlight passages. Follow the spotlight tips as they appear; each step unlocks the next.

Take your time. There is no quiz at the end — only better reading.

Tap Next on the guide card when you're ready to explore features.`,
  },
  {
    title: "What you can do here",
    text: `Kora is built around a few everyday reading habits:

Display settings — font size, theme, margins, and tap versus scroll. Open the gear in the reader chrome to try them.

Voice Narrator — headphones in the toolbar read the page aloud. Pause anytime from the mini player.

Highlights & notes — long-press a word to select it, then highlight, add a note, or look it up.

Library & Discover — your shelf lives under Library; new titles arrive from Discover.

Read tab — headlines and Daily Brief for when you want news beside your books.

The next guide steps will walk you through settings, Narrator, and highlighting on this very page. Keep reading here while you follow along.`,
  },
  {
    title: "Practice paragraph",
    text: `Use this paragraph for practice. Long-press any word below to select it — try “whisper,” “lantern,” or “chapter.”

The evening light settled across the desk like a soft whisper. A single lantern threw a warm pool onto the open chapter, and the page waited — patient, familiar, ready for whatever came next.

When you have changed the font size and tried a highlight, the guide will offer shortcuts to Discover (for your first download) and the Read tab.`,
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
    dateAdded: now + 1_000_000_000, // pin near top of “Newest”
    description: "Interactive walkthrough of the Kora reader — settings, Narrator, and highlights.",
  };
}

/** Ensure the walkthrough EPUB exists in library + IndexedDB. Returns metadata. */
export async function ensureWalkthroughBook(userId: string): Promise<BookMetadata> {
  const existingMeta = getLocalLibrary().find((b) => b.id === WALKTHROUGH_BOOK_ID);
  const cached = await getBookFile(WALKTHROUGH_BOOK_ID);

  if (existingMeta && cached?.blob) {
    return existingMeta;
  }

  const blob = await buildEpubFromText({
    title: WALKTHROUGH_BOOK_TITLE,
    creator: "Kora",
    language: "en",
    chapters: CHAPTERS,
  });

  const meta = existingMeta
    ? { ...existingMeta, size: `${(blob.size / 1024).toFixed(1)} KB`, dateModified: Date.now() }
    : { ...buildMetadata(), size: `${(blob.size / 1024).toFixed(1)} KB` };

  await storeBookFile(WALKTHROUGH_BOOK_ID, blob, meta.filename || "getting-started-with-kora.epub", "epub");
  await syncBookToCloud(userId || "", meta);
  return meta;
}

export function isWalkthroughBook(book: { id?: string } | null | undefined): boolean {
  return book?.id === WALKTHROUGH_BOOK_ID;
}
