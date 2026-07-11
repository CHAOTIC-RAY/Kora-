import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import dotenv from "dotenv";
import puppeteer from "puppeteer";
import crypto from "crypto";
import zlibRouter from "./zlib-proxy";

dotenv.config();

const app = express();
const PORT = 3000;

app.use("/api/zlib", zlibRouter);

// In-memory book cache to store metadata and direct download URLs from search results
const bookCache = new Map<string, any>();



function safeMD5(str: string): string {
  try {
    if (crypto && typeof crypto.createHash === "function") {
      return crypto.createHash("md5").update(str).digest("hex");
    }
  } catch (e) {
    // Fail-safe to pure-JS fallback
  }
  // Pure JS DJB2/FNV hash combination to yield a stable 32-char hex string
  let hash1 = 5381;
  let hash2 = 12345;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash1 = ((hash1 << 5) + hash1) + char;
    hash1 = hash1 & hash1;
    hash2 = ((hash2 << 7) ^ hash2) + char;
    hash2 = hash2 & hash2;
  }
  const h1 = Math.abs(hash1).toString(16).padStart(8, "0");
  const h2 = Math.abs(hash2).toString(16).padStart(8, "0");
  const h3 = Math.abs(hash1 * 31).toString(16).padStart(8, "0");
  const h4 = Math.abs(hash2 * 17).toString(16).padStart(8, "0");
  return (h1 + h2 + h3 + h4).slice(0, 32);
}

// List of resilient Library Genesis mirrors
const LIBGEN_MIRRORS = [
  "https://libgen.be",
  "https://libgen.lc",
  "https://libgen.li",
  "https://libgen.gs",
  "https://libgen.st",
  "https://libgen.rocks",
  "http://libgen.be",
  "http://libgen.lc",
  "http://libgen.li"
];

// Fetch from Rave Book Search Cloudflare Worker
async function fetchFromRaveBookSearch(query: string, mode: string = "ebooks", source: string = "all", page: number = 1): Promise<{results: any[], meta: any}> {
  const url = `https://ravebooksearch.cloudflare-s3cvv.workers.dev/search/all?q=${encodeURIComponent(query)}&mode=${mode}&source=${source}&page=${page}`;
  try {
    console.log(`Searching via Rave Book Search Cloudflare Worker: ${url}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds timeout
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`Rave Book Search returned status: ${res.status}`);
      return { results: [], meta: {} };
    }

    const data = await res.json();

    // Rave worker returns results in 'results' array
    let rawResults: any[] = data.results || [];
    let meta = data.meta || {};

    if (rawResults.length === 0) {
      console.log("Rave Book Search returned no results:", Object.keys(data));
      return { results: [], meta: meta };
    }

    // Pre-fetch NYT books for cover matching
    const nytBooks = await getNytBooks();

    const mapped = rawResults.map((r: any) => {
      if (!r || typeof r !== "object") return null;
      // Clean up title: remove ISBNs and trailing numbers/identifiers
      let title = String(r.title || "").replace(/;[^;]{0,4}\d{10,13}[^;]*/g, "").trim();
      title = title.replace(/ b [fl] \d+$/i, "").trim(); // Remove Libgen specific "b f 123" suffix

      // Clean up author: remove trailing commas, semicolons
      let author = String(r.author || "Unknown Author")
        .replace(/[,;]$/, "")
        .trim();

      if (author.endsWith(",")) author = author.slice(0, -1);

      // Handle extension
      let extension = (r.format || "").toLowerCase().replace(/^\./, "");
      if (!extension && (r.directUrl || r.downloadUrl)) {
        const url = (r.directUrl || r.downloadUrl).toLowerCase();
        if (url.endsWith(".pdf")) extension = "pdf";
        else if (url.endsWith(".epub")) extension = "epub";
        else if (url.endsWith(".mobi")) extension = "mobi";
        else if (url.endsWith(".azw3")) extension = "azw3";
      }
      if (!extension) extension = "epub";

      // Handle MD5 / ID - use safeMD5 for stable unique hashes
      let md5 = r.md5 || "";
      if (!md5) {
        const uniqueString = r.directUrl || r.downloadUrl || (r.title + r.author + extension);
        md5 = safeMD5(uniqueString);
      }

      // Format filesize
      let size = "Unknown";
      if (r.filesize && r.filesize > 0) {
        const bytes = parseInt(r.filesize);
        if (bytes > 1048576) size = (bytes / 1048576).toFixed(1) + " MB";
        else if (bytes > 1024) size = Math.round(bytes / 1024) + " KB";
        else size = bytes + " B";
      } else if (r.size) {
        size = r.size;
      }

      // Relevance Scoring
      let score = 0;
      const qLower = query.toLowerCase().trim();
      const tLower = title.toLowerCase().trim();
      const aLower = author.toLowerCase().trim();

      // Exact title match gets highest priority
      const isExactTitle = tLower === qLower || tLower.includes(qLower);
      if (tLower === qLower) score += 500;
      else if (tLower.startsWith(qLower)) score += 200;
      else if (tLower.includes(qLower)) score += 100;

      const words = qLower.split(/\s+/).filter(w => w.length > 2);
      words.forEach(word => {
        if (tLower.includes(word)) score += 30;
        if (aLower.includes(word)) score += 15;
      });

      // Prefer newer books
      if (r.year) {
        const year = parseInt(r.year);
        if (year > 2020) score += 20;
        else if (year > 2010) score += 10;
      }

      // Prefer EPUB for reading
      if (extension === "epub") score += 15;

      const downloadUrl = r.directUrl || r.downloadUrl || "";

      // Prioritize LibGen results and LibGen download links
      const isLibgen = (r.source && (r.source === "Library Genesis" || r.source.toLowerCase().includes("libgen") || r.source.toLowerCase().includes("genesis"))) ||
                       (downloadUrl && (downloadUrl.toLowerCase().includes("libgen") || downloadUrl.toLowerCase().includes("library.lol")));
      if (isLibgen) {
        score += 350;
      }

      // Extract potential ISBN for better cover matching
      const isbnMatch = (r.title || "").match(/(\d{10,13})/);
      const isbn = isbnMatch ? isbnMatch[1] : null;

      // Build a cover URL chain: NYT → API cover → OpenLibrary by ISBN → Anna's Archive by MD5
      let coverUrl = r.coverUrl || "";
      let coverSource = "rave";

      // Try NYT cover first (best quality)
      if (nytBooks.length > 0) {
        const tLower = title.toLowerCase().trim();
        const aLower = author.toLowerCase().trim();
        const nytMatch = nytBooks.find(b => {
          if (b.title === tLower) return true;
          if (b.title.includes(tLower) || tLower.includes(b.title)) {
            if (aLower && b.author) {
              const firstName = aLower.split(" ")[0];
              if (b.author.includes(firstName)) return true;
            }
            return b.title.length > 10; // Only partial match for longer titles
          }
          return false;
        });
        if (nytMatch && nytMatch.coverUrl) {
          coverUrl = nytMatch.coverUrl;
          coverSource = "nyt";
        }
      }

      // Fallback to OpenLibrary by ISBN
      if (!coverUrl && isbn && /^\d{10,13}$/.test(isbn)) {
        coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
        coverSource = "openlibrary";
      }

      // Final fallback to Anna's Archive by MD5
      if (!coverUrl) {
        coverUrl = `/api/cover-redirect?md5=${md5}`;
        coverSource = "annas-archive";
      }

      return {
        id: md5,
        md5,
        isbn: isbn || null,
        title,
        author,
        extension: extension.toUpperCase(),
        size: size,
        language: r.language || "English",
        year: r.year || "",
        publisher: r.publisher || "",
        pages: r.pages || "",
        topic: r.topic || r.category || "",
        coverUrl,
        coverSource,
        source: r.source || (isLibgen ? "Library Genesis" : "Rave"),
        downloadUrl: downloadUrl,
        iaId: r.source === "Internet Archive" ? (downloadUrl?.split("/details/")[1]?.split("/")[0] || "") : "",
        score,
        exactMatch: isExactTitle && tLower.length < qLower.length + 5
      };
    });

    // Final deduplication by ID and sort by score
    const validMapped = mapped.filter((item): item is any => item !== null);
    const unique = Array.from(new Map(validMapped.map(item => [item.id, item])).values());
    unique.sort((a: any, b: any) => b.score - a.score);
    
    console.log(`Rave Worker returned ${unique.length} unique results sorted by relevance`);
    return { results: unique, meta: meta };
  } catch (err: any) {
    console.error("Rave Book Search Worker fetch failed:", err.message);
    return { results: [], meta: {} };
  }
}



// Increase payload limit for any large JSON syncs if needed
app.use(express.json({ limit: "50mb" }));

// List of resilient Anna's Archive domains/mirrors
const ANNA_MIRRORS = [
  "https://annas-archive.gl",
  "https://annas-archive.gs",
  "https://annas-archive.se",
  "https://annas-archive.li",
  "https://annas-archive.org",
  "https://annas-archive.sh",
];

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      list[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  });
  return list;
}

function getTargetCookies(reqCookies: Record<string, string>, targetHost: string): string {
  const cookies: string[] = [];
  
  for (const [key, value] of Object.entries(reqCookies)) {
    if (key.startsWith("prox_")) {
      if (key.includes("___")) {
        const parts = key.substring(5).split("___");
        if (parts.length === 2) {
          const hostEncoded = parts[0];
          const cookieName = parts[1];
          const cookieHost = hostEncoded.replace(/_/g, ".");
          
          if (targetHost === cookieHost || targetHost.endsWith("." + cookieHost) || cookieHost.endsWith("." + targetHost)) {
            cookies.push(`${cookieName}=${value}`);
          }
        }
      } else {
        const parts = key.split("_");
        if (parts.length >= 3) {
          const hostEncoded = parts.slice(1, -1).join("_");
          const cookieName = parts[parts.length - 1];
          const cookieHost = hostEncoded.replace(/_/g, ".");
          
          if (targetHost === cookieHost || targetHost.endsWith("." + cookieHost) || cookieHost.endsWith("." + targetHost)) {
            cookies.push(`${cookieName}=${value}`);
          }
        }
      }
    }
  }
  return cookies.join("; ");
}

function isValidDownloadUrl(href: string, text: string): boolean {
  if (!href || href === "#") return false;
  
  const lowerHref = href.toLowerCase();
  const lowerText = text.toLowerCase();
  
  // Exclude non-downloadable sections of Anna's Archive page
  if (
    lowerHref.includes("/search?") ||
    lowerHref.includes("?q=") ||
    lowerHref.includes("member_codes") ||
    lowerHref.includes("/db/") ||
    lowerHref.includes("/datasets") ||
    lowerHref.includes("/account/") ||
    lowerHref.includes(".torrent") ||
    lowerHref.includes(".json") ||
    lowerHref.includes("/aac_record/") ||
    lowerHref.includes("/about") ||
    lowerHref.includes("/donate") ||
    lowerHref.includes("/copyright") ||
    lowerHref.includes("/llm") ||
    lowerHref.includes("/torrents") ||
    lowerHref.includes("/software") ||
    // If it is from the same site but isn't a slow download link, it's metadata/navigation
    ((lowerHref.includes("annas-archive") || href.startsWith("/")) && !lowerHref.includes("/slow_download/"))
  ) {
    return false;
  }
  
  // Must match standard ebook/PDF repositories or explicit mirror/download tags
  const isTargetHost =
    lowerHref.includes("/slow_download/") ||
    lowerHref.includes("library.lol") ||
    lowerHref.includes("libgen") ||
    lowerHref.includes("ipfs") ||
    lowerHref.includes("z-library") ||
    lowerHref.includes("zlib") ||
    lowerHref.includes("/main/") ||
    lowerText.includes("download") ||
    lowerText.includes("mirror") ||
    lowerText.includes("option") ||
    lowerHref.includes("get.php") ||
    lowerHref.includes("file.php") ||
    lowerHref.includes(".epub") ||
    lowerHref.includes(".pdf") ||
    lowerHref.includes(".mobi");
    
  return isTargetHost;
}



// NYT Books API - Cached for cover lookups
let nytBooksCache: { title: string; author: string; coverUrl: string; isbn: string }[] = [];
let nytCacheTime = 0;
const NYT_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

let lastNytRequestTime = 0;
async function fetchNytWithDelay(url: string): Promise<Response> {
  const now = Date.now();
  const diff = now - lastNytRequestTime;
  if (diff < 12000) {
    const delay = 12000 - diff;
    console.log(`[NYT Delay] Sleep delay of ${delay}ms before sequential NYT API call to prevent rate limiting`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  lastNytRequestTime = Date.now();
  return await fetch(url);
}

async function getNytBooks(): Promise<{ title: string; author: string; coverUrl: string; isbn: string }[]> {
  const now = Date.now();
  if (nytBooksCache.length > 0 && now - nytCacheTime < NYT_CACHE_TTL) {
    return nytBooksCache;
  }

  const apiKey = process.env.NYT_BOOKS_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return [];
  }

  try {
    const response = await fetchNytWithDelay(`https://api.nytimes.com/svc/books/v3/lists/overview.json?api-key=${apiKey}`);
    if (!response.ok) return [];

    const data = await response.json();
    if (data.status !== "OK") return [];

    const books: { title: string; author: string; coverUrl: string; isbn: string }[] = [];

    for (const list of data.results?.lists || []) {
      for (const book of list.books || []) {
        const title = (book.title || "").toLowerCase().trim();
        const author = (book.author || "").toLowerCase().trim();
        const coverUrl = book.book_image || "";
        const isbn = (book.primary_isbn13 || book.primary_isbn10 || "");

        if (title && coverUrl) {
          books.push({ title, author, coverUrl, isbn });
        }
      }
    }

    nytBooksCache = books;
    nytCacheTime = now;
    console.log(`[NYT] Cached ${books.length} book covers from NYT best sellers`);
    return books;
  } catch (err) {
    return [];
  }
}

// Find NYT cover by title/author match
async function findNytCover(title: string, author: string): Promise<string | null> {
  const books = await getNytBooks();
  const tLower = title.toLowerCase().trim();
  const aLower = author.toLowerCase().trim();

  // Try exact title match first
  const exactMatch = books.find(b => b.title === tLower);
  if (exactMatch) return exactMatch.coverUrl;

  // Try title + author match
  const fullMatch = books.find(b => b.title === tLower && b.author.includes(aLower.split(" ")[0]));
  if (fullMatch) return fullMatch.coverUrl;

  // Try partial title match
  const partialMatch = books.find(b => tLower.includes(b.title) || b.title.includes(tLower));
  if (partialMatch) return partialMatch.coverUrl;

  return null;
}

// NYT Best Sellers Recommendations (Curated & Rule-Based Matching)
app.post("/api/nytimes/recommendations", express.json(), async (req, res) => {
  try {
    const { library = [], recentSearches = [] } = req.body;
    const apiKey = process.env.NYT_BOOKS_API_KEY;

    // First fetch NYT Best Sellers to have context for recommendations
    let allNytBooks: any[] = [];
    if (apiKey && apiKey.trim() !== "") {
      try {
        const response = await fetchNytWithDelay(`https://api.nytimes.com/svc/books/v3/lists/overview.json?api-key=${apiKey}`);
        if (response.ok) {
          const data = await response.json();
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
        console.error("Failed to fetch NYT Best Sellers for recommendations:", err);
      }
    }

    const recommendations: any[] = [];
    const usedNyt = new Set<string>();

    // Build search keywords from library and recent searches
    const searchTerms = [
      ...recentSearches.map(s => s.toLowerCase()),
      ...library.map((b: any) => (b.title || "").toLowerCase()),
      ...library.map((b: any) => (b.author || "").toLowerCase())
    ];

    // Try to find matching NYT Best Sellers
    for (const b of allNytBooks) {
      if (recommendations.length >= 5) break;
      const titleLower = b.title.toLowerCase();
      const authorLower = b.author.toLowerCase();

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

    // Fill in remaining with top NYT books if we don't have enough
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

    // If still empty (e.g. no NYT key configured), provide curated best sellers with high-quality cover proxies
    if (recommendations.length === 0) {
      const defaultCurated = [
        { title: "Project Hail Mary", author: "Andy Weir", isbn: "9780593135204", reason: "An incredible sci-fi thriller about a lone astronaut trying to save humanity, matching high-tech literature." },
        { title: "Atomic Habits", author: "James Clear", isbn: "9780735211292", reason: "An extremely practical guide to building good habits and breaking bad ones, perfect for personal development." },
        { title: "Educated", author: "Tara Westover", isbn: "9780399590504", reason: "A gripping memoir about a young woman's struggle for education and self-reinvention." },
        { title: "Dune", author: "Frank Herbert", isbn: "9780441172719", reason: "A timeless sci-fi masterpiece with unparalleled world-building and political intrigue." },
        { title: "The Midnight Library", author: "Matt Haig", isbn: "9780525559474", reason: "A beautiful, thought-provoking novel exploring choices, regrets, and what truly makes life worth living." }
      ];

      recommendations.push(...defaultCurated.map(b => ({
        title: b.title,
        author: b.author,
        reason: b.reason,
        matchingNytBook: false,
        isbn: b.isbn,
        coverUrl: `/api/cover-redirect?isbn=${b.isbn}`
      })));
    }

    res.json({ recommendations });
  } catch (err: any) {
    console.error("Recommendations API failed:", err);
    res.status(500).json({ error: "Failed to generate recommendations", details: err.message });
  }
});

// NYT Best Sellers API
app.get("/api/nytimes/overview", async (req, res) => {
  try {
    const apiKey = process.env.NYT_BOOKS_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      console.warn("NYT_BOOKS_API_KEY is missing or empty");
      return res.status(500).json({
        error: "NYT API Key not configured. Please add NYT_BOOKS_API_KEY to your secrets."
      });
    }

    console.log("Fetching NYT Books overview...");
    const response = await fetchNytWithDelay(`https://api.nytimes.com/svc/books/v3/lists/overview.json?api-key=${apiKey}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`NYT API returned ${response.status}:`, errorText);
      return res.status(response.status).json({
        error: `NYT API returned error ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    if (data.status !== "OK") {
      console.error("NYT API returned non-OK status:", data);
      throw new Error(data.message || data.status || "NYT API error");
    }

    res.json(data);
  } catch (err: any) {
    console.error("NYT API handler failed:", err);
    res.status(500).json({ error: "Failed to fetch trending books from NYT", details: err.message });
  }
});

// Cover lookup endpoint - redirects to best available cover
app.get("/api/cover-redirect", async (req, res) => {
  try {
    const { title, author, isbn, md5 } = req.query;

    // 1. Try NYT first for best quality covers
    if (title) {
      const nytCover = await findNytCover(title as string, (author as string) || "");
      if (nytCover) {
        return res.redirect(nytCover);
      }
    }

    // 2. Try OpenLibrary by ISBN
    if (isbn && /^\d{10,13}$/.test(isbn as string)) {
      return res.redirect(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`);
    }

    // 3. Try OpenLibrary by title/author
    if (title) {
      const searchUrl = new URL("https://openlibrary.org/search.json");
      searchUrl.searchParams.append("title", title as string);
      if (author) searchUrl.searchParams.append("author", author as string);
      searchUrl.searchParams.append("limit", "1");

      const olRes = await fetch(searchUrl.toString());
      if (olRes.ok) {
        const olData = await olRes.json();
        const firstBook = olData.docs?.[0];
        if (firstBook?.cover_i) {
          return res.redirect(`https://covers.openlibrary.org/b/id/${firstBook.cover_i}-M.jpg`);
        }
        if (firstBook?.isbn?.[0]) {
          return res.redirect(`https://covers.openlibrary.org/b/isbn/${firstBook.isbn[0]}-M.jpg`);
        }
      }
    }

    // 4. Fallback to Anna's Archive by MD5 (proxied to bypass hotlinking/SSL issues)
    if (md5) {
      const domains = ["annas-archive.org", "annas-archive.se", "annas-archive.li", "annas-archive.gl"];
      for (const domain of domains) {
        try {
          const coverUrl = `https://${domain}/covers/${md5}.jpg`;
          const fetchRes = await fetch(coverUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
              "Referer": `https://${domain}/`
            }
          });
          if (fetchRes.ok) {
            res.setHeader("Content-Type", fetchRes.headers.get("content-type") || "image/jpeg");
            res.setHeader("Cache-Control", "public, max-age=604800, immutable");
            const arrayBuffer = await fetchRes.arrayBuffer();
            return res.send(Buffer.from(arrayBuffer));
          }
        } catch (_) {}
      }
    }

    // Return 404 placeholder
    res.status(404).send("No cover found");
  } catch (err: any) {
    console.error("Cover redirect failed:", err);
    res.status(500).send("Cover lookup error");
  }
});

// Cover lookup endpoint - returns JSON for programmatic use
app.get("/api/cover-lookup", async (req, res) => {
  try {
    const { title, author, isbn, md5 } = req.query;

    if (!title && !isbn) {
      return res.status(400).json({ error: "title or isbn is required" });
    }

    // 1. Try NYT first for best quality covers
    if (title) {
      const nytCover = await findNytCover(title as string, (author as string) || "");
      if (nytCover) {
        return res.json({ coverUrl: nytCover, source: "nyt" });
      }
    }

    // 2. Try OpenLibrary by ISBN
    if (isbn && /^\d{10,13}$/.test(isbn as string)) {
      const olUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
      return res.json({ coverUrl: olUrl, source: "openlibrary" });
    }

    // 3. Try OpenLibrary by title/author
    if (title) {
      const searchUrl = new URL("https://openlibrary.org/search.json");
      searchUrl.searchParams.append("title", title as string);
      if (author) searchUrl.searchParams.append("author", author as string);
      searchUrl.searchParams.append("limit", "1");

      const olRes = await fetch(searchUrl.toString());
      if (olRes.ok) {
        const olData = await olRes.json();
        const firstBook = olData.docs?.[0];
        if (firstBook?.cover_i) {
          return res.json({ coverUrl: `https://covers.openlibrary.org/b/id/${firstBook.cover_i}-M.jpg`, source: "openlibrary" });
        }
        if (firstBook?.isbn?.[0]) {
          return res.json({ coverUrl: `https://covers.openlibrary.org/b/isbn/${firstBook.isbn[0]}-M.jpg`, source: "openlibrary" });
        }
      }
    }

    // 4. Fallback to Anna's Archive by MD5
    if (md5) {
      return res.json({ coverUrl: `/api/cover-redirect?md5=${md5}`, source: "annas-archive" });
    }

    res.json({ coverUrl: null, source: null });
  } catch (err: any) {
    console.error("Cover lookup failed:", err);
    res.status(500).json({ error: err.message });
  }
});


// Image proxy endpoint to secure external cover URLs and force high quality
app.get("/api/proxy-image", async (req, res) => {
  try {
    let imageUrl = req.query.url as string;
    if (!imageUrl) {
      return res.status(400).send("Missing image URL");
    }

    // Fix book cover quality: automatically upgrade Open Library medium covers to large
    if (imageUrl.includes("openlibrary.org") && imageUrl.includes("-M.jpg")) {
      imageUrl = imageUrl.replace("-M.jpg", "-L.jpg");
    }

    if (imageUrl.startsWith("//")) {
      imageUrl = "https:" + imageUrl;
    }

    console.log(`[Proxy Image] Fetching image: ${imageUrl}`);
    const imgRes = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*"
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!imgRes.ok) {
      // Fallback if the large cover doesn't exist
      if (imageUrl.includes("-L.jpg")) {
        const fallbackUrl = imageUrl.replace("-L.jpg", "-M.jpg");
        const fallbackRes = await fetch(fallbackUrl);
        if (fallbackRes.ok) {
          res.setHeader("Content-Type", fallbackRes.headers.get("content-type") || "image/jpeg");
          res.setHeader("Cache-Control", "public, max-age=604800, immutable");
          const buffer = await fallbackRes.arrayBuffer();
          return res.send(Buffer.from(buffer));
        }
      }
      return res.status(404).send("Image not found");
    }

    res.setHeader("Content-Type", imgRes.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    const buffer = await imgRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err: any) {
    console.error("Proxy image failed:", err);
    res.status(500).send("Proxy image error");
  }
});




function getOptionScore(opt: { label: string; url: string; isDirect: boolean }): number {
  const url = opt.url.toLowerCase();
  
  if (url.includes(".onion")) {
    return 10; // Tor links are reachable only via specialized proxies
  }
  if (url.includes("/slow_download/")) {
    return 30; // Slow downloads require manual interaction/countdown
  }
  if (url.includes("archive.org/details/") || url.includes("openlibrary.org/works/")) {
    return 35; // Landing page details
  }
  
  // Direct file links
  if (url.includes("archive.org/download/")) {
    return 100; // Internet Archive direct download is extremely fast/reliable
  }
  if (url.includes("library.lol")) {
    return 95; // We resolve library.lol into its direct download URL in proxy-file!
  }
  if (url.includes("/ipfs/") || url.includes("ipfs.io") || url.includes("cloudflare-ipfs.com") || url.includes("dweb.link")) {
    return 80; // IPFS direct downloads
  }
  if (/libgen\.(li|be|lc|gs|st|rocks)\/(get|file)\.php/i.test(url)) {
    return 75; // Libgen direct links
  }
  
  if (opt.isDirect) {
    return 60; // Generic direct link
  }
  
  return 40; // Generic landing/indirect link
}


// 2. API: Get download mirror options for a specific book MD5
app.get("/api/download-options", async (req, res) => {
  const md5 = req.query.md5 as string;
  if (!md5) {
    return res.status(400).json({ error: "Book MD5 is required." });
  }

  try {
    let options: any[] = [];
    const cachedBook = bookCache.get(md5);

    if (cachedBook && cachedBook.source === "Open Library") {
      const olid = cachedBook.olid || cachedBook.key?.replace("/works/", "");
      if (cachedBook.iaId) {
        options.push({
          label: "Internet Archive Details (Borrow / Read)",
          url: `https://archive.org/details/${cachedBook.iaId}`,
          isDirect: false
        });
        options.push({
          label: "Internet Archive Direct EPUB",
          url: `https://archive.org/download/${cachedBook.iaId}/${cachedBook.iaId}.epub`,
          isDirect: true
        });
        options.push({
          label: "Internet Archive Direct PDF",
          url: `https://archive.org/download/${cachedBook.iaId}/${cachedBook.iaId}.pdf`,
          isDirect: true
        });
      }
      if (olid) {
        options.push({
          label: "Open Library Page (Official)",
          url: `https://openlibrary.org/works/${olid}`,
          isDirect: false
        });
      } else if (cachedBook.downloadUrl) {
        options.push({
          label: "Open Library Direct Link",
          url: cachedBook.downloadUrl,
          isDirect: false
        });
      }
      const unique = options.filter((l, i, arr) => arr.findIndex(x => x.url === l.url) === i);
      return res.json({ options: unique, downloadLinks: unique, mirror: "Open Library API", parsedBy: "Open Library Connector" });
    }



    if (cachedBook && cachedBook.downloadUrl) {
      let label = "Direct Download Mirror";
      const dUrl = cachedBook.downloadUrl;
      if (dUrl.includes("library.lol")) label = "Libgen Mirror (library.lol) - Recommended";
      else if (dUrl.includes("ipfs")) label = "IPFS Gateway Mirror";
      else if (dUrl.includes("z-library")) label = "Z-Library Direct Option";
      
      options.push({
        label,
        url: dUrl,
        isDirect: !dUrl.includes("/slow_download/")
      });
    }

    try {
      // Rave Search now handles all mirrors including Anna's Archive. 
      // This scraper is a legacy fallback and is now minimized to prevent SSL/Captcha issues.
      // We will only use basic link resolution if cachedBook is available.
      
      if (cachedBook && cachedBook.downloadUrl) {
        options.push({
          label: "Direct Mirror (from search)",
          url: cachedBook.downloadUrl,
          isDirect: true
        });
      }
    } catch (scrapeErr) {
      console.warn("Mirror scrape failed for download-options:", scrapeErr);
    }

    if (options.length === 0) {
      const title = cachedBook?.title || "Book";
      const author = cachedBook?.author || "";
      const workingMirror = LIBGEN_MIRRORS.find(m => !m.includes("libgen.li")) || "https://libgen.be";
      options.push({
        label: "Libgen Search Mirror (Manual)",
        url: `${workingMirror}/index.php?req=${encodeURIComponent(title + " " + author)}`,
        isDirect: false
      });
      options.push({
        label: "IPFS Gateway Proxy",
        url: `https://ipfs.io/ipfs/${md5}`,
        isDirect: false
      });
    }

    // Format and filter options
    options = options.map(opt => {
      if (opt.url.startsWith('ipfs://')) {
        return { ...opt, url: opt.url.replace('ipfs://', 'https://ipfs.io/ipfs/') };
      }
      return opt;
    }).filter(opt => !opt.url.includes('.onion'));

    // Deduplicate options
    const uniqueOptions = options.filter(
      (opt, index, self) => self.findIndex((o) => o.url === opt.url) === index
    );

    // Sort by quality score
    uniqueOptions.sort((a, b) => getOptionScore(b) - getOptionScore(a));

    // Also return as downloadLinks key for DiscoverView compatibility
    res.json({ options: uniqueOptions, downloadLinks: uniqueOptions, mirror: "AI Fallback Mirror", parsedBy: "AI Grounding & Cache" });
  } catch (err: any) {
    console.error("Download Options Error:", err);
    res.status(500).json({ error: err.message || "Failed to retrieve download mirrors." });
  }
});

// 4. API: Send book via Email (Kindle integration)
app.post("/api/send-email", async (req, res) => {
  const { to, subject, attachmentUrl, attachmentName } = req.body;
  if (!to || !attachmentUrl) {
    return res.status(400).json({ error: "Missing required fields: to, attachmentUrl" });
  }

  try {
    // Requires SMTP settings in .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const response = await fetch(attachmentUrl);
    if (!response.ok) throw new Error("Failed to fetch book for email");
    const buffer = Buffer.from(await response.arrayBuffer());

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: to,
      subject: subject || "Book delivery",
      text: "Book attached.",
      attachments: [{ filename: attachmentName || "book.epub", content: buffer }],
    });

    res.json({ success: true, message: "Email sent successfully" });
  } catch (err: any) {
    console.error("Email sending failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. API: Proxy Download to bypass CORS & SSL blocks
app.get("/api/proxy-file", async (req, res) => {
  const fileUrl = req.query.url as string;
  if (!fileUrl) {
    return res.status(400).json({ error: "Mirror file 'url' is required." });
  }

  try {
    let targetUrl = fileUrl;

    if (targetUrl.includes(".onion")) {
      throw new Error("Onion links are not supported by the proxy. Please use a standard HTTPS mirror.");
    }

    if (targetUrl.startsWith("ipfs://")) {
      targetUrl = targetUrl.replace("ipfs://", "https://ipfs.io/ipfs/");
    }

    // Force https for public search/downloads to avoid block/mixed content issues
    if (targetUrl.startsWith("http://")) {
      const parsedUrl = new URL(targetUrl);
      if (parsedUrl.host.includes("libgen") || parsedUrl.host.includes("library") || parsedUrl.host.includes("archive")) {
        targetUrl = targetUrl.replace(/^http:\/\//i, "https://");
      }
    }

    // Resolve Internet Archive /details/ landing pages to actual file download URLs
    if (targetUrl.includes("archive.org/details/")) {
      try {
        const iaId = targetUrl.split("/details/")[1]?.split("/")[0]?.split("?")[0];
        if (iaId) {
          console.log(`[IA] Resolving archive.org details page for item: ${iaId}`);
          const metaRes = await fetch(`https://archive.org/metadata/${iaId}`, {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(8000)
          });
          if (metaRes.ok) {
            const meta = await metaRes.json();
            const files: any[] = meta.files || [];
            // Prefer EPUB, then PDF, then MOBI
            const bookFile = files.find((f: any) => f.name?.endsWith(".epub")) ||
                             files.find((f: any) => f.name?.endsWith(".pdf")) ||
                             files.find((f: any) => f.name?.endsWith(".mobi"));
            if (bookFile) {
              const directUrl = `https://archive.org/download/${iaId}/${encodeURIComponent(bookFile.name)}`;
              console.log(`[IA] Resolved to direct download: ${directUrl}`);
              targetUrl = directUrl;
            } else {
              throw new Error("No downloadable book file found in this Internet Archive item.");
            }
          }
        }
      } catch (err: any) {
        if (err.message && !err.message.includes("No downloadable")) {
          console.warn("[IA] Failed to resolve archive.org details:", err.message);
        } else {
          throw err;
        }
      }
    }

    console.log(`Proxying download from URL: ${targetUrl}`);

    // 1. Resolve library.lol to its actual direct file download link
    if (targetUrl.includes("library.lol")) {
      try {
        console.log(`Resolving library.lol landing page: ${targetUrl}`);
        const htmlRes = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
          }
        });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const $ = cheerio.load(html);
          
          let directLink = $("#download a").attr("href") || "";
          if (!directLink) {
            $("a").each((_, el) => {
              const text = $(el).text().trim().toLowerCase();
              const href = $(el).attr("href") || "";
              if (text === "get" || href.includes("/ipfs/") || href.includes("gateway")) {
                directLink = href;
                return false; // break cheerio each
              }
            });
          }

          if (directLink) {
            if (directLink.startsWith("/")) {
              directLink = "https://library.lol" + directLink;
            }
            console.log(`Successfully resolved library.lol direct link: ${directLink}`);
            targetUrl = directLink;
          }
        }
      } catch (err) {
        console.warn("Failed to resolve library.lol direct link:", err);
      }
    }

    // 1b. Resolve Libgen (libgen.li, libgen.gs, etc.) landing page to its actual direct file download link
    const isLibgenLanding = targetUrl.includes("get.php?md5=") && !targetUrl.includes("&key=");
    
    if (isLibgenLanding) {
      try {
        console.log(`Resolving Libgen landing page: ${targetUrl}`);
        const htmlRes = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
          }
        });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const $ = cheerio.load(html);
          
          let directLink = "";
          $("a").each((_, el) => {
            const href = $(el).attr("href") || "";
            if (href.includes("get.php?md5=") && href.includes("&key=")) {
              directLink = href;
              return false; // break loop
            }
          });
          
          // Fallback if no specific key was found, check if there's any link with text 'GET'
          if (!directLink) {
            $("a").each((_, el) => {
              const text = $(el).text().trim().toLowerCase();
              const href = $(el).attr("href") || "";
              if (text === "get" || $(el).find("h2").text().trim().toLowerCase() === "get") {
                directLink = href;
                return false;
              }
            });
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
            console.log(`Successfully resolved Libgen direct link: ${directLink}`);
            targetUrl = directLink;
          }
        }
      } catch (err) {
        console.warn("Failed to resolve Libgen direct link:", err);
      }
    }

    // 2. IPFS Gateway Fallbacks (Raced Parallel Resolving for maximal speed and clean logs)
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

      console.log(`[IPFS] CID detected: ${cid}. Querying public gateways in parallel...`);

      const controllers: AbortController[] = [];
      const gatewayPromises = gateways.map(async (gatewayUrl) => {
        const controller = new AbortController();
        controllers.push(controller);
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout per gateway

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
          // Simple silent logging to keep terminal completely clean of scary stack traces
          const cleanErr = err.name === "AbortError" ? "Timeout" : (err.message || "Network error");
          console.log(`[IPFS] Gateway skipped (${gatewayUrl.split('/ipfs/')[0]}): ${cleanErr}`);
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
        console.log(`[IPFS] Fast parallel gateway succeeded: ${resolvedFinalUrl}`);

        // Cancel other pending parallel gateway requests
        controllers.forEach(c => {
          try { c.abort(); } catch (_) {}
        });

      } catch (err: any) {
        console.log(`[IPFS] All parallel gateways failed. Trying original fallback URL: ${targetUrl}`);
        // Fallback to original URL sequentially as last resort
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
            console.log(`[IPFS] Original URL fallback succeeded: ${targetUrl}`);
          }
        } catch (origErr: any) {
          console.log(`[IPFS] Original URL fallback skipped: ${origErr.message || origErr}`);
        }
      }
    }

    // 3. Fallback to standard fetch if not IPFS or gateways failed
    if (!response) {
      const clientCookies = parseCookies(req.headers.cookie);
      let targetCookieHeader = "";
      try {
        const hostOfUrl = new URL(targetUrl).host;
        targetCookieHeader = getTargetCookies(clientCookies, hostOfUrl);
      } catch (e) {
        console.warn("Failed to parse host for cookie forwarding in proxy-file:", e);
      }

      const finalHeaders: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Referer": "https://annas-archive.org/",
        "Accept": "application/octet-stream,application/epub+zip,application/pdf,*/*",
      };

      if (targetCookieHeader) {
        console.log(`[proxy-file] Forwarding user credentials cookie to bypass limits for ${new URL(targetUrl).host}`);
        finalHeaders["Cookie"] = targetCookieHeader;
      }

      response = await fetch(targetUrl, {
        headers: finalHeaders,
        redirect: 'follow'
      });
    }

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error(`Access Forbidden (403) by mirror host. This mirror may be temporarily blocking proxy requests or requires a direct browser visit.`);
      }
      throw new Error(`Remote host returned status ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    if (contentType.toLowerCase().includes("text/html")) {
      const text = await response.text();
      if (text.includes("Cloudflare") || text.includes("captcha")) {
        throw new Error("This mirror is blocked by a CAPTCHA or Cloudflare protection. Please try a different direct mirror (like Library.lol or IPFS).");
      }
      throw new Error("This mirror URL returned an HTML webpage instead of a binary book file. This usually happens when the mirror requires manual verification (like resolving a CAPTCHA), wait countdowns, or the link has expired.");
    }

    const contentDisposition = response.headers.get("content-disposition");
    const contentLength = response.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    if (contentDisposition) {
      res.setHeader("Content-Disposition", contentDisposition);
    } else {
      const filename = path.basename(new URL(resolvedFinalUrl).pathname) || "download.epub";
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    }

    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    // Access raw arrayBuffer and send
    const buffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    // 1. Detect if the buffer is actually HTML text
    let isHtml = false;
    let textSample = "";
    try {
      textSample = new TextDecoder("utf-8").decode(uint8.subarray(0, 500)).trim().toLowerCase();
      isHtml = textSample.startsWith("<!doctype html") || 
               textSample.startsWith("<html") || 
               textSample.includes("<head") || 
               textSample.includes("<body") ||
               textSample.includes("<div") ||
               textSample.includes("cloudflare") ||
               textSample.includes("captcha");
    } catch (decodeErr) {
      // Binary data, not decodable as utf-8 safely, probably fine
    }

    if (isHtml) {
      if (textSample.includes("cloudflare") || textSample.includes("captcha") || textSample.includes("challenge-running") || textSample.includes("ray id")) {
        throw new Error("This mirror is blocked by a CAPTCHA, Cloudflare DDOS protection, or require human interaction. Please open the 'Proxy Browser' tab, navigate to this site, solve any verification/login, and then download directly from there.");
      }
      throw new Error("This mirror URL returned an HTML landing page instead of the actual ebook file. This usually happens due to wait-time countdowns, expiring links, or temporary IP limits. Try a direct download mirror (like Library.lol or IPFS), or use the 'Proxy Browser' tab.");
    }

    // 2. Validate expected magic bytes for epub/pdf/zip
    const isZip = uint8[0] === 0x50 && uint8[1] === 0x4B && uint8[2] === 0x03 && uint8[3] === 0x04;
    const isPdf = uint8[0] === 0x25 && uint8[1] === 0x50 && uint8[2] === 0x44 && uint8[3] === 0x46;

    const lowerUrl = fileUrl.toLowerCase();
    const isEpubOrZipExpected = lowerUrl.endsWith(".epub") || lowerUrl.endsWith(".zip") || lowerUrl.endsWith(".cbz") || contentType.includes("epub") || contentType.includes("zip");
    const isPdfExpected = lowerUrl.endsWith(".pdf") || contentType.includes("pdf");

    if (isEpubOrZipExpected && !isZip) {
      // It was supposed to be a ZIP/EPUB but didn't match magic bytes
      if (textSample.startsWith("{") || textSample.includes("error")) {
        try {
          const jsonErr = JSON.parse(textSample);
          if (jsonErr.error || jsonErr.message) {
            throw new Error(jsonErr.error || jsonErr.message);
          }
        } catch (e) {}
      }
      throw new Error("The downloaded EPUB/ZIP file is corrupted or in an invalid format. The mirror page may have returned an error page or expired link instead of the actual book file.");
    }

    if (isPdfExpected && !isPdf) {
      // Supposed to be a PDF but didn't match magic bytes
      throw new Error("The downloaded PDF file is corrupted or in an invalid format. The mirror page may have returned an error page or expired link instead of the actual book file.");
    }

    res.setHeader("Content-Type", contentType);
    if (contentDisposition) {
      res.setHeader("Content-Disposition", contentDisposition);
    } else {
      const filename = path.basename(new URL(resolvedFinalUrl).pathname) || "download.epub";
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    }

    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    res.send(Buffer.from(buffer));
  } catch (err: any) {
    console.log(`[Proxy File Info] Download did not complete: ${err.message || "Proxy download failed."}`);
    res.status(500).json({ error: err.message || "Proxy download failed." });
  }
});

// 5. API: Hardcover Proxy
app.post("/api/hardcover", express.json(), async (req, res) => {
  try {
    const { query, variables } = req.body;
    
    // The user provided this token in their instructions.
    const HARDCOVER_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJIYXJkY292ZXIiLCJ2ZXJzaW9uIjoiOCIsImp0aSI6ImJlZjk5YmYzLTFmOTUtNDNkYy04MGNmLWIzMTA1ZmI1M2QzNSIsImFwcGxpY2F0aW9uSWQiOjIsInN1YiI6IjEyNTg5MiIsImF1ZCI6IjEiLCJpZCI6IjEyNTg5MiIsImxvZ2dlZEluIjp0cnVlLCJpYXQiOjE3ODM0OTUxOTAsImV4cCI6MTgxNTAzMTE5MCwiaHR0cHM6Ly9oYXN1cmEuaW8vand0L2NsYWltcyI6eyJ4LWhhc3VyYS1hbGxvd2VkLXJvbGVzIjpbInVzZXIiXSwieC1oYXN1cmEtZGVmYXVsdC1yb2xlIjoidXNlciIsIngtaGFzdXJhLXJvbGUiOiJ1c2VyIiwiWC1oYXN1cmEtdXNlci1pZCI6IjEyNTg5MiJ9LCJ1c2VyIjp7ImlkIjoxMjU4OTJ9fQ.YtD1IJpcDSiMbwE4WLWAnvOG_s7OUi5umrfpryEQP8M";

    const response = await fetch("https://api.hardcover.app/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${HARDCOVER_TOKEN}`
      },
      body: JSON.stringify({ query, variables })
    });

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error("Hardcover Proxy Error:", err);
    res.status(500).json({ error: err.message || "Failed to communicate with Hardcover API." });
  }
});

// 6. API: Anna's Archive Search - delegates to local scraper (replaces broken RapidAPI)

// 6. API: Anna's Archive Search - Replaced with Rave Book Search
app.get("/api/annas-archive/search", async (req, res) => {
  try {
    const { q, source, page } = req.query;
    if (!q) return res.status(400).json({ error: "Query 'q' is required." });
    
    const searchSource = (source as string) || "all";
    const searchPage = parseInt(page as string) || 1;
    
    console.log(`Executing Rave Book Search for query: "${q}", source: ${searchSource}, page: ${searchPage}`);
    
    // Run Rave Search directly with a smart retry if results are initially scarce
    let raveResults: any[] = [];
    let meta: any = {};
    
    try {
      const initial = await fetchFromRaveBookSearch(q as string, "ebooks", searchSource, searchPage);
      raveResults = initial?.results || [];
      meta = initial?.meta || {};
    } catch (e) {
      console.error("Initial fetchFromRaveBookSearch failed:", e);
    }
    
    // Smart Retry / Pre-fetch wait logic for first-time searches:
    // We poll the Rave API up to 4 times (with 1.5s delay) to wait for the worker's background scraper to finish.
    // We break early if we get at least 25 results AND we have LibGen present, OR if the result count stops growing.
    if (searchPage === 1 && Array.isArray(raveResults)) {
      let attempts = 0;
      const maxAttempts = 4;
      
      while (attempts < maxAttempts) {
        const hasLibgen = raveResults.some(r => 
          r && (
            r.source === "Library Genesis" || 
            (r.source && typeof r.source === "string" && r.source.toLowerCase().includes("libgen")) || 
            (r.downloadUrl && typeof r.downloadUrl === "string" && r.downloadUrl.toLowerCase().includes("libgen")) ||
            (r.downloadUrl && typeof r.downloadUrl === "string" && r.downloadUrl.toLowerCase().includes("library.lol"))
          )
        );

        if (raveResults.length >= 25 && hasLibgen) {
          break;
        }

        attempts++;
        console.log(`[Search Delay Bypass] Query "${q}" has ${raveResults.length} results (LibGen present: ${hasLibgen}). Attempt ${attempts}/${maxAttempts}: Waiting 1500ms for background scraper to populate...`);
        await new Promise(resolve => setTimeout(resolve, 1500));

        try {
          const retryResult = await fetchFromRaveBookSearch(q as string, "ebooks", searchSource, searchPage);
          const retryResultsList = retryResult?.results || [];
          if (retryResultsList.length > raveResults.length) {
            console.log(`[Search Delay Bypass] Attempt ${attempts} succeeded! Got ${retryResultsList.length} results (previously ${raveResults.length}).`);
            raveResults = retryResultsList;
            meta = retryResult?.meta || {};
          } else {
            console.log(`[Search Delay Bypass] Attempt ${attempts} finished, result count stayed at ${raveResults.length}.`);
            // If we already have Libgen and the count didn't increase, we can stop early
            if (hasLibgen) {
              break;
            }
          }
        } catch (retryErr) {
          console.error(`[Search Delay Bypass] Retry attempt ${attempts} failed:`, retryErr);
        }
      }
    }
    
    // Ensure raveResults is indeed an array before mapping/forEach
    if (Array.isArray(raveResults)) {
      // Populate global bookCache
      raveResults.forEach(b => {
        if (b && b.md5) bookCache.set(b.md5, b);
      });
    } else {
      raveResults = [];
    }

    const RESULTS_PER_PAGE = 25;
    // Use exact total from meta if available; otherwise infer from page count
    const totalFromMeta = meta.total && meta.total > 0 ? meta.total : null;
    // hasMore: true if we got a full page (likely more exist) OR meta.total indicates more
    const hasMore = raveResults.length >= RESULTS_PER_PAGE ||
      (totalFromMeta !== null && searchPage * RESULTS_PER_PAGE < totalFromMeta);
    // totalCount: prefer meta, else estimate conservatively from received + possible next pages
    const totalCount = totalFromMeta ?? (hasMore ? (searchPage * RESULTS_PER_PAGE) + RESULTS_PER_PAGE : raveResults.length);

    res.json({
      books: raveResults,
      results: raveResults,
      source: searchSource,
      page: searchPage,
      pageSize: raveResults.length,
      meta: meta,
      totalCount,
      hasMore,
      mirror: "Rave Official Site",
      parsedBy: "Puppeteer Scraper"
    });
  } catch (err: any) {
    console.error("Rave Book Search API failed:", err);
    res.status(500).json({ error: err.message });
  }
});



// 7. API: Anna's Archive Download
app.get("/api/annas-archive/download", async (req, res) => {
  try {
    const { md5, iaId: iaIdParam } = req.query;
    if (!md5) return res.status(400).json({ error: "md5 is required." });

    const cachedBook = bookCache.get(md5 as string);
    let downloadLinks: any[] = [];

    const md5Str = md5 as string;
    const isRealMd5 = /^[a-f0-9]{32}$/i.test(md5Str);

    if (isRealMd5) {
      // 1. Prioritize Direct Mirror (library.lol) - Recommended because proxy-file handles it programmatically
      downloadLinks.push({
        label: "Library.lol (Recommended)",
        url: `https://library.lol/main/${md5Str}`,
        isDirect: true
      });

      // 2. Add Libgen Mirror (libgen.li)
      downloadLinks.push({
        label: "Libgen Mirror",
        url: `https://libgen.li/get.php?md5=${md5Str.toLowerCase()}`,
        isDirect: true
      });

      // 3. Add cached direct links if they exist and are not slow links
      if (cachedBook && cachedBook.downloadUrl) {
        const urlLower = cachedBook.downloadUrl.toLowerCase();
        const isSlow = urlLower.includes("/slow_download/") || urlLower.includes("annas-archive");
        const alreadyHas = downloadLinks.some(l => l.url === cachedBook.downloadUrl);
        if (!alreadyHas) {
          downloadLinks.push({
            label: isSlow ? "Anna's Archive (Slow/Manual)" : "Direct Download Mirror",
            url: cachedBook.downloadUrl,
            isDirect: !isSlow
          });
        }
      }

      // 4. Add Anna's Archive lookup page as manual backup
      downloadLinks.push({
        label: "Anna's Archive (Manual)",
        url: `https://annas-archive.org/md5/${md5Str}`,
        isDirect: false
      });
    } else {
      // Not a real 32-character hex MD5 - likely an Internet Archive SHA-256 or pseudo-id
      const iaId = iaIdParam as string || cachedBook?.iaId || "";
      const downloadUrl = cachedBook?.downloadUrl || "";

      if (iaId) {
        try {
          const metaRes = await fetch(`https://archive.org/metadata/${iaId}`, {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(8000)
          });
          if (metaRes.ok) {
            const meta = await metaRes.json();
            const files: any[] = meta.files || [];
            const epubFile = files.find((f: any) => f.name?.endsWith(".epub"));
            const pdfFile = files.find((f: any) => f.name?.endsWith(".pdf"));
            if (epubFile) {
              downloadLinks.push({
                label: "Internet Archive (EPUB)",
                url: `https://archive.org/download/${iaId}/${encodeURIComponent(epubFile.name)}`,
                isDirect: true
              });
            }
            if (pdfFile) {
              downloadLinks.push({
                label: "Internet Archive (PDF)",
                url: `https://archive.org/download/${iaId}/${encodeURIComponent(pdfFile.name)}`,
                isDirect: true
              });
            }
          }
        } catch (e: any) {
          console.warn("Failed to resolve archive.org item:", e.message);
        }
      }

      if (downloadUrl) {
        const alreadyHas = downloadLinks.some(l => l.url === downloadUrl);
        if (!alreadyHas) {
          const isIaDetails = downloadUrl.includes("archive.org/details/");
          downloadLinks.push({
            label: isIaDetails ? "Internet Archive (Manual)" : "Source Mirror",
            url: downloadUrl,
            isDirect: !isIaDetails
          });
        }
      }
    }

    // Final fallback if nothing
    if (downloadLinks.length === 0) {
      const workingMirror = LIBGEN_MIRRORS.find(m => !m.includes("libgen.li")) || "https://libgen.be";
      downloadLinks.push({
        label: "Manual Search Fallback",
        url: `${workingMirror}/index.php?req=${md5}`,
        isDirect: false
      });
    }

    res.json({
      downloadLinks: downloadLinks,
      options: downloadLinks,
      mirror: "Consolidated Search Cache",
      parsedBy: "Rave API"
    });
  } catch (err: any) {
    console.error("Download route error:", err);
    res.status(500).json({ error: "Failed to get download links" });
  }
});

// 7. API: Open Library Proxy
app.get("/api/open-library/search", async (req, res) => {
  try {
    const { q, title, author } = req.query;
    const url = new URL("https://openlibrary.org/search.json");
    if (q) url.searchParams.append("q", q as string);
    if (title) url.searchParams.append("title", title as string);
    if (author) url.searchParams.append("author", author as string);
    url.searchParams.append("limit", "10");

    const response = await fetch(url.toString());
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error("Open Library Search Error:", err);
    res.status(500).json({ error: "Failed to communicate with Open Library API." });
  }
});


// ==========================================
// IN-APP BROWSER PROXY & BOOK INTERCEPTION
// ==========================================

// Enable URL-encoded parser for forms
app.use(express.urlencoded({ limit: "50mb", extended: true }));

function setProxiedCookies(res: any, setCookieHeaders: string[] | string | undefined, targetHost: string) {
  if (!setCookieHeaders) return;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  const hostEncoded = targetHost.replace(/\./g, "_");
  
  for (const cookieStr of headers) {
    const firstPart = cookieStr.split(";")[0];
    const eqIdx = firstPart.indexOf("=");
    if (eqIdx !== -1) {
      const name = firstPart.substring(0, eqIdx).trim();
      const val = firstPart.substring(eqIdx + 1).trim();
      
      const cookieKey = `prox_${hostEncoded}___${name}`;
      res.cookie(cookieKey, val, {
        path: "/",
        httpOnly: false,
        secure: false,
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });
    }
  }
}

app.all("/api/browser-proxy", async (req, res) => {
  let targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send("Missing target 'url' parameter.");
  }

  const adblockActive = req.query.adblock !== "false";
  const torActive = req.query.tor !== "false";
  const customUa = req.query.ua as string || "chrome";
  const proxyMode = req.query.mode as string || "auto"; // 'auto' | 'standard' | 'puppeteer'

  // Tor/Onion Gateway routing
  if (torActive) {
    try {
      const parsed = new URL(targetUrl);
      if (parsed.hostname.endsWith(".onion")) {
        // Route onion links through a public onion-to-web gateway
        parsed.hostname = parsed.hostname + ".pet";
        targetUrl = parsed.toString();
        console.log(`[Tor Gateway Router] Onion domain rerouted to: ${targetUrl}`);
      }
    } catch (e) {
      console.error("[Tor Gateway Router Error]", e);
    }
  }

  try {
    console.log(`[Browser Proxy] ${req.method} request to: ${targetUrl} [Mode: ${proxyMode}, Adblock: ${adblockActive}, Tor: ${torActive}, UA: ${customUa}]`);
    
    const parsedTarget = new URL(targetUrl);
    const targetHost = parsedTarget.hostname;
    
    // Parse client's incoming cookies
    const clientCookies = parseCookies(req.headers.cookie);
    
    // Construct Cookie header for the target
    const targetCookieHeader = getTargetCookies(clientCookies, targetHost);
    
    // Select custom User-Agent
    let userAgentStr = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
    if (customUa === "tor") {
      userAgentStr = "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0";
    } else if (customUa === "mobile") {
      userAgentStr = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
    } else if (customUa === "firefox") {
      userAgentStr = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0";
    }

    const targetHeaders: Record<string, string> = {
      "User-Agent": userAgentStr,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": parsedTarget.origin
    };
    
    if (targetCookieHeader) {
      targetHeaders["Cookie"] = targetCookieHeader;
    }
    
    let fetchBody: any = undefined;
    if (req.method === "POST") {
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams(req.body);
        fetchBody = params.toString();
        targetHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      } else if (contentType.includes("application/json")) {
        fetchBody = JSON.stringify(req.body);
        targetHeaders["Content-Type"] = "application/json";
      } else {
        const params = new URLSearchParams(req.body);
        fetchBody = params.toString();
        targetHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      }
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      try { controller.abort(); } catch (_) {}
    }, 12000); // 12 second timeout
    
    let fetchResponse: any = null;
    let usePuppeteer = proxyMode === "puppeteer";
    let puppeteerHtml = "";
    let puppeteerFinalUrl = targetUrl;
    let bodyText = "";
    
    const isLibgenUrl = /libgen\.(li|gs|lc|rocks|st|io|is|rs|be|org)/i.test(targetUrl);
    const isAnnasArchiveUrl = /annas-archive\.(org|gs|se|li|sh|gl|io)/i.test(targetUrl);
    const isZLibraryUrl = /(z-lib|z-library|singlelogin)\.(gs|se|org|re|io|do|sh|link)/i.test(targetUrl);
    const isEbookSite = isLibgenUrl || isAnnasArchiveUrl || isZLibraryUrl;

    if (proxyMode !== "standard" && !usePuppeteer) {
      try {
        fetchResponse = await fetch(targetUrl, {
          method: req.method,
          headers: targetHeaders,
          body: fetchBody,
          redirect: "manual",
          signal: controller.signal
        });
        
        const contentTypeStr = fetchResponse.headers.get("content-type") || "";
        const isHtmlResponse = contentTypeStr.toLowerCase().includes("text/html") || 
                              contentTypeStr.toLowerCase().includes("application/xhtml+xml");
        
        if (isEbookSite && (fetchResponse.status === 503 || fetchResponse.status === 403 || fetchResponse.status === 429)) {
          console.log(`[Browser Proxy] Standard fetch to e-book site got status ${fetchResponse.status}. Triggering Puppeteer fallback...`);
          usePuppeteer = true;
        } else if (isHtmlResponse && fetchResponse.status === 200) {
          bodyText = await fetchResponse.clone().text();
          if (bodyText.includes("challenges.cloudflare.com") || 
              bodyText.includes("cf-challenge") || 
              bodyText.includes("DDoS-Guard") || 
              bodyText.includes("Please wait...") ||
              bodyText.includes("captcha") ||
              bodyText.includes("security check")) {
            console.log(`[Browser Proxy] Cloudflare/anti-bot signature found in body text. Bypassing with Puppeteer...`);
            usePuppeteer = true;
          }
        }
      } catch (fetchErr: any) {
        if (isEbookSite) {
          console.warn(`[Browser Proxy] Standard fetch to e-book site failed (${fetchErr.message}). Triggering Puppeteer fallback...`);
          usePuppeteer = true;
        } else {
          throw fetchErr;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      clearTimeout(timeoutId);
    }
    
    if (!usePuppeteer && !fetchResponse) {
      // Execute standard fetch when not using Puppeteer fallback or forced Puppeteer
      try {
        fetchResponse = await fetch(targetUrl, {
          method: req.method,
          headers: targetHeaders,
          body: fetchBody,
          redirect: "manual"
        });
      } catch (err) {
        throw err;
      }
    }
    
    if (usePuppeteer) {
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      });
      try {
        const page = await browser.newPage();
        await page.setUserAgent(userAgentStr);
        
        const hostEncoded = targetHost.replace(/\./g, "_");
        const prefix = `prox_${hostEncoded}___`;
        const cookiesToSet = [];
        for (const [key, val] of Object.entries(clientCookies)) {
          if (key.startsWith(prefix)) {
            const realName = key.substring(prefix.length);
            cookiesToSet.push({
              name: realName,
              value: val,
              domain: targetHost,
              path: "/"
            });
          }
        }
        if (cookiesToSet.length > 0) {
          await page.setCookie(...cookiesToSet);
        }
        
        console.log(`[Browser Proxy Puppeteer] Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        
        puppeteerHtml = await page.content();
        puppeteerFinalUrl = page.url();
        
        // Capture any new cookies set during this session
        const pageCookies = await page.cookies();
        for (const cookie of pageCookies) {
          const cookieKey = `prox_${hostEncoded}___${cookie.name}`;
          res.cookie(cookieKey, cookie.value, {
            path: "/",
            httpOnly: false,
            secure: false,
            maxAge: 30 * 24 * 60 * 60 * 1000
          });
        }
      } finally {
        await browser.close();
      }
    }
    
    const finalUrl = usePuppeteer ? puppeteerFinalUrl : (fetchResponse.url || targetUrl);
    const finalParsed = new URL(finalUrl);
    const finalHost = finalParsed.hostname;
    
    const contentType = usePuppeteer ? "text/html" : (fetchResponse.headers.get("content-type") || "");
    const contentDisposition = usePuppeteer ? "" : (fetchResponse.headers.get("content-disposition") || "");
    
    let setCookieHeader: string[] | string | null = null;
    if (!usePuppeteer && fetchResponse) {
      if (typeof fetchResponse.headers.getSetCookie === "function") {
        setCookieHeader = fetchResponse.headers.getSetCookie();
      } else {
        setCookieHeader = fetchResponse.headers.get("set-cookie");
      }
      if (setCookieHeader && (Array.isArray(setCookieHeader) ? setCookieHeader.length > 0 : !!setCookieHeader)) {
        setProxiedCookies(res, setCookieHeader, finalHost);
      }
    }
    
    // Handle redirect manually
    if (!usePuppeteer && fetchResponse && fetchResponse.status >= 300 && fetchResponse.status < 400) {
      const location = fetchResponse.headers.get("location");
      if (location) {
        const redirectUrl = new URL(location, targetUrl).toString();
        return res.redirect(fetchResponse.status, `/api/browser-proxy?url=${encodeURIComponent(redirectUrl)}`);
      }
    }
    
    const isEbookExtension = /\.(epub|pdf|mobi|cbz|cbr|zip)$/i.test(finalParsed.pathname.split('?')[0]);
    const isAttachment = contentDisposition.toLowerCase().includes("attachment");
    const isBinaryContent = !contentType.toLowerCase().includes("text/html") && 
                             !contentType.toLowerCase().includes("application/xhtml+xml") &&
                             !contentType.toLowerCase().includes("text/xml") &&
                             !contentType.toLowerCase().includes("application/json") &&
                             !contentType.toLowerCase().includes("text/plain") &&
                             !contentType.toLowerCase().includes("text/css") &&
                             !contentType.toLowerCase().includes("application/javascript");
                             
    // Extract filename for potential ebook interceptor
    let filename = "download.epub";
    if (contentDisposition) {
      const match = contentDisposition.match(/filename\*?=["']?(?:UTF-8'')?([^"';]+)["']?/i);
      if (match && match[1]) {
        filename = decodeURIComponent(match[1]);
      } else {
        const matchSimple = contentDisposition.match(/filename=["']?([^"';]+)["']?/i);
        if (matchSimple && matchSimple[1]) {
          filename = matchSimple[1];
        }
      }
    } else {
      const base = path.basename(finalParsed.pathname);
      if (base && base.includes(".")) {
        filename = base;
      }
    }

    // Precise ebook check to avoid intercepting images, fonts, styles, scripts, or json
    const isEbook = isEbookExtension || 
                    (isAttachment && !/\.(png|jpe?g|gif|webp|svg|ico|woff2?|css|js|json|xml|html?)$/i.test(filename)) ||
                    (contentType.toLowerCase().includes("application/epub+zip") || contentType.toLowerCase().includes("application/pdf"));

    if (isEbook) {
      console.log(`[Browser Proxy] Intercepted ebook download! URL: ${finalUrl}`);
      
      res.setHeader("Content-Type", "text/html");
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Download Intercepted</title>
          <style>
            body {
              background-color: #121212;
              color: #f4f4f5;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              padding: 16px;
              box-sizing: border-box;
              text-align: center;
            }
            .card {
              background: #18181b;
              border: 1px solid #27272a;
              border-radius: 20px;
              padding: 40px 24px;
              max-width: 440px;
              width: 100%;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
            }
            .icon-wrapper {
              width: 64px;
              height: 64px;
              background: rgba(16, 185, 129, 0.1);
              border: 1px solid rgba(16, 185, 129, 0.3);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              margin: 0 auto 24px;
            }
            .icon {
              width: 32px;
              height: 32px;
              color: #10b981;
            }
            h2 {
              margin: 0 0 12px;
              font-size: 22px;
              font-weight: 700;
              color: #10b981;
            }
            p {
              font-size: 14px;
              color: #a1a1aa;
              margin: 0 0 24px;
              line-height: 1.5;
            }
            .filename {
              font-family: monospace;
              background: #09090b;
              border: 1px solid #27272a;
              padding: 12px 16px;
              border-radius: 10px;
              font-size: 13px;
              color: #38bdf8;
              word-break: break-all;
              margin: 20px 0;
            }
            .btn {
              background: #10b981;
              color: #ffffff;
              border: none;
              padding: 14px 28px;
              border-radius: 12px;
              font-weight: 600;
              cursor: pointer;
              font-size: 15px;
              transition: all 0.2s;
              width: 100%;
              box-sizing: border-box;
              box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
            }
            .btn:hover {
              background: #059669;
              transform: translateY(-1px);
            }
            .btn:active {
              transform: translateY(1px);
            }
            .back-btn {
              background: transparent;
              color: #a1a1aa;
              border: 1px solid #27272a;
              padding: 10px 20px;
              border-radius: 10px;
              cursor: pointer;
              font-size: 13px;
              margin-top: 16px;
              transition: all 0.2s;
            }
            .back-btn:hover {
              background: #27272a;
              color: #f4f4f5;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon-wrapper">
              <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
              </svg>
            </div>
            <h2>Ebook Capture Detected!</h2>
            <p>We successfully intercepted your download request. Click below to add this book straight into your Kora library.</p>
            
            <div class="filename">${filename}</div>
            
            <button class="btn" id="import-button" onclick="triggerImport()">Import into Library</button>
            <button class="back-btn" onclick="window.history.back()">Go Back</button>
          </div>

          <script>
            let imported = false;
            function triggerImport() {
              if (imported) return;
              imported = true;
              const btn = document.getElementById("import-button");
              btn.innerText = "Importing...";
              btn.style.background = "#047857";
              btn.disabled = true;

              window.parent.postMessage({
                type: "KORA_IMPORT_BOOK",
                url: "${finalUrl}",
                filename: "${filename}",
                contentType: "${contentType}"
              }, "*");
            }

            window.onload = function() {
              setTimeout(triggerImport, 200);
            };
          </script>
        </body>
        </html>
      `);
    } else if (isBinaryContent) {
      console.log(`[Browser Proxy] Serving binary resource: ${finalUrl} (${contentType})`);
      if (usePuppeteer) {
        res.setHeader("Content-Type", "text/html");
        return res.send(puppeteerHtml);
      }
      const buffer = await fetchResponse.arrayBuffer();
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      return res.send(Buffer.from(buffer));
    }

    const isHtml = contentType.toLowerCase().includes("text/html") || 
                   contentType.toLowerCase().includes("application/xhtml+xml");

    if (!isHtml) {
      console.log(`[Browser Proxy] Serving text resource: ${finalUrl} (${contentType})`);
      const textContent = usePuppeteer ? puppeteerHtml : await fetchResponse.text();
      res.setHeader("Content-Type", contentType || "text/plain");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      return res.send(textContent);
    }
    
    const rawHtml = usePuppeteer ? puppeteerHtml : (bodyText || await fetchResponse.text());
    const $ = cheerio.load(rawHtml);
    
    // Integrated Server-Side Ad-Blocker
    if (adblockActive) {
      const adBlockPatterns = [
        "googlesyndication.com",
        "doubleclick.net",
        "exoclick.com",
        "popads.net",
        "onclickads.net",
        "adsterra.com",
        "adservice.google",
        "google-analytics.com",
        "quantserve.com",
        "adzerk.net",
        "adnxs.com",
        "amazon-adsystem.com",
        "ad.doubleclick",
        "ads.google"
      ];
      
      $("script, iframe, img, link").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("href") || "";
        if (adBlockPatterns.some(pat => src.includes(pat))) {
          $(el).remove();
        }
      });
      $(".adsbygoogle, .ad-banner, .popunder, .ad-zone, #ad-slot").remove();
    }
    
    // Inject cookie-override script so that client-side scripts of the proxied site
    // can transparently set/get cookies via document.cookie using our proxy prefix.
    const hostEncoded = finalHost.replace(/\./g, "_");
    const cookieOverrideScript = `
      <script id="kora-cookie-override">
        (function() {
          const targetHostEncoded = "${hostEncoded}";
          try {
            const originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') || 
                                             Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
                                             
            if (originalCookieDescriptor && originalCookieDescriptor.configurable) {
              Object.defineProperty(document, 'cookie', {
                get: function() {
                  const rawCookies = originalCookieDescriptor.get.call(document);
                  if (!rawCookies) return "";
                  const parts = rawCookies.split(";");
                  const matched = [];
                  const prefix = "prox_" + targetHostEncoded + "___";
                  for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim();
                    if (part.indexOf(prefix) === 0) {
                      matched.push(part.substring(prefix.length));
                    } else if (part.indexOf("prox_") !== 0) {
                      matched.push(part);
                    }
                  }
                  return matched.join("; ");
                },
                set: function(val) {
                  if (!val) return;
                  const parts = val.split(";");
                  const firstPart = parts[0];
                  const eqIdx = firstPart.indexOf("=");
                  if (eqIdx !== -1) {
                    const name = firstPart.substring(0, eqIdx).trim();
                    const cookieVal = firstPart.substring(eqIdx + 1).trim();
                    const proxName = "prox_" + targetHostEncoded + "___" + name;
                    parts[0] = proxName + "=" + cookieVal;
                    
                    let hasPath = false;
                    for (let i = 1; i < parts.length; i++) {
                      const lower = parts[i].trim().toLowerCase();
                      if (lower.indexOf("path=") === 0) {
                        parts[i] = "path=/";
                        hasPath = true;
                      } else if (lower.indexOf("domain=") === 0) {
                        parts[i] = ""; // strip domain so it sets on current origin
                      }
                    }
                    if (!hasPath) {
                      parts.push("path=/");
                    }
                    const finalCookieStr = parts.filter(Boolean).join("; ");
                    originalCookieDescriptor.set.call(document, finalCookieStr);
                  } else {
                    originalCookieDescriptor.set.call(document, val);
                  }
                }
              });
            }
          } catch (e) {
            console.warn("Cookie proxy injection failed:", e);
          }
        })();
      </script>
    `;
    if ($("head").length > 0) {
      $("head").prepend(cookieOverrideScript);
    } else if ($("body").length > 0) {
      $("body").prepend(cookieOverrideScript);
    } else {
      $.root().prepend(cookieOverrideScript);
    }
    
    function resolveUrl(href: string): string {
      try {
        if (!href) return "";
        return new URL(href, finalUrl).href;
      } catch (e) {
        return href;
      }
    }
    
    // Construct persist query parameters
    const persistParams = `&adblock=${adblockActive}&tor=${torActive}&mode=${proxyMode}&ua=${customUa}`;
    
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        const resolved = resolveUrl(href);
        if (resolved.startsWith("http")) {
          $(el).attr("href", `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`);
        }
      }
    });
    
    $("form").each((_, el) => {
      const action = $(el).attr("action") || "";
      const resolved = resolveUrl(action);
      $(el).attr("action", `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`);
    });
    
    $("img").each((_, el) => {
      const src = $(el).attr("src");
      if (src) {
        const resolved = resolveUrl(src);
        $(el).attr("src", `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`);
      }
      
      const srcset = $(el).attr("srcset");
      if (srcset) {
        const rewritten = srcset.split(",").map(item => {
          const parts = item.trim().split(/\s+/);
          if (parts[0]) {
            const resolved = resolveUrl(parts[0]);
            parts[0] = `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`;
          }
          return parts.join(" ");
        }).join(", ");
        $(el).attr("srcset", rewritten);
      }
    });
    
    $("script").each((_, el) => {
      const src = $(el).attr("src");
      if (src) {
        const resolved = resolveUrl(src);
        $(el).attr("src", `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`);
      }
    });
    
    $("link").each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        const resolved = resolveUrl(href);
        const rel = ($(el).attr("rel") || "").toLowerCase();
        if (rel === "stylesheet" || rel === "manifest" || rel.includes("icon") || rel.includes("preload")) {
          $(el).attr("href", `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`);
        } else {
          $(el).attr("href", resolved);
        }
      }
    });

    $("iframe").each((_, el) => {
      const src = $(el).attr("src");
      if (src) $(el).attr("src", `/api/browser-proxy?url=${encodeURIComponent(resolveUrl(src))}${persistParams}`);
    });
    
    res.setHeader("Content-Type", "text/html");
    res.send($.html());
    
  } catch (err: any) {
    console.error(`[Browser Proxy Error]`, err);
    const isTimeout = err.name === "AbortError" || err.message?.includes("timeout");
    const errMsg = isTimeout
      ? `The website took too long to respond. The site may be blocked, down, or requiring security/browser verification that timed out.`
      : (err.message || "An unexpected error occurred while proxying this web page.");
      
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Connection Error</title>
        <style>
          body {
            background-color: #0f172a;
            color: #f1f5f9;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
          }
          .card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 16px;
            padding: 32px 24px;
            max-width: 480px;
            width: 100%;
            text-align: center;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
          }
          .icon-wrapper {
            width: 56px;
            height: 56px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
          }
          .icon {
            width: 28px;
            height: 28px;
            color: #ef4444;
          }
          h2 {
            margin: 0 0 12px;
            font-size: 20px;
            font-weight: 700;
          }
          p {
            font-size: 14px;
            color: #94a3b8;
            margin: 0 0 24px;
            line-height: 1.6;
          }
          .url-box {
            font-family: monospace;
            font-size: 12px;
            background: #0f172a;
            border: 1px solid #334155;
            padding: 10px;
            border-radius: 8px;
            color: #38bdf8;
            word-break: break-all;
            margin-bottom: 24px;
          }
          .actions {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .btn {
            padding: 12px 20px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.15s ease-in-out;
            text-decoration: none;
            display: inline-block;
          }
          .btn-primary {
            background: #3b82f6;
            color: white;
            border: none;
          }
          .btn-primary:hover {
            background: #2563eb;
          }
          .btn-secondary {
            background: transparent;
            color: #94a3b8;
            border: 1px solid #334155;
          }
          .btn-secondary:hover {
            background: #334155;
            color: #f1f5f9;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-wrapper">
            <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2>Failed to Load Page</h2>
          <p>${errMsg}</p>
          <div class="url-box">${targetUrl}</div>
          <div class="actions">
            <button class="btn btn-primary" onclick="window.location.reload()">Retry Connection</button>
            <a class="btn btn-secondary" href="${targetUrl}" target="_blank" rel="noopener noreferrer">Open in New Tab</a>
            <button class="btn btn-secondary" onclick="window.history.back()">Go Back</button>
          </div>
        </div>
      </body>
      </html>
    `);
  }
});


// Serve static assets and Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Ebook Sync Reader server booted on port ${PORT}`);
  });
}

startServer();
