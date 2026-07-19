import * as cheerio from "cheerio";

export interface AudiobookTrack {
  index: number;
  title: string;
  src: string;
}

export interface AudiobookDetail {
  title: string;
  author?: string;
  coverUrl?: string;
  tracks: AudiobookTrack[];
  sourceUrl: string;
  source: string;
}

export interface AudiobookSearchResult {
  title: string;
  author: string;
  coverUrl: string | null;
  link: string;
  source: string;
}

export const POPULAR_AUDIOBOOKS = [
  { rank: 1, title: "Atomic Habits", author: "James Clear", isbn: "9780735211292", description: "Practical strategies for building good habits — one of the most downloaded audiobooks of all time.", rating: 4.8, source: "audiobook" },
  { rank: 2, title: "Project Hail Mary", author: "Andy Weir", isbn: "9780593135204", description: "Award-winning sci-fi narrated by Ray Porter — a solo astronaut's mission to save Earth.", rating: 4.9, source: "audiobook" },
  { rank: 3, title: "Where the Crawdads Sing", author: "Delia Owens", isbn: "9780735224292", description: "One of the most downloaded audiobooks — a murder mystery and coming-of-age story.", rating: 4.7, source: "audiobook" },
  { rank: 4, title: "Educated", author: "Tara Westover", isbn: "9780399590504", description: "Narrated by the author — a gripping memoir about seeking education against all odds.", rating: 4.7, source: "audiobook" },
  { rank: 5, title: "Daisy Jones & The Six", author: "Taylor Jenkins Reid", isbn: "9781524798628", description: "Full cast production — the rise and fall of a 1970s rock band, narrated like a documentary.", rating: 4.6, source: "audiobook" },
  { rank: 6, title: "Dune", author: "Frank Herbert", isbn: "9780441013593", description: "Full cast production of the sci-fi classic — an unparalleled listening experience.", rating: 4.6, source: "audiobook" },
  { rank: 7, title: "The Midnight Library", author: "Matt Haig", isbn: "9780525559474", description: "Narrated by Carey Mulligan — a novel about choices and the lives we could have lived.", rating: 4.5, source: "audiobook" },
  { rank: 8, title: "The Great Alone", author: "Kristin Hannah", isbn: "9781250301697", description: "A powerful story of love and survival in the Alaskan wilderness.", rating: 4.6, source: "audiobook" },
];

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function toAbsoluteUrl(url: string, baseUrl: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function extractTitleFromPage($: cheerio.CheerioAPI): string {
  const ogTitle = $('meta[property="og:title"]').attr("content");
  if (ogTitle) return ogTitle.replace(/\s*audiobook.*/i, "").trim();
  const h1 = $("h1.entry-title, h1.post-title, article h1, h1").first().text().trim();
  if (h1) return h1.replace(/\s*audiobook.*/i, "").trim();
  return $("title").text().replace(/\s*[-|].*$/, "").trim();
}

function extractAuthorFromPage($: cheerio.CheerioAPI): string {
  const author =
    $(".author, .book-author, .entry-meta .author, .posted-by a").first().text().trim() ||
    $('meta[name="author"]').attr("content") ||
    "";
  return author.replace(/^by\s+/i, "").trim();
}

function extractCoverFromPage($: cheerio.CheerioAPI, baseUrl: string): string | undefined {
  const papCover = $(".pap-player-container").attr("data-cover");
  if (papCover) return toAbsoluteUrl(decodeHtmlEntities(papCover), baseUrl);

  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) return toAbsoluteUrl(ogImage, baseUrl);

  const featured = $("article img, .post-thumbnail img, .entry-content img").first().attr("src");
  if (featured) return toAbsoluteUrl(featured, baseUrl);

  return undefined;
}

function parsePapPlaylist(html: string, baseUrl: string): AudiobookTrack[] {
  const $ = cheerio.load(html);
  const container = $(".pap-player-container").first();
  const rawPlaylist = container.attr("data-playlist");
  if (!rawPlaylist) return [];

  try {
    const decoded = decodeHtmlEntities(rawPlaylist);
    const playlist = JSON.parse(decoded);
    if (!Array.isArray(playlist)) return [];

    return playlist
      .map((item: any, idx: number) => {
        const src = toAbsoluteUrl(item.src || item.url || item.file || "", baseUrl);
        if (!src) return null;
        return {
          index: idx,
          title: (item.title || item.name || `Chapter ${idx + 1}`).trim(),
          src,
        };
      })
      .filter(Boolean) as AudiobookTrack[];
  } catch {
    return [];
  }
}

function parseAudioElements(html: string, baseUrl: string): AudiobookTrack[] {
  const $ = cheerio.load(html);
  const tracks: AudiobookTrack[] = [];
  const seen = new Set<string>();

  $("audio").each((idx, el) => {
    const audio = $(el);
    let src =
      audio.attr("src") ||
      audio.find("source").first().attr("src") ||
      "";

    if (!src) {
      const dataSrc = audio.attr("data-src") || audio.attr("data-url");
      if (dataSrc) src = dataSrc;
    }

    src = toAbsoluteUrl(src, baseUrl);
    if (!src || seen.has(src)) return;
    seen.add(src);

    const title =
      audio.attr("title") ||
      audio.closest("article, .post, .entry, p, div").find("h2, h3, strong").first().text().trim() ||
      `Part ${tracks.length + 1}`;

    tracks.push({ index: tracks.length, title, src });
  });

  return tracks;
}

function parseMp3LinksFromHtml(html: string, baseUrl: string): AudiobookTrack[] {
  const mp3Regex = /(https?:\/\/[^\s"'<>]+\.mp3)/gi;
  const seen = new Set<string>();
  const tracks: AudiobookTrack[] = [];

  let match: RegExpExecArray | null;
  while ((match = mp3Regex.exec(html)) !== null) {
    const src = toAbsoluteUrl(match[1], baseUrl);
    if (seen.has(src)) continue;
    seen.add(src);
    const filename = src.split("/").pop()?.replace(/\.mp3$/i, "") || `Part ${tracks.length + 1}`;
    tracks.push({
      index: tracks.length,
      title: decodeURIComponent(filename).replace(/[_-]/g, " "),
      src,
    });
  }

  return tracks;
}

export function parseAudiobookDetailHtml(html: string, pageUrl: string): AudiobookDetail {
  const $ = cheerio.load(html);
  const baseUrl = new URL(pageUrl).origin;

  let tracks = parsePapPlaylist(html, baseUrl);
  if (tracks.length === 0) tracks = parseAudioElements(html, baseUrl);
  if (tracks.length === 0) tracks = parseMp3LinksFromHtml(html, baseUrl);

  const source = pageUrl.includes("fulllengthaudiobooks") ? "fulllengthaudiobooks" : "hdaudiobooks";

  return {
    title: extractTitleFromPage($),
    author: extractAuthorFromPage($),
    coverUrl: extractCoverFromPage($, baseUrl),
    tracks,
    sourceUrl: pageUrl,
    source,
  };
}

export function parseAudiobookSearchHtml(html: string, sourceName: string, baseUrl: string, maxResults = 16): AudiobookSearchResult[] {
  const $ = cheerio.load(html);
  const results: AudiobookSearchResult[] = [];

  $("article, .post, .entry, .book-item, .product").each((_i, el) => {
    if (results.length >= maxResults) return false as any;
    const item = $(el);
    const titleEl = item.find("h2 a, h3 a, .entry-title a, .post-title a, h2, h3").first();
    const title = titleEl.text().trim();
    const link = titleEl.attr("href") || item.find("a").first().attr("href") || "";
    let coverUrl = item.find("img").first().attr("src") || item.find("img").first().attr("data-src") || null;
    const author = item.find(".author, .book-author, .entry-meta").first().text().replace(/by\s+/i, "").trim() || "";
    if (!title || title.length < 3) return;
    const absoluteLink = link.startsWith("http") ? link : `${baseUrl}${link}`;
    if (coverUrl) coverUrl = toAbsoluteUrl(coverUrl, baseUrl);
    results.push({ title, author, coverUrl, link: absoluteLink, source: sourceName });
  });

  return results;
}

/** If given a search URL, extract the first book detail page link from search results. */
export function extractFirstBookLinkFromSearch(html: string, baseUrl: string): string | null {
  const results = parseAudiobookSearchHtml(html, "", baseUrl, 1);
  return results[0]?.link || null;
}

export function isAudiobookSearchUrl(pageUrl: string): boolean {
  try {
    const u = new URL(pageUrl);
    return u.searchParams.has("s") && (u.pathname === "/" || u.pathname === "");
  } catch {
    return false;
  }
}

export function mapPopularAudiobooks() {
  return POPULAR_AUDIOBOOKS.map((b: any) => ({
    ...b,
    coverUrl: b.isbn
      ? `https://covers.openlibrary.org/b/isbn/${b.isbn}-M.jpg`
      : `/api/cover-redirect?title=${encodeURIComponent(b.title)}&author=${encodeURIComponent(b.author)}`,
    listenUrl: `https://hdaudiobooks.com/?s=${encodeURIComponent(b.title)}`,
    listenUrlAlt: `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(b.title)}`,
  }));
}
