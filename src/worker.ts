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
      console.log("Using Cloudflare Service Binding RAVE_BOOK_SEARCH");
      res = await env.RAVE_BOOK_SEARCH.fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        }
      });
    } else {
      console.log("Falling back to public fetch for Rave Book Search");
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

export interface Env {
  BROWSER: any;
  NYT_API_KEY?: string;
  NYT_BOOKS_API_KEY?: string;
  RAVE_BOOK_SEARCH?: any;
}

const FALLBACK_DOMAINS = {
  success: 1,
  domains: [
    { domain: "z-library.sk", contentAvailable: true, isRedirector: false },
    { domain: "article.sk", contentAvailable: true, isRedirector: false },
    { domain: "articles.sk", contentAvailable: true, isRedirector: false },
    { domain: "proxy.zlibraryproxies.workers.dev", contentAvailable: true, isRedirector: false },
    { domain: "1lib.su" },
    { domain: "zlib.by" },
    { domain: "101ml.su" },
    { domain: "zlib.re" }
  ]
};

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflights
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
          "Access-Control-Allow-Credentials": "true"
        }
      });
    }

    // 1. Anna's Archive Search (Rave Book Search Scraper)
    if (path === "/api/annas-archive/search") {
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
    }

    // 2. NYT Best Sellers API
    if (path === "/api/nytimes/overview" || path === "/api/nyt/overview") {
      try {
        const apiKey = env.NYT_BOOKS_API_KEY || env.NYT_API_KEY || "";
        const res = await fetch(`https://api.nytimes.com/svc/books/v3/lists/overview.json?api-key=${apiKey}`);
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: "Failed to fetch NYT data", details: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    if (path === "/api/nytimes/recommendations" && request.method === "POST") {
      try {
        let body: any = {};
        try {
          body = await request.json();
        } catch (_) {}
        const { library = [], recentSearches = [] } = body;
        const apiKey = env.NYT_BOOKS_API_KEY || env.NYT_API_KEY || "";

        let allNytBooks: any[] = [];
        if (apiKey && apiKey.trim() !== "") {
          try {
            const response = await fetch(`https://api.nytimes.com/svc/books/v3/lists/overview.json?api-key=${apiKey}`);
            if (response.ok) {
              const data: any = await response.json();
              if (data.status === "OK") {
                const lists = data.results?.lists || [];
                allNytBooks = lists.flatMap((list: any) =>
                  (list.books || []).map((b: any) => ({
                    title: b.title,
                    author: b.author,
                    coverUrl: b.book_image,
                    description: b.description,
                    primary_isbn13: b.primary_isbn13,
                    list_name: list.display_name,
                    list_id: list.list_name_encoded
                  }))
                );
              }
            }
          } catch (err) {
            console.error("Failed to fetch NYT Best Sellers for recommendations in Worker:", err);
          }
        }

        const recommendations: any[] = [];
        const usedNyt = new Set<string>();

        const searchTerms = [
          ...recentSearches.map((s: any) => String(s || "").toLowerCase()),
          ...library.map((b: any) => String(b?.title || "").toLowerCase()),
          ...library.map((b: any) => String(b?.author || "").toLowerCase())
        ].filter(Boolean);

        for (const b of allNytBooks) {
          if (recommendations.length >= 5) break;
          const titleLower = String(b.title || "").toLowerCase();
          const authorLower = String(b.author || "").toLowerCase();

          const isMatch = searchTerms.some(term => 
            term.length > 2 && (titleLower.includes(term) || authorLower.includes(term) || term.includes(titleLower) || term.includes(authorLower))
          );

          if (isMatch) {
            recommendations.push({
              title: b.title,
              author: b.author,
              reason: `Highly matching your interest in ${b.author || "this genre"}. This current NYT Best Seller in ${b.list_name} aligns with your library and recent searches!`,
              matchingNytBook: true,
              isbn: b.primary_isbn13,
              coverUrl: b.coverUrl
            });
            usedNyt.add(b.title.toUpperCase());
          }
        }

        if (allNytBooks.length > 0) {
          for (const b of allNytBooks) {
            if (recommendations.length >= 5) break;
            if (usedNyt.has(b.title.toUpperCase())) continue;

            recommendations.push({
              title: b.title,
              author: b.author,
              reason: `A trending literary masterpiece! Recommended from the latest NYT Bestseller List for ${b.list_name}.`,
              matchingNytBook: true,
              isbn: b.primary_isbn13,
              coverUrl: b.coverUrl
            });
            usedNyt.add(b.title.toUpperCase());
          }
        }

        if (recommendations.length === 0) {
          const defaultCurated = [
            { title: "Project Hail Mary", author: "Andy Weir", reason: "An incredible sci-fi thriller about a lone astronaut trying to save humanity, matching high-tech literature." },
            { title: "Atomic Habits", author: "James Clear", reason: "An extremely practical guide to building good habits and breaking bad ones, perfect for personal development." },
            { title: "Educated", author: "Tara Westover", reason: "A gripping memoir about a young woman's struggle for education and self-reinvention." },
            { title: "Dune", author: "Frank Herbert", reason: "A timeless sci-fi masterpiece with unparalleled world-building and political intrigue." },
            { title: "The Midnight Library", author: "Matt Haig", reason: "A beautiful, thought-provoking novel exploring choices, regrets, and what truly makes life worth living." }
          ];

          recommendations.push(...defaultCurated.map(b => ({
            ...b,
            matchingNytBook: false,
            isbn: null,
            coverUrl: null
          })));
        }

        return new Response(JSON.stringify({ recommendations }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: "Failed to generate recommendations", details: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 3. Download Options / Mirrors API
    if (path === "/api/download" || path === "/api/download-options" || path === "/api/annas-archive/download") {
      const md5 = url.searchParams.get("md5");
      if (!md5) {
        return new Response(JSON.stringify({ error: "MD5 is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const downloadLinks = [
        {
          label: "Direct Mirror (library.lol) - Recommended",
          url: `https://library.lol/main/${md5}`,
          isDirect: true
        },
        {
          label: "Anna's Archive Mirror",
          url: `https://annas-archive.gl/md5/${md5}`,
          isDirect: false
        },
        {
          label: "Libgen Mirror (libgen.rs)",
          url: `http://libgen.rs/get.php?md5=${md5}`,
          isDirect: true
        },
        {
          label: "IPFS Gateway Proxy",
          url: `https://ipfs.io/ipfs/${md5}`,
          isDirect: false
        }
      ];

      return new Response(JSON.stringify({ 
        options: downloadLinks,
        downloadLinks, 
        mirror: "Cloudflare Edge Resolver",
        parsedBy: "AI Edge Routing"
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // 4. Hardcover Proxy
    if (path === "/api/hardcover" && request.method === "POST") {
      try {
        const reqBody = await request.json();
        const HARDCOVER_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJIYXJkY292ZXIiLCJ2ZXJzaW9uIjoiOCIsImp0aSI6ImJlZjk5YmYzLTFmOTUtNDNkYy04MGNmLWIzMTA1ZmI1M2QzNSIsImFwcGxpY2F0aW9uSWQiOjIsInN1YiI6IjEyNTg5MiIsImF1ZCI6IjEiLCJpZCI6IjEyNTg5MiIsImxvZ2dlZEluIjp0cnVlLCJpYXQiOjE3ODM0OTUxOTAsImV4cCI6MTgxNTAzMTE5MCwiaHR0cHM6Ly9oYXN1cmEuaW8vand0L2NsYWltcyI6eyJ4LWhhc3VyYS1hbGxvd2VkLXJvbGVzIjpbInVzZXIiXSwieC1oYXN1cmEtZGVmYXVsdC1yb2xlIjoidXNlciIsIngtaGFzdXJhLXJvbGUiOiJ1c2VyIiwiWC1oYXN1cmEtdXNlci1pZCI6IjEyNTg5MiJ9LCJ1c2VyIjp7ImlkIjoxMjU4OTJ9fQ.YtD1IJpcDSiMbwE4WLWAnvOG_s7OUi5umrfpryEQP8M";

        const response = await fetch("https://api.hardcover.app/v1/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${HARDCOVER_TOKEN}`
          },
          body: JSON.stringify(reqBody)
        });

        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 5. Open Library Search
    if (path === "/api/open-library/search") {
      try {
        const q = url.searchParams.get("q");
        const title = url.searchParams.get("title");
        const author = url.searchParams.get("author");
        
        const olUrl = new URL("https://openlibrary.org/search.json");
        if (q) olUrl.searchParams.append("q", q);
        if (title) olUrl.searchParams.append("title", title);
        if (author) olUrl.searchParams.append("author", author);
        olUrl.searchParams.append("limit", "10");

        const response = await fetch(olUrl.toString());
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 6. Cover Redirect API
    if (path === "/api/cover-redirect") {
      const title = url.searchParams.get("title");
      const isbn = url.searchParams.get("isbn");
      const md5 = url.searchParams.get("md5");

      if (isbn && /^\d{10,13}$/.test(isbn)) {
        return Response.redirect(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`, 302);
      }
      if (md5) {
        return Response.redirect(`https://annas-archive.gl/covers/${md5}.jpg`, 302);
      }
      return new Response("No cover found", { status: 404 });
    }

    // 7. Z-Library Domains
    if (path === "/api/zlib/domains") {
      try {
        const response = await fetch(`https://raw.githubusercontent.com/ZlibraryKO/zlibrary.koplugin/main/assets/domains.json`);
        if (!response.ok) throw new Error("Github domains fetch failed");
        const text = await response.text();
        const data = JSON.parse(text);
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch {
        return new Response(JSON.stringify(FALLBACK_DOMAINS), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 8. Z-Library Login
    if (path === "/api/zlib/login" && request.method === "POST") {
      try {
        const { email, password, baseUrl } = await request.json() as any;
        if (!baseUrl) return new Response(JSON.stringify({ error: "Missing baseUrl" }), { status: 400 });
        
        const body = new URLSearchParams();
        body.append("email", email);
        body.append("password", password);
        
        const response = await fetch(`${baseUrl}/eapi/user/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Z-Library plugin KOReader"
          },
          body: body.toString()
        });
        
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 9. Z-Library Search
    if (path === "/api/zlib/search" && request.method === "POST") {
      try {
        const { query, page = 1, limit = 50, baseUrl, user_id, user_key } = await request.json() as any;
        if (!baseUrl) return new Response(JSON.stringify({ error: "Missing baseUrl" }), { status: 400 });
        
        const body = new URLSearchParams();
        body.append("message", query);
        body.append("page", String(page));
        body.append("limit", String(limit));
        
        const headers: any = {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Z-Library plugin KOReader"
        };
        if (user_id && user_key) {
          headers["Cookie"] = `remix_userid=${user_id}; remix_userkey=${user_key}`;
        }
        
        const response = await fetch(`${baseUrl}/eapi/book/search`, {
          method: "POST",
          headers,
          body: body.toString()
        });
        
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 10. Z-Library Download-Link
    if (path === "/api/zlib/download-link" && request.method === "POST") {
      try {
        const { book_id, book_hash, baseUrl, user_id, user_key } = await request.json() as any;
        if (!baseUrl || !book_id || !book_hash) return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400 });
        
        const headers: any = {
          "User-Agent": "Z-Library plugin KOReader"
        };
        if (user_id && user_key) {
          headers["Cookie"] = `remix_userid=${user_id}; remix_userkey=${user_key}`;
        }
        
        const response = await fetch(`${baseUrl}/eapi/book/${book_id}/${book_hash}/file`, {
          headers
        });
        
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 11. File Proxy / Z-Library Download Proxy
    if ((path === "/api/proxy-file" || path === "/api/zlib/download") && (request.method === "GET" || request.method === "POST")) {
      try {
        let downloadUrl = url.searchParams.get("url");
        let userId = "";
        let userKey = "";

        if (request.method === "POST") {
          const body = await request.json() as any;
          downloadUrl = downloadUrl || body.download_url;
          userId = body.user_id || "";
          userKey = body.user_key || "";
        }

        if (!downloadUrl) {
          return new Response(JSON.stringify({ error: "Missing download url" }), { status: 400 });
        }

        let targetUrl = downloadUrl;
        let libraryLolResolved = false;

        // Force https for public search/downloads to avoid block/mixed content issues in Cloudflare Workers
        if (targetUrl.startsWith("http://")) {
          try {
            const parsedUrl = new URL(targetUrl);
            if (parsedUrl.host.includes("libgen") || parsedUrl.host.includes("library") || parsedUrl.host.includes("archive")) {
              targetUrl = targetUrl.replace(/^http:\/\//i, "https://");
            }
          } catch (_) {}
        }

        // 1. Resolve library.lol to its actual direct file download link
        if (targetUrl.includes("library.lol")) {
          try {
            console.log(`Resolving library.lol landing page in Worker: ${targetUrl}`);
            const htmlRes = await fetch(targetUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
              }
            });
            if (htmlRes.ok) {
              const html = await htmlRes.text();
              const aTagRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']([^>]*?)>([\s\S]*?)<\/a>/gi;
              let match;
              let directLink = "";
              while ((match = aTagRegex.exec(html)) !== null) {
                const href = match[1];
                const attrs = match[2];
                const text = (match[3] || "").replace(/<[^>]*>/g, "").trim().toLowerCase();
                if (text === "get" || href.includes("/ipfs/") || href.includes("gateway") || attrs.includes("download")) {
                  directLink = href;
                  break;
                }
              }
              if (directLink) {
                if (directLink.startsWith("/")) {
                  directLink = "https://library.lol" + directLink;
                }
                console.log(`Successfully resolved library.lol direct link in Worker: ${directLink}`);
                targetUrl = directLink;
                libraryLolResolved = true;
              }
            }
          } catch (err) {
            console.warn("Failed to resolve library.lol direct link in Worker:", err);
          }

          // Fallback to Libgen RS if library.lol landing page couldn't be resolved or fetched
          if (!libraryLolResolved) {
            console.log("library.lol resolution failed. Attempting automatic fallback to libgen.rs...");
            const md5Match = targetUrl.match(/\/main\/([a-fA-F0-9]{32})/i) || targetUrl.match(/md5=([a-fA-F0-9]{32})/i);
            if (md5Match) {
              const md5 = md5Match[1];
              targetUrl = `https://libgen.rs/get.php?md5=${md5}`;
              console.log(`Rewrote target URL to libgen.rs fallback: ${targetUrl}`);
            }
          }
        }

        // 2. Resolve Libgen landing page to its actual direct file download link
        const isLibgenLanding = targetUrl.includes("get.php?md5=") && !targetUrl.includes("&key=");
        if (isLibgenLanding) {
          try {
            console.log(`Resolving Libgen landing page in Worker: ${targetUrl}`);
            const htmlRes = await fetch(targetUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
              }
            });
            if (htmlRes.ok) {
              const html = await htmlRes.text();
              const aTagRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']([^>]*?)>([\s\S]*?)<\/a>/gi;
              let match;
              let directLink = "";
              while ((match = aTagRegex.exec(html)) !== null) {
                const href = match[1];
                const text = (match[3] || "").replace(/<[^>]*>/g, "").trim().toLowerCase();
                if (href.includes("get.php?md5=") && href.includes("&key=")) {
                  directLink = href;
                  break;
                }
                if (text === "get" || text.includes("get")) {
                  directLink = href;
                }
              }
              if (directLink) {
                const parsedUrl = new URL(targetUrl);
                if (directLink.startsWith("/")) {
                  directLink = `${parsedUrl.protocol}//${parsedUrl.host}${directLink}`;
                } else if (!directLink.startsWith("http")) {
                  const pathname = parsedUrl.pathname;
                  const baseDir = pathname.substring(0, pathname.lastIndexOf('/') + 1);
                  directLink = `${parsedUrl.protocol}//${parsedUrl.host}${baseDir}${directLink}`;
                }
                console.log(`Successfully resolved Libgen direct link in Worker: ${directLink}`);
                targetUrl = directLink;
              }
            }
          } catch (err) {
            console.warn("Failed to resolve Libgen direct link in Worker:", err);
          }
        }

        // 3. IPFS Gateway Fallbacks (Raced Parallel Resolving for maximal speed)
        const ipfsMatch = targetUrl.match(/\/ipfs\/([a-zA-Z0-9]+)/i);
        let response: any = null;
        let resolvedFinalUrl = targetUrl;

        if (ipfsMatch) {
          const cid = ipfsMatch[1];
          const gateways = [
            `https://cloudflare-ipfs.com/ipfs/${cid}`,
            `https://ipfs.io/ipfs/${cid}`,
            `https://dweb.link/ipfs/${cid}`,
            `https://gateway.pinata.cloud/ipfs/${cid}`
          ];

          console.log(`[IPFS] CID detected in Worker: ${cid}. Querying public gateways in parallel...`);

          const controllers: AbortController[] = [];
          const gatewayPromises = gateways.map(async (gatewayUrl) => {
            const controller = new AbortController();
            controllers.push(controller);
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            try {
              const resIpfs = await fetch(gatewayUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
                },
                signal: controller.signal,
                redirect: 'follow'
              });

              clearTimeout(timeoutId);

              if (resIpfs.ok) {
                const contentType = resIpfs.headers.get("content-type") || "";
                if (!contentType.toLowerCase().includes("text/html")) {
                  return { res: resIpfs, url: gatewayUrl };
                }
              }
              throw new Error(`HTTP ${resIpfs.status}`);
            } catch (err: any) {
              clearTimeout(timeoutId);
              throw err;
            }
          });

          try {
            const winner = await new Promise<{ res: any, url: string }>((resolve, reject) => {
              let failedCount = 0;
              if (gatewayPromises.length === 0) {
                reject(new Error("No gateways configured"));
                return;
              }

              gatewayPromises.forEach(p => {
                p.then((val) => {
                  resolve(val);
                }).catch(() => {
                  failedCount++;
                  if (failedCount === gatewayPromises.length) {
                    reject(new Error("All parallel gateways failed or timed out"));
                  }
                });
              });
            });

            response = winner.res;
            resolvedFinalUrl = winner.url;
            console.log(`[IPFS] Fast parallel gateway succeeded in Worker: ${resolvedFinalUrl}`);

            controllers.forEach(c => {
              try { c.abort(); } catch (_) {}
            });

          } catch (err: any) {
            console.log(`[IPFS] All parallel gateways failed in Worker. Trying original fallback URL: ${targetUrl}`);
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 8000);
              const resOriginal = await fetch(targetUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
                },
                signal: controller.signal,
                redirect: 'follow'
              });
              clearTimeout(timeoutId);
              if (resOriginal.ok) {
                response = resOriginal;
                resolvedFinalUrl = targetUrl;
              }
            } catch (origErr: any) {}
          }
        }

        if (!response) {
          const finalHeaders: Record<string, string> = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Referer": "https://annas-archive.gl/",
            "Accept": "application/octet-stream,application/epub+zip,application/pdf,*/*",
          };
          if (userId && userKey) {
            finalHeaders["Cookie"] = `remix_userid=${userId}; remix_userkey=${userKey}`;
          }

          response = await fetch(targetUrl, {
            headers: finalHeaders,
            redirect: 'follow'
          });
        }

        if (!response.ok) {
          throw new Error(`Proxy target responded with status ${response.status}`);
        }

        const resHeaders = new Headers(response.headers);
        resHeaders.set("Access-Control-Allow-Origin", "*");

        return new Response(response.body, {
          status: response.status,
          headers: resHeaders
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};
