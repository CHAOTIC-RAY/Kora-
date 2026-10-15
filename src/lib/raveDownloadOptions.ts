/**
 * Download-option builder with Rave-independent catalogue fallbacks.
 * Catalogue/reader pages are never mislabeled as direct files. Guessed Internet
 * Archive filenames and the retired public Rave deployment are not used.
 */
export type DownloadMirrorOption = {
  label: string;
  url: string;
  isDirect: boolean;
  sourceId?: string;
  isSearch?: boolean;
};

export function isRaveDirectUpstreamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathAndQuery = parsed.pathname + parsed.search;
    if (/get\.php\?md5=.+&key=/i.test(pathAndQuery)) return true;
    if (parsed.hostname.includes("booksdl.lc")) return true;
    if (parsed.hostname.includes("annas-archive") && !url.toLowerCase().includes("/slow_download/")) return true;
    if (parsed.hostname.includes("archive.org")) return /\/download\//i.test(parsed.pathname);
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
 * searchQuery should contain the actual title/author query. This API shape is
 * retained for Worker/dev-server callers, but fallbacks work without Rave.
 */
export function buildRaveDownloadOptions(params: {
  md5?: string | null;
  iaId?: string | null;
  raveDirect?: string | null;
  searchQuery?: string | null;
}): DownloadMirrorOption[] {
  const md5 = (params.md5 || "").trim();
  const iaId = (params.iaId || "").trim();
  const raveDirect = (params.raveDirect || "").trim();
  const query = (params.searchQuery || "").trim();
  const options: DownloadMirrorOption[] = [];

  if (raveDirect) {
    try {
      const parsed = new URL(raveDirect);
      const isIaDetails = /archive\.org\/details\//i.test(raveDirect);
      if (!isIaDetails && isRaveDirectUpstreamUrl(raveDirect)) {
        const slow = /\/slow_download\//i.test(raveDirect);
        options.push({
          label: slow ? "Anna's Archive (manual download)" : "Direct file (via proxy)",
          url: proxied(parsed.toString()),
          isDirect: !slow,
          sourceId: "external",
        });
      } else if (isIaDetails) {
        options.push({ label: "Internet Archive item page", url: raveDirect, isDirect: false });
      }
    } catch {
      // Ignore malformed upstream URLs and use independent search fallbacks.
    }
  }

  // A genuine LibGen MD5 is 32 hex chars. Never pass a pseudo SHA-256 ID.
  if (/^[a-f0-9]{32}$/i.test(md5)) {
    options.push({
      label: "LibGen file endpoint (via proxy)",
      url: proxied("https://libgen.li/get.php?md5=" + md5),
      isDirect: true,
      sourceId: "libgen",
    });
  }

  if (iaId) {
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
      { label: "Open Library catalogue search", url: searchUrl("https://openlibrary.org/search?q=", q), isDirect: false, sourceId: "openlibrary", isSearch: true },
      { label: "Google Books search", url: searchUrl("https://books.google.com/books?q=", q), isDirect: false, sourceId: "google-books", isSearch: true },
      { label: "Anna's Archive search", url: searchUrl("https://annas-archive.org/search?q=", q), isDirect: false, sourceId: "annas-archive", isSearch: true }
    );
  } else {
    options.push({ label: "Open Library search", url: "https://openlibrary.org/", isDirect: false, sourceId: "openlibrary", isSearch: true });
  }

  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.url)) return false;
    seen.add(option.url);
    return true;
  });
}
