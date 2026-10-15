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
  const wanted = words(query), hay = new Set(words(title + " " + author));
  if (!wanted.length) return 0.5;
  const overlap = wanted.filter(w => hay.has(w)).length / wanted.length;
  return norm(title) === norm(query) ? 2 : overlap;
}
async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: timeout() });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function getText(url: string, accept = "application/atom+xml,application/xml,text/plain,*/*;q=0.8"): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": accept }, signal: timeout() });
    return res.ok ? await res.text() : "";
  } catch { return ""; }
}

async function searchInternetArchive(query: string, mode: string): Promise<ScrapedBook[]> {
  const mediaType = mode === "audiobooks" ? "audio" : "texts";
  const u = new URL("https://archive.org/advancedsearch.php");
  u.searchParams.set("q", query + " AND mediatype:" + mediaType + " AND NOT collection:(inlibrary OR printdisabled) AND NOT access-restricted-item:true");
  ["identifier","title","creator","year","language"].forEach(f => u.searchParams.append("fl[]", f));
  u.searchParams.set("sort[]", "downloads desc");
  u.searchParams.set("rows", "8"); u.searchParams.set("page", "1"); u.searchParams.set("output", "json");
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
      source: "Internet Archive (open access)", downloadUrl: "https://archive.org/details/" + encodeURIComponent(id),
      ...(fileUrl ? { directUrl: fileUrl, directReady: true } : {}),
      coverUrl: safeHttp("https://archive.org/services/img/" + encodeURIComponent(id)), identifier: id
    };
  })).then(rows => rows.filter((x): x is ScrapedBook => !!x));
}

async function searchGutenberg(query: string): Promise<ScrapedBook[]> {
  const xml = await getText("https://www.gutenberg.org/ebooks/search.opds/?query=" + encodeURIComponent(query));
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

async function searchOpenLibrary(query: string): Promise<ScrapedBook[]> {
  const u = new URL("https://openlibrary.org/search.json");
  u.searchParams.set("q", query); u.searchParams.set("limit", "12");
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
      source: "Open Library (catalogue)", downloadUrl: key ? "https://openlibrary.org" + key : "https://openlibrary.org/search?q=" + encodeURIComponent(title),
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
async function searchLibreTexts(query: string, mode: string): Promise<ScrapedBook[]> {
  if (mode === "audiobooks") return [];
  const url = "https://commons.libretexts.org/api/v1/search/books-v2?searchQuery=" + encodeURIComponent(query) + "&limit=10&page=1";
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
async function searchLibriVox(query: string, mode: string): Promise<ScrapedBook[]> {
  if (mode !== "audiobooks") return [];
  const titleQuery = query.trim().replace(/^(the|a|an)\s+/i, "");
  const url = "https://librivox.org/api/feed/audiobooks/?" + new URLSearchParams({
    title: "^" + titleQuery, format: "json", extended: "1", limit: "10"
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

export async function searchIndependentBookSources(query: string, mode = "ebooks", source = "all"): Promise<{ results: ScrapedBook[]; meta: Record<string, any> }> {
  const q = query.trim();
  if (!q) return { results: [], meta: { sources: {}, fallback: true } };
  const requested = source.toLowerCase();
  const jobs: Array<[string, Promise<ScrapedBook[]>]> = [];
  if (requested === "all" || ["archive","internet-archive","ia"].includes(requested)) jobs.push(["archive", searchInternetArchive(q, mode)]);
  if (mode !== "audiobooks" && (requested === "all" || ["gutenberg","project-gutenberg"].includes(requested))) jobs.push(["gutenberg", searchGutenberg(q)]);
  if (mode !== "audiobooks" && (requested === "all" || ["openstax","open-stax"].includes(requested))) jobs.push(["openstax", searchOpenStax(q, mode)]);
  if (mode !== "audiobooks" && (requested === "all" || ["libretexts","libre-texts"].includes(requested))) jobs.push(["libretexts", searchLibreTexts(q, mode)]);
  if (mode === "audiobooks" && (requested === "all" || ["librivox","libri-vox"].includes(requested))) jobs.push(["librivox", searchLibriVox(q, mode)]);
  if (mode !== "audiobooks" && (requested === "all" || ["openlibrary","open-library","metadata"].includes(requested))) jobs.push(["openlibrary", searchOpenLibrary(q)]);
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
  const matching = ranked.filter(x => x.score >= 0.25);
  const results = (matching.length ? matching : ranked).slice(0, 25).map(x => x.book);
  return { results, meta: { fallback: true, sources: counts, total: results.length, mode, query: q } };
}

export async function searchIndependentPopularBooks(): Promise<any> {
  const topics = [
    { name: "Public-Domain Classics", q: "classic novels", mode: "ebooks" },
    { name: "Open Textbooks", q: "biology", mode: "ebooks" },
    { name: "Science & Learning", q: "physics", mode: "ebooks" },
    { name: "Free Audiobooks", q: "Sherlock Holmes", mode: "audiobooks" }
  ];
  const lists = await Promise.all(topics.map(async topic => {
    const result = await searchIndependentBookSources(topic.q, topic.mode, "all");
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
