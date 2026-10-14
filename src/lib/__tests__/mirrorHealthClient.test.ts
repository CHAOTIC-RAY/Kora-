/**
 * Client-side mirror health tests — caching, honesty, and the no-extra-request
 * budget.
 *
 * The properties that matter here are contractual, not cosmetic:
 *   - a failed health fetch produces UNVERIFIED for everything, never a fake pass
 *   - the user can always download, whatever the health state
 *   - one request covers many mirrors (the subrequest budget)
 *   - the payload carries host + verdict and nothing identifying
 */
import {
  __resetHealthCache,
  emptySnapshot,
  fetchMirrorHealth,
  HEALTH_CACHE_TTL_MS,
  orderMirrorsByHealth,
  reliabilityTone,
  reportMirrorOutcome,
} from "../mirrorHealthClient";

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

/* ── fake fetch harness ──────────────────────────────────────────────────── */

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let nextResponse: (() => any) | null = null;
let beacons: Array<{ url: string; data: string }> = [];

(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  const r = nextResponse ? nextResponse() : { ok: true, status: 200, json: async () => ({ mirrors: [] }) };
  return r as any;
};
// `navigator` is a getter-only global in modern Node, so it has to be defined
// rather than assigned.
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  writable: true,
  value: {
    sendBeacon: (url: string, blob: any) => {
      // The real payload is a Blob; awaiting its text is what actually gets
      // sent, so the stub must do the same rather than stringify "[object Blob]".
      if (blob && typeof blob.text === "function") {
        blob.text().then((t: string) => beacons.push({ url, data: t }));
      } else {
        beacons.push({ url, data: String(blob) });
      }
      return true;
    },
  },
});
const reset = () => {
  calls = [];
  beacons = [];
  nextResponse = null;
  __resetHealthCache();
};

const MIRRORS = [
  "https://libgen.li/get.php?md5=abc&key=k",
  "https://booksdl.lc/dl/book.epub",
  "https://archive.org/download/x/y.epub",
];

/* ── one request for many mirrors ────────────────────────────────────────── */

reset();
nextResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    mirrors: [
      { host: "libgen.li", percent: 92, badge: "Reliability 92%", basis: "user", reason: "92% — 12 of 13 recent downloads were a valid book", userWeight: 0.78, userGood: 12, userBad: 1, probeGood: 2, probeBad: 0, verified: true },
      { host: "booksdl.lc", percent: 40, badge: "Reliability 40%", basis: "user", reason: "40% — 2 of 5 recent downloads were a valid book", userWeight: 0.6, userGood: 2, userBad: 3, probeGood: 1, probeBad: 1, verified: true },
      { host: "archive.org", percent: null, badge: "Unverified", basis: "none", reason: "unverified — no downloads recorded yet", userWeight: 0, userGood: 0, userBad: 0, probeGood: 0, probeBad: 0, verified: false },
    ],
    skipped: 0,
  }),
});
const snap = await fetchMirrorHealth(MIRRORS);
ok("one request covers ALL mirror hosts", calls.length === 1, { requests: calls.length });
ok("every host is sent in a single hosts param", (calls[0]?.url.match(/hosts=/g) || []).length === 1, calls[0]?.url);
ok("the response is keyed by host", snap.byHost.get("libgen.li")?.percent === 92, snap.byHost.get("libgen.li"));
ok("a loaded snapshot reports loaded", snap.loaded === true);

/* Cached: a second call costs nothing. */
await fetchMirrorHealth(MIRRORS);
ok("a second fetch within the TTL issues no new request", calls.length === 1, { requests: calls.length });
ok("the cache TTL is positive and sane", HEALTH_CACHE_TTL_MS > 0 && HEALTH_CACHE_TTL_MS <= 60 * 60 * 1000, HEALTH_CACHE_TTL_MS);

/* Duplicate URLs collapse to one host. */
reset();
nextResponse = () => ({ ok: true, status: 200, json: async () => ({ mirrors: [] }) });
await fetchMirrorHealth([...MIRRORS, ...MIRRORS]);
ok("duplicate mirror URLs do not multiply hosts", (calls[0]?.url.match(/url%3A/g) || []).length === 3, calls[0]?.url);

/* ── the honesty contract ────────────────────────────────────────────────── */

/* A 500 from the health endpoint must mean UNVERIFIED everywhere. */
reset();
nextResponse = () => ({ ok: false, status: 500, json: async () => ({}) });
const failed = await fetchMirrorHealth(MIRRORS);
ok("a failed health fetch is NOT loaded", failed.loaded === false);
ok("a failed health fetch yields no host data at all", failed.byHost.size === 0, [...failed.byHost.keys()]);
ok("a failed health fetch explains itself", /unavailable/i.test(failed.note || ""), failed.note);

/* A network throw must behave the same way. */
reset();
(globalThis as any).fetch = async () => {
  throw new Error("offline");
};
const threw = await fetchMirrorHealth(MIRRORS);
ok("a thrown fetch is not loaded", threw.loaded === false);
ok("a thrown fetch explains itself", /could not be reached/i.test(threw.note || ""), threw.note);

/* An empty snapshot is unverified, not verified. */
const empty = emptySnapshot();
ok("an empty snapshot is unverified", empty.loaded === false && empty.byHost.size === 0);
ok("an empty snapshot has no skipped count", empty.skipped === 0);

/* Bad/hostile host values never reach the store. */
reset();
(globalThis as any).fetch = async (url: string) => {
  calls.push({ url });
  return { ok: true, status: 200, json: async () => ({ mirrors: [] }) } as any;
};
await fetchMirrorHealth(["not-a-url", "ftp://x/y", "javascript:alert(1)", ...MIRRORS]);
const sent = decodeURIComponent(calls[0]?.url || "");
ok("non-http mirror urls are dropped before the request", !/javascript|ftp|not-a-url/.test(sent), sent.slice(0, 120));

/* ── ordering ────────────────────────────────────────────────────────────── */

const rows = [
  { id: "unknown", percent: null },
  { id: "good", percent: 92 },
  { id: "bad", percent: 20 },
  { id: "mid", percent: 60 },
];
const ordered = orderMirrorsByHealth(rows, (r) => r.percent).map((r) => r.id);
ok("verified mirrors order best-first", ordered.slice(0, 3).join(",") === "good,mid,bad", ordered);
ok("the UNVERIFIED mirror sorts LAST, not first and not hidden", ordered[3] === "unknown", ordered);
ok("every mirror is still present (nothing is hidden)", ordered.length === rows.length, ordered);

/* An all-unverified list keeps its original order — we must not imply a
   ranking we do not have. */
const flat = orderMirrorsByHealth([{ id: "a" }, { id: "b" }, { id: "c" }], () => null).map((r) => r.id);
ok("an all-unverified list preserves source order", flat.join(",") === "a,b,c", flat);

/* Ties preserve source order too. */
const tied = orderMirrorsByHealth([{ id: "x", p: 50 }, { id: "y", p: 50 }], (r) => r.p).map((r) => r.id);
ok("equal scores preserve source order", tied.join(",") === "x,y", tied);

/* ── presentation tone ───────────────────────────────────────────────────── */

ok("a null percent renders as the muted 'unknown' tone", reliabilityTone(null).text.includes("muted"));
ok("a high percent renders green", /emerald/.test(reliabilityTone(95).text));
ok("a middling percent renders amber", /amber/.test(reliabilityTone(70).text));
ok("a low percent renders red", /red/.test(reliabilityTone(20).text));

/* ── outcome reporting: privacy + fire-and-forget ────────────────────────── */

reset();
reportMirrorOutcome("https://libgen.li/get.php?md5=abc&key=k", "real-book");
await new Promise((r) => setTimeout(r, 0)); // let the Blob resolve
ok("an outcome is sent via sendBeacon", beacons.length === 1, beacons.length);
const sentBody = beacons[0]?.data || "";
ok("the payload contains the host", /libgen\.li/.test(sentBody), sentBody);
ok("the payload contains only host and verdict", (() => {
  try {
    const parsed = JSON.parse(sentBody);
    return Object.keys(parsed).sort().join(",") === "host,verdict";
  } catch {
    return false;
  }
})(), sentBody);
ok("the payload sends NO title, filename, author, isbn or size", !/title|filename|author|isbn|size|name/i.test(sentBody), sentBody);

/* No verdict -> no request at all. An absent measurement must never be
   laundered into a success or a failure. */
reset();
reportMirrorOutcome("https://libgen.li/get.php?md5=abc", null);
ok("a null verdict sends nothing", beacons.length === 0, beacons.length);
ok("a missing url sends nothing", (reportMirrorOutcome("", "real-book"), beacons.length === 0));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);