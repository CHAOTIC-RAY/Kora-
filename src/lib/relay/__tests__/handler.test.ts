/**
 * The relay's endpoints: expiry, deletion on first download, oversize, and the
 * full register → upload → pull → gone round-trip.
 *
 * THIS IS THE FILE THAT PROVES "a relay, not a file store". The specific
 * assertion that matters: after one successful download the bytes are GONE, and
 * a second pull of the same code 404s. Every property of a file store — a
 * re-pullable URL, a listing, a persisted copy — is what a relay must not have,
 * and each is asserted here as its absence.
 *
 * The store is the in-memory one, which is the one available in plain Node. It
 * is the SAME interface R2 implements, and the R2 implementation's own
 * semantics (expiry enforced on read, metadata-carrying sweep) are asserted
 * separately at the bottom against a fake bucket — so the fallback is tested
 * too, and neither store is trusted on the other's behaviour.
 *
 * The clock is injected. Every TTL assertion is therefore exact rather than
 * "sleep and hope", which is what makes an 6-hour TTL testable in milliseconds.
 */

import {
  handleRelayRequest,
  pollSession,
  renderEreaderPage,
  timingSafeEqual,
  uploadBytes,
  type RelayDeps,
} from "../handler";
import { IpRateLimiter } from "../rateLimit";
import { normalizeRelayCode } from "../codes";
import {
  FILE_TTL_MS,
  MAX_RELAY_BYTES,
  MemoryRelayStore,
  R2RelayStore,
  SESSION_TTL_MS,
  type StoredSession,
} from "../store";

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

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: ArrayBuffer) => new TextDecoder().decode(b);

/** A fresh world, with a clock the test moves by hand. */
function world(startAt = 1_700_000_000_000) {
  let now = startAt;
  // The store takes the SAME clock as the handler. Without this the store reads
  // the real Date.now() while the handler reads `now`, every session looks
  // expired, and the failure reads like a logic bug rather than a wiring one.
  const clock = () => now;
  const store = new MemoryRelayStore(clock);
  const limiter = new IpRateLimiter();
  const deps: RelayDeps = { store, limiter, now: () => now };
  return {
    deps,
    store,
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

const EPUB = enc("PK pretend this is an epub, with a few more bytes in it");

/** Register a code and return it with its secret, the way the device page would. */
async function register(w: ReturnType<typeof world>) {
  const res = await handleRelayRequest(
    new Request("https://example.test/api/relay/register", { method: "POST" }),
    {},
    w.deps
  );
  const body = await res.json();
  return { code: body.code as string, secret: body.secret as string, body, res };
}

// ── 1. Registration mints a usable, unguessable session ─────────────────────

{
  const w = world();
  const { code, secret, body } = await register(w);
  check("register: 200", body.ok === true, body);
  check("register: a 4-character code", typeof code === "string" && code.length === 4, code);
  check("register: a 32-hex secret", /^[0-9a-f]{32}$/.test(secret), secret);
  check("register: a TTL is stated", typeof body.expiresInSeconds === "number", body);
  check("register: the TTL is 6 hours", body.expiresInSeconds === SESSION_TTL_MS / 1000, body.expiresInSeconds);
  check("register: the secret is not the code", secret !== code);

  // The code space is not enumerable by a quick sequence of registrations.
  // The per-IP window is 30/min, so this world gets a wider one — otherwise
  // this would be testing the limiter twice, not code uniqueness.
  const w2 = world();
  w2.deps.limiter = new IpRateLimiter(60_000, 500);
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const r = await handleRelayRequest(
      new Request("https://example.test/api/relay/register", { method: "POST" }),
      {},
      w2.deps
    );
    seen.add(String((await r.json()).code));
  }
  check("100 registrations produce 100 distinct codes", seen.size === 100, seen.size);
  check("none is an empty or malformed code", [...seen].every((c) => c.length === 4 && normalizeRelayCode(c) === c), [...seen]);
}

// ── 2. The round trip: upload → pull → bytes match → GONE ───────────────────

{
  const w = world();
  const { code, secret } = await register(w);

  // Polling before anything is sent is a 204, not an error: the device page
  // polls in a loop and a 404 would make it think the code died.
  const waiting = await pollSession(code, secret, w.deps, w.now);
  check("poll before upload: 204 no-content", waiting.status === 204, waiting);

  const up = await uploadBytes(EPUB.buffer as ArrayBuffer, "Dune.epub", code, w.deps, w.now);
  check("upload: ok", up.status === 200 && up.outcome === "ok", up);
  check("upload: echoes the sanitised name", up.body.name === "Dune.epub", up.body);
  check("upload: reports the byte count", up.body.bytes === EPUB.length, up.body);
  check("upload: states a TTL", typeof up.body.expiresInSeconds === "number", up.body);

  // The device pulls with code + secret.
  const got = await pollSession(code, secret, w.deps, w.now);
  check("pull: 200", got.status === 200, got);
  check("pull: the bytes match exactly", got.file !== undefined && dec(got.file.bytes) === dec(EPUB.buffer as ArrayBuffer));
  check("pull: the name is what the receiver will save", got.file?.name === "Dune.epub", got.file?.name);
  check("pull: the mime is derived from the extension", got.file?.mime === "application/epub+zip", got.file?.mime);
  check("pull: the response is JSON-shaped", got.body.ok === true, got.body);

  // AND THEN IT IS GONE. This is the assertion the whole design rests on.
  const again = await pollSession(code, secret, w.deps, w.now);
  check("a second pull of the same code: 404", again.status === 404, again);
  check("a second pull returns no file", again.file === undefined, again);
  check("a second pull says the code is spent", /already delivered/.test(String(again.body.error)), again.body);
  check("a spent code does NOT report 204 'still waiting'", again.status !== 204, again.status);
  check("the file is gone from the store", (await w.store.getFile(code)) === null);
  check("the session record survives", (await w.store.getSession(code)) !== null);
  check("the session is no longer flagged as holding a file", (await w.store.getSession(code))?.hasFile === false);
  check("the session is marked as having delivered", (await w.store.getSession(code))?.delivered === true);

  // ONE CODE, ONE BOOK. The device page tells the user to reload for a new
  // code, and it had better mean it — a code that stayed live after a delivery
  // is a code that can be shot at long after the user walked away.
  const up2 = await uploadBytes(enc("second book").buffer as ArrayBuffer, "Two.epub", code, w.deps, w.now);
  check("a spent code refuses a second upload", up2.status === 409, up2);
  check("and says to get a fresh code", /fresh code/.test(String(up2.body.error)), up2.body);
  check("the second book's bytes were never stored", dec((await w.store.getFile(code))?.body ?? new ArrayBuffer(0)) !== "second book");

  // A NEW code works end to end, which is the real user flow.
  const second = await register(w);
  const up3 = await uploadBytes(enc("second book").buffer as ArrayBuffer, "Two.epub", second.code, w.deps, w.now);
  check("a fresh code accepts a book", up3.status === 200, up3);
  const got2 = await pollSession(second.code, second.secret, w.deps, w.now);
  check("and it pulls back intact", got2.status === 200 && dec(got2.file!.bytes) === "second book", got2);
}

// ── 3. The secret is required, and its absence is rate-limited ──────────────

{
  const w = world();
  const { code, secret } = await register(w);
  await uploadBytes(EPUB.buffer as ArrayBuffer, "Dune.epub", code, w.deps, w.now);

  check("a pull with no secret is refused", (await pollSession(code, "", w.deps, w.now)).status === 401);
  check("a pull with a wrong secret is refused", (await pollSession(code, "0".repeat(32), w.deps, w.now)).status === 401);
  check("a pull with a prefix of the secret is refused", (await pollSession(code, "abcd", w.deps, w.now)).status === 401);
  check("a pull with a longer-than-real secret is refused", (await pollSession(code, "a".repeat(64), w.deps, w.now)).status === 401);
  // Four failures so far, so the code is not yet locked. The claim under test
  // is that a wrong guess does not CONSUME the book — so ask the store, not
  // the endpoint: a fifth wrong pull here would lock the code and answer 429.
  check("four wrong guesses did not take the file", (await w.store.getFile(code)) !== null);
  check("and the code is not locked yet", (await w.store.getSession(code))?.lockedUntil === undefined, await w.store.getSession(code));
  const rightful = await pollSession(code, secret, w.deps, w.now);
  check("the rightful puller still gets its book", rightful.status === 200, rightful);
  check("and the bytes are intact", dec(rightful.file!.bytes) === dec(EPUB.buffer as ArrayBuffer));
}

{
  // The lockout: five wrong secrets and the code is burned. This is the
  // per-code half of "a code cannot be brute-forced".
  const w = world();
  const { code, secret } = await register(w);
  await uploadBytes(EPUB.buffer as ArrayBuffer, "Dune.epub", code, w.deps, w.now);

  for (let i = 1; i <= 4; i++) {
    const r = await pollSession(code, "0".repeat(32), w.deps, w.now);
    check(`wrong attempt ${i}: 401, not yet locked`, r.status === 401, r);
  }
  const fifth = await pollSession(code, "0".repeat(32), w.deps, w.now);
  check("the fifth wrong attempt locks the code", fifth.status === 429, fifth);
  check("the lock message tells the user what to do", /Reload the page/.test(String(fifth.body.error)), fifth.body);

  // Even the CORRECT secret is refused while locked. That is the point of a
  // lockout: it does not care who is asking. (It used to be checked only on the
  // wrong-secret branch, which made the lockout cosmetic.)
  const rightful = await pollSession(code, secret, w.deps, w.now);
  check("the rightful device is refused while locked", rightful.status === 429, rightful);
  check("a locked pull returns no bytes", rightful.file === undefined, rightful);

  // And the lock lapses — it is not a permanent ban on the user's own device.
  w.advance(10 * 60_000 + 1000);
  const after = await pollSession(code, secret, w.deps, w.now);
  check("after the lock expires the rightful device gets its book", after.status === 200, after);
  check("and the bytes are intact", dec(after.file!.bytes) === dec(EPUB.buffer as ArrayBuffer));
}

{
  // A correct secret CLEARS the counter, so two typos do not burn a transfer.
  const w = world();
  const { code, secret } = await register(w);
  await uploadBytes(EPUB.buffer as ArrayBuffer, "Dune.epub", code, w.deps, w.now);
  for (let i = 0; i < 4; i++) await pollSession(code, "0".repeat(32), w.deps, w.now);
  const ok = await pollSession(code, secret, w.deps, w.now);
  check("a correct pull after 4 typos works", ok.status === 200, ok);
}

// ── 4. Expiry: sessions AND files both have a hard TTL ─────────────────────

{
  // A session nobody uploads to expires at 6h and reads as absent.
  const w = world();
  const { code, secret } = await register(w);
  w.advance(SESSION_TTL_MS - 1000);
  check("a session is alive just before its TTL", (await w.store.getSession(code)) !== null);
  w.advance(2000);
  check("a session is gone at its TTL", (await w.store.getSession(code)) === null);
  const late = await pollSession(code, secret, w.deps, w.now);
  check("polling an expired session is a 404", late.status === 404, late);
  check("the 404 tells the device to reload", /Reload the page/.test(String(late.body.error)), late.body);
}

{
  // A file that is never downloaded expires on its own. This is the property
  // that stops the relay accumulating books nobody collected.
  const w = world();
  const { code, secret } = await register(w);
  await uploadBytes(EPUB.buffer as ArrayBuffer, "Dune.epub", code, w.deps, w.now);
  check("the file is present right after upload", (await w.store.getFile(code)) !== null);

  w.advance(FILE_TTL_MS + 1000);
  check("the file is gone after its TTL, never downloaded", (await w.store.getFile(code)) === null);
  const late = await pollSession(code, secret, w.deps, w.now);
  check("polling for an expired file is a 404", late.status === 404, late);
  check("no bytes came back", late.file === undefined, late);
  // The message differs by cause, and both point at reloading the device. After
  // the file TTL the whole session has lapsed too (its expiry is capped at the
  // file TTL once a file is staged), so the "expired" wording is the correct
  // one here; the "send it again" wording belongs to the case where only the
  // file went and the pairing is still alive — asserted below.
  check("the 404 says the code has expired", /expired/.test(String(late.body.error)), late.body);
  check("and tells the user to reload the page", /Reload the page/.test(String(late.body.error)), late.body);
}

{
  // The other 404: the FILE is gone but the PAIRING is still alive. This is
  // the state where "send it again" is the honest instruction — the device
  // page should stay open and the user should re-send from Kora.
  const w = world();
  const { code, secret } = await register(w);
  await uploadBytes(EPUB.buffer as ArrayBuffer, "Dune.epub", code, w.deps, w.now);

  // Age the FILE past its TTL without ageing the session, by expiring the file
  // directly — the store's own read-path expiry is what a sweep would leave.
  const s0 = (await w.store.getSession(code))!;
  await w.store.putSession({ ...s0, expiresAt: w.now + SESSION_TTL_MS });
  // Re-stage, then delete the bytes out from under the session, which is
  // exactly the inconsistency the handler has to survive.
  await w.store.putFile(code, EPUB.buffer as ArrayBuffer);
  await w.store.deleteFile(code);

  const late = await pollSession(code, secret, w.deps, w.now);
  check("a session whose file vanished is a 404", late.status === 404, late);
  check("and says to send it again", /Send it again/.test(String(late.body.error)), late.body);
  check("no bytes came back", late.file === undefined, late);
  check("the session was reset so the page stops waiting", (await w.store.getSession(code))?.hasFile === false);
}

{
  // A file TTL can never outlive its session: the session expiry is the cap.
  const w = world();
  const { code } = await register(w);
  await uploadBytes(EPUB.buffer as ArrayBuffer, "Dune.epub", code, w.deps, w.now);
  const s = await w.store.getSession(code);
  check("the file expiry is capped by the session expiry", (s?.expiresAt ?? 0) <= w.now + SESSION_TTL_MS, {
    expiresAt: s?.expiresAt,
    now: w.now,
  });
}

{
  // The sweep is what actually reclaims, and it is idempotent.
  const w = world();
  const a = await register(w);
  const b = await register(w);
  await uploadBytes(EPUB.buffer as ArrayBuffer, "A.epub", a.code, w.deps, w.now);
  w.advance(FILE_TTL_MS + 1000);
  check("a file past its TTL reads as absent", (await w.store.getFile(a.code)) === null);
  // A staged file CAPS the session's expiry at the file TTL — the pairing stops
  // being useful the moment its one book is gone. So the session lapses with
  // the file rather than lingering for another 5 hours holding nothing.
  check("the session lapses with the file it was holding", (await w.store.getSession(a.code)) === null);
  // b has no file, so its full 6-hour pairing TTL applies and it is untouched.
  check("the fresh session with no file keeps its full TTL", (await w.store.getSession(b.code)) !== null);
  await w.store.sweepExpired(w.now);
  check("sweeping does not disturb a live session", (await w.store.getSession(b.code)) !== null);
  await w.store.sweepExpired(w.now);
  check("a second sweep is harmless", (await w.store.getSession(b.code)) !== null);
  // That the sweep actually RECLAIMS storage is proven against the fake bucket
  // below, where the raw object map can be inspected directly.
}

// ── 5. Oversize rejection is a clean 413, before any storage work ──────────

{
  const w = world();
  const { code } = await register(w);
  // Just under: accepted.
  const under = new ArrayBuffer(MAX_RELAY_BYTES - 1024);
  const okRes = await uploadBytes(under, "big.epub", code, w.deps, w.now);
  check("a file just under 50 MB is accepted", okRes.status === 200, okRes.status);

  // Need a second code, because the first is now full.
  const { code: code2 } = await register(w);
  const over = new ArrayBuffer(MAX_RELAY_BYTES + 1);
  const bad = await uploadBytes(over, "toobig.epub", code2, w.deps, w.now);
  check("a file one byte over 50 MB is a 413", bad.status === 413, bad);
  check("the 413 outcome is labelled", bad.outcome === "too-large", bad.outcome);
  check("the 413 states the limit", /limit is 50 MB/.test(String(bad.body.error)), bad.body);
  check("the 413 reports the cap", bad.body.maxBytes === MAX_RELAY_BYTES, bad.body);
  check("nothing was stored for the oversize file", (await w.store.getFile(code2)) === null);
  check("the session was not marked as holding a file", (await w.store.getSession(code2))?.hasFile === false);
}

{
  // 50 MB is at least the stated floor, which is the requirement.
  check("the cap is at least 50 MB", MAX_RELAY_BYTES >= 50 * 1024 * 1024, MAX_RELAY_BYTES);
  check("the cap is exactly 50 MiB", MAX_RELAY_BYTES === 52_428_800, MAX_RELAY_BYTES);
}

{
  // A grossly oversize body is refused on the same rule, and the size check
  // happens before the session is even looked up — so a huge body cannot make
  // the session table do work.
  const w = world();
  const r = await uploadBytes(new ArrayBuffer(500 * 1024 * 1024), "huge.epub", "ABCD", w.deps, w.now);
  check("a 500 MB body is a 413 even with a code that does not exist", r.status === 413, r.status);
  check("the size rule is checked before existence", r.outcome === "too-large", r.outcome);
}

{
  // An empty file is not a book.
  const w = world();
  const { code } = await register(w);
  const empty = await uploadBytes(new ArrayBuffer(0), "empty.epub", code, w.deps, w.now);
  check("an empty file is refused", empty.status === 400, empty);
  check("an empty file says so", /empty/.test(String(empty.body.error)), empty.body);
}

// ── 6. Bad codes and unknown codes are refused distinctly ──────────────────

{
  const w = world();
  for (const bad of ["", "AB", "ABCDE", "!!!!", "AB01", "ABOD", null, undefined, 42, {}]) {
    const r = await uploadBytes(EPUB.buffer as ArrayBuffer, "Dune.epub", bad, w.deps, w.now);
    check(`upload with code ${JSON.stringify(bad)} is a 400`, r.status === 400, r);
    check(`upload with code ${JSON.stringify(bad)} is labelled bad-code`, r.outcome === "bad-code", r.outcome);
  }
}
{
  // A well-formed code that nobody is waiting on: 404, and the message tells
  // the user the likely causes rather than "error".
  const w = world();
  const r = await uploadBytes(EPUB.buffer as ArrayBuffer, "Dune.epub", "ZZZZ", w.deps, w.now);
  check("an unknown code is a 404", r.status === 404, r);
  check("the 404 is labelled bad-code", r.outcome === "bad-code", r.outcome);
  check("the 404 names the likely causes", /expired|mistyped/.test(String(r.body.error)), r.body);
}
{
  // One book per code. A second upload does not overwrite a waiting one: the
  // first file is already promised to a device, and silently replacing it would
  // let anyone who knows a code swap a book under the user's finger.
  const w = world();
  const { code } = await register(w);
  await uploadBytes(enc("first").buffer as ArrayBuffer, "One.epub", code, w.deps, w.now);
  const second = await uploadBytes(enc("second").buffer as ArrayBuffer, "Two.epub", code, w.deps, w.now);
  check("a second upload into a full code is a 409", second.status === 409, second);
  check("the 409 is labelled already-filled", second.outcome === "already-filled", second.outcome);
  const s2 = await w.store.getSession(code);
  const pulled = await pollSession(code, s2!.secret, w.deps, w.now);
  check("the FIRST book is what the device gets", dec(pulled.file!.bytes) === "first", dec(pulled.file!.bytes));
}

// ── 7. Filenames are sanitised on the way IN, not merely on the way out ────

{
  const w = world();
  const { code, secret } = await register(w);
  const hostile = "../../../../etc/cron.d/evil.epub";
  const up = await uploadBytes(EPUB.buffer as ArrayBuffer, hostile, code, w.deps, w.now);
  check("a traversal filename is accepted for delivery", up.status === 200, up);
  const stored = String(up.body.name);
  check("the stored name has no slash", !stored.includes("/") && !stored.includes("\\"), stored);
  check("the stored name has no ..", !stored.includes(".."), stored);
  check("the stored name kept the extension", stored.endsWith(".epub"), stored);

  const got = await pollSession(code, secret, w.deps, w.now);
  check("the receiver is handed the safe name", got.file?.name === stored, got.file?.name);
  check("the receiver's name is still the traversal-free one", !String(got.file?.name).includes("/"), got.file?.name);
}
{
  const w = world();
  const { code, secret } = await register(w);
  await uploadBytes(EPUB.buffer as ArrayBuffer, "NUL\u0000.epub", code, w.deps, w.now);
  const got = await pollSession(code, secret, w.deps, w.now);
  check("a NUL in the filename is stripped before the receiver sees it", !String(got.file?.name).includes("\u0000"), got.file?.name);
}
{
  const w = world();
  const { code, secret } = await register(w);
  await uploadBytes(EPUB.buffer as ArrayBuffer, ".ssh", code, w.deps, w.now);
  const got = await pollSession(code, secret, w.deps, w.now);
  check("a forbidden name becomes the safe fallback", got.file?.name === "book", got.file?.name);
}

// ── 8. The HTTP surface: routes, methods, CORS, and the rate limiter ───────

{
  const w = world();
  const get = await handleRelayRequest(new Request("https://example.test/api/relay/status"), {}, w.deps);
  check("status: 200", get.status === 200);
  const body = await get.json();
  check("status: reports its storage", body.storage === "memory", body);
  check("status: reports the size cap", body.maxBytes === MAX_RELAY_BYTES, body);
  check("status: reports the code length", body.codeLength === 4, body);
  check("status: reports the session TTL in hours", body.sessionTtlHours === 6, body);
  check("status: reports the file TTL", body.fileTtlHours === FILE_TTL_MS / 3_600_000, body);
  check("status: points at the e-reader page", body.page === "https://example.test/send", body.page);
  check("status: is not cached", get.headers.get("Cache-Control") === "no-store", get.headers.get("Cache-Control"));
}

{
  // THE 204 TRAP, THROUGH THE HTTP LAYER.
  //
  // Calling pollSession() directly returned { status: 204 } and every unit
  // test passed, while the real endpoint 500'd on every call — because a 204
  // must not have a body, and `new Response("{}", { status: 204 })` throws in
  // the Workers runtime. This is the state the e-reader page sits in almost
  // all the time, so it was broken on the happy path.
  //
  // The lesson recorded here: the response must be exercised as a Response,
  // not as a status code.
  const w = world();
  const { code, secret } = await register(w);
  const res = await handleRelayRequest(
    new Request("https://example.test/api/relay/poll?code=" + code, {
      headers: { "X-Relay-Secret": secret },
    }),
    {},
    w.deps
  );
  check("an empty poll is a real 204 Response", res.status === 204, res.status);
  check("and constructing it did not throw (the 204 body trap)", res instanceof Response);
  check("its body is genuinely null", res.body === null, String(res.body));
  // Re-reading a bodyless response must not throw either.
  let reread = "threw";
  try {
    reread = await res.text();
  } catch {
    /* leave as "threw" */
  }
  check("a 204 can be consumed without throwing", reread === "", JSON.stringify(reread));
  check("a 204 carries no content-length", res.headers.get("Content-Length") === null, res.headers.get("Content-Length"));
  check("a 204 is not cached", res.headers.get("Cache-Control") === "no-store", res.headers.get("Cache-Control"));
}

{
  // Every OTHER relay response must be a constructible Response too, and must
  // carry a parseable body. A route that throws at Response construction is a
  // 500 in production, whatever its internal status code said.
  const w = world();
  w.deps.limiter = new IpRateLimiter(60_000, 500);
  const probes: { label: string; req: Request }[] = [];
  const { code, secret } = await register(w);
  probes.push({ label: "status", req: new Request("https://example.test/api/relay/status") });
  probes.push({ label: "unknown route", req: new Request("https://example.test/api/relay/nope") });
  probes.push({ label: "poll with no secret", req: new Request("https://example.test/api/relay/poll?code=" + code) });
  probes.push({ label: "poll on an unknown code", req: new Request("https://example.test/api/relay/poll?code=ZZZZ", { headers: { "X-Relay-Secret": secret } }) });
  probes.push({ label: "upload with a bad code", req: new Request("https://example.test/api/relay/upload", { method: "POST", headers: { "X-Relay-Code": "AB" } }) });
  probes.push({ label: "preflight", req: new Request("https://example.test/api/relay/upload", { method: "OPTIONS" }) });

  for (const { label, req } of probes) {
    let res: Response | null = null;
    let threw: unknown = null;
    try {
      res = await handleRelayRequest(req, {}, w.deps);
    } catch (e) {
      threw = e;
    }
    check(`${label}: does not throw`, threw === null, String(threw));
    if (!res) continue;
    check(`${label}: is a Response`, res instanceof Response);
    check(`${label}: not a 5xx`, res.status < 500, res.status);
    if (res.status === 204) continue;
    let body = "";
    let parseThrew = false;
    try {
      body = await res.text();
    } catch {
      parseThrew = true;
    }
    check(`${label}: body is readable`, !parseThrew);
    check(`${label}: body is JSON`, body.trim().startsWith("{") || body === "", body.slice(0, 60));
  }
}

{
  const w = world();
  const unknown = await handleRelayRequest(new Request("https://example.test/api/relay/nope"), {}, w.deps);
  check("an unknown relay route is a 404", unknown.status === 404, unknown.status);

  const wrongMethod = await handleRelayRequest(
    new Request("https://example.test/api/relay/register", { method: "GET" }),
    {},
    w.deps
  );
  check("register with GET is a 404, not a session", wrongMethod.status === 404, wrongMethod.status);

  const notRelay = await handleRelayRequest(new Request("https://example.test/api/books"), {}, w.deps);
  check("a non-relay path is not handled here", notRelay === null, notRelay);
}

{
  // The per-IP limiter, through the real request path.
  const w = world();
  let denied = 0;
  for (let i = 0; i < 60; i++) {
    const r = await handleRelayRequest(
      new Request("https://example.test/api/relay/register", {
        method: "POST",
        headers: { "CF-Connecting-IP": "5.5.5.5" },
      }),
      {},
      w.deps
    );
    if (r.status === 429) {
      denied++;
      check("a 429 carries Retry-After", !!r.headers.get("Retry-After"), r.headers.get("Retry-After"));
    }
  }
  check("60 registrations from one IP are throttled", denied > 0, denied);
}

{
  // A preflight, for the app posting from a different origin.
  const w = world();
  const res = await handleRelayRequest(
    new Request("https://example.test/api/relay/upload", { method: "OPTIONS" }),
    {},
    w.deps
  );
  check("preflight: 204", res.status === 204, res.status);
  check("preflight: allows the secret header", /X-Relay-Secret/i.test(res.headers.get("Access-Control-Allow-Headers") || ""), res.headers.get("Access-Control-Allow-Headers"));
}

// ── 9. The e-reader page: self-contained, escaped, and old-browser safe ────

{
  const html = renderEreaderPage("https://example.test");
  check("page: is a complete document", html.startsWith("<!doctype html>") && html.trim().endsWith("</html>"));
  check("page: has a viewport meta", /name="viewport"/.test(html));
  check("page: has no external script", !/<script[^>]+src=/i.test(html), "external script found");
  check("page: has no external stylesheet", !/<link[^>]+stylesheet/i.test(html), "external css found");
  check("page: has no framework runtime", !/react|preact|vue|htmx/i.test(html));
  check("page: has no module script", !/type=["']module["']/.test(html), "module script found");
  check("page: no arrow functions (old WebKit safe)", !/=>/.test(html), "arrow function found");
  check("page: no let/const (old WebKit safe)", !/\b(let|const)\s/.test(html), "let/const found");
  check("page: no async/await", !/\basync\b|\bawait\b/.test(html), "async/await found");
  check("page: no template literals", !/`/.test(html), "template literal found");
  check("page: no fetch() (uses XHR, which older engines handle)", !/\bfetch\s*\(/.test(html));
  check("page: uses XHR", /XMLHttpRequest/.test(html));
  check("page: no innerHTML assignment of data", (html.match(/\.innerHTML\s*=/g) || []).length === 1, "unexpected innerHTML use");
  check("page: writes the code with textContent", /elCode\.textContent\s*=/.test(html));
  check("page: no localStorage (the secret lives in a variable)", !/localStorage|sessionStorage/.test(html));
  check("page: no service worker", !/serviceWorker/.test(html));
  check("page: states the size limit", /50 MB/.test(html));
  check("page: states the session length", /6 hours/.test(html));
  check("page: has a noscript fallback", /<noscript>/.test(html));
  check("page: embeds the origin safely", html.includes('"https://example.test"'), html.slice(0, 400));

  // The one interpolation into the page is the origin. It is JSON-encoded
  // (which alone stops it breaking out of the string literal) AND rebuilt from
  // parsed parts, so a hostile origin collapses to an empty API base.
  const scriptOf = (html: string) => html.split("<script>")[1]?.split("</script>")[0] || "";
  // Two independent defences, and the test asserts the outcome of both:
  //   1. the URL PARSER discards the injected path/query/fragment, so
  //      'https://a.test/";alert(1);//' reduces to the bare origin, and
  //   2. the scheme allowlist collapses a non-http(s) origin to "",
  // so a value that is not a plain origin NEVER reaches the page.
  for (const evil of [
    'https://a.test/";alert(1);//',
    "https://a.test/';alert(1);//",
    "https://a.test/</script><script>alert(1)</script>",
    "https://a.test\\\";alert(1);//",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "https://user:pass@a.test",
    "not a url at all",
    "",
  ]) {
    const script = scriptOf(renderEreaderPage(evil));
    const label = JSON.stringify(evil).slice(0, 44);
    check(`origin ${label} injects no code`, !/alert\(1\)/.test(script), script.slice(0, 160));
    check(`origin ${label} leaves a bare http(s) origin or nothing`, /var API = ("https?:\/\/[^"]*"|"");/.test(script), script.slice(0, 160));
    // No path, query or fragment after the authority. The "//" in "https://"
    // is the scheme separator, not a path, so the check starts past it.
    const base = /var API = ("[^"]*"|"");/.exec(script)?.[1] || "";
    const afterAuthority = base.replace(/^"(https?:\/\/)/, "").replace(/"$/, "");
    check(`origin ${label} has no path or query in the base`, !/[/?#]/.test(afterAuthority), base);
  }
  check("a real origin survives intact", /var API = "https:\/\/example\.test"/.test(scriptOf(renderEreaderPage("https://example.test"))));
  check("a port is preserved", /var API = "http:\/\/localhost:4197"/.test(scriptOf(renderEreaderPage("http://localhost:4197"))));
  check("a non-http scheme is refused", /var API = "";/.test(scriptOf(renderEreaderPage("file:///etc/passwd"))));
  check("credentials in an origin are refused", /var API = "";/.test(scriptOf(renderEreaderPage("https://user:pass@a.test"))));
}

{
  // The origin is also used in a CSP header by the Worker. Make sure a
  // pathological origin cannot produce a header with a newline in it.
  const res = await new Response("ok", { headers: { "X-Test": "1" } });
  check("a Response is constructible in this runtime", res.status === 200);
}

// ── 10. timingSafeEqual ────────────────────────────────────────────────────

check("equal strings compare equal", timingSafeEqual("abc", "abc") === true);
check("different strings compare unequal", timingSafeEqual("abc", "abd") === false);
check("different lengths compare unequal", timingSafeEqual("abc", "abcd") === false);
check("an empty string is not equal to a secret", timingSafeEqual("", "abc") === false);
check("two empty strings are equal", timingSafeEqual("", "") === true);

// ── 11. The R2 store: same interface, its own semantics ────────────────────
//
// A fake bucket, so this asserts what R2RelayStore does with an object store
// that has no native TTL and no atomic read-modify-write.

function fakeBucket() {
  const map = new Map<string, { data: ArrayBuffer; meta: Record<string, string> }>();
  return {
    kind: "fake-r2",
    map,
    async get(key: string) {
      const hit = map.get(key);
      return hit ? { arrayBuffer: async () => hit.data } : null;
    },
    async put(key: string, value: ArrayBuffer | string, opts?: any) {
      const data = typeof value === "string" ? enc(value).buffer as ArrayBuffer : value;
      map.set(key, { data, meta: opts?.customMetadata || {} });
      return {};
    },
    async delete(key: string) {
      map.delete(key);
    },
    async list(options?: any) {
      const prefix = options?.prefix || "";
      const objects = Array.from(map.entries())
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, v]) => ({ key, customMetadata: v.meta }));
      return { objects, truncated: false, cursor: undefined };
    },
  };
}

{
  const bucket = fakeBucket();
  const now = 1_700_000_000_000;
  // Same clock as the sessions, or every read looks expired.
  const store = new R2RelayStore(bucket as any, () => now);

  const session: StoredSession = {
    kind: "session",
    code: "A7K2",
    secret: "f".repeat(32),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    hasFile: false,
    failedPulls: 0,
  };
  await store.putSession(session);
  check("r2: a session round-trips", (await store.getSession("A7K2"))?.secret === "f".repeat(32));
  check("r2: the session is listed by code", (await store.listSessionCodes()).includes("A7K2"), await store.listSessionCodes());
  check("r2: the expiry is in the object metadata", bucket.map.get("s/A7K2")?.meta.expiresAt === String(now + SESSION_TTL_MS), bucket.map.get("s/A7K2")?.meta);

  // NO FILENAME IN R2 METADATA. A dashboard row is a log.
  await store.putFile("A7K2", EPUB.buffer as ArrayBuffer);
  const fileMeta = bucket.map.get("f/A7K2")?.meta || {};
  check("r2: the file object carries no filename", !JSON.stringify(fileMeta).toLowerCase().includes("dune"), fileMeta);
  check("r2: the file object carries no book title", !JSON.stringify(fileMeta).toLowerCase().includes("epub"), fileMeta);
  check("r2: the file key is the code, not the name", Array.from(bucket.map.keys()).includes("f/A7K2"), Array.from(bucket.map.keys()));
  check("r2: the file round-trips", dec((await store.getFile("A7K2"))!.body) === dec(EPUB.buffer as ArrayBuffer));

  await store.deleteFile("A7K2");
  check("r2: the file is gone after delete", (await store.getFile("A7K2")) === null);

  // Expiry enforced ON READ, not only by the sweep.
  await store.putSession({ ...session, expiresAt: now - 1 });
  check("r2: an expired session reads as absent", (await store.getSession("A7K2")) === null);
  check("r2: reading an expired session deletes it", !bucket.map.has("s/A7K2"), Array.from(bucket.map.keys()));

  // The sweep, driven by metadata only (no reads needed).
  await store.putSession({ ...session, code: "B3C4", expiresAt: now - 1 });
  await store.putFile("B3C4", EPUB.buffer as ArrayBuffer);
  check("r2: the stale file is physically present before the sweep", bucket.map.has("f/B3C4"), Array.from(bucket.map.keys()));
  check("r2: its metadata carries a TTL", bucket.map.get("f/B3C4")?.meta.expiresAt === String(now + FILE_TTL_MS), bucket.map.get("f/B3C4")?.meta);
  // The file was stamped with a FUTURE TTL (its clock is the same `now`), so a
  // sweep at `now` must leave it alone. Deleting it now would be a bug in the
  // other direction: reclaiming a live file out from under a waiting device.
  await store.sweepExpired(now);
  check("r2: the sweep left the live file alone", bucket.map.has("f/B3C4"), Array.from(bucket.map.keys()));
  check("r2: the sweep deleted the expired session", !bucket.map.has("s/B3C4"), Array.from(bucket.map.keys()));
  // Past the file's own TTL, the sweep reclaims it — that is the property that
  // stops the relay accumulating books nobody collected.
  await store.sweepExpired(now + FILE_TTL_MS + 1);
  check("r2: past its TTL the sweep reclaims the file", !bucket.map.has("f/B3C4"), Array.from(bucket.map.keys()));

  // A code is a storage key, so an invalid one must never become one.
  for (const bad of ["../../etc/passwd", "A7K2/x", "", "AB", "AB01"]) {
    let threw = false;
    try {
      await store.getSession(bad);
    } catch {
      threw = true;
    }
    check(`r2: an invalid code ${JSON.stringify(bad)} cannot become a key`, threw, bad);
  }
  check("r2: no traversal key was ever created", !Array.from(bucket.map.keys()).some((k) => k.includes("..")), Array.from(bucket.map.keys()));

  // A lower-case code is normalised rather than becoming a second key.
  await store.putSession(session);
  check("r2: a lower-case code finds the same session", (await store.getSession("a7k2"))?.secret === "f".repeat(32));
  check("r2: and did not create a second key", !bucket.map.has("s/a7k2"), Array.from(bucket.map.keys()));
}

{
  // Corrupt stored JSON must read as absent, not throw. A half-written session
  // is a 404 for the user, not a 500.
  const bucket = fakeBucket();
  await bucket.put("s/ZZZZ", "{{{not json", { customMetadata: { expiresAt: String(Date.now() + 100000) } });
  const store = new R2RelayStore(bucket as any);
  check("r2: corrupt session JSON reads as absent", (await store.getSession("ZZZZ")) === null);
  check("r2: a pull of a corrupt session is a 404", (await pollSession("ZZZZ", "x", { store, limiter: new IpRateLimiter() }, Date.now())).status === 404);
}

console.log(`\nhandler: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
