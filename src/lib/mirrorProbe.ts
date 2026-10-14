/**
 * The mirror probe: fetch the FIRST CHUNK of a mirror URL and say what it is.
 *
 * Lives outside worker.ts so it can be unit-tested against a real local HTTP
 * server — the classification claims ("a 200 that is really an HTML page") are
 * only worth anything if they were proven against actual bytes.
 *
 * WHY READ ONLY THE HEAD
 * A probe exists to answer "would this download hand the user a book?". Pulling
 * a 40 MB EPUB to find out costs the user 40 MB of their mobile data and costs
 * us a subrequest that may well time out. The leading bytes carry the whole
 * verdict: every real container (ZIP/EPUB, PDF, MOBI, RAR, images) announces
 * itself in the first few dozen bytes, and so does every failure mode
 * (HTML, PHP, JSON error).
 *
 * WHY REDIRECTS ARE FOLLOWED MANUALLY
 * LibGen's `get.php?md5=..&key=..` 307s to a CDN. With `redirect: "follow"`
 * the Worker resolves that internally, and the intermediate hop — which is
 * often exactly the thing serving the bad page — becomes invisible. Following
 * by hand means every hop is validated against the SSRF guard AND recorded, so
 * the verdict is attributable to a URL we actually checked, and a redirect
 * chain that never settles is reported as `redirect-loop` rather than as an
 * unexplained `unreachable`.
 *
 * SUBREQUEST BUDGET
 * Cloudflare allows 50 subrequests per invocation and this project has ALREADY
 * been killed by that limit in production ("Too many subrequests by single
 * Worker invocation"). Each redirect hop is a subrequest, so the hop budget
 * below is the real ceiling on work per invocation — not an optimisation, but
 * the difference between serving a page and failing it outright.
 */

import { assertSafeFetchTarget } from "./ssrfGuard";
import { classifyContentBytes, type MirrorVerdict } from "./mirrorHealth";

/** Redirect hops we will follow before calling it a loop. */
export const MAX_REDIRECT_HOPS = 5;

/** Bytes of the response body we read. Enough for every magic signature. */
export const PROBE_CHUNK_BYTES = 8192;

/** Per-probe wall-clock ceiling. */
export const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeResult {
  verdict: MirrorVerdict;
  /** Final status after following redirects. */
  httpStatus: number;
  /** Where the bytes actually came from, after redirects. */
  finalUrl: string;
  /** The first URL we were asked for. */
  requestedUrl: string;
  contentType: string;
  /** How many body bytes we actually read. Small, by design. */
  bytesSeen: number;
  /** Redirect hops walked. */
  hops: number;
  /** One short sentence, safe to show a user verbatim. */
  reason: string;
  /** Set when the probe itself was refused or failed, not the mirror. */
  probeError?: "blocked" | "timeout" | "network";
}

const JSON_HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

function verdictReason(v: MirrorVerdict, status: number, ct: string): string {
  switch (v) {
    case "real-book":
      return `Served real book bytes (${ct || "binary"}).`;
    case "html-page":
      return `Returned a web page, not a file (${ct || "unknown type"}).`;
    case "php-error":
      return `Returned a PHP error page, not a file.`;
    case "corrupt":
      return "Started a file but the contents are not a readable book.";
    case "too-small":
      return `Returned almost nothing (${status}).`;
    case "redirect-loop":
      return "Kept redirecting without ever serving a file.";
    case "unreachable":
      return `Could not be reached (HTTP ${status}).`;
    case "rate-limited":
      return `Is rate-limiting us right now (HTTP ${status}).`;
    case "unverified":
      return "Could not be checked.";
    default:
      return "No verdict.";
  }
}

/** Status codes that mean "throttling", not "broken file". */
function rateLimitVerdict(status: number, ct: string): MirrorVerdict | null {
  if (status === 429 || status === 503) return "rate-limited";
  // A Cloudflare challenge is HTML with a 4xx/5xx; still not a book.
  if (status >= 400 && /text\/html/i.test(ct)) return "html-page";
  return null;
}

/**
 * Read at most `PROBE_CHUNK_BYTES` from a response body, then cancel it.
 *
 * Cancelling matters: without it the runtime keeps draining the body and the
 * "probe" downloads the entire file, which is both slow and a good way to
 * exceed the subrequest/bandwidth budget that already broke this Worker once.
 */
async function readHead(res: Response): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < PROBE_CHUNK_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    // Abandon the rest of the body; this is the whole point of a probe.
    try {
      await reader.cancel();
    } catch {
      /* the stream may already be closed */
    }
  }
  const out = new Uint8Array(Math.min(total, PROBE_CHUNK_BYTES));
  let off = 0;
  for (const c of chunks) {
    if (off >= out.length) break;
    const take = Math.min(c.length, out.length - off);
    out.set(c.subarray(0, take), off);
    off += take;
  }
  return out;
}

/**
 * Probe a mirror URL and return a verdict.
 *
 * Never throws: every failure mode becomes a verdict, because the caller's
 * contract is that an unverifiable mirror is reported as UNVERIFIED rather than
 * silently omitted or, worse, assumed healthy.
 */
export async function probeMirrorUrl(
  rawUrl: string,
  opts: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    /**
     * TEST-ONLY escape hatch for the SSRF guard, used so these tests can run
     * against a real loopback server (127.0.0.1 is private, and refusing it is
     * correct in production).
     *
     * It is deliberately a *parameter with no production caller*: every call
     * site in worker.ts omits it, so the guard cannot be bypassed at runtime.
     * If a future caller passes it from a request, that is the bug this comment
     * exists to make obvious.
     */
    guardOverride?: (raw: string) => { ok: boolean; reason?: string; parsed?: URL };
  } = {}
): Promise<ProbeResult> {
  const doFetch = opts.fetchImpl || fetch;
  const requestedUrl = rawUrl;

  const base: Omit<ProbeResult, "verdict" | "httpStatus" | "finalUrl" | "contentType" | "bytesSeen" | "hops" | "reason"> = {
    requestedUrl,
  };

  const check = opts.guardOverride || assertSafeFetchTarget;
  const guard = check(rawUrl);
  if (!guard.ok || !guard.parsed) {
    return {
      ...base,
      verdict: "unverified",
      httpStatus: 0,
      finalUrl: rawUrl,
      contentType: "",
      bytesSeen: 0,
      hops: 0,
      reason: guard.reason || "That address cannot be checked.",
      probeError: "blocked",
    };
  }

  let current = guard.parsed;
  let hops = 0;
  let res: Response;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // Manual redirect handling: every hop is re-validated below.
    for (;;) {
      let attempt: Response;
      try {
        attempt = await doFetch(current.toString(), {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            // Some CDNs serve a placeholder unless a file-ish Accept is sent;
            // asking for a book is the honest request for a book probe.
            Accept: "application/epub+zip,application/pdf,application/zip,application/octet-stream;q=0.9,*/*;q=0.8",
            "Accept-Encoding": "identity",
          },
        });
      } catch (err: any) {
        const aborted = err?.name === "AbortError";
        return {
          ...base,
          verdict: "unreachable",
          httpStatus: 0,
          finalUrl: current.toString(),
          contentType: "",
          bytesSeen: 0,
          hops,
          reason: aborted ? "Timed out while checking this mirror." : "Could not be reached.",
          probeError: aborted ? "timeout" : "network",
        };
      }

      const isRedirect = attempt.status >= 300 && attempt.status < 400 && attempt.headers.get("location");
      if (!isRedirect) {
        res = attempt;
        break;
      }
      hops++;
      if (hops > MAX_REDIRECT_HOPS) {
        return {
          ...base,
          verdict: "redirect-loop",
          httpStatus: attempt.status,
          finalUrl: current.toString(),
          contentType: "",
          bytesSeen: 0,
          hops,
          reason: "Kept redirecting without ever serving a file.",
        };
      }
      let next: URL;
      try {
        next = new URL(attempt.headers.get("location") as string, current);
      } catch {
        return {
          ...base,
          verdict: "corrupt",
          httpStatus: attempt.status,
          finalUrl: current.toString(),
          contentType: "",
          bytesSeen: 0,
          hops,
          reason: "Redirected somewhere unreadable.",
        };
      }
      // Re-validate every hop: the guard covers the redirect target too, so a
      // public URL cannot bounce the probe into the private network.
      const hopGuard = check(next.toString());
      if (!hopGuard.ok || !hopGuard.parsed) {
        return {
          ...base,
          verdict: "unverified",
          httpStatus: attempt.status,
          finalUrl: next.toString(),
          contentType: "",
          bytesSeen: 0,
          hops,
          reason: "Redirected to an address that cannot be checked.",
          probeError: "blocked",
        };
      }
      current = next;
    }

    const contentType = res.headers.get("content-type") || "";
    const finalUrl = res.url || current.toString();

    if (res.status === 429 || res.status === 503) {
      return {
        ...base,
        verdict: "rate-limited",
        httpStatus: res.status,
        finalUrl,
        contentType,
        bytesSeen: 0,
        hops,
        reason: verdictReason("rate-limited", res.status, contentType),
      };
    }

    const bytes = await readHead(res);
    const claimed = /\.([a-z0-9]{2,5})$/i.exec(new URL(finalUrl).pathname)?.[1] || null;
    const verdict = classifyContentBytes(bytes, contentType, claimed);

    // A 4xx/5xx that nonetheless sniffed as a book is still a failure to
    // deliver: the status decides when the status is an error.
    const finalVerdict = res.status >= 400 && verdict === "real-book" ? "html-page" : verdict;
    const overridden = res.status >= 400 ? rateLimitVerdict(res.status, contentType) : null;

    return {
      ...base,
      verdict: overridden || finalVerdict,
      httpStatus: res.status,
      finalUrl,
      contentType,
      bytesSeen: bytes.length,
      hops,
      reason: verdictReason(overridden || finalVerdict, res.status, contentType),
    };
  } finally {
    clearTimeout(timer);
  }
}
