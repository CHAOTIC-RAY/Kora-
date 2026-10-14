/**
 * Mirror health: content verdicts + a measured RELIABILITY ranking.
 *
 * ── Why a verdict exists at all ─────────────────────────────────────────────
 * "HTTP 200" is meaningless for these mirrors. LibGen's `get.php?md5=..&key=..`
 * is a REDIRECT endpoint: it 307s to a CDN. So a naive probe sees a 200 from the
 * *interstitial page*, or from a PHP fatal-error page, or from an HTML error
 * page, and declares the mirror healthy — while the user downloads a `.php`
 * file or a truncated page and calls it a corrupted book. Production already
 * logged both failure shapes:
 *   - "All libgen mirrors failed (last status 200): Too many subrequests by
 *      single Worker invocation."  ← a 200 that delivered nothing at all.
 *   - users receiving a .php page or a corrupt file instead of the book.
 * So the ONLY trustworthy signal is the leading bytes of the body.
 *
 * ── Why this is a RELIABILITY score and not a trust score ───────────────────
 * The percentage answers exactly one question: "if a user picks this mirror,
 * how likely is it to hand them a real book file?" It says nothing about
 * whether the book is the right edition, whether it is the correct file, or
 * whether the source is legitimate. Never present it as accuracy or trust.
 *
 * ── Why USER OUTCOMES dominate our own probe ────────────────────────────────
 * Our probe is one server's view at one moment: one IP, one DNS resolution, one
 * CDN node, possibly inside the very rate-limit that breaks the real fetch. A
 * user's outcome is ground truth — they have the actual bytes in hand and said
 * whether they could open the book. That is a categorically stronger signal
 * than anything we can measure remotely, so it gets most of the weight, and
 * our probe is a tiebreaker plus the only signal at all for a cold-start
 * mirror nobody has used yet. The exact split lives in RANKING below, named and
 * in one place, because the constants should be retuned once real tallies land.
 */

 // The sibling module owns magic bytes; this module owns what a mirror is worth.
 // Importing its detector is deliberate: one source of truth for "are these
 // bytes a book", so the reader and the ranking can never disagree about it.
 import { detectFormat } from "./formats/detect";

 /** What the bytes actually were. Every one of these is observed, never assumed. */
export type MirrorVerdict =
  /** Real book bytes: EPUB/CBZ ZIP, PDF, MOBI, AZW3. */
  | "real-book"
  /** A web page, not a file. The classic "200 but it's HTML" lie. */
  | "html-page"
  /** A PHP script/error page — the ".php instead of a book" case. */
  | "php-error"
  /** A file that started valid but is structurally broken (bad ZIP / EOF). */
  | "corrupt"
  /** Too few bytes to be a book (an error stub, an empty body). */
  | "too-small"
  /** The mirror bounced us between redirects without settling on a URL. */
  | "redirect-loop"
  /** DNS/TLS/connection failure — no HTTP response at all. */
  | "unreachable"
  /** The mirror is throttling us (429/503/Cloudflare challenge). */
  | "rate-limited"
  /** Client-side: the transfer stopped early. */
  | "interrupted"
  /** Client-side: zero bytes arrived. */
  | "empty"
  /**
   * No verdict was obtained — probe errored, budget exhausted, or the module
   * is absent. NEVER render this as anything better. It is the honest state.
   */
  | "unverified";

/** Verdicts that mean "a real book reached the user". */
const GOOD_VERDICTS: ReadonlySet<MirrorVerdict> = new Set<MirrorVerdict>(["real-book"]);

/**
 * Verdicts a user is allowed to report. `unverified` is deliberately absent:
 * reporting "I could not tell" must not be laundered into a failure against a
 * mirror by a buggy client, and must not be reported as a success either.
 */
export const REPORTABLE_VERDICTS: readonly MirrorVerdict[] = [
  "real-book",
  "html-page",
  "php-error",
  "corrupt",
  "too-small",
  "interrupted",
  "empty",
  "unreachable",
  "rate-limited",
];

export function isReportableVerdict(v: unknown): v is MirrorVerdict {
  return typeof v === "string" && (REPORTABLE_VERDICTS as readonly string[]).includes(v);
}

export function verdictIsGood(v: MirrorVerdict): boolean {
  return GOOD_VERDICTS.has(v);
}

/* ───────────────────────────── content verdict ─────────────────────────── */

/**
 * Formats that count as "the user got a book".
 *
 * Deliberately derived from the sibling detector's vocabulary rather than
 * re-sniffing bytes: `src/lib/formats/detect.ts` owns magic bytes, full stop.
 * `image` is included because a comics mirror legitimately serves a single
 * image, and `cbr`/`cb7` because those are real book containers the reader
 * opens even though `detect.ts` flags them as outside its own supported set.
 */
const READABLE_BOOK_FORMATS: ReadonlySet<string> = new Set([
  "epub",
  "cbz",
  "zip",
  "pdf",
  "cbr",
  "cb7",
  "mobi",
  "image",
]);

/** Bodies shorter than this cannot be a book; they are an error stub. */
export const MIN_BOOK_BYTES = 512;

/**
 * Maps the sibling detector's verdict onto a mirror verdict.
 *
 * There is no second magic-byte table here, and there must never be one: if
 * detection rules change, both the reader and the mirror ranking must move
 * together, and a duplicate table is how they silently diverge.
 *
 * `bytesLength` is threaded in rather than read from module scope so the
 * function stays pure — a module-level "current length" would be corrupted by
 * any interleaved call and is exactly the kind of hidden state that makes a
 * verdict unreproducible in a bug report.
 */
function verdictFromDetection(d: { format: string; rejected: boolean }, bytesLength: number): MirrorVerdict {
  if (READABLE_BOOK_FORMATS.has(d.format) && !d.rejected) {
    return bytesLength < MIN_BOOK_BYTES ? "too-small" : "real-book";
  }
  switch (d.format) {
    case "html":
      return "html-page";
    case "php-error":
      return "php-error";
    case "empty":
      return "too-small";
    case "truncated":
      return "corrupt";
    case "json":
    case "xml":
      return "html-page";
    default:
      return "corrupt";
  }
}

/**
 * Classify the head of a response body into a verdict.
 *
 * This is the function that makes "200" mean something: the leading bytes are
 * the only evidence that decides it, never the status code and never the
 * content-type. A PHP fatal-error page served as `application/octet-stream`
 * and an HTML interstitial served as `application/zip` both land here and
 * both come out rejected.
 *
 * `bytes` is the FIRST CHUNK only — we abort the stream rather than pull a
 * 40 MB EPUB just to test it — so a `truncated` verdict means "the head is not
 * a complete container header", not "the whole file is short".
 */
export function classifyContentBytes(
  bytes: Uint8Array,
  _contentType?: string | null,
  claimedExtension?: string | null
): MirrorVerdict {
  if (!bytes || bytes.length === 0) return "too-small";

  // Size is checked FIRST, before format, because a 4-byte body cannot be a
  // book no matter what it sniffs as. `detectFormat` reports a short body as
  // "text" or "unknown", which mapped to `corrupt` — but a stub of the wrong
  // length is `too-small`, and the UI says something different for each
  // ("the mirror returned an error stub" vs "the transfer was broken").
  if (bytes.length < MIN_BOOK_BYTES) return "too-small";

  try {
    const detection = detectFormat(bytes, claimedExtension);
    return verdictFromDetection(detection, bytes.length);
  } catch (err) {
    // A detector crash must never be reported as a healthy mirror. That would
    // be the exact "200 means it worked" lie this module exists to remove.
    return "unverified";
  }
}

/* ──────────────────────────── storage + decay ──────────────────────────── */

/** How long an observation keeps its full weight. */
export const RANKING = {
  /**
   * Cap on how much of the blend user outcomes can own. The remaining
   * `1 - userOutcomeMaxWeight` is our own probe, which must stay able to pull
   * a mirror down when it starts serving PHP pages even if the last few real
   * user reports were lucky.
   */
  userOutcomeMaxWeight: 0.85,

  /**
   * Smooth saturation: the weight a signal has at this much decayed evidence.
   * User outcomes reach ~63% of their max weight after 1 weighted report and
   * asymptote, so one report cannot dominate but a handful clearly can.
   */
  userEvidenceSaturation: 1.6,
  probeEvidenceSaturation: 1.2,

  /**
     * Confidence ceiling for a mirror with NO user history.
     *
     * Why this exists, and why it is a ceiling on the PROBE signal specifically:
     * a cold-start mirror that our probe scored perfectly used to reach 100% and
     * outrank a mirror with nine real user downloads behind it. That inverts the
     * entire premise of the ranking — "nobody has ever used this" is weaker
     * evidence than "nine people used it and got a real book", yet it was
     * scoring higher. Our probe is one server's view at one moment, possibly
     * inside the very rate-limit that breaks the real fetch, so it can never
     * confirm a mirror as strongly as a person actually receiving the file.
     *
     * It is a ceiling on CONFIDENCE, not a penalty: a probe-only mirror still
     * ranks above an unprobed one (0.8 vs 0.5), it just cannot claim the top
     * slot over real evidence. Raise it once real tallies exist.
     */
    probeOnlyConfidence: 0.6,

    /**
     * Time decay, in days to HALF weight.
   *
   * User outcomes decay slower than probes on purpose: one person's real
   * experience is a stronger claim than our momentary fetch, so it should
   * survive longer before being discounted. But both decay — a mirror that was
   * perfect last month and has since started serving PHP pages MUST fall.
   */
  userHalfLifeDays: 21,
  probeHalfLifeDays: 7,

  /**
   * Abuse resistance. One IP's contribution to a host's tally is capped at
   * `spamBurstCap` weighted reports per `spamWindowHours`, so a hostile caller
   * cannot bury a good mirror under a spam burst of fake failures, nor prop up
   * a broken one with fake successes. Extra reports in the window are recorded
   * as ignored rather than counted.
   */
  spamBurstCap: 3,
  spamWindowHours: 24,

  /** Below this much evidence we refuse to print a percentage at all. */
  minEvidenceForPercent: 0.6,
} as const;

/**
 * Decay bookkeeping.
 *
 * `good`/`bad` are weights expressed RELATIVE TO `asOf` — the instant those
 * weights were last brought up to date. Every read re-bases them from `asOf`
 * forward to "now", so a tally nobody has touched in a month still decays
 * correctly without anything having to run in the background.
 *
 * An earlier version tried to decay at insertion time AND again on read, which
 * double-counted the decay: a 90-day-old record lost its weight twice, fell
 * below the "not enough evidence" floor, and became `null` — i.e. UNVERIFIED.
 * That silently erased a known-good mirror from the ranking entirely instead
 * of merely lowering its certainty, which is the "no data must not read as bad"
 * rule violated in the other direction. Decay belongs on read only.
 */
export interface OutcomeTally {
  /** Decay-weighted successes, relative to `asOf`. */
  good: number;
  /** Decay-weighted failures, relative to `asOf`. */
  bad: number;
  /** Raw (undecayed) counts, for honest provenance copy. */
  rawGood: number;
  rawBad: number;
  /** Newest observation timestamp, ms epoch. 0 = never observed. */
  lastAt: number;
  /** Instant `good`/`bad` were last re-based. */
  asOf: number;
}

export function emptyTally(): OutcomeTally {
  return { good: 0, bad: 0, rawGood: 0, rawBad: 0, lastAt: 0, asOf: 0 };
}

function halfLifeWeight(halfLifeDays: number, ageMs: number): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / (halfLifeDays * 86_400_000));
}

/** Re-base a tally's weights from its own `asOf` forward to `now`. Idempotent. */
export function decayTally(tally: OutcomeTally, now: number, halfLifeDays: number): OutcomeTally {
  if (!tally.asOf || !tally.lastAt) return tally;
  const w = halfLifeWeight(halfLifeDays, now - tally.asOf);
  return { ...tally, good: tally.good * w, bad: tally.bad * w, asOf: now };
}

/**
 * Fold one observation into a tally.
 *
 * `observedAt` is when the mirror actually misbehaved; `now` is when we are
 * folding it in. They differ for anything replayed from a cache or a queue,
 * and conflating them lets a month-old report count at full weight.
 */
export function addOutcome(
  tally: OutcomeTally,
  verdict: MirrorVerdict,
  observedAt: number,
  halfLifeDays: number,
  now: number
): OutcomeTally {
  const rebased = decayTally(tally, now, halfLifeDays);
  const w = halfLifeWeight(halfLifeDays, Math.max(0, now - observedAt));
  const good = verdictIsGood(verdict);
  return {
    good: rebased.good + w * (good ? 1 : 0),
    bad: rebased.bad + w * (good ? 0 : 1),
    rawGood: rebased.rawGood + (good ? 1 : 0),
    rawBad: rebased.rawBad + (good ? 0 : 1),
    lastAt: Math.max(rebased.lastAt || 0, observedAt),
    asOf: now,
  };
}

export interface MirrorHealthRecord {
  host: string;
  user: OutcomeTally;
  probe: OutcomeTally;
  /** Newest probe verdict, for display of *why* a probe passed or failed. */
  lastProbeVerdict?: MirrorVerdict;
  lastProbeReason?: string;
  lastProbeAt?: number;
}

export interface MirrorScore {
  host: string;
  /** 0..1 measured reliability, or null when there is no evidence to rank on. */
  score: number | null;
  /** Rounded percentage for display; null means UNVERIFIED. */
  percent: number | null;
  /** "user" | "probe" | "both" | "none" — which signals produced the number. */
  basis: "user" | "probe" | "both" | "none";
  /** Weight given to real user outcomes, 0..1. */
  userWeight: number;
  user: OutcomeTally;
  probe: OutcomeTally;
}

/** Smooth 0..1 saturation curve. */
const saturate = (strength: number, halfPoint: number) =>
  strength <= 0 ? 0 : strength / (strength + halfPoint);

/**
 * Blend user outcomes with our own probe into one reliability number.
 *
 * Returns `score: null` when neither signal has any evidence — the caller MUST
 * then render UNVERIFIED. An unknown mirror must never sort as though it were
 * good; that is the failure mode of every "just show a number" ranking.
 */
export function scoreMirror(record: MirrorHealthRecord, now: number): MirrorScore {
  const user = decayTally(record.user, now, RANKING.userHalfLifeDays);
  const probe = decayTally(record.probe, now, RANKING.probeHalfLifeDays);

  const userStrength = user.good + user.bad;
  const probeStrength = probe.good + probe.bad;

  // Existence of evidence is judged on RAW counts, never on decayed weight.
  // Decay is meant to lower a mirror's CERTAINTY, not to make its history
  // vanish: a mirror that served real books all last month has evidence, and
  // a stale-but-real record that became `null` would read as UNVERIFIED and
  // silently drop out of the ranking.
  const hasUserEvidence = user.rawGood + user.rawBad > 0;
  const hasProbeEvidence = probe.rawGood + probe.rawBad > 0;

  const base = { host: record.host, user, probe };

  if (!hasUserEvidence && !hasProbeEvidence) {
    return { ...base, score: null, percent: null, basis: "none", userWeight: 0 };
  }

  // How much of the blend the user's real experience gets, saturating with
  // accumulated evidence so a single report cannot swing the ranking.
  const userWeight =
    RANKING.userOutcomeMaxWeight * saturate(userStrength, RANKING.userEvidenceSaturation);

  // Success rate of each signal, pulled back toward a neutral prior as its
  // evidence decays.
  //
  // This regression is the whole decay mechanism. Holding the observed RATE
  // fixed and only shrinking the weight would leave a 6-month-old perfect
  // record pinned at 100% forever — exactly the "an old perfect record must
  // not pin a now-broken mirror to the top" failure. Instead an observation
  // whose weight has decayed toward zero carries the score toward 0.5 (we
  // know nothing), so it can neither endorse nor condemn a mirror.
  const rateToward = (
    good: number,
    strength: number,
    halfLifePoint: number,
    confidence = 1
  ): number => {
    if (strength <= 0) return NEUTRAL_PRIOR;
    const certainty = saturate(strength, halfLifePoint) * confidence;
    return NEUTRAL_PRIOR + certainty * (good / strength - NEUTRAL_PRIOR);
  };

  const userRate = rateToward(user.good, userStrength, RANKING.userEvidenceSaturation);

  // A mirror with no user history cannot be confirmed as strongly by our probe
  // as by a person actually receiving the file, so its probe-only score is
  // pulled toward neutral by `probeOnlyConfidence`. Without this, a
  // never-used-but-perfectly-probed mirror scores higher than one with nine
  // confirmed real user downloads — the exact inversion the brief rules out.
  const probeRate = rateToward(
    probe.good,
    probeStrength,
    RANKING.probeEvidenceSaturation,
    hasUserEvidence ? 1 : RANKING.probeOnlyConfidence
  );

  const score = userWeight * userRate + (1 - userWeight) * probeRate;

  const basis: MirrorScore["basis"] =
    hasUserEvidence && hasProbeEvidence ? "both" : hasUserEvidence ? "user" : "probe";

  return {
    ...base,
    score,
    percent: Math.round(score * 100),
    basis,
    userWeight,
  };
}

/**
 * "We have no idea" is not 0% and not 100% — it is the midpoint. A mirror that
 * has never been checked sits at 0.5, which is what lets a genuinely
 * well-evidenced bad mirror (0.1) rank below it and a well-evidenced good one
 * (0.9) rank above it.
 */
const NEUTRAL_PRIOR = 0.5;

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * Build the sentence that explains the number. Provenance is never hidden: a
 * bare percentage the user cannot interrogate is a lie by omission.
 */
export function describeScore(s: MirrorScore): string {
  if (s.percent === null || s.score === null) {
    return s.basis === "none"
      ? "unverified — no downloads recorded yet"
      : "unverified — not enough data yet";
  }
  const pct = `${s.percent}%`;
  const userPart = s.user.rawGood + s.user.rawBad > 0
    ? `${plural(s.user.rawGood, "recent download")} ${s.user.rawGood === 1 ? "was" : "were"} a valid book` +
      (s.user.rawBad > 0 ? `, ${plural(s.user.rawBad, "download was", "downloads were")} not` : "")
    : "";

  if (s.basis === "probe") {
    return `${pct} — ${plural(s.probe.rawGood, "probe")} confirmed real file bytes, no user reports yet`;
  }
  if (s.basis === "user") {
    return `${pct} — ${userPart} (no recent probe data)`;
  }
  return `${pct} — ${userPart}; ${plural(s.probe.rawGood, "probe")} confirmed real file bytes`;
}

/** Badge text for the number. Deliberately says RELIABILITY, never "trust". */
export function reliabilityBadge(s: MirrorScore): string {
  if (s.percent === null) return "Unverified";
  return `Reliability ${s.percent}%`;
}

/**
 * Order mirrors best-first, with a deterministic, explainable tie-break.
 *
 * Rule: evidence beats absence. A mirror with no history sorts BELOW a mirror
 * with any evidence, even a bad one — "we don't know" must not masquerade as
 * "this one is fine". Within evidence, higher score wins.
 */
export function compareMirrorScores(a: MirrorScore, b: MirrorScore): number {
  const aHas = a.score !== null;
  const bHas = b.score !== null;
  if (aHas !== bHas) return aHas ? -1 : 1;
  if (aHas && bHas && b.score !== a.score) return (b.score as number) - (a.score as number);
  return a.host.localeCompare(b.host);
}

/**
 * Rank mirrors against a host→record map. Unknown hosts get an explicit
 * "no record" entry so they surface as UNVERIFIED instead of vanishing.
 *
 * A host that will not normalise (no dot, a bare label) is STILL RANKED, under
 * its literal text, as UNVERIFIED. An earlier version dropped those, which
 * silently removed a mirror from the sheet entirely — the precise
 * "something went wrong and the UI just doesn't show it" failure this feature
 * is supposed to make impossible. Storage keys are validated separately and
 * strictly by `readOutcomePayload`; a display key never needs to be.
 */
export function rankMirrors(hosts: string[], records: Map<string, MirrorHealthRecord>, now: number): MirrorScore[] {
  const seen = new Set<string>();
  const out: MirrorScore[] = [];
  for (const raw of hosts) {
    const normalized = normalizeHost(raw);
    const key = normalized || (raw || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const rec = records.get(key);
    out.push(
      rec
        ? scoreMirror(rec, now)
        : {
            host: key,
            score: null,
            percent: null,
            basis: "none" as const,
            userWeight: 0,
            user: emptyTally(),
            probe: emptyTally(),
          }
    );
  }
  return out.sort(compareMirrorScores);
}

/**
 * True when `host` is a syntactically valid public DNS name.
 *
 * The dots-only allowance in the charset is what makes this non-obvious: a
 * naive `/^[a-z0-9.-]+$/` accepts `..` and `....`, and `normalizeHost` reduces
 * `../../etc/passwd` to exactly `..` (it splits on `/`). That value is then
 * used as a storage key, so an unauthenticated caller could aim writes at a
 * traversal path. Hence the explicit rule: a real hostname has at least one
 * letter, no label may be empty, and no label may start or end with a dot.
 */
export function isValidPublicHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false; // a bare label is not a resolvable FQDN
  return labels.every((l) => l.length > 0 && l.length <= 63 && !l.startsWith(".") && !l.endsWith("."));
}

/**
 * Host key for a mirror URL — a LibGen 307 lands on the real CDN host, so the
 * CDN is what gets ranked, not the LibGen front end.
 *
 * Returns "" for anything that is not a valid hostname, so callers can treat
 * an unusable value as "no host" rather than storing garbage under it.
 */
export function normalizeHost(urlOrHost: string): string {
  const raw = (urlOrHost || "").trim().toLowerCase();
  if (!raw) return "";
  let host = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      return "";
    }
  } else {
    // A bare host, possibly carrying a port and/or a stray path.
    host = raw.replace(/^www\./, "").split("/")[0].split(":")[0].split("?")[0];
  }
  host = host.replace(/^www\./, "");
  return isValidPublicHost(host) ? host : "";
}