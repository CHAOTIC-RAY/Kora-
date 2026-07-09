async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function fetchFromRaveBookSearch(env: any, query: string, mode: string = "ebooks", source: string = "all", page: string = "1") {
  const url = `https://ravebooksearch.cloudflare-s3cvv.workers.dev/search/all?q=${encodeURIComponent(query)}&mode=${mode}&source=${source}&page=${page}`;
  try {
    let res;
    if (env && env.RAVE_BOOK_SEARCH) {
      console.log("Using Cloudflare Service Binding RAVE_BOOK_SEARCH in Pages Function");
      res = await env.RAVE_BOOK_SEARCH.fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        }
      });
    } else {
      console.log("Falling back to public fetch for Rave Book Search in Pages Function");
      res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        }
      });
    }

    if (!res.ok) {
      return { results: [], meta: {} };
    }

    const data = await res.json() as any;
    const rawResults: any[] = data.results || [];
    const meta = data.meta || {};

    if (rawResults.length === 0) {
      return { results: [], meta: meta };
    }

    const mapped = [];
    for (const r of rawResults) {
      let title = (r.title || "").replace(/;[^;]{0,4}\d{10,13}[^;]*/g, "").trim();
      title = title.replace(/ b [fl] \d+$/i, "").trim();

      let author = (r.author || "Unknown Author")
        .replace(/[,;]$/, "")
        .trim();
      if (author.endsWith(",")) author = author.slice(0, -1);

      let extension = (r.format || "").toLowerCase().replace(/^\./, "");
      if (!extension && (r.directUrl || r.downloadUrl)) {
        const url = (r.directUrl || r.downloadUrl).toLowerCase();
        if (url.endsWith(".pdf")) extension = "pdf";
        else if (url.endsWith(".epub")) extension = "epub";
        else if (url.endsWith(".mobi")) extension = "mobi";
        else if (url.endsWith(".azw3")) extension = "azw3";
      }
      if (!extension) extension = "epub";

      let md5 = r.md5 || "";
      if (!md5) {
        const uniqueString = r.directUrl || r.downloadUrl || (r.title + r.author + extension);
        md5 = await sha256(uniqueString);
      }

      let size = "Unknown";
      if (r.filesize && r.filesize > 0) {
        const bytes = parseInt(r.filesize);
        if (bytes > 1048576) size = (bytes / 1048576).toFixed(1) + " MB";
        else if (bytes > 1024) size = Math.round(bytes / 1024) + " KB";
        else size = bytes + " B";
      } else if (r.size) {
        size = r.size;
      }

      const isbnMatch = (r.title || "").match(/(\d{10,13})/);
      const isbn = isbnMatch ? isbnMatch[1] : null;

      let coverUrl = r.coverUrl || "";
      if (!coverUrl && isbn && /^\d{10,13}$/.test(isbn)) {
        coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
      }
      if (!coverUrl) {
        coverUrl = `https://annas-archive.gl/covers/${md5}.jpg`;
      }

      mapped.push({
        id: md5,
        md5,
        isbn: isbn || null,
        title,
        author,
        extension: extension.toUpperCase(),
        size: size,
        source: r.source || "Rave",
        downloadUrl: r.directUrl || r.downloadUrl || "",
        coverUrl
      });
    }

    return { results: mapped, meta };
  } catch (err) {
    console.error("fetchFromRaveBookSearch error:", err);
    return { results: [], meta: {} };
  }
}

export const onRequest = async (context: any) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const mode = url.searchParams.get("mode") || "ebooks";
  const source = url.searchParams.get("source") || "all";
  const page = url.searchParams.get("page") || "1";

  if (!query) {
    return new Response(JSON.stringify({ error: "Query 'q' is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  try {
    const { results: raveResults, meta } = await fetchFromRaveBookSearch(env, query, mode, source, page);
    const RESULTS_PER_PAGE = 25;
    const totalFromMeta = meta.total && meta.total > 0 ? meta.total : null;
    const searchPage = parseInt(page) || 1;
    const hasMore = raveResults.length >= RESULTS_PER_PAGE ||
      (totalFromMeta !== null && searchPage * RESULTS_PER_PAGE < totalFromMeta);
    const totalCount = totalFromMeta ?? (hasMore ? (searchPage * RESULTS_PER_PAGE) + RESULTS_PER_PAGE : raveResults.length);

    return new Response(JSON.stringify({
      books: raveResults,
      results: raveResults,
      source: source,
      page: searchPage,
      pageSize: raveResults.length,
      meta: meta,
      totalCount,
      hasMore,
      mirror: "Rave Official Site",
      parsedBy: "Edge API Proxy"
    }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
};
