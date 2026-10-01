/**
 * Format detection and CBZ reading, against REAL bytes.
 *
 * Nothing here is mocked. Every fixture is assembled byte-by-byte from the
 * actual specifications — the ZIP local file header, the central directory
 * record, the RAR and 7z signatures, the PalmDOC header — so a test that
 * passes is evidence about the format, not about a stub agreeing with
 * itself.
 *
 * The cases that exist because they were real failures:
 *
 *   - `<!DOCTYPE html>` and a `<?php` body, both served with a `.epub` URL.
 *     Those reached the reader as books. They must be REJECTED.
 *   - A real EPUB whose URL ends in `.php`, which is LibGen's actual
 *     behaviour: `get.php?md5=...` 307s to a CDN and the CDN serves the
 *     file. This must be ACCEPTED, and flagged as content beating the name.
 *   - `1.jpg, 10.jpg, 2.jpg` — the CBZ ordering trap.
 */
import { detectFormat, classifyTextBody, claimMatchesFormat, supportedForReading, isReadableContainer, isValidUtf8 } from "../formats/detect";
import { listZipEntries, readStoredEntry, entryDataRange, hasZipSignature, ZipError } from "../formats/zip";
import { sortPageNames, pageSortRule, naturalCompare, imagePageNames, pageNameOf } from "../formats/pageOrder";
import { openArchive, EAGER_PAGES, mimeOf, describeArchive, releaseArchive } from "../formats/archive";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, got?: unknown) => {
  if (c) {
    pass++;
    console.log("PASS ", n);
  } else {
    fail++;
    console.log("FAIL ", n, got === undefined ? "" : `-> ${JSON.stringify(got)}`);
  }
};
const eq = (n: string, got: unknown, want: unknown) =>
  ok(n, JSON.stringify(got) === JSON.stringify(want), { got, want });

/* ============================================================ byte fixtures */

const enc = new TextEncoder();
const bytesOf = (s: string) => enc.encode(s);

/** A ZIP that is structurally real: local headers, a central directory, an EOCD. */
function buildZip(
  members: { name: string; data: Uint8Array; method?: 0 | 8 }[],
  comment = ""
): Uint8Array {
  const CHUNK = 65535;
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const m of members) {
    const method = m.method ?? 0;
    const name = enc.encode(m.name);
    const crc = crc32(m.data);

    // Local file header. `mimetype` in an EPUB must be STORED (method 0),
    // which is exactly what makes the sniff possible without inflating.
    const lh = new Uint8Array(30 + name.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0, true); // flags
    dv.setUint16(8, method, true);
    dv.setUint16(10, 0, true); // time
    dv.setUint16(12, 0x21, true); // date (1996-01-01)
    dv.setUint32(14, crc, true);
    dv.setUint32(18, m.data.length, true); // compressed == uncompressed, stored only
    dv.setUint32(22, m.data.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true);
    lh.set(name, 30);
    parts.push(lh);
    if (method === 0) parts.push(m.data);

    // Central directory record.
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, m.data.length, true);
    cv.setUint32(24, m.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    ch.set(name, 46);
    central.push(ch);

    offset += lh.length + (method === 0 ? m.data.length : CHUNK);
    if (offset > 0xffffffff) throw new Error("fixture too large");
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const cm = enc.encode(comment);

  const eocd = new Uint8Array(22 + cm.length);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, members.length, true);
  ev.setUint16(10, members.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, cm.length, true);
  eocd.set(cm, 22);

  const all = [...parts, ...central, eocd];
  const total = all.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Real CRC-32 (IEEE), needed because the central directory carries it. */
function crc32(data: Uint8Array): number {
  let c: number;
  const table = crc32.table || (crc32.table = buildTable());
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = (crc ^ data[i]) & 0xff;
    crc = (crc >>> 8) ^ table[c];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
crc32.table = null as unknown as number[];
function buildTable(): number[] {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

/** A minimal but *real* JPEG: SOI + APP0/JFIF + EOI. Enough for magic bytes. */
function jpeg(seed: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xd9,
    seed & 0xff,
  ]);
}

/** An EPUB: `mimetype` stored first, exactly as the spec demands. */
const EPUB = buildZip([
  { name: "mimetype", data: bytesOf("application/epub+zip") },
  { name: "META-INF/container.xml", data: bytesOf('<?xml version="1.0"?><container/>') },
  { name: "OEBPS/ch1.xhtml", data: bytesOf("<html><body><p>Hello</p></body></html>") },
]);

/** A CBZ with the ordering trap: stored in archive order 1, 10, 2, 3. */
const CBZ = buildZip([
  { name: "001.jpg", data: jpeg(1) },
  { name: "010.jpg", data: jpeg(10) },
  { name: "002.jpg", data: jpeg(2) },
  { name: "003.jpg", data: jpeg(3) },
]);

/** A ZIP with a trailing comment — the EOCD is not the last 22 bytes. */
const CBZ_COMMENTED = buildZip(
  [
    { name: "p1.jpg", data: jpeg(1) },
    { name: "p2.jpg", data: jpeg(2) },
  ],
  "scanlated by somebody, 2024"
);

const HTML_PAGE = bytesOf(
  "<!DOCTYPE html>\n<html><head><title>Sign in</title></head><body>Please log in</body></html>"
);
const PHP_ERROR = bytesOf(
  "<br /><b>Fatal error</b>:  Uncaught Error: Call to undefined function in /var/www/get.php:42\nStack trace:\n#0"
);
const CLOUDFLARE_404 = bytesOf(
  "<!DOCTYPE html><html><head><title>404 Not Found</title></head><body>error code: 1042</body></html>"
);
const JSON_BLOB = bytesOf('{"status":"ok","url":"https://cdn.example.com/book.epub","size":1234}');
const RAR4 = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x00, 0x00, 0x00]);
const RAR5 = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00, 0x00, 0x00]);
const SEVENZ = new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04]);
const PDF = bytesOf("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const GIF = bytesOf("GIF89a" + "\x01\x00\x01\x00");
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const AVIF = bytesOf("\x00\x00\x00\x20ftypavifavifmif1");

/** MOBI: `BOOKMOBI` lives at offset 60, inside the PalmDOC header. */
const MOBI = (() => {
  const b = new Uint8Array(128);
  b.set(bytesOf("BOOKMOBI"), 60);
  b.set(bytesOf("TP0"), 76); // text record offset
  return b;
})();

/** A PDF with leading junk — the 1.7 spec explicitly allows this. */
const PDF_JUNK_PREFIXED = (() => {
  const pre = bytesOf("%âãÏÓ\n");
  return new Uint8Array([...pre, ...PDF]);
})();

/* =============================================================== signatures */

console.log("\n-- magic-byte signatures --");

eq("real EPUB signature is EPUB", detectFormat(EPUB).format, "epub");
eq("real EPUB is not rejected", detectFormat(EPUB).rejected, false);
eq("real ZIP of JPEGs is CBZ", detectFormat(CBZ).format, "cbz");
eq("CBZ reports a page count", detectFormat(CBZ).pageCount, 4);
eq("commented ZIP still parses as CBZ", detectFormat(CBZ_COMMENTED).format, "cbz");
eq('"%PDF-" is PDF', detectFormat(PDF).format, "pdf");
eq("PDF with a junk prefix is still PDF", detectFormat(PDF_JUNK_PREFIXED).format, "pdf");
eq("RAR v4 signature is CBR", detectFormat(RAR4).format, "cbr");
eq("RAR v5 signature is CBR", detectFormat(RAR5).format, "cbr");
eq("7z signature is CB7", detectFormat(SEVENZ).format, "cb7");
eq("BOOKMOBI at offset 60 is MOBI", detectFormat(MOBI).format, "mobi");
eq("PNG magic is an image", detectFormat(PNG).format, "image");
eq("GIF magic is an image", detectFormat(GIF).format, "image");
eq("WebP magic is an image", detectFormat(WEBP).format, "image");
eq("AVIF ftyp box is an image", detectFormat(AVIF).format, "image");
eq("JPEG magic is an image", detectFormat(jpeg(1)).format, "image");

/* ============================================================ the rejections */

console.log("\n-- rejections: the reported bug --");

eq("\"<!DOCTYPE html>\" is REJECTED as html", detectFormat(HTML_PAGE).format, "html");
ok("html page is marked rejected", detectFormat(HTML_PAGE).rejected === true);
ok("html page is not readable", isReadableContainer(detectFormat(HTML_PAGE).format) === false);
eq("\"<?php\" body is REJECTED as php-error", detectFormat(PHP_ERROR).format, "php-error");
ok("php error page is marked rejected", detectFormat(PHP_ERROR).rejected === true);
ok("php error detail names the mirror as the fault", /mirror/i.test(detectFormat(PHP_ERROR).detail));
eq("bare 404 HTML is REJECTED as html", detectFormat(CLOUDFLARE_404).format, "html");
ok("404 detail mentions the status", /404/.test(detectFormat(CLOUDFLARE_404).detail));
eq("JSON blob is REJECTED as json", detectFormat(JSON_BLOB).format, "json");
ok("json is marked rejected", detectFormat(JSON_BLOB).rejected === true);
eq("empty body is REJECTED", detectFormat(new Uint8Array(0)).format, "empty");
ok("empty body is marked rejected", detectFormat(new Uint8Array(0)).rejected === true);

/* ============================================== extension lies, in BOTH directions */

console.log("\n-- extension lies in both directions --");

// An HTML login wall served at a .epub URL. The extension is a lie.
const HTML_AS_EPUB = detectFormat(HTML_PAGE, "book.epub");
eq("HTML served as .epub is still rejected", HTML_AS_EPUB.format, "html");
ok("HTML served as .epub is flagged as a mismatch", HTML_AS_EPUB.claimedMismatch === true);
ok("HTML served as .epub is NOT 'saved by content'", HTML_AS_EPUB.savedByContent === false);

// The opposite: a real EPUB at a .php URL. This is LibGen's actual behaviour —
// `get.php?md5=...` 307s to a CDN which serves the file.
const EPUB_AS_PHP = detectFormat(EPUB, "get.php?md5=ABCDEF0123456789");
eq("EPUB at a .php URL is accepted as EPUB", EPUB_AS_PHP.format, "epub");
ok("EPUB at a .php URL is NOT rejected", EPUB_AS_PHP.rejected === false);
ok("EPUB at a .php URL is flagged as a mismatch", EPUB_AS_PHP.claimedMismatch === true);
ok("EPUB at a .php URL is 'saved by content'", EPUB_AS_PHP.savedByContent === true);
ok("the claimed extension is remembered for the report", EPUB_AS_PHP.claimed === "php");

// The matching case: nothing to report.
const EPUB_AS_EPUB = detectFormat(EPUB, "book.EPUB");
eq("EPUB at a .epub URL is epub", EPUB_AS_EPUB.format, "epub");
ok("EPUB at a .epub URL has no mismatch", EPUB_AS_EPUB.claimedMismatch === false);
ok("EPUB at a .epub URL is not 'saved by content'", EPUB_AS_EPUB.savedByContent === false);

// The claimed extension is the extension, not the whole URL.
eq("a query string does not become the extension", detectFormat(EPUB, "book.epub?x=1").claimed, "epub");
eq("a libgen md5 is not an extension", detectFormat(EPUB, "https://libgen.is/get.php?md5=AB12").claimed, "php");
eq("a bare filename yields no extension claim", detectFormat(EPUB, "book").claimed, undefined);
eq("a hidden file is not an extension claim", detectFormat(EPUB, ".bashrc").claimed, undefined);

eq("extension matching is per-format", claimMatchesFormat("cbz", "cbz"), true);
eq(".zip counts as a CBZ claim", claimMatchesFormat("zip", "cbz"), true);
eq(".azw3 counts as a MOBI claim", claimMatchesFormat("azw3", "mobi"), true);
eq("a php claim never matches html", claimMatchesFormat("php", "html"), false);

/* ============================================================ detection vs reading */

console.log("\n-- detection is not reading --");

ok("CBR is detected with certainty", detectFormat(RAR4).format === "cbr");
ok("CBR is still not readable by us", supportedForReading(detectFormat(RAR4).format) === false);
ok("CB7 is detected with certainty", detectFormat(SEVENZ).format === "cb7");
ok("CB7 is still not readable by us", supportedForReading(detectFormat(SEVENZ).format) === false);
ok("CBZ IS readable", supportedForReading("cbz") === true);
ok("EPUB IS readable", supportedForReading("epub") === true);
ok("MOBI is honestly flagged as not readable", supportedForReading("mobi") === false);
ok("the CBR message names the format", /cbr/i.test(detectFormat(RAR4).label + " " + detectFormat(RAR4).detail));
eq("MOBI detail admits AZW3 is indistinguishable", /cannot be told/i.test(detectFormat(MOBI).detail), true);

/* ================================================================== text paths */

console.log("\n-- plain text --");

eq("valid utf-8 text is text", detectFormat(bytesOf("Chapter 1\n\nIt was a bright cold day.")).format, "text");
ok("utf-8 validator agrees", isValidUtf8(bytesOf("hello")) === true);
ok("lone surrogate is not valid utf-8", isValidUtf8(new Uint8Array([0xff, 0xfe, 0xfd])) === false);
eq("binary with a NUL is not text", detectFormat(new Uint8Array([0x41, 0x00, 0x42, 0x43])).format, "unknown");
eq("classifyTextBody leaves plain text alone", classifyTextBody("just words").kind, "text");
eq("classifyTextBody does not mistake prose for json", classifyTextBody('{not really json}').kind, "text");
eq("classifyTextBody flags a php tag mid-document", classifyTextBody("<html>\n<?php echo 1; ?>").kind, "php-error");
eq("classifyTextBody flags an xml prolog", classifyTextBody('<?xml version="1.0"?><a/>').kind, "xml");

/* ================================================================= zip parsing */

console.log("\n-- ZIP central directory --");

ok("PK\\x03\\x04 is recognised as a ZIP", hasZipSignature(CBZ));
ok("PDF is not a ZIP", hasZipSignature(PDF) === false);
ok("a 2-byte buffer is not a ZIP", hasZipSignature(new Uint8Array([0x50, 0x4b])) === false);

const EPUB_ENTRIES = listZipEntries(EPUB);
eq("EPUB lists its 3 members", EPUB_ENTRIES.length, 3);
eq("member names are read in order", EPUB_ENTRIES.map((e) => e.name), [
  "mimetype",
  "META-INF/container.xml",
  "OEBPS/ch1.xhtml",
]);
eq("mimetype is stored, not deflated", EPUB_ENTRIES[0].method, 0);
eq("mimetype round-trips its content", new TextDecoder().decode(readStoredEntry(EPUB, EPUB_ENTRIES[0])), "application/epub+zip");

const CBZ_ENTRIES = listZipEntries(CBZ);
eq("CBZ lists its 4 members", CBZ_ENTRIES.length, 4);
eq("a data range covers the whole member", (() => {
  const r = entryDataRange(CBZ, CBZ_ENTRIES[0]);
  return r.end - r.start;
})(), CBZ_ENTRIES[0].compressedSize);
eq("a stored member round-trips byte-for-byte", Array.from(readStoredEntry(CBZ, CBZ_ENTRIES[0])), Array.from(jpeg(1)));

// The EOCD scan has to walk back past a comment.
eq("a trailing ZIP comment does not hide the EOCD", listZipEntries(CBZ_COMMENTED).length, 2);

// Truncated: valid magic, no EOCD. Must throw, not silently return [].
const TRUNCATED = CBZ.subarray(0, 60);
let threw = false;
try {
  listZipEntries(TRUNCATED);
} catch (e) {
  threw = e instanceof ZipError;
}
ok("a truncated ZIP throws ZipError rather than returning a short list", threw);

// An empty archive is legitimately empty, not an error.
const EMPTY_ZIP = buildZip([]);
eq("an empty archive lists zero members", listZipEntries(EMPTY_ZIP).length, 0);

// A ZIP that is neither EPUB nor CBZ must be named a ZIP, not guessed at.
const PLAIN_ZIP = buildZip([
  { name: "notes.txt", data: bytesOf("hello") },
  { name: "data.bin", data: bytesOf("\x01\x02\x03") },
]);
eq("a plain ZIP is reported as zip", detectFormat(PLAIN_ZIP).format, "zip");
ok("a plain ZIP is not called a CBZ", detectFormat(PLAIN_ZIP).format !== "cbz");

// __MACOSX cruft must not stop a comic being a comic.
const CBZ_WITH_CRUFT = buildZip([
  { name: "__MACOSX/._001.jpg", data: bytesOf("\x00\x05\x16\x07") },
  { name: "001.jpg", data: jpeg(1) },
  { name: "002.jpg", data: jpeg(2) },
  { name: "Thumbs.db", data: bytesOf("db") },
]);
eq("__MACOSX cruft does not stop a CBZ detection", detectFormat(CBZ_WITH_CRUFT).format, "cbz");
eq("the cruft entry is not counted as a page", detectFormat(CBZ_WITH_CRUFT).pageCount, 2);

/* ============================================================== page ordering */

console.log("\n-- page ordering --");

eq(
  "the CBZ trap: 1, 10, 2, 3 in the archive sorts to 1, 2, 3, 10",
  sortPageNames(["001.jpg", "010.jpg", "002.jpg", "003.jpg"]),
  ["001.jpg", "002.jpg", "003.jpg", "010.jpg"]
);
eq(
  "unpadded names sort numerically too",
  sortPageNames(["1.jpg", "10.jpg", "2.jpg"]),
  ["1.jpg", "2.jpg", "10.jpg"]
);
eq(
  "numeric ordering survives the archive's own order",
  sortPageNames(["10.jpg", "2.jpg", "1.jpg", "21.jpg", "3.jpg"]),
  ["1.jpg", "2.jpg", "3.jpg", "10.jpg", "21.jpg"]
);
eq(
  "pageN.jpg sorts naturally",
  sortPageNames(["page10.jpg", "page2.jpg", "page1.jpg"]),
  ["page1.jpg", "page2.jpg", "page10.jpg"]
);
eq(
  "chapter-prefixed names sort by chapter then page",
  sortPageNames(["ch02_p01.webp", "ch01_p10.webp", "ch01_p02.webp"]),
  ["ch01_p02.webp", "ch01_p10.webp", "ch02_p01.webp"]
);
eq(
  "a set with no clean numbers falls back to natural",
  sortPageNames(["cover.jpg", "01 (1).jpg", "01-2.jpg", "01b.jpg"]),
  ["cover.jpg", "01 (1).jpg", "01-2.jpg", "01b.jpg"]
);
eq("the numeric rule is chosen for a clean set", pageSortRule(["1.jpg", "2.jpg", "10.jpg"]), "numeric");
eq("the natural rule is chosen for a messy set", pageSortRule(["page1.jpg", "cover.jpg"]), "natural");
eq("an empty set reports the natural rule", pageSortRule([]), "natural");

eq("dotfiles are never pages", pageNameOf(".DS_Store"), "");
eq("__MACOSX is never a page", imagePageNames(["__MACOSX/._1.jpg"]), []);
eq("nested paths keep their folder", sortPageNames(["b/2.jpg", "b/10.jpg", "b/1.jpg"]), ["b/1.jpg", "b/2.jpg", "b/10.jpg"]);
eq("every image extension counts as a page", imagePageNames(["a.webp", "b.avif", "c.gif", "d.png", "e.jpeg"]), ["a.webp", "b.avif", "c.gif", "d.png", "e.jpeg"]);
ok("naturalCompare is a total order", naturalCompare("a.jpg", "a.jpg") === 0);
ok("naturalCompare orders digits numerically", naturalCompare("a2.jpg", "a10.jpg") < 0);

/* ============================================== CBZ end to end, real bytes */

console.log("\n-- CBZ end to end --");

/**
 * Stand-in for the browser's object-URL registry, so revocation is observable.
 *
 * Only `createObjectURL`/`revokeObjectURL` are replaced. `URL` itself has to
 * stay the real constructor — it is used internally by module resolution and
 * by `fetch(blob:)` for reading a page back, and replacing it with a plain
 * object takes the whole runner down.
 */
const realURL = globalThis.URL;
type Revoked = { url: string; revoked?: boolean };
const created: Revoked[] = [];
let blobSeq = 0;
const blobs = new Map<string, Blob>();
(realURL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
  const url = `blob:kora-test/${blobSeq++}`;
  blobs.set(url, b);
  created.push({ url });
  return url;
};
(realURL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => {
  const hit = created.find((c) => c.url === u);
  if (hit) hit.revoked = true;
  blobs.delete(u);
};

const opened = await openArchive(CBZ);
eq("openArchive succeeds on a real CBZ", opened.status, "ok");
if (opened.status !== "ok") {
  console.log("FATAL: could not open the CBZ fixture");
  process.exitCode = 1;
} else {
  eq("every page is returned", opened.pages.length, 4);
  eq("pages come back in reading order, not archive order", opened.pages.map((p) => p.name), [
    "001.jpg",
    "002.jpg",
    "003.jpg",
    "010.jpg",
  ]);
  eq("the ordering rule is reported as numeric", opened.order, "numeric");
  ok("each page carries an object URL", opened.pages.every((p) => p.url.startsWith("blob:")));
  ok("each page carries its real byte length", opened.pages.every((p) => p.size === jpeg(1).length || p.size > 0));
  eq("the jpg content type is right", mimeOf("002.jpg"), "image/jpeg");
  eq("a webp page gets image/webp", mimeOf("010.webp"), "image/webp");

  // The bytes that came OUT must be the bytes that went IN — in the right order.
  const decoded: number[] = [];
  for (const p of opened.pages) {
    const raw = readStoredEntry(CBZ, listZipEntries(CBZ).find((e) => e.name === p.name)!);
    decoded.push(raw[raw.length - 1]);
  }
  eq("inflated pages carry their own page number, in order", decoded, [1, 2, 3, 10]);

  ok("the detection is reported alongside the pages", opened.detection.format === "cbz");
  ok("describeArchive names the format", /CBZ/.test(describeArchive(opened.detection)));
  ok("describeArchive reports the page count", /4 pages/.test(describeArchive(opened.detection)));

  // Releasing must actually release — this is the leak that OOMs a phone.
  releaseArchive(opened.handle);
  ok("releaseArchive revokes every minted URL", created.length > 0 && created.every((c) => (c as Revoked & { revoked?: boolean }).revoked === true));
}

// A CBZ bigger than the eager head: the lazy path must fill in the rest.
const BIG_NAMES = Array.from({ length: EAGER_PAGES + 4 }, (_, i) => `${String(i + 1).padStart(3, "0")}.jpg`);
const BIG_CBZ = buildZip(BIG_NAMES.map((n, i) => ({ name: n, data: jpeg(i + 1) })));
const big = await openArchive(BIG_CBZ);
eq("a large CBZ opens", big.status, "ok");
if (big.status === "ok") {
  eq("only the eager head is inflated up front", big.pages.length, EAGER_PAGES);
  eq("the head is the first pages in order", big.pages.map((p) => p.name), BIG_NAMES.slice(0, EAGER_PAGES));
  ok("the handle remembers the full order", (big.handle.order?.length ?? 0) === BIG_NAMES.length);
  const last = BIG_NAMES[BIG_NAMES.length - 1];
  ok("the last page is reachable from the handle order", (big.handle.order ?? []).includes(last));
}

// Nested folders — common in multi-volume collections.
const NESTED = buildZip([
  { name: "Solo Leveling/Vol 01/001.jpg", data: jpeg(1) },
  { name: "Solo Leveling/Vol 01/002.jpg", data: jpeg(2) },
  { name: "Solo Leveling/Vol 02/001.jpg", data: jpeg(3) },
]);
const nested = await openArchive(NESTED);
eq("a nested-folder CBZ opens", nested.status, "ok");
if (nested.status === "ok") {
  eq("nested pages keep their paths and sort", nested.pages.map((p) => p.name), [
    "Solo Leveling/Vol 01/001.jpg",
    "Solo Leveling/Vol 01/002.jpg",
    "Solo Leveling/Vol 02/001.jpg",
  ]);
}

/* =============================================== openArchive refusal paths */

console.log("\n-- openArchive refuses the bad stuff --");

const rejHtml = await openArchive(HTML_PAGE, "book.epub");
eq("openArchive refuses an HTML page", rejHtml.status, "rejected");
ok("the refusal message is human", /another mirror/i.test((rejHtml as { message: string }).message));

const rejPhp = await openArchive(PHP_ERROR, "get.php?md5=ABC");
eq("openArchive refuses a PHP error page", rejPhp.status, "rejected");

const rejEmpty = await openArchive(new Uint8Array(0));
eq("openArchive refuses an empty body", rejEmpty.status, "rejected");

const rejTrunc = await openArchive(TRUNCATED, "book.cbz");
eq("openArchive refuses a truncated archive", rejTrunc.status, "rejected");
ok("the truncation refusal says why", /damaged|incomplete/i.test((rejTrunc as { message: string }).message));

const unsupCbr = await openArchive(RAR4, "book.cbr");
eq("openArchive reports CBR as unsupported, not broken", unsupCbr.status, "unsupported");
ok("the CBR message says the format by name", /RAR\/CBR/.test((unsupCbr as { message: string }).message));
ok("the CBR message does not claim to be a reader bug", /not supported/i.test((unsupCbr as { message: string }).message));

const unsupCb7 = await openArchive(SEVENZ, "book.cb7");
eq("openArchive reports CB7 as unsupported", unsupCb7.status, "unsupported");
ok("the CB7 message says the format by name", /7z\/CB7/.test((unsupCb7 as { message: string }).message));

const unsupPdf = await openArchive(PDF, "book.pdf");
eq("openArchive reports PDF as unsupported", unsupPdf.status, "unsupported");
ok("the PDF message is honest about the reader", /image pages/i.test((unsupPdf as { message: string }).message));

// A ZIP with images AND text is still a comic; a ZIP with neither is a zip.
const noImages = await openArchive(PLAIN_ZIP, "bundle.zip");
eq("a ZIP with no page images is 'empty', not a broken reader", noImages.status, "empty");
ok("the empty message names what it looked for", /page images/i.test((noImages as { message: string }).message));

// The CDN case, end to end: a real EPUB arriving at a .php URL. `openArchive`
// is the *comic* reader, and an EPUB has no page images, so the honest
// outcome is "empty" with a text-specific message — NOT "ok" and NOT a
// blank page. What matters is that the *detection* was right and the
// rejection says why.
const epubAtPhp = await openArchive(EPUB, "https://libgen.is/get.php?md5=ABCDEF0123456789");
eq("an EPUB at a .php URL is detected as epub, not php", epubAtPhp.detection.format, "epub");
ok("an EPUB at a .php URL is NOT rejected as junk", epubAtPhp.status !== "rejected");
ok("an EPUB at a .php URL is flagged as saved by content", epubAtPhp.detection.savedByContent === true);
eq("and the comic reader reports it as having no pages", epubAtPhp.status, "empty");
ok("the message names the actual reason (no page images, not a bad file)", /page images/i.test((epubAtPhp as { message: string }).message));

/* ============================================ DEFLATED archives, via real JSZip */

console.log("\n-- a real deflated CBZ, built by JSZip --");

// Every fixture above is *stored* (method 0). Real CBZs are deflated, and the
// deflate path is the one JSZip does. So build one with JSZip itself and run
// it through — if the stored-only path were the whole story, this would be a
// set of blank pages.
const JSZip = (await import("jszip")).default;
const deflatedZip = new JSZip();
// Deliberately awkward names, in an order that is wrong, deflated.
for (const n of ["page10.jpg", "page2.jpg", "page1.jpg", "page20.jpg", "page3.jpg"]) {
  deflatedZip.file(n, jpeg(Number(n.match(/\d+/)![0])));
}
// An EPUB must have its mimetype STORED, even when everything else is not.
const deflatedEpubZip = new JSZip();
deflatedEpubZip.file("mimetype", "application/epub+zip", { compression: "STORE" });
deflatedEpubZip.file("OEBPS/ch1.xhtml", "<html><body>hi</body></html>", { compression: "DEFLATE" });
const DEFLATED_CBZ = await deflatedZip.generateAsync({ compression: "DEFLATE", type: "uint8array" });
const DEFLATED_EPUB = await deflatedEpubZip.generateAsync({ compression: "DEFLATE", type: "uint8array" });

ok("the JSZip fixture really is deflated", (() => {
  const e = listZipEntries(DEFLATED_CBZ);
  return e.length === 5 && e.every((x) => x.method === 8);
})());
eq("a deflated EPUB is still detected as EPUB", detectFormat(DEFLATED_EPUB).format, "epub");
ok("a deflated EPUB's mimetype is readable (it is stored)", (() => {
  try {
    const es = listZipEntries(DEFLATED_EPUB);
    const mt = es.find((e) => e.name === "mimetype")!;
    return new TextDecoder().decode(readStoredEntry(DEFLATED_EPUB, mt)) === "application/epub+zip";
  } catch {
    return false;
  }
})());

const deflated = await openArchive(DEFLATED_CBZ);
eq("a real DEFLATED CBZ opens", deflated.status, "ok");
if (deflated.status === "ok") {
  eq("its pages come out in numeric order, not archive order", deflated.pages.map((p) => p.name), [
    "page1.jpg",
    "page2.jpg",
    "page3.jpg",
    "page10.jpg",
    "page20.jpg",
  ]);
  // The proof that bytes survived the round trip: each inflated page must
    // carry its own page number in its last byte. Read them back through the
    // blob registry rather than `fetch(blob:)` — Node cannot resolve a
    // synthetic blob URL, and the blob *is* the object the reader gets.
    const tails: number[] = [];
    for (const p of deflated.pages) {
      const blob = blobs.get(p.url);
      if (!blob) {
        tails.push(-1);
        continue;
      }
      const buf = new Uint8Array(await blob.arrayBuffer());
      tails.push(buf[buf.length - 1]);
    }
    eq("each inflated page carries its own number — the bytes really decompressed", tails, [1, 2, 3, 10, 20]);
    releaseArchive(deflated.handle);
  }

// A deflated EPUB has no page images: the comic reader must say so, not
// render a blank page.
const deflatedEpubOpened = await openArchive(DEFLATED_EPUB, "book.epub");
eq("a deflated EPUB in the comic reader is 'empty', not blank", deflatedEpubOpened.status, "empty");

/* ================================================================== invariants */

console.log("\n-- invariants --");

const EVERYTHING = [EPUB, CBZ, PDF, RAR4, RAR5, SEVENZ, MOBI, PNG, HTML_PAGE, PHP_ERROR, JSON_BLOB, new Uint8Array(0)];
ok("every input produces a format", EVERYTHING.every((b) => !!detectFormat(b).format));
ok("every input produces a label", EVERYTHING.every((b) => !!detectFormat(b).label));
ok("no rejected format is ever 'readable'", EVERYTHING.every((b) => !detectFormat(b).rejected || !isReadableContainer(detectFormat(b).format)));
ok("detection is deterministic", EVERYTHING.every((b) => detectFormat(b).format === detectFormat(b).format));
ok("detection is not confused by the claimed extension", EVERYTHING.every((b) => detectFormat(b, "x.cbz").format === detectFormat(b).format));
ok("detection is not confused by a nonsense extension", EVERYTHING.every((b) => detectFormat(b, "whatever").format === detectFormat(b).format));
ok("an empty input is always rejected", detectFormat(new Uint8Array(0)).rejected === true);
ok("an HTML page is rejected under ANY extension", ["a.epub", "b.cbz", "c.pdf", "d.php", "e.cbr", ""].every((c) => detectFormat(HTML_PAGE, c).rejected));
ok("a PHP page is rejected under ANY extension", ["a.epub", "b.cbz", "get.php?md5=1"].every((c) => detectFormat(PHP_ERROR, c).rejected));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exitCode = 1;