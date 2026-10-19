/**
 * RaveBSD-inspired independent scraper adapters for Kora's Cloudflare Worker.
 *
 * These adapters use source-native public APIs/feeds, validate URLs, isolate failures,
 * rank results by title relevance, and resolve only files actually listed by a provider.
 * No dependency on the retired Rave deployment. Only open/public-domain sources are
 * included here; catalogue/search pages are not misrepresented as direct files.
 */
type ScrapedBook = {
  title: string; author: string; year?: string; format?: string; filesize?: number;
  language?: string; source: string; downloadUrl: string; directUrl?: string;
  directReady?: boolean; coverUrl?: string; identifier?: string; md5?: string;
  pageUrl?: string; length?: string; bitrate?: string; narrator?: string; abridged?: boolean;
  tracks?: number; publisher?: string; description?: string;
};

const UA = "KoraBookSearch/1.0 (+https://github.com/CHAOTIC-RAY/Kora-)";
const timeout = (ms = 8000) => AbortSignal.timeout(ms);
const safeHttp = (value: unknown): string => {
  if (typeof value !== "string") return "";
  try { const u = new URL(value); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : ""; }
  catch { return ""; }
};
const clean = (value: unknown): string => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const norm = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const words = (value: string) => norm(value).split(/\s+/).filter(w => w.length > 1 && !["the","and","for","with","from","into","book"].includes(w));
function relevance(title: string, author: string, query: string): number {
  const q = norm(query), t = norm(title), a = norm(author);
  const wanted = words(query);
  if (!wanted.length) return 0.5;
  const titleWords = new Set(words(title));
  const allWords = new Set(words(title + " " + author));
  const titleCoverage = wanted.filter(word => titleWords.has(word)).length / wanted.length;
  const allCoverage = wanted.filter(word => allWords.has(word)).length / wanted.length;
  // Exact/phrase title hits rank ahead of scattered token matches, while author terms
  // still contribute enough to rescue "title author" queries.
  if (t === q) return 2;
  if (t.startsWith(q) || t.includes(q)) return 1.6 + titleCoverage * 0.2;
  if (a && (a === q || a.includes(q))) return 1.35;
  return titleCoverage * 0.9 + allCoverage * 0.1;
}
type SourceHealth = { failures: number; retryAfter: number; lastStatus?: number; lastError?: string; lastOkAt?: number; lastLatencyMs?: number };
const sourceHealth = new Map<string, SourceHealth>();
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const CACHE_LIMIT = 160;
const CACHE_TTL_MS = 45_000;
const HEALTH_COOLDOWN_MS = 20_000;

function cacheRead<T>(key: string): T | undefined {
  const hit = responseCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) { responseCache.delete(key); return undefined; }
  // Refresh insertion order for a small LRU-like cache.
  responseCache.delete(key);
  responseCache.set(key, hit);
  return hit.value as T;
}
function cacheWrite(key: string, value: unknown): void {
  responseCache.delete(key);
  responseCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  while (responseCache.size > CACHE_LIMIT) responseCache.delete(responseCache.keys().next().value as string);
}
function noteSource(url: string, ok: boolean, latency: number, status?: number, error?: unknown): void {
  let host = "";
  try { host = new URL(url).hostname; } catch { return; }
  const previous = sourceHealth.get(host) || { failures: 0, retryAfter: 0 };
  if (ok) {
    sourceHealth.set(host, { failures: 0, retryAfter: 0, lastOkAt: Date.now(), lastLatencyMs: latency, lastStatus: status });
  } else {
    const failures = previous.failures + 1;
    sourceHealth.set(host, {
      ...previous, failures, retryAfter: failures >= 3 ? Date.now() + HEALTH_COOLDOWN_MS : 0,
      lastStatus: status, lastError: String((error as any)?.message || error || "request failed").slice(0, 120)
    });
  }
}
async function fetchSourceText(url: string, accept: string): Promise<{ text: string; status: number } | null> {
  const cached = cacheRead<{ text: string; status: number }>("text:" + url);
  if (cached) return cached;
  let host = "";
  try { host = new URL(url).hostname; } catch { return null; }
  const health = sourceHealth.get(host);
  // Cooldowns prevent a broken upstream from being hit repeatedly during one burst.
  // A single half-open probe is allowed after the cooldown.
  if (health?.retryAfter && health.retryAfter > Date.now()) return null;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": accept },
        signal: timeout(attempt === 0 ? 8000 : 11000)
      });
      if (res.ok) {
        const text = await res.text();
        noteSource(url, true, Date.now() - started, res.status);
        const result = { text, status: res.status };
        cacheWrite("text:" + url, result);
        return result;
      }
      lastError = new Error("HTTP " + res.status);
      noteSource(url, false, Date.now() - started, res.status, lastError);
      if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } catch (error) {
      lastError = error;
      noteSource(url, false, Date.now() - started, undefined, error);
    }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)));
  }
  return null;
}
async function getJson(url: string): Promise<any | null> {
  const cached = cacheRead<any>("json:" + url);
  if (cached !== undefined) return cached;
  const response = await fetchSourceText(url, "application/json");
  if (!response) return null;
  try {
    const data = JSON.parse(response.text);
    cacheWrite("json:" + url, data);
    return data;
  } catch {
    noteSource(url, false, 0, response.status, "invalid JSON response");
    return null;
  }
}
async function getText(url: string, accept = "application/atom+xml,application/xml,text/plain,*/*;q=0.8"): Promise<string> {
  const response = await fetchSourceText(url, accept);
  return response?.text || "";
}

/** Lightweight health diagnostics for source adapters; never includes credentials or query contents. */
export function getIndependentSourceHealth(): Record<string, { state: string; failures: number; lastStatus?: number; lastLatencyMs?: number; lastError?: string }> {
  return Object.fromEntries([...sourceHealth.entries()].map(([host, value]) => [host, {
    state: value.retryAfter > Date.now() ? "cooldown" : value.lastOkAt ? "ok" : value.failures ? "degraded" : "unknown",
    failures: value.failures, lastStatus: value.lastStatus, lastLatencyMs: value.lastLatencyMs, lastError: value.lastError
  }]));
}

async function searchInternetArchive(query: string, mode: string, page = 1): Promise<ScrapedBook[]> {
  const mediaType = mode === "audiobooks" ? "audio" : "texts";
  const u = new URL("https://archive.org/advancedsearch.php");
  u.searchParams.set("q", query + " AND mediatype:" + mediaType + " AND NOT collection:(inlibrary OR printdisabled) AND NOT access-restricted-item:true");
  ["identifier","title","creator","year","language"].forEach(f => u.searchParams.append("fl[]", f));
  u.searchParams.set("sort[]", "downloads desc");
  u.searchParams.set("rows", "25"); u.searchParams.set("page", String(Math.max(1, page))); u.searchParams.set("output", "json");
  const data = await getJson(u.toString());
  const docs = Array.isArray(data?.response?.docs) ? data.response.docs : [];
  const exts = mode === "audiobooks" ? ["m4b","mp3","m4a","flac"] : ["epub","pdf","mobi","azw3","djvu","txt"];
  return Promise.all(docs.map(async (d: any): Promise<ScrapedBook | null> => {
    const id = String(d.identifier || "");
    if (!/^[a-z0-9._-]{1,160}$/i.test(id)) return null;
    const title = clean(d.title);
    if (!title) return null;
    const meta = await getJson("https://archive.org/metadata/" + encodeURIComponent(id));
    const files = Array.isArray(meta?.files) ? meta.files : [];
    const file = files.filter((f: any) => typeof f.name === "string" && !/^(metadata|__ia_thumb)/i.test(f.name) && exts.includes(f.name.split(".").pop().toLowerCase()))
      .sort((a: any, b: any) => exts.indexOf(a.name.split(".").pop().toLowerCase()) - exts.indexOf(b.name.split(".").pop().toLowerCase()))[0];
    const fileUrl = file ? safeHttp("https://archive.org/download/" + encodeURIComponent(id) + "/" + file.name.split("/").map(encodeURIComponent).join("/")) : "";
    return {
      title, author: Array.isArray(d.creator) ? d.creator.map(clean).join(", ") : clean(d.creator),
      year: String(d.year || ""), format: file?.name?.split(".").pop()?.toLowerCase() || "",
      filesize: Number(file?.size || 0), language: Array.isArray(d.language) ? clean(d.language[0]) : clean(d.language),
      source: "Internet Archive (open access)", downloadUrl: fileUrl,
      pageUrl: "https://archive.org/details/" + encodeURIComponent(id),
      ...(fileUrl ? { directUrl: fileUrl, directReady: true } : {}),
      coverUrl: safeHttp("https://archive.org/services/img/" + encodeURIComponent(id)), identifier: id
    };
  })).then(rows => rows.filter((x): x is ScrapedBook => !!x?.directUrl));
}

async function searchGutenberg(query: string, page = 1): Promise<ScrapedBook[]> {
  let feedUrl = "https://www.gutenberg.org/ebooks/search.opds/?query=" + encodeURIComponent(query);
  let xml = "";
  // Follow OPDS next links for later pages instead of returning page one repeatedly.
  for (let n = 1; n <= Math.min(5, Math.max(1, page)); n++) {
    xml = await getText(feedUrl);
    if (!xml) return [];
    if (n < page) {
      const nextHref = (xml.match(/<link[^>]+rel=["']next["'][^>]+href=["']([^"']+)["']/i) ||
        xml.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']next["']/i) || [])[1];
      if (!nextHref) return [];
      try { feedUrl = new URL(nextHref, feedUrl).toString(); } catch { return []; }
    }
  }
  if (!xml) return [];
  const out: ScrapedBook[] = [];
  for (const entry of xml.split(/<entry(?:\s[^>]*)?>/i).slice(1)) {
    const id = (entry.match(/<id>[^<]*\/ebooks\/(\d+)(?:\.opds)?<\/id>/i) || [])[1];
    if (!id) continue;
    const title = clean((entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
    if (!title) continue;
    const author = clean((entry.match(/<author>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i) || [])[1]);
    const epub = "https://www.gutenberg.org/ebooks/" + id + ".epub3.images";
    out.push({ title, author, source: "Project Gutenberg (public domain)", format: "epub", downloadUrl: epub, directUrl: epub, directReady: true, coverUrl: "https://www.gutenberg.org/cache/epub/" + id + "/pg" + id + ".cover.medium.jpg", identifier: id });
    if (out.length >= 12) break;
  }
  return out;
}
async function searchOpenLibrary(query: string, page = 1): Promise<ScrapedBook[]> {
  const u = new URL("https://openlibrary.org/search.json");
  u.searchParams.set("q", query); u.searchParams.set("limit", "25"); u.searchParams.set("offset", String((Math.max(1, page) - 1) * 25));
  const data = await getJson(u.toString());
  const docs = Array.isArray(data?.docs) ? data.docs : [];
  return docs.map((d: any): ScrapedBook | null => {
    const title = clean(d.title);
    if (!title) return null;
    const key = typeof d.key === "string" && /^\/works\/OL\d+W$/.test(d.key) ? d.key : "";
    const cover = Number(d.cover_i) > 0 ? "https://covers.openlibrary.org/b/id/" + Number(d.cover_i) + "-L.jpg" : "";
    return {
      title, author: Array.isArray(d.author_name) ? d.author_name.map(clean).join(", ") : "",
      year: d.first_publish_year ? String(d.first_publish_year) : "",
      format: "", filesize: 0, language: Array.isArray(d.language) ? clean(d.language[0]) : "",
      source: "Open Library (catalogue)", downloadUrl: "",
      pageUrl: key ? "https://openlibrary.org" + key : "https://openlibrary.org/search?q=" + encodeURIComponent(title),
      coverUrl: safeHttp(cover), identifier: key
    };
  }).filter((x: ScrapedBook | null): x is ScrapedBook => !!x);
}


/** OpenStax's public catalogue; the detail record exposes the official PDF URL. */
async function searchOpenStax(query: string, mode: string): Promise<ScrapedBook[]> {
  if (mode === "audiobooks") return [];
  try {
    const data = await getJson("https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&limit=250");
    const items = Array.isArray(data?.items) ? data.items : [];
    const q = norm(query);
    const matches = items.filter((b: any) => relevance(clean(b.title), "", query) >= 0.45 || norm(clean(b.title)).includes(q)).slice(0, 5);
    const details = await Promise.all(matches.map(async (b: any) => {
      const url = safeHttp(b?.meta?.detail_url);
      if (!url || new URL(url).hostname !== "openstax.org") return null;
      return getJson(url);
    }));
    return details.filter((d: any) => d && safeHttp(d.pdf_url)).map((d: any): ScrapedBook => ({
      title: clean(d.title) || "Unknown Title",
      author: Array.isArray(d.authors) ? d.authors.map((a: any) => clean(a?.value?.name)).filter(Boolean).join(", ") : "",
      year: String(d.publish_date || "").slice(0, 4),
      format: "pdf", filesize: 0, language: "en", source: "OpenStax (open textbook)",
      downloadUrl: safeHttp(d.pdf_url), directUrl: safeHttp(d.pdf_url), directReady: true,
      coverUrl: safeHttp(d.cover_url), identifier: String(d.id || d.meta?.html_url || "")
    }));
  } catch { return []; }
}

/** LibreTexts' public book catalogue returns official generated PDFs when available. */
async function searchLibreTexts(query: string, mode: string, page = 1): Promise<ScrapedBook[]> {
  if (mode === "audiobooks") return [];
  const url = "https://commons.libretexts.org/api/v1/search/books-v2?searchQuery=" + encodeURIComponent(query) + "&limit=10&page=" + String(Math.max(1, page));
  try {
    const data = await getJson(url);
    const books = Array.isArray(data?.results) ? data.results : [];
    return books.filter((b: any) => safeHttp(b?.links?.pdf)).map((b: any): ScrapedBook => ({
      title: clean(b.title) || "Unknown Title", author: clean(b.author), year: "",
      format: "pdf", filesize: 0, language: "", source: "LibreTexts (open textbook)",
      downloadUrl: safeHttp(b.links.pdf), directUrl: safeHttp(b.links.pdf), directReady: true,
      coverUrl: safeHttp(b.thumbnail), identifier: safeHttp(b.links.online)
    }));
  } catch { return []; }
}

/** LibriVox's public-domain audiobook API exposes a ZIP containing its chapter MP3s. */
async function searchLibriVox(query: string, mode: string, page = 1): Promise<ScrapedBook[]> {
  if (mode !== "audiobooks") return [];
  const titleQuery = query.trim().replace(/^(the|a|an)\s+/i, "");
  const url = "https://librivox.org/api/feed/audiobooks/?" + new URLSearchParams({
    title: "^" + titleQuery, format: "json", extended: "1", limit: "10", offset: String((Math.max(1, page) - 1) * 10)
  }).toString();
  try {
    const data = await getJson(url);
    const rows = Array.isArray(data?.books) ? data.books : [];
    return rows.map((b: any): ScrapedBook | null => {
      const download = safeHttp(b.url_zip_file);
      const title = clean(b.title);
      if (!title || !download) return null;
      const archiveId = String(b.url_iarchive || "").match(/archive\.org\/details\/([^/?#]+)/i)?.[1] || "";
      const readers = Array.isArray(b.sections) ? [...new Set(b.sections.flatMap((section: any) =>
        (Array.isArray(section.readers) ? section.readers : []).map((reader: any) => clean(reader.display_name)).filter(Boolean)
      ))].slice(0, 3).join(", ") : "";
      const seconds = Number(b.totaltimesecs) || 0;
      const minutes = Math.round(seconds / 60);
      const length = minutes >= 60 ? Math.floor(minutes / 60) + " h" + (minutes % 60 ? " " + (minutes % 60) + " min" : "") : minutes ? minutes + " min" : "";
      return {
        title, author: Array.isArray(b.authors) ? b.authors.map((a: any) => clean([a.first_name, a.last_name].filter(Boolean).join(" "))).filter(Boolean).join(", ") : "",
        year: b.copyright_year && b.copyright_year !== "0" ? String(b.copyright_year) : "",
        format: "zip", filesize: seconds > 0 ? seconds * 8000 : 0, language: clean(b.language),
        source: "LibriVox (public-domain audiobook)", downloadUrl: download, directUrl: download, directReady: true,
        coverUrl: archiveId ? "https://archive.org/services/img/" + encodeURIComponent(archiveId) : safeHttp(b.url_cover),
        identifier: String(b.id || ""), pageUrl: safeHttp(b.url_librivox), length, bitrate: "64 kbps", narrator: readers, abridged: false
      };
    }).filter((x: ScrapedBook | null): x is ScrapedBook => !!x);
  } catch { return []; }
}

export async function searchIndependentBookSources(query: string, mode = "ebooks", source = "all", page = 1): Promise<{ results: ScrapedBook[]; meta: Record<string, any> }> {
  const q = query.trim();
  if (!q) return { results: [], meta: { sources: {}, fallback: true } };
  const requested = source.toLowerCase();
  const jobs: Array<[string, Promise<ScrapedBook[]>]> = [];
  if (requested === "all" || ["archive","internet-archive","ia"].includes(requested)) jobs.push(["archive", searchInternetArchive(q, mode, page)]);
  if (mode !== "audiobooks" && (requested === "all" || ["gutenberg","project-gutenberg"].includes(requested))) jobs.push(["gutenberg", searchGutenberg(q, page)]);
  if (mode !== "audiobooks" && (requested === "all" || ["openstax","open-stax"].includes(requested))) jobs.push(["openstax", searchOpenStax(q, mode)]);
  if (mode === "audiobooks" && (requested === "all" || ["librivox","libri-vox"].includes(requested))) jobs.push(["librivox", searchLibriVox(q, mode, page)]);
  // Open Library is opt-in only — excluded from default "all" fan-out and
  // from download fallbacks. It remains available as a metadata source when
  // explicitly requested.
  if (mode !== "audiobooks" && ["openlibrary","open-library","metadata"].includes(requested)) {
    jobs.push(["openlibrary", searchOpenLibrary(q, page)]);
  }
  const settled = await Promise.all(jobs.map(async ([id, promise]) => {
    try { return [id, await promise] as [string, ScrapedBook[]]; } catch { return [id, []] as [string, ScrapedBook[]]; }
  }));
  const counts: Record<string, number> = {};
  const all = settled.flatMap(([id, rows]) => { counts[id] = rows.length; return rows; });
  // Keep distinct source/format copies so alternate legitimate files remain available.
  const seen = new Set<string>();
  const ranked = all.filter(book => {
    const key = [norm(book.title), norm(book.author), norm(book.source), norm(book.format || "")].join("|");
    if (!norm(book.title) || seen.has(key)) return false;
    seen.add(key); return true;
  }).map(book => ({ book, score: relevance(book.title, book.author, q) }))
    .sort((a, b) => b.score - a.score || Number(!!b.book.directReady) - Number(!!a.book.directReady));
  const queryTerms = words(q);
  const matching = ranked.filter(({ book, score }) => {
    if (score < 0.25 || !queryTerms.length) return false;
    const requestedDocumentTerms = new Set(queryTerms);
    const archiveDocumentTitle = /\b(letter|collection|cia|reading room|document|memo|report|transcript|correspondence|intelligence file)\b/i.test(book.title);
    const queryRequestsDocument = [...requestedDocumentTerms].some(term => /^(letter|collection|cia|document|memo|report|transcript|correspondence)$/.test(term));
    if (/internet archive/i.test(book.source) && archiveDocumentTitle && !queryRequestsDocument) return false;
    const searchable = new Set(words(`${book.title} ${book.author}`));
    const coverage = queryTerms.filter(term => searchable.has(term)).length / queryTerms.length;
    // Multiword searches often contain both title and author. Require most of
    // those terms to be present so Archive full-text hits do not leak through.
    return coverage >= (queryTerms.length >= 3 ? 0.75 : 1);
  });
  const results = matching.slice(0, 25).map(x => x.book);
  return { results, meta: { fallback: true, sources: counts, total: results.length, mode, query: q, page, hasMore: results.length >= 25 } };
}

export async function searchIndependentPopularBooks(): Promise<any> {
  const topics = [
    { name: "Public-Domain Classics", q: "classic novels", mode: "ebooks", source: "gutenberg" },
    { name: "Open Textbooks", q: "biology", mode: "ebooks", source: "openstax" },
    { name: "Free Audiobooks", q: "Sherlock Holmes", mode: "audiobooks", source: "librivox" }
  ];
  const lists = await Promise.all(topics.map(async topic => {
    const result = await searchIndependentBookSources(topic.q, topic.mode, topic.source);
    const books = result.results.slice(0, 8).map(b => ({
      title: b.title, author: b.author || "Unknown Author", book_image: b.coverUrl || "",
      description: b.description || "", primary_isbn13: "", source: b.source,
      downloadUrl: b.directUrl || b.downloadUrl, format: b.format || "",
      pageUrl: b.pageUrl || ""
    }));
    return { list_name: topic.q, display_name: topic.name, list_name_encoded: topic.name.toLowerCase().replace(/\s+/g, "-"), books };
  }));
  return { status: "OK", results: { lists: lists.filter(x => x.books.length) } };
}
