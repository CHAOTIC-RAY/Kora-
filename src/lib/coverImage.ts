/**
 * Resolve a book cover URL for use in <img src>.
 * Proxies remote http(s) URLs through /api/proxy-image; passes through local,
 * data, and blob URLs unchanged.
 *
 * On Capacitor (APK), relative /api/* paths must be absolute to the Worker —
 * <img src> does not go through the fetch shim.
 */
import { resolveApiUrl } from "./capacitorNative";

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
    return resolveApiUrl(trimmed);
  }

  if (trimmed.startsWith("//")) {
    return resolveApiUrl(
      `/api/proxy-image?url=${encodeURIComponent(`https:${trimmed}`)}`
    );
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const secure = trimmed.startsWith("http://")
      ? `https://${trimmed.slice(7)}`
      : trimmed;
    return resolveApiUrl(`/api/proxy-image?url=${encodeURIComponent(secure)}`);
  }

  return trimmed;
}

export function shouldProxyCoverUrl(coverUrl: string): boolean {
  const trimmed = coverUrl.trim();
  return /^https?:\/\//i.test(trimmed) || trimmed.startsWith("//");
}
