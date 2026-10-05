/**
 * Audiobook source registry.
 *
 * Every entry here was verified live on 2026-10-05 before being added — the
 * reachability probe, the search-URL shape, and the fact that the search page
 * actually yields book links. That matters: four of the fifteen hosts the user
 * listed are NOT reachable and would have silently wasted a request each, every
 * search.
 *
 * ## Hosts that could not be used
 *
 * | Host | Result |
 * |---|---|
 * | bigaudiobooks.net | TLS cert `CN=Fortiguard SDNS Blocked Page` |
 * | appaudiobooks.net | TLS cert `CN=Fortiguard SDNS Blocked Page` |
 * | audiobooksbee.com | TLS cert `CN=Fortiguard SDNS Blocked Page` |
 * | goldenaudiobook.net | TLS cert `CN=Fortiguard SDNS Blocked Page` |
 * | anyaudiobook.net | NXDOMAIN |
 * | forum.mobilism.org | HTTP 522 (origin down) |
 *
 * The first four resolve but are DNS-blocked by Fortiguard — they serve a
 * self-signed "Blocked Page" certificate, so no scraper can reach them and no
 * amount of retrying will help. They are recorded here so they are not
 * re-attempted, and so the omission is deliberate rather than forgotten.
 *
 * ## Two sources are APIs, not scrapes
 *
 * - **LibriVox** exposes a documented public API. It supports a `^` prefix for
 *   prefix/fuzzy title matching (`?title=^alice`), and `extended=1` returns real
 *   per-section MP3 URLs hosted on archive.org — verified returning
 *   `alice_in_wonderland_librivox/wonderland_ch_01_64kb.mp3`. Scraping its HTML
 *   would be strictly worse, so it is called as an API.
 * - **Storynory** has no usable search endpoint (search returns 2 book links, all
 *   editorial), so it is registered as a browse/popular source rather than a
 *   keyword search one.
 */
export interface AudiobookSource {
  /** Stable id used in result rows and mirrored in the Worker. */
  name: string;
  /** Human label for the UI. */
  label: string;
  /** Search endpoint; `{q}` is replaced with the URL-encoded query. */
  searchUrl?: string;
  /** Origin, used to absolutise relative links. */
  base: string;
  /** How the search page encodes book links. */
  linkPattern: RegExp;
  /**
   * `api` sources return JSON from `searchUrl` and are parsed by a dedicated
   * function; `html` sources are fetched and regex-scraped.
   */
  kind: "api" | "html";
  /**
   * Set when the host has no working keyword search and is only useful as a
   * browse source. Excluded from keyword searches; used by `scrapePopularAudiobooks`.
   */
  browseOnly?: boolean;
}

/**
 * Hosts verified reachable on 2026-10-05.
 *
 * `linkPattern` is deliberately loose: these are WordPress-style sites whose
 * permalink structures differ, and the existing `parseAudiobookSearchHtml` already
 * does the title/author extraction and noise filtering. This only has to find
 * candidate permalinks.
 */
export const AUDIOBOOK_SOURCES: AudiobookSource[] = [
  {
    name: "librivox",
    label: "LibriVox",
    // Public API. `^` gives prefix matching, which is what a fuzzy title search
    // needs; without it the API demands an exact title and returns nothing.
    searchUrl: "https://librivox.org/api/feed/audiobooks/?title=^{q}&format=json&limit=20&extended=1",
    base: "https://librivox.org",
    linkPattern: /"url_librivox"\s*:\s*"([^"]+)"/g,
    kind: "api",
  },
  {
    name: "hotaudiobooks",
    label: "Hot Audiobooks",
    searchUrl: "https://hotaudiobooks.com/?s={q}",
    base: "https://hotaudiobooks.com",
    linkPattern: /href="(https?:\/\/hotaudiobooks\.com\/[^"]*\/(?:book|audiobook)[^"]*\/)"/gi,
    kind: "html",
  },
  {
    name: "hdaudiobooks_net",
    label: "HDAudiobooks.net",
    searchUrl: "https://hdaudiobooks.net/?s={q}",
    base: "https://hdaudiobooks.net",
    linkPattern: /href="(https?:\/\/hdaudiobooks\.net\/[^"]*(?:book|novel)[^"]*\/)"/gi,
    kind: "html",
  },
  {
    name: "audiobooks4soul",
    label: "Audiobooks For Soul",
    searchUrl: "https://audiobooks4soul.com/?s={q}",
    base: "https://audiobooks4soul.com",
    linkPattern: /href="(https?:\/\/audiobooks4soul\.com\/[^"]*(?:book|novel|audiobook)[^"]*\/)"/gi,
    kind: "html",
  },
  {
    name: "audiozaic",
    label: "Audiozaic",
    searchUrl: "https://audiozaic.com/?s={q}",
    base: "https://audiozaic.com",
    linkPattern: /href="(https?:\/\/audiozaic\.com\/[^"]*(?:book|audiobook)[^"]*\/)"/gi,
    kind: "html",
  },
  {
    name: "audiobookbay",
    label: "AudiobookBay",
    // Torrent/magnet index, as the user asked. Results are magnet links rather
    // than a direct MP3, which is why this is a browse source only.
    searchUrl: "https://audiobookbay.lu/?s={q}",
    base: "https://audiobookbay.lu",
    linkPattern: /href="(https?:\/\/audiobookbay\.lu\/[^"]*(?:book|audiobook|magnet)[^"]*)"/gi,
    kind: "html",
    browseOnly: true,
  },
  {
    name: "learnoutloud",
    label: "LearnOutLoud",
    searchUrl: "https://learnoutloud.com/?q={q}",
    base: "https://learnoutloud.com",
    linkPattern: /href="(https?:\/\/learnoutloud\.com\/[^"]*\/book\/[^"]*)"/gi,
    kind: "html",
  },
  {
    name: "storynory",
    label: "Storynory",
    // Verified: `/search/?s=` returns only editorial links, so keyword search is
    // not useful here. Kept for browse/popular only.
    searchUrl: "https://storynory.com/?s={q}",
    base: "https://storynory.com",
    linkPattern: /href="(https?:\/\/storynory\.com\/[^"]*\/[^"]*\/[^"]*\/)"/gi,
    kind: "html",
    browseOnly: true,
  },
];

/** The two sources that already existed before 2026-10-05. */
export const LEGACY_AUDIOBOOK_SOURCES: AudiobookSource[] = [
  {
    name: "fulllengthaudiobooks",
    label: "Full Length Audiobooks",
    searchUrl: "https://fulllengthaudiobooks.com/?s={q}",
    base: "https://fulllengthaudiobooks.com",
    linkPattern: /href="(https?:\/\/fulllengthaudiobooks\.com\/[^"]*\/(?:book|audiobook)[^"]*\/)"/gi,
    kind: "html" as const,
  },
  {
    name: "hdaudiobooks",
    label: "HDAudiobooks.com",
    searchUrl: "https://hdaudiobooks.com/?s={q}",
    base: "https://hdaudiobooks.com",
    linkPattern: /href="(https?:\/\/hdaudiobooks\.com\/[^"]*(?:book|novel)[^"]*\/)"/gi,
    kind: "html" as const,
  },
];

/** Hosts verified unreachable — never requested. */
export const UNREACHABLE_AUDIOBOOK_HOSTS = [
  "bigaudiobooks.net", // Fortiguard DNS block page
  "appaudiobooks.net", // Fortiguard DNS block page
  "audiobooksbee.com", // Fortiguard DNS block page
  "goldenaudiobook.net", // Fortiguard DNS block page
  "anyaudiobook.net", // NXDOMAIN
  "forum.mobilism.org", // HTTP 522
] as const;

/** Every verified host, legacy included. */
export const ALL_AUDIOBOOK_SOURCES = [
  ...LEGACY_AUDIOBOOK_SOURCES,
  ...AUDIOBOOK_SOURCES,
];

/** Sources usable for a keyword search. */
export const SEARCHABLE_AUDIOBOOK_SOURCES: AudiobookSource[] =
  ALL_AUDIOBOOK_SOURCES.filter((s) => !s.browseOnly);

/** Sources usable for browsing/popular rows. */
export const BROWSE_AUDIOBOOK_SOURCES = ALL_AUDIOBOOK_SOURCES;

/** Fill `{q}` for a concrete query. */
export function audiobookSearchUrl(src: AudiobookSource, q: string): string | null {
  if (!src.searchUrl) return null;
  return src.searchUrl.replace("{q}", encodeURIComponent(q));
}

/**
 * Parse LibriVox's JSON API into the app's audiobook shape.
 *
 * Uses `extended=1`, which returns per-section `listen_url` MP3s on archive.org.
 * Verified live: a search for `^alice` returned "Alice's Adventures in
 * Wonderland" with 12 sections pointing at real files.
 */
export function parseLibrivoxJson(json: string): {
  title: string;
  author: string;
  narrator: string;
  link: string;
  coverUrl?: string;
  genres: string[];
  sections: { url: string; title: string }[];
}[] {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const books = Array.isArray(data?.books) ? data.books : [];
  return books
    .filter((b: any) => b && (b.title || b.url_librivox))
    .map((b: any) => {
      const authors = Array.isArray(b.authors) ? b.authors : [];
      const narrator =
        (Array.isArray(b.readers) && b.readers[0]?.name) ||
        b.authors?.[0]?.last_name ||
        "";
      const sections = (Array.isArray(b.sections) ? b.sections : [])
        .map((s: any) => ({
          url: s.listen_url || s.url_zip_file || "",
          title: s.title || "",
        }))
        .filter((s: { url: string }) => Boolean(s.url));
      return {
        title: String(b.title || "").trim(),
        author: authors
          .map((a: any) => [a.first_name, a.last_name].filter(Boolean).join(" "))
          .filter(Boolean)
          .join(", ") || String(b.authors?.[0]?.last_name || ""),
        narrator: String(narrator).trim(),
        link: String(b.url_librivox || "").trim(),
        coverUrl: b.coverart_jpg || b.url_iarchive || undefined,
        genres: (Array.isArray(b.genres) ? b.genres : [])
          .map((g: any) => (typeof g === "string" ? g : g?.name))
          .filter(Boolean),
        sections,
      };
    })
    .filter((b: any) => b.link);
}
