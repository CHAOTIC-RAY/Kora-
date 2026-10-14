// Re-resolves an *expired* LibGen signed link. RAVE supplies get.php?md5=<h>&key=<t>
// URLs whose `key` expires; when such a link returns an HTML interstitial (no embedded
// fresh key), we mint a new signed key so the download can actually proceed.
import { resolveLibgenSigned } from "./libgenSigned";

export const LIBGEN_MIRRORS = [
  "https://libgen.li",
  "https://libgen.be",
  "https://libgen.lc",
  "https://libgen.gs",
  "https://libgen.st",
  "https://libgen.rocks",
];

/**
 * Ceiling on outbound fetches for ONE /api/proxy-file request.
 *
 * Cloudflare caps a Worker invocation at 50 subrequests and answers 522
 * ("Too many subrequests by single Worker invocation") past that. The mirror
 * ladder was structurally over budget: 6 mirrors x 2 protocols = 12 candidate
 * URLs, each costing up to 3 fetches (landing page, re-minted key, binary),
 * and the re-mint races 4 more hosts x 2 protos on top. An unsigned landing
 * page therefore never reached the fix — the invocation died at 522 first.
 * Measured 2026-10-03: 66s then 502, with the tail showing 522.
 *
 * Kept well under the cap so there is headroom for the re-mint and the follow-up
 * binary fetch. Happy path still returns on the first or second candidate.
 */
const MAX_SUBREQUESTS = 24;

export function extractLibgenMd5Key(url: string): { md5: string; key?: string } | null {
  const md5Match = url.match(/md5=([a-fA-F0-9]{32})/i);
  if (!md5Match) return null;
  const keyMatch = url.match(/(?:^|[?&])key=([^&]+)/i);
  return {
    md5: md5Match[1].toLowerCase(),
    key: keyMatch?.[1],
  };
}

export function buildLibgenDownloadUrl(mirror: string, md5: string, key?: string): string {
  const base = mirror.replace(/\/$/, "");
  const query = key
    ? `get.php?md5=${md5}&key=${key}`
    : `get.php?md5=${md5}`;
  return `${base}/${query}`;
}

export function libgenMirrorCandidates(url: string): string[] {
  const parsed = extractLibgenMd5Key(url);
  if (!parsed) return [url];

  const candidates = new Set<string>();
  candidates.add(url);

  for (const mirror of LIBGEN_MIRRORS) {
    candidates.add(buildLibgenDownloadUrl(mirror, parsed.md5, parsed.key));
    if (!parsed.key) {
      candidates.add(buildLibgenDownloadUrl(mirror, parsed.md5));
    }
  }

  if (url.startsWith("https://")) {
    candidates.add(url.replace(/^https:\/\//i, "http://"));
  }

  return Array.from(candidates);
}

export function isLibgenUrl(url: string): boolean {
  return /libgen\.|library\.lol/i.test(url) || /get\.php\?md5=/i.test(url);
}

function signedUrlFromLibgenHtml(html: string, pageUrl: string): string | null {
  const m = html.match(/get\.php\?md5=[a-f0-9]+&key=[A-Za-z0-9]+/i);
  if (!m) return null;
  try {
    const parsed = new URL(pageUrl);
    return `${parsed.protocol}//${parsed.host}/${m[0]}`;
  } catch {
    return null;
  }
}

/** Connect timeout for landing pages; binary streams need a much longer budget. */
const LIBGEN_CONNECT_MS = 20_000;
/** Slow mirrors (~20KB/s) need several minutes for a multi‑MB ebook. */
const LIBGEN_STREAM_MS = 12 * 60 * 1000;

export async function fetchBinaryWithLibgenMirrors(
  url: string,
  headers: Record<string, string>
): Promise<Response> {
  const candidates = isLibgenUrl(url) ? libgenMirrorCandidates(url) : [url];
  let lastStatus = 0;
  let lastError = "";

  // Every outbound fetch costs a subrequest, and Cloudflare kills the whole
  // invocation at 50 with a 522. Count them so the ladder degrades gracefully
  // (a real "mirrors failed") instead of dying opaquely mid-fallback.
  let spent = 0;
  const fetchBounded = async (target: string, init: RequestInit): Promise<Response> => {
    if (spent >= MAX_SUBREQUESTS) {
      throw new Error(`subrequest budget exhausted (${spent})`);
    }
    spent++;
    return fetch(target, init);
  };

  for (const candidate of candidates) {
    const attempts = candidate.startsWith("https://")
      ? [candidate, candidate.replace(/^https:\/\//i, "http://")]
      : [candidate];

    for (const attemptUrl of attempts) {
      if (spent >= MAX_SUBREQUESTS) break;
      try {
        // Already-signed CDN links go straight to the file — use the long stream budget.
        const alreadySigned = /[?&]key=/i.test(attemptUrl);
        const response = await fetchBounded(attemptUrl, {
          headers: {
            ...headers,
            Referer: `${new URL(attemptUrl).origin}/`,
            Accept: "application/octet-stream,application/epub+zip,application/pdf,*/*",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(alreadySigned ? LIBGEN_STREAM_MS : LIBGEN_CONNECT_MS),
        });
        lastStatus = response.status;
        if (!response.ok) continue;

        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        // Unsigned get.php often returns an HTML interstitial with the signed CDN link.
        if (contentType.includes("text/html")) {
          const html = await response.text();
          const signed = signedUrlFromLibgenHtml(html, attemptUrl);
          if (signed) {
            const bin = await fetchBounded(signed, {
              headers: {
                ...headers,
                Referer: `${new URL(signed).origin}/`,
                Accept: "application/octet-stream,application/epub+zip,application/pdf,*/*",
              },
              redirect: "follow",
              // Must not use a short timeout — AbortSignal aborts the whole body stream.
              signal: AbortSignal.timeout(LIBGEN_STREAM_MS),
            });
            lastStatus = bin.status;
            if (!bin.ok) continue;
            const binType = (bin.headers.get("content-type") || "").toLowerCase();
            if (binType.includes("text/html")) continue;
            return bin;
          }
          // The HTML is a landing/ad page rather than the file. Two distinct
          // cases, and BOTH need a fresh key:
          //
          //  (a) the URL carried a `key=` that has since expired — its HTML
          //      embeds no usable link, so mint a new one from the md5;
          //  (b) the URL is an unsigned landing page (`ads.php?md5=`, or a bare
          //      `get.php?md5=` with no key) — Rave returns exactly this shape,
          //      and it was never signed in the first place, so the old
          //      `alreadySigned` guard skipped the repair and the request fell
          //      through to "all mirrors failed". Verified 2026-10-03: an
          //      `ads.php?md5=649CBE…` returns 20,872 B of text/html.
          //
          // Re-mint on either. The md5 is all that is needed either way.
          const landingMd5 = attemptUrl.match(/md5=([a-fA-F0-9]{32})/i)?.[1]?.toLowerCase();
          if (landingMd5) {
            const fresh = await resolveLibgenSigned(landingMd5, 8000);
            if (fresh && fresh !== attemptUrl) {
              const bin = await fetchBounded(fresh, {
                headers: {
                  ...headers,
                  Referer: `${new URL(fresh).origin}/`,
                  Accept: "application/octet-stream,application/epub+zip,application/pdf,*/*",
                },
                redirect: "follow",
                signal: AbortSignal.timeout(LIBGEN_STREAM_MS),
              });
              lastStatus = bin.status;
              if (!bin.ok) continue;
              const binType = (bin.headers.get("content-type") || "").toLowerCase();
              if (binType.includes("text/html")) continue;
              return bin;
            }
          }
          continue;
        }
        return response;
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }
  }

  throw new Error(
    lastStatus === 403
      ? "Access Forbidden (403) by mirror host. Try another mirror from download options."
      : `All libgen mirrors failed${lastStatus ? ` (last status ${lastStatus})` : ""}${lastError ? `: ${lastError}` : "."}`
  );
}
