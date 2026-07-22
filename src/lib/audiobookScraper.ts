import * as cheerio from "cheerio";
import { normalizeMediaUrl } from "./mediaUrl";

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
  listenUrl?: string;
  listenUrlAlt?: string;
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
        const src = normalizeMediaUrl(toAbsoluteUrl(item.src || item.url || item.file || "", baseUrl));
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

    src = normalizeMediaUrl(toAbsoluteUrl(src, baseUrl));
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
    const src = normalizeMediaUrl(toAbsoluteUrl(match[1], baseUrl));
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
  const seen = new Set<string>();

  const pushResult = (rawTitle: string, link: string, coverUrl: string | null, authorHint = "") => {
    if (results.length >= maxResults || !rawTitle || rawTitle.length < 3) return;
    const absoluteLink = link.startsWith("http") ? link : `${baseUrl}${link}`;
    if (seen.has(absoluteLink)) return;
    seen.add(absoluteLink);
    const { title, author } = parseAudiobookTitleAuthor(rawTitle, authorHint);
    if (coverUrl) coverUrl = toAbsoluteUrl(coverUrl, baseUrl);
    results.push({ title, author, coverUrl, link: absoluteLink, source: sourceName });
  };

  // HD Audiobooks feed/search layout
  $("article.post, article[class*='post-']").each((_i, el) => {
    const item = $(el);
    const titleEl = item.find("h2 a").first();
    const rawTitle = (titleEl.attr("title") || titleEl.text()).trim();
    const link = titleEl.attr("href") || "";
    const coverUrl = item.find("img.wp-post-image, img.thumbnail, img").first().attr("src") || null;
    if (rawTitle && link) pushResult(rawTitle, link, coverUrl);
  });

  // FullLength Audiobooks + generic WordPress
  $("article, .post, .entry, .book-item, .product").each((_i, el) => {
    if (results.length >= maxResults) return false as any;
    const item = $(el);
    const titleEl = item.find("h2.entry-title a, h2.post-title a, h2 a, h3 a, .entry-title a, .post-title a").first();
    const rawTitle = titleEl.text().trim();
    const link = titleEl.attr("href") || item.find("a").first().attr("href") || "";
    let coverUrl = item.find("img.wp-post-image, img").first().attr("src") || item.find("img").first().attr("data-src") || null;
    const author = item.find(".author, .book-author, .entry-meta").first().text().replace(/by\s+/i, "").trim() || "";
    if (!rawTitle || rawTitle.length < 3) return;
    pushResult(rawTitle, link, coverUrl, author);
  });

  return results;
}

/** Parse "Title Audiobook – Author" or "Author – Title Audiobook Free" formats */
export function parseAudiobookTitleAuthor(raw: string, authorHint = ""): { title: string; author: string } {
  const cleaned = raw.replace(/&#8211;/g, "–").replace(/&amp;/g, "&").trim();
  const audiobookMatch = cleaned.match(/^(.+?)\s+Audiobook\s*[–-]\s*(.+)$/i);
  if (audiobookMatch) {
    return { title: audiobookMatch[1].trim(), author: audiobookMatch[2].replace(/\s*Free$/i, "").trim() };
  }
  const authorFirstMatch = cleaned.match(/^(.+?)\s*[–-]\s*(.+?)\s+Audiobook/i);
  if (authorFirstMatch) {
    return { title: authorFirstMatch[2].trim(), author: authorFirstMatch[1].trim() };
  }
  return { title: cleaned.replace(/\s+Audiobook.*$/i, "").trim(), author: authorHint };
}

/** Scrape homepage feed from hdaudiobooks.com */
export function parseHdAudiobooksFeed(html: string, baseUrl = "https://hdaudiobooks.com"): AudiobookSearchResult[] {
  return parseAudiobookSearchHtml(html, "hdaudiobooks", baseUrl, 12);
}

/** Scrape homepage feed from fulllengthaudiobooks.com */
export function parseFullLengthAudiobooksFeed(html: string, baseUrl = "https://fulllengthaudiobooks.com"): AudiobookSearchResult[] {
  return parseAudiobookSearchHtml(html, "fulllengthaudiobooks", baseUrl, 12);
}

/** Search both audiobook sources; tries fulllength first (better hit rate). */
export async function searchAudiobooksFromSources(
  fetchHtml: (url: string) => Promise<string>,
  q: string,
  maxResults = 16
): Promise<AudiobookSearchResult[]> {
  const results: AudiobookSearchResult[] = [];
  const seen = new Set<string>();

  const addBatch = (books: AudiobookSearchResult[]) => {
    for (const b of books) {
      if (results.length >= maxResults || seen.has(b.link)) continue;
      seen.add(b.link);
      results.push(b);
    }
  };

  const sources = [
    { name: "fulllengthaudiobooks", url: `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(q)}`, base: "https://fulllengthaudiobooks.com" },
    { name: "hdaudiobooks", url: `https://hdaudiobooks.com/?s=${encodeURIComponent(q)}`, base: "https://hdaudiobooks.com" },
  ];

  await Promise.allSettled(
    sources.map(async (src) => {
      try {
        const html = await fetchHtml(src.url);
        addBatch(parseAudiobookSearchHtml(html, src.name, src.base, maxResults));
      } catch {
        /* skip failed source */
      }
    })
  );

  return results;
}

export async function scrapePopularAudiobooks(
  fetchHtml: (url: string) => Promise<string>
): Promise<any[]> {
  const results: any[] = [];
  const seen = new Set<string>();

  const addBooks = (books: AudiobookSearchResult[], source: string) => {
    for (const b of books) {
      if (results.length >= 12 || seen.has(b.link)) continue;
      seen.add(b.link);
      results.push({
        rank: results.length + 1,
        title: b.title,
        author: b.author || "Unknown",
        description: `Listen free on ${source === "hdaudiobooks" ? "HDAudiobooks" : "FullLengthAudiobooks"}.`,
        coverUrl: b.coverUrl || `/api/cover-redirect?type=audiobook&title=${encodeURIComponent(b.title)}&author=${encodeURIComponent(b.author || "")}`,
        link: b.link,
        listenUrl: b.link,
        listenUrlAlt: b.link,
        source: "audiobook",
      });
    }
  };

  await Promise.allSettled([
    fetchHtml("https://hdaudiobooks.com/")
      .then((html) => addBooks(parseHdAudiobooksFeed(html), "hdaudiobooks"))
      .catch(() => {}),
    fetchHtml("https://fulllengthaudiobooks.com/")
      .then((html) => addBooks(parseFullLengthAudiobooksFeed(html), "fulllengthaudiobooks"))
      .catch(() => {}),
  ]);

  return results;
}

/** If given a search URL, extract the first book detail page link from search results. */
export function extractFirstBookLinkFromSearch(html: string, baseUrl: string): string | null {
  const results = parseAudiobookSearchHtml(html, "", baseUrl, 5);
  // Prefer links that look like book detail pages, not search/category pages
  const detail = results.find((r) =>
    r.link &&
    !r.link.includes("?s=") &&
    !r.link.includes("/search/") &&
    !r.link.includes("/page/") &&
    !r.link.includes("/category/") &&
    !r.link.includes("/author/")
  );
  return detail?.link || results[0]?.link || null;
}

export function isAudiobookSearchUrl(pageUrl: string): boolean {
  try {
    const u = new URL(pageUrl);
    if (u.searchParams.has("s") && (u.pathname === "/" || u.pathname === "")) return true;
    if (u.pathname.includes("/search/")) return true;
    return false;
  } catch {
    return false;
  }
}

export function normalizeAudiobookTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/&#8211;/g, " ")
    .replace(/&amp;/g, "and")
    .replace(/[^\w\s]/g, " ")
    .replace(/\baudiobook\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fuzzy title match — avoids returning the wrong book from search results. */
export function titlesRoughlyMatch(expected: string, actual: string): boolean {
  const a = normalizeAudiobookTitle(expected);
  const b = normalizeAudiobookTitle(actual);
  if (!a || !b) return true;
  if (a === b) return true;
  if (b.includes(a) || a.includes(b)) return true;
  const aWords = a.split(" ").filter((w) => w.length > 2);
  const bWords = new Set(b.split(" ").filter((w) => w.length > 2));
  if (!aWords.length) return true;
  const overlap = aWords.filter((w) => bWords.has(w)).length;
  return overlap >= Math.max(1, Math.ceil(aWords.length * 0.6));
}

/** Pick the search result that best matches the expected title. */
export function extractBestBookLinkFromSearch(
  html: string,
  baseUrl: string,
  expectedTitle: string
): string | null {
  const results = parseAudiobookSearchHtml(html, "", baseUrl, 12);
  const match = results.find((r) => titlesRoughlyMatch(expectedTitle, r.title));
  if (match?.link) return match.link;
  return extractFirstBookLinkFromSearch(html, baseUrl);
}

export function mapPopularAudiobooks() {
  return POPULAR_AUDIOBOOKS.map((b: any) => ({
    ...b,
    coverUrl: `/api/cover-redirect?type=audiobook&title=${encodeURIComponent(b.title)}&author=${encodeURIComponent(b.author)}`,
    link: `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(b.title)}`,
    listenUrl: `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(b.title)}`,
    listenUrlAlt: `https://hdaudiobooks.com/?s=${encodeURIComponent(b.title)}`,
  }));
}
