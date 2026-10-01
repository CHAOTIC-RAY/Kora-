/**
 * Per-host mirror reliability, measured on THIS device.
 *
 * WHY THIS EXISTS
 * ---------------
 * The download sheet has always rendered a reliability percentage, and the
 * number it read came from `GET /api/mirror-health`, which is backed by a
 * per-isolate in-memory Map on the Worker. Two independent facts made that
 * number permanently unavailable:
 *
 *   1. Nothing ever WROTE to it. `recordUserOutcome` had no call site in the
 *      download paths, so every host sat at zero attempts forever.
 *   2. Even with writers, an in-memory Map is not durable. It resets on every
 *      isolate recycle, and it is per-region and per-deploy — so it cannot be
 *      the thing a single user's sheet is ordered by.
 *
 * So the authoritative tally is kept HERE, on the device that actually
 * performed the downloads, persisted in localStorage. The Worker endpoint is
 * still reported to (it powers aggregate health for probing and for the
 * RANKING weights), but the percentage the user sees is built only from this
 * device's real attempts. Nothing is seeded, guessed or defaulted.
 *
 * WHAT THE PERCENTAGE MEANS — the exact definition, so it is not
 * misrepresented in the UI:
 *
 *      percent = (attempts that ended in a VALIDATED REAL BOOK)
 *                / (all recorded attempts) * 100
 *
 * counted as failures (they are attempts, and the mirror caused them):
 *      html-page, php-error, corrupt, too-small, empty, unreachable,
 *      identity-mismatch, wrong-format
 * NOT counted at all (they measure the user or the network, not the mirror):
 *      interrupted, rate-limited
 *
 * `identity-mismatch` is the important one. A mirror that returns a real EPUB
 * of the WRONG book is a hard failure: serving the wrong book is worse than
 * serving nothing, and it must count against the host.
 *
 * A host with zero attempts has `percent === null`. It is NEVER rendered as 0%
 * and NEVER rendered as 100%. It reads "not measured yet".
 */

/** Verdicts that count against a host's score. */
const FAILING: readonly MirrorVerdict[] = [
  "html-page",
  "php-error",
  "corrupt",
  "too-small",
  "empty",
  "unreachable",
  "identity-mismatch",
  "wrong-format",
];

/**
 * Verdicts that are deliberately NOT recorded. An interrupted download means
 * the user closed the app, and a rate-limit means the host is throttling under
 * load — neither is evidence about the mirror's honesty, and folding them in
 * would punish good hosts for the user's actions or for a busy hour.
 */
const IGNORED: readonly MirrorVerdict[] = ["interrupted", "rate-limited"];

export type MirrorVerdict =
  | "real-book"
  | "html-page"
  | "php-error"
  | "corrupt"
  | "too-small"
  | "empty"
  | "unreachable"
  | "rate-limited"
  | "interrupted"
  | "identity-mismatch"
  | "wrong-format";

/** How many attempts we keep per host, so one host cannot grow the store forever. */
const MAX_ATTEMPTS_PER_HOST = 40;
/** Cap on distinct hosts tracked, oldest-evicted first. */
const MAX_HOSTS = 60;

export const RELIABILITY_STORAGE_KEY = "kora_mirror_reliability_v1";

export interface HostRecord {
  /** Every counted attempt, oldest first. "real-book" or a failing verdict. */
  attempts: MirrorVerdict[];
  /** Epoch ms of the most recent counted attempt. */
  lastAt: number;
  /**
   * Set when the most recent attempt returned a valid book of the WRONG
   * identity. Kept separate from the score so the sheet can label the specific
   * mirror "wrong book" rather than merely "failing".
   */
  lastMismatch: { requested: string; delivered: string; at: number } | null;
}

export interface ReliabilityEntry {
  host: string;
  /** null when there are no counted attempts. See the definition above. */
  percent: number | null;
  attempts: number;
  successes: number;
  failures: number;
  badge: string;
  reason: string;
  /** True when this host last served a valid file of the wrong book. */
  mismatched: boolean;
  lastMismatch: HostRecord["lastMismatch"];
}

export type ReliabilityStore = Record<string, HostRecord>;

/** Normalised host, or "" when the URL cannot yield one. */
export function hostOf(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    // A bare word with no dot is not a host (it is a relative path or junk).
    return h && h.includes(".") ? h : "";
  } catch {
    return "";
  }
}

function emptyStore(): ReliabilityStore {
  return {};
}

function readStore(): ReliabilityStore {
  if (typeof localStorage === "undefined") return emptyStore();
  try {
    const raw = localStorage.getItem(RELIABILITY_STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyStore();
    const out: ReliabilityStore = {};
    for (const [host, rec] of Object.entries(parsed as Record<string, unknown>)) {
      if (!host || !rec || typeof rec !== "object") continue;
      const r = rec as Partial<HostRecord>;
      // Keep successes AND failures; drop anything unrecognised so a
      // hand-edited or schema-drifted value can never count as an attempt.
      const all = Array.isArray(r.attempts)
        ? r.attempts.filter(
            (a): a is MirrorVerdict =>
              typeof a === "string" &&
              (a === "real-book" || (FAILING as readonly string[]).includes(a))
          )
        : [];
      out[host] = {
        attempts: all.slice(-MAX_ATTEMPTS_PER_HOST),
        lastAt: typeof r.lastAt === "number" ? r.lastAt : 0,
        lastMismatch:
          r.lastMismatch && typeof r.lastMismatch.requested === "string"
            ? {
                requested: r.lastMismatch.requested,
                delivered: String(r.lastMismatch.delivered ?? ""),
                at: typeof r.lastMismatch.at === "number" ? r.lastMismatch.at : 0,
              }
            : null,
      };
    }
    return out;
  } catch {
    // A corrupt store must never break the sheet. Start clean rather than
    // showing a fabricated score.
    return emptyStore();
  }
}

function writeStore(store: ReliabilityStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    // Evict the least-recently-seen hosts so a long-lived install cannot grow
    // this without bound.
    const hosts = Object.keys(store);
    if (hosts.length > MAX_HOSTS) {
      hosts
        .sort((a, b) => (store[a].lastAt || 0) - (store[b].lastAt || 0))
        .slice(0, hosts.length - MAX_HOSTS)
        .forEach((h) => delete store[h]);
    }
    localStorage.setItem(RELIABILITY_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* Quota or private mode. In-memory tally still works for this session. */
  }
}

/** Cached in-memory copy so ordering does not re-parse localStorage per row. */
let cache: ReliabilityStore | null = null;
function store(): ReliabilityStore {
  if (cache === null) cache = readStore();
  return cache;
}

/** Test seam: drop the in-memory cache so the next read comes from storage. */
export function __resetReliabilityCache(): void {
  cache = null;
}

/**
 * Record one real download attempt against its host.
 *
 * Returns the resulting entry, or null when nothing was recorded (ignored
 * verdict, or a URL with no host). Reporting a *failure* is just as important
 * as reporting a success — a host that only ever records wins would read 100%
 * and be trusted forever.
 */
export function recordMirrorOutcome(
  url: string,
  verdict: MirrorVerdict | null | undefined,
  mismatch?: { requested: string; delivered: string } | null
): ReliabilityEntry | null {
  if (!verdict) return null;
  if ((IGNORED as readonly string[]).includes(verdict)) return null;
  const host = hostOf(url);
  if (!host) return null;

  const s = store();
  const rec = s[host] || { attempts: [], lastAt: 0, lastMismatch: null };
  rec.attempts.push(verdict);
  if (rec.attempts.length > MAX_ATTEMPTS_PER_HOST) {
    rec.attempts = rec.attempts.slice(-MAX_ATTEMPTS_PER_HOST);
  }
  rec.lastAt = Date.now();
  if (verdict === "identity-mismatch") {
    rec.lastMismatch = {
      requested: mismatch?.requested || "",
      delivered: mismatch?.delivered || "",
      at: Date.now(),
    };
  } else if (verdict === "real-book") {
    // A good delivery clears the mismatch flag; it is a statement about the
    // LAST attempt, not a permanent stain on the host.
    rec.lastMismatch = null;
  }
  s[host] = rec;
  writeStore(s);
  return entryFor(host);
}

function badgeFor(percent: number | null, attempts: number): string {
  if (percent === null) return "Not measured";
  if (attempts < 3) return `${percent}% · ${attempts} try`;
  return `${percent}%`;
}

function reasonFor(percent: number | null, rec: HostRecord, host: string): string {
  if (percent === null) {
    return "Not measured yet — no download attempt from this mirror on this device.";
  }
  const n = rec.attempts.length;
  if (rec.lastMismatch) {
    return `Last download returned a DIFFERENT book (asked for "${rec.lastMismatch.requested}", got "${rec.lastMismatch.delivered}"). Not used.`;
  }
  const s = rec.attempts.filter((a) => a === "real-book").length;
  return `${s} validated download${s === 1 ? "" : "s"} from ${host} out of ${n} attempt${n === 1 ? "" : "s"}.`;
}

/** The reliability entry for one host, or null when the host is unknown. */
export function entryFor(host: string): ReliabilityEntry | null {
  if (!host) return null;
  const rec = store()[host];
  if (!rec || rec.attempts.length === 0) {
    return {
      host,
      percent: null,
      attempts: 0,
      successes: 0,
      failures: 0,
      badge: "Not measured",
      reason: "Not measured yet — no download attempt from this mirror on this device.",
      mismatched: false,
      lastMismatch: null,
    };
  }
  const n = rec.attempts.length;
  const successes = rec.attempts.filter((a) => a === "real-book").length;
  const percent = Math.round((successes / n) * 100);
  return {
    host,
    percent,
    attempts: n,
    successes,
    failures: n - successes,
    badge: badgeFor(percent, n),
    reason: reasonFor(percent, rec, host),
    mismatched: !!rec.lastMismatch,
    lastMismatch: rec.lastMismatch,
  };
}

/** Convenience: the entry for a mirror URL. */
export function reliabilityForUrl(url: string): ReliabilityEntry | null {
  const host = hostOf(url);
  return host ? entryFor(host) : null;
}

/**
 * Best-first ordering by MEASURED reliability.
 *
 * - Hosts with attempts sort by their real percentage, highest first.
 * - Unmeasured hosts sort to the BOTTOM. "We don't know" must never be
 *   presented as though it were good, but the user must still be able to try
 *   one, so they are kept rather than hidden.
 * - Within a band the incoming order is preserved, so rows with no evidence
 *   are never reshuffled among themselves.
 * - A host whose last attempt was a wrong book is pushed below other measured
 *   hosts regardless of its average, because serving the wrong book is the
 *   failure mode that actually hurts.
 */
export function orderByReliability<T>(mirrors: T[], urlOf: (m: T) => string): T[] {
  return mirrors
    .map((m, i) => {
      const host = hostOf(urlOf(m) || "");
      const e = host ? entryFor(host) : null;
      return { m, i, percent: e ? e.percent : null, mismatched: !!(e && e.mismatched) };
    })
    .sort((a, b) => {
      if (a.mismatched !== b.mismatched) return a.mismatched ? 1 : -1;
      const av = a.percent === null ? -1 : a.percent;
      const bv = b.percent === null ? -1 : b.percent;
      if (av !== bv) return bv - av;
      return a.i - b.i;
    })
    .map((x) => x.m);
}
