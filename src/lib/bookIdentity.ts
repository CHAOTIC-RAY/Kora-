/**
 * Is this downloaded file actually the book that was asked for?
 *
 * THE BUG THIS EXISTS TO END
 * -------------------------
 * A user's log proved Kora served the wrong book:
 *
 *     title: THE CALAMITY CLUB / Kathryn Stockett
 *     url:   https://royallib.com/book/Wister_Owen/the_pentecost_of_calamity.html
 *     md5:   54f2e7e3…333345   (64 hex chars — a SHA-256, not a LibGen md5)
 *
 * Three separate defects were stacked in that one row:
 *
 *  1. THE MIRROR ROW WAS NOT TIED TO ITS OWN RECORD. The Rave search for
 *     "the calamity club" returns loose token matches — a real row for
 *     "The Pentecost Of Calamity" by Wister Owen came back in the same result
 *     set, and nothing verified that a mirror's URL described the book whose
 *     title was being displayed. So the sheet paired a title with a
 *     completely different book's page.
 *  2. THE md5 WAS A FABRICATED SHA-256. `mapRaveV1Results` hashes
 *     `title+author+extension` with SHA-256 when the upstream gives no md5,
 *     producing 64 hex characters. That value was then offered to LibGen's
 *     `get.php?md5=` as though it were a real 32-char md5, which can never
 *     resolve to a file. A SHA-256 is a local identity, NOT a LibGen id.
 *  3. THE URL WAS A WEB PAGE, NOT A FILE. `.html`/`.php` mirror URLs are
 *     reader pages behind logins and countdowns. Offering one as a download
 *     guarantees either a failure or, worse, a saved HTML file.
 *
 * The fix is to stop trusting the pairing and to MEASURE the delivered file.
 * `verifyDownloadedBook` reads the actual bytes and reports what they are and
 * whose they are. A mirror that cannot be shown to be the right book is
 * reported as a mismatch, and the caller records that as a FAILED attempt.
 *
 * Honesty rule: when there is not enough evidence to judge (an unreadable
 * container, an empty title) this returns `unverifiable`, never "match". A
 * file we cannot check is reported as unchecked, not waved through.
 */

import JSZip from "jszip";
import { detectFormat } from "./formats/detect";

export type BookIdentityVerdict =
  | "match"
  | "mismatch"
  | "unverifiable"
  /** The bytes are not a book at all (HTML page, PHP error, empty, corrupt). */
  | "not-a-book";

export interface BookIdentityResult {
  verdict: BookIdentityVerdict;
  /** The title the file itself claims, when we could read one. */
  deliveredTitle: string;
  /** Human-readable explanation, safe to show in the sheet. */
  detail: string;
  /** The detected container format, for logging. */
  format: string;
}

/** Stop words and catalogue noise that carry no identity signal. */
const NOISE = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "to", "for", "with", "vol",
  "volume", "book", "part", "edition", "ed", "novel", "paperback", "hardcover",
  "epub", "pdf", "txt", "azw3", "mobi", "retail", "digital", "copy", "edition.",
  "reissue", "collected", "complete", "unabridged", "illustrated", "mass",
  "market", "pocket", "large", "print", "read", "online", "free", "download",
]);

function tokens(value: string | null | undefined): string[] {
  if (!value) return [];
  const words: string[] = value.toLowerCase().match(/[a-z0-9]+/g) || [];
  return words.filter((t: string) => t.length > 1 && !NOISE.has(t));
}

/**
 * A real LibGen/Anna's md5: 32 lowercase hex characters.
 * A 64-char value is a SHA-256 — a local identity, not a mirror key. Callers
 * must never build `get.php?md5=` from one.
 */
export function isRealLibgenMd5(md5: string | null | undefined): boolean {
  return typeof md5 === "string" && /^[a-f0-9]{32}$/i.test(md5.trim());
}

/** True when the id is a locally generated SHA-256 pseudo-md5. */
export function isPseudoMd5(md5: string | null | undefined): boolean {
  return typeof md5 === "string" && /^[a-f0-9]{64}$/i.test(md5.trim());
}

/**
 * Is this URL a downloadable FILE rather than a reader/search page?
 *
 * Used to decide whether a mirror may be offered as a download at all. A `.html`
 * or `.php` URL is a page: it needs a login, a countdown, or a click-through,
 * and tapping "download" on it yields a web page rather than a book.
 */
export function isFileUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let path: string;
  let host: string;
  try {
    const u = new URL(url);
    path = u.pathname.toLowerCase();
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  // LibGen's `get.php` is a FILE endpoint despite the .php suffix: it 307s to
  // the booksdl CDN. Rejecting it on the extension alone would break the one
  // mirror that actually works (verified live: real EPUB bytes).
  const isLibgenFileEndpoint = /\/get\.php$/i.test(path) && host.includes("libgen");
  if (!isLibgenFileEndpoint && /\.(html?|php|asp|aspx|jsp|cgi)$/.test(path)) return false;
  if (/(^|\/)(slow_?download|details|viewtopic|search|book|thread)(\/|$)/.test(path)) {
    // `/details/<id>` on archive.org is an item PAGE; the file lives under
    // /download/. A forum `viewtopic` is a thread. Both are pages.
    if (!/\/download\//.test(path)) return false;
  }
  return true;
}

/** Pull a title out of an EPUB's OPF without pulling in the whole archive. */
async function epubTitle(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  // container.xml points at the real OPF; fall back to any .opf we can find.
  let opfName = "";
  const container = zip.file("META-INF/container.xml");
  if (container) {
    const xml = await container.async("string");
    const m = xml.match(/full-path\s*=\s*"([^"]+\.opf)"/i);
    if (m) opfName = m[1];
  }
  const opf = opfName ? zip.file(opfName) : null;
  const target = opf || Object.values(zip.files).find((f) => /\.opf$/i.test(f.name) && !f.dir);
  if (!target) return "";
  const xml = await target.async("string");
  const m = xml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  if (!m) return "";
  return decodeXml(m[1]).replace(/\s+/g, " ").trim().slice(0, 200);
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Best-effort title from a PDF's metadata. */
function pdfTitle(bytes: Uint8Array): string {
  // /Title (…) — kept deliberately small: this is a hint, not a parser.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
  const m = head.match(/\/Title\s*\(([^)]{1,200})\)/);
  return m ? decodeXml(m[1]).replace(/\\(\d{3})/g, " ").replace(/\s+/g, " ").trim() : "";
}

/**
 * Does the delivered title plausibly BE the requested one?
 *
 * Subset semantics in EITHER direction, not "any shared word". "Any shared
 * word" is exactly what let the wrong book through: "The Calamity Club" and
 * "The Pentecost Of Calamity" share "calamity", so a loose overlap rule
 * declared them the same book. A title is only accepted when every
 * significant word on one side is present on the other, which allows the
 * harmless differences (a subtitle, a series suffix, a re-issue word) while
 * rejecting a genuinely different book — each side has a word the other
 * lacks.
 */
function titlesAgree(requested: string, delivered: string): boolean {
  const want = new Set(tokens(requested));
  const got = new Set(tokens(delivered));
  if (want.size === 0 || got.size === 0) return false;
  const subset = (a: Set<string>, b: Set<string>) => {
    for (const t of a) if (!b.has(t)) return false;
    return true;
  };
  // "Dune" vs "Dune: Messiah" → one side is contained in the other → same book.
  return subset(want, got) || subset(got, want);
}

/**
 * Decide whether downloaded bytes are the requested book.
 *
 * `requestedTitle` is what the user asked for. `bytes` are what actually
 * arrived. A real file whose title shares no significant token with the
 * request is a MISMATCH — a wrong book, which the caller must treat as a
 * failed download rather than a success.
 */
export async function verifyDownloadedBook(
  bytes: Uint8Array,
  requestedTitle: string | null | undefined,
  claimedExtension?: string | null
): Promise<BookIdentityResult> {
  const detection = detectFormat(bytes, claimedExtension);
  if (detection.rejected) {
    return {
      verdict: "not-a-book",
      deliveredTitle: "",
      detail: detection.detail || `The mirror returned ${detection.format}, not a book file.`,
      format: detection.format,
    };
  }

  let delivered = "";
  try {
    if (detection.format === "epub") delivered = await epubTitle(bytes);
    else if (detection.format === "pdf") delivered = pdfTitle(bytes);
    // MOBI/AZW3: the title lives in a fixed-offset record that is not worth
    // parsing here, and detectFormat reports the whole MOBI family as "mobi".
    // An unknown title is reported as unverifiable rather than guessed at.
  } catch {
    delivered = "";
  }

  if (!delivered) {
    return {
      verdict: "unverifiable",
      deliveredTitle: "",
      detail: "This file is a valid book, but it carries no readable title, so it cannot be checked against the book you asked for.",
      format: detection.format,
    };
  }

  if (!requestedTitle || !tokens(requestedTitle).length) {
    return {
      verdict: "unverifiable",
      deliveredTitle: delivered,
      detail: `Downloaded "${delivered}". There was no title to check it against.`,
      format: detection.format,
    };
  }

  if (titlesAgree(requestedTitle, delivered)) {
    return {
      verdict: "match",
      deliveredTitle: delivered,
      detail: `Verified: the file is "${delivered}".`,
      format: detection.format,
    };
  }

  return {
    verdict: "mismatch",
    deliveredTitle: delivered,
    detail: `WRONG BOOK. You asked for "${requestedTitle}" but this mirror served "${delivered}". It has not been saved.`,
    format: detection.format,
  };
}
