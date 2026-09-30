/**
 * Send to Kobo/Kindle — the real upload.
 *
 * Runs under plain Node with no DOM, so document / DataTransfer / the cache are
 * all injected and the form that gets built is inspected rather than submitted.
 * What is asserted:
 *
 *  - the multipart field names are exactly the ones on the sender's live form,
 *    so a rename upstream cannot silently break the upload,
 *  - the upload is a real POST form (not fetch — the sender sends no CORS
 *    header, so a cross-origin XHR would be blocked by the browser),
 *  - a book that is not downloaded is refused, not silently "sent",
 *  - an unsupported extension is refused rather than uploaded blind,
 *  - a cancelled share is reported as cancelled, NOT as success,
 *  - the plugin is displayed as "Send to Kobo/Kindle",
 *  - and, as in kindleClient.test.ts, that no credential machinery appears.
 */

import {
  AMAZON_SEND_URL,
  EREADER_ACCEPT,
  EREADER_EXTENSIONS,
  EREADER_FIELDS,
  EREADER_KEY_LENGTH,
  EREADER_UPLOAD_ENDPOINT,
  EREADER_URL,
  KDROP_URL,
  KOBO_KINDLE_LABEL,
  buildEreaderUploadFields,
  describeEreaderRoute,
  isEreaderAcceptedExtension,
  normalizeEreaderKey,
  openManualSender,
  pluginDisplayName,
  shareOrDownloadForAmazon,
  uploadToEreader,
} from "../koboKindleSender";

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

const FAKE_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

// ── A recording document, so we can see the form that gets built ─────────────

interface FakeInput {
  tagName: string;
  type?: string;
  name?: string;
  value?: string;
  href?: string;
  files?: unknown;
  accept?: string;
  attrs: Record<string, string>;
  setAttribute: (k: string, v: string) => void;
  appendChild: (c: unknown) => void;
  remove: () => void;
  click: () => void;
}

function makeFakeDoc() {
  const submitted: FakeInput[] = [];
  const form: any = {
    tagName: "form",
    attrs: {},
    children: [] as FakeInput[],
    submitted: false,
    method: undefined as string | undefined,
    action: undefined as string | undefined,
    enctype: undefined as string | undefined,
    target: undefined as string | undefined,
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
    appendChild(c: FakeInput) {
      this.children.push(c);
    },
    remove() {},
    click() {},
    submit() {
      this.submitted = true;
      submitted.push(this);
    },
  };
  return {
    form,
    submitted,
    doc: {
      createElement: (tag: string): any => {
        if (tag === "form") return form;
        const el: any = {
          tagName: tag,
          attrs: {},
          setAttribute(k: string, v: string) {
            this.attrs[k] = v;
          },
          appendChild() {},
          remove() {},
          click() {},
        };
        return el;
      },
      body: {
        appendChild() {},
      },
    },
  };
}

// A minimal DataTransfer stand-in: enough for the File to land on the input.
class FakeDataTransfer {
  items: { add(f: unknown): void } = { add: () => {} };
  files: unknown[] = [];
}
(globalThis as any).DataTransfer = FakeDataTransfer;

// ── 1. Endpoints are the real ones ──────────────────────────────────────────

check("djazz upload endpoint is the live one", EREADER_UPLOAD_ENDPOINT === "https://send.djazz.se/upload", EREADER_UPLOAD_ENDPOINT);
check("djazz page url", EREADER_URL === "https://send.djazz.se/", EREADER_URL);
check("kindledrop url", KDROP_URL === "https://kdrop.me/", KDROP_URL);
check("amazon url kept as the official alternative", AMAZON_SEND_URL === "https://www.amazon.com/sendtokindle", AMAZON_SEND_URL);
check("accept list matches the live form", EREADER_ACCEPT === ".txt,.epub,.mobi,.pdf,.cbz,.cbr", EREADER_ACCEPT);

// ── 2. Field names are the sender's, not ours ────────────────────────────────

check(
  "field names are key/file/url/kepubify/kindlegen/pdfcropmargins/transliteration",
  EREADER_FIELDS.key === "key" &&
    EREADER_FIELDS.file === "file" &&
    EREADER_FIELDS.url === "url" &&
    EREADER_FIELDS.kepubify === "kepubify" &&
    EREADER_FIELDS.kindlegen === "kindlegen" &&
    EREADER_FIELDS.pdfCropMargins === "pdfcropmargins" &&
    EREADER_FIELDS.transliteration === "transliteration",
  EREADER_FIELDS
);

// ── 3. The device code ───────────────────────────────────────────────────────

check("4-char code passes", normalizeEreaderKey("ABCD") === "ABCD", normalizeEreaderKey("ABCD"));
check("lowercase is upcased", normalizeEreaderKey("abcd") === "ABCD", normalizeEreaderKey("abcd"));
check("spaces are stripped", normalizeEreaderKey(" A B C D ") === "ABCD", normalizeEreaderKey(" A B C D "));
check("3 chars rejected", normalizeEreaderKey("ABC") === null, normalizeEreaderKey("ABC"));
check("5 chars rejected", normalizeEreaderKey("ABCDE") === null, normalizeEreaderKey("ABCDE"));
check("empty rejected", normalizeEreaderKey("") === null, normalizeEreaderKey(""));
check("undefined rejected", normalizeEreaderKey(undefined) === null);
check("non-string rejected", normalizeEreaderKey(42 as any) === null);
check("symbols stripped, so 4 symbols -> null", normalizeEreaderKey("!!!!") === null, normalizeEreaderKey("!!!!"));
check("key length constant is 4", EREADER_KEY_LENGTH === 4, EREADER_KEY_LENGTH);

// ── 4. Extension gating ──────────────────────────────────────────────────────

for (const ext of EREADER_EXTENSIONS) {
  check(`accepts ${ext}`, isEreaderAcceptedExtension(ext) === true, ext);
  check(`accepts ${ext} with a dot`, isEreaderAcceptedExtension(ext.slice(1)) === true, ext);
}
check("rejects azw3 (not in the sender's accept list)", isEreaderAcceptedExtension("azw3") === false);
check("rejects cb7", isEreaderAcceptedExtension("cb7") === false);
check("rejects empty", isEreaderAcceptedExtension("") === false);
check("rejects undefined", isEreaderAcceptedExtension(undefined) === false);

// ── 5. Field building: unchecked boxes post nothing ──────────────────────────

check(
  "only the key is sent when nothing is ticked",
  JSON.stringify(buildEreaderUploadFields({ key: "abcd" })) === JSON.stringify({ key: "ABCD" }),
  buildEreaderUploadFields({ key: "abcd" })
);
check(
  "ticked boxes are sent",
  JSON.stringify(
    buildEreaderUploadFields({ key: "WXYZ", kepubify: true, kindlegen: true, transliteration: true })
  ) ===
    JSON.stringify({ key: "WXYZ", kepubify: "on", kindlegen: "on", transliteration: "on" }),
  buildEreaderUploadFields({ key: "WXYZ", kepubify: true, kindlegen: true, transliteration: true })
);
check(
  "pdfcropmargins uses the sender's own spelling",
  buildEreaderUploadFields({ key: "WXYZ", pdfCropMargins: true }).pdfcropmargins === "on",
  buildEreaderUploadFields({ key: "WXYZ", pdfCropMargins: true })
);
check(
  "a malformed key yields no key field at all",
  buildEreaderUploadFields({ key: "AB" }).key === undefined,
  buildEreaderUploadFields({ key: "AB" })
);

// ── 6. The rename ────────────────────────────────────────────────────────────

check("label is Send to Kobo/Kindle", KOBO_KINDLE_LABEL === "Send to Kobo/Kindle", KOBO_KINDLE_LABEL);
check(
  "a kindle integration is shown with the new name",
  pluginDisplayName({ name: "Send to Kindle", category: "integration", target: "kindle" }) ===
    "Send to Kobo/Kindle",
  pluginDisplayName({ name: "Send to Kindle", category: "integration", target: "kindle" })
);
check(
  "an already-renamed manifest keeps the new name",
  pluginDisplayName({ name: "Send to Kobo/Kindle", category: "integration", target: "kindle" }) ===
    "Send to Kobo/Kindle"
);
check(
  "calibre is untouched",
  pluginDisplayName({ name: "Calibre", category: "integration", target: "calibre" }) === "Calibre",
  pluginDisplayName({ name: "Calibre", category: "integration", target: "calibre" })
);
check(
  "a theme named the same is NOT renamed",
  pluginDisplayName({ name: "Send to Kindle", category: "theme", target: undefined } as any) ===
    "Send to Kindle",
  pluginDisplayName({ name: "Send to Kindle", category: "theme" } as any)
);
check(
  "a tool named the same is NOT renamed",
  pluginDisplayName({ name: "Send to Kindle", category: "tool", target: undefined } as any) ===
    "Send to Kindle"
);
check(
  "unrelated names pass through",
  pluginDisplayName({ name: "Word Search", category: "tool" }) === "Word Search"
);

// ── 7. Route descriptions name the route ─────────────────────────────────────

check("upload route says it uploads", /Uploads/.test(describeEreaderRoute("djazz-upload")), describeEreaderRoute("djazz-upload"));
check("kdrop route says the user does it", /you drop the file in yourself/i.test(describeEreaderRoute("kdrop-manual")), describeEreaderRoute("kdrop-manual"));
check("amazon route says it opens the page", /Amazon/.test(describeEreaderRoute("amazon-manual")), describeEreaderRoute("amazon-manual"));

// ── 8. uploadToEreader behaviour ─────────────────────────────────────────────

const cached = { blob: new Blob([FAKE_BYTES]), fileName: "dune.epub", extension: "epub" };
const goodKey = { key: "WXYZ" };

{
  // No code typed yet: the user has not been to the device. That is a
  // cancellation of intent, NOT a failure, and never a success.
  const r = await uploadToEreader("b1", { ...goodKey, key: "", getCachedFile: async () => cached });
  check("no device code -> cancelled", r.cancelled === true, r);
  check("no device code -> not ok", r.ok === false, r);
  check("no device code -> tells them to get the code", /device code/i.test(r.reason), r.reason);
  check("no device code -> nothing was uploaded", !/Uploaded/.test(r.reason), r.reason);
}

{
  const r = await uploadToEreader("b1", { ...goodKey, key: "AB", getCachedFile: async () => cached });
  check("short code -> cancelled, not an error", r.cancelled === true && r.ok === false, r);
}

{
  const r = await uploadToEreader("missing", { ...goodKey, getCachedFile: async () => null });
  check("book not downloaded -> refused", r.ok === false && !r.cancelled, r);
  check("book not downloaded -> says to download first", /isn't downloaded/i.test(r.reason), r.reason);
  check("book not downloaded -> never claims an upload", !/Uploaded/.test(r.reason), r.reason);
}

{
  const r = await uploadToEreader("b1", {
    ...goodKey,
    extension: "azw3",
    getCachedFile: async () => ({ ...cached, extension: "azw3" }),
  });
  check("unsupported extension -> refused", r.ok === false, r);
  check("unsupported extension -> lists what it takes", /sender takes/i.test(r.reason), r.reason);
}

{
  // The happy path: a real multipart POST form is built and submitted.
  const fake = makeFakeDoc();
  const r = await uploadToEreader("b1", {
    ...goodKey,
    title: "Dune",
    kepubify: true,
    document: fake.doc as any,
    getCachedFile: async () => cached,
  });
  check("valid upload -> ok", r.ok === true, r);
  check("valid upload -> route is djazz-upload", r.route === "djazz-upload", r.route);
  check("valid upload -> not a cancellation", !r.cancelled, r);
  check("valid upload -> form was actually submitted", fake.form.submitted === true);
  check("valid upload -> posts to the sender's endpoint", fake.form.action === EREADER_UPLOAD_ENDPOINT, fake.form.action);
  check("valid upload -> method is POST", fake.form.method === "POST", fake.form.method);
  check("valid upload -> multipart encoding", fake.form.enctype === "multipart/form-data", fake.form.enctype);
  const names = fake.form.children.map((c: any) => `${c.name}=${c.value ?? ""}`);
  check("valid upload -> carries the device key", names.includes("key=WXYZ"), names);
  check("valid upload -> carries the ticked option", names.includes("kepubify=on"), names);
  check(
    "valid upload -> a file input named 'file' is attached",
    fake.form.children.some((c: any) => c.name === "file" && c.type === "file"),
    fake.form.children.map((c: any) => c.name)
  );
  check("valid upload -> file input accepts the sender's list", fake.form.children.find((c: any) => c.name === "file")?.accept === EREADER_ACCEPT);
  check("valid upload -> says where it went", /send\.djazz\.se/.test(r.reason), r.reason);
  check("valid upload -> does not claim it confirmed arrival", !/confirmed|arrived/.test(r.reason), r.reason);
}

{
  const r = await uploadToEreader("boom", {
    ...goodKey,
    getCachedFile: async () => {
      throw new Error("indexeddb exploded");
    },
  });
  check("cache read failure -> refused", r.ok === false, r);
  check("cache read failure -> reason carries the cause", /indexeddb exploded/.test(r.reason), r.reason);
}

{
  // No DataTransfer means no way to attach bytes to a form. Must say so
  // rather than quietly downloading the file instead.
  const saved = (globalThis as any).DataTransfer;
  delete (globalThis as any).DataTransfer;
  const r = await uploadToEreader("b1", { ...goodKey, getCachedFile: async () => cached });
  check("no DataTransfer -> refused", r.ok === false, r);
  check("no DataTransfer -> does not fall back to downloading", !/Saved|download/i.test(r.reason), r.reason);
  (globalThis as any).DataTransfer = saved;
}

// ── 9. Amazon route: share, download, and cancellation ───────────────────────

{
  const opened: string[] = [];
  const r = await shareOrDownloadForAmazon("b1", {
    title: "Dune",
    navigator: {
      canShare: () => true,
      share: async () => {},
    },
    getCachedFile: async () => cached,
    openUrl: (u) => opened.push(u),
  });
  check("amazon route names itself", r.route === "amazon-manual", r.route);
  check("amazon share -> ok", r.ok === true, r);
  check("amazon share -> did not download", /share sheet/.test(r.reason), r.reason);
  check("amazon share -> no download triggered", opened.length === 0, opened);
}

{
  // Cancelling the share sheet is the user's decision. Per the convention in
  // the module header it is `cancelled`, and crucially NOT ok.
  const r = await shareOrDownloadForAmazon("b1", {
    title: "Dune",
    navigator: {
      canShare: () => true,
      share: async () => {
        const e: any = new Error("dismissed");
        e.name = "AbortError";
        throw e;
      },
    },
    getCachedFile: async () => cached,
  });
  check("dismissed share -> cancelled", r.cancelled === true, r);
  check("dismissed share -> NOT ok", r.ok === false, r);
  check("dismissed share -> not a download", !/Saved/.test(r.reason), r.reason);
}

{
  const opened: string[] = [];
  const fake = makeFakeDoc();
  const r = await shareOrDownloadForAmazon("b1", {
    title: "Dune",
    document: fake.doc as any,
    navigator: { canShare: () => false, share: async () => {} },
    getCachedFile: async () => cached,
    createObjectUrl: () => "blob:fake",
    revokeObjectUrl: () => {},
    openUrl: (u) => opened.push(u),
  });
  check("desktop amazon -> ok", r.ok === true, r);
  check("desktop amazon -> opens amazon's page", opened[0] === AMAZON_SEND_URL, opened);
  check("desktop amazon -> admits the drag is manual", /drag the file onto it/.test(r.reason), r.reason);
}

{
  const r = await shareOrDownloadForAmazon("missing", { getCachedFile: async () => null });
  check("amazon route refuses an undownloaded book", r.ok === false && !r.cancelled, r);
}

// ── 10. Manual senders never claim an upload happened ────────────────────────

{
  const opened: string[] = [];
  const r = openManualSender("kdrop-manual", (u) => opened.push(u));
  check("kdrop opens kdrop.me", opened[0] === KDROP_URL, opened);
  check("kdrop is not called a success upload", !/Uploaded/.test(r.reason), r.reason);
  check("kdrop admits the user does the upload", /you drop the file in there|drop it in there/i.test(r.reason), r.reason);
}

{
  const opened: string[] = [];
  const r = openManualSender("amazon-manual", (u) => opened.push(u));
  check("amazon sender opens amazon's page", opened[0] === AMAZON_SEND_URL, opened);
  check("amazon sender is not called a success upload", !/Uploaded/.test(r.reason), r.reason);
}

{
  const r = openManualSender("kdrop-manual", () => {
    throw new Error("popup blocked");
  });
  check("a blocked popup is reported as a failure", r.ok === false, r);
  check("a blocked popup says why", /popup blocked/.test(r.reason), r.reason);
}

// ── 11. Structural: still no credential machinery ───────────────────────────

{
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(new URL("../koboKindleSender.ts", import.meta.url), "utf8");
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
    // The sender sends no Access-Control-Allow-Origin, so a fetch-based upload
    // would be blocked by the browser. A form POST is the only working shape.
    /\bfetch\s*\(/,
  ];
  for (const re of banned) {
    check(`source has no ${re}`, !re.test(src), re);
  }
  check("no amazon API host in source", !/api\.amazonaws\.com|kindlepcs/i.test(src));
  // kdrop is manual-only; nothing should try to POST to it programmatically.
  check("kdrop is never used as a POST target", !/action\s*=\s*KDROP_URL/.test(src));
}

// ── Done ─────────────────────────────────────────────────────────────────────

console.log(`\nkoboKindleSender: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
