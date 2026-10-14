/**
 * The relay HTTP client — the transport behind "Send" in the panel.
 *
 * `koboKindleSender.test.ts` proves the CONTRACT through an injected seam. This
 * file proves the part that seam stands in for: the real XHR upload, its byte
 * progress, and above all its CANCELLATION.
 *
 * The cancellation contract is the one that matters and the one most likely to
 * rot. A user taps Send on a 40 MB EPUB over a phone connection, changes their
 * mind, and taps Cancel. What must happen is `{ status: "cancelled" }` — not a
 * success (the file may be half-sent and the device is waiting), and not an
 * error toast (nothing went wrong; the user changed their mind). A `fetch` with
 * an AbortSignal gets this almost for free; XHR needs `xhr.abort()` wired to
 * the signal AND the promise settled from the abort handler, or it hangs until
 * the request times out.
 *
 * Runs under plain Node against a fake XMLHttpRequest, so it needs no browser
 * and no network.
 */

import {
  DEFAULT_RELAY_BASE,
  RELAY_MAX_BYTES,
  fetchRelayStatus,
  formatBytes,
  normalizeDeviceCode,
  relayPageUrl,
  sendToDeviceViaRelay,
  uploadToRelay,
  type SendToDeviceResult,
} from "../koraRelaySender";

let pass = 0;
let fail = 0;
function check(name: string, cond: unknown, got?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

// ── A fake XMLHttpRequest that a test drives by hand ────────────────────────

interface FakeXhrOptions {
  /** Status the fake reports when the test calls finish(). */
  status?: number;
  body?: string;
  /** Never auto-respond; the test decides when. */
  manual?: boolean;
  /** Simulate a network-level failure instead of a response. */
  networkError?: boolean;
}

const sent: FakeXhr[] = [];
let nextOptions: FakeXhrOptions = {};

class FakeXhr {
  method = "";
  url = "";
  async = false;
  responseType = "";
  status = 0;
  response: any = "";
  responseText = "";
  timeout = 0;
  upload = { onprogress: null as null | ((e: any) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  ontimeout: null | (() => void) = null;
  body: any = null;
  aborted = false;
  private listeners: Record<string, ((e?: any) => void)[]> = {};
  private opts: FakeXhrOptions;

  constructor() {
    this.opts = nextOptions;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.listeners[k] = this.listeners[k] || [];
  }
  addEventListener(type: string, fn: (e?: any) => void) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  removeEventListener() {}
  send(body: any) {
    this.body = body;
    sent.push(this);
    if (this.opts.manual) return;
    setTimeout(() => this.finish(), 0);
  }
  abort() {
    this.aborted = true;
  }
  /** The test calls this to complete the request. */
  finish() {
    if (this.opts.networkError) {
      this.onerror?.();
      return;
    }
    this.status = this.opts.status ?? 200;
    this.response = this.opts.body ?? "";
    this.responseText = this.response;
    // A Blob responseType means the caller reads `.response` as a blob.
    if (this.responseType === "blob") this.response = { __blob: true };
    this.onload?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
}

(globalThis as any).XMLHttpRequest = FakeXhr;

// File/Blob/FormData exist in Node 18+, which is enough here: the client only
// ever appends to a FormData and reads .size off a Blob.
const blobOf = (bytes: number) => new Blob([new Uint8Array(bytes)]);

// ── 1. Code normalisation, before any network call ──────────────────────────

check("a valid code passes", normalizeDeviceCode("ABCD") === "ABCD");
check("lowercase is upcased", normalizeDeviceCode("a7k2") === "A7K2");
check("a spaced code is cleaned", normalizeDeviceCode(" a 7 k 2 ") === "A7K2");
for (const bad of ["", "AB", "ABCDE", "!!!!", "AB01", "ABOD", "ABID", "ABLD"]) {
  check(`code ${JSON.stringify(bad)} is refused`, normalizeDeviceCode(bad) === null, normalizeDeviceCode(bad));
}
check("the relay base defaults to same-origin", DEFAULT_RELAY_BASE === "");

// ── 2. Guard rails: a bad code costs no request at all ──────────────────────

{
  sent.length = 0;
  for (const bad of ["", "AB", "ABCDE", "AB01", "!!!!"]) {
    const r = await sendToDeviceViaRelay(blobOf(100), "Dune.epub", bad);
    check(`bad code ${JSON.stringify(bad)}: an error, not a crash`, r.status === "error", r);
    check(`bad code ${JSON.stringify(bad)}: nothing was sent`, sent.length === 0, sent.length);
  }
  const r = await sendToDeviceViaRelay(blobOf(100), "Dune.epub", "AB");
  check("the message is about the code, not a generic failure", /4 characters/.test((r as any).error), r);
}

{
  sent.length = 0;
  const empty = await sendToDeviceViaRelay(new Blob([]), "Dune.epub", "A7K2");
  check("an empty file is refused", empty.status === "error", empty);
  check("an empty file is not sent", sent.length === 0, sent.length);
}

{
  // The size guard is client-side so a 60 MB file fails before spending the
  // user's data, not after.
  sent.length = 0;
  const big = await sendToDeviceViaRelay(blobOf(RELAY_MAX_BYTES + 1), "big.epub", "A7K2");
  check("an oversize file is refused before upload", big.status === "error", big);
  check("the oversize message states the limit", /50 MB/.test((big as any).error), big);
  check("nothing was sent", sent.length === 0, sent.length);
  check("the cap matches the Worker's", RELAY_MAX_BYTES === 50 * 1024 * 1024, RELAY_MAX_BYTES);
}

// ── 3. The happy path: POST, multipart, the right fields ───────────────────

{
  sent.length = 0;
  nextOptions = { status: 200, body: JSON.stringify({ ok: true, name: "Dune.epub", bytes: 100 }) };
  const r = (await sendToDeviceViaRelay(blobOf(100), "Dune.epub", "a7k2")) as any;
  check("a valid send reports ok", r.status === "ok", r);
  check("and names the method that ran", r.method === "kora-relay", r);
  check("it POSTs", sent[0]?.method === "POST", sent[0]?.method);
  check("to the relay's own endpoint", sent[0]?.url === "/api/relay/upload", sent[0]?.url);
  check("the body is multipart FormData", sent[0]?.body instanceof FormData, typeof sent[0]?.body);
  const fd = sent[0].body as FormData;
  check("it carries the code", fd.get("code") === "A7K2", fd.get("code"));
  const file = fd.get("file");
  check("it carries a file part", file instanceof Blob, typeof file);
  check("the file keeps its name", (file as File).name === "Dune.epub", (file as File).name);
  check("the message names Kora's relay", /Kora's relay/.test(r.message), r.message);
  check("the message names no third party", !/djazz|kdrop/i.test(r.message), r.message);
}

// ── 4. Progress reporting ──────────────────────────────────────────────────

{
  sent.length = 0;
  nextOptions = { status: 200, manual: true, body: JSON.stringify({ ok: true, name: "D.epub", bytes: 4 }) };
  const seen: number[] = [];
  const p = uploadToRelay({
    code: "A7K2",
    fileName: "D.epub",
    fileBlob: blobOf(4),
    onProgress: (loaded, total) => seen.push(loaded),
  });
  await new Promise((r) => setTimeout(r, 5));
  check("an XHR was created", sent.length === 1, sent.length);
  sent[0].progress(1, 4);
  sent[0].progress(2, 4);
  sent[0].progress(3, 4);
  sent[0].finish();
  const r = (await p) as any;
  check("progress was reported", seen.length >= 3, seen);
  check("progress is monotonic", seen.every((v, i) => i === 0 || v >= seen[i - 1]), seen);
  check("the upload still succeeds", r.status === "ok", r);
}

// ── 5. CANCELLATION. The contract that must not rot. ───────────────────────

{
  sent.length = 0;
  nextOptions = { status: 200, manual: true };
  const controller = new AbortController();
  const p = sendToDeviceViaRelay(blobOf(1000), "Dune.epub", "A7K2", controller.signal);
  await new Promise((r) => setTimeout(r, 5));
  check("the request is in flight", sent.length === 1, sent.length);

  controller.abort();
  const r = (await p) as SendToDeviceResult;

  check("an abort is CANCELLED, not ok", r.status === "cancelled", r);
  check("an abort is CANCELLED, not error", r.status !== "error", r);
  check("the XHR was actually aborted", sent[0].aborted === true, sent[0].aborted);
  check("no success is claimed", !("method" in r), r);
  check("no filename is claimed", !("fileName" in r), r);
}

{
  // An ALREADY-aborted signal must not fire a request at all.
  sent.length = 0;
  nextOptions = { status: 200, body: "{}" };
  const controller = new AbortController();
  controller.abort();
  const r = await sendToDeviceViaRelay(blobOf(100), "Dune.epub", "A7K2", controller.signal);
  check("a pre-aborted signal sends nothing", sent.length === 0, sent.length);
  check("a pre-aborted signal reports cancelled", r.status === "cancelled", r);
}

{
  // Aborting must settle the promise even if the fake never responds, or the
  // panel's button leaves a spinner running forever.
  sent.length = 0;
  nextOptions = { status: 200, manual: true };
  const controller = new AbortController();
  const p = sendToDeviceViaRelay(blobOf(1000), "Dune.epub", "A7K2", controller.signal);
  await new Promise((r) => setTimeout(r, 5));
  controller.abort();
  const settled = await Promise.race([
    p,
    new Promise((r) => setTimeout(() => r("TIMED OUT"), 200)),
  ]);
  check("an abort settles the promise promptly", settled !== "TIMED OUT", settled);
}

{
  // A response that arrives after the abort must not overwrite the
  // cancellation with a success.
  sent.length = 0;
  nextOptions = { status: 200, manual: true, body: JSON.stringify({ ok: true, name: "D.epub", bytes: 10 }) };
  const controller = new AbortController();
  const p = sendToDeviceViaRelay(blobOf(10), "Dune.epub", "A7K2", controller.signal);
  await new Promise((r) => setTimeout(r, 5));
  controller.abort();
  sent[0].finish(); // the late response
  const r = await p;
  check("a late response does not turn a cancel into a success", r.status === "cancelled", r);
}

{
  // A second abort, or an abort after completion, must not throw or re-settle.
  sent.length = 0;
  nextOptions = { status: 200, body: JSON.stringify({ ok: true, name: "D.epub", bytes: 10 }) };
  const controller = new AbortController();
  const p = sendToDeviceViaRelay(blobOf(10), "Dune.epub", "A7K2", controller.signal);
  const r = await p;
  check("a completed upload is ok", r.status === "ok", r);
  controller.abort(); // after the fact
  const again = await p;
  check("a post-completion abort does not change the result", again.status === "ok", again);
}

// ── 6. Failures surface the relay's own words ──────────────────────────────

{
  const cases: [number, string, RegExp][] = [
    [413, JSON.stringify({ error: "That file is 61.2 MB. The limit is 50 MB." }), /50 MB/],
    [404, JSON.stringify({ error: "No e-reader is waiting for that code." }), /No e-reader/],
    [429, JSON.stringify({ error: "Too many attempts." }), /Too many/],
    [409, JSON.stringify({ error: "That code already has a book waiting." }), /already has a book/],
  ];
  for (const [status, body, expected] of cases) {
    sent.length = 0;
    nextOptions = { status, body };
    const r = (await sendToDeviceViaRelay(blobOf(10), "D.epub", "A7K2")) as any;
    check(`${status}: an error`, r.status === "error", r);
    check(`${status}: the relay's own words survive`, expected.test(r.error), r.error);
    check(`${status}: no method is claimed`, r.method === undefined, r);
  }
}

{
  // An unparseable body must not become a success, and must not become a crash.
  sent.length = 0;
  nextOptions = { status: 500, body: "<html>gateway error</html>" };
  const r = (await sendToDeviceViaRelay(blobOf(10), "D.epub", "A7K2")) as any;
  check("an HTML error body is an error, not a crash", r.status === "error", r);
  check("and it reports the status", /500/.test(r.error), r.error);
}

{
  sent.length = 0;
  nextOptions = { networkError: true };
  const r = (await sendToDeviceViaRelay(blobOf(10), "D.epub", "A7K2")) as any;
  check("a network failure is an error", r.status === "error", r);
  check("a network failure mentions the connection", /connection|Could not reach/i.test(r.error), r.error);
}

{
  // A 2xx with a garbage body is still a 2xx: the Worker said the file is
  // staged. Reporting a failure the user cannot act on would be wrong.
  sent.length = 0;
  nextOptions = { status: 200, body: "not json at all" };
  const r = (await sendToDeviceViaRelay(blobOf(10), "Dune.epub", "A7K2")) as any;
  check("a 2xx with a junk body is still a success", r.status === "ok", r);
  check("and falls back to the name we sent", r.fileName === "Dune.epub", r.fileName);
}

// ── 7. Helpers ─────────────────────────────────────────────────────────────

check("bytes under 1 KB", formatBytes(512) === "512 B", formatBytes(512));
check("bytes in KB", formatBytes(2048) === "2 KB", formatBytes(2048));
check("bytes in MB", formatBytes(5 * 1024 * 1024) === "5.0 MB", formatBytes(5 * 1024 * 1024));
check("negative bytes are not shown as a number", formatBytes(-1) === "—", formatBytes(-1));
check("NaN is not shown as a number", formatBytes(NaN) === "—", formatBytes(NaN));

check("the page url is a path when there is no window", relayPageUrl() === "/send", relayPageUrl());

{
  // fetchRelayStatus is the panel's read on which storage answered.
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ ok: true, storage: "r2" }) });
  check("status reports the storage", (await fetchRelayStatus()).storage === "r2", await fetchRelayStatus());
  (globalThis as any).fetch = async () => {
    throw new Error("offline");
  };
  const off = await fetchRelayStatus();
  check("an unreachable relay is not ok", off.ok === false, off);
  check("and says why", !!off.error, off);
  (globalThis as any).fetch = original;
}

console.log(`\nkoraRelaySender: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
