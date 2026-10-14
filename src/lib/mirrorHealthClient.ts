/**
 * Client side of mirror health: fetch the ranking once, report outcomes after
 * the fact, and never make the user wait on either.
 *
 * ── WHY THE REQUEST BUDGET IS ONE ───────────────────────────────────────────
 * Cloudflare allows 50 subrequests per invocation and this Worker has already
 * been killed by that limit in production. So:
 *   - Health is fetched ONCE per sheet open, for ALL mirror hosts at once, via
 *     a single `GET /api/mirror-health?hosts=…` — not one request per mirror.
 *   - The response is cached in module scope with a TTL, so re-opening the
 *     sheet does not re-probe.
 *   - Outcome reporting is fire-and-forget via `sendBeacon`, which rides along
 *     with page unload and adds no request the user is waiting on.
 * Neither adds a round-trip that multiplies per download.
 *
 * ── THE HONESTY CONTRACT ────────────────────────────────────────────────────
 * If the fetch fails, every mirror is reported as UNVERIFIED. It is never
 * rendered as verified, and it never disables the download button: validation
 * is advisory, and the user can always try. A cancelled or failed validation
 * is surfaced as a failure, never as a silent pass.
 */

/** How long a fetched ranking is reused before we ask again. */
export const HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;

export interface MirrorHealthEntry {
  host: string;
  /** null = UNVERIFIED. Never invented. */
  percent: number | null;
  badge: string;
  basis: "user" | "probe" | "both" | "none";
  /** Provenance sentence, e.g. "92% — 12/13 recent downloads were a valid book". */
  reason: string;
  userWeight: number;
  userGood: number;
  userBad: number;
  probeGood: number;
  probeBad: number;
  verified: boolean;
}

export interface MirrorHealthSnapshot {
  /** Keyed by host. */
  byHost: Map<string, MirrorHealthEntry>;
  /** False when the fetch itself failed — every entry is then UNVERIFIED. */
  loaded: boolean;
  /** Mirrors we could not check because of the server-side probe budget. */
  skipped: number;
  /** A short, user-facing note about why health may be incomplete. */
  note?: string;
  fetchedAt: number;
}

export function emptySnapshot(reason?: string): MirrorHealthSnapshot {
  return {
    byHost: new Map(),
    loaded: false,
    skipped: 0,
    note: reason,
    fetchedAt: 0,
  };
}

let cached: MirrorHealthSnapshot | null = null;
let inFlight: Promise<MirrorHealthSnapshot> | null = null;

/** Test seam: drop the memoised snapshot so each test starts cold. */
export function __resetHealthCache(): void {
  cached = null;
  inFlight = null;
}

/**
 * Fetch health for a set of mirror URLs (hosts are derived from the URLs).
 *
 * Deduplicated in-flight: two components asking at once share one request.
 */
export async function fetchMirrorHealth(
  urls: string[],
  opts: { force?: boolean } = {}
): Promise<MirrorHealthSnapshot> {
  const now = Date.now();
  if (!opts.force && cached && now - cached.fetchedAt < HEALTH_CACHE_TTL_MS) return cached;
  if (inFlight) return inFlight;

  const hosts: string[] = [];
  const params = new URLSearchParams();
  for (const u of urls) {
    const host = hostOf(u);
    if (!host || hosts.includes(host)) continue;
    hosts.push(host);
    // The Worker needs a URL to probe; it cannot invent one from a host.
    params.append(`url:${host}`, u);
  }
  if (hosts.length === 0) return (cached = emptySnapshot());

  params.set("hosts", hosts.join(","));

  inFlight = (async () => {
    try {
      const res = await fetch(`/api/mirror-health?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        // Reported, not hidden. The UI shows UNVERIFIED for every mirror.
        return (cached = emptySnapshot(`Mirror checks are unavailable right now (HTTP ${res.status}).`));
      }
      const data = await res.json();
      const byHost = new Map<string, MirrorHealthEntry>();
      for (const m of data.mirrors || []) {
        if (m && typeof m.host === "string") byHost.set(m.host, m as MirrorHealthEntry);
      }
      const snap: MirrorHealthSnapshot = {
        byHost,
        loaded: true,
        skipped: typeof data.skipped === "number" ? data.skipped : 0,
        note:
          data.skipped > 0
            ? `${data.skipped} mirror${data.skipped === 1 ? "" : "s"} could not be checked in time.`
            : undefined,
        fetchedAt: Date.now(),
      };
      return (cached = snap);
    } catch (err: any) {
      // Never a fake success: an unreachable health endpoint means every
      // mirror reads UNVERIFIED, and the user can still download.
      return (cached = emptySnapshot("Mirror checks could not be reached."));
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Report what actually happened when a download completed.
 *
 * `verdict` MUST come from `src/lib/formats/detect.ts` running over the bytes
 * the user received — that is the ground truth this whole feature ranks on.
 * If no detector result is available, pass `null` and NOTHING is reported: an
 * absent measurement must not be laundered into either a success or a failure.
 *
 * Payload is `{host, verdict}` only — see the privacy note in
 * mirrorHealthStore.ts. No title, filename, author, ISBN, size or user id.
 */
export function reportMirrorOutcome(
  mirrorUrl: string,
  verdict: "real-book" | "html-page" | "php-error" | "corrupt" | "too-small" | "interrupted" | "empty" | "unreachable" | "rate-limited" | null
): boolean {
  const host = hostOf(mirrorUrl);
  if (!host || !verdict) return false;
  const body = JSON.stringify({ host, verdict });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // 64 KB is far more than a ~60 byte body.
      return navigator.sendBeacon("/api/mirror-outcome", new Blob([body], { type: "application/json" }));
    }
  } catch {
    /* fall through to fetch */
  }
  try {
    void fetch("/api/mirror-outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* Reporting is best-effort and must never surface as a user error. */
    });
    return true;
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return h && h.includes(".") ? h : "";
  } catch {
    return "";
  }
}

/**
 * Presentation helpers, kept beside the fetch so the sheet and the card cannot
 * drift into describing the same number differently.
 */

/** Tailwind classes for the reliability badge. */
export function reliabilityTone(percent: number | null): { text: string; bg: string } {
  if (percent === null) return { text: "text-kindle-text-muted", bg: "bg-kindle-border/30" };
  if (percent >= 85) return { text: "text-emerald-600", bg: "bg-emerald-500/10" };
  if (percent >= 60) return { text: "text-amber-600", bg: "bg-amber-500/10" };
  return { text: "text-red-500", bg: "bg-red-500/10" };
}

/**
 * Best-first ordering for the sheet.
 *
 * Verified mirrors come first, ordered by measured reliability. Unverified
 * mirrors sort to the BOTTOM rather than being hidden: "we don't know" must not
 * be shown as though it were good, but the user must always be able to try one.
 * Within each band the pre-existing order is preserved as the tiebreak, so this
 * never reshuffles rows that have no evidence either way.
 */
export function orderMirrorsByHealth<T>(mirrors: T[], healthOf: (m: T) => number | null): T[] {
  return mirrors
    .map((m, i) => ({ m, i, p: healthOf(m) }))
    .sort((a, b) => {
      const av = a.p === null ? -1 : a.p;
      const bv = b.p === null ? -1 : b.p;
      if (av !== bv) return bv - av;
      return a.i - b.i;
    })
    .map((x) => x.m);
}