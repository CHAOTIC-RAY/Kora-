/**
 * The reliability ledger and the wrong-book gate.
 *
 * The bug these guard against: the sheet rendered a reliability percentage
 * that was backed by nothing, because no download path ever wrote an outcome.
 * Every test here is about the tally being REAL — recorded on success, on
 * failure and on a wrong book, surviving a reload, changing the order, and
 * never inventing a number for a host that has not been tried.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  RELIABILITY_STORAGE_KEY,
  __resetReliabilityCache,
  entryFor,
  orderByReliability,
  recordMirrorOutcome,
  reliabilityForUrl,
  hostOf,
  type MirrorVerdict,
} from "../mirrorReliability";
import { isFileUrl, isPseudoMd5, isRealLibgenMd5, verifyDownloadedBook } from "../bookIdentity";
import { judgeMirrorDownload } from "../mirrorOutcome";

// ── localStorage double ────────────────────────────────────────────────────
class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const g = globalThis as any;
g.localStorage = new MemStorage();
function freshStore() {
  g.localStorage.clear();
  __resetReliabilityCache();
}

// A real, minimal EPUB whose OPF declares a title.
async function makeEpub(title: string): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata></package>`
  );
  const buf = await zip.generateAsync({ type: "uint8array" });
  return new Uint8Array(buf);
}

const HTML = new TextEncoder().encode(
  "<!DOCTYPE html><html><head><title>The Pentecost Of Calamity</title></head><body>login</body></html>"
);

// ── hostOf ────────────────────────────────────────────────────────────────

test("hostOf extracts and normalises a host", () => {
  assert.equal(hostOf("https://LibGen.Li/get.php?md5=abc"), "libgen.li");
  assert.equal(hostOf("https://www.royallib.com/book/x.html"), "royallib.com");
  assert.equal(hostOf("not a url"), "");
  assert.equal(hostOf("/relative/path"), "");
});

// ── md5 classification ────────────────────────────────────────────────────

test("a 32-hex md5 is real; a 64-hex SHA-256 is a pseudo-id", () => {
  assert.equal(isRealLibgenMd5("50035d4d47bcd0e741e0c04092ef9959"), true);
  assert.equal(isRealLibgenMd5("2e8c2b249ae6146b904205eb19bc4caa63bc57f2393ecfd3db8be17e26f2bf93"), false);
  assert.equal(isPseudoMd5("2e8c2b249ae6146b904205eb19bc4caa63bc57f2393ecfd3db8be17e26f2bf93"), true);
  assert.equal(isPseudoMd5("50035d4d47bcd0e741e0c04092ef9959"), false);
});

// ── HTML pages are not files ──────────────────────────────────────────────

test("reader pages are not file URLs, real files are", () => {
  assert.equal(isFileUrl("https://royallib.com/book/Wister_Owen/the_pentecost_of_calamity.html"), false);
  assert.equal(isFileUrl("https://forum.mobilism.org/viewtopic.php?f=1292&t=846272"), false);
  assert.equal(isFileUrl("https://archive.org/details/TheHorseInHistory"), false);
  assert.equal(isFileUrl("https://libgen.li/get.php?md5=50035d4d47bcd0e741e0c04092ef9959"), true);
  assert.equal(isFileUrl("https://archive.org/download/x/x.epub"), true);
  assert.equal(isFileUrl("https://downloads.libretexts.org/api/v1/download/chem-64654/pdf"), true);
});

// ── recording outcomes ────────────────────────────────────────────────────

test("a success is recorded and yields 100%", () => {
  freshStore();
  recordMirrorOutcome("https://libgen.li/get.php?md5=abc", "real-book");
  const e = entryFor("libgen.li")!;
  assert.equal(e.percent, 100);
  assert.equal(e.successes, 1);
  assert.equal(e.failures, 0);
  assert.equal(e.attempts, 1);
});

test("a failure is recorded and yields 0%", () => {
  freshStore();
  recordMirrorOutcome("https://royallib.com/book/a.html", "html-page");
  const e = entryFor("royallib.com")!;
  assert.equal(e.percent, 0);
  assert.equal(e.failures, 1);
  assert.equal(e.successes, 0);
});

test("an identity mismatch counts as a FAILURE, not a success", () => {
  freshStore();
  recordMirrorOutcome("https://royallib.com/book/a.html", "identity-mismatch", {
    requested: "The Calamity Club",
    delivered: "The Pentecost Of Calamity",
  });
  const e = entryFor("royallib.com")!;
  assert.equal(e.percent, 0, "serving the wrong book must not count as a win");
  assert.equal(e.mismatched, true);
  assert.equal(e.lastMismatch?.requested, "The Calamity Club");
  assert.match(e.reason, /DIFFERENT book/i);
});

test("interrupted and rate-limited attempts are NOT recorded", () => {
  freshStore();
  assert.equal(recordMirrorOutcome("https://libgen.li/x", "interrupted"), null);
  assert.equal(recordMirrorOutcome("https://libgen.li/x", "rate-limited"), null);
  const e = entryFor("libgen.li")!;
  assert.equal(e.percent, null, "an ignored verdict must not create a score");
  assert.equal(e.attempts, 0);
});

test("no outcome means no score — never 0% and never 100%", () => {
  freshStore();
  const e = entryFor("libgen.li")!;
  assert.equal(e.percent, null);
  assert.equal(e.badge, "Not measured");
  assert.match(e.reason, /Not measured yet/i);
  assert.doesNotMatch(e.badge, /%/);
});

test("percent is successes over all counted attempts", () => {
  freshStore();
  recordMirrorOutcome("https://a.example/x", "real-book");
  recordMirrorOutcome("https://a.example/y", "real-book");
  recordMirrorOutcome("https://a.example/z", "unreachable");
  const e = entryFor("a.example")!;
  assert.equal(e.percent, 67);
  assert.equal(e.attempts, 3);
  assert.equal(e.successes, 2);
  assert.equal(e.failures, 1);
});

test("a low-sample score shows its sample size rather than a bare number", () => {
  freshStore();
  recordMirrorOutcome("https://a.example/x", "real-book");
  const e = entryFor("a.example")!;
  assert.equal(e.percent, 100);
  assert.match(e.badge, /1 try/);
});

test("tallies persist across a store reload", () => {
  freshStore();
  recordMirrorOutcome("https://libgen.li/get.php?md5=abc", "real-book");
  recordMirrorOutcome("https://libgen.li/get.php?md5=abc", "html-page");
  // Simulate a page reload: the in-memory cache is dropped, storage remains.
  __resetReliabilityCache();
  const e = reliabilityForUrl("https://libgen.li/get.php?md5=zzz")!;
  assert.equal(e.percent, 50, "the score must survive a reload");
  assert.equal(e.attempts, 2);
});

test("a wrong-book flag survives reload but clears on a good download", () => {
  freshStore();
  recordMirrorOutcome("https://royallib.com/a.html", "identity-mismatch", {
    requested: "A",
    delivered: "B",
  });
  __resetReliabilityCache();
  assert.equal(entryFor("royallib.com")!.mismatched, true);
  recordMirrorOutcome("https://royallib.com/a.html", "real-book");
  __resetReliabilityCache();
  assert.equal(entryFor("royallib.com")!.mismatched, false, "a good delivery clears the flag");
});

test("a corrupt store yields no score instead of a fabricated one", () => {
  g.localStorage.setItem(RELIABILITY_STORAGE_KEY, "{not json");
  __resetReliabilityCache();
  assert.equal(entryFor("libgen.li")!.percent, null);
});

// ── ordering ──────────────────────────────────────────────────────────────

test("ordering puts measured-good first, unmeasured and measured-bad below it", () => {
  freshStore();
  recordMirrorOutcome("https://good.example/f.epub", "real-book");
  recordMirrorOutcome("https://bad.example/f.epub", "html-page");
  const rows = [
    { url: "https://unknown.example/f.epub" },
    { url: "https://bad.example/f.epub" },
    { url: "https://good.example/f.epub" },
  ];
  const order = orderByReliability(rows, (r) => r.url).map((r) => r.url);
  assert.deepEqual(order, [
    "https://good.example/f.epub",
    // Measured-bad (0%) outranks unmeasured: we have real evidence it fails,
    // whereas "unknown" is not evidence of anything.
    "https://bad.example/f.epub",
    "https://unknown.example/f.epub",
  ]);
});

test("order CHANGES once tallies exist — this is the fix for arbitrary order", () => {
  freshStore();
  const rows = [
    { url: "https://first.example/f.epub" },
    { url: "https://second.example/f.epub" },
  ];
  // Before any measurement the incoming order is preserved.
  assert.deepEqual(
    orderByReliability(rows, (r) => r.url).map((r) => r.url),
    ["https://first.example/f.epub", "https://second.example/f.epub"]
  );
  // After measuring, the measured-good mirror wins.
  recordMirrorOutcome("https://second.example/f.epub", "real-book");
  assert.deepEqual(
    orderByReliability(rows, (r) => r.url).map((r) => r.url),
    ["https://second.example/f.epub", "https://first.example/f.epub"]
  );
});

test("a mirror that served the wrong book sorts below other measured hosts", () => {
  freshStore();
  recordMirrorOutcome("https://wrong.example/f.epub", "identity-mismatch", {
    requested: "A",
    delivered: "B",
  });
  const rows = [
    { url: "https://wrong.example/f.epub" },
    { url: "https://half.example/f.epub" },
  ];
  recordMirrorOutcome("https://half.example/f.epub", "real-book");
  recordMirrorOutcome("https://half.example/f.epub", "html-page");
  const order = orderByReliability(rows, (r) => r.url).map((r) => r.url);
  assert.equal(order[1], "https://wrong.example/f.epub", "wrong book goes last, not merely low");
});

// ── identity verification ─────────────────────────────────────────────────

test("a real EPUB of the requested title is a match", async () => {
  const bytes = await makeEpub("The Calamity Club");
  const r = await verifyDownloadedBook(bytes, "The Calamity Club");
  assert.equal(r.verdict, "match");
  assert.equal(r.deliveredTitle, "The Calamity Club");
});

test("a real EPUB of a DIFFERENT book is a mismatch", async () => {
  const bytes = await makeEpub("The Pentecost Of Calamity");
  const r = await verifyDownloadedBook(bytes, "The Calamity Club");
  assert.equal(r.verdict, "mismatch");
  assert.equal(r.deliveredTitle, "The Pentecost Of Calamity");
  assert.match(r.detail, /WRONG BOOK/);
});

test("an HTML page is not-a-book, never a match", async () => {
  const r = await verifyDownloadedBook(HTML, "The Calamity Club");
  assert.equal(r.verdict, "not-a-book");
});

test("a PDF carries no readable title and is reported unverifiable, not matched", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.5\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
  const r = await verifyDownloadedBook(pdf, "The Calamity Club");
  assert.equal(r.verdict, "unverifiable", "no evidence must never be reported as a match");
});

test("judgeMirrorDownload records a wrong book as a FAILED attempt", async () => {
  freshStore();
  const bytes = await makeEpub("The Pentecost Of Calamity");
  const res = await judgeMirrorDownload({
    mirrorUrl: "https://royallib.com/book/Wister_Owen/the_pentecost_of_calamity.html",
    bytes,
    requestedTitle: "The Calamity Club",
  });
  assert.equal(res.ok, false);
  assert.equal(res.mismatched, true);
  const e = entryFor("royallib.com")!;
  assert.equal(e.percent, 0);
  assert.equal(e.mismatched, true);
});

test("judgeMirrorDownload records a genuine success", async () => {
  freshStore();
  const bytes = await makeEpub("The Calamity Club");
  const res = await judgeMirrorDownload({
    mirrorUrl: "https://libgen.li/get.php?md5=50035d4d47bcd0e741e0c04092ef9959",
    bytes,
    requestedTitle: "The Calamity Club",
  });
  assert.equal(res.ok, true);
  assert.equal(res.mismatched, false);
  assert.equal(entryFor("libgen.li")!.percent, 100);
});

test("judgeMirrorDownload records a transport failure", async () => {
  freshStore();
  const res = await judgeMirrorDownload({
    mirrorUrl: "https://dead.example/f.epub",
    bytes: null,
    transportFailure: "unreachable",
  });
  assert.equal(res.ok, false);
  assert.equal(entryFor("dead.example")!.percent, 0);
});

test("judgeMirrorDownload records an HTML content-type as html-page", async () => {
  freshStore();
  const res = await judgeMirrorDownload({
    mirrorUrl: "https://page.example/f.epub",
    bytes: null,
    sawHtmlContentType: true,
  });
  assert.equal(res.verdict, "html-page");
  assert.equal(entryFor("page.example")!.percent, 0);
});

test("mixed history yields a true percentage", async () => {
  freshStore();
  const good = await makeEpub("Dune");
  for (const v of ["real-book", "html-page", "real-book", "identity-mismatch"] as MirrorVerdict[]) {
    await judgeMirrorDownload({
      mirrorUrl: "https://mixed.example/f.epub",
      bytes: good,
      requestedTitle: "Dune",
      transportFailure: v === "real-book" ? null : "unreachable",
    });
  }
  const e = entryFor("mixed.example")!;
  assert.equal(e.attempts, 4);
  assert.equal(e.percent, 50);
});
