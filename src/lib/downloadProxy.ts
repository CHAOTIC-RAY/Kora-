/**
 * Turn a mirror's `url` into something fetchable through `/api/proxy-file`.
 *
 * The Worker already hands back a RELATIVE proxy URL for some mirrors — a Rave
 * direct link arrives as `/api/proxy-file?url=https%3A%2F%2Farchive.org%2F…`
 * (see the `isDirectLink` branch in the Worker's download-options route).
 * Wrapping that again produces a proxy-of-a-proxy:
 *
 *   /api/proxy-file?url=%2Fapi%2Fproxy-file%3Furl%3Dhttps%253A%252F%252F…
 *
 * The inner `url` is then a path, not an absolute http(s) URL, so the Worker
 * cannot fetch it and answers 502 for every mirror. Because that is identical
 * to "this mirror is down", the failure looked like a dead mirror rather than a
 * double-encoded URL, and retrying other mirrors could not help.
 *
 * One rule, in one place, so the four call sites cannot drift apart again.
 */

/** True when the URL already points at our own proxy and must not be re-wrapped. */
export function isProxyUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("/api/proxy-file")) return true;
  try {
    const u = new URL(url, "https://kora.invalid");
    // Same-origin absolute form, e.g. https://kora.chaoticstudio.workers.dev/api/proxy-file?…
    return u.pathname === "/api/proxy-file" || u.pathname === "/api/proxy-file/";
  } catch {
    return false;
  }
}

/**
 * The URL to fetch for a mirror. Returns an absolute upstream URL untouched,
 * wraps a relative/upstream path in the proxy exactly once, and leaves an
 * already-proxied URL alone.
 */
export function proxyUrlForMirror(url: string): string {
  if (!url) return url;
  if (isProxyUrl(url)) return url;
  return `/api/proxy-file?url=${encodeURIComponent(url)}`;
}
