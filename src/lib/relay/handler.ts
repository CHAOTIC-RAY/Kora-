/**
 * Kora's own e-reader relay — the endpoint logic, free of any Worker plumbing.
 *
 * This is the whole replacement for send.djazz.se. Nothing here talks to a
 * third party: the code, the file, and the page that displays them all live in
 * Kora's own Worker.
 *
 * THE FLOW, AND WHO HOLDS WHAT.
 *
 *   e-reader (browser)          Kora Worker                     phone / desktop
 *   ──────────────────          ────────────                    ───────────────
 *   POST /api/relay/register  →  mints CODE + SECRET, TTL 6h
 *   shows CODE prominently
 *   GET  /api/relay/poll     →  checks for a file            user types CODE
 *   (code + secret)               (code + secret)           POST /api/relay/upload
 *                                                                  (code only)
 *                              200 + bytes, then DELETED
 *   saves to device
 *
 * The asymmetry is the design. The phone proves nothing but the code; the
 * e-reader proves the code AND a 128-bit secret it has never transmitted. So
 * brute-forcing the 923,521-code space can at worst drop one junk file into a
 * waiting session, and reading somebody's library requires the secret. First
 * upload wins, so even the injection is a nuisance rather than a channel.
 *
 * EVERY SESSION AND FILE HAS A TTL, AND FILES ARE DELETED ON FIRST DOWNLOAD.
 * That is the difference between a relay and a file store: this endpoint is
 * not where your books live, it is a table at which two devices you own meet
 * for a few minutes.
 *
 * NOTHING IS LOGGED. No code, no filename, no title, no IP, no size. The relay
 * logs nothing at all about content, because a log line with a filename in it
 * is a record of what someone is reading. `logRelayEvent` is a no-op kept as a
 * single choke point so that stays a one-line change if it ever needs to exist.
 */

import {
  CODE_LENGTH,
  generateRelaySecret,
  generateUniqueRelayCode,
  normalizeRelayCode,
} from "./codes";
import {
  CODE_MAX_FAILURES,
  IpRateLimiter,
  clearFailedPulls,
  isCodeLocked,
  registerFailedPull,
  type RateLimitDecision,
} from "./rateLimit";
import {
  FILE_TTL_MS,
  MAX_RELAY_BYTES,
  SESSION_TTL_MS,
  type RelayStore,
  type StoredSession,
} from "./store";
import {
  contentDispositionFor,
  describeRelayFile,
  escapeHtml,
  MAX_FILENAME_LENGTH,
} from "./sanitize";

void CODE_MAX_FAILURES;

export const RELAY_STATUS_URL = "/api/relay/status";
export const RELAY_REGISTER_URL = "/api/relay/register";
export const RELAY_POLL_URL = "/api/relay/poll";
export const RELAY_UPLOAD_URL = "/api/relay/upload";
export const RELAY_PAGE_PATH = "/send";

export interface RelayEnv {
  [k: string]: any;
}

/** Client IP as Cloudflare presents it, or a stable placeholder. */
export function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "local"
  );
}

/**
 * The 204 trap, guarded once.
 *
 * 204/205/304 are defined to have no body, and constructing a Response whose
 * body is non-null for one of those throws in the Workers runtime. A bodyless
 * status that arrives with a payload — a heartbeat, a "nothing yet" poll — is
 * the natural way to write that endpoint and the natural way to ship this bug.
 */
const BODYLESS_STATUSES = new Set([204, 205, 304]);

function json(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  if (BODYLESS_STATUSES.has(status)) {
    return new Response(null, {
      status,
      headers: { "Cache-Control": "no-store", ...extraHeaders },
    });
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      // This API hands out books to whoever names a code. A shared cache in
      // front of it would turn that into a public one.
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

/** Content logging lives here so it can stay empty. */
function logRelayEvent(_event: string, _detail?: Record<string, unknown>): void {
  // Intentionally empty. See the module header.
}

export interface RelayDeps {
  store: RelayStore;
  limiter: IpRateLimiter;
  now?: () => number;
}

/** The page URL the phone should be pointed at, absolute for QR encoding. */
export function relayPageUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}${RELAY_PAGE_PATH}`;
}

export async function handleRelayRequest(request: Request, env: RelayEnv, deps: RelayDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/relay")) return null;

  const now = deps.now ? deps.now() : Date.now();

  // Preflight for the phone app, which posts from a different origin.
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Relay-Secret",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const ip = clientIp(request);
  const limit = deps.limiter.check(ip, now);
  if (!limit.allowed) {
    return json(
      { error: "Too many attempts from this address. Wait a minute and try again." },
      429,
      { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) }
    );
  }

  if (path === RELAY_STATUS_URL) {
    return json({
      ok: true,
      storage: deps.store.kind,
      maxBytes: MAX_RELAY_BYTES,
      codeLength: CODE_LENGTH,
      sessionTtlHours: SESSION_TTL_MS / 3_600_000,
      fileTtlHours: FILE_TTL_MS / 3_600_000,
      page: relayPageUrl(request),
    });
  }

  if (path === RELAY_REGISTER_URL && request.method === "POST") {
    return registerSession(deps, now);
  }

  if (path === RELAY_UPLOAD_URL && request.method === "POST") {
    return uploadToCode(request, deps, now);
  }

  if (path === RELAY_POLL_URL && request.method === "GET") {
    return pollAndPull(request, url, deps, now);
  }

  return json({ error: "Unknown relay route." }, 404);
}

/** Mint a code + secret, TTL 6h, and hand them to the e-reader's browser. */
async function registerSession(deps: RelayDeps, now: number): Promise<Response> {
  // Opportunistic cleanup: expired sessions and undelivered files go here
  // rather than depending on a cron trigger to exist.
  try {
    await deps.store.sweepExpired(now);
  } catch {
    // A sweep failure must never block a new session.
  }

  const existing = new Set(await deps.store.listSessionCodes());
  const code = await generateUniqueRelayCode((c) => existing.has(c));
  const secret = generateRelaySecret();

  const session: StoredSession = {
    kind: "session",
    code,
    secret,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    hasFile: false,
    failedPulls: 0,
  };
  await deps.store.putSession(session);
  logRelayEvent("session.registered");

  return json({
    ok: true,
    code,
    secret,
    expiresAt: session.expiresAt,
    expiresInSeconds: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export type UploadOutcome = "ok" | "bad-code" | "too-large" | "no-file" | "already-filled" | "rate-limited";

export interface UploadResult {
  status: number;
  body: Record<string, unknown>;
  outcome: UploadOutcome;
}

/**
 * The upload, split out from the Response so the logic is testable without
 * constructing a Request.
 */
export async function uploadBytes(
  body: ArrayBuffer,
  rawFileName: unknown,
  code: unknown,
  deps: RelayDeps,
  now: number
): Promise<UploadResult> {
  const norm = normalizeRelayCode(code);
  if (!norm) {
    return {
      status: 400,
      outcome: "bad-code",
      body: { error: `That code must be exactly ${CODE_LENGTH} characters from your e-reader screen.` },
    };
  }

  // Size first, before touching the session: a 2 GB body must not be able to
  // make the session table do work.
  const byteLength = body?.byteLength ?? 0;
  if (byteLength === 0) {
    return { status: 400, outcome: "no-file", body: { error: "That file is empty." } };
  }
  if (byteLength > MAX_RELAY_BYTES) {
    return {
      status: 413,
      outcome: "too-large",
      body: {
        error: `That file is ${(byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${
          MAX_RELAY_BYTES / 1024 / 1024
        } MB.`,
        maxBytes: MAX_RELAY_BYTES,
      },
    };
  }

  const session = await deps.store.getSession(norm);
  if (!session) {
    return {
      status: 404,
      outcome: "bad-code",
      body: {
        error:
          "No e-reader is waiting for that code. It may have expired, or the code was mistyped. Open the Send page on the device again.",
      },
    };
  }
  if (isCodeLocked(session, now)) {
    return {
      status: 429,
      outcome: "rate-limited",
      body: { error: "That code is locked after too many wrong attempts. Open the Send page on the device again." },
    };
  }
  if (session.hasFile) {
    return {
      status: 409,
      outcome: "already-filled",
      body: { error: "That code already has a book waiting on the device. Open the Send page again to send another." },
    };
  }
  if (session.delivered) {
    return {
      status: 409,
      outcome: "already-filled",
      body: {
        error:
          "That code already delivered a book. Open the Send page on the device again to get a fresh code.",
      },
    };
  }

  // The ONLY place a client-supplied name is interpreted, and it can only ever
  // come out as a single safe segment.
  const file = describeRelayFile(rawFileName, byteLength);

  await deps.store.putFile(norm, body);
  await deps.store.putSession({
    ...session,
    hasFile: true,
    fileName: file.name,
    fileMime: file.mime,
    fileSize: byteLength,
    // A waiting file outlives the pairing window by only as long as it takes
    // the device to poll — never longer than the file TTL.
    expiresAt: Math.min(session.expiresAt, now + FILE_TTL_MS),
  });
  logRelayEvent("file.staged");

  return {
    status: 200,
    outcome: "ok",
    body: {
      ok: true,
      // The name is echoed back so the phone's toast can name the file it
      // sent. The value is already sanitised, and the sender never reads it
      // into anything but a string.
      name: file.name,
      bytes: byteLength,
      expiresInSeconds: Math.floor(FILE_TTL_MS / 1000),
    },
  };
}

async function uploadToCode(request: Request, deps: RelayDeps, now: number): Promise<Response> {
  let code: unknown = "";
  let rawName: unknown = "book";
  let body: ArrayBuffer;

  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    // A browser form post. The filename comes from the File part; it is
    // sanitised downstream and never used as a path.
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Could not read that upload." }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return json({ error: "No file was attached." }, 400);
    }
    code = form.get("code") ?? "";
    rawName = (file as File).name || "book";
    body = await file.arrayBuffer();
  } else {
    // Raw body from the app, with the name and code out of band.
    code = request.headers.get("X-Relay-Code") || url_param(request, "code");
    rawName = request.headers.get("X-Relay-Filename") || url_param(request, "name") || "book";
    body = await request.arrayBuffer();
  }

  const result = await uploadBytes(body, rawName, code, deps, now);
  return json(result.body, result.status);
}

function url_param(request: Request, key: string): string {
  try {
    return new URL(request.url).searchParams.get(key) || "";
  } catch {
    return "";
  }
}

export interface PollResult {
  status: number;
  body: Record<string, unknown>;
  /** Set when the caller should stream `bytes` and then delete. */
  file?: { bytes: ArrayBuffer; name: string; mime: string };
}

/**
 * The pull. Code + secret, or nothing.
 *
 * Deletion happens here, before the bytes are returned to the network. If the
 * transfer is interrupted the file is gone and the e-reader re-registers —
 * which is the correct failure for a relay: re-sending a 20 MB EPUB is a
 * decision the user can make, while a file that survives a failed transfer is
 * a book sitting on a stranger's server.
 */
export async function pollSession(
  code: unknown,
  secret: unknown,
  deps: RelayDeps,
  now: number
): Promise<PollResult> {
  const norm = normalizeRelayCode(code);
  if (!norm) {
    return { status: 400, body: { error: "Bad code." } };
  }

  const session = await deps.store.getSession(norm);
  if (!session) {
    return { status: 404, body: { error: "This code has expired. Reload the page on the device." } };
  }

  // A locked code is refused for EVERYONE, including whoever holds the right
  // secret. This check used to sit only on the wrong-secret branch, which made
  // the lockout cosmetic: the attacker's guesses were refused, and the victim's
  // own next pull sailed through. A lockout that exempts the person it was
  // burned by is not a lockout.
  if (isCodeLocked(session, now)) {
    return {
      status: 429,
      body: { error: "Too many wrong tries for this code. Reload the page on the device." },
    };
  }

  if (typeof secret !== "string" || !timingSafeEqual(secret, session.secret)) {
    const next = registerFailedPull(session, now);
    await deps.store.putSession({ ...session, ...next });
    logRelayEvent("pull.rejected");
    return {
      status: next.locked ? 429 : 401,
      body: {
        error: next.locked
          ? "Too many wrong tries for this code. Reload the page on the device."
          : "That code does not match this page.",
      },
    };
  }

  // A correct secret clears the counter: mistyping a code on an e-ink screen
  // is not an attack.
  if (session.failedPulls > 0) {
    await deps.store.putSession({ ...session, ...clearFailedPulls() });
  }

  if (session.delivered) {
    // The code was already used. Answering 204 ("still waiting") here would be
    // a lie the page acts on — it would sit there polling forever for a book
    // that was never going to come.
    return {
      status: 404,
      body: { error: "This code already delivered a book. Reload the page on the device for a new one." },
    };
  }

  if (!session.hasFile) {
    return { status: 204, body: {} };
  }

  const stored = await deps.store.getFile(norm);
  if (!stored) {
    // Session says a file, store says otherwise. Treat as gone and reset so
    // the page stops waiting on a file that will never arrive.
    await deps.store.putSession({
      ...session,
      hasFile: false,
      fileName: undefined,
      fileMime: undefined,
      fileSize: undefined,
    });
    return { status: 404, body: { error: "That file has expired. Send it again from Kora." } };
  }

  const name = session.fileName || "book";
  const mime = session.fileMime || "application/octet-stream";

  // RELAY, NOT A FILE STORE: gone the moment it is taken. The code is spent in
  // the same breath, so the pair (code, secret) is worth exactly one book.
  await deps.store.deleteFile(norm);
  await deps.store.putSession({
    ...session,
    hasFile: false,
    delivered: true,
    fileName: undefined,
    fileMime: undefined,
    fileSize: undefined,
  });
  logRelayEvent("file.delivered");

  return {
    status: 200,
    body: { ok: true, name, bytes: stored.body.byteLength },
    file: { bytes: stored.body, name, mime },
  };
}

async function pollAndPull(request: Request, url: URL, deps: RelayDeps, now: number): Promise<Response> {
  const secret = request.headers.get("X-Relay-Secret") || url.searchParams.get("s") || "";
  const result = await pollSession(url.searchParams.get("code"), secret, deps, now);

  if (result.file) {
    // Already deleted above. Now serve, with the name the receiver will use.
    return new Response(result.file.bytes, {
      status: 200,
      headers: {
        "Content-Type": result.file.mime,
        "Content-Length": String(result.file.bytes.byteLength),
        "Content-Disposition": contentDispositionFor(result.file.name),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // A 204 MUST NOT HAVE A BODY. `json({}, 204)` builds a Response with a
  // non-null body, which the runtime rejects by throwing — so the e-reader
  // page's steady-state poll ("nothing waiting yet", the state it sits in
  // almost all the time) 500'd on every single call. The unit tests missed it
  // because they call pollSession() directly and never construct the Response.
  if (result.status === 204) {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  return json(result.body, result.status);
}

/** Constant-time compare. Short hex strings, but a fixed time is free. */
export function timingSafeEqual(a: string, b: string): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ── The e-reader page ────────────────────────────────────────────────────────

/**
 * The page the e-reader opens.
 *
 * Every constraint here comes from the device, not from taste:
 *
 *  - NO FRAMEWORK, NO BUNDLE, no modules, no fetch-on-DOMContentLoaded
 *    gymnastics. Kindle's experimental browser and Kobo's are WebKit builds
 *    from around 2016-2019. ES2015 and `fetch` are safe; `async/await` in the
 *    served source is not, so this is ES5 with promises.
 *  - INLINE CSS AND JS ONLY. A single extra request on a slow e-reader
 *    connection is a visible delay, and a stylesheet that fails to load is an
 *    unreadable page.
 *  - THE CODE IS SET IN HUGE TEXT, high contrast, letter-spaced. It gets read
 *    off the screen and typed by hand on another device.
 *  - NOTHING REFLECTED IS EVER PARSED AS MARKUP. The code comes from our
 *    generator and the filename from a sender, so neither is trusted at the
 *    point of rendering: both reach the DOM as text nodes via `textContent`
 *    / `createTextNode`. `innerHTML` appears in this page exactly once, on an
 *    empty element, to clear it. The code is additionally constrained to the
 *    31-character alphabet by the server before it is ever minted.
 *  - NO SERVICE WORKER, NO STORAGE. The secret lives in a JS variable and is
 *    lost on reload — which is correct: reloading is how you get a new code.
 */
export function renderEreaderPage(origin: string): string {
  const apiBase = JSON.stringify(safePageOrigin(origin));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kora — Send to this device</title>
<style>
  html,body{margin:0;padding:0;background:#111;color:#f2f2f2;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:34em;margin:0 auto;padding:1.2em 1em 3em}
  h1{font-size:1.1em;margin:0 0 .2em;font-weight:600}
  p{font-size:.9em;line-height:1.5;color:#b9b9b9;margin:.5em 0}
  #code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    font-size:4.2em;line-height:1.1;letter-spacing:.28em;font-weight:700;
    color:#fff;background:#1c1c1c;border:2px solid #3a3a3a;border-radius:.6em;
    padding:.25em .1em .3em .35em;margin:.35em 0 .1em;text-align:center}
  #state{font-size:1em;min-height:1.4em;padding:.5em 0;color:#9ecbff}
  #got{color:#7ee787;font-size:1em;font-weight:600;word-wrap:break-word}
  .dot{display:inline-block;width:.6em;height:.6em;border-radius:50%;
    background:#f5b942;margin-right:.5em;vertical-align:middle}
  hr{border:0;border-top:1px solid #2a2a2a;margin:1.4em 0}
  a{color:#9ecbff}
  .sm{font-size:.78em;color:#8a8a8a}
  noscript p{color:#ff9b9b}
</style>
</head>
<body>
<div class="wrap">
  <h1>Kora — send a book to this device</h1>
  <p>Keep this page open. In Kora on your phone or computer, type the code below and send a book.</p>
  <div id="code">····</div>
  <div id="state"><span class="dot"></span><span id="txt">Starting…</span></div>
  <div id="got"></div>
  <hr>
  <p class="sm">This page talks only to Kora's own server. Your book is deleted the moment it is
  downloaded, and this code stops working after ${SESSION_TTL_MS / 3_600_000} hours.
  Maximum file size ${MAX_RELAY_BYTES / 1024 / 1024} MB.</p>
  <noscript><p>This page needs JavaScript. The Kindle and Kobo browsers have it enabled by default.</p></noscript>
</div>
<script>
(function () {
  var API = ${apiBase};
  var code = null, secret = null, done = false, tries = 0;
  var elCode = document.getElementById('code');
  var elTxt  = document.getElementById('txt');
  var elGot  = document.getElementById('got');

  // Every dynamic string reaches the page as a text node, never as markup.
  // innerHTML is assigned exactly once in this file, to empty an element.
  function say(t) { elTxt.innerHTML = ''; elTxt.appendChild(document.createTextNode(t)); }

  function register() {
    say('Getting a code…');
    var x = new XMLHttpRequest();
    x.open('POST', API + '/api/relay/register', true);
    x.onload = function () {
      if (x.status !== 200) { say('Could not start (' + x.status + '). Retrying…'); return setTimeout(register, 4000); }
      var d;
      try { d = JSON.parse(x.responseText); } catch (e) { say('Bad reply from server.'); return setTimeout(register, 4000); }
      code = d.code; secret = d.secret;
      elCode.textContent = code;   // textContent, never innerHTML
      say('Waiting for Kora to send a book…');
      setTimeout(poll, 2500);
    };
    x.onerror = function () { say('No connection. Retrying…'); setTimeout(register, 4000); };
    x.send();
  }

  function poll() {
    if (done) return;
    tries++;
    var x = new XMLHttpRequest();
    x.open('GET', API + '/api/relay/poll?code=' + encodeURIComponent(code), true);
    x.setRequestHeader('X-Relay-Secret', secret);
    x.onload = function () {
      if (done) return;
      if (x.status === 204) {
        // A 5-minute ceiling on waiting, then a fresh code. The session TTL is
        // 6h but nobody holds a device open that long, and a fresh code is
        // the honest answer to "it has been ages".
        if (tries > 120) { say('Starting a new code…'); return register(); }
        return setTimeout(poll, 2500);
      }
      if (x.status === 401 || x.status === 429 || x.status === 404) {
        // Locked, expired, or already spent — all three mean the same thing to
        // the person holding the device: this code is dead, get another. Note
        // 404 covers both "expired" and "already delivered a book".
        elCode.textContent = '····';
        say('This code is finished. Getting a new one…');
        return register();
      }
      if (x.status !== 200) { return setTimeout(poll, 3000); }
      // A file. Name and type are shown; the browser downloads the bytes
      // straight from this response, so nothing is stored in between.
      var name = 'book';
      var cd = x.getResponseHeader('Content-Disposition') || '';
      var m = /filename\\*=UTF-8''([^;]+)/i.exec(cd);
      if (m) { try { name = decodeURIComponent(m[1]); } catch (e) { name = 'book'; } }
      else { var m2 = /filename="([^"]+)"/i.exec(cd); if (m2) name = m2[1]; }
      done = true;
      // "Received", not "Receiving": by the time this line is written the
      // download has already fired, and a page that says it is still receiving
      // a book it already has makes the reader wait for something that is done.
      elGot.textContent = 'Received ' + name + ' — check your downloads folder.';
      // Blob + object URL: the only shape that reliably triggers a save on
      // both devices' browsers without leaving the page.
      var url = URL.createObjectURL(x.response);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 30000);
      say('Sent. This code is now dead — reload the page to send another book.');
    };
    x.onerror = function () { say('Lost connection. Retrying…'); setTimeout(poll, 4000); };
    x.responseType = 'blob';
    x.send();
  }

  register();
}());
</script>
</body>
</html>`;
}

/**
 * Reduce an origin to something that can be embedded in a script safely.
 *
 * `JSON.stringify` already escapes quotes and backslashes, so a hostile origin
 * cannot break out of the string literal — that is what stops the injection.
 * This is the belt to that braces: the value is REBUILT from parsed parts and
 * anything unexpected collapses to an empty string, so a future edit that
 * interpolates the origin somewhere `JSON.stringify` does not cover still
 * cannot inject. A `URL` origin is already normalised by the parser; this
 * assumes nothing about who called it.
 */
export function safePageOrigin(raw: string): string {
  try {
    const u = new URL(String(raw));
    // http/https only, and no credentials or path smuggled through.
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (u.username || u.password) return "";
    return u.origin;
  } catch {
    return "";
  }
}

export { CODE_LENGTH, MAX_FILENAME_LENGTH, escapeHtml, SESSION_TTL_MS, FILE_TTL_MS, MAX_RELAY_BYTES, RateLimitDecision };
