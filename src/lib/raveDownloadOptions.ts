/**
 * Download-option builder for verified open-access sources.
 *
 * Direct links are only emitted for provider-native file URLs from Internet
 * Archive or Project Gutenberg. Catalogue pages remain catalogue links; an
 * MD5 by itself is not a downloadable URL and must never become a guessed mirror.
 */
export type DownloadMirrorOption = {
  label: string;
  url: string;
  isDirect: boolean;
  sourceId?: string;
  isSearch?: boolean;
};

export function isRaveDirectUpstreamUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "archive.org") return /^\/download\/[a-z0-9._-]+\//i.test(parsed.pathname);
    if (host === "www.gutenberg.org" || host === "gutenberg.org") {
      return /^\/ebooks\/\d+\.(?:epub3\.images|epub\.images|epub\.noimages|txt\.utf-8|txt\.0|kindle\.images|kindle\.noimages)$/i.test(parsed.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

function proxied(url: string): string {
  return "/api/proxy-file?url=" + encodeURIComponent(url);
}

function searchUrl(base: string, query: string): string {
  return base + encodeURIComponent(query);
}

/**
 * Kept API-compatible with existing Worker/dev-server callers. The md5
 * parameter is intentionally not used to guess a file endpoint: a hash is an
 * identifier, not proof of an authorized or currently valid download URL.
 */
export function buildRaveDownloadOptions(params: {
  md5?: string | null;
  iaId?: string | null;
  raveDirect?: string | null;
  searchQuery?: string | null;
}): DownloadMirrorOption[] {
  const iaId = (params.iaId || "").trim();
  const raveDirect = (params.raveDirect || "").trim();
  const query = (params.searchQuery || "").trim();
  const options: DownloadMirrorOption[] = [];

  if (raveDirect) {
    try {
      const parsed = new URL(raveDirect);
      if (isRaveDirectUpstreamUrl(parsed.toString())) {
        options.push({
          label: "Open-access direct download",
          url: proxied(parsed.toString()),
          isDirect: true,
          sourceId: parsed.hostname.toLowerCase().includes("gutenberg") ? "gutenberg" : "archive",
        });
      } else if (parsed.hostname.toLowerCase() === "archive.org" && /^\/details\/[a-z0-9._-]+\/?$/i.test(parsed.pathname)) {
        options.push({ label: "Internet Archive item page", url: parsed.toString(), isDirect: false, sourceId: "archive" });
      }
    } catch {
      // Ignore malformed URLs and continue with independent catalogue fallbacks.
    }
  }

  if (/^[a-z0-9._-]{1,160}$/i.test(iaId)) {
    options.push({
      label: "Internet Archive item page",
      url: "https://archive.org/details/" + encodeURIComponent(iaId),
      isDirect: false,
      sourceId: "archive",
    });
  }

  const q = query || (iaId ? iaId.replace(/[-_]+/g, " ") : "");
  if (q) {
    options.push(
      { label: "Internet Archive search", url: searchUrl("https://archive.org/search?query=", q), isDirect: false, sourceId: "archive", isSearch: true },
      { label: "Project Gutenberg search", url: searchUrl("https://www.gutenberg.org/ebooks/search/?query=", q), isDirect: false, sourceId: "gutenberg", isSearch: true },
      { label: "Open Library catalogue search", url: searchUrl("https://openlibrary.org/search?q=", q), isDirect: false, sourceId: "openlibrary", isSearch: true },
      { label: "Google Books search", url: searchUrl("https://books.google.com/books?q=", q), isDirect: false, sourceId: "google-books", isSearch: true }
    );
  } else {
    options.push({ label: "Open Library catalogue", url: "https://openlibrary.org/", isDirect: false, sourceId: "openlibrary", isSearch: true });
  }

  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.url)) return false;
    seen.add(option.url);
    return true;
  });
}
