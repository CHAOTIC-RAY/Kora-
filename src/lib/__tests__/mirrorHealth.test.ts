/**
 * Mirror health tests — content verdicts, the reliability blend, and abuse
 * resistance.
 *
 * The load-bearing claims, each of which has been a real production bug:
 *   1. A 200 that returns HTML or PHP is NOT a working mirror.
 *   2. Real user outcomes outrank our own probe.
 *   3. "No data" reads UNVERIFIED and sorts below anything with evidence.
 *   4. An old perfect record decays, so a now-broken mirror falls.
 *   5. A spam burst cannot move a score past the per-IP cap.
 *   6. The outcome payload cannot carry a title, an author, or a weight.
 */
import {
  addOutcome,
  classifyContentBytes,
  describeScore,
  emptyTally,
  normalizeHost,
  rankMirrors,
  reliabilityBadge,
  RANKING,
  scoreMirror,
  type MirrorHealthRecord,
  type MirrorVerdict,
} from "../mirrorHealth";
import {
  MemoryMirrorStore,
  readOutcomePayload,
  recordUserOutcome,
  type IpAllowance,
} from "../mirrorHealthStore";

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

/* ───────────────────────── content classification ───────────────────────── */

const enc = new TextEncoder();

/** A real EPUB's leading bytes: local file header + the `mimetype` entry. */
const EPUB_BYTES = (() => {
  const zipLocalHeader = new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00,
  ]);
  const mimetype = enc.encode("mimetypeapplication/epub+zip");
  const out = new Uint8Array(zipLocalHeader.length + mimetype.length + 900);
  out.set(zipLocalHeader, 0);
  out.set(mimetype, zipLocalHeader.length);
  return out;
})();

const CBZ_BYTES = (() => {
  const zipLocalHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
  const name = enc.encode("0001.jpg");
  const out = new Uint8Array(1400);
  out.set(zipLocalHeader, 0);
  out.set(name, zipLocalHeader.length);
  return out;
})();

const PDF_BYTES = (() => {
  const out = new Uint8Array(1400);
  out.set(enc.encode("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"), 0);
  return out;
})();

const MOBI_BYTES = (() => {
  const out = new Uint8Array(1400);
  out.set(enc.encode("BOOKMOBI"), 60);
  return out;
})();

const HTML_BYTES = enc.encode(
  "<!DOCTYPE html><html><head><title>LibGen</title></head><body>Please wait...</body></html>" +
    "x".repeat(600)
);
const PHP_BYTES = enc.encode("<?php // get.php\n die('No such file'); ?>" + "x".repeat(600));
const PHP_FATAL_BYTES = enc.encode(
  "<br />\n<b>Fatal error</b>:  Uncaught Error: Call to undefined function in /ads.php:12\n" + "x".repeat(600)
);
const TINY_BYTES = enc.encode("nope");

ok("ZIP magic + mimetype entry classifies real-book", classifyContentBytes(EPUB_BYTES) === "real-book", classifyContentBytes(EPUB_BYTES));
ok("ZIP of images classifies real-book", classifyContentBytes(CBZ_BYTES) === "real-book", classifyContentBytes(CBZ_BYTES));
ok("%PDF- classifies real-book", classifyContentBytes(PDF_BYTES) === "real-book", classifyContentBytes(PDF_BYTES));
ok("BOOKMOBI at offset 60 classifies real-book", classifyContentBytes(MOBI_BYTES) === "real-book", classifyContentBytes(MOBI_BYTES));
ok("<!DOCTYPE html> classifies html-page", classifyContentBytes(HTML_BYTES) === "html-page", classifyContentBytes(HTML_BYTES));
ok("<?php body classifies php-error", classifyContentBytes(PHP_BYTES) === "php-error", classifyContentBytes(PHP_BYTES));
ok("PHP fatal error page classifies php-error", classifyContentBytes(PHP_FATAL_BYTES) === "php-error", classifyContentBytes(PHP_FATAL_BYTES));
ok("tiny stub classifies too-small", classifyContentBytes(TINY_BYTES) === "too-small", classifyContentBytes(TINY_BYTES));
ok("empty body classifies too-small", classifyContentBytes(new Uint8Array(0)) === "too-small", classifyContentBytes(new Uint8Array(0)));
ok("leading whitespace then <html is html-page", classifyContentBytes(enc.encode("\n\n  <html><body>err</body></html>" + "x".repeat(600))) === "html-page");

/* The headline bug: a 200 is not a verdict. */
const junkWithZipContentType = classifyContentBytes(HTML_BYTES, "application/zip");
ok("200-with-HTML is NOT real-book even when content-type says zip", junkWithZipContentType !== "real-book", junkWithZipContentType);
ok("200-with-HTML reads html-page regardless of content-type", junkWithZipContentType === "html-page", junkWithZipContentType);
const phpWithOctetContentType = classifyContentBytes(PHP_BYTES, "application/octet-stream");
ok("200-with-PHP is NOT real-book even when content-type says octet-stream", phpWithOctetContentType !== "real-book", phpWithOctetContentType);

/* The verdict comes from src/lib/formats/detect.ts — one magic-byte table. */
ok(
  "all-zero junk is never real-book",
  classifyContentBytes(new Uint8Array(1400)) !== "real-book",
  classifyContentBytes(new Uint8Array(1400))
);
ok(
  "no content-type can turn a junk 200 into a verified book",
  [undefined, "application/epub+zip", "application/pdf", "text/html", "application/zip"].every(
    (ct) => classifyContentBytes(HTML_BYTES, ct) !== "real-book"
  )
);

/* ─────────────────────────── ranking fixtures ───────────────────────────── */

const NOW = Date.UTC(2026, 0, 15);
const DAY = 86_400_000;

function tally(verdicts: MirrorVerdict[], at: number, halfLife: number) {
  return verdicts.reduce((t, v) => addOutcome(t, v, at, halfLife, at), emptyTally());
}
function rec(host: string, user: MirrorVerdict[] = [], probe: MirrorVerdict[] = [], at = NOW): MirrorHealthRecord {
  return {
    host,
    user: tally(user, at, RANKING.userHalfLifeDays),
    probe: tally(probe, at, RANKING.probeHalfLifeDays),
  };
}

/* Mirror A: many real users got valid books. Mirror B: we probed, all good,
   but no user has ever used it. A must outrank B. */
const A = scoreMirror(rec("a.host", ["real-book", "real-book", "real-book", "real-book"], ["real-book", "real-book"]), NOW);
const B = scoreMirror(rec("b.host", [], ["real-book", "real-book", "php-error"]), NOW);
ok("mirror with real user successes outranks probe-only mirror", (A.score as number) > (B.score as number), { A: A.score, B: B.score });
ok("user outcomes carry more weight than the probe does", A.userWeight > B.userWeight, { A: A.userWeight, B: B.userWeight });
ok("user weight never exceeds the documented cap", A.userWeight <= RANKING.userOutcomeMaxWeight + 1e-9, A.userWeight);
ok("A's basis includes user outcomes", A.basis === "both", A.basis);
ok("A carries a percentage", typeof A.percent === "number", A.percent);

/* User failures must sink a mirror BELOW a probe-verified unknown. The whole
   point of the change: our probe missed what users actually experienced. */
const C = scoreMirror(rec("c.host", ["php-error", "php-error", "html-page", "php-error"], ["real-book"]), NOW);
ok("mirror whose users got php pages sinks below probe-verified unknown", (C.score as number) < (B.score as number), { C: C.score, B: B.score });
ok("sunk mirror still shows a number (it has evidence)", typeof C.percent === "number", C.percent);

/* A host that will not normalise must still APPEAR, as UNVERIFIED. Dropping it
   silently removed a mirror from the sheet, which is the exact failure this
   feature exists to prevent. */
const oddHosts = rankMirrors(["bare-host", "a.real.host"], new Map(), NOW);
ok("a host that will not normalise is still ranked, not dropped", oddHosts.length === 2, oddHosts.length);
ok("a bare host reads unverified", oddHosts.some((o) => o.host === "bare-host" && o.percent === null), oddHosts);

/* No history reads UNVERIFIED and sorts below any evidence. */
const UNKNOWN = scoreMirror(rec("unknown.host"), NOW);
ok("no history has no score", UNKNOWN.score === null, UNKNOWN.score);
ok("no history has no percentage", UNKNOWN.percent === null, UNKNOWN.percent);
ok("no history basis is none", UNKNOWN.basis === "none", UNKNOWN.basis);
ok("no history badge says Unverified", reliabilityBadge(UNKNOWN) === "Unverified", reliabilityBadge(UNKNOWN));
ok("no history copy says unverified", /unverified/i.test(describeScore(UNKNOWN)), describeScore(UNKNOWN));

const ordered = rankMirrors(["unknown.host", "b.host", "a.host", "c.host"], new Map([
  ["a.host", rec("a.host", ["real-book", "real-book", "real-book"], ["real-book"])],
  ["b.host", rec("b.host", [], ["real-book", "real-book", "php-error"])],
  ["c.host", rec("c.host", ["php-error", "php-error"], ["real-book"])],
]), NOW);
ok(
  "rankMirrors orders best-first and puts the unknown LAST",
  ordered.map((o) => o.host).join(",") === "a.host,b.host,c.host,unknown.host",
  ordered.map((o) => o.host)
);
ok("the unknown is still clickable — it is returned, not dropped", ordered.length === 4, ordered.length);
ok("the unknown is labelled unverified", ordered[3].percent === null, ordered[3]);

/* THE INVERSION GUARD.
   A never-used mirror with a perfect probe must NOT outrank a mirror with real
   user downloads behind it. This failed once: probe-only reached 90% while a
   mirror with nine confirmed real downloads reached 85%, because the probe had
   no user evidence to be discounted by. It is asserted explicitly because it
   is the single most important ordering property in the feature. */
const PERFECT_PROBE_ONLY = scoreMirror(rec("probe-only.host", [], ["real-book", "real-book", "real-book", "real-book", "real-book"]), NOW);
const NINE_REAL_DOWNLOADS = scoreMirror(
  rec("nine.host", ["real-book", "real-book", "real-book", "real-book", "real-book", "real-book", "real-book", "real-book", "real-book", "html-page"], ["real-book", "real-book", "real-book"]),
  NOW
);
ok(
  "a perfect probe-only mirror does NOT outrank real user evidence",
  (PERFECT_PROBE_ONLY.score as number) < (NINE_REAL_DOWNLOADS.score as number),
  { probeOnly: PERFECT_PROBE_ONLY.percent, realUsers: NINE_REAL_DOWNLOADS.percent }
);
ok(
  "probe-only confidence is capped below certainty",
  (PERFECT_PROBE_ONLY.score as number) < 0.85,
  PERFECT_PROBE_ONLY.percent
);
ok(
  "a probe-only mirror still ranks above an unprobed one",
  (PERFECT_PROBE_ONLY.score as number) > 0.5,
  PERFECT_PROBE_ONLY.percent
);

/* Probe-only copy must SAY it is probe-only, not imply user evidence. */
ok("probe-only copy names the probe", /probe/i.test(describeScore(B)), describeScore(B));
ok("probe-only copy admits there are no user reports", /no user reports/i.test(describeScore(B)), describeScore(B));
ok("probe-only basis is probe", B.basis === "probe", B.basis);

/* Provenance is always visible alongside the number. */
ok("user-bearing copy names the downloads", /download/i.test(describeScore(A)), describeScore(A));
ok("copy never claims accuracy or trust", !/\b(accuracy|trust|authentic)\b/i.test(describeScore(A) + describeScore(B) + describeScore(UNKNOWN)), describeScore(A));
ok("badge says Reliability not Trust", /Reliability/.test(reliabilityBadge(A)) && !/Trust/.test(reliabilityBadge(A)), reliabilityBadge(A));

/* ───────────────────────────── decay ────────────────────────────────────── */

/* A mirror that was perfect 90 days ago and has since started serving PHP
   pages must fall below one that is merely good. */
const STALE = Date.UTC(2025, 9, 17); // ~90 days before NOW
const stale = scoreMirror(rec("stale.host", ["real-book", "real-book", "real-book", "real-book"], ["real-book"], STALE), NOW);
const freshGood = scoreMirror(rec("fresh.host", ["real-book", "real-book", "real-book", "real-book"], ["real-book"], NOW), NOW);
ok("decay drops a stale perfect record below a fresh one", (stale.score as number) < (freshGood.score as number), { stale: stale.score, fresh: freshGood.score });

/* The decisive case: a mirror good long ago, now broken, falls below a
   recently-failing one. */
const wasGoodNowBroken = scoreMirror(
  { host: "broke.host", user: tally(["real-book", "real-book", "real-book", "real-book"], STALE, RANKING.userHalfLifeDays), probe: emptyTally() },
  NOW
);
const longBroken = scoreMirror(
  { host: "longbroke.host", user: tally(["php-error", "php-error", "php-error", "php-error"], STALE, RANKING.userHalfLifeDays), probe: emptyTally() },
  NOW
);
/* Two EQUALLY stale records must land in near-parity: after enough decay we
   genuinely cannot tell them apart, and pretending otherwise would be the same
   overclaiming the module exists to avoid. The meaningful claim — "good last
   month, PHP pages now" — is asserted separately below with RECENT failures,
   which is the case that actually has to move the number. */
ok(
  "two equally stale records decay to near-parity rather than a false ranking",
  Math.abs((wasGoodNowBroken.score as number) - (longBroken.score as number)) < 0.05,
  { wasGood: wasGoodNowBroken.score, longBroken: longBroken.score }
);
ok(
  "an equally stale record sits near neutral, not at either extreme",
  (wasGoodNowBroken.score as number) > 0.45 && (wasGoodNowBroken.score as number) < 0.55,
  wasGoodNowBroken.score
);
/* An old record that has since seen real failures must fall hard. */
const decayedThenFailed = scoreMirror(
  {
    host: "d.host",
    user: (["real-book", "real-book", "real-book", "php-error"] as MirrorVerdict[]).reduce(
      (t, v, i) => addOutcome(t, v, i < 3 ? STALE : NOW - DAY, RANKING.userHalfLifeDays, NOW),
      emptyTally()
    ),
    probe: emptyTally(),
  },
  NOW
);
ok("recent real failures outweigh old successes after decay", (decayedThenFailed.score as number) < 0.6, decayedThenFailed.score);

/* A stale record is still EVIDENCE. Decay lowers certainty; it must not delete
   a mirror's history and quietly relabel a known-good mirror as UNVERIFIED. */
ok("a stale record is still evidence, not unverified", stale.percent !== null && stale.basis !== "none", stale.basis);
ok("a stale perfect record regresses toward neutral, never staying at 100%", (stale.score as number) < 1, stale.score);

/* The case the brief names: good last month, serving PHP pages now. */
const brokeLater = scoreMirror(
  {
    host: "broke.host",
    user: (["real-book", "real-book", "real-book", "real-book", "php-error", "php-error"] as MirrorVerdict[]).reduce(
      (t, v, i) => addOutcome(t, v, i < 4 ? STALE : NOW - 2 * DAY, RANKING.userHalfLifeDays, NOW),
      emptyTally()
    ),
    probe: emptyTally(),
  },
  NOW
);
ok("an old perfect record cannot pin a since-broken mirror to the top", (brokeLater.score as number) < 0.5, brokeLater.score);
ok("a since-broken mirror ranks below a freshly-good one", (brokeLater.score as number) < (freshGood.score as number), {
  broke: brokeLater.score,
  fresh: freshGood.score,
});

/* ─────────────────────────── privacy + spam ─────────────────────────────── */

const clean = readOutcomePayload({ host: "libgen.li", verdict: "real-book" });
ok("valid payload accepted", clean?.host === "libgen.li" && clean?.verdict === "real-book", clean);
ok(
  "payload DROPS title/author/filename — no identifying metadata is retained",
  (() => {
    const p = readOutcomePayload({ host: "libgen.li", verdict: "real-book", title: "Dune", author: "Frank Herbert", filename: "dune.epub", isbn: "9780441013593", size: 12345 }) as unknown as Record<string, unknown>;
    return Object.keys(p).sort().join(",") === "host,verdict";
  })(),
  readOutcomePayload({ host: "libgen.li", verdict: "real-book", title: "Dune" })
);
ok(
  "payload DROPS caller-supplied weight/count/timestamp overrides",
  (() => {
    const p = readOutcomePayload({ host: "libgen.li", verdict: "real-book", weight: 1000, count: 999, at: 0, trust: true }) as unknown as Record<string, unknown>;
    return Object.keys(p).sort().join(",") === "host,verdict";
  })()
);
ok("non-host payload rejected", readOutcomePayload({ verdict: "real-book" }) === null);
ok("unreportable verdict rejected", readOutcomePayload({ host: "a.host", verdict: "definitely-fine" }) === null);
ok("'unverified' cannot be reported as a failure", readOutcomePayload({ host: "a.host", verdict: "unverified" }) === null);
ok("non-string host rejected", readOutcomePayload({ host: { toString: () => "a.host" }, verdict: "real-book" }) === null);
ok("host with path traversal rejected", readOutcomePayload({ host: "../../etc/passwd", verdict: "real-book" }) === null);

/* Per-IP burst cap. */
const spamStore = new MemoryMirrorStore();
const spamAllow: Map<string, IpAllowance> = new Map();
const hostileIp = "203.0.113.9";
let accepted = 0;
for (let i = 0; i < 40; i++) {
  const r = await recordUserOutcome(spamStore, spamAllow, { host: "good.host", verdict: "php-error" }, hostileIp, NOW);
  if (r.accepted) accepted++;
}
ok("hostile IP's accepted reports are capped at the burst cap", accepted === RANKING.spamBurstCap, { accepted, cap: RANKING.spamBurstCap });
const afterSpam = (await spamStore.get("good.host")) as MirrorHealthRecord;
ok("only the capped number of failures were recorded", afterSpam?.user.rawBad === RANKING.spamBurstCap, afterSpam?.user.rawBad);

/* The load-bearing abuse claim: reports 4..40 must be INERT, not merely
   smaller. If 40 fake failures scored differently from the 3 the cap allows,
   the cap would be a speed bump rather than a ceiling. */
const scoreAfter40 = scoreMirror(afterSpam, NOW).score as number;
const justCap = new MemoryMirrorStore();
const justCapAllow: Map<string, IpAllowance> = new Map();
for (let i = 0; i < RANKING.spamBurstCap; i++) {
  await recordUserOutcome(justCap, justCapAllow, { host: "good.host", verdict: "php-error" }, hostileIp, NOW);
}
const scoreAfter3 = scoreMirror((await justCap.get("good.host")) as MirrorHealthRecord, NOW).score as number;
ok("reports beyond the cap are completely inert — score is unchanged", scoreAfter40 === scoreAfter3, { after40: scoreAfter40, after3: scoreAfter3 });

/* Fake SUCCESSES are capped identically, so spam cannot prop up a dead mirror. */
const inflateStore = new MemoryMirrorStore();
const inflateAllow: Map<string, IpAllowance> = new Map();
for (let i = 0; i < 30; i++) {
  await recordUserOutcome(inflateStore, inflateAllow, { host: "dead.host", verdict: "real-book" }, hostileIp, NOW);
}
const inflated = (await inflateStore.get("dead.host")) as MirrorHealthRecord;
ok("fake successes are capped too", inflated.user.rawGood === RANKING.spamBurstCap, inflated.user.rawGood);

/* A separate IP is not collaterally limited, so real users are unaffected. */
const otherIp = await recordUserOutcome(spamStore, spamAllow, { host: "good.host", verdict: "real-book" }, "198.51.100.7", NOW);
ok("a different IP is not blocked by the spammer's cap", otherIp.accepted, otherIp);

/* The cap expires: after the window a new report is accepted again. */
const later = NOW + RANKING.spamWindowHours * 3_600_000 + 1000;
const afterWindow = await recordUserOutcome(spamStore, spamAllow, { host: "good.host", verdict: "real-book" }, hostileIp, later);
ok("cap expires after the window", afterWindow.accepted, afterWindow);

/* ───────────────────────────── host keys ────────────────────────────────── */

ok("normalizeHost extracts the host from a get.php URL", normalizeHost("https://libgen.li/get.php?md5=ABC&key=K") === "libgen.li", normalizeHost("https://libgen.li/get.php?md5=ABC&key=K"));
ok("normalizeHost strips www and port", normalizeHost("https://www.booksdl.lc:443/x.epub") === "booksdl.lc", normalizeHost("https://www.booksdl.lc:443/x.epub"));
ok("normalizeHost accepts a bare host", normalizeHost("Archive.ORG") === "archive.org", normalizeHost("Archive.ORG"));
ok("normalizeHost on junk is junk, not a throw", normalizeHost("") === "", normalizeHost(""));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);