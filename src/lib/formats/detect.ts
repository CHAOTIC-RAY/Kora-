/**
 * What is this file *actually*? — decided from magic bytes, never from a name.
 *
 * Extensions lie, and they lie in both directions. The reported failure in
 * this app was the opposite of the usual one: downloads that were **PHP
 * error pages** being handed to the reader as if they were books, because
 * the mirror said `.epub` and nothing ever looked at the body. LibGen makes
 * the mirror case concrete — `get.php?md5=...` is a *file* endpoint that
 * 307-redirects to a CDN, so a `.php` URL really can serve a valid EPUB.
 * Neither direction can be settled from the URL, so nothing here reads one.
 *
 * The signature set, and the honest reason each is where it is:
 *
 *   epub    `PK\x03\x04` plus a `mimetype` member holding
 *           `application/epub+zip`. The ZIP magic alone is NOT enough: an
 *           EPUB *is* a ZIP, and so is a CBZ, a DOCX and a theme bundle. The
 *           `mimetype` member is the one thing the spec guarantees is stored
 *           uncompressed at the front, which is exactly why it is readable
 *           without inflating anything.
 *   cbz     ZIP magic whose entries are overwhelmingly images. "ZIP with
 *           images in it" *is* the definition; the threshold is below 1:1
 *           because real archives carry Thumbs.db and __MACOSX cruft.
 *   zip     A genuine ZIP that is neither — reported as `zip`, not guessed at.
 *   pdf     `%PDF-`. Some producers prepend junk, so the header is searched
 *           in the first 1KB (PDF 1.7+ explicitly permits it).
 *   cbr     `Rar!\x1A\x07\x00` (v4) or `Rar!\x1A\x07\x01\x00` (v5). A CBR is
 *           a RAR, so the format IS detectable here — it is *decompression*
 *           that is not implemented, and those are different failures. See
 *           `supportedForReading()`.
 *   cb7     `7z\xBC\xAF\x27\x1C`.
 *   mobi    `BOOKMOBI` at offset 60. See the AZW3 note below.
 *   image   JPEG/PNG/GIF/WebP/AVIF/BMP magic — a single-page "comic" is a
 *           real thing mirrors serve.
 *   text    Valid UTF-8, no NUL bytes. Deliberately last: every magic above
 *           is checked first, so a text sniff can never mask a real file.
 *
 * And what must be REJECTED, which is the half that matters:
 *
 *   html, php-error, json, xml, empty, truncated
 *
 * An HTML document is rejected even when the URL ends in `.epub`, because
 * the two most common real failures are an HTML login wall returned for a
 * signed link and a PHP fatal error returned for a "download". Both are
 * 200-OK, both are text, and both used to reach the reader.
 *
 * On AZW3, honestly: an AZW3 is a PalmDB/MOBI container. MOBI carries
 * `BOOKMOBI` at offset 60 and AZW3 carries it too. They are not reliably
 * separable by magic bytes — the only discriminator is the PalmDOC header's
 * compression field plus the EXTH `cDETYPE` record, which is a parse, not a
 * signature. So both are reported as `mobi` with a note, and neither is
 * claimed to be identified.
 *
 * Pure, synchronous, dependency-free, and safe to run on the first bytes of
 * a stream — it never decodes anything and never fetches.
 */

import { hasZipSignature, listZipEntries, readStoredEntry, ZipError } from "./zip";
import { contentEntryNames, imagePageNames } from "./pageOrder";

export type DetectedFormat =
  | "epub"
  | "cbz"
  | "zip"
  | "pdf"
  | "cbr"
  | "cb7"
  | "mobi"
  | "image"
  | "text"
  | "html"
  | "php-error"
  | "json"
  | "xml"
  | "empty"
  | "truncated"
  | "unknown";

/** Formats that can never be handed to a reader, whatever the URL claimed. */
export type RejectedFormat = Extract<
  DetectedFormat,
  "html" | "php-error" | "json" | "xml" | "empty" | "truncated" | "unknown"
>;

export interface Detection {
  format: DetectedFormat;
  /** True when this is something to refuse, not to read. */
  rejected: boolean;
  /** Short label for the UI, e.g. "CBZ comic archive". */
  label: string;
  /** One line explaining a rejection, or a caveat worth showing. */
  detail: string;
  /** Page count, when the format has one and it is knowable. */
  pageCount?: number;
  /** What the caller claimed, when it claimed anything. Only ever a hint. */
  claimed?: string;
  /** The first bytes as hex, for a bug report. Never the whole file. */
  head: string;
  /** True when `claimed` and the sniffed format disagree. */
  claimedMismatch: boolean;
  /** True when the real bytes are readable even though the name is not. */
  savedByContent: boolean;
}

/* ------------------------------------------------------------------ magics */

const b = (bytes: Uint8Array, i: number) => bytes[i];

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b(bytes, i) !== sig[i]) return false;
  return true;
}

/** RAR 4.x: `Rar!\x1A\x07\x00`. RAR 5.x: `Rar!\x1A\x07\x01\x00`. */
const RAR4 = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];
const RAR5 = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];
const SEVENZ = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

function isJpeg(bytes: Uint8Array) {
  return startsWith(bytes, [0xff, 0xd8, 0xff]);
}
function isPng(bytes: Uint8Array) {
  return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}
function isGif(bytes: Uint8Array) {
  return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (b(bytes, 4) === 0x37 || b(bytes, 4) === 0x39);
}
function isBmp(bytes: Uint8Array) {
  return startsWith(bytes, [0x42, 0x4d]);
}
function isWebp(bytes: Uint8Array) {
  return (
    b(bytes, 0) === 0x52 && b(bytes, 1) === 0x49 && b(bytes, 2) === 0x46 && b(bytes, 3) === 0x46 &&
    b(bytes, 8) === 0x57 && b(bytes, 9) === 0x45 && b(bytes, 10) === 0x42 && b(bytes, 11) === 0x50
  );
}
/** ISO-BMFF: `....ftyp<brand>`. Only `avif`/`avis` and `heic` are comics. */
function isAvif(bytes: Uint8Array) {
  return b(bytes, 4) === 0x66 && b(bytes, 5) === 0x74 && b(bytes, 6) === 0x79 && b(bytes, 7) === 0x70 &&
    (ascii(bytes, 8, 12).startsWith("avif") || ascii(bytes, 8, 12).startsWith("avis"));
}
function isJxl(bytes: Uint8Array) {
  return startsWith(bytes, [0xff, 0x0a]) || startsWith(bytes, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);
}

function isImage(bytes: Uint8Array): boolean {
  return (
    isJpeg(bytes) || isPng(bytes) || isGif(bytes) || isBmp(bytes) || isWebp(bytes) ||
    isAvif(bytes) || isJxl(bytes)
  );
}

/* ------------------------------------------------------------- text checks */

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Leading whitespace stripped, so a BOM or a newline does not hide a `<?php`. */
function headText(bytes: Uint8Array, max = 1024): string {
  return ascii(bytes, 0, Math.min(bytes.length, max));
}

/** NUL anywhere in the window means binary; a text file has none. */
function hasNul(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

/** Whether these bytes decode as strict UTF-8 — the check for plain text. */
export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(
      // Only the window matters; a UTF-8 sequence cannot be longer than 4.
      bytes.subarray(0, Math.min(bytes.length, 8192))
    );
    return true;
  } catch {
    return false;
  }
}

const HTML_RE = /^\s*(<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<title[\s>]|<meta[\s>]|<!--)/i;
/**
 * `<?php` at the start, or anywhere in the document.
 *
 * Anywhere, not just at the top, because the dominant real-world shape is an
 * HTML page whose *body* is a PHP fatal error: WordPress plugins emit the
 * doctype first and the error a few hundred bytes later. Anchoring to the
 * start of the document catches that as a generic HTML page and sends the
 * user to re-authenticate for what is actually a bug on the mirror — the
 * wrong remedy, which is worse than no remedy.
 */
const PHP_RE = /^\s*<\?php|^\s*<\?=|<script[^>]*\blanguage\s*=\s*["']?php|<\?php\b|<\?=\s*\$/i;
/** Cloudflare and nginx both serve their error page as HTML; catch the text too. */
const HTTP_ERROR_RE = /\b(404|403|401|502|503)\b[\s\S]{0,80}\b(not found|forbidden|error)\b/i;
const PHP_FATAL_RE =
  /(<b>(?:Fatal error|Warning|Parse error|Notice)<\/b>|Uncaught \w*(Error|Exception)|\bStack trace:)[\s\S]{0,400}/i;

export interface TextVerdict {
  kind: "html" | "php-error" | "json" | "xml" | "text";
  detail: string;
}

/**
 * Classify a text body. Split out from the magic-byte pass so the rules are
 * readable and testable on their own.
 */
export function classifyTextBody(text: string): TextVerdict {
  // PHP first: a PHP error page is HTML *and* PHP, and telling the user
  // "this is a login page" when the mirror actually threw is a worse error
  // than useless — it sends them to re-authenticate for a bug upstream.
  if (PHP_RE.test(text) || PHP_FATAL_RE.test(text)) {
    return {
      kind: "php-error",
      detail:
        "The mirror returned a PHP error page, not a file. This is a fault on the mirror's server — try another mirror.",
    };
  }
  if (HTML_RE.test(text)) {
    const err = HTTP_ERROR_RE.exec(text);
    return {
      kind: "html",
      detail: err
        ? `The server returned an HTML ${err[1]} error page instead of the file. Try another mirror.`
        : "The server returned an HTML web page, not a file. This link needs a browser login — try another mirror.",
    };
  }
  const t = text.trim();
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(t);
      return { kind: "json", detail: "The server returned JSON, not a book. This is an API response, not a download." };
    } catch {
      /* fall through — malformed JSON is not a JSON blob worth reporting */
    }
  }
  if (/^<\?xml/i.test(t) || /^<[a-zA-Z_:][\w.:-]*[\s/>]/.test(t)) {
    return { kind: "xml", detail: "The server returned an XML document, not a book file." };
  }
  return { kind: "text", detail: "" };
}

/* ---------------------------------------------------------------- ZIP path */

const EPUB_MIMETYPE = "application/epub+zip";
/**
 * Fraction of a ZIP's entries that must be page images for it to be a comic
 * archive. Below 1 because real CBZs ship `Thumbs.db`, `.nomedia` and
 * `__MACOSX/._*` alongside the art; the reason to allow it is that a ZIP of
 * JPEGs and an EPUB both start `PK\x03\x04`, so the images ARE the evidence.
 */
const CBZ_IMAGE_RATIO = 0.6;

export interface ZipVerdict {
  format: "epub" | "cbz" | "zip";
  detail: string;
  pageCount?: number;
}

/**
 * Decide what a ZIP actually is.
 *
 * Reads the central directory, then the `mimetype` member if one exists.
 * Never inflates anything: if `mimetype` is deflated — which the spec
 * forbids but real files do — the verdict falls back to the entry names
 * rather than pretending the sniff was conclusive.
 */
export function classifyZip(bytes: Uint8Array): ZipVerdict {
  let names: string[];
  let total: number;
  try {
    const entries = listZipEntries(bytes);
    total = entries.length;
    names = entries.filter((e) => !e.isDirectory).map((e) => e.name);
  } catch (e) {
    return {
      format: "zip",
      detail:
        e instanceof ZipError
          ? `The ZIP central directory is unreadable (${e.message}) — the download is probably truncated.`
          : "The ZIP could not be read.",
    };
  }

  // 1. The spec member. `mimetype` must be stored uncompressed, which is
  //    precisely so this read is possible without inflating a single byte.
  const mt = names.findIndex((n) => n === "mimetype" || n.endsWith("/mimetype"));
  if (mt >= 0) {
    try {
      const entries = listZipEntries(bytes);
      const value = new TextDecoder("utf-8")
        .decode(readStoredEntry(bytes, entries[mt]))
        .trim()
        .toLowerCase();
      if (value === EPUB_MIMETYPE) {
        return { format: "epub", detail: "EPUB — a ZIP carrying the `mimetype` member the spec requires." };
      }
      if (value.startsWith("application/epub")) {
        return { format: "epub", detail: "EPUB (mimetype member present)." };
      }
    } catch {
      // Deflated `mimetype`, or a truncated entry. Fall through to the
      // structural evidence rather than asserting an EPUB we did not prove.
    }
  }

  // 2. Structural evidence: a ZIP whose members are mostly images is a
    //    comic archive. `mimetype` said nothing, so this is the only test left.
    //    The denominator counts only *real* content: `Thumbs.db`, `desktop.ini`
    //    and `__MACOSX/._…` are real members of many real CBZs, and counting
    //    them as content would drop a legitimate comic below the threshold.
    const images = imagePageNames(names);
    const content = contentEntryNames(names);
    const ratio = content.length ? images.length / content.length : 0;
    if (images.length >= 1 && ratio >= CBZ_IMAGE_RATIO) {
      return {
        format: "cbz",
        detail: `CBZ comic archive — ${images.length} image${images.length === 1 ? "" : "s"} of ${content.length} members.`,
        pageCount: images.length,
      };
    }

  // 3. Something else in a ZIP. Named as a ZIP rather than guessed at.
  const looksLikeOffice = names.includes("[Content_Types].xml") || names.some((n) => n.endsWith(".xml"));
  return {
    format: "zip",
    detail: looksLikeOffice
      ? "A ZIP that looks like an Office document, not a book."
      : `A ZIP archive with ${names.length} members, none of which look like comic pages.`,
  };
}

/* ------------------------------------------------------------------ labels */

const LABELS: Record<DetectedFormat, string> = {
  epub: "EPUB",
  cbz: "CBZ",
  zip: "ZIP",
  pdf: "PDF",
  cbr: "RAR/CBR",
  cb7: "7z/CB7",
  mobi: "MOBI-family",
  image: "Image",
  text: "Text",
  html: "HTML page",
  "php-error": "PHP error page",
  json: "JSON",
  xml: "XML",
  empty: "Empty file",
  truncated: "Truncated file",
  unknown: "Unknown",
};

const REJECTED: ReadonlySet<DetectedFormat> = new Set<DetectedFormat>([
  "html",
  "php-error",
  "json",
  "xml",
  "empty",
  "truncated",
  "unknown",
]);

export function isRejected(f: DetectedFormat): boolean {
  return REJECTED.has(f);
}

/** Anything that names a real, readable container Kora might handle. */
export function isReadableContainer(f: DetectedFormat): boolean {
  return f === "epub" || f === "cbz" || f === "zip" || f === "pdf" || f === "cbr" || f === "cb7" || f === "mobi";
}

/**
 * Whether Kora can actually READ this format today.
 *
 * Separate from detection on purpose, and the separation is the whole point
 * of this file existing: a CBR is detected with complete certainty and still
 * cannot be read, because RAR decompression is a heavy dependency nobody has
 * justified adding. Conflating "I know what this is" with "I can open this"
 * is how apps end up silently failing.
 */
export function supportedForReading(f: DetectedFormat): boolean {
  return f === "epub" || f === "cbz" || f === "zip";
}

/** The honest sentence to show for a format that is detected but not read. */
export function unsupportedReason(f: DetectedFormat): string {
  switch (f) {
    case "cbr":
      return "RAR/CBR archives are not supported yet — this source offers .cbr. Reading one needs a RAR decompressor, which is not something Kora ships.";
    case "cb7":
      return "7z/CB7 archives are not supported yet — this source offers .cb7. Reading one needs a 7z decompressor, which is not something Kora ships.";
    case "pdf":
      return "PDF is detected but Kora's reader is built for image pages, not PDF documents.";
    case "mobi":
      return "MOBI/AZW3 is detected but Kora has no e-ink reader for it yet.";
    case "image":
      return "A single image — not a multi-page comic.";
    default:
      return `${LABELS[f]} cannot be opened in Kora.`;
  }
}

/* -------------------------------------------------------------- entry point */

function headHex(bytes: Uint8Array, n = 16): string {
  const take = Math.min(bytes.length, n);
  let out = "";
  for (let i = 0; i < take; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
    if (i < take - 1) out += " ";
  }
  return out;
}

/**
 * Identify a file from its bytes.
 *
 * `claimed` is the extension the URL suggested. It is recorded and compared
 * but it never influences the verdict — that is the entire point. Passing it
 * makes the mismatch *visible in the UI*, which is what turns "the app is
 * broken" into "this mirror is broken".
 */
export function detectFormat(bytes: Uint8Array, claimed?: string | null): Detection {
  const claim = claimedExtension(claimed);
  const base = { claimed: claim, head: headHex(bytes) };

  const finish = (
    format: DetectedFormat,
    detail = "",
    extra: { pageCount?: number } = {}
  ): Detection => {
    const rejected = isRejected(format);
    // "Saved by content" only means the *extension* was wrong. Rejected
    // formats are never saved, whatever they were called.
    const claimMatches = !!claim && claimMatchesFormat(claim, format);
    return {
      ...base,
      format,
      rejected,
      label: LABELS[format],
      detail: rejected && !detail ? unsupportedReason(format) : detail,
      pageCount: extra.pageCount,
      claimedMismatch: !!claim && !claimMatches,
      savedByContent: !!claim && !claimMatches && !rejected,
    };
  };

  // 0. Nothing at all. A zero-byte response is what a mirror returns when
  //    it has decided not to serve the file, and it reaches the reader as a
  //    blank page otherwise.
  if (!bytes || bytes.length === 0) {
    return finish("empty", "The mirror returned zero bytes. Nothing was downloaded.");
  }

  // 1. Single-image formats, checked before text because a binary file can
  //    contain anything in its first byte.
  if (isImage(bytes)) {
    return finish("image", "A single image file, not a multi-page comic.", { pageCount: 1 });
  }

  // 2. PDF. The header is searched in the first 1KB, not just byte 0: PDF
  //    1.7 explicitly permits a file to start with other bytes, and plenty
  //    of scanners emit a few. Requiring byte 0 rejects real PDFs.
  const window = bytes.subarray(0, Math.min(bytes.length, 1024));
  const pdfAt = indexOf(window, PDF);
  if (pdfAt >= 0) {
    return finish("pdf", "A PDF document — Kora's comic reader reads image pages, not PDF.");
  }

  // 3. RAR / CBR, then 7z / CB7. RAR first because both signatures are
  //    unambiguous and RAR is the far more common comic container.
  if (startsWith(bytes, RAR4)) {
    return finish("cbr", "RAR v4 archive (a .cbr comic).");
  }
  if (startsWith(bytes, RAR5)) {
    return finish("cbr", "RAR v5 archive (a .cbr comic).");
  }
  if (startsWith(bytes, SEVENZ)) {
    return finish("cb7", "7-Zip archive (a .cb7 comic).");
  }

  // 4. MOBI-family. `BOOKMOBI` sits at offset 60, inside the PalmDOC header
  //    name field, not at the start of the file.
  if (ascii(bytes, 60, 68) === "BOOKMOBI") {
    return finish(
      "mobi",
      "MOBI-family container (MOBI, AZW or AZW3). These share a signature — an AZW3 cannot be told from a MOBI by magic bytes alone."
    );
  }

  // 5. ZIP family: EPUB, CBZ, or a ZIP that is neither.
  if (hasZipSignature(bytes)) {
    const z = classifyZip(bytes);
    return finish(z.format, z.detail, { pageCount: z.pageCount });
  }

  // 6. Text-ish. Only now, after every binary signature has had its turn, so
  //    a text sniff can never mask a real file.
  if (hasNul(bytes)) {
    // Binary with no recognised signature. Not silently "text", not silently
    // "unknown" — but it is certainly not a book we can open.
    return finish("unknown", "This file is binary and matches no format Kora knows. First bytes: " + headHex(bytes) + ".");
  }

  const text = headText(bytes);
  const verdict = classifyTextBody(text);
  if (verdict.kind !== "text") return finish(verdict.kind, verdict.detail);

  // 7. Genuine plain text — and only once it is known to decode as UTF-8.
  if (!isValidUtf8(bytes)) {
    return finish("unknown", "This file is neither text nor a recognised archive.");
  }
  return finish("text", "A plain-text file.");
}

/**
 * The extension a URL claimed, lowercased and without the query.
 *
 * Returns `undefined` for a URL with no usable extension rather than
 * inventing one, because "no claim" and "claimed something odd" are
 * different states: the first produces no mismatch to report, the second
 * produces a mismatch worth reporting.
 *
 * The MD5 in LibGen's `get.php?md5=…` is deliberately dropped. The extension
 * is `php`; the query is routing, not a file name.
 */
export function claimedExtension(urlOrName?: string | null): string | undefined {
  const raw = (urlOrName || "").trim();
  if (!raw) return undefined;
  // Take the path, discard any query/fragment, then the last path segment.
  let path = raw;
  const cut = path.search(/[?#]/);
  if (cut >= 0) path = path.slice(0, cut);
  const seg = path.split(/[\\/]/).filter(Boolean).pop() || "";
  const dot = seg.lastIndexOf(".");
  // A leading dot is a hidden file, not an extension (".bashrc").
  if (dot <= 0 || dot === seg.length - 1) return undefined;
  const ext = seg.slice(dot + 1).toLowerCase();
  // A plausible extension is short and alphanumeric. Anything else is a
  // filename with dots in it, not an extension claim.
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return undefined;
  return ext;
}
export function claimMatchesFormat(claim: string, format: DetectedFormat): boolean {
  const c = claim.toLowerCase().replace(/^\./, "");
  switch (format) {
    case "epub":
      return c === "epub";
    case "cbz":
      return c === "cbz" || c === "zip";
    case "zip":
      return c === "zip" || c === "cbz";
    case "pdf":
      return c === "pdf";
    case "cbr":
      return c === "cbr" || c === "rar";
    case "cb7":
      return c === "cb7" || c === "7z";
    case "mobi":
      return c === "mobi" || c === "azw" || c === "azw3" || c === "prc";
    case "image":
      return /^(jpe?g|png|webp|avif|gif|bmp|jxl)$/.test(c);
    case "text":
      return /^(txt|text|md|nfo)$/.test(c);
    case "html":
      return c === "html" || c === "htm" || c === "xhtml";
    case "php-error":
    case "json":
    case "xml":
    case "unknown":
      return false;
    default:
      return false;
  }
}

/** Subarray search for a byte pattern. Returns -1 when absent. */
function indexOf(hay: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}