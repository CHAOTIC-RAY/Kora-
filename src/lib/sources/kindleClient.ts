/**
 * Send to Kindle — keyless, via the OS.
 *
 * ## What this actually does
 *
 * Kora does **not** talk to Amazon's servers. There is no API call here, no
 * OAuth exchange, and no credential of any kind. The file is handed to the
 * operating system, and the operating system does the rest:
 *
 *  1. **Primary (Android / any browser with Web Share Level 2).** We build a
 *     `File` from the bytes already cached locally, guard with
 *     `navigator.canShare({ files: [file] })`, and call
 *     `navigator.share({ files: [file], title })`. That opens the Android
 *     system share sheet, where the user's own "Send to Kindle" app is one
 *     tap away. Send to Kindle then uploads the file using the user's own
 *     Amazon session.
 *  2. **Fallback (desktop, or Web Share unavailable).** We save the file to
 *     disk via a blob URL + anchor download, then open
 *     https://www.amazon.com/sendtokindle in a new tab. The user drags the
 *     downloaded file onto Amazon's drop zone. One manual step — stated as
 *     such, not papered over.
 *
 * ## Why no Amazon API
 *
 * The obvious route — Amazon's KDP Personal Document Service — requires an
 * Amazon-approved developer account and a per-app OAuth token. There is no
 * anonymous path and no user-supplied-credential path. It is not an option
 * here, and it is not needed here: the share sheet already exists on the
 * user's device, and it is the same handoff the official Send to Kindle
 * email address performs.
 *
 * ## Honesty constraints
 *
 * - No API key, no OAuth app, no password, no stored secret. Ever.
 * - The desktop path does not claim to have uploaded anything. It reports
 *   that the file was saved and the page was opened, and stops there.
 * - A user cancelling the share sheet is reported as a cancellation, not a
 *   success.
 */

import type { IntegrationTarget } from "./types";

/** Amazon's plain web upload page. Public, no sign-in needed to reach it. */
export const SEND_TO_KINDLE_URL = "https://www.amazon.com/sendtokindle";

/**
 * Content types per book extension.
 *
 * Kindle's Send to Kindle accepts EPUB, MOBI, AZW, AZW3, KFX, PDF, DOC/DOCX,
 * TXT, HTML, RTF, and CBZ. EPUB is converted server-side by Amazon.
 */
export const KINDLE_MIME_TYPES: Readonly<Record<string, string>> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw: "application/vnd.amazon.ebook",
  azw3: "application/vnd.amazon.ebook",
  kfx: "application/vnd.amazon.ebook",
  pdfa: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook-rar",
};

export const DEFAULT_MIME_TYPE = "application/octet-stream";

/** Lookup a content type by extension, case- and dot-insensitively. */
export function getKindleMimeType(extension: string | undefined | null): string {
  const ext = (extension || "").trim().toLowerCase().replace(/^\./, "");
  return KINDLE_MIME_TYPES[ext] ?? DEFAULT_MIME_TYPE;
}

/** Extensions Kindle will actually accept. Used to warn, never to block. */
export const KINDLE_SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(KINDLE_MIME_TYPES);

/**
 * Build a safe, Kindle-friendly filename from a book title.
 *
 * Strips path separators and characters Amazon chokes on, and always ends in
 * the book's real extension so the share sheet labels it correctly.
 */
export function buildKindleFileName(
  title: string | undefined | null,
  extension: string | undefined | null,
  fallbackName?: string | null
): string {
  const ext = (extension || "").trim().toLowerCase().replace(/^\./, "") || "epub";
  const raw = (fallbackName || "").trim();
  const base =
    (title || "").trim() ||
    (raw ? raw.replace(/\.[^/.]+$/, "") : "") ||
    "book";
  const safeTitle = base.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${safeTitle || "book"}.${ext}`;
}

// ---------------------------------------------------------------------------
// Injectable seams.
//
// Every host capability this module touches (navigator.share, document, the
// blob URL API, the cache lookup) is reached through a default implementation
// that can be replaced. That keeps the module unit-testable under plain Node
// with no DOM, and keeps every failure mode observable to the caller.
// ---------------------------------------------------------------------------

export interface CachedBookFileLike {
  bookId: string;
  blob: Blob;
  fileName: string;
  extension: string;
  savedAt: number;
}

export interface ShareNavigatorLike {
  canShare?: (data?: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<unknown>;
}

export interface AnchorLike {
  href: string;
  download: string;
  click: () => void;
  remove: () => void;
}

export interface DocumentLike {
  createElement: (tag: string) => AnchorLike;
  body: { appendChild: (el: AnchorLike) => void } | null;
}

export type KindleSendMethod = "share" | "download";

export interface KindleSendResult {
  ok: boolean;
  /** Which path actually ran. */
  method: KindleSendMethod;
  fileName: string;
  mimeType: string;
  /** True when the user dismissed the share sheet themselves. */
  cancelled?: boolean;
  /** Present on failure: a plain-language explanation. */
  reason?: string;
}

export interface SendToKindleDeps {
  navigator?: ShareNavigatorLike;
  document?: DocumentLike;
  openUrl?: (url: string) => void;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  /** Resolves the cached bytes for a book. Defaults to the app's IndexedDB store. */
  getCachedFile?: (bookId: string) => Promise<CachedBookFileLike | null>;
}

function defaultGetCachedFile(bookId: string): Promise<CachedBookFileLike | null> {
  // Imported lazily so this module stays importable (and testable) in Node.
  return import("../../db/indexedDB").then((m) => m.getBookFile(bookId)) as Promise<CachedBookFileLike | null>;
}

function resolve<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

function defaultOpenUrl(url: string): void {
  try {
    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch {
    /* popup blocked — the file is already on disk, so this is not fatal */
  }
}

/**
 * True whenever the keyless handoff is possible at all.
 *
 * Always true. No credential can make it false, and none is ever asked for —
 * that is the entire design.
 */
export function isSendToKindleAvailable(): boolean {
  return true;
}

/**
 * Whether this particular runtime can hand a *file* to the OS share sheet.
 *
 * This only selects between the share path and the download path; it is never
 * presented to the user as "Send to Kindle is unavailable".
 */
export function canShareFiles(nav?: ShareNavigatorLike): boolean {
  const n = resolve(nav, typeof navigator === "undefined" ? undefined : (navigator as unknown as ShareNavigatorLike));
  if (!n || typeof n.canShare !== "function") return false;
  try {
    // Probe with a tiny real File: some engines expose canShare but reject
    // files they consider unsupported, and only a real File tells us.
    const probe = new File([new Uint8Array([0])], "probe.epub", { type: "application/epub+zip" });
    return n.canShare({ files: [probe] }) === true;
  } catch {
    return false;
  }
}

export interface KindleStatus {
  target: IntegrationTarget;
  available: boolean;
  /** Never anything other than false. There is no credential in this flow. */
  requiresCredentials: boolean;
  /** How the handoff works, in plain language. Shown verbatim in settings. */
  reason: string;
  uploadUrl: string;
  /** What the current runtime will actually do. */
  method: KindleSendMethod;
  alternatives: string[];
}

export const KINDLE_STATUS_REASON =
  "No account, API key, or password is needed. Kora never contacts Amazon.\n\n" +
  "On Android, Kora hands the book file to the system share sheet — tap " +
  '"Send to Kindle" there and Amazon\'s own app does the upload using your ' +
  "existing Amazon sign-in.\n\n" +
  "On a desktop browser, the system share sheet is not available, so Kora " +
  "saves the file to your downloads folder and opens Amazon's upload page at " +
  "sendtokindle.com. You then drag the file onto Amazon's drop zone — that " +
  "last drag is a manual step, and Kora does not pretend to have done it.";

export function getKindleStatus(): KindleStatus {
  return {
    target: "kindle",
    available: true,
    requiresCredentials: false,
    reason: KINDLE_STATUS_REASON,
    uploadUrl: SEND_TO_KINDLE_URL,
    method: canShareFiles() ? "share" : "download",
    alternatives: [
      "On Android: the system share sheet, where your Send to Kindle app appears",
      "On desktop: Kora saves the file, then opens Amazon's upload page for a drag-and-drop",
      "Any email address to your @kindle.com address, if you prefer email",
    ],
  };
}

/**
 * Hand a cached book to Kindle. No credentials, at any point.
 *
 * @param bookId   Id of a book whose bytes are already in the local cache.
 * @param title    Book title, used for the share-sheet title and the filename.
 * @param extension Book extension (no dot). Falls back to the cached record.
 */
export async function sendToKindle(
  bookId: string,
  title?: string,
  extension?: string,
  deps: SendToKindleDeps = {}
): Promise<KindleSendResult> {
  const nav = resolve(deps.navigator, typeof navigator === "undefined" ? undefined : (navigator as unknown as ShareNavigatorLike));
  const doc = resolve(deps.document, typeof document === "undefined" ? undefined : (document as unknown as DocumentLike));
  const getCachedFile = resolve(deps.getCachedFile, defaultGetCachedFile);
  const openUrl = resolve(deps.openUrl, defaultOpenUrl);
  const createObjectUrl = resolve(
    deps.createObjectUrl,
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? (blob: Blob) => URL.createObjectURL(blob)
      : undefined
  );
  const revokeObjectUrl = resolve(
    deps.revokeObjectUrl,
    typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function"
      ? (url: string) => URL.revokeObjectURL(url)
      : undefined
  );

  // 1. Get the bytes Kora already has. No second cache, no re-download.
  let cached: CachedBookFileLike | null = null;
  try {
    cached = await getCachedFile(bookId);
  } catch (err) {
    return {
      ok: false,
      method: "share",
      fileName: "",
      mimeType: DEFAULT_MIME_TYPE,
      reason: `Could not read the cached book file: ${(err as Error)?.message ?? err}`,
    };
  }

  if (!cached || !cached.blob) {
    return {
      ok: false,
      method: "share",
      fileName: "",
      mimeType: DEFAULT_MIME_TYPE,
      reason:
        "This book isn't downloaded on this device yet. Download it first, then send it to Kindle.",
    };
  }

  const ext = (extension || cached.extension || "").trim().toLowerCase().replace(/^\./, "");
  const mimeType = getKindleMimeType(ext);
  const fileName = buildKindleFileName(title, ext, cached.fileName);

  // 2. Primary path: hand the file to the OS share sheet.
  if (canShareFiles(nav) && nav?.share) {
    try {
      const file = new File([cached.blob], fileName, { type: mimeType });
      await nav.share({ files: [file], title: title || fileName });
      return { ok: true, method: "share", fileName, mimeType };
    } catch (err: any) {
      // A dismissed share sheet is a user decision, not a failure to report
      // as success — and it must not trigger a surprise file download.
      if (err?.name === "AbortError") {
        return { ok: false, method: "share", fileName, mimeType, cancelled: true, reason: "Share cancelled." };
      }
      // Any other share failure (engine quirk, no share target) falls through
      // to the download path rather than dead-ending the user.
    }
  }

  // 3. Fallback: save the file, then open Amazon's upload page.
  if (!createObjectUrl || !doc?.createElement) {
    return {
      ok: false,
      method: "download",
      fileName,
      mimeType,
      reason: "This browser can neither share a file nor save one. Try the Download button instead.",
    };
  }

  let url: string | null = null;
  try {
    url = createObjectUrl(cached.blob);
    const a = doc.createElement("a");
    a.href = url;
    a.download = fileName;
    doc.body?.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    return {
      ok: false,
      method: "download",
      fileName,
      mimeType,
      reason: `Could not save the file: ${(err as Error)?.message ?? err}`,
    };
  } finally {
    if (url && revokeObjectUrl) {
      setTimeout(() => {
        try {
          revokeObjectUrl(url as string);
        } catch {
          /* best effort */
        }
      }, 1000);
    }
  }

  openUrl(SEND_TO_KINDLE_URL);

  return { ok: true, method: "download", fileName, mimeType };
}
