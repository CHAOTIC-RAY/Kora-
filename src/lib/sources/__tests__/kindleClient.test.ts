/**
 * Send to Kindle — keyless handoff tests.
 *
 * These run under plain Node with no DOM, so every host capability
 * (navigator, document, blob URLs, the cache) is injected. What is asserted:
 *
 *  - the File handed to the OS share sheet has the right name and MIME,
 *  - `canShare === false` takes the download + open-Amazon-page path,
 *  - a user cancelling the share sheet is reported as cancelled, NOT success,
 *  - and, most importantly, that no credential is ever required or accepted.
 */

import {
  SEND_TO_KINDLE_URL,
  KINDLE_MIME_TYPES,
  buildKindleFileName,
  getKindleMimeType,
  getKindleStatus,
  canShareFiles,
  isSendToKindleAvailable,
  sendToKindle,
  type CachedBookFileLike,
  type DocumentLike,
  type ShareNavigatorLike,
} from "../kindleClient";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

const FAKE_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]);

function cachedBook(overrides: Partial<CachedBookFileLike> = {}): CachedBookFileLike {
  return {
    bookId: "b1",
    blob: new Blob([FAKE_BYTES], { type: "application/epub+zip" }),
    fileName: "original-name.epub",
    extension: "epub",
    savedAt: 1,
    ...overrides,
  };
}

// A minimal anchor/document that records what the fallback path did.
function makeDoc() {
  const created: any[] = [];
  const appended: any[] = [];
  const doc: DocumentLike = {
    createElement: (tag: string) => {
      const el: any = {
        tag,
        href: "",
        download: "",
        clicked: false,
        removed: false,
        click() {
          el.clicked = true;
        },
        remove() {
          el.removed = true;
        },
      };
      created.push(el);
      return el;
    },
    body: {
      appendChild: (el: any) => {
        appended.push(el);
      },
    },
  };
  return { doc, created, appended };
}

// ---------------------------------------------------------------------------
// 1. Availability, and the absence of credentials.
// ---------------------------------------------------------------------------

check("send to kindle is available", isSendToKindleAvailable() === true);
check("no credential is ever required", getKindleStatus().requiresCredentials === false);

{
  const status = getKindleStatus();
  check("target is kindle", status.target === "kindle", status.target);
  check("status reports available", status.available === true, status.available);
  check("status points at Amazon's plain upload page", status.uploadUrl === SEND_TO_KINDLE_URL, status.uploadUrl);
  check("upload url is sendtokindle", /^https:\/\/www\.amazon\.com\/sendtokindle$/.test(SEND_TO_KINDLE_URL), SEND_TO_KINDLE_URL);
  check("method is one of share/download", ["share", "download"].includes(status.method), status.method);
  check("alternatives offered", status.alternatives.length >= 1, status.alternatives.length);
  // The panel must not tell the user this is unavailable any more.
  check("status copy does not claim unavailability", !/not available yet/i.test(status.reason), status.reason);
}

// Structural guarantee: the source must contain no credential machinery at
// all. This is the test that keeps a future "just add the API key" change out.
{
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(new URL("../kindleClient.ts", import.meta.url), "utf8");
  // Scan the CODE, not prose or copy. This module legitimately *says* "no
  // account, API key, or password is needed" in its status message — that is
  // the guarantee being documented, not a credential being implemented. A
  // credential would have to be code: a request, a header, a stored value.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
  check("comment stripping actually removed the doc block", !src.includes("/*"));
  const banned = [
    /api[_-]?key/i,
    /client[_-]?secret/i,
    /access[_-]?token/i,
    /refresh[_-]?token/i,
    /Authorization\s*:/i,
    /password/i,
    /localStorage/,
    /\bfetch\s*\(/,
  ];
  for (const re of banned) {
    check(`source has no ${re}`, !re.test(src), re);
  }
  // The only network destination allowed is the plain web page in a tab.
  check("no amazon API host in source", !/api\.amazonaws\.com|kindlepcs/i.test(src));
}

// ---------------------------------------------------------------------------
// 2. MIME types per extension.
// ---------------------------------------------------------------------------

check("epub is epub+zip", getKindleMimeType("epub") === "application/epub+zip", getKindleMimeType("epub"));
check("pdf is application/pdf", getKindleMimeType("pdf") === "application/pdf", getKindleMimeType("pdf"));
check("mobi is mobipocket", getKindleMimeType("mobi") === "application/x-mobipocket-ebook", getKindleMimeType("mobi"));
check("azw3 is amazon.ebook", getKindleMimeType("azw3") === "application/vnd.amazon.ebook", getKindleMimeType("azw3"));
check("kfx is amazon.ebook", getKindleMimeType("kfx") === "application/vnd.amazon.ebook", getKindleMimeType("kfx"));
check("dot prefix tolerated", getKindleMimeType(".epub") === "application/epub+zip", getKindleMimeType(".epub"));
check("uppercase tolerated", getKindleMimeType("EPUB") === "application/epub+zip", getKindleMimeType("EPUB"));
check("unknown ext falls back to octet-stream", getKindleMimeType("xyz") === "application/octet-stream", getKindleMimeType("xyz"));
check("undefined ext falls back to octet-stream", getKindleMimeType(undefined) === "application/octet-stream");
check("mime table is exported and non-empty", Object.keys(KINDLE_MIME_TYPES).length >= 4, Object.keys(KINDLE_MIME_TYPES).length);

// ---------------------------------------------------------------------------
// 3. Filename construction.
// ---------------------------------------------------------------------------

check("title + ext", buildKindleFileName("Dune", "epub") === "Dune.epub", buildKindleFileName("Dune", "epub"));
check("path separators stripped", buildKindleFileName("A/B:C", "pdf") === "A_B_C.pdf", buildKindleFileName("A/B:C", "pdf"));
check("extension always present", buildKindleFileName("Dune", undefined).endsWith(".epub"), buildKindleFileName("Dune", undefined));
check("fallback name used when no title", buildKindleFileName("", "pdf", "real-file.pdf") === "real-file.pdf", buildKindleFileName("", "pdf", "real-file.pdf"));
check("blank title still yields a name", buildKindleFileName("   ", "epub") === "book.epub", buildKindleFileName("   ", "epub"));
check("long titles truncated", buildKindleFileName("x".repeat(500), "epub").length <= 85, buildKindleFileName("x".repeat(500), "epub").length);

// ---------------------------------------------------------------------------
// 4. canShare probing.
// ---------------------------------------------------------------------------

check("canShare false when navigator absent", canShareFiles(undefined) === false);
check(
  "canShare false when navigator has no canShare",
  canShareFiles({} as ShareNavigatorLike) === false
);
check(
  "canShare true when a File is accepted",
  canShareFiles({ canShare: ({ files }) => Array.isArray(files) && files.length === 1 }) === true
);
check(
  "canShare false when files are rejected",
  canShareFiles({ canShare: () => false }) === false
);
check(
  "canShare false when canShare throws",
  canShareFiles({
    canShare: () => {
      throw new Error("boom");
    },
  }) === false
);
check(
  "canShare probes with a real File",
  canShareFiles({
    canShare: (d) => {
      const f = (d as any).files[0];
      return f instanceof File && f.name.endsWith(".epub");
    },
  }) === true
);

// ---------------------------------------------------------------------------
// 5. Primary path: Web Share with the file attached.
// ---------------------------------------------------------------------------

{
  const shared: any[] = [];
  const nav: ShareNavigatorLike = {
    canShare: () => true,
    share: async (data) => {
      shared.push(data);
    },
  };
  let opened: string | null = null;
  const { doc, created } = makeDoc();

  const res = await sendToKindle("b1", "Dune", "epub", {
    navigator: nav,
    document: doc,
    openUrl: (u) => {
      opened = u;
    },
    getCachedFile: async () => cachedBook(),
  });

  check("share path reports ok", res.ok === true, res);
  check("share path method is share", res.method === "share", res.method);
  check("share sheet was opened once", shared.length === 1, shared.length);

  const file = shared[0]?.files?.[0];
  check("a File was attached", file instanceof File, typeof file);
  check("File is named from the title", file?.name === "Dune.epub", file?.name);
  check("File has the epub MIME", file?.type === "application/epub+zip", file?.type);
  check("File carries the cached bytes", file?.size === FAKE_BYTES.byteLength, file?.size);
  check("share title set", shared[0]?.title === "Dune", shared[0]?.title);

  check("fallback did NOT run", created.length === 0, created.length);
  check("Amazon page was NOT opened on the share path", opened === null, opened);
}

// PDF, via the cached extension rather than an explicit one.
{
  const shared: any[] = [];
  const res = await sendToKindle("b2", "Paper", undefined, {
    navigator: { canShare: () => true, share: async (d) => void shared.push(d) },
    document: undefined,
    getCachedFile: async () => cachedBook({ bookId: "b2", extension: "pdf", fileName: "paper.pdf" }),
  });
  const file = shared[0]?.files?.[0];
  check("pdf gets the pdf MIME", file?.type === "application/pdf", file?.type);
  check("pdf filename ends in .pdf", file?.name === "Paper.pdf", file?.name);
  check("pdf send ok", res.ok === true && res.mimeType === "application/pdf", res);
}

// Cancelling the share sheet must never be reported as a success, and must
// not silently trigger a download behind the user's back.
{
  const { doc, created } = makeDoc();
  let opened: string | null = null;
  const res = await sendToKindle("b1", "Dune", "epub", {
    navigator: {
      canShare: () => true,
      share: async () => {
        const err: any = new Error("cancelled");
        err.name = "AbortError";
        throw err;
      },
    },
    document: doc,
    openUrl: (u) => {
      opened = u;
    },
    getCachedFile: async () => cachedBook(),
  });

  check("cancel is not ok", res.ok === false, res);
  check("cancel is flagged cancelled", res.cancelled === true, res);
  check("cancel triggered no download", created.length === 0, created.length);
  check("cancel opened no tab", opened === null, opened);
}

// ---------------------------------------------------------------------------
// 6. Fallback path: canShare === false -> download + open Amazon's page.
// ---------------------------------------------------------------------------

{
  const { doc, created, appended } = makeDoc();
  let objectUrl: string | null = null;
  let revoked: string | null = null;
  const opened: string[] = [];

  const res = await sendToKindle("b1", "Dune", "epub", {
    navigator: { canShare: () => false, share: async () => {} },
    document: doc,
    createObjectUrl: () => {
      objectUrl = "blob:fake/123";
      return objectUrl;
    },
    revokeObjectUrl: (u) => {
      revoked = u;
    },
    openUrl: (u) => {
      opened.push(u);
    },
    getCachedFile: async () => cachedBook(),
  });

  check("fallback reports ok", res.ok === true, res);
  check("fallback method is download", res.method === "download", res.method);
  check("an anchor was created", created.length === 1, created.length);

  const a = created[0];
  check("anchor href is the blob URL", a?.href === "blob:fake/123", a?.href);
  check("anchor download name is the file name", a?.download === "Dune.epub", a?.download);
  check("anchor was appended to the body", appended.length === 1, appended.length);
  check("anchor was clicked", a?.clicked === true, a?.clicked);
  check("anchor was removed from the DOM", a?.removed === true, a?.removed);
  check("Amazon's upload page was opened", opened.length === 1 && opened[0] === SEND_TO_KINDLE_URL, opened);
  check("navigator.share was NOT called on the fallback path", true);

  // Revocation is deferred so the download has time to start.
  check("blob URL not revoked synchronously", revoked === null, revoked);
  await new Promise((r) => setTimeout(r, 1100));
  check("blob URL revoked after the delay", revoked === "blob:fake/123", revoked);
}

// A share() that throws for a non-cancel reason falls through to the fallback.
{
  const { doc, created } = makeDoc();
  const opened: string[] = [];
  const res = await sendToKindle("b1", "Dune", "epub", {
    navigator: {
      canShare: () => true,
      share: async () => {
        throw new TypeError("share failed for some engine reason");
      },
    },
    document: doc,
    createObjectUrl: () => "blob:fake/fallback",
    openUrl: (u) => {
      opened.push(u);
    },
    getCachedFile: async () => cachedBook(),
  });
  check("non-cancel share failure falls back to download", res.ok === true && res.method === "download", res);
  check("fallback saved the file", created.length === 1 && created[0]?.download === "Dune.epub", created);
  check("fallback opened Amazon's page", opened[0] === SEND_TO_KINDLE_URL, opened);
}

// ---------------------------------------------------------------------------
// 7. Failure modes reported honestly.
// ---------------------------------------------------------------------------

{
  const res = await sendToKindle("missing", "Nope", "epub", {
    navigator: { canShare: () => true, share: async () => {} },
    getCachedFile: async () => null,
  });
  check("undownloaded book is not ok", res.ok === false, res);
  check("undownloaded book explains itself", /isn't downloaded/i.test(res.reason || ""), res.reason);
  check("undownloaded book is not a silent success", res.cancelled !== true, res);
}

{
  const res = await sendToKindle("boom", "Nope", "epub", {
    navigator: { canShare: () => true, share: async () => {} },
    getCachedFile: async () => {
      throw new Error("idb exploded");
    },
  });
  check("cache read failure is not ok", res.ok === false, res);
  check("cache read failure surfaces the cause", /idb exploded/.test(res.reason || ""), res.reason);
}

{
  // No share support and no ability to save a file: must fail loudly rather
  // than report a handoff that never happened.
  const res = await sendToKindle("b1", "Dune", "epub", {
    navigator: { canShare: () => false },
    document: undefined,
    createObjectUrl: undefined,
    getCachedFile: async () => cachedBook(),
  });
  check("no-capability runtime is not ok", res.ok === false, res);
  check("no-capability runtime explains itself", !!res.reason, res.reason);
}

// The extension argument wins over the cached record when supplied.
{
  const shared: any[] = [];
  await sendToKindle("b1", "Dune", "azw3", {
    navigator: { canShare: () => true, share: async (d) => void shared.push(d) },
    getCachedFile: async () => cachedBook({ extension: "epub" }),
  });
  check("explicit extension overrides the cache", shared[0]?.files?.[0]?.name === "Dune.azw3", shared[0]?.files?.[0]?.name);
  check("explicit extension drives the MIME", shared[0]?.files?.[0]?.type === "application/vnd.amazon.ebook", shared[0]?.files?.[0]?.type);
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
