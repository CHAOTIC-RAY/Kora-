/**
 * Built-in "Getting started with Kora" EPUB — always available in the library
 * (can be hidden). In-reader spotlights cover settings/Narrator/highlight;
 * the last chapters (terms + what's next) are read without a final popup.
 */

import { buildEpubFromText } from "./epubTools";
import { syncBookToCloud, getLocalLibrary, type BookMetadata } from "./firebase";
import { storeBookFile, getBookFile } from "../db/indexedDB";

export const WALKTHROUGH_BOOK_ID = "kora-walkthrough-guide";
export const WALKTHROUGH_BOOK_TITLE = "Getting started with Kora";
/** Bump to rebuild EPUB for users who already have an older copy */
export const WALKTHROUGH_CONTENT_VERSION = 5;

const HIDDEN_KEY = "kora_walkthrough_book_hidden";
const VERSION_KEY = "kora_walkthrough_book_version";

const CHAPTERS: Array<{ title: string; text?: string; html?: string }> = [
  {
    title: "Welcome to Kora",
    text: `Welcome — this short book is your interactive tour of Kora.

As you read, spotlight tips will appear over the reader. They walk you through display settings, Voice Narrator, and highlights. Follow along at your own pace — tap Next on each tip, or Skip step if you already know the gesture.

After the highlight step, the spotlights stop. Scroll through the remaining chapters here for terms, regulations, and what to do next. There is no final popup — everything you need is on the page.`,
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

The last chapter of this guide includes a button to download your first real book.`,
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
Layout — paginated pages or continuous scroll.

The spotlight tour will ask you to open settings and change the font size plus one more preference. Page-turn zones, swipe options, and brightness live in the same panel.`,
  },
  {
    title: "Voice Narrator",
    text: `While a book is open, tap the headphones icon to hear the current chapter.

Pick a system voice and speed, then press Play. Pause anytime from the panel or the mini player. The tour will ask you to try Narrator on this page.

For longer offline audiobooks generated from text, open Tools → Read Aloud later.`,
  },
  {
    title: "Highlights, notes & dictionary",
    text: `Long-press a word (or drag across a phrase) to select it.

When the toolbar appears you can:
• Highlight — yellow, green, blue, or pink
• Note — attach a thought to the passage
• Dictionary — look up a word offline when available
• Copy or share — depending on your device

The spotlight tour ends after you make a selection. Practice on the next chapter if you want a second try.`,
  },
  {
    title: "Practice — try a highlight",
    text: `Use this page for practice. Long-press any word below — try “whisper,” “lantern,” or “chapter.”

The evening light settled across the desk like a soft whisper. A single lantern threw a warm pool onto the open chapter, and the page waited — patient, familiar, ready for whatever came next.

A second paragraph gives you more room to drag a longer selection. The margin notes you save here stay with this book, just like any other title on your shelf.

When you are done, keep scrolling — terms and next steps are in the chapters ahead.`,
  },
  {
    title: "Read tab & sync (short)",
    text: `Read tab — headlines and Daily Brief when you want news beside your books. Manage feed sources from Read.

Sync — sign in to align library progress and preferences across devices. Tools → Devices & Sync lists linked devices. Book files stay on each device; metadata and progress can sync when you are signed in.

Optional Lounge guides cover Read and sync in more detail later.`,
  },
  {
    title: "Terms & regulations (summary)",
    text: `Important points — full legal text is shown during onboarding. By using Kora you agree that:

1. Client only — Kora is a reader and search client. It does not host book files on Kora servers; it queries third-party indices and mirrors you choose to use.

2. Your responsibility — You are solely responsible for complying with copyright and intellectual property laws where you live. Only download or convert works you have the right to access (public domain, open access, fair use, or a license you own).

3. No piracy — Do not use Kora to infringe copyright or distribute protected works without permission.

4. Takedowns — Kora cannot remove files at their source. Rights holders must contact the host platform or API that serves a file.

5. Privacy — Reading progress, highlights, and notes are stored locally in your browser (IndexedDB). Raw book content is not uploaded to Kora servers. Optional sign-in syncs library metadata, not your files.

6. No warranty — Kora is provided as-is. You use third-party links and tools at your own risk.

If you disagree, stop using the app and remove downloaded files from your device.`,
  },
  {
    title: "What's next — scroll to finish",
    html: `<p><strong>You are almost done.</strong> The spotlight tour is complete. Scroll through this chapter, then use the buttons below when you are ready.</p>
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
<p>You can hide this guide book anytime from its library menu (⋯). Reopen it from Library whenever you want a refresher.</p>`,
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
    description: "Interactive walkthrough: spotlights for settings, Narrator, and highlights; terms and next steps in the book.",
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
