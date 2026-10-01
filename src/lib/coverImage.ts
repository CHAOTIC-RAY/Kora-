/**
 * Resolve a book cover URL for use in <img src>.
 * Proxies remote http(s) URLs through /api/proxy-image; passes through local,
 * data, and blob URLs unchanged.
 *
 * On Capacitor (APK), relative /api/* paths must be absolute to the Worker —
 * <img src> does not go through the fetch shim.
 */
import { resolveApiUrl } from "./capacitorNative";
import { resolvePluginImageSrc, shouldProxyImageUrl } from "./pluginImage";

export function resolveCoverImageSrc(coverUrl?: string | null): string | null {
  if (!coverUrl) return null;
  const trimmed = coverUrl.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  ) {
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    // /api/cover-redirect, /api/proxy-image, static assets under /api, etc.
    // Deliberately NOT re-proxied: `pluginImage.shouldProxyImageUrl` treats
    // an /api path as already-served, and re-relaying one would ask the
    // Worker to fetch itself.
    return resolveApiUrl(trimmed);
  }

  // Remote covers are plugin/source images by another name and hit the same
  // hotlink wall and the same DNS filters as a page, so they take the same
  // route. Delegating keeps one decision in one place — the reader's pages
  // and a book's cover must never disagree about whether to relay.
  return resolvePluginImageSrc(trimmed);
}

export function shouldProxyCoverUrl(coverUrl: string): boolean {
  return shouldProxyImageUrl(coverUrl);
}
