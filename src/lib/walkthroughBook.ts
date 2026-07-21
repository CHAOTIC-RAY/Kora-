/**
 * Built-in "Getting started with Kora" EPUB — always available in the library
 * (can be hidden). Content is the tour; no spotlight overlay inside the reader.
 */

import { buildEpubFromText } from "./epubTools";
import { syncBookToCloud, getLocalLibrary, type BookMetadata } from "./firebase";
import { storeBookFile, getBookFile } from "../db/indexedDB";

export const WALKTHROUGH_BOOK_ID = "kora-walkthrough-guide";
export const WALKTHROUGH_BOOK_TITLE = "Getting started with Kora";
/** Bump to rebuild EPUB for users who already have an older copy */
export const WALKTHROUGH_CONTENT_VERSION = 4;

const HIDDEN_KEY = "kora_walkthrough_book_hidden";
const VERSION_KEY = "kora_walkthrough_book_version";

const CHAPTERS: Array<{ title: string; text?: string; html?: string }> = [
  {
    title: "Welcome to Kora",
    text: `Welcome — this short book is your map of Kora.

Read it like any other title. Turn pages at your own pace. There is no quiz and no popup tour inside these chapters: everything useful is written here.

You will learn how the Library shelf works, how Discover finds new books, how the reader settings feel, how Voice Narrator speaks a page, and how highlights and notes stick to a passage.

When you reach the last chapter, you can download your first real book or jump into other optional guides from Lounge.`,
  },
  {
    title: "Your library shelf",
    text: `Library is home.

Every downloaded or imported title lands on this shelf. Tap a cover to open it. Progress bars show how far you have read. The three-dot menu on a book lets you edit cover and metadata, organize tags, or remove a title.

Getting started with Kora (this book) sits near the top of Newest so you can find it again. Prefer a clean shelf? Hide this book from its menu — Show book appears at the top of Library when it is hidden.

Offline copies show a checkmark. Cloud-only titles download when you open them, if sync is set up.`,
  },
  {
    title: "Discover new books",
    text: `Discover is where new reading starts.

Search by title or author, skim results, and download a format you like. Downloads appear in Library when they finish. You can pause, resume, or stop a download from Library while it runs.

After you finish this guide book, the last chapter can send you on a First book tour that walks through a real search and download.`,
  },
  {
    title: "Lounge & Continue",
    text: `Lounge is a calm home screen for what you were doing.

Continue picks up your latest book or audiobook. Paper and Discover tiles jump you into news and search. Guides cards offer optional spotlight tours later — sync, news sources, audiobook tools, and more.

You do not need Lounge to read. It is there when you want a single place to resume and explore.`,
  },
  {
    title: "Reading settings",
    text: `Open any ebook, then tap the gear in the top bar.

Font size — A+ and A− until the page feels comfortable.
Theme — Sepia, Night, Paper, and others.
Typeface — Lora, Lexend, Inter, and more.
Spacing — line height, letter spacing, and margins.
Layout — paginated pages or continuous scroll. Try both; continuous scroll makes selecting text feel most like a normal web page.

Page-turn zones, swipe options, and brightness live in the same panel. Changes apply immediately and sync with your other Kora preferences.`,
  },
  {
    title: "Voice Narrator",
    text: `While a book is open, tap the headphones icon to hear the current chapter.

Pick a system voice and speed, then press Play. Pause anytime from the panel or the mini player. Narrator is meant for the page you are on — for longer offline audiobooks generated from text, open Tools → Read Aloud later.`,
  },
  {
    title: "Highlights, notes & dictionary",
    text: `Long-press a word (or drag across a phrase) to select it.

When the toolbar appears you can:
• Highlight — yellow, green, blue, or pink
• Note — attach a thought to the passage
• Dictionary — look up a word offline when available
• Copy or share — depending on your device

Practice on the next chapter. If selection feels stubborn in paginated mode, switch the gear to continuous scroll — then try again.`,
  },
  {
    title: "Practice — try a highlight",
    text: `Use this page for practice. Long-press any word below — try “whisper,” “lantern,” or “chapter.”

The evening light settled across the desk like a soft whisper. A single lantern threw a warm pool onto the open chapter, and the page waited — patient, familiar, ready for whatever came next.

A second paragraph gives you more room to drag a longer selection. The margin notes you save here stay with this book, just like any other title on your shelf.

When you are done practicing, turn to the last chapter for Download your first book and a list of other optional guides.`,
  },
  {
    title: "Read tab & Daily Brief",
    text: `The Read tab is your morning paper.

Open headlines, save articles, and skim the Daily Brief when you want news beside your books. Feed sources can be managed from Read — add, remove, or reorder what you follow.

A separate Lounge guide can walk through Read in more detail when you want it.`,
  },
  {
    title: "Sync across devices",
    text: `Sign in to keep library progress and preferences aligned across phones and tablets.

Tools → Devices & Sync shows linked devices and sync options. Anonymous use still works on one device; signing in unlocks cross-device continuity.

There is an optional Setup & sync guide in Lounge if you want a step-by-step walkthrough later.`,
  },
  {
    title: "What's next",
    html: `<p>You have the lay of the land. Explore this book anytime — or hide it from Library when you are done.</p>
<p><strong>Download your first book</strong> opens Discover and starts a short download tour.</p>
<p class="kora-cta-row">
<button type="button" data-kora-guide-cta="first-book">Download your first book</button>
</p>
<p><strong>Other optional guides</strong> (also in Lounge → Guides):</p>
<ul class="kora-guide-list">
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="first-book-search">Find your first book — search &amp; download</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="sync-setup">Setup &amp; sync — prefs and devices</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="news-feed">Morning paper — Read tab &amp; headlines</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="reader-tour">Reader studio — settings, narrator, notes</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="narrator-mode">Voice Narrator — hands-free reading</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="audiobook-generator">Audiobook generator — text to audio</button></li>
<li><button type="button" data-kora-guide-cta="start-guide" data-guide-id="add-news-source">Add a news source</button></li>
</ul>
<p class="kora-cta-row">
<button type="button" data-kora-guide-cta="more-guides" class="kora-cta-secondary">Open Lounge guides</button>
</p>
<p>Tip: swipe away guide cards on Lounge to hide them. You can always reopen this book from Library.</p>`,
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
    description: "A short guide book for Library, Discover, reader settings, Narrator, and highlights.",
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
