/**
 * Resolve a book cover URL for use in <img src>.
 * Proxies remote http(s) URLs through /api/proxy-image; passes through local,
 * data, and blob URLs unchanged.
 */
export function resolveCoverImageSrc(coverUrl?: string | null): string | null {
  if (!coverUrl) return null;
  const trimmed = coverUrl.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  ) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `/api/proxy-image?url=${encodeURIComponent(`https:${trimmed}`)}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return `/api/proxy-image?url=${encodeURIComponent(trimmed)}`;
  }

  return trimmed;
}

export function shouldProxyCoverUrl(coverUrl: string): boolean {
  const trimmed = coverUrl.trim();
  return /^https?:\/\//i.test(trimmed) || trimmed.startsWith("//");
}
