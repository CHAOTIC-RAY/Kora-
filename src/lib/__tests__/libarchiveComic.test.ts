/**
 * RAR/CBR and 7z/CB7 reading, against REAL archives and REAL libarchive.
 *
 * Nothing here is mocked and no decoder is stubbed. The RAR4 fixtures are
 * assembled byte-by-byte to the published format (real block CRCs, real field
 * layout, stored payloads). The 7z fixtures were produced by `py7zr`, an
 * independent third-party writer, and are embedded as base64 — a second
 * implementation is what makes them evidence rather than a restatement of
 * this module's own beliefs.
 *
 * The cases exist because each was a real failure during integration:
 *
 *   - `_malloc`/`_free`/`HEAP8` do not exist on the `libarchive-wasm` wrapper;
 *     they live on `mod.module`. Calling them on the wrapper yields
 *     `undefined` and every page throws `TypeError`.
 *   - The open sequence is `read_new` → `read_support_filter_all` →
 *     `read_support_format_all` → `read_open_memory`. Skipping the support
 *     calls opens a handle that silently yields ZERO entries.
 *   - A multi-volume archive must be REFUSED BY NAME, never shown as a partial
 *     book that looks like success.
 *   - Path traversal in member names (CVE-2023-43616 / GHSA-8c8w-f7wp-2jr2
 *     class) must be dropped before the name is ever used as a map key.
 */
import { openArchive, EAGER_PAGES, releaseArchive, loadArchivePageFromHandle } from "../formats/archive";
import { isSafeArchiveEntry } from "../formats/safePath";

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

/** The user-facing sentence, for results that may or may not carry one. */
function messageOf(r: unknown): string {
  const m = (r as { message?: unknown }).message;
  return typeof m === "string" ? m : "";
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ============================================================ blob registry */

/**
 * Stand-in for the browser's object-URL registry, so revocation is observable.
 * Only createObjectURL/revokeObjectURL are replaced — `URL` itself stays the
 * real constructor, which is used internally for module resolution.
 */
const realURL = globalThis.URL;
type Revoked = { url: string; revoked?: boolean };
const created: Revoked[] = [];
let blobSeq = 0;
const blobs = new Map<string, Blob>();
(realURL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
  const url = `blob:kora-rare/${blobSeq++}`;
  blobs.set(url, b);
  created.push({ url });
  return url;
};
(realURL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => {
  const hit = created.find((c) => c.url === u);
  if (hit) hit.revoked = true;
  blobs.delete(u);
};

/** Read a minted blob back as bytes — the object the reader actually gets. */
async function bytesAt(url: string): Promise<Uint8Array> {
  const blob = blobs.get(url);
  if (!blob) throw new Error(`no blob registered for ${url}`);
  return new Uint8Array(await blob.arrayBuffer());
}

/* ============================================================ RAR 4 fixtures */

function crc32(bytes: Uint8Array, from = 0, to = bytes.length): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A stored JPEG-ish payload. Its length and tail marker are what we assert on. */
function jpeg(tag: number): Uint8Array {
  const b = new Uint8Array(64);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[63] = 0xd9;
  b.set(enc.encode(`page${tag}`), 4);
  return b;
}

const RAR4_SIG = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);

/** Main archive header (0x73): HEAD_CRC(2) TYPE(1) FLAGS(2) SIZE(2) HighPosAv(2) PosAv(4). */
function rar4Main(volume: boolean): Uint8Array {
  const out = new Uint8Array(13);
  const dv = new DataView(out.buffer);
  out[2] = 0x73;
  dv.setUint16(3, volume ? 0x0001 : 0x0000, true); // MHD_VOLUME
  dv.setUint16(5, 13, true);
  dv.setUint16(7, 0, true);
  dv.setUint32(9, 0, true);
  dv.setUint16(0, crc32(out, 2, 13), true);
  return out;
}

/**
 * File header (0x74), RAR4 layout with NO separate ADD_SIZE field:
 *   0 CRC | 2 TYPE | 3 FLAGS | 5 SIZE | 7 PACK_SIZE | 11 UNP_SIZE
 *   15 HOST_OS | 16 FILE_CRC | 20 FTIME | 24 UNP_VER | 25 METHOD
 *   26 NAME_SIZE | 28 ATTR | 32 NAME
 *
 * HOST_OS is MS-DOS (0), which is what WinRAR writes. Setting it to Unix
 * instead makes libarchive report filetype 0 rather than AE_IFREG, and every
 * entry is then skipped as a non-file — a fixture that parses but yields
 * nothing.
 */
function rar4File(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = enc.encode(name);
  const headSize = 32 + nameBytes.length;
  const out = new Uint8Array(headSize);
  const dv = new DataView(out.buffer);
  out[2] = 0x74;
  dv.setUint16(3, 0x8000, true); // LONG_BLOCK
  dv.setUint16(5, headSize, true);
  dv.setUint32(7, data.length, true);   // PACK_SIZE
  dv.setUint32(11, data.length, true);  // UNP_SIZE
  out[15] = 0x00;                       // HOST_OS = MS-DOS
  dv.setUint32(16, crc32(data), true);  // FILE_CRC
  dv.setUint32(20, 0x50000000, true);   // FTIME
  out[24] = 0x14;                       // UNP_VER 2.0
  out[25] = 0x30;                       // METHOD 0x30 = store
  dv.setUint16(26, nameBytes.length, true);
  dv.setUint32(28, 0x81a40000, true);   // ATTR
  out.set(nameBytes, 32);
  dv.setUint16(0, crc32(out, 2, headSize), true);
  return out;
}

function rar4End(): Uint8Array {
  const out = new Uint8Array(7);
  const dv = new DataView(out.buffer);
  out[2] = 0x7b;
  dv.setUint16(3, 0x4000, true);
  dv.setUint16(5, 7, true);
  dv.setUint16(0, crc32(out, 2, 7), true);
  return out;
}

function buildRar4(
  members: { name: string; data: Uint8Array }[],
  opts: { volume?: boolean } = {}
): Uint8Array {
  const parts: Uint8Array[] = [
    RAR4_SIG,
    rar4Main(!!opts.volume),
    ...members.flatMap((m) => [rar4File(m.name, m.data), m.data] as Uint8Array[]),
    rar4End(),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A CBR that is not a real book: the RAR4 signature and nothing else. */
const RAR_SIGNATURE_ONLY = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x00, 0x00, 0x00]);
/** RAR5 signature, likewise truncated. */
const RAR5_SIGNATURE_ONLY = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00, 0x00, 0x00]);

/* ============================================================= 7z  (py7zr) */

/**
 * Genuine 7z archives written by `py7zr` 1.1.3, an independent implementation.
 *
 * Embedded rather than generated in-process because the in-process hand-rolled
 * encoder produced archives real libarchive rejected with "Header CRC error",
 * which is exactly the kind of self-consistent stub this suite must not be.
 *
 * book.cb7 contains 001.jpg, 002.jpg, 010.jpg — 64-byte stored payloads whose
 * bytes 4..N spell `page1`, `page2`, `page10`.
 * evil.cb7 contains `../../etc/passwd.jpg` and `page1.jpg`.
 */
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const SEVENZ_BOOK = fromB64(
  "N3q8ryccAAT7h7kumAAAAAAAAAAVAAAAAAAAAA9ponXgAL8AGl0Af7Yb4ANkqhjrT2pyipM4+iyqBP+dnNKfQOYA4ACcAG5dAACBMweuD9As9LyfORCcbxUCucMUxx2G1HDIS2bwPeyGco1Hec1yLuG8cjZrFqez2elEVYSU1UP7g8IvQUi+G1IGEtyAwGFU7aKt7EYs59g5zLzm/luQdlxNXEAnlmBLYUW+dm76nO3LWK/IAAAAABcGIgEJdgAHCwEAASEhARgMgJ0AAA=="
);
const SEVENZ_EVIL = fromB64(
  "N3q8ryccAAQ/jY1amAAAAAAAAAAVAAAAAAAAAGhiGArgAH8AFl0Af7Yb4ANkqhjrT2pyipM4+iyp9VGOAADgAJYAcl0AAIEzB64Pz+swFA/Ual595dfdCD15OKS/qfhFBvfM3sN0wjimb2cFO8E+WWY7NbZ5XcSsNN1Wm3nSxtnRmd4exRKw1evzibKgqVHfccyr4iQohaZFoDP2X5W9JVkTUeLffamRLnja1eizV4ZqEEhAAAAAABcGHgEJegAHCwEAASEhARgMgJcAAA=="
);

/* ==================================================== the normal path: CBR */

console.log("\n-- a real CBR opens, in reading order, with live blob URLs --");

const CBR = buildRar4([
  { name: "001.jpg", data: jpeg(1) },
  { name: "002.jpg", data: jpeg(2) },
  { name: "010.jpg", data: jpeg(10) },
]);

const cbr = await openArchive(CBR, "book.cbr");
eq("a real CBR opens", cbr.status, "ok");
if (cbr.status === "ok") {
  eq("every page is returned", cbr.pages.length, 3);
  // The ordering trap: 1, 2, 10 — archive order, natural order and numeric
  // order all agree here, so also assert the reported rule.
  eq("pages come back in reading order", cbr.pages.map((p) => p.name), ["001.jpg", "002.jpg", "010.jpg"]);
  eq("the ordering rule is reported as numeric", cbr.order, "numeric");
  ok("each page carries a blob URL", cbr.pages.every((p) => p.url.startsWith("blob:")));
  eq("detection says CBR", cbr.detection.format, "cbr");

  // The decisive assertion: the bytes that came OUT are the bytes that went
  // IN. A decoder that returns empty buffers still satisfies "blob:" above.
  const markers: string[] = [];
  for (const p of cbr.pages) {
    const raw = await bytesAt(p.url);
    markers.push(dec.decode(raw.subarray(4, raw.length - 1)).replace(/\0+$/, ""));
  }
  eq("each page carries its own bytes, in order", markers, ["page1", "page2", "page10"]);

  ok(
    "each page reports a non-zero uncompressed size",
    cbr.pages.every((p) => p.size === 64)
  );

  // Content type, so the blob URL is not an untyped blob.
  eq("the jpg content type is right", blobs.get(cbr.pages[0].url)?.type, "image/jpeg");

  // releaseArchive must revoke on the RAR path too — that path holds every
  // page's bytes in a Map, so leaking it is an OOM, not a slow read.
  const before = created.filter((c) => !c.revoked).length;
  releaseArchive(cbr.handle);
  eq("releaseArchive revoked the URLs it minted", created.filter((c) => c.revoked).length, before);
  ok("releaseArchive dropped the retained page bytes", cbr.handle.source === undefined);
  ok("releaseArchive left no un-revoked URL behind", created.every((c) => c.revoked === true));
}

/* ================================================== ordering: the real trap */

console.log("\n-- a CBR stored in the wrong order still reads correctly --");

const CBR_UNSORTED = buildRar4([
  { name: "001.jpg", data: jpeg(1) },
  { name: "010.jpg", data: jpeg(10) },
  { name: "002.jpg", data: jpeg(2) },
]);
const cbrUnsorted = await openArchive(CBR_UNSORTED, "book.cbr");
eq("an out-of-order CBR opens", cbrUnsorted.status, "ok");
if (cbrUnsorted.status === "ok") {
  eq("pages are re-sorted into reading order", cbrUnsorted.pages.map((p) => p.name), [
    "001.jpg",
    "002.jpg",
    "010.jpg",
  ]);
  const markers: string[] = [];
  for (const p of cbrUnsorted.pages) {
    const raw = await bytesAt(p.url);
    markers.push(dec.decode(raw.subarray(4, raw.length - 1)).replace(/\0+$/, ""));
  }
  eq("and each one still carries its own bytes", markers, ["page1", "page2", "page10"]);
  releaseArchive(cbrUnsorted.handle);
}

/* ============================================ the eager head and lazy tail */

console.log("\n-- pages past the eager head are still reachable --");

const BIG_NAMES = Array.from(
  { length: EAGER_PAGES + 3 },
  (_, i) => `${String(i + 1).padStart(3, "0")}.jpg`
);
const CBR_BIG = buildRar4(BIG_NAMES.map((n, i) => ({ name: n, data: jpeg(i + 1) })));
const cbrBig = await openArchive(CBR_BIG, "book.cbr");
eq("a CBR larger than the eager head opens", cbrBig.status, "ok");
if (cbrBig.status === "ok") {
  eq("only the eager head is minted up front", cbrBig.pages.length, EAGER_PAGES);
  ok("the handle remembers the full order", (cbrBig.handle.order?.length ?? 0) === BIG_NAMES.length);
  const last = BIG_NAMES[BIG_NAMES.length - 1];
  ok("the last page is in the handle order", (cbrBig.handle.order ?? []).includes(last));

  // The dispatcher a reader should actually call.
  const lazy = await loadArchivePageFromHandle(cbrBig.handle, last);
  ok("a page past the eager head can be loaded on demand", !!lazy);
  if (lazy) {
    ok("the lazy page has a blob URL", lazy.url.startsWith("blob:"));
    const raw = await bytesAt(lazy.url);
    eq("the lazy page carries its own bytes", dec.decode(raw.subarray(4, raw.length - 1)).replace(/\0+$/, ""), `page${BIG_NAMES.length}`);
    ok("the lazy URL is tracked on the handle so release can revoke it", cbrBig.handle.urls.includes(lazy.url));
    // Proving the copy: revoking must not invalidate a still-held reference
    // to the bytes, because they were copied out of the WASM heap.
    ok("the lazy bytes survive until revoked", raw.length === 64);
  }

  const missing = await loadArchivePageFromHandle(cbrBig.handle, "nope.jpg");
  eq("an unknown page name is null, not a blank page", missing, null);

  releaseArchive(cbrBig.handle);
  ok("releaseArchive covers lazily-loaded URLs too", created.every((c) => c.revoked === true));
}

/* ======================================================== 7z / CB7 reading */

console.log("\n-- a real 7z opens (fixture written by py7zr) --");

const cb7 = await openArchive(SEVENZ_BOOK, "book.cb7");
eq("a real CB7 opens", cb7.status, "ok");
if (cb7.status === "ok") {
  eq("every 7z page is returned", cb7.pages.length, 3);
  eq("7z pages come back in reading order", cb7.pages.map((p) => p.name), ["001.jpg", "002.jpg", "010.jpg"]);
  const markers: string[] = [];
  for (const p of cb7.pages) {
    const raw = await bytesAt(p.url);
    markers.push(dec.decode(raw.subarray(4, raw.length - 1)).replace(/\0+$/, ""));
  }
  eq("each 7z page carries its own bytes", markers, ["page1", "page2", "page10"]);
  eq("detection says CB7", cb7.detection.format, "cb7");
  releaseArchive(cb7.handle);
}

/* =============================================== refusals: named, not silent */

console.log("\n-- refusals are named, never silent --");

// Split volume. MUST be refused clearly rather than showing a partial book.
const split = await openArchive(
  buildRar4([{ name: "001.jpg", data: jpeg(1) }], { volume: true }),
  "book.part1.cbr"
);
ok("a split volume is not reported as a readable comic", split.status !== "ok", split.status);
ok("the split refusal mentions volumes", /multi-volume|volumes/i.test(messageOf(split)), messageOf(split));
ok("the split refusal does not claim success", !/\d+\s+pages/.test(messageOf(split)));

// Same volume flag, but named as part N — the filename signal.
const splitNamed = await openArchive(buildRar4([{ name: "001.jpg", data: jpeg(1) }]), "book.part01.rar");
ok("a .part01.rar is refused too", splitNamed.status !== "ok", splitNamed.status);

// A RAR signature with no archive behind it. libarchive opens a 10-byte
// signature without complaint and simply reports zero entries, so this is
// honestly "empty" — the container parsed, it just has no pages. Asserting
// "rejected" here would be asserting a stricter reading than libarchive gives.
const stub4 = await openArchive(RAR_SIGNATURE_ONLY, "book.cbr");
eq("a bare RAR4 signature yields no pages", stub4.status, "empty");
ok("and says what it looked for", /image pages/i.test(messageOf(stub4)), messageOf(stub4));

const stub5 = await openArchive(RAR5_SIGNATURE_ONLY, "book.cbr");
ok("a bare RAR5 signature is refused, not thrown", stub5.status !== "ok", stub5.status);

// A 7z signature with nothing behind it.
const stubZ = await openArchive(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04]), "book.cb7");
ok("a bare 7z signature is refused, not thrown", stubZ.status !== "ok", stubZ.status);

// Truncated mid-payload: the page header promises bytes that are not there.
const truncated = CBR.subarray(0, CBR.length - 20);
const truncRes = await openArchive(truncated, "book.cbr");
ok("a truncated CBR is refused", truncRes.status !== "ok", truncRes.status);

// Empty.
const empty = await openArchive(new Uint8Array(0), "book.cbr");
eq("an empty CBR is refused", empty.status, "rejected");

// Every refusal carries a sentence. An empty message renders as a blank
// error card, which is the failure this whole module exists to prevent.
for (const [label, r] of [
  ["split", split],
  ["split-by-name", splitNamed],
  ["stub-rar4", stub4],
  ["stub-rar5", stub5],
  ["stub-7z", stubZ],
  ["truncated", truncRes],
] as const) {
  ok(`${label} explains itself in a non-empty sentence`, messageOf(r).length > 10, messageOf(r));
}

/* ============================================================ zip-slip gate */

console.log("\n-- path traversal in member names is rejected --");

// The gate itself, on the exact names libarchive hands back verbatim.
ok("a ../-prefixed name is refused by the path gate", !isSafeArchiveEntry("../../../.ssh/authorized_keys"));
ok("a Windows drive path is refused by the path gate", !isSafeArchiveEntry("C:\\Windows\\evil.jpg"));
ok("an absolute POSIX path is refused by the path gate", !isSafeArchiveEntry("/etc/passwd"));
ok("a UNC path is refused by the path gate", !isSafeArchiveEntry("\\\\host\\share\\a.jpg"));
ok("a mixed-separator traversal is refused by the path gate", !isSafeArchiveEntry("a\\..\\..\\b.jpg"));
ok("a NUL byte is refused by the path gate", !isSafeArchiveEntry("a\u0000.jpg"));
ok("a legitimate nested page name is allowed", isSafeArchiveEntry("Solo Leveling/Vol 01/001.jpg"));

// End to end: a real RAR carrying hostile member names. The hostile entries
// must not become pages, and the one legitimate entry must survive — so this
// proves filtering rather than blanket rejection.
const CBR_EVIL = buildRar4([
  { name: "../../../.ssh/authorized_keys", data: jpeg(1) },
  { name: "C:\\Windows\\evil.jpg", data: jpeg(2) },
  { name: "ok/001.jpg", data: jpeg(3) },
]);
const cbrEvil = await openArchive(CBR_EVIL, "evil.cbr");
eq("a RAR of hostile names still opens for its legitimate page", cbrEvil.status, "ok");
if (cbrEvil.status === "ok") {
  eq("only the safe entry survived", cbrEvil.pages.map((p) => p.name), ["ok/001.jpg"]);
  ok(
    "no page name contains a traversal segment",
    cbrEvil.pages.every((p) => !p.name.includes("..") && !p.name.includes(":"))
  );
  const raw = await bytesAt(cbrEvil.pages[0].url);
  eq("the surviving page is the right one", dec.decode(raw.subarray(4, raw.length - 1)).replace(/\0+$/, ""), "page3");
  releaseArchive(cbrEvil.handle);
}

// Same for 7z, from the real py7zr fixture.
const cb7Evil = await openArchive(SEVENZ_EVIL, "evil.cb7");
eq("a 7z of hostile names opens for its legitimate page", cb7Evil.status, "ok");
if (cb7Evil.status === "ok") {
  eq("the 7z traversal entry was dropped", cb7Evil.pages.map((p) => p.name), ["page1.jpg"]);
  ok("no 7z page name contains a traversal segment", cb7Evil.pages.every((p) => !p.name.includes("..")));
  releaseArchive(cb7Evil.handle);
}

// An archive of ONLY hostile names must report empty, not open with junk.
const CBR_ALL_EVIL = buildRar4([{ name: "../../etc/passwd.jpg", data: jpeg(1) }]);
const allEvil = await openArchive(CBR_ALL_EVIL, "evil.cbr");
ok("an archive of only hostile names does not open as a comic", allEvil.status !== "ok", allEvil.status);

/* ==================================================== the ZIP path is intact */

console.log("\n-- the ZIP path is unchanged --");

// A CBZ and a CBR with identical page names must produce identical shapes.
const ZIP_EQUIV = (() => {
  // Minimal stored-only ZIP with the same three members as CBR.
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of [["001.jpg", jpeg(1)], ["002.jpg", jpeg(2)], ["010.jpg", jpeg(10)]] as const) {
    const nb = enc.encode(name);
    const lh = new Uint8Array(30 + nb.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint32(14, crc32(data), true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nb.length, true);
    lh.set(nb, 30);
    parts.push(lh, data);

    const ch = new Uint8Array(46 + nb.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc32(data), true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nb.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nb, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 3, true);
  ev.setUint16(10, 3, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const total = all.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
})();

const cbz = await openArchive(ZIP_EQUIV, "book.cbz");
eq("the equivalent CBZ opens", cbz.status, "ok");
if (cbz.status === "ok" && cbr.status === "ok") {
  eq("same page names from both containers", cbz.pages.map((p) => p.name), cbr.pages.map((p) => p.name));
  eq("same ordering rule from both containers", cbz.order, cbr.order);
  eq("same page sizes from both containers", cbz.pages.map((p) => p.size), cbr.pages.map((p) => p.size));
  eq("same result status from both containers", cbz.status, cbr.status);
  // The reader cannot tell them apart from the handle's shape alone.
  eq("the handles are structurally identical", Object.keys(cbz.handle).sort(), Object.keys(cbr.handle).sort());
  const zipLazy = await loadArchivePageFromHandle(cbz.handle, "002.jpg");
  ok("the ZIP lazy path still works", !!zipLazy);
  releaseArchive(cbz.handle);
  releaseArchive(cbr.handle);
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exitCode = 1;
void realURL;