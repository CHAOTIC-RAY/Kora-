import puppeteer from "@cloudflare/puppeteer";

declare const HTMLRewriter: any;

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
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
      const iaId = url.searchParams.get("iaId") || "";
      if (!md5) {
        return new Response(JSON.stringify({ error: "MD5 is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // Check if this is a real 32-char MD5 or a SHA-256 pseudo-ID (64-char, from IA results)
      const isRealMd5 = /^[a-f0-9]{32}$/i.test(md5);

      let downloadLinks: any[] = [];

      if (isRealMd5) {
        // Real MD5 — libgen/library.lol links work
        downloadLinks = [
          {
            label: "Direct Mirror (library.lol) - Recommended",
            url: `https://library.lol/main/${md5}`,
            isDirect: true
          },
          {
            label: "Libgen Mirror (libgen.li)",
            url: `https://libgen.li/get.php?md5=${md5.toLowerCase()}`,
            isDirect: true
          },
          {
            label: "Anna's Archive",
            url: `https://annas-archive.gl/md5/${md5}`,
            isDirect: false
          }
        ];
      } else if (iaId) {
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
            url: `https://annas-archive.gl/search`,
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

        // Pre-resolve: Libgen landing pages (like get.php?md5=) can be extremely difficult to fetch in Cloudflare Workers 
        // due to strict TLS, DDOS protection, or IP blocks. We automatically rewrite them to library.lol/main/ MD5 pages,
        // which use the same files but have highly reliable, unblocked, open landing pages.
        if (targetUrl.includes("get.php?md5=") && !targetUrl.includes("&key=")) {
          const md5Match = targetUrl.match(/md5=([a-fA-F0-9]{32})/i);
          if (md5Match) {
            const md5 = md5Match[1];
            targetUrl = `https://library.lol/main/${md5}`;
            console.log(`Rewrote Libgen landing page to Library.lol for robust worker resolution: ${targetUrl}`);
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
                                 files.find((f: any) => f.name?.endsWith(".mobi"));
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


        // 1. Resolve library.lol to its actual direct file download link
        if (targetUrl.includes("library.lol")) {
          try {
            console.log(`Resolving library.lol landing page in Worker: ${targetUrl}`);
            let htmlRes;
            try {
              htmlRes = await fetch(targetUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
                }
              });
            } catch (err) {
              if (targetUrl.startsWith("https://")) {
                const fallbackUrl = targetUrl.replace(/^https:\/\//i, "http://");
                console.log(`Resolving library.lol landing page failed, retrying over HTTP: ${fallbackUrl}`);
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
            let htmlRes;
            try {
              htmlRes = await fetch(targetUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
                }
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
            "Referer": "https://annas-archive.gl/",
            "Accept": "application/octet-stream,application/epub+zip,application/pdf,*/*",
          };
          if (userId && userKey) {
            finalHeaders["Cookie"] = `remix_userid=${userId}; remix_userkey=${userKey}`;
          }

          try {
            response = await fetch(targetUrl, {
              headers: finalHeaders,
              redirect: 'follow'
            });
          } catch (fetchErr: any) {
            // Fallback to http:// if https:// failed (extremely common on libgen/library mirrors with broken SSL)
            if (targetUrl.startsWith("https://")) {
              const fallbackUrl = targetUrl.replace(/^https:\/\//i, "http://");
              console.log(`Worker HTTPS fetch failed, retrying over HTTP: ${fallbackUrl}`);
              response = await fetch(fallbackUrl, {
                headers: finalHeaders,
                redirect: 'follow'
              });
            } else {
              throw fetchErr;
            }
          }
        }

        if (!response.ok) {
          throw new Error(`Proxy target responded with status ${response.status}`);
        }

        // To prevent compression or chunking mismatches, let Cloudflare handle encoding/transfer headers naturally.
        // We stream the body directly using the standard Response constructor for optimal memory and speed.
        const responseClone = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
        responseClone.headers.set("Access-Control-Allow-Origin", "*");
        return responseClone;
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
