import puppeteer from "@cloudflare/puppeteer";

export interface Env {
  BROWSER: any;
  NYT_API_KEY?: string;
  NYT_BOOKS_API_KEY?: string;
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
        const searchUrl = `https://ravebooksearch.com/?q=${encodeURIComponent(query)}&mode=${mode}&source=${source}&page=${page}`;
        const browser = await puppeteer.launch(env.BROWSER);
        const pageObj = await browser.newPage();
        await pageObj.goto(searchUrl, { waitUntil: "networkidle2" });
        
        const results = await pageObj.evaluate(() => {
          const links = Array.from(document.querySelectorAll("a"));
          return links.map(a => {
            const text = (a.innerText || "").trim();
            const href = a.href || "";
            if (!href.includes("download") && !href.includes("md5") && !href.includes("get.php")) return null;
            
            const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length < 2) return null;

            const title = lines[0];
            const author = lines[1] || "Unknown Author";
            const sourceName = lines[lines.length - 1] || "Rave";
            
            const md5 = href.match(/[a-f0-9]{32}/i)?.[0] || btoa(href).substring(0, 32);

            return {
              id: md5,
              md5,
              title,
              author: author.split("·")[0].trim(),
              source: sourceName,
              downloadUrl: href,
              coverUrl: `https://annas-archive.gl/covers/${md5}.jpg`
            };
          }).filter(b => b !== null);
        });

        await browser.close();

        return new Response(JSON.stringify({ books: results, results }), {
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

        const headers: any = {
          "User-Agent": "Z-Library plugin KOReader"
        };
        if (userId && userKey) {
          headers["Cookie"] = `remix_userid=${userId}; remix_userkey=${userKey}`;
        }

        const response = await fetch(downloadUrl, { headers });
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
