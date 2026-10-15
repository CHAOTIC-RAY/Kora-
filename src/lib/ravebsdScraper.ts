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

export async function searchIndependentBookSources(query: string, mode = "ebooks", source = "all"): Promise<{ results: ScrapedBook[]; meta: Record<string, any> }> {
  const q = query.trim();
  if (!q) return { results: [], meta: { sources: {}, fallback: true } };
  const requested = source.toLowerCase();
  const jobs: Array<[string, Promise<ScrapedBook[]>]> = [];
  if (requested === "all" || ["archive","internet-archive","ia"].includes(requested)) jobs.push(["archive", searchInternetArchive(q, mode)]);
  if (mode !== "audiobooks" && (requested === "all" || ["gutenberg","project-gutenberg"].includes(requested))) jobs.push(["gutenberg", searchGutenberg(q)]);
  if (mode !== "audiobooks" && (requested === "all" || ["openlibrary","open-library","metadata"].includes(requested))) jobs.push(["openlibrary", searchOpenLibrary(q)]);
  const settled = await Promise.all(jobs.map(async ([id, promise]) => {
    try { return [id, await promise] as [string, ScrapedBook[]]; } catch { return [id, []] as [string, ScrapedBook[]]; }
  }));
  const counts: Record<string, number> = {};
  const all = settled.flatMap(([id, rows]) => { counts[id] = rows.length; return rows; });
  const seen = new Set<string>();
  const results = all.filter(book => {
    const key = norm(book.title) + "|" + norm(book.author);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).map(book => ({ book, score: relevance(book.title, book.author, q) }))
    .filter(x => x.score >= 0.25)
    .sort((a, b) => b.score - a.score || Number(!!b.book.directReady) - Number(!!a.book.directReady))
    .slice(0, 25).map(x => x.book);
  return { results, meta: { fallback: true, sources: counts, total: results.length } };
}

export async function searchIndependentPopularBooks(): Promise<any> {
  const queries = ["popular classic novels", "science fiction classics", "public domain children's books"];
  const lists = await Promise.all(queries.map(async (q) => {
    const [gutenberg, archive] = await Promise.all([searchGutenberg(q), searchInternetArchive(q, "ebooks")]);
    const books = [...gutenberg, ...archive].filter(b => b.title).slice(0, 8).map(b => ({
      title: b.title, author: b.author || "Unknown Author", book_image: b.coverUrl || "",
      description: "", primary_isbn13: "", source: b.source, downloadUrl: b.directUrl || b.downloadUrl
    }));
    return { list_name: q, display_name: q.replace(/\b\w/g, c => c.toUpperCase()), list_name_encoded: q.replace(/\s+/g, "-"), books };
  }));
  return { status: "OK", results: { lists: lists.filter(x => x.books.length) } };
}
