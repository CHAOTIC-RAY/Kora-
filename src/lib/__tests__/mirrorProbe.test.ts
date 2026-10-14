/**
 * Mirror probe tests — run against a REAL local HTTP server.
 *
 * These are not mocks of `fetch`: a real server on 127.0.0.0 sends real bytes
 * over a real socket, so the redirect handling, the streaming head-read and the
 * body cancellation are all genuinely exercised. The classification claims are
 * the entire point of this feature ("a 200 that is really an HTML page"), and
 * asserting them against a hand-built Response object would only prove that the
 * code does what the mock said, which is not evidence of anything.
 *
 * The one exception is the SSRF guard: 127.0.0.1 is private by design, so the
 * probe refuses it. `probeMirrorUrl` therefore accepts an injectable guard
 * override for local testing — which is itself worth asserting, because an
 * override that leaked into production would be a hole.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { probeMirrorUrl, MAX_REDIRECT_HOPS, PROBE_CHUNK_BYTES } from "../mirrorProbe";

let pass = 0,
  fail = 0;
const ok = (n: string, c: boolean, got?: unknown) => {
  if (c) {
    pass++;
    console.log("PASS ", n);
  } else {
    fail++;
    console.log("FAIL ", n, got === undefined ? "" : `-> ${JSON.stringify(got)}`);
  }
};

/* ── real payloads ───────────────────────────────────────────────────────── */

const enc = new TextEncoder();
const EPUB = (() => {
  const h = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
  const m = enc.encode("mimetypeapplication/epub+zip");
  const out = new Uint8Array(h.length + m.length + 900);
  out.set(h, 0);
  out.set(m, h.length);
  return Buffer.from(out);
})();
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"), Buffer.alloc(1400)]);
const HTML = Buffer.from(
  "<!DOCTYPE html><html><head><title>LibGen</title></head><body>Redirecting…</body></html>" + "x".repeat(700)
);
const PHP = Buffer.from("<?php // get.php\n die('No such file'); ?>" + "x".repeat(700));
const PHP_FATAL = Buffer.from("<b>Fatal error</b>: Uncaught Error in /ads.php:12\n" + "x".repeat(700));

type Route = { status?: number; headers?: Record<string, string>; body?: Buffer | string };

let server: Server;
let base = "";
const routes = new Map<string, Route | (() => Route)>();

function serve(req: IncomingMessage, res: import("node:http").ServerResponse) {
  const path = (req.url || "/").split("?")[0];
  const r = routes.get(path);
  if (!r) {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end("<html>no route</html>");
    return;
  }
  const route = typeof r === "function" ? r() : r;
  const headers = route.headers || {};
  res.writeHead(route.status || 200, { "Content-Type": "application/octet-stream", ...headers });
  if (route.body === undefined) res.end();
  else res.end(route.body);
}

await new Promise<void>((resolve) => {
  server = createServer(serve);
  server.listen(0, "127.0.0.1", () => resolve());
});
base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

/**
 * Local testing override. It exists because 127.0.0.1 is a private address
 * and the production guard is right to refuse it; swapping it here lets the
 * rest of the probe be tested against real sockets.
 */
const localOpts = {
  guardOverride: (u: string) => {
    try {
      return { ok: true, parsed: new URL(u) };
    } catch {
      return { ok: false, reason: "Invalid URL." };
    }
  },
} as const;

const probe = (pathOrUrl: string) => probeMirrorUrl(pathOrUrl.startsWith("http") ? pathOrUrl : base + pathOrUrl, localOpts);

/* ── the four headline cases, over real sockets ─────────────────────────── */

routes.set("/book.epub", { body: EPUB, headers: { "Content-Type": "application/epub+zip" } });
routes.set("/book.pdf", { body: PDF, headers: { "Content-Type": "application/pdf" } });
routes.set("/page.html", { body: HTML, headers: { "Content-Type": "text/html" } });
routes.set("/get.php", { body: PHP, headers: { "Content-Type": "application/octet-stream" } });
routes.set("/fatal.php", { body: PHP_FATAL, headers: { "Content-Type": "text/html" } });

const good = await probe("/book.epub");
ok("real EPUB bytes over the wire classify real-book", good.verdict === "real-book", good);
ok("probe reports the final URL", good.finalUrl.endsWith("/book.epub"), good.finalUrl);
ok("probe reports the content-type", good.contentType === "application/epub+zip", good.contentType);
ok("probe reports bytesSeen", good.bytesSeen > 0, good.bytesSeen);
ok("probe reports the status", good.httpStatus === 200, good.httpStatus);
ok("a good mirror gets no probeError", good.probeError === undefined, good.probeError);

const pdf = await probe("/book.pdf");
ok("real PDF bytes classify real-book", pdf.verdict === "real-book", pdf.verdict);

/* The production bug, reproduced end to end. */
const html = await probe("/page.html");
ok("a 200 that is really an HTML page is html-page, NOT real-book", html.verdict === "html-page", html.verdict);
ok("the HTML 200 still reports status 200 — proving status alone lied", html.httpStatus === 200, html.httpStatus);

const php = await probe("/get.php");
ok("a 200 that is really a PHP script is php-error", php.verdict === "php-error", php.verdict);
const fatal = await probe("/fatal.php");
ok("a PHP fatal error page is php-error", fatal.verdict === "php-error", fatal.verdict);

/* ── HTML disguised as a book ────────────────────────────────────────────── */

routes.set("/liar.epub", { body: HTML, headers: { "Content-Type": "application/epub+zip" } });
const liar = await probe("/liar.epub");
ok("HTML served as application/epub+zip is still refused", liar.verdict === "html-page", liar.verdict);

/* ── redirects: the LibGen get.php -> CDN shape ─────────────────────────── */

/* Distinct paths, because the test server keys routes on pathname only and a
   real `get.php?md5=` URL would collide with the /get.php route above. */
routes.set("/signed-ok.php", { status: 307, headers: { Location: "/cdn/book.epub" } });
routes.set("/cdn/book.epub", { body: EPUB, headers: { "Content-Type": "application/epub+zip" } });
routes.set("/signed-bad.php", { status: 307, headers: { Location: "/cdn/bad.php" } });
routes.set("/cdn/bad.php", { body: PHP, headers: { "Content-Type": "application/octet-stream" } });

const redirected = await probe("/signed-ok.php");
ok("a 307 to a real CDN resolves to real-book", redirected.verdict === "real-book", redirected.verdict);
ok("the final URL is the post-redirect CDN URL", redirected.finalUrl.endsWith("/cdn/book.epub"), redirected.finalUrl);
ok("the hop count is reported", redirected.hops === 1, redirected.hops);

const redirectedJunk = await probe("/signed-bad.php");
ok("a 307 to a PHP page is php-error, NOT real-book", redirectedJunk.verdict === "php-error", redirectedJunk.verdict);
ok("the junk redirect still reports the CDN final URL", redirectedJunk.finalUrl.endsWith("/cdn/bad.php"), redirectedJunk.finalUrl);

/* An endless redirect chain must be reported as such, not as unreachable. */
routes.set("/loop", () => ({ status: 302, headers: { Location: "/loop" } }));
const loop = await probe("/loop");
ok("an endless redirect chain is redirect-loop", loop.verdict === "redirect-loop", loop.verdict);
ok("the loop stops at the hop budget", loop.hops === MAX_REDIRECT_HOPS + 1, loop.hops);

/* ── status handling ─────────────────────────────────────────────────────── */

routes.set("/gone", { status: 404, body: HTML });
ok("a 404 HTML page is html-page", (await probe("/gone")).verdict === "html-page");
routes.set("/limited", { status: 429, body: Buffer.from("slow down") });
ok("a 429 is rate-limited", (await probe("/limited")).verdict === "rate-limited", (await probe("/limited")).verdict);
routes.set("/busy", { status: 503, body: Buffer.from("busy") });
ok("a 503 is rate-limited", (await probe("/busy")).verdict === "rate-limited");
routes.set("/empty", { status: 200, body: Buffer.alloc(0) });
ok("an empty 200 is too-small", (await probe("/empty")).verdict === "too-small", (await probe("/empty")).verdict);

/* ── the head-read really stops early ───────────────────────────────────── */

/* 5 MB of EPUB-ish body: the probe must read a fraction of it, or it is not a
   probe but a download. */
routes.set("/huge.epub", {
  body: Buffer.concat([EPUB, Buffer.alloc(5 * 1024 * 1024, 0x41)]),
  headers: { "Content-Type": "application/epub+zip" },
});
const huge = await probe("/huge.epub");
ok("a 5MB body still classifies real-book", huge.verdict === "real-book", huge.verdict);
ok(
  "the probe reads only a head chunk, never the whole file",
  huge.bytesSeen <= PROBE_CHUNK_BYTES,
  { bytesSeen: huge.bytesSeen, cap: PROBE_CHUNK_BYTES }
);

/* ── the guard, and the override ─────────────────────────────────────────── */

/* With the PRODUCTION guard (no override) a private address must be refused. */
const guarded = await probeMirrorUrl(base + "/book.epub");
ok("the production guard refuses a private/link-local address", guarded.verdict === "unverified", guarded.verdict);
ok("the refusal is reported as blocked", guarded.probeError === "blocked", guarded.probeError);
ok("a blocked probe reads zero bytes", guarded.bytesSeen === 0, guarded.bytesSeen);
ok("a blocked probe never claims a book", guarded.verdict !== "real-book", guarded.verdict);

for (const bad of [
  "http://169.254.169.254/latest/meta-data/",
  "http://10.0.0.1/x.epub",
  "http://192.168.1.1/x.epub",
  "http://172.16.5.5/x.epub",
  "http://127.0.0.1:8080/x.epub",
  "http://[::1]/x.epub",
  "file:///etc/passwd",
]) {
  const r = await probeMirrorUrl(bad);
  ok(`probe refuses ${bad}`, r.verdict === "unverified" && r.probeError === "blocked", r.verdict);
}

/* An unreachable public host must be `unreachable`, which the UI shows
   differently from "serves junk" — the brief requires telling them apart. */
const dead = await probeMirrorUrl("https://kora-nonexistent-mirror-probe-test.invalid/book.epub");
ok("a dead host is unreachable, not unverified", dead.verdict === "unreachable", dead.verdict);
ok("an unreachable mirror is distinguishable from junk", dead.verdict !== "html-page" && dead.verdict !== "php-error", dead.verdict);
ok("an unreachable probe reports a network error", dead.probeError === "network" || dead.probeError === "timeout", dead.probeError);

/* ── every verdict carries a human-readable reason ───────────────────────── */

for (const [path, expect] of [
  ["/book.epub", "real-book"],
  ["/page.html", "html-page"],
  ["/get.php", "php-error"],
  ["/gone", "html-page"],
  ["/limited", "rate-limited"],
  ["/empty", "too-small"],
] as const) {
  const r = await probe(path);
  ok(`${expect} carries a reason string`, typeof r.reason === "string" && r.reason.length > 8, r.reason);
}

await new Promise<void>((resolve) => server.close(() => resolve()));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);