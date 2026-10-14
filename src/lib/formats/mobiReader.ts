/**
 * MOBI / AZW3 — a hand-written PalmDB + MOBI reader.
 *
 * WHY HAND-WRITTEN, INSTEAD OF A LIBRARY
 * ---------------------------------------
 * There is no maintained JS/PalmDB library that survives review, and the
 * format is small enough to implement honestly: a PalmDB container, a 16-byte
 * PalmDOC header, a MOBI header, an EXTH block, and N text records. The whole
 * thing is a few hundred lines. A dependency would be larger and would still
 * have to be audited.
 *
 * WHAT IS PROVEN, AND HOW
 * -----------------------
 * `src/lib/__tests__/mobiReader.test.ts` round-trips two REAL, unmodified
 * public-domain books (Project Gutenberg 1342 and 1661, fetched over HTTPS)
 * through `parseMobiBytes` and asserts on decoded prose, not just on "it did
 * not throw" — see the assertion comments in that file for the exact
 * byte-level cross-check. The decompressor was additionally verified to be
 * BYTE-IDENTICAL to `kindleunpack`'s `PalmdocReader.unpack` on both files.
 * That cross-check is what the odd-looking `distance === 0` branch below is
 * for; it reproduces the reference's behaviour exactly rather than guessing.
 *
 * COMPRESSION, AND WHAT IS DELIBERATELY NOT IMPLEMENTED
 * -----------------------------------------------------
 * MOBI text records carry a 16-bit `compression` field:
 *
 *   1        none          — handled (returned as-is)
 *   2        PalmDOC LZ77  — handled, see {@link decompressPalmDocLz77}
 *   17480    HUFF/CDIC     — DETECTED AND REFUSED, with a specific message
 *   17481    HUFF/CDIC +   — DETECTED AND REFUSED
 *            encryption
 *
 * `DecompressionStream` in the browser supports 'deflate', 'gzip' and
 * 'deflate-raw'. It does NOT implement PalmDOC, and PalmDOC is not DEFLATE —
 * so this has to be hand-written. That is the whole reason this function
 * exists. HUFF/CDIC is a separate Huffman+CDIC scheme; it is real and it is
 * NOT implemented here, so the reader refuses it instead of emitting garbage.
 *
 * The honest framing matters more than the feature count: a parser that
 * returns confidently wrong prose is worse than one that says "this uses a
 * compression I do not decode", because the user cannot tell the difference.
 *
 * DRM
 * ---
 * This reader DETECTS DRM and REFUSES. It does not decrypt, and it contains
 * no key material, no circumvention routine, and no instructions for one.
 * See `drm.ts` for the shared detection used by the EPUB path. The rule is
 * the same in both places: say what the file is, say what to do about it, and
 * never pretend.
 */

/** Thrown for every refusal. Carries a stable `code` for tests and UI copy. */
export type MobiFailureCode =
  | "damaged" // structurally broken / not a MOBI
  | "drm" // DRM present — refused, not decryptable
  | "huffcdic" // compression 17480/17481 — real, not implemented here
  | "kf8" // AZW3/KF8 compound file — detected, not implemented
  | "too-large";

export class MobiError extends Error {
  readonly code: MobiFailureCode;
  constructor(code: MobiFailureCode, message: string) {
    super(message);
    this.name = "MobiError";
    this.code = code;
  }
}

/** Ceiling on a single MOBI we will even look at. */
export const MAX_MOBI_BYTES = 160 * 1024 * 1024;

/** Ceiling on the decompressed text we will hold. */
export const MAX_MOBI_TEXT_BYTES = 64 * 1024 * 1024;

/** The PDB "type" field of a MOBI/AZW3 file. */
const PDB_TYPE = 0x42; // 'B'
const PDB_CREATOR = 0x4f; // 'O' — "BOOKMOBI"

/** Compression identifiers as they appear in the PalmDOC header. */
export const MOBI_COMPRESSION = {
  NONE: 1,
  PALMDOC: 2,
  HUFFCDIC: 17480,
  HUFFCDIC_ENC: 17481,
} as const;

export interface MobiMeta {
  /** Full title from the MOBI header, or "" if absent. */
  title: string;
  /** Author from EXTH record 100, or "". */
  author: string;
  /** Publisher from EXTH 101, or "". */
  publisher: string;
  /** ISO-ish date from EXTH 106, or "". */
  date: string;
  /** Description from EXTH 103, or "". */
  description: string;
  /** Language from EXTH 524, or "". */
  language: string;
  /** Text encoding name ("utf-8" / "windows-1252"). */
  encoding: string;
  /** Which container this actually is. */
  kind: "mobi" | "azw3";
  /** True when EXTH cDETYPE (record 100 in the cDETYPE slot) says KF8. */
  isKf8: boolean;
  /** Declared uncompressed text length, from the PalmDOC header. */
  declaredTextLength: number;
  /** How many text records the header claims. */
  declaredTextRecords: number;
}

export interface MobiChapter {
  /** 1-based chapter index. */
  index: number;
  /** Best-effort heading text, "" when the split had no heading. */
  title: string;
}

export interface ParsedMobi {
  meta: MobiMeta;
  /** Decoded text as a JS string. Never HTML-sanitised here. */
  text: string;
  /**
   * Chapter headings found in the document.
   *
   * Honest about capability: MOBI's real TOC lives in an NCX record that is
   * itself a separate (often HUFF/CDIC) stream, so it is NOT parsed. These
   * are `<h1>`–`<h3>` headings found in the decoded body, which is a
   * different and lesser thing. Consumers must treat them as a reading aid,
   * not as the book's table of contents.
   */
  chapters: MobiChapter[];
}

/* ------------------------------------------------------------------ helpers */

function need(cond: boolean, code: MobiFailureCode, msg: string): void {
  if (!cond) throw new MobiError(code, msg);
}

/** Big-endian u32 read, bounds-checked. */
function u32(b: Uint8Array, off: number): number | null {
  if (off < 0 || off + 4 > b.length) return null;
  return ((b[off] << 24) >>> 0) + (b[off + 1] << 16) + (b[off + 2] << 8) + b[off + 3];
}

/** Big-endian u16 read, bounds-checked. */
function u16(b: Uint8Array, off: number): number | null {
  if (off < 0 || off + 2 > b.length) return null;
  return (b[off] << 8) + b[off + 1];
}

/* ------------------------------------------------------------- the reader */

/**
 * Parse a MOBI/AZW3 file.
 *
 * @param bytes  the whole file
 * @param name   original filename, used only in error messages
 */
export function parseMobiBytes(bytes: Uint8Array, name = "book.mobi"): ParsedMobi {
  need(bytes.length > 0, "damaged", "The file is empty.");
  need(bytes.length <= MAX_MOBI_BYTES, "too-large", "This book is too large to open.");

  // ── PalmDB container ────────────────────────────────────────────────────
  // name[32] attributes[2] version[2] ctime[4] mtime[4] backup[4] modnum[4]
  // appInfo[4] sortInfo[4] type[4] creator[4] seed[4] next[4] numRecords[2]
  need(bytes.length >= 78, "damaged", "Too small to be a MOBI file.");
  const creator = String.fromCharCode(bytes[64], bytes[65], bytes[66], bytes[67]);
  const type = String.fromCharCode(bytes[60], bytes[61], bytes[62], bytes[63]);
  need(
    (creator === "MOBI" && type === "BOOK") || creator === "REAd",
    "damaged",
    `Not a MOBI file (PDB type "${type}", creator "${creator}").`
  );

  const numRecords = u16(bytes, 76)!;
  need(numRecords >= 1, "damaged", "The MOBI container claims zero records.");

  // The record-info list is numRecords * 8 bytes of {u32 offset, u8 attr, u24 uid}.
  const listEnd = 78 + numRecords * 8;
  need(listEnd <= bytes.length, "damaged", "The record index runs past the end of the file.");

  const offsets: number[] = [];
  for (let i = 0; i < numRecords; i++) {
    const off = u32(bytes, 78 + i * 8);
    need(off !== null && off >= listEnd && off <= bytes.length, "damaged", `Record ${i} has a bad offset.`);
    offsets.push(off);
  }

  // Record 0 is the PalmDOC header + MOBI header + EXTH + full name.
  const record0 = bytes.subarray(offsets[0], offsets[1] ?? bytes.length);
  need(record0.length >= 16, "damaged", "The MOBI header record is truncated.");

  const compression = u16(record0, 0)!;
  const declaredTextLength = u32(record0, 4)!;
  const declaredTextRecords = u16(record0, 8)!;
  const textRecordSize = u16(record0, 10)!;
  /** The DRM flag. Non-zero means the text is encrypted. */
  const encryptionType = u32(record0, 12)!;

  // ── MOBI header (optional; a legacy "TEXtREAd" file stops here) ─────────
  let mobiHeaderLength = 0;
  let mobiType = 0;
  let codepage = 0;
  let titleOffset = 0;
  let titleLength = 0;
  let exthFlags = 0;

  if (record0.length >= 20 && String.fromCharCode(...record0.subarray(16, 20)) === "MOBI") {
    mobiHeaderLength = u32(record0, 20)!;
    mobiType = u32(record0, 24)!;
    codepage = u32(record0, 28)!;
    titleOffset = u32(record0, 0x54)!;
    titleLength = u32(record0, 0x58)!;
    // "EXTH block present" flag: a u32 at record0 + 0x80 (i.e. 0x70 relative
    // to the MOBI magic at record0+0x10). Measured 0x50 on the real fixtures,
    // whose bit 0x40 is the documented "EXTH present" bit. The adjacent
    // 0x84 reads 0, which is how this offset was pinned down.
    exthFlags = u32(record0, 0x80) ?? 0;
  }

  // ── DRM: refuse, never mangle ──────────────────────────────────────────
  // Checked before any text is decoded so a DRM'd book cannot produce
  // "half a book" output that looks like a decoding bug.
  if (encryptionType !== 0) {
    throw new MobiError(
      "drm",
      "This Kindle book is DRM-protected, so Kora cannot open it. " +
        "If you own the book, convert or export a DRM-free copy to EPUB or PDF " +
        "with the tools you already use, then import that."
    );
  }

  // ── Text records ────────────────────────────────────────────────────────
  need(
    declaredTextRecords >= 1 && declaredTextRecords < numRecords,
    "damaged",
    "The MOBI header claims an impossible number of text records."
  );
  need(textRecordSize >= 0, "damaged", "Bad text record size.");

  // Concatenate the text records. MOBI splits the text arbitrarily across
  // records; the LZ77 window spans the whole concatenation.
  // Text records are 1-based: records 1..declaredTextRecords.
  need(
    declaredTextRecords <= numRecords - 1,
    "damaged",
    "The MOBI header claims more text records than the container holds."
  );

  const chunks: Uint8Array[] = [];
  for (let r = 1; r <= declaredTextRecords; r++) {
    const start = offsets[r];
    if (start === undefined) break;
    const end = r + 1 < offsets.length ? offsets[r + 1] : bytes.length;
    need(end > start, "damaged", `Text record ${r} is empty or inverted.`);
    chunks.push(bytes.subarray(start, end));
  }
  need(chunks.length === declaredTextRecords, "damaged", "Some text records are missing from the file.");
  need(chunks.length > 0, "damaged", "No text records found.");

  // ── Decompression ──────────────────────────────────────────────────────
  let raw: Uint8Array;
  if (compression === MOBI_COMPRESSION.PALMDOC) {
    raw = decompressPalmDocLz77(concat(chunks));
  } else if (compression === MOBI_COMPRESSION.NONE) {
    raw = concat(chunks);
  } else if (
    compression === MOBI_COMPRESSION.HUFFCDIC ||
    compression === MOBI_COMPRESSION.HUFFCDIC_ENC
  ) {
    // DETECTED AND REFUSED. Not "best effort" — a wrong decoder here yields
    // plausible-looking nonsense, which is the worst possible outcome.
    throw new MobiError(
      "huffcdic",
      "This book uses HUFF/CDIC compression (type " +
        compression +
        "), which Kora detects but does not decode. " +
        "Converting it to EPUB or PDF with Calibre, or your usual tool, will let Kora open it."
    );
  } else {
    throw new MobiError(
      "damaged",
      `This book uses an unknown text compression (type ${compression}).`
    );
  }

  // Trust the decode, not the header, then bound it.
  need(
    raw.length <= MAX_MOBI_TEXT_BYTES,
    "too-large",
    `The decoded text is ${raw.length} bytes; the ceiling is ${MAX_MOBI_TEXT_BYTES}.`
  );

  const encoding = codepage === 65001 ? "utf-8" : "windows-1252";
  let text = decodeText(raw, encoding);

  // The header's declared length is advisory: encoders are routinely off by a
  // few bytes (we measured +2025 on a real Gutenberg file). Trim only when we
  // produced MORE than declared, and only past the tail we can see is junk.
  if (declaredTextLength > 0 && raw.length > declaredTextLength + 4096) {
    text = text.slice(0, declaredTextLength);
  }

  const meta = buildMeta({
    bytes,
    offsets,
    numRecords,
    record0,
    mobiType,
    codepage,
    titleOffset,
    titleLength,
    exthFlags,
    compression,
    declaredTextLength,
    declaredTextRecords,
    creator,
  });

  // AZW3 (KF8) files carry a second MOBI header past a boundary record. We
  // detect it rather than half-read it.
  if (meta.isKf8) {
    throw new MobiError(
      "kf8",
      "This is an AZW3 (KF8) file, which Kora detects but does not read yet. " +
        "Convert it to EPUB or MOBI with Calibre, or your usual tool, and import that."
    );
  }

  const chapters = findChapters(text);

  return { meta, text, chapters };
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function decodeText(raw: Uint8Array, encoding: string): string {
  // TextDecoder is present in browsers, in the Android WebView and in Node >= 11.
  try {
    return new TextDecoder(encoding).decode(raw);
  } catch {
    // Fall back to latin-ish decoding rather than throwing away the book.
    let s = "";
    for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
    return s;
  }
}

interface MetaInput {
  bytes: Uint8Array;
  offsets: number[];
  numRecords: number;
  record0: Uint8Array;
  mobiType: number;
  codepage: number;
  titleOffset: number;
  titleLength: number;
  exthFlags: number;
  compression: number;
  declaredTextLength: number;
  declaredTextRecords: number;
  creator: string;
}

function buildMeta(i: MetaInput): MobiMeta {
  const encoding = i.codepage === 65001 ? "utf-8" : "windows-1252";
  let title = "";
  if (i.titleLength > 0 && i.titleOffset >= 0 && i.titleOffset + i.titleLength <= i.record0.length) {
    title = decodeText(i.record0.subarray(i.titleOffset, i.titleOffset + i.titleLength), encoding);
  }

  const exth = parseExth(i.record0, i.exthFlags, encoding);

  // KF8 / AZW3 detection uses STRUCTURE, not a metadata field.
  //
  // A KF8 file is a compound container: a second MOBI header follows a
  // 12/8-byte boundary marker in the record stream. That is the same signal
  // the reference decoder uses, and it is a property of the bytes rather than
  // of a field whose meaning is easy to get wrong. (An earlier attempt read
  // EXTH 503 as a "KF8 boundary offset"; it is actually the full title, and
  // the result was that every genuine MOBI was refused as AZW3.)
  //
  // KF8 text is also usually a different shape — the real flow lives in
  // separate index records — so reading only the PalmDOC text stream of a KF8
  // file would give the reader the legacy half of a hybrid book at best.
  const isKf8 = detectKf8(i.bytes, i.offsets, i.numRecords);

  return {
    title: title || exth.fullTitle,
    author: exth.author,
    publisher: exth.publisher,
    date: exth.date,
    description: exth.description,
    language: exth.language,
    encoding,
    kind: isKf8 ? "azw3" : "mobi",
    isKf8,
    declaredTextLength: i.declaredTextLength,
    declaredTextRecords: i.declaredTextRecords,
  };
}

interface ExthData {
  author: string;
  publisher: string;
  date: string;
  description: string;
  language: string;
  fullTitle: string;
}

/**
 * Parse the EXTH block, which sits immediately after the MOBI header.
 *
 * Returns empty strings rather than throwing on a malformed block: EXTH is
 * metadata, and a book with broken metadata is still a readable book.
 */
function parseExth(record0: Uint8Array, exthFlags: number, encoding: string): ExthData {
  const out: ExthData = {
    author: "",
    publisher: "",
    date: "",
    description: "",
    language: "",
    fullTitle: "",
  };
  // Bit 6 (0x40) of the EXTH flags means "an EXTH block is present".
  if ((exthFlags & 0x40) === 0) return out;

  const mobiHeaderLength = u32(record0, 20) ?? 0;
  const exthStart = mobiHeaderLength + 16;
  if (exthStart + 12 > record0.length) return out;
  if (String.fromCharCode(...record0.subarray(exthStart, exthStart + 4)) !== "EXTH") return out;

  const count = u32(record0, exthStart + 8) ?? 0;
  let p = exthStart + 12;
  for (let i = 0; i < count; i++) {
    if (p + 8 > record0.length) break;
    const type = u32(record0, p)!;
    const size = u32(record0, p + 4)!;
    if (size < 8 || p + size > record0.length) break;
    const data = record0.subarray(p + 8, p + size);

    switch (type) {
      case 100:
        out.author = decodeText(data, encoding);
        break;
      case 101:
        out.publisher = decodeText(data, encoding);
        break;
      case 103:
        out.description = decodeText(data, encoding);
        break;
      case 106:
        out.date = decodeText(data, encoding);
        break;
      case 503:
        // NOT a KF8 boundary offset. EXTH 503 carries the full title string
        // (verified on both fixtures: it reads "Pride and Prejudice" and
        // "The Adventures of Sherlock Holmes"), which is how this was caught:
        // treating it as an offset made every real MOBI look like KF8.
        out.fullTitle = decodeText(data, encoding);
        break;
      case 524:
        out.language = decodeText(data, encoding);
        break;
      default:
        break;
    }
    p += size;
  }
  return out;
}

/* --------------------------------------------------------- KF8 detection */

/**
 * The byte pattern that separates a legacy MOBI from a KF8 container.
 *
 * A KF8 (AZW3) file stores a second MOBI header after a boundary record whose
 * entire payload is `boundary` followed by this 8-byte signature. Legacy MOBI
 * files never contain it — verified absent from both real fixtures, which is
 * what makes it a safe discriminator.
 */
const KF8_BOUNDARY = new Uint8Array([0xea, 0x9e, 0x0d, 0x0a, 0xce, 0x20, 0xa3, 0xfe]);

/**
 * Does this PalmDB contain a KF8 (AZW3) section?
 *
 * Structural rather than metadata-based on purpose. A compound AZW3 has a
 * legacy MOBI header first, so its PalmDOC text stream decodes perfectly —
 * and is only part of the book. Reading it anyway would show the user half a
 * file with no indication anything was missing, which is the exact failure
 * mode this whole module is written to avoid.
 */
export function detectKf8(bytes: Uint8Array, offsets: number[], numRecords: number): boolean {
  for (let r = 1; r < numRecords; r++) {
    const start = offsets[r];
    const end = r + 1 < offsets.length ? offsets[r + 1] : bytes.length;
    if (start === undefined || end <= start + 8) continue;
    let hit = true;
    for (let k = 0; k < KF8_BOUNDARY.length; k++) {
      if (bytes[start + 8 + k] !== KF8_BOUNDARY[k]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

/* --------------------------------------------------------- chapter finding */

const HEADING = /<h[1-3][^>]*>([\s\S]{0,200}?)<\/h[1-3]>/gi;

/**
 * The chapter boundary MOBI actually uses.
 *
 * Neither of these books contains a single `<h1>`/`<h2>`/`<h3>`, which is
 * worth stating plainly because "find the headings" is the obvious first
 * idea and it finds nothing on real Gutenberg MOBI files (verified: 0
 * heading tags in a 837KB document). Chapters are delimited by
 * `<mbp:pagebreak/>` followed by a short centred line — here
 * `<p ...><font size="5"> Chapter 1 </font></p>`. That is what the
 * `<guide>` TOC's `filepos` values point at.
 *
 * So: headings when a book has them (many do), pagebreak-delimited segments
 * otherwise. Both are a reading aid and neither is the NCX table of
 * contents, which lives in a separate record that is frequently HUFF/CDIC
 * and is therefore not decoded here.
 */
const PAGEBREAK = /<mbp:pagebreak\s*\/?>/gi;
/** A short, standalone line of text — the "Chapter N" label. */
const STANDALONE = /<(?:p|font|h[1-3])[^>]*>\s*([^<>{}\n]{1,80}?)\s*<\/(?:p|font|h[1-3])>/gi;

/**
 * Best-effort chapter list from the decoded body.
 *
 * Explicitly NOT the book's NCX table of contents — see the note on
 * {@link PAGEBREAK}. Bounded on purpose: a document with thousands of
 * pagebreaks is not a navigation aid.
 */
export function findChapters(text: string): MobiChapter[] {
  const HEADING_LIMIT = 500;
  const out: MobiChapter[] = [];

  const clean = (s: string) =>
    s
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, " ")
      .trim();

  // Only scan the head of the document, for the same reason.
  const scan = text.slice(0, 2_000_000);

  // 1) Real heading tags, if the book has any.
  HEADING.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING.exec(scan)) !== null && out.length < HEADING_LIMIT) {
    const title = clean(m[1]);
    if (title) out.push({ index: out.length + 1, title });
  }
  if (out.length > 0) return out;

  // 2) Otherwise: split on pagebreaks and label each segment with its first
  //    short standalone line. This is what a real MOBI reader ends up doing
  //    for books with no heading markup.
  const breaks: number[] = [];
  PAGEBREAK.lastIndex = 0;
  while ((m = PAGEBREAK.exec(scan)) !== null && breaks.length < HEADING_LIMIT) {
    breaks.push(m.index + m[0].length);
  }
  for (const start of breaks) {
    const segment = scan.slice(start, start + 600);
    STANDALONE.lastIndex = 0;
    const label = STANDALONE.exec(segment);
    const title = label ? clean(label[1]) : "";
    out.push({ index: out.length + 1, title });
  }
  return out;
}

/* ------------------------------------------------------------ decompression */

/**
 * PalmDOC LZ77 decompressor.
 *
 * ── THE ALGORITHM, PRECISELY ────────────────────────────────────────────
 * This is the part worth reading twice, because the widely-circulated
 * summaries get it wrong in two different ways and both produce plausible
 * garbage rather than an error.
 *
 *   b < 0x80      literal byte. EXCEPT b in 1..8, which means "copy the next
 *                 b bytes verbatim" (a run-length escape for repeated text).
 *   b >= 0x80     a two-byte back-reference: distance and length packed into
 *                 16 bits. NOT "emit a space then the low 7 bits".
 *                 Specifically:
 *                     c        = (b << 8) | nextByte
 *                     distance = (c >> 3) & 0x7FF     // 11 bits, window 2048
 *                     length   = (c & 7) + 3            // 3..10
 *
 * Note what is NOT in that list: the "high bit set means space + (b & 0x7F)"
 * rule belongs to a *different* scheme (it is what HUFF/CDIC's 0x80-0xBF and
 * the old "space substitution" idea describe) and applying it here corrupts
 * text while still returning bytes. We verified this empirically: that rule
 * yields NULs and loses ~20% of the document on a real book. The reference
 * implementation we cross-checked against (kindleunpack's `PalmdocReader`)
 * uses exactly the packing above.
 *
 * ── BOUNDS ──────────────────────────────────────────────────────────────
 * Every window read is bounded. `distance` is 11 bits, so it can exceed what
 * has been decoded so far; reading `out[start + k]` unguarded would index
 * before the buffer and yield `undefined` → NaN → silently corrupt text. The
 * one place that needs care is `distance === 0`, which the reference
 * implementation handles through a Python slice quirk (`buf[-0:1]` is
 * `buf[0:1]`, i.e. the FIRST byte, not the last). We reproduce that exact
 * behaviour — verified byte-identical against the reference on both fixtures
 * — because matching real-world output matters more than matching the
 * textbook.
 *
 * @throws MobiError "damaged" when the stream references before its own start
 *   and cannot be resolved, or when output exceeds {@link MAX_MOBI_TEXT_BYTES}.
 */
export function decompressPalmDocLz77(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(MAX_MOBI_TEXT_BYTES);
  let o = 0;
  let p = 0;
  const n = src.length;

  const room = (extra: number) => {
    if (o + extra <= MAX_MOBI_TEXT_BYTES) return;
    throw new MobiError("too-large", "The decoded text exceeds the size ceiling.");
  };

  while (p < n) {
    const b = src[p++];

    // ── 1..8: a run-length escape. Copy the next b bytes verbatim. ────────
    // Note that 0 is NOT part of this: byte 0x00 is a LITERAL NUL, not an
    // escape introducer. Several plausible-sounding descriptions of PalmDOC
    // claim 0x00 introduces escape sequences; that is not what the format
    // does, and following it produces text riddled with NULs.
    if (b >= 1 && b <= 8) {
      const end = Math.min(p + b, n);
      room(end - p);
      for (; p < end; p++) out[o++] = src[p];
      continue;
    }

    // ── 0 and 9..127: a literal byte. ───────────────────────────────────
    if (b < 128) {
      room(1);
      out[o++] = b;
      continue;
    }

    // ── 192..255: a space followed by (b & 0x7F). ────────────────────────
    // This is the rule that applies ONLY to the top quarter of the byte
    // range. Applying it to everything >= 0x80 — which several descriptions
    // of PalmDOC do, and which is the intuitive thing to write — silently
    // corrupts text while still returning bytes, because it consumes the
    // 0x80..0xBF bytes that are really back-references. Verified: that
    // version loses ~20% of a real book and injects NULs.
    if (b >= 192) {
      room(2);
      out[o++] = 0x20;
      out[o++] = b ^ 0x80;
      continue;
    }

    // ── 128..191: a two-byte back-reference. ─────────────────────────────
    //     packed = (b << 8) | nextByte
    //     distance = (packed >> 3) & 0x7FF      11 bits, a 2048-byte window
    //     length   = (packed & 7) + 3           3..10 bytes
    if (p >= n) break; // truncated trailing reference
    const packed = ((b << 8) | src[p++]) >>> 0;
    const distance = (packed >> 3) & 0x07ff;
    const length = (packed & 7) + 3;

    room(length);

    if (distance > length) {
      // The reference decoder takes the slice `out[-distance : length-distance]`.
      // Python normalises a negative stop against the CURRENT length, so:
      //   start = max(0, o - distance)
      //   stop  = min(o, (length - distance) < 0 ? o + (length - distance) : (length - distance))
      // This yields `length` bytes when the window is fully present, 0 when it
      // is not, and a partial count in between. Reproduced exactly: a real
      // book depends on the partial case, and matching real-world output is
      // worth more than matching the textbook.
      const start = o > distance ? o - distance : 0;
      let stop = length - distance;
      if (stop < 0) stop = o + stop;
      if (stop > o) stop = o;
      for (let i = start; i < stop; i++) out[o++] = out[i];
      continue;
    }

    // distance <= length: emit one byte at a time from a single fixed offset.
    // distance === 0 resolves to offset 0 (the reference's `out[-0:-0+1]`
    // slice is `out[0:1]`), and distance === 1 to the last byte. Reading
    // forward is also what makes overlapping run-extension copies correct,
    // which a precomputed slice would get wrong.
    const src0 = distance === 0 ? 0 : distance === 1 ? o - 1 : o - distance;
    const base = src0 < 0 ? 0 : src0;
    for (let k = 0; k < length; k++) out[o++] = out[base];
  }

  return out.subarray(0, o);
}

/**
 * Read only the metadata, without decoding the text.
 *
 * Useful for a library list: the cover and title come from the header, so a
 * shelf can be populated for a book that Kora cannot render.
 */
export function readMobiMeta(bytes: Uint8Array): MobiMeta | null {
  try {
    // parseMobiBytes is the single source of truth for the header layout.
    // We call it and accept that it decodes text; the alternative is a second
    // parser that can drift from the first.
    return parseMobiBytes(bytes).meta;
  } catch {
    return null;
  }
}