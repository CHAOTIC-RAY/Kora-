/**
 * Where a plugin-source image's bytes come from.
 *
 * The rule this file exists to enforce: **an image produced by a source
 * plugin is fetched through the Worker, never straight from the browser.**
 *
 * Two independent reasons, and both have bitten:
 *
 *   1. Hotlink protection. Manga CDNs refuse requests they do not
 *      recognise. `createImageBitmap` is stricter than `<img>`, so a direct
 *      load fails where the element might have limped through.
 *
 *   2. A DNS filter on the user's own network. On the machine this was
 *      reported from, `manhuaplus.com` and `cdn.manhuaplus.com` resolve to
 *      a Fortinet "Fortiguard SDNS Blocked Page" certificate, so the
 *      browser refuses the TLS handshake with
 *      `net::ERR_CERT_AUTHORITY_INVALID`. Nothing is wrong with the site and
 *      nothing is wrong with the selectors; the interception is between the
 *      browser and the origin. Cloudflare's DNS is not behind that filter, so
 *      the same URL fetched by the Worker returns a real 562KB JPEG.
 *
 * Reason 2 is the one that decides the default. A direct-first-then-proxy
 * fallback spends a doomed TLS handshake on every image on the page before
 * it retries, and on a blocked host *every* direct attempt is doomed, so the
 * "fallback" becomes the normal path with extra latency. The proxy is the
 * default; a direct load is what we fall back to only for URLs that are not
 * remote in the first place.
 *
 * Scoped deliberately. The proxy costs a Worker invocation, adds a hop, and
 * is subject to the platform's response limits, so it is NOT applied to every
 * image in the app — bundled assets, `data:` and `blob:` URLs, and anything
 * already pointing at the Worker pass straight through. Only remote
 * http(s) URLs get relayed.
 */
import { resolveApiUrl } from "./capacitorNative";

/** True for a `data:` URL. Never relayed; there is nothing to fetch. */
function isInlineUrl(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("blob:");
}

/**
 * True when the URL is already being served by the Worker.
 *
 * Re-proxying one of these would produce `/api/proxy-image?url=...%2Fapi%2F
 * proxy-image...` and a self-referential request the proxy's own denylist
 * rejects with 403 — so this check has to come first, not last.
 */
function isWorkerUrl(url: string): boolean {
  if (url.startsWith("/api/")) return true;
  try {
    return new URL(url, "https://kora.invalid").pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/**
 * The single routing decision: does this URL get the Worker relay?
 *
 * Remote absolute http(s) URLs do. Everything else — bundled assets, inline
 * data, object URLs, already-proxied paths, relative paths — does not, because
 * there is nothing remote about it to relay.
 */
export function shouldProxyImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (isInlineUrl(trimmed)) return false;
  if (isWorkerUrl(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed) || trimmed.startsWith("//");
}

/** The relay URL for a plugin image, or null when it must not be relayed. */
export function pluginImageSrc(url: string | null | undefined): string | null {
  if (!shouldProxyImageUrl(url)) return null;
  const trimmed = (url as string).trim();

  // Protocol-relative: the page's scheme is ours, and `//host/x` from an
  // https page is already https. Pin it rather than inheriting, so a page
  // served over http does not ask the Worker for an http upstream.
  if (trimmed.startsWith("//")) {
    return resolveApiUrl(
      `/api/proxy-image?url=${encodeURIComponent(`https:${trimmed}`)}`,
    );
  }

  // Plain http origins get upgraded. A CDN that only speaks http is rare
  // enough that upgrading is the better trade: the Worker validates the
  // protocol either way, and this stops an http page from silently
  // downgrading a page image.
  const secure = trimmed.startsWith("http://")
    ? `https://${trimmed.slice(7)}`
    : trimmed;

  return resolveApiUrl(`/api/proxy-image?url=${encodeURIComponent(secure)}`);
}

/**
 * The URL a plugin image should actually be fetched from.
 *
 * Remote URLs come back as the relay; everything else comes back unchanged.
 * This is the function callers want — `pluginImageSrc` is for the callers
 * that need to know *which* route was chosen (the reader logs it).
 */
export function resolvePluginImageSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return pluginImageSrc(trimmed) ?? trimmed;
}