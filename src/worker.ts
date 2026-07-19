import puppeteer from "@cloudflare/puppeteer";
import * as cheerio from "cheerio";
import {
  POPULAR_AUDIOBOOKS,
  mapPopularAudiobooks,
  parseAudiobookDetailHtml,
  parseAudiobookSearchHtml,
  extractFirstBookLinkFromSearch,
  isAudiobookSearchUrl,
  scrapePopularAudiobooks,
  searchAudiobooksFromSources,
  titlesRoughlyMatch,
} from "./lib/audiobookScraper";
import {
  getCachedAudiobookDetail,
  getCachedAudiobookSearch,
  setCachedAudiobookSearch,
  resolveAudiobookDetailParallel,
  resolveAudiobookDetailFromPage,
} from "./lib/audiobookServer";
import { fetchGoodreadsTrendingBooks, mapGoodreadsTrendingFallback } from "./lib/goodreadsTrending";
import { discoverFeedFromUrl, fetchArticlePreview, fetchFeedFromUrl, proxyFeedImage } from "./lib/feedServer";
import { fetchBinaryWithLibgenMirrors, isLibgenUrl } from "./lib/libgenProxy";
import { normalizeMediaUrl, refererForMediaUrl } from "./lib/mediaUrl";
import { transcribeAudioBase64 } from "./lib/transcribeAudio";

declare const HTMLRewriter: any;

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Build an NYT-shaped "overview" feed from the Rave engine so the Discover page
// always has real content even when the NYT Books API key is missing/invalid.
async function buildRaveFallbackFeed(): Promise<any> {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
  const topics = [
    { key: "hardcover-fiction", name: "Hardcover Fiction", q: "bestselling fiction" },
    { key: "hardcover-nonfiction", name: "Hardcover Nonfiction", q: "bestselling nonfiction" },
    { key: "e-book-fiction", name: "E-Book Fiction", q: "popular fantasy novels" },
    { key: "advice-how-to", name: "Advice & How-To", q: "self help books" },
    { key: "young-adult-hardcover", name: "Young Adult", q: "young adult novels" },
    { key: "childrens-middle-grade-hardcover", name: "Middle Grade", q: "children chapter books" }
  ];
  const lists: any[] = [];
  for (const t of topics) {
    try {
      const url = `https://ravebooksearch.cloudflare-s3cvv.workers.dev/search/all?q=${encodeURIComponent(t.q)}&mode=ebooks&source=all&page=1`;
      const r = await fetch(url, { headers: { "User-Agent": ua } });
      if (!r.ok) continue;
      const j = await r.json();
      const books = (j.results || []).slice(0, 8).map((b: any) => ({
        title: (b.title || "").replace(/;[^;]{0,4}\d{10,13}[^;]*/g, "").trim(),
        author: (b.author || "Unknown").replace(/[,;]$/, "").trim(),
        book_image: b.coverUrl || "",
        description: b.publisher || "",
        primary_isbn13: b.md5 || ""
      }));
      if (books.length) {
        lists.push({
          list_name: t.name,
          display_name: t.name,
          list_name_encoded: t.key,
          books
        });
      }
    } catch (_) { /* try next topic */ }
  }
  return { status: "OK", results: { lists } };
}

// signed CDN download link (get.php?md5=<h>&key=<t>). LibGen 307-redirects the
// keyless link to an ads page that embeds the signed link in an <a href>.
// Returns "" if it cannot be resolved.
async function resolveLibgenSigned(md5: string): Promise<string> {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
  for (const host of ["libgen.li", "libgen.is", "libgen.rs"]) {
    try {
      const res = await fetch(`https://${host}/get.php?md5=${md5}`, {
        headers: { "User-Agent": ua },
        redirect: "follow"
      });
      if (!res.ok) continue;
      const html = await res.text();
      const m = html.match(/get\.php\?md5=[a-f0-9]+&key=[A-Za-z0-9]+/i);
      if (m) return `https://${host}/${m[0]}`;
    } catch (_) { /* try next host */ }
  }
  return "";
}

function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach(cookie => {
    const parts = cookie.split("=");
    if (parts.length >= 2) {
      list[parts[0].trim()] = parts.slice(1).join("=").trim();
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
      }
    }
  }
  return cookies.join("; ");
}

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch (e) {
    return href;
  }
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
        else if (url.endsWith(".html")) extension = "html";
        else if (url.endsWith(".json")) extension = "json";
        else if (url.endsWith(".txt")) extension = "txt";
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
        coverUrl = `/api/cover-redirect?md5=${md5}`;
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
        iaId: r.source === "Internet Archive" ? ((r.directUrl || r.downloadUrl || "").split("/details/")[1]?.split("/")[0]?.split("?")[0] || "") : "",
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
  GOOGLE_BOOKS_API_KEY?: string;
  NYT_BOOKS_API_KEY?: string;
  GEMINI_API_KEY?: string;
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

const goodreadsCache = new Map<string, any>();

async function fetchPageHtmlWithProxies(targetUrl: string, expectedMarker?: string): Promise<string> {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0"
  ];
  const headers = {
    "User-Agent": userAgents[Math.floor(Math.random() * userAgents.length)],
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache"
  };

  // Try 1: Direct fetch
  try {
    console.log(`[Proxy Fetcher] Trying direct fetch: ${targetUrl}`);
    const res = await fetch(targetUrl, { headers });
    if (res.ok) {
      const html = await res.text();
      if (!expectedMarker || html.includes(expectedMarker)) {
        console.log(`[Proxy Fetcher] Direct fetch succeeded.`);
        return html;
      }
    }
  } catch (e: any) {
    console.warn(`[Proxy Fetcher] Direct fetch failed: ${e.message}`);
  }

  // Try 2: Via corsproxy.io
  try {
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;
    console.log(`[Proxy Fetcher] Trying corsproxy.io: ${proxyUrl}`);
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const html = await res.text();
      if (!expectedMarker || html.includes(expectedMarker)) {
        console.log(`[Proxy Fetcher] corsproxy.io succeeded.`);
        return html;
      }
    }
  } catch (e: any) {
    console.warn(`[Proxy Fetcher] corsproxy.io failed: ${e.message}`);
  }

  // Try 3: Via api.allorigins.win
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    console.log(`[Proxy Fetcher] Trying allorigins: ${proxyUrl}`);
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const html = await res.text();
      if (!expectedMarker || html.includes(expectedMarker)) {
        console.log(`[Proxy Fetcher] allorigins succeeded.`);
        return html;
      }
    }
  } catch (e: any) {
    console.warn(`[Proxy Fetcher] allorigins failed: ${e.message}`);
  }

  // Try 4: Via codetabs
  try {
    const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
    console.log(`[Proxy Fetcher] Trying codetabs: ${proxyUrl}`);
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const html = await res.text();
      if (!expectedMarker || html.includes(expectedMarker)) {
        console.log(`[Proxy Fetcher] codetabs succeeded.`);
        return html;
      }
    }
  } catch (e: any) {
    console.warn(`[Proxy Fetcher] codetabs failed: ${e.message}`);
  }

  throw new Error(`Failed to fetch page: ${targetUrl}`);
}

async function fetchGoodreadsHtml(listQuery: string): Promise<string> {
  const targetUrl = `https://www.goodreads.com/list/show/${listQuery}`;
  return fetchPageHtmlWithProxies(targetUrl, "bookTitle");
}

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

    // Browser Proxy Route using Cloudflare's Browser Run (env.BROWSER) & native HTMLRewriter
    if (path === "/api/browser-proxy") {
      let targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        return new Response("Missing target 'url' parameter.", { 
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      const adblockActive = url.searchParams.get("adblock") !== "false";
      const torActive = url.searchParams.get("tor") !== "false";
      const customUa = url.searchParams.get("ua") || "chrome";
      const proxyMode = url.searchParams.get("mode") || "auto"; // 'auto' | 'standard' | 'puppeteer'

      if (torActive) {
        try {
          const parsed = new URL(targetUrl);
          if (parsed.hostname.endsWith(".onion")) {
            parsed.hostname = parsed.hostname + ".pet";
            targetUrl = parsed.toString();
          }
        } catch (e) {}
      }

      try {
        const parsedTarget = new URL(targetUrl);
        const targetHost = parsedTarget.hostname;
        
        const cookieHeader = request.headers.get("Cookie") || "";
        const clientCookies = parseCookies(cookieHeader);
        const targetCookieHeader = getTargetCookies(clientCookies, targetHost);

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
        if (request.method === "POST") {
          const contentType = request.headers.get("content-type") || "";
          if (contentType.includes("application/x-www-form-urlencoded")) {
            const bodyText = await request.text();
            fetchBody = bodyText;
            targetHeaders["Content-Type"] = "application/x-www-form-urlencoded";
          } else if (contentType.includes("application/json")) {
            const bodyText = await request.text();
            fetchBody = bodyText;
            targetHeaders["Content-Type"] = "application/json";
          }
        }

        let usePuppeteer = proxyMode === "puppeteer";
        let puppeteerHtml = "";
        let puppeteerFinalUrl = targetUrl;
        let bodyText = "";

        const isLibgenUrl = /libgen\.(li|gs|lc|rocks|st|io|is|rs|be|org)/i.test(targetUrl);
        const isAnnasArchiveUrl = /annas-archive\.(org|gs|se|li|sh|gl|io)/i.test(targetUrl);
        const isZLibraryUrl = /(z-lib|z-library|singlelogin)\.(gs|se|org|re|io|do|sh|link)/i.test(targetUrl);
        const isEbookSite = isLibgenUrl || isAnnasArchiveUrl || isZLibraryUrl;

        let fetchResponse: Response | null = null;

        if (proxyMode !== "standard" && !usePuppeteer) {
          try {
            fetchResponse = await fetch(targetUrl, {
              method: request.method,
              headers: targetHeaders,
              body: fetchBody,
              redirect: "manual"
            });

            const contentTypeStr = fetchResponse.headers.get("content-type") || "";
            const isHtmlResponse = contentTypeStr.toLowerCase().includes("text/html") || 
                                  contentTypeStr.toLowerCase().includes("application/xhtml+xml");

            if (isEbookSite && (fetchResponse.status === 503 || fetchResponse.status === 403 || fetchResponse.status === 429)) {
              usePuppeteer = true;
            } else if (isHtmlResponse && fetchResponse.status === 200) {
              const clone = fetchResponse.clone();
              bodyText = await clone.text();
              if (bodyText.includes("challenges.cloudflare.com") || 
                  bodyText.includes("cf-challenge") || 
                  bodyText.includes("DDoS-Guard") || 
                  bodyText.includes("Please wait...") ||
                  bodyText.includes("captcha") ||
                  bodyText.includes("security check")) {
                usePuppeteer = true;
              }
            }
          } catch (fetchErr: any) {
            if (isEbookSite) {
              usePuppeteer = true;
            } else {
              throw fetchErr;
            }
          }
        }

        if (!usePuppeteer && !fetchResponse) {
          fetchResponse = await fetch(targetUrl, {
            method: request.method,
            headers: targetHeaders,
            body: fetchBody,
            redirect: "manual"
          });
        }

        const outHeaders = new Headers();
        outHeaders.set("Access-Control-Allow-Origin", "*");

        if (usePuppeteer && env.BROWSER) {
          console.log(`[Worker Browser Proxy] Launching Cloudflare Browser Run Puppeteer...`);
          const browser = await puppeteer.launch(env.BROWSER);
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

            await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });

            puppeteerHtml = await page.content();
            puppeteerFinalUrl = page.url();

            const pageCookies = await page.cookies();
            for (const cookie of pageCookies) {
              const cookieKey = `prox_${hostEncoded}___${cookie.name}`;
              outHeaders.append("Set-Cookie", `${cookieKey}=${cookie.value}; Path=/; Max-Age=2592000`);
            }
          } finally {
            await browser.close();
          }
        }

        const finalUrl = usePuppeteer ? puppeteerFinalUrl : (fetchResponse!.url || targetUrl);
        const finalParsed = new URL(finalUrl);
        const finalHost = finalParsed.hostname;

        const contentType = usePuppeteer ? "text/html" : (fetchResponse!.headers.get("content-type") || "");
        const contentDisposition = usePuppeteer ? "" : (fetchResponse!.headers.get("content-disposition") || "");

        if (!usePuppeteer && fetchResponse) {
          if (fetchResponse.status >= 300 && fetchResponse.status < 400) {
            const location = fetchResponse.headers.get("location");
            if (location) {
              const redirectUrl = new URL(location, targetUrl).toString();
              return Response.redirect(`/api/browser-proxy?url=${encodeURIComponent(redirectUrl)}&adblock=${adblockActive}&tor=${torActive}&mode=${proxyMode}&ua=${customUa}`, 302);
            }
          }
          const rawSetCookies = fetchResponse.headers.get("set-cookie");
          if (rawSetCookies) {
            const hostEncoded = finalHost.replace(/\./g, "_");
            const cookiesList = rawSetCookies.split(",");
            for (const cStr of cookiesList) {
              const firstPart = cStr.split(";")[0];
              const eqIdx = firstPart.indexOf("=");
              if (eqIdx !== -1) {
                const name = firstPart.substring(0, eqIdx).trim();
                const val = firstPart.substring(eqIdx + 1).trim();
                const cookieKey = `prox_${hostEncoded}___${name}`;
                outHeaders.append("Set-Cookie", `${cookieKey}=${val}; Path=/; Max-Age=2592000`);
              }
            }
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
          const base = finalParsed.pathname.substring(finalParsed.pathname.lastIndexOf('/') + 1);
          if (base && base.includes(".")) {
            filename = base;
          }
        }

        const isEbook = isEbookExtension || 
                        (isAttachment && !/\.(png|jpe?g|gif|webp|svg|ico|woff2?|css|js|json|xml|html?)$/i.test(filename)) ||
                        (contentType.toLowerCase().includes("application/epub+zip") || contentType.toLowerCase().includes("application/pdf"));

        if (isEbook) {
          return new Response(`
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
                  <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          `, {
            headers: { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" }
          });
        }

        if (isBinaryContent) {
          if (usePuppeteer) {
            return new Response(puppeteerHtml, {
              headers: { "Content-Type": "text/html" }
            });
          }
          const buf = await fetchResponse!.arrayBuffer();
          outHeaders.set("Content-Type", contentType || "application/octet-stream");
          return new Response(buf, { headers: outHeaders });
        }

        const isHtml = contentType.toLowerCase().includes("text/html") || 
                       contentType.toLowerCase().includes("application/xhtml+xml");

        if (!isHtml) {
          const text = usePuppeteer ? puppeteerHtml : await fetchResponse!.text();
          outHeaders.set("Content-Type", contentType || "text/plain");
          return new Response(text, { headers: outHeaders });
        }

        const rawHtml = usePuppeteer ? puppeteerHtml : (bodyText || await fetchResponse!.text());
        
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
                            parts[i] = "";
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

        const persistParams = `&adblock=${adblockActive}&tor=${torActive}&mode=${proxyMode}&ua=${customUa}`;

        let rewriter = new HTMLRewriter()
          .on("head", {
            element(el) {
              el.prepend(cookieOverrideScript, { html: true });
            }
          })
          .on("body", {
            element(el) {
              el.prepend(`<!-- kora cookie injected -->`, { html: true });
            }
          })
          .on("a", {
            element(el) {
              const href = el.getAttribute("href");
              if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
                const resolved = resolveUrl(href, finalUrl);
                if (resolved.startsWith("http")) {
                  el.setAttribute("href", `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`);
                }
              }
            }
          })
          .on("form", {
            element(el) {
              const action = el.getAttribute("action") || "";
              const resolved = resolveUrl(action, finalUrl);
              el.setAttribute("action", `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`);
            }
          })
          .on("img", {
            element(el) {
              const src = el.getAttribute("src");
              if (src) {
                const resolved = resolveUrl(src, finalUrl);
                el.setAttribute("src", `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`);
              }
              const srcset = el.getAttribute("srcset");
              if (srcset) {
                const rewritten = srcset.split(",").map(item => {
                  const parts = item.trim().split(/\s+/);
                  if (parts[0]) {
                    const resolved = resolveUrl(parts[0], finalUrl);
                    parts[0] = `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`;
                  }
                  return parts.join(" ");
                }).join(", ");
                el.setAttribute("srcset", rewritten);
              }
            }
          })
          .on("script", {
            element(el) {
              const src = el.getAttribute("src");
              if (src) {
                const resolved = resolveUrl(src, finalUrl);
                el.setAttribute("src", `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`);
              }
            }
          })
          .on("link", {
            element(el) {
              const href = el.getAttribute("href");
              if (href) {
                const resolved = resolveUrl(href, finalUrl);
                const rel = (el.getAttribute("rel") || "").toLowerCase();
                if (rel === "stylesheet" || rel === "manifest" || rel.includes("icon") || rel.includes("preload")) {
                  el.setAttribute("href", `/api/browser-proxy?url=${encodeURIComponent(resolved)}${persistParams}`);
                } else {
                  el.setAttribute("href", resolved);
                }
              }
            }
          })
          .on("iframe", {
            element(el) {
              const src = el.getAttribute("src");
              if (src) {
                el.setAttribute("src", `/api/browser-proxy?url=${encodeURIComponent(resolveUrl(src, finalUrl))}${persistParams}`);
              }
            }
          });

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
          rewriter = rewriter.on(".adsbygoogle, .ad-banner, .popunder, .ad-zone, #ad-slot", {
            element(el) {
              el.remove();
            }
          }).on("script, iframe, img, link", {
            element(el) {
              const src = el.getAttribute("src") || el.getAttribute("href") || "";
              if (adBlockPatterns.some(pat => src.includes(pat))) {
                el.remove();
              }
            }
          });
        }

        const rwResponse = rewriter.transform(new Response(rawHtml, {
          headers: { "Content-Type": "text/html" }
        }));

        const rwBody = await rwResponse.text();
        outHeaders.set("Content-Type", "text/html");
        return new Response(rwBody, { headers: outHeaders });

      } catch (err: any) {
        console.error("[Worker Browser Proxy Error]", err);
        return new Response(`Proxy Connection Error: ${err.message || err}`, { 
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain" }
        });
      }
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
        const data: any = await res.json().catch(() => ({}));

        // NYT rejects bad/expired keys with a 401 + { fault: { faultstring: "Invalid ApiKey" } }
        // but the body still comes back 200 in many cases. Detect and fall back to a
        // Rave-powered popular feed so Discover is never blank.
        const nytBroken = !res.ok || data?.fault || data?.status !== "OK" || !data?.results?.lists?.length;

        if (!nytBroken) {
          return new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        console.warn("[NYT] overview unavailable (key invalid or API down). Serving Rave fallback feed.");
        const fallback = await buildRaveFallbackFeed();
        return new Response(JSON.stringify({
          ...fallback,
          source: "rave-fallback",
          notice: "NYT Best Sellers API unavailable — showing popular picks via Rave Engine."
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        console.warn("[NYT] overview fetch failed, serving Rave fallback feed:", err.message);
        try {
          const fallback = await buildRaveFallbackFeed();
          return new Response(JSON.stringify({
            ...fallback,
            source: "rave-fallback",
            notice: "NYT Best Sellers API unavailable — showing popular picks via Rave Engine."
          }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        } catch (_) {
          return new Response(JSON.stringify({ error: "Failed to fetch NYT data", details: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
      }
    }

    // 2.1 NYT Specific List API
    if (path === "/api/nytimes/list") {
      const listName = url.searchParams.get("list");
      if (!listName) {
        return new Response(JSON.stringify({ error: "Missing list parameter" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      try {
        const apiKey = env.NYT_BOOKS_API_KEY || env.NYT_API_KEY || "";
        const res = await fetch(`https://api.nytimes.com/svc/books/v3/lists/${listName}.json?api-key=${apiKey}`);
        const data: any = await res.json().catch(() => ({}));

        if (!res.ok || data?.fault || data?.status !== "OK") {
          return new Response(JSON.stringify({ error: "Failed to fetch NYT list", details: data?.fault?.faultstring || "Unknown error" }), {
            status: res.status || 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: "Failed to fetch NYT list", details: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 2.1.5 NYT Raw Details Endpoint (No AI)
    if (path === "/api/nytimes/book-details-raw") {
      const title = url.searchParams.get("title");
      const author = url.searchParams.get("author") || "";
      if (!title) {
        return new Response(JSON.stringify({ error: "Missing title parameter" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
      
      const apiKey = env.NYT_BOOKS_API_KEY || env.NYT_API_KEY || "";
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "NYT API Key not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      try {
        const nytUrl = `https://api.nytimes.com/svc/books/v3/lists/best-sellers/history.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&api-key=${apiKey}`;
        const response = await fetch(nytUrl);
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: "Failed to fetch raw NYT details", details: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 2.1.8 Goodreads List API
    if (path === "/api/goodreads/list") {
      const listQuery = url.searchParams.get("list");
      if (!listQuery) {
        return new Response(JSON.stringify({ error: "Missing 'list' query parameter." }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // Special case: daily-refreshed Goodreads trending list
      if (listQuery === "goodreads-blog-3182-weekly") {
        const books = await fetchGoodreadsTrendingBooks(fetchPageHtmlWithProxies);
        const payload = books.length >= 3 ? books : mapGoodreadsTrendingFallback();
        return new Response(JSON.stringify(payload), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store, max-age=0",
          }
        });
      }

      console.log(`[Goodreads API] Fetching books for list query: ${listQuery}`);

      // Check memory cache first
      if (goodreadsCache.has(listQuery)) {
        console.log(`[Goodreads API] Returning cached results for list query: ${listQuery}`);
        return new Response(JSON.stringify(goodreadsCache.get(listQuery)), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // Map query to friendly name
      let friendlyListName = "Best Books Ever";
      if (listQuery.includes("Read_At_Least_Once")) {
        friendlyListName = "Books That Everyone Should Read At Least Once";
      } else if (listQuery.includes("21st_Century")) {
        friendlyListName = "Best Books of the 21st Century";
      } else if (listQuery.includes("Best_Books_Ever")) {
        friendlyListName = "Best Books Ever";
      } else {
        friendlyListName = listQuery.replace(/^\d+\./, "").replace(/_/g, " ");
      }

      try {
        // 1. Scraping HTML page
        const html = await fetchGoodreadsHtml(listQuery);
        const $ = cheerio.load(html);
        const books: any[] = [];

        $("tr[itemtype='http://schema.org/Book'], tr.bookShow, table.tableList tr").each((idx, el) => {
          try {
            const row = $(el);
            const rankText = row.find("td.number").text().trim();
            const rank = parseInt(rankText, 10) || (idx + 1);

            const titleAnchor = row.find("a.bookTitle");
            const rawTitle = titleAnchor.text().trim();
            if (!rawTitle) return; // skip rows without titles

            const bookUrl = titleAnchor.attr("href") || "";

            const authorAnchor = row.find("a.authorName");
            const author = authorAnchor.text().trim();

            const coverImg = row.find("img.bookCover, img[itemprop='image']");
            let coverUrl = coverImg.attr("src") || null;
            
            if (coverUrl && (coverUrl.includes("nophoto") || coverUrl.includes("nocover"))) {
              coverUrl = null;
            }

            // Minirating parsing
            const ratingText = row.find("span.minirating").text().trim();
            let rating: number | undefined;
            let ratingCount: string | undefined;
            let ratingVerified = false;

            const ratingMatch = ratingText.match(/([\d.]+)\s*avg\s*rating/i);
            if (ratingMatch) {
              rating = parseFloat(ratingMatch[1]);
              ratingVerified = true;
            }

            const countMatch = ratingText.match(/([\d,]+)\s*rating/i);
            if (countMatch) {
              ratingCount = countMatch[1] + " ratings";
            }

            let goodreadsId = "";
            const idMatch = bookUrl.match(/\/book\/show\/(\d+)/);
            if (idMatch) {
              goodreadsId = idMatch[1];
            }

            books.push({
              rank,
              title: rawTitle,
              author,
              description: ratingVerified && rating
                ? `Popular selection from the Goodreads community. Rated ${rating} stars${ratingCount ? ` by ${ratingCount}` : ""}.`
                : "Popular selection from the Goodreads community.",
              ...(ratingVerified && rating ? { rating, ratingCount, ratingVerified: true } : {}),
              coverUrl,
              goodreadsId,
              source: "goodreads"
            });
          } catch (err) {
            console.error("[Goodreads Scraper] Row parser error:", err);
          }
        });

        if (books.length > 0) {
          console.log(`[Goodreads API] Successfully scraped ${books.length} books for ${listQuery}`);
          goodreadsCache.set(listQuery, books);
          return new Response(JSON.stringify(books), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        } else {
          throw new Error("No books parsed from the scraped HTML page.");
        }

      } catch (err: any) {
        console.error("[Goodreads API] Web scrape failed, using rich fallback database:", err);
        
        // Fallback data (without AI) so the user gets accurate results instantly
        let fallbackBooks: any[] = [];
        if (friendlyListName.includes("Read At Least Once")) {
          fallbackBooks = [
            { rank: 1, title: "To Kill a Mockingbird", author: "Harper Lee", description: "The unforgettable novel of a childhood in a sleepy Southern town and the crisis of conscience that rocked it.", isbn: "0446310786", rating: 4.28, ratingCount: "5,600,000 ratings" },
            { rank: 2, title: "1984", author: "George Orwell", description: "A dystopian masterpiece set in a world of perpetual war, omnipresent government surveillance, and public manipulation.", isbn: "0451524934", rating: 4.19, ratingCount: "4,100,000 ratings" },
            { rank: 3, title: "The Great Gatsby", author: "F. Scott Fitzgerald", description: "The story of the fabulously wealthy Jay Gatsby and his love for the beautiful Daisy Buchanan.", isbn: "0743273567", rating: 3.93, ratingCount: "4,800,000 ratings" },
            { rank: 4, title: "The Catcher in the Rye", author: "J.D. Salinger", description: "The hero-narrator of The Catcher in the Rye is an ancient child of sixteen, a native New Yorker named Holden Caulfield.", isbn: "0316769177", rating: 3.80, ratingCount: "3,300,000 ratings" },
            { rank: 5, title: "Pride and Prejudice", author: "Jane Austen", description: "The romantic clash between the opinionated Elizabeth Bennet and her proud suitor, Mr. Darcy.", isbn: "0141439513", rating: 4.28, ratingCount: "3,900,000 ratings" }
          ];
        } else if (friendlyListName.includes("21st Century")) {
          fallbackBooks = [
            { rank: 1, title: "The Road", author: "Cormac McCarthy", description: "A father and his son walk alone through burned America. Nothing moves in the ravaged landscape save the ash on the wind.", isbn: "0307387895", rating: 3.98, ratingCount: "850,000 ratings" },
            { rank: 2, title: "Life of Pi", author: "Yann Martel", description: "The story of a young man who survives in a lifeboat with a Bengal tiger named Richard Parker.", isbn: "0156027321", rating: 3.93, ratingCount: "1,500,000 ratings" },
            { rank: 3, title: "Never Let Me Go", author: "Kazuo Ishiguro", description: "A dystopian novel about clone students growing up in a seemingly idyllic boarding school.", isbn: "1400078776", rating: 3.90, ratingCount: "620,000 ratings" },
            { rank: 4, title: "The Kite Runner", author: "Khaled Hosseini", description: "The devastating and inspiring story of an unlikely friendship between a wealthy boy and the son of his father's servant.", isbn: "1594631933", rating: 4.33, ratingCount: "2,900,000 ratings" },
            { rank: 5, title: "Middlesex", author: "Jeffrey Eugenides", description: "A sprawling saga about a Greek-American family and the journey of an intersex protagonist.", isbn: "0312422156", rating: 4.02, ratingCount: "610,000 ratings" }
          ];
        } else {
          fallbackBooks = [
            { rank: 1, title: "The Hunger Games", author: "Suzanne Collins", description: "In the ruins of a place once known as North America lies the nation of Panem, an empire that forces children to fight to the death.", isbn: "0439023483", rating: 4.33, ratingCount: "7,800,000 ratings" },
            { rank: 2, title: "Harry Potter and the Sorcerer's Stone", author: "J.K. Rowling", description: "Harry Potter has no idea how famous he is until he is rescued from his miserable aunt and uncle and sent to Hogwarts.", isbn: "0439708184", rating: 4.47, ratingCount: "9,200,000 ratings" },
            { rank: 3, title: "To Kill a Mockingbird", author: "Harper Lee", description: "The unforgettable novel of a childhood in a sleepy Southern town and the crisis of conscience that rocked it.", isbn: "0446310786", rating: 4.28, ratingCount: "5,600,000 ratings" },
            { rank: 4, title: "The Great Gatsby", author: "F. Scott Fitzgerald", description: "The story of the fabulously wealthy Jay Gatsby and his love for the beautiful Daisy Buchanan.", isbn: "0743273567", rating: 3.93, ratingCount: "4,800,000 ratings" },
            { rank: 5, title: "The Fault in Our Stars", author: "John Green", description: "The story of Hazel Grace Lancaster, a sixteen-year-old thyroid cancer patient who meets Augustus Waters.", isbn: "0525478817", rating: 4.15, ratingCount: "4,200,000 ratings" }
          ];
        }

        const mappedFallback = fallbackBooks.map((b: any) => ({
          ...b,
          coverUrl: `https://covers.openlibrary.org/b/isbn/${b.isbn}-M.jpg`,
          source: "goodreads"
        }));

        goodreadsCache.set(listQuery, mappedFallback);
        return new Response(JSON.stringify(mappedFallback), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 2.1.85 Audiobooks API
    if (path === "/api/audiobooks/popular") {
      try {
        const scraped = await scrapePopularAudiobooks(fetchPageHtmlWithProxies);
        if (scraped.length >= 4) {
          return new Response(JSON.stringify(scraped), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
      } catch (err: any) {
        console.warn("[Audiobooks Popular] Scrape failed:", err.message);
      }
      return new Response(JSON.stringify(mapPopularAudiobooks()), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    if (path === "/api/audiobooks/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) {
        return new Response(JSON.stringify({ error: "Missing query parameter 'q'" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const cached = getCachedAudiobookSearch(q);
      if (cached) {
        return new Response(JSON.stringify(cached), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "X-Cache": "HIT" }
        });
      }

      const deduped = await searchAudiobooksFromSources(fetchPageHtmlWithProxies, q, 16);

      if (deduped.length === 0) {
        const lower = q.toLowerCase();
        POPULAR_AUDIOBOOKS.filter(b =>
          b.title.toLowerCase().includes(lower) || b.author.toLowerCase().includes(lower)
        ).forEach(b => {
          deduped.push({
            ...b,
            coverUrl: `/api/cover-redirect?title=${encodeURIComponent(b.title)}&author=${encodeURIComponent(b.author)}`,
            link: `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(b.title)}`,
            listenUrl: `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(b.title)}`,
            listenUrlAlt: `https://hdaudiobooks.com/?s=${encodeURIComponent(b.title)}`,
            source: "fulllengthaudiobooks",
          });
        });
      }

      setCachedAudiobookSearch(q, deduped);
      return new Response(JSON.stringify(deduped), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    if (path === "/api/audiobooks/search/stream") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) {
        return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 });
      }

      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const write = (obj: any) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

          const cached = getCachedAudiobookSearch(q);
          if (cached) {
            write({ source: "cache", results: cached });
            write({ done: true });
            controller.close();
            return;
          }

          const all: any[] = [];
          const seen = new Set<string>();
          const sources = [
            { name: "fulllengthaudiobooks", url: `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(q)}`, base: "https://fulllengthaudiobooks.com" },
            { name: "hdaudiobooks", url: `https://hdaudiobooks.com/?s=${encodeURIComponent(q)}`, base: "https://hdaudiobooks.com" },
          ];

          await Promise.allSettled(sources.map(async (src) => {
            try {
              const html = await fetchPageHtmlWithProxies(src.url);
              const batch = parseAudiobookSearchHtml(html, src.name, src.base).filter((r) => {
                if (seen.has(r.link)) return false;
                seen.add(r.link);
                return true;
              });
              if (batch.length) {
                all.push(...batch);
                write({ source: src.name, results: batch });
              }
            } catch (_) { /* skip */ }
          }));

          setCachedAudiobookSearch(q, all.slice(0, 16));
          write({ done: true });
          controller.close();
        }
      });

      return new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" }
      });
    }

    if (path === "/api/audiobooks/detail") {
      const pageUrl = (url.searchParams.get("url") || "").trim();
      const urlsParam = (url.searchParams.get("urls") || "").trim();
      const urls = urlsParam ? urlsParam.split(",").map(u => u.trim()).filter(Boolean) : pageUrl ? [pageUrl] : [];

      if (urls.length === 0) {
        return new Response(JSON.stringify({ error: "Missing query parameter 'url' or 'urls'" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const expectedTitle = (url.searchParams.get("title") || "").trim();

      try {
        const allowedHosts = ["hdaudiobooks.com", "fulllengthaudiobooks.com", "www.hdaudiobooks.com", "www.fulllengthaudiobooks.com"];
        for (const u of urls) {
          const host = new URL(u).hostname.replace(/^www\./, "");
          if (!allowedHosts.some(h => h.replace(/^www\./, "") === host)) {
            return new Response(JSON.stringify({ error: "Unsupported audiobook source URL" }), {
              status: 400,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
          }
        }

        const isValid = (detail: any) =>
          detail?.tracks?.length && (!expectedTitle || titlesRoughlyMatch(expectedTitle, detail.title));

        for (const u of urls) {
          const cached = getCachedAudiobookDetail(u.split("?")[0]);
          if (isValid(cached)) {
            return new Response(JSON.stringify(cached), {
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "X-Cache": "HIT" }
            });
          }
        }

        const detail = urls.length > 1
          ? await resolveAudiobookDetailParallel(urls, fetchPageHtmlWithProxies, expectedTitle || undefined)
          : await resolveAudiobookDetailFromPage(urls[0], fetchPageHtmlWithProxies, expectedTitle || undefined);

        if (!isValid(detail)) {
          return new Response(JSON.stringify({ error: "No audio tracks found on this page" }), {
            status: 404,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        if (detail.tracks?.length) {
          detail.tracks = detail.tracks.map((t: any) => ({
            ...t,
            src: normalizeMediaUrl(t.src),
          }));
        }

        return new Response(JSON.stringify(detail), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "X-Cache": "MISS" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: "Failed to load audiobook details", message: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    if (path === "/api/search/stream") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) {
        return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 });
      }

      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const write = (obj: any) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
          const all: any[] = [];

          await Promise.allSettled([
            fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12`)
              .then(r => r.json())
              .then(data => {
                const books = (data.items || []).map((item: any) => {
                  const info = item.volumeInfo || {};
                  return {
                    title: info.title,
                    author: (info.authors || []).join(", "),
                    coverUrl: info.imageLinks?.thumbnail?.replace("http:", "https:"),
                    year: info.publishedDate?.split("-")[0],
                    publisher: info.publisher,
                    isGoogleBook: true,
                    source: "google",
                  };
                });
                if (books.length) {
                  all.push(...books);
                  write({ source: "google", books });
                }
              }),
          ]);

          write({ done: true, totalCount: all.length, hasMore: all.length >= 12 });
          controller.close();
        }
      });

      return new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" }
      });
    }

    // 2.1.9 Goodreads Reviews API
    if (path === "/api/goodreads/reviews" && request.method === "POST") {
      try {
        const body = await request.json() as any;
        const { title, author } = body;
        if (!title) {
          return new Response(JSON.stringify({ error: "Title is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        // Clean the search query to improve Goodreads matching rate
        let cleanTitle = title.split(':')[0].split('(')[0].split('-')[0];
        cleanTitle = cleanTitle.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
        let cleanAuthor = (author || "").split(',')[0];
        cleanAuthor = cleanAuthor.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
        
        const queryStr = `${cleanTitle} ${cleanAuthor}`.trim();
        console.log(`[Goodreads Reviews API] Searching with cleaned query: "${queryStr}" (Original: "${title} ${author || ''}")`);

        let reviews: any[] = [];
        let sourceMethod = "scraped";

        try {
          // Search for the book on Goodreads using the cleaned query
          const searchUrl = `https://www.goodreads.com/search?q=${encodeURIComponent(queryStr)}`;
          const searchHtml = await fetchPageHtmlWithProxies(searchUrl, "goodreads");
          const $ = cheerio.load(searchHtml);
          
          // Find first book link matching bookTitle or standard book link structures
          let bookPath = "";
          $("a.bookTitle, a[href*='/book/show/']").each((_, elem) => {
            const href = $(elem).attr("href");
            if (href && href.includes("/book/show/") && !bookPath) {
              bookPath = href;
            }
          });

          // If search with clean query failed, try search with original title
          if (!bookPath && title !== queryStr) {
            const backupQuery = `${title} ${author || ""}`.trim();
            console.log(`[Goodreads Reviews API] Trying backup query: "${backupQuery}"`);
            const backupSearchUrl = `https://www.goodreads.com/search?q=${encodeURIComponent(backupQuery)}`;
            try {
              const backupHtml = await fetchPageHtmlWithProxies(backupSearchUrl, "goodreads");
              const $backup = cheerio.load(backupHtml);
              $backup("a.bookTitle, a[href*='/book/show/']").each((_, elem) => {
                const href = $backup(elem).attr("href");
                if (href && href.includes("/book/show/") && !bookPath) {
                  bookPath = href;
                }
              });
            } catch (backupErr: any) {
              console.warn(`[Goodreads Reviews API] Backup search failed: ${backupErr.message}`);
            }
          }

          if (bookPath) {
            const bookUrl = bookPath.startsWith("http") ? bookPath : `https://www.goodreads.com${bookPath}`;
            console.log(`[Goodreads Reviews API] Found book URL: ${bookUrl}`);
            
            // Fetch book page html
            const bookHtml = await fetchPageHtmlWithProxies(bookUrl, "goodreads");
            const $book = cheerio.load(bookHtml);
            
            // Parse Modern Layout (.ReviewCard or [data-testid='ReviewCard'])
            $book(".ReviewCard, [data-testid='ReviewCard']").each((_, elem) => {
              const reviewerName = $book(elem).find(".ReviewerProfile__name, [data-testid='name'], .ReviewCard__user a").first().text().trim() || "Goodreads Reader";
              
              let rating = 4;
              const ratingText = $book(elem).find(".RatingStars, [data-testid='ratingStars']").first().attr("aria-label") || "";
              const starsMatch = ratingText.match(/Rating (\d+) out of/i) || ratingText.match(/(\d+)\s*star/i);
              if (starsMatch) {
                rating = parseInt(starsMatch[1]);
              } else {
                const filledStars = $book(elem).find(".RatingStars__star--filled, .p10").length;
                if (filledStars > 0) rating = filledStars;
              }

              let reviewContent = $book(elem).find(".ReviewText, [data-testid='reviewText']").first().html() || "";
              if (!reviewContent) {
                reviewContent = $book(elem).find(".ReviewText, [data-testid='reviewText']").first().text().trim();
              }

              if (reviewContent && reviewerName) {
                reviews.push({
                  rating,
                  review: reviewContent,
                  user: {
                    name: reviewerName,
                    username: reviewerName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
                  }
                });
              }
            });

            // Parse Classic Layout if no reviews found yet (.review, .comment, div.friendReviews)
            if (reviews.length === 0) {
              $book(".review, .comment").each((_, elem) => {
                const reviewerName = $book(elem).find("a.user, .user a, .left.client a").first().text().trim() || "Goodreads Reader";
                
                let rating = 4;
                const ratingMeta = $book(elem).find("meta[itemprop='rating']").attr("content");
                if (ratingMeta) {
                  rating = parseInt(ratingMeta) || 4;
                } else {
                  const starText = $book(elem).find(".staticStars, .stars").text() || "";
                  const starsMatch = starText.match(/(\d+)\s*star/i);
                  if (starsMatch) {
                    rating = parseInt(starsMatch[1]);
                  } else {
                    const filledStars = $book(elem).find(".staticStar.p10, .staticStar.p11").length;
                    if (filledStars > 0) rating = filledStars;
                  }
                }

                let reviewEl = $book(elem).find("span[id^='freeTextContainer']").first();
                if (reviewEl.length === 0) {
                  reviewEl = $book(elem).find(".readable").first();
                }
                
                let reviewContent = reviewEl.html() || "";
                if (!reviewContent) {
                  reviewContent = reviewEl.text().trim();
                }

                if (reviewContent && reviewerName) {
                  reviews.push({
                    rating,
                    review: reviewContent,
                    user: {
                      name: reviewerName,
                      username: reviewerName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
                    }
                  });
                }
              });
            }
          }
        } catch (err: any) {
          console.warn(`[Goodreads Reviews API] Scraper failed for "${queryStr}": ${err.message}`);
        }

        console.log(`[Goodreads Reviews API] Returning ${reviews.length} reviews via ${sourceMethod}`);
        return new Response(JSON.stringify({ reviews, source: sourceMethod }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 2.2 NYT Book Details API
    if (path === "/api/nyt/book-details" || path === "/api/nytimes/book-details") {
      const title = url.searchParams.get("title");
      const author = url.searchParams.get("author");
      
      if (!title) {
        return new Response(JSON.stringify({ error: "Missing title parameter" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      try {
        const apiKey = env.NYT_BOOKS_API_KEY || env.NYT_API_KEY || "";
        
        // Search NYT Books API for the book
        const searchRes = await fetch(`https://api.nytimes.com/svc/books/v3/lists/best-sellers/history.json?api-key=${apiKey}&title=${encodeURIComponent(title)}`);
        const searchData: any = await searchRes.json().catch(() => ({}));

        if (searchRes.ok && searchData?.status === "OK" && searchData?.results?.length > 0) {
          const book = searchData.results[0];
          return new Response(JSON.stringify({
            description: book.description || "",
            subjects: book.subjects || [],
            pageCount: book.page_count || null,
            publishYear: book.published_date?.substring(0, 4) || null,
            publisher: book.publisher || "",
            isBestseller: true,
            bestsellerRank: book.rank || null,
            weeksOnList: book.weeks_on_list || null,
            bestsellerCategory: book.list_name || "",
            nytReviewSnippet: book.book_review_link || ""
          }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        // If not found in bestsellers, try reviews API
        const reviewsRes = await fetch(`https://api.nytimes.com/svc/books/v3/reviews.json?api-key=${apiKey}&author=${encodeURIComponent(author || "")}&title=${encodeURIComponent(title)}`);
        const reviewsData: any = await reviewsRes.json().catch(() => ({}));

        if (reviewsRes.ok && reviewsData?.status === "OK" && reviewsData?.results?.length > 0) {
          const review = reviewsData.results[0];
          return new Response(JSON.stringify({
            description: review.summary || "",
            subjects: [],
            pageCount: null,
            publishYear: review.publication_date?.substring(0, 4) || null,
            publisher: review.publisher || "",
            isBestseller: false,
            bestsellerRank: null,
            weeksOnList: null,
            bestsellerCategory: "",
            nytReviewSnippet: review.summary || ""
          }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        // No NYT data found
        return new Response(JSON.stringify({ error: "Book not found in NYT" }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: "Failed to fetch NYT book details", details: err.message }), {
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

    // Google Books API Proxy
    if (path === "/api/google-books/search") {
      const q = url.searchParams.get("q");
      const maxResults = url.searchParams.get("maxResults") || "1";
      const startIndex = url.searchParams.get("startIndex") || "";
      if (!q) {
        return new Response(JSON.stringify({ error: "Missing query" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      
      const apiKey = env.GOOGLE_BOOKS_API_KEY || "";
      const start = startIndex ? `&startIndex=${startIndex}` : "";
      const fetchUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${maxResults}${start}${apiKey ? `&key=${apiKey}` : ""}`;
      
      try {
        const response = await fetch(fetchUrl);
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: "Failed to fetch from Google Books", details: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 3. Download Options / Mirrors API
    if (path === "/api/download" || path === "/api/download-options" || path === "/api/annas-archive/download") {
      const md5 = url.searchParams.get("md5");
      const iaId = url.searchParams.get("iaId") || "";
      const raveDirect = url.searchParams.get("url"); // Rave's signed direct URL from search results

      if (!md5 && !raveDirect) {
        return new Response(JSON.stringify({ error: "MD5 or direct URL is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // Check if this is a real 32-char MD5 or a SHA-256 pseudo-ID (64-char, from IA results)
      const isRealMd5 = !!md5 && /^[a-f0-9]{32}$/i.test(md5);

      let downloadLinks: any[] = [];

      // PRIMARY: use Rave Book Search's real direct-download link (same method as ravebooksearch.com).
      // LibGen -> signed get.php?md5=<hash>&key=<token> that 307-redirects to the booksdl.lc CDN.
      // Internet Archive -> /details/ page (resolved to the actual file by /api/proxy-file).
      if (raveDirect) {
        try {
          const parsed = new URL(raveDirect);
          const isDirectLink = /get\.php\?md5=.+&key=/.test(parsed.pathname + parsed.search) ||
                              parsed.hostname.includes("archive.org");
          if (isDirectLink) {
            downloadLinks.push({
              label: "Rave Direct (LibGen CDN)",
              url: parsed.toString(),
              isDirect: true,
              sourceId: "rave"
            });
          }
        } catch (_) { /* ignore malformed url */ }
      }

      if (isRealMd5) {
        // Prefer the signed LibGen CDN link (get.php?md5&key) resolved server-side,
        // so downloads work even when the frontend has no Rave directUrl.
        let signed = "";
        if (raveDirect && /get\.php\?md5=.+&key=/.test(raveDirect)) {
          signed = raveDirect;
        } else {
          signed = await resolveLibgenSigned(md5);
        }
        if (signed) {
          downloadLinks.push({
            label: "Direct Mirror (LibGen CDN)",
            url: signed,
            isDirect: true,
            sourceId: "libgen"
          });
        }
        // Reliable fallbacks (kept last; library.lol is often unreachable, so
        // it is intentionally deprioritized behind the signed CDN link).
        downloadLinks.push(
          {
            label: "Libgen Mirror (libgen.li)",
            url: `https://libgen.li/get.php?md5=${md5.toLowerCase()}`,
            isDirect: true
          },
          {
            label: "Anna's Archive",
            url: `https://annas-archive.org/md5/${md5}`,
            isDirect: false
          }
        );
      } else if (iaId && downloadLinks.length === 0) {
        // Internet Archive item with known iaId — proxy through /api/proxy-file
        downloadLinks = [
          {
            label: "Internet Archive (Direct Download)",
            url: `/api/proxy-file?url=${encodeURIComponent(`https://archive.org/details/${iaId}`)}`,
            isDirect: true
          },
          {
            label: "Internet Archive (Browse Page)",
            url: `https://archive.org/details/${iaId}`,
            isDirect: false
          }
        ];
      } else {
        // SHA-256 pseudo-ID with no iaId — generic fallback
        downloadLinks = [
          {
            label: "Search Anna's Archive",
            url: `https://annas-archive.org/search`,
            isDirect: false
          }
        ];
      }

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

    // 5. RSS Feed Discovery & Fetch
    if (path === "/api/feed/discover" && request.method === "POST") {
      try {
        const body = await request.json();
        const inputUrl = body.url;
        if (!inputUrl) {
          return new Response(JSON.stringify({ error: "Missing url parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        const result = await discoverFeedFromUrl(inputUrl);
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || "Feed discovery failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    if (path === "/api/feed/fetch" && request.method === "POST") {
      try {
        const body = await request.json();
        const feedUrl = body.feedUrl;
        if (!feedUrl) {
          return new Response(JSON.stringify({ error: "Missing feedUrl parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        const result = await fetchFeedFromUrl(feedUrl);
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || "Feed fetch failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // Same-origin Hugging Face Hub proxy for Transformers.js (Whisper, etc.).
    // Browser fetches to huggingface.co are blocked by CORS (ACA-Origin: huggingface.co only).
    if (path.startsWith("/api/hf-model/")) {
      const modelPath = path.slice("/api/hf-model/".length);
      if (!modelPath || modelPath.includes("..") || !/^(Xenova|onnx-community|HuggingFaceTB)\//.test(modelPath)) {
        return new Response(JSON.stringify({ error: "Invalid or disallowed model path" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const upstreamUrl = `https://huggingface.co/${modelPath}${url.search}`;
      try {
        const headers = new Headers();
        headers.set(
          "User-Agent",
          "Mozilla/5.0 (compatible; KoraReader/1.0; +https://kora.chaoticstudio.workers.dev)"
        );
        headers.set("Accept", "*/*");
        const range = request.headers.get("Range");
        if (range) headers.set("Range", range);

        const upstream = await fetch(upstreamUrl, {
          method: "GET",
          headers,
          redirect: "follow",
        });

        const outHeaders = new Headers();
        const passThrough = [
          "content-type",
          "content-length",
          "content-range",
          "accept-ranges",
          "etag",
          "last-modified",
          "x-repo-commit",
          "x-linked-etag",
          "x-linked-size",
        ];
        for (const key of passThrough) {
          const value = upstream.headers.get(key);
          if (value) outHeaders.set(key, value);
        }
        outHeaders.set("Access-Control-Allow-Origin", "*");
        outHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, ETag");
        outHeaders.set(
          "Cache-Control",
          upstream.ok ? "public, max-age=604800, immutable" : "no-store"
        );

        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: outHeaders,
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || "HF proxy failed" }), {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    if (path === "/api/transcribe-audio" && request.method === "POST") {
      try {
        const body = await request.json();
        const audio = typeof body.audio === "string" ? body.audio : "";
        const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";
        const previousContext =
          typeof body.previousContext === "string" ? body.previousContext : undefined;

        if (!audio) {
          return new Response(JSON.stringify({ error: "Missing audio payload" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        const apiKey = env.GEMINI_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "Transcription service is not configured." }), {
            status: 503,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        const text = await transcribeAudioBase64(audio, mimeType, apiKey, previousContext);
        return new Response(JSON.stringify({ text }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || "Transcription failed" }), {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    if (path === "/api/feed/preview" && request.method === "POST") {
      try {
        const body = await request.json();
        const articleUrl = body.url;
        if (!articleUrl) {
          return new Response(JSON.stringify({ error: "Missing url parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        const result = await fetchArticlePreview(articleUrl);
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || "Preview failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    if (path === "/api/feed/image") {
      const imageUrl = url.searchParams.get("url");
      if (!imageUrl) {
        return new Response("Missing url", { status: 400 });
      }
      try {
        return await proxyFeedImage(imageUrl);
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 6. Web Clipper / URL-to-eBook Conversion Endpoint (Non-AI using Cheerio)
    if (path === "/api/convert-url" && request.method === "POST") {
      try {
        const body = await request.json();
        const targetUrl = body.url;
        if (!targetUrl) {
          return new Response(JSON.stringify({ error: "Missing url parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        console.log(`[Web Clipper] Fetching: ${targetUrl}`);
        
        // Parse domain
        let parsedUrl;
        try {
          parsedUrl = new URL(targetUrl);
        } catch (e) {
          return new Response(JSON.stringify({ error: "Invalid URL format" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        const domain = parsedUrl.hostname;

        // Fetch the raw page content using standard fetch with timeout
        let rawHtml = "";
        const pageHeaders = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        };
        const fetchTargets = [targetUrl];
        try {
          const parsedTarget = new URL(targetUrl);
          if (parsedTarget.hostname === "psmnews.mv" && /^\/\d+\/?$/.test(parsedTarget.pathname)) {
            fetchTargets.unshift(`https://psmnews.mv/en${parsedTarget.pathname}`);
          }
        } catch {
          // ignore invalid URL
        }

        let fetchErr: unknown = null;
        for (const fetchUrl of fetchTargets) {
          try {
            const response = await fetch(fetchUrl, { headers: pageHeaders, redirect: "follow" });
            if (response.ok) {
              rawHtml = await response.text();
              if (rawHtml.trim().length >= 100) break;
            } else {
              fetchErr = new Error(`HTTP error ${response.status}`);
            }
          } catch (err) {
            fetchErr = err;
          }
        }

        if (!rawHtml || rawHtml.trim().length < 100) {
          console.warn(`[Web Clipper] Standard fetch failed, trying Puppeteer:`, fetchErr);
          if (env && env.BROWSER) {
            try {
              const browser = await env.BROWSER.connect();
              try {
                const page = await browser.newPage();
                await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
                await page.goto(fetchTargets[0] || targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
                rawHtml = await page.content();
              } finally {
                await browser.disconnect();
              }
            } catch (puppeteerErr) {
              console.error("[Web Clipper] Puppeteer failed:", puppeteerErr);
              throw new Error("Failed to fetch content with both standard fetch and Puppeteer");
            }
          } else {
            throw fetchErr instanceof Error ? fetchErr : new Error("Failed to fetch content and no Puppeteer available");
          }
        }

        if (!rawHtml || rawHtml.trim().length < 100) {
          return new Response(JSON.stringify({ error: "Could not fetch any meaningful content from the provided URL" }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        console.log(`[Web Clipper] Extracted HTML length: ${rawHtml.length}. Processing with Cheerio.`);

        // Parse with Cheerio to extract content
        const $ = cheerio.load(rawHtml);

        // ===================================================================
        // PHASE 1: Extract metadata BEFORE removing elements
        // ===================================================================
        
        // 1. Title Extraction (priority: OG > Twitter > meta > title > h1)
        let title = $("meta[property='og:title']").attr("content") || 
                    $("meta[name='twitter:title']").attr("content") ||
                    $("meta[name='title']").attr("content") ||
                    $("title").text() || 
                    $("h1").first().text() || 
                    domain;
        
        // Clean title separators (remove site name portion)
        const titleSeparators = [/ \| /, / - /, / › /, / » /, / :: /, / — /];
        for (const sep of titleSeparators) {
          if (sep.test(title)) {
            const parts = title.split(sep).filter(p => p.trim().length > 0);
            if (parts.length > 1) {
              title = parts.reduce((a, b) => a.trim().length >= b.trim().length ? a : b).trim();
              break;
            }
          }
        }
        title = title.trim();

        // 2. Author/Byline Extraction
        let author = $("meta[name='author']").attr("content") || 
                     $("meta[property='article:author']").attr("content") ||
                     $("meta[name='twitter:creator']").attr("content") ||
                     "";
        if (!author) {
          // Try DOM-based author selectors
          const authorSelectors = [
            ".author-name", ".byline-name", "[rel='author']", ".author a",
            ".byline a", ".article-author", ".post-author", ".entry-author",
            ".author", ".byline", ".writer"
          ];
          for (const sel of authorSelectors) {
            const text = $(sel).first().text().trim();
            if (text && text.length > 1 && text.length < 60) {
              author = text;
              break;
            }
          }
        }
        author = author.replace(/^(by|written\s+by|author[:\s])\s*/i, "").trim() || domain;

        // 3. Description
        const description = $("meta[name='description']").attr("content") || 
                            $("meta[property='og:description']").attr("content") || 
                            $("meta[name='twitter:description']").attr("content") || "";
        
        // 4. Published date
        let publishedDate = $("meta[property='article:published_time']").attr("content") ||
                            $("meta[name='date']").attr("content") ||
                            $("meta[name='publish-date']").attr("content") ||
                            $("time[datetime]").first().attr("datetime") ||
                            $("time").first().text().trim() || "";

        // 5. Lead image
        const leadImage = $("meta[property='og:image']").attr("content") || "";

        // ===================================================================
        // PHASE 2: Aggressive boilerplate removal
        // ===================================================================
        
        // Remove all scripts, styles, and non-content elements
        $("script, style, link[rel='stylesheet'], noscript, svg, canvas, video, audio, embed, object, applet").remove();
        $("iframe:not([src*='youtube']):not([src*='vimeo'])").remove();
        
        // Remove common boilerplate structural elements
        const boilerplateSelectors = [
          // Navigation & headers
          "header", "footer", "nav", ".nav", ".navbar", ".navigation", ".menu",
          "#header", "#footer", "#nav", "#navigation", "#menu",
          ".header", ".footer", ".masthead", ".site-header", ".site-footer",
          ".top-bar", ".bottom-bar", ".breadcrumb", ".breadcrumbs",
          
          // Sidebars
          "aside", ".sidebar", "#sidebar", ".side-bar", ".widget-area",
          
          // Ads & promotions
          ".ad", ".ads", ".advert", ".advertisement", ".ad-container",
          "[class*='ad-']", "[class*='advert']", "[id*='ad-']", "[id*='advert']",
          ".sponsor", ".sponsored", ".promotion", ".promo",
          ".infinity", "[data-zone]",
          
          // Social sharing, comments, forms
          ".share", ".sharing", ".social", ".social-share", ".share-buttons",
          ".comment", ".comments", ".comment-form", ".comment-section",
          ".disqus", "#disqus_thread", "#comments",
          ".widget", ".widget-comment-form", "[class*='widget']",
          "form", "button", "textarea", "input", "select", "option", "label",
          
          // Related content & tags
          ".related", ".related-posts", ".related-articles", ".more-stories",
          ".recommended", ".suggestions", ".tags", ".tag-list", ".tag-cloud",
          ".article-tags", ".post-tags",
          
          // Newsletter, popups, modals
          ".newsletter", ".subscribe", ".popup", ".modal", ".overlay",
          ".cookie-notice", ".cookie-banner", ".gdpr",
          
          // Misc noise
          ".hidden", "[style*='display:none']", "[style*='display: none']",
          "[aria-hidden='true']",
          ".loader", ".spinner", ".skeleton",
          ".pagination", ".pager", ".page-numbers",
          ".notification", ".notification-push",
          ".submenu", ".menubar", ".menubar-mobile",
          ".load-more", ".mobile_local_edition",
          ".component-sponsor",
          
          // Tracking pixels & invisible images  
          "img[width='1']", "img[height='1']", "img[style*='display:none']"
        ];
        
        $(boilerplateSelectors.join(", ")).remove();
        
        // Remove empty anchors with no text (icon links, social buttons)
        $("a").each((_, elem) => {
          const $a = $(elem);
          const text = $a.text().trim();
          if (text.length === 0 && $a.find("img").length === 0) {
            $a.remove();
          }
        });
        
        // Remove ALL inline event handlers and styles from remaining elements
        $("*").each((_, elem) => {
          const attribs = (elem as any).attribs || {};
          for (const attr of Object.keys(attribs)) {
            if (attr.startsWith("on") || attr === "style" || attr.startsWith("data-")) {
              $(elem).removeAttr(attr);
            }
          }
        });

        // ===================================================================
        // PHASE 3: Readability-style content scoring
        // ===================================================================

        // Allowlisted content tags
        const CONTENT_TAGS = new Set([
          "p", "h1", "h2", "h3", "h4", "h5", "h6",
          "blockquote", "pre", "code",
          "ul", "ol", "li",
          "figure", "figcaption",
          "table", "thead", "tbody", "tr", "td", "th",
          "img", "a", "strong", "em", "b", "i", "br", "hr",
          "div", "span", "section", "article", "main"
        ]);

        // Negative class/id patterns (reduce score for these containers)
        const NEGATIVE_PATTERNS = /comment|combx|community|contact|disqus|extra|foot|header|menu|remark|rss|shoutbox|sidebar|sponsor|ad-break|agegate|pagination|pager|popup|tweet|twitter|share|social|related|tag|widget|nav|promo|ad|cookie|banner|breadcrumb|load-more|infinity|notification|submenu|menubar/i;

        // Positive class/id patterns (boost score for these containers)
        const POSITIVE_PATTERNS = /article|body|content|entry|hentry|main|page|post|text|blog|story|reader|news|article-reader|reader-body|article-body|post-body|entry-content|post-content/i;

        // Score candidate containers
        const candidates: { element: any; score: number }[] = [];
        
        $("div, section, article, main, .content, .post-content, .entry-content, .article-body, .reader-body-content").each((_, elem) => {
          const $el = $(elem);
          const className = ((elem as any).attribs?.class || "").toLowerCase();
          const id = ((elem as any).attribs?.id || "").toLowerCase();
          const identifier = className + " " + id;
          
          // Skip if this has too many child containers (likely a layout wrapper)
          const childDivs = $el.children("div, section, article").length;
          
          // Count direct text-bearing elements
          const paragraphs = $el.find("p").length;
          const textLength = $el.text().trim().length;
          
          // Skip tiny containers
          if (textLength < 100) return;
          
          let score = 0;
          
          // Paragraph density is the strongest signal
          score += paragraphs * 10;
          
          // Text length score (logarithmic to avoid oversizing huge wrappers)
          score += Math.log10(Math.max(textLength, 1)) * 5;
          
          // Positive class/id boost
          if (POSITIVE_PATTERNS.test(identifier)) score += 30;
          
          // Negative class/id penalty
          if (NEGATIVE_PATTERNS.test(identifier)) score -= 40;
          
          // Penalty for too many child divs (likely a broad layout container)
          if (childDivs > 8) score -= childDivs * 3;
          
          // Bonus for article/main tags
          if (elem.tagName === "article") score += 25;
          if (elem.tagName === "main") score += 15;
          
          // Images inside content are a good signal
          const images = $el.find("img").length;
          score += Math.min(images, 5) * 3;
          
          candidates.push({ element: elem, score });
        });
        
        // Sort by score, pick the best candidate
        candidates.sort((a, b) => b.score - a.score);
        
        let contentElement = candidates.length > 0 ? $(candidates[0].element) : $("body");
        
        // Log for debugging
        if (candidates.length > 0) {
          const best = candidates[0];
          const bestClass = (best.element as any).attribs?.class || "";
          const bestId = (best.element as any).attribs?.id || "";
          console.log(`[Web Clipper] Best content container: <${best.element.tagName}> class="${bestClass}" id="${bestId}" score=${best.score}`);
        }

        // ===================================================================
        // PHASE 4: Clean the winning container
        // ===================================================================
        
        // Remove any remaining noise inside the content container
        contentElement.find("script, style, iframe, form, button, input, textarea, label, select, option, noscript, svg, canvas").remove();
        contentElement.find(".share, .social, .related, .tags, .comment, .comments, .ad, .ads, .advertisement, .widget, .sidebar, .footer, .header, .nav, .menu, .notification, .submenu, .infinity").remove();
        contentElement.find("[class*='comment'], [class*='share'], [class*='social'], [class*='related'], [class*='widget'], [class*='ad-'], [class*='sponsor']").remove();
        
        // Make relative image sources absolute
        contentElement.find("img").each((_, elem) => {
          const $img = $(elem);
          let src = $img.attr("src") || $img.attr("data-src") || $img.attr("data-original-src") || $img.attr("data-lazy-src");
          if (src) {
            try {
              const absoluteUrl = new URL(src, targetUrl).href;
              $img.attr("src", absoluteUrl);
              // Keep only src and alt
              const alt = $img.attr("alt") || "";
              const attribs = (elem as any).attribs || {};
              for (const attr of Object.keys(attribs)) {
                if (attr !== "src" && attr !== "alt") {
                  $img.removeAttr(attr);
                }
              }
            } catch (e) {
              // Leave src alone if URL parsing fails
            }
          } else {
            $img.remove();
          }
        });
        
        // Extract cleaned text content, rebuilding only from safe elements
        let cleanedHtml = "";
        
        // Walk the content tree and extract only meaningful text blocks
        const extractCleanContent = ($container: any): string => {
          let result = "";
          
          $container.children().each((_: any, child: any) => {
            const tagName = (child.tagName || "").toLowerCase();
            const $child = $(child);
            const innerHtml = $child.html() || "";
            const textContent = $child.text().trim();
            
            // Skip empty elements
            if (textContent.length === 0 && !["img", "br", "hr"].includes(tagName)) return;
            
            // Skip elements that look like JavaScript or CSS remnants
            if (textContent.startsWith("var ") || textContent.startsWith("function") ||
                textContent.startsWith("$(") || textContent.startsWith("window.") ||
                textContent.includes("document.createElement") ||
                textContent.includes("navigator.userAgent") ||
                /^\s*\.\w+\s*\{/.test(textContent) ||
                /^\s*@media/.test(textContent) ||
                /try\s*\{.*catch/.test(textContent)) {
              return;
            }
            
            // Skip short text that's likely UI labels/buttons  
            const boilerplateTexts = [
              "advertisement", "comment", "send comment", "load more", 
              "like us", "follow us", "share", "tweet", "subscribe",
              "name :", "send", "reply", "breaking news", "live",
              "write your reply", "copyright", "all rights reserved",
              "privacy policy", "terms and conditions", "contact us",
              "about", "close", "menu"
            ];
            const lowerText = textContent.toLowerCase();
            if (textContent.length < 40 && boilerplateTexts.some(bp => lowerText.includes(bp))) {
              return;
            }
            
            // Skip navigational text (menu items)
            if (/^(News|World|Sports|Entertainment|Business|Travel|Column|Opinion|Features|Technology|Lifestyle|Art|Culture|Health|People|Local|Edition)\s*$/i.test(textContent)) {
              return;
            }
            
            // Process allowed elements
            if (["p", "blockquote", "pre"].includes(tagName)) {
              result += `<${tagName}>${innerHtml}</${tagName}>\n`;
            } else if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName)) {
              // Only include headings that look like real content, not nav labels
              if (textContent.length > 3 && textContent.length < 200) {
                result += `<${tagName}>${textContent}</${tagName}>\n`;
              }
            } else if (["ul", "ol"].includes(tagName)) {
              result += `<${tagName}>${innerHtml}</${tagName}>\n`;
            } else if (tagName === "figure") {
              result += `<figure>${innerHtml}</figure>\n`;
            } else if (tagName === "img") {
              const src = $child.attr("src") || "";
              const alt = $child.attr("alt") || "";
              if (src) result += `<img src="${src}" alt="${alt}" />\n`;
            } else if (tagName === "table") {
              result += `<table>${innerHtml}</table>\n`;
            } else if (["div", "section", "article", "span", "main"].includes(tagName)) {
              // Recurse into structural containers
              const nested = extractCleanContent($child);
              if (nested.trim().length > 0) {
                result += nested;
              }
            } else if (tagName === "hr") {
              result += "<hr />\n";
            }
          });
          
          return result;
        };
        
        cleanedHtml = extractCleanContent(contentElement);
        
        // If the cleaned content is too short, the scoring may have picked a sub-container.
        // Fall back to a broader search.
        if (cleanedHtml.replace(/<[^>]*>/g, "").trim().length < 100) {
          console.log("[Web Clipper] Cleaned content too short, falling back to body extraction.");
          cleanedHtml = extractCleanContent($("body"));
        }
        
        // Final cleanup: remove duplicate whitespace and empty tags
        cleanedHtml = cleanedHtml
          .replace(/<p>\s*<\/p>/g, "")
          .replace(/<div>\s*<\/div>/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        // Build a single clean chapter
        let chapters: { title: string; content: string }[] = [{
          title: "Article",
          content: cleanedHtml
        }];

        if (chapters[0].content.replace(/<[^>]*>/g, "").trim().length < 30) {
          // Absolute fallback
          chapters = [{
            title: "Article",
            content: `<p>${description || "Content could not be extracted from this page."}</p>`
          }];
        }

        // Compile chapters into a single elegant HTML reader-friendly file
        let fullHtmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Georgia, serif;
      line-height: 1.7;
      color: #111;
      max-width: 650px;
      margin: 40px auto;
      padding: 0 20px;
      background-color: #fcfcf9;
    }
    @media (prefers-color-scheme: dark) {
      body {
        color: #e0e0e0;
        background-color: #121212;
      }
    }
    h1 {
      font-size: 2.2em;
      line-height: 1.2;
      margin-bottom: 0.2em;
      font-weight: 700;
    }
    .author-line {
      font-style: italic;
      color: #666;
      margin-bottom: 2em;
      border-bottom: 1px solid #ccc;
      padding-bottom: 10px;
      font-size: 0.9em;
    }
    @media (prefers-color-scheme: dark) {
      .author-line {
        color: #aaa;
        border-bottom-color: #444;
      }
    }
    .chapter {
      margin-top: 3em;
      padding-top: 2em;
      border-top: 1px dashed #ccc;
    }
    .chapter:first-of-type {
      margin-top: 1em;
      padding-top: 0;
      border-top: none;
    }
    h2.chapter-title {
      font-size: 1.8em;
      margin-top: 0;
      margin-bottom: 1em;
      font-family: Georgia, serif;
    }
    h3 {
      font-size: 1.3em;
      margin-top: 1.5em;
    }
    p {
      margin-top: 0;
      margin-bottom: 1.2em;
      text-align: justify;
    }
    pre, code {
      background-color: #f4f4f4;
      padding: 2px 5px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 0.9em;
    }
    @media (prefers-color-scheme: dark) {
      pre, code {
        background-color: #2a2a2a;
      }
    }
    blockquote {
      border-left: 4px solid #b4a078;
      margin: 1.5em 0;
      padding-left: 1em;
      color: #555;
      font-style: italic;
    }
    @media (prefers-color-scheme: dark) {
      blockquote {
        color: #999;
      }
    }
    ul, ol {
      margin-bottom: 1.2em;
      padding-left: 1.5em;
    }
    li {
      margin-bottom: 0.5em;
    }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1.5em auto;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }
    @media (prefers-color-scheme: dark) {
      img {
        opacity: 0.85;
      }
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="author-line">By ${author}${publishedDate ? ` • ${publishedDate}` : ""} • Saved from ${domain}</div>
  ${leadImage ? `<img src="${leadImage}" alt="${title}" />` : ""}
  
  <div class="chapters-container">
    ${chapters.map((ch, idx) => `
      <div class="chapter" id="chapter-${idx}">
        ${ch.title !== "Article" ? `<h2 class="chapter-title">${ch.title}</h2>` : ""}
        <div class="chapter-content">
          ${ch.content}
        </div>
      </div>
    `).join("")}
  </div>
</body>
</html>`;

        return new Response(JSON.stringify({
          title,
          author,
          description,
          htmlContent: fullHtmlContent
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });

      } catch (err: any) {
        console.error("[Web Clipper Error]:", err);
        return new Response(JSON.stringify({ error: err.message || "An error occurred during URL conversion." }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 6. Cover Redirect/Proxy API (Proxies requests to bypass hotlinking and SSL restrictions)
    if (path === "/api/cover-redirect" || path === "/api/cover-proxy") {
      const isbn = url.searchParams.get("isbn");
      const md5 = url.searchParams.get("md5");
      const title = url.searchParams.get("title");
      const author = url.searchParams.get("author");

      // Try OpenLibrary by title/author first
      if (title) {
        try {
          const searchUrl = new URL("https://openlibrary.org/search.json");
          searchUrl.searchParams.append("title", title);
          if (author) searchUrl.searchParams.append("author", author);
          searchUrl.searchParams.append("limit", "1");

          const olRes = await fetch(searchUrl.toString());
          if (olRes.ok) {
            const olData = await olRes.json();
            const firstBook = olData.docs?.[0];
            if (firstBook?.cover_i) {
              const coverUrl = `https://covers.openlibrary.org/b/id/${firstBook.cover_i}-M.jpg`;
              const imgRes = await fetch(coverUrl, {
                headers: { "User-Agent": "Mozilla/5.0" }
              });
              if (imgRes.ok) {
                const body = await imgRes.arrayBuffer();
                return new Response(body, {
                  headers: {
                    "Content-Type": imgRes.headers.get("Content-Type") || "image/jpeg",
                    "Cache-Control": "public, max-age=604800, immutable",
                    "Access-Control-Allow-Origin": "*"
                  }
                });
              }
            }
          }
        } catch (_) {}
      }

      if (isbn && /^\d{10,13}$/.test(isbn)) {
        try {
          const openLibraryUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
          const olRes = await fetch(openLibraryUrl, {
            headers: { "User-Agent": "Mozilla/5.0" }
          });
          if (olRes.ok) {
            const body = await olRes.arrayBuffer();
            return new Response(body, {
              headers: {
                "Content-Type": olRes.headers.get("Content-Type") || "image/jpeg",
                "Cache-Control": "public, max-age=604800, immutable",
                "Access-Control-Allow-Origin": "*"
              }
            });
          }
        } catch (_) {}
      }

      if (md5) {
        const domains = ["annas-archive.org", "annas-archive.se", "annas-archive.li", "annas-archive.gl"];
        for (const domain of domains) {
          try {
            const coverUrl = `https://${domain}/covers/${md5}.jpg`;
            const res = await fetch(coverUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Referer": `https://${domain}/`
              }
            });
            if (res.ok) {
              const body = await res.arrayBuffer();
              return new Response(body, {
                headers: {
                  "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
                  "Cache-Control": "public, max-age=604800, immutable",
                  "Access-Control-Allow-Origin": "*"
                }
              });
            }
          } catch (_) {}
        }
      }

      // Try Google Books API fallback
      if (title) {
        try {
          const gUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`intitle:${title} ${author ? `inauthor:${author}` : ""}`)}&maxResults=1`;
          const gRes = await fetch(gUrl);
          if (gRes.ok) {
            const gData = await gRes.json();
            const thumb = gData.items?.[0]?.volumeInfo?.imageLinks?.thumbnail?.replace("http:", "https:");
            if (thumb) {
              const imgRes = await fetch(thumb, { headers: { "User-Agent": "Mozilla/5.0" } });
              if (imgRes.ok) {
                const body = await imgRes.arrayBuffer();
                return new Response(body, {
                  headers: {
                    "Content-Type": imgRes.headers.get("Content-Type") || "image/jpeg",
                    "Cache-Control": "public, max-age=604800, immutable",
                    "Access-Control-Allow-Origin": "*"
                  }
                });
              }
            }
          }
        } catch (_) {}
      }

      // If all fails, return a 404
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

    // WebDAV proxy for BYO personal archive (avoids browser CORS)
    if (path === "/api/webdav-proxy") {
      try {
        const method = (url.searchParams.get("method") || "GET").toUpperCase();
        let targetUrl = url.searchParams.get("url") || "";
        let username = url.searchParams.get("username") || "";
        let password = url.searchParams.get("password") || "";
        let depth = "0";
        let bodyText: string | undefined;
        let putBody: ArrayBuffer | undefined;
        let putContentType = "application/octet-stream";

        if (request.method === "POST") {
          const body = (await request.json().catch(() => ({}))) as Record<string, string>;
          targetUrl = targetUrl || body.url || "";
          username = username || body.username || "";
          password = password || body.password || "";
          depth = body.depth || "0";
          bodyText = body.bodyText;
        } else if (request.method === "PUT") {
          putBody = await request.arrayBuffer();
          putContentType = request.headers.get("content-type") || "application/octet-stream";
        }

        if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
          return new Response(JSON.stringify({ error: "Valid https WebDAV url is required." }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        const headers: Record<string, string> = { "User-Agent": "Kora-WebDAV/1.0" };
        if (username || password) {
          headers.Authorization = `Basic ${btoa(`${username}:${password}`)}`;
        }

        let upstreamBody: ArrayBuffer | string | undefined;
        if (method === "PUT") {
          headers["Content-Type"] = putContentType;
          upstreamBody = putBody;
        } else if (method === "PROPFIND") {
          headers.Depth = depth;
          headers["Content-Type"] = "application/xml";
          upstreamBody =
            bodyText ||
            `<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>`;
        }

        const upstream = await fetch(targetUrl, {
          method,
          headers,
          body: method === "GET" || method === "HEAD" || method === "MKCOL" ? undefined : upstreamBody,
          redirect: "follow",
        });

        if (method === "GET") {
          const buf = await upstream.arrayBuffer();
          return new Response(buf, {
            status: upstream.status,
            headers: {
              "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
              "Cache-Control": "no-store",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        if (method === "PUT") {
          return new Response(JSON.stringify({ status: upstream.status, ok: upstream.ok }), {
            status: upstream.status,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        const text = await upstream.text();
        return new Response(
          JSON.stringify({
            status: upstream.status,
            ok: upstream.ok,
            bodyText: text.slice(0, 4000),
            error: upstream.ok ? undefined : text.slice(0, 200),
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          }
        );
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || "WebDAV proxy failed" }), {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    // 11. File Proxy / Z-Library Download Proxy
    if ((path === "/api/proxy-file" || path === "/api/zlib/download") && (request.method === "GET" || request.method === "HEAD" || request.method === "POST")) {
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

        downloadUrl = normalizeMediaUrl(downloadUrl);

        // Fast path: stream audiobook/audio files with Range support
        const isAudioRequest = /\.(mp3|m4a|ogg|wav|aac)(\?|$)/i.test(downloadUrl) || /ipaudio/i.test(downloadUrl);
        if (isAudioRequest) {
          try {
            const audioUrl = normalizeMediaUrl(downloadUrl);
            const rangeHeader = request.headers.get("Range");
            const clientReferer = url.searchParams.get("referer") || "";
            let originReferer = "https://hdaudiobooks.com/";
            try {
              originReferer = `${new URL(audioUrl).origin}/`;
            } catch {
              /* keep default */
            }
            const referers = [
              clientReferer,
              refererForMediaUrl(audioUrl),
              originReferer,
              "https://hdaudiobooks.com/",
              "https://fulllengthaudiobooks.com/",
            ].filter(Boolean);

            let audioRes: Response | null = null;
            for (const referer of referers) {
              const attempt = await fetch(audioUrl, {
                method: request.method === "HEAD" ? "HEAD" : "GET",
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                  "Accept": "audio/mpeg,audio/*,*/*",
                  "Referer": referer,
                  ...(rangeHeader ? { Range: rangeHeader } : {}),
                },
                redirect: "follow",
              });
              if (attempt.ok || attempt.status === 206) {
                audioRes = attempt;
                break;
              }
            }

            if (!audioRes) {
              return new Response("Upstream audio error", { status: 403 });
            }

            const outHeaders = new Headers(audioRes.headers);
            outHeaders.set("Access-Control-Allow-Origin", "*");
            outHeaders.set("Accept-Ranges", "bytes");
            if (!outHeaders.get("Content-Type")?.includes("audio")) {
              outHeaders.set("Content-Type", "audio/mpeg");
            }
            outHeaders.delete("content-security-policy");
            outHeaders.delete("content-encoding");
            return new Response(request.method === "HEAD" ? null : audioRes.body, {
              status: audioRes.status,
              headers: outHeaders,
            });
          } catch (err: any) {
            return new Response(JSON.stringify({ error: err.message }), {
              status: 502,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
          }
        }

        let targetUrl = downloadUrl;

        // Force https for public search/downloads to avoid block/mixed content issues in Cloudflare Workers
        if (targetUrl.startsWith("http://")) {
          try {
            const parsedUrl = new URL(targetUrl);
            if (parsedUrl.host.includes("libgen") || parsedUrl.host.includes("library") || parsedUrl.host.includes("archive")) {
              targetUrl = targetUrl.replace(/^http:\/\//i, "https://");
            }
          } catch (_) {}
        }

        // Pre-resolve: Libgen landing pages (like get.php?md5=) can be extremely difficult to fetch in Cloudflare Workers 
        // due to strict TLS, DDOS protection, or IP blocks. We use libgen.li or libgen.rs because library.lol
        // is frequently unreachable or taken down.
        if (targetUrl.includes("get.php?md5=") && !targetUrl.includes("&key=") && !targetUrl.includes("libgen")) {
          const md5Match = targetUrl.match(/md5=([a-fA-F0-9]{32})/i);
          if (md5Match) {
            const md5 = md5Match[1];
            targetUrl = `https://libgen.li/get.php?md5=${md5.toLowerCase()}`;
            console.log(`Rewrote Libgen landing page to libgen.li for robust worker resolution: ${targetUrl}`);
          }
        }

        // Pre-resolve: Internet Archive /details/ pages to actual file download URLs via metadata API
        if (targetUrl.includes("archive.org/details/")) {
          try {
            const iaId = targetUrl.split("/details/")[1]?.split("/")[0]?.split("?")[0];
            if (iaId) {
              console.log(`[IA Worker] Resolving archive.org details for item: ${iaId}`);
              const metaRes = await fetch(`https://archive.org/metadata/${iaId}`, {
                headers: { "User-Agent": "Mozilla/5.0" },
                signal: AbortSignal.timeout(8000)
              });
              if (metaRes.ok) {
                const meta = await metaRes.json() as any;
                const files: any[] = meta.files || [];
                const bookFile = files.find((f: any) => f.name?.endsWith(".epub")) ||
                                 files.find((f: any) => f.name?.endsWith(".pdf")) ||
                                 files.find((f: any) => f.name?.endsWith(".mobi")) ||
                                 files.find((f: any) => f.name?.endsWith(".azw3")) ||
                                 files.find((f: any) => f.name?.endsWith(".html")) ||
                                 files.find((f: any) => f.name?.endsWith(".json")) ||
                                 files.find((f: any) => f.name?.endsWith(".txt"));
                if (bookFile) {
                  const directUrl = `https://archive.org/download/${iaId}/${encodeURIComponent(bookFile.name)}`;
                  console.log(`[IA Worker] Resolved to direct download: ${directUrl}`);
                  targetUrl = directUrl;
                } else {
                  return new Response(JSON.stringify({ error: "No downloadable book file found in this Internet Archive item." }), {
                    status: 404,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                  });
                }
              }
            }
          } catch (err: any) {
            console.warn("[IA Worker] Failed to resolve archive.org details:", err.message || err);
          }
        }


        // 1. Rewrite library.lol to working Libgen mirrors as library.lol is reportedly down
        if (targetUrl.includes("library.lol")) {
          const md5Match = targetUrl.match(/([a-fA-F0-9]{32})/i);
          if (md5Match) {
            const md5 = md5Match[1];
            targetUrl = `https://libgen.li/get.php?md5=${md5.toLowerCase()}`;
            console.log(`Rewrote library.lol to libgen.li: ${targetUrl}`);
          }
        }

        // 2. Resolve Libgen landing page to its actual direct file download link
        const isLibgenLanding = targetUrl.includes("get.php?md5=") && !targetUrl.includes("&key=");
        if (isLibgenLanding) {
          try {
            console.log(`Resolving Libgen landing page in Worker: ${targetUrl}`);
            let htmlRes;
            try {
              htmlRes = await fetch(targetUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
                },
                redirect: "follow"
              });
            } catch (err) {
              if (targetUrl.startsWith("https://")) {
                const fallbackUrl = targetUrl.replace(/^https:\/\//i, "http://");
                console.log(`Resolving Libgen landing page failed, retrying over HTTP: ${fallbackUrl}`);
                htmlRes = await fetch(fallbackUrl, {
                  headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
                  }
                });
              } else {
                throw err;
              }
            }
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
            `https://ipfs.io/ipfs/${cid}`,
            `https://dweb.link/ipfs/${cid}`,
            `https://gateway.pinata.cloud/ipfs/${cid}`,
            `https://nftstorage.link/ipfs/${cid}`,
            `https://w3s.link/ipfs/${cid}`,
            `https://storry.tv/ipfs/${cid}`,
            `https://ipfs.run/ipfs/${cid}`,
            `https://cloudflare-ipfs.com/ipfs/${cid}`
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
            "Referer": "https://annas-archive.org/",
            "Accept": "application/octet-stream,application/epub+zip,application/pdf,*/*",
          };
          if (userId && userKey) {
            finalHeaders["Cookie"] = `remix_userid=${userId}; remix_userkey=${userKey}`;
          }

          if (isLibgenUrl(targetUrl)) {
            response = await fetchBinaryWithLibgenMirrors(targetUrl, finalHeaders);
            resolvedFinalUrl = targetUrl;
          } else {
            try {
              response = await fetch(targetUrl, {
                headers: finalHeaders,
                redirect: "follow",
              });
            } catch (fetchErr: any) {
              if (targetUrl.startsWith("https://")) {
                const fallbackUrl = targetUrl.replace(/^https:\/\//i, "http://");
                console.log(`Worker HTTPS fetch failed, retrying over HTTP: ${fallbackUrl}`);
                response = await fetch(fallbackUrl, {
                  headers: finalHeaders,
                  redirect: "follow",
                });
              } else {
                throw fetchErr;
              }
            }
          }
        }

        if (!response.ok) {
          if (response.status === 403) {
            throw new Error(`Access Forbidden (403) by mirror host. This mirror may be temporarily blocking proxy requests or requires a direct browser visit.`);
          }
          throw new Error(`Remote host returned status ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type") || "application/octet-stream";
        if (contentType.toLowerCase().includes("text/html")) {
          const text = await response.clone().text();
          if (text.includes("Cloudflare") || text.includes("captcha")) {
            throw new Error("This mirror is blocked by a CAPTCHA or Cloudflare protection. Please try a different direct mirror (like libgen.li or IPFS).");
          }
          throw new Error("This mirror URL returned an HTML webpage instead of a binary book file. This usually happens when the mirror requires manual verification (like resolving a CAPTCHA), wait countdowns, or the link has expired.");
        }

        const resHeaders = new Headers(response.headers);
        resHeaders.set("Access-Control-Allow-Origin", "*");
        resHeaders.delete("content-encoding");
        resHeaders.delete("transfer-encoding");
        resHeaders.delete("content-security-policy");

        // Removed arrayBuffer buffering to allow streaming progress in frontend
        resHeaders.set("Content-Length", response.headers.get("content-length") || "");
        
        const contentDisposition = response.headers.get("content-disposition");
        if (!contentDisposition) {
          try {
            const filename = targetUrl.split("/").pop()?.split("?")[0] || "download.epub";
            resHeaders.set("Content-Disposition", `attachment; filename="${filename}"`);
          } catch (_) {
            resHeaders.set("Content-Disposition", `attachment; filename="download.epub"`);
          }
        }
        
        return new Response(response.body, {
          status: 200,
          headers: resHeaders
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 12. Image Proxy (covers) — serve third-party cover hosts same-origin
    // so they load on *.workers.dev despite hotlink/referrer protection & no-CSP.
    if (path === "/api/proxy-image") {
      const target = url.searchParams.get("url");
      if (!target) {
        return new Response("Missing url", { status: 400 });
      }
      if (/^data:/i.test(target) || /^blob:/i.test(target)) {
        return new Response("Inline image URLs cannot be proxied", { status: 400 });
      }
      // Only allow image hosts; block everything else (no open proxy).
      const ALLOWED_IMG = /(^|\.)(openlibrary\.org|covers\.openlibrary\.org|hdaudiobooks\.com|fulllengthaudiobooks\.com|ipaudio[0-9]*\.(com|club)|ipaudio3\.club|i\.gr-assets\.com|gr-assets\.com|libgen\.(li|is|rs|be|gl|lc|rocks)|archive\.org|annas-archive\.(gl|org)|booksdl\.lc|library\.lol|z-lib\.(gd|sk)|liber3\.eth\.limo|nyt\.com|static01\.nyt\.com|books\.google\.[a-z.]{2,8}|google\.[a-z.]{2,8}|googleusercontent\.[a-z.]{2,8}|goodreads\.com)$/i;
      let parsed: URL;
      try {
        parsed = new URL(target);
      } catch {
        return new Response("Bad url", { status: 400 });
      }
      if (!/^https?:$/i.test(parsed.protocol) || !ALLOWED_IMG.test(parsed.hostname)) {
        return new Response("Host not allowed", { status: 403 });
      }
      try {
        const upstream = await fetch(parsed.toString(), {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*,*/*",
            "Referer": `${parsed.protocol}//${parsed.hostname}/`
          },
          redirect: "follow"
        });
        if (!upstream.ok) {
          return new Response("Upstream error", { status: upstream.status });
        }
        const outHeaders = new Headers();
        outHeaders.set("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
        outHeaders.set("Cache-Control", "public, max-age=86400");
        outHeaders.set("Access-Control-Allow-Origin", "*");
        return new Response(upstream.body, { status: 200, headers: outHeaders });
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
