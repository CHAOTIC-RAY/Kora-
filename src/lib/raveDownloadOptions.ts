/**
 * Shared download-option builder for Rave direct links and fallbacks.
 *
 * Used by the Cloudflare Worker and the local Express dev server so mirror
 * lists cannot drift (raw upstream URL in dev vs proxied URL in prod was one
 * source of double-wrap 502s and "no direct mirrors" in auto-download).
 */

export type DownloadMirrorOption = {
  label: string;
  url: string;
  isDirect: boolean;
  sourceId?: string;
  isSearch?: boolean;
};

/** True when the upstream URL can be fetched as a file through proxy-file. */
export function isRaveDirectUpstreamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathAndQuery = parsed.pathname + parsed.search;
    if (/get\.php\?md5=.+&key=/i.test(pathAndQuery)) return true;
    if (parsed.hostname.includes("booksdl.lc")) return true;
    if (parsed.hostname.includes("annas-archive") && !url.toLowerCase().includes("/slow_download/")) {
      return true;
    }
    if (parsed.hostname.includes("archive.org")) {
      return /\/download\//i.test(parsed.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

function proxied(url: string): string {
  return `/api/proxy-file?url=${encodeURIComponent(url)}`;
}

/**
 * Build the same mirror list the Worker serves on
 * `/api/download-options` and `/api/annas-archive/download`.
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
  const searchQuery = (params.searchQuery || "").trim();

  let downloadLinks: DownloadMirrorOption[] = [];

  if (raveDirect) {
    try {
      const parsed = new URL(raveDirect);
      const isIaDetails = raveDirect.includes("archive.org/details/");
      if (!isIaDetails && isRaveDirectUpstreamUrl(raveDirect)) {
        const lower = raveDirect.toLowerCase();
        const isSlow = lower.includes("/slow_download/") || lower.includes("annas-archive.gl/slow");
        downloadLinks.push({
          label: isSlow ? "Anna's Archive (Slow/Manual)" : "Rave Direct Download",
          url: proxied(parsed.toString()),
          isDirect: !isSlow,
          sourceId: "rave",
        });
      } else if (isIaDetails) {
        downloadLinks.push({
          label: "Internet Archive (Browse Page)",
          url: raveDirect,
          isDirect: false,
        });
      }
    } catch {
      /* malformed direct URL */
    }
  }

  if (iaId && downloadLinks.length === 0) {
    downloadLinks = [
      {
        label: "Internet Archive (Direct Download)",
        url: proxied(`https://archive.org/download/${iaId}/${iaId}.epub`),
        isDirect: true,
      },
      {
        label: "Internet Archive (Browse Page)",
        url: `https://archive.org/details/${iaId}`,
        isDirect: false,
      },
      {
        label: "Search Rave for this book",
        url: searchQuery
          ? `https://ravebooksearch.com/search?q=${encodeURIComponent(searchQuery)}`
          : "https://ravebooksearch.com",
        isDirect: false,
        isSearch: true,
      },
    ];
  } else if (downloadLinks.length === 0) {
    const raveSearch = `https://ravebooksearch.com/search?q=${encodeURIComponent(searchQuery || md5 || "")}`;
    downloadLinks = [
      {
        label: searchQuery ? `Search Rave for "${searchQuery}"` : "Search Rave for this book",
        url: searchQuery ? raveSearch : "https://ravebooksearch.com",
        isDirect: false,
        sourceId: "rave",
        isSearch: !searchQuery,
      },
    ];
  }

  return downloadLinks;
}
