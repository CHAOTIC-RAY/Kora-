import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import dotenv from "dotenv";
import puppeteer from "puppeteer";
import crypto from "crypto";
import { GoogleGenAI, Type } from "@google/genai";
import zlibRouter from "./zlib-proxy";
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
} from "./src/lib/audiobookScraper";
import {
  getCachedAudiobookDetail,
  getCachedAudiobookSearch,
  setCachedAudiobookSearch,
  resolveAudiobookDetailParallel,
  resolveAudiobookDetailFromPage,
} from "./src/lib/audiobookServer";
import { fetchGoodreadsTrendingBooks, mapGoodreadsTrendingFallback } from "./src/lib/goodreadsTrending";
import { fetchBinaryWithLibgenMirrors, isLibgenUrl } from "./src/lib/libgenProxy";
import { discoverFeedFromUrl, fetchArticlePreview, fetchFeedFromUrl, proxyFeedImage } from "./src/lib/feedServer";
import { transcribeAudioBase64 } from "./src/lib/transcribeAudio";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5000;

// Lazy-initialized Gemini API client
let aiInstance: any = null;
function getGeminiClient() {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing.");
    }
    aiInstance = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiInstance;
}

app.use("/api/zlib", zlibRouter);

// RSS Feed Discovery & Fetch
app.post("/api/feed/discover", express.json(), async (req, res) => {
  const inputUrl = req.body.url;
  if (!inputUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }
  try {
    const result = await discoverFeedFromUrl(inputUrl);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Feed discovery failed" });
  }
});

app.post("/api/feed/fetch", express.json(), async (req, res) => {
  const feedUrl = req.body.feedUrl;
  if (!feedUrl) {
    return res.status(400).json({ error: "Missing feedUrl parameter" });
  }
  try {
    const result = await fetchFeedFromUrl(feedUrl);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Feed fetch failed" });
  }
});

app.post("/api/feed/preview", express.json(), async (req, res) => {
  const articleUrl = req.body.url;
  if (!articleUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }
  try {
    const result = await fetchArticlePreview(articleUrl);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Preview failed" });
  }
});

app.get("/api/feed/image", async (req, res) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl) {
    return res.status(400).send("Missing url");
  }
  try {
    const upstream = await proxyFeedImage(imageUrl);
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "transfer-encoding") res.setHeader(key, value);
    });
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Image proxy failed" });
  }
});

// Web Clipper / URL-to-eBook Conversion Endpoint (Non-AI using Cheerio + JSDOM)
app.post("/api/convert-url", express.json(), async (req, res) => {
  const targetUrl = req.body.url || req.query.url as string;
  if (!targetUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    console.log(`[Web Clipper] Fetching: ${targetUrl}`);
    
    // Parse domain
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format" });
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
    if (parsedUrl.hostname === "psmnews.mv" && /^\/\d+\/?$/.test(parsedUrl.pathname)) {
      fetchTargets.unshift(`https://psmnews.mv/en${parsedUrl.pathname}`);
    }

    let fetchErr: unknown = null;
    for (const fetchUrl of fetchTargets) {
      try {
        const response = await fetch(fetchUrl, {
          headers: pageHeaders,
          signal: AbortSignal.timeout(10000),
          redirect: "follow",
        });
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
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      });
      try {
        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        await page.goto(fetchTargets[0] || targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        rawHtml = await page.content();
      } finally {
        await browser.close();
      }
    }

    if (!rawHtml || rawHtml.trim().length < 100) {
      return res.status(500).json({ error: "Could not fetch any meaningful content from the provided URL" });
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
          // The longest part is usually the article title, not the site name
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

    res.json({
      title,
      author,
      description,
      htmlContent: fullHtmlContent
    });

  } catch (err: any) {
    console.error("[Web Clipper Error]:", err);
    res.status(500).json({ error: err.message || "An error occurred during URL conversion." });
  }
});

// Full Oxford English Dictionary Endpoint powered by Gemini
app.post("/api/transcribe-audio", express.json({ limit: "12mb" }), async (req, res) => {
  const audio = typeof req.body?.audio === "string" ? req.body.audio : "";
  const mimeType = typeof req.body?.mimeType === "string" ? req.body.mimeType : "audio/webm";
  const previousContext =
    typeof req.body?.previousContext === "string" ? req.body.previousContext : undefined;

  if (!audio) {
    return res.status(400).json({ error: "Missing audio payload" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Transcription service is not configured." });
  }

  try {
    const text = await transcribeAudioBase64(audio, mimeType, apiKey, previousContext);
    return res.json({ text });
  } catch (err: any) {
    console.error("Transcribe audio error:", err);
    return res.status(502).json({ error: err.message || "Transcription failed" });
  }
});

app.get("/api/oxford-dictionary", async (req, res) => {
  const word = req.query.word as string;
  if (!word) {
    return res.status(400).json({ error: "Missing word parameter" });
  }

  try {
    const wordClean = word.trim().replace(/[^a-zA-Z\s-]/g, "").toLowerCase();
    if (!wordClean) {
      return res.status(400).json({ error: "Invalid word parameter" });
    }
    
    // Check free dictionary API as a baseline
    let freeData: any = null;
    try {
      const apiRes = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(wordClean)}`);
      if (apiRes.ok) {
        const data = await apiRes.json();
        if (data && data[0]) {
          freeData = data[0];
        }
      }
    } catch (apiErr) {
      console.warn("Free dictionary baseline call failed:", apiErr);
    }

    const ai = getGeminiClient();
    const systemPrompt = `You are the Oxford English Dictionary (OED) lookup engine. 
Provide an extremely authoritative, detailed, academic, and comprehensive OED dictionary entry for the word. 
Include phonetic spelling, origin/etymology (historical development of the word), grammatical classifications (parts of speech), definitions, and elegant usage example sentences.`;

    const userPrompt = `Return a comprehensive Oxford English Dictionary entry for the word: "${wordClean}".
Baseline data (optional): ${freeData ? JSON.stringify(freeData) : "None"}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["word", "phonetic", "meanings"],
          properties: {
            word: { type: Type.STRING },
            phonetic: { type: Type.STRING, description: "Phonetics IPA guide, e.g., /əˈbʌndəns/" },
            origin: { type: Type.STRING, description: "Etymology / word origin history, e.g., 'From Old French abondance...'" },
            meanings: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["partOfSpeech", "definitions"],
                properties: {
                  partOfSpeech: { type: Type.STRING, description: "noun, verb, adjective, adverb, etc." },
                  definitions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      required: ["definition"],
                      properties: {
                        definition: { type: Type.STRING },
                        example: { type: Type.STRING, description: "An elegant example sentence showing usage." }
                      }
                    }
                  }
                }
              }
            },
            synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
            antonyms: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        }
      }
    });

    const resultText = response.text;
    if (resultText) {
      const dictionaryEntry = JSON.parse(resultText);
      return res.json(dictionaryEntry);
    } else if (freeData) {
      // Fallback
      return res.json(freeData);
    } else {
      return res.status(404).json({ error: "Word definition could not be located or generated." });
    }
  } catch (err: any) {
    console.error("Oxford Dictionary API Error:", err);
    return res.status(500).json({ error: err.message || "Failed to search Oxford dictionary" });
  }
});

// NYT Book Details Endpoint powered by Gemini & NYT Books API
app.get(["/api/nyt/book-details", "/api/nytimes/book-details"], async (req, res) => {
  const title = req.query.title as string;
  const author = req.query.author as string;
  if (!title) {
    return res.status(400).json({ error: "Missing title parameter" });
  }

  try {
    const titleClean = title.trim();
    const authorClean = author ? author.trim() : "";

    const apiKey = process.env.NYT_BOOKS_API_KEY || process.env.NYT_API_KEY;
    let nytBestsellerData: any = null;
    let nytReviewsData: any = null;

    if (apiKey) {
      try {
        // Query NYT Bestseller History
        const bsUrl = `https://api.nytimes.com/svc/books/v3/lists/best-sellers/history.json?title=${encodeURIComponent(titleClean)}&author=${encodeURIComponent(authorClean)}&api-key=${apiKey}`;
        const bsRes = await fetch(bsUrl);
        if (bsRes.ok) {
          const bsJson = await bsRes.json();
          nytBestsellerData = bsJson.results?.[0] || null;
        }

        // Query NYT Book Reviews
        const revUrl = `https://api.nytimes.com/svc/books/v3/reviews.json?title=${encodeURIComponent(titleClean)}&author=${encodeURIComponent(authorClean)}&api-key=${apiKey}`;
        const revRes = await fetch(revUrl);
        if (revRes.ok) {
          const revJson = await revRes.json();
          nytReviewsData = revJson.results?.[0] || null;
        }
      } catch (nytErr) {
        console.warn("NYT Books API call failed, will proceed with Gemini enrichment:", nytErr);
      }
    }

    // Call Gemini to generate/enrich NYT book details
    const ai = getGeminiClient();
    const systemPrompt = `You are the New York Times Book Review & Bestseller database engine.
Generate a comprehensive, authoritative, and elegant New York Times style book details view.
Provide NYT bestseller history (ranking details, weeks on list, category, or peak status), editorial reviews, NYT review snippets, detailed summary, page count, publication details, and list subjects.
Be extremely accurate and detailed. Return only clean JSON.`;

    const userPrompt = `Provide the detailed NYT Book details for:
Title: "${titleClean}"
Author: "${authorClean}"

Optional baseline NYT API responses:
Bestseller history: ${nytBestsellerData ? JSON.stringify(nytBestsellerData) : "None found"}
Reviews history: ${nytReviewsData ? JSON.stringify(nytReviewsData) : "None found"}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["title", "author", "description", "isBestseller"],
          properties: {
            title: { type: Type.STRING },
            author: { type: Type.STRING },
            isBestseller: { type: Type.BOOLEAN },
            bestsellerRank: { type: Type.STRING, description: "e.g., '#1 Bestseller', '#3 on NYT list', etc." },
            weeksOnList: { type: Type.INTEGER, description: "Number of weeks on the NYT Bestseller list" },
            bestsellerCategory: { type: Type.STRING, description: "e.g., 'Hardcover Fiction', 'Paperback Nonfiction'" },
            nytReviewSnippet: { type: Type.STRING, description: "A review quote or style consensus snippet, e.g., 'An extraordinary, luminous novel...' — The New York Times" },
            description: { type: Type.STRING, description: "Detailed, beautiful book synopsis/summary" },
            pageCount: { type: Type.INTEGER },
            publishYear: { type: Type.STRING },
            publisher: { type: Type.STRING },
            language: { type: Type.STRING, description: "Language code like 'en', 'es', etc." },
            industryIdentifiers: { 
              type: Type.ARRAY, 
              items: { 
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: "ISBN_10 or ISBN_13" },
                  identifier: { type: Type.STRING }
                }
              }
            },
            subjects: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Up to 5 genre tags or subjects" }
          }
        }
      }
    });

    const resultText = response.text;
    if (resultText) {
      const bookDetails = JSON.parse(resultText);
      return res.json(bookDetails);
    } else {
      return res.status(404).json({ error: "Book details could not be generated." });
    }
  } catch (err: any) {
    console.error("NYT Book Details API Error:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch NYT book details" });
  }
});

// In-memory book cache to store metadata and direct download URLs from search results
const bookCache = new Map<string, any>();

// Caches for optimizing performance, reliability, and speed-using (stress testing)
const googleBooksCache = new Map<string, { data: any, timestamp: number }>();
const GOOGLE_BOOKS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const raveSearchCache = new Map<string, { data: any, timestamp: number }>();
const RAVE_SEARCH_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const downloadLinksCache = new Map<string, { data: any, timestamp: number }>();
const DOWNLOAD_LINKS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const openLibraryCache = new Map<string, { data: any, timestamp: number }>();
const OL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes



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
let isFetchingNyt = false;

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

async function triggerNytBackgroundFetch(apiKey: string) {
  if (isFetchingNyt) return;
  isFetchingNyt = true;
  try {
    console.log("[NYT Background Fetch] Fetching fresh NYT Books overview in background...");
    const response = await fetchNytWithDelay(`https://api.nytimes.com/svc/books/v3/lists/overview.json?api-key=${apiKey}`);
    if (!response.ok) return;

    const data = await response.json();
    if (data.status !== "OK") return;

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
    nytCacheTime = Date.now();
    console.log(`[NYT Background Fetch] Cached ${books.length} book covers from NYT best sellers successfully.`);
  } catch (err) {
    console.error("[NYT Background Fetch] Error during background fetch:", err);
  } finally {
    isFetchingNyt = false;
  }
}

async function getNytBooks(): Promise<{ title: string; author: string; coverUrl: string; isbn: string }[]> {
  const now = Date.now();
  if (nytBooksCache.length > 0 && now - nytCacheTime < NYT_CACHE_TTL) {
    return nytBooksCache;
  }

  const apiKey = process.env.NYT_BOOKS_API_KEY || process.env.NYT_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return [];
  }

  // Trigger background fetch if not already fetching, returning any available (possibly stale) cache instantly
  triggerNytBackgroundFetch(apiKey);
  return nytBooksCache;
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
    const apiKey = process.env.NYT_BOOKS_API_KEY || process.env.NYT_API_KEY;

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

// NYT Overview Server-side Cache (Stale-While-Revalidate)
let nytOverviewCache: any = null;
let nytOverviewCacheTime = 0;
let isFetchingNytOverview = false;
const NYT_OVERVIEW_TTL = 12 * 60 * 60 * 1000; // 12 hours

async function refreshNytOverviewBackground(apiKey: string) {
  if (isFetchingNytOverview) return;
  isFetchingNytOverview = true;
  try {
    console.log("[NYT Overview Cache] Refreshing cache in background...");
    const response = await fetchNytWithDelay(`https://api.nytimes.com/svc/books/v3/lists/overview.json?api-key=${apiKey}`);
    if (response.ok) {
      const data = await response.json();
      if (data.status === "OK") {
        nytOverviewCache = data;
        nytOverviewCacheTime = Date.now();
        console.log("[NYT Overview Cache] Background cache refresh successful.");
      }
    }
  } catch (err: any) {
    console.error("[NYT Overview Cache] Background refresh failed:", err.message);
  } finally {
    isFetchingNytOverview = false;
  }
}

// NYT Best Sellers API
app.get("/api/nytimes/overview", async (req, res) => {
  try {
    const apiKey = process.env.NYT_BOOKS_API_KEY || process.env.NYT_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      console.warn("NYT_BOOKS_API_KEY is missing or empty");
      return res.status(500).json({
        error: "NYT API Key not configured. Please add NYT_BOOKS_API_KEY to your secrets."
      });
    }

    const now = Date.now();
    // 1. Fresh Hit
    if (nytOverviewCache && (now - nytOverviewCacheTime < NYT_OVERVIEW_TTL)) {
      console.log("[NYT Overview Cache] Fresh cache hit.");
      return res.json(nytOverviewCache);
    }

    // 2. Stale Hit (Stale-While-Revalidate)
    if (nytOverviewCache) {
      console.log("[NYT Overview Cache] Stale cache hit. Revalidating in background...");
      refreshNytOverviewBackground(apiKey); // trigger non-blocking refresh
      return res.json(nytOverviewCache);
    }

    // 3. Cache Miss (Synchronous Fetch)
    console.log("[NYT Overview Cache] Cache miss. Fetching NYT Books overview synchronously...");
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

    nytOverviewCache = data;
    nytOverviewCacheTime = Date.now();
    res.json(data);
  } catch (err: any) {
    console.error("NYT API handler failed:", err);
    res.status(500).json({ error: "Failed to fetch trending books from NYT", details: err.message });
  }
});

// NYT Category Books List API
app.get("/api/nytimes/list", async (req, res) => {
  try {
    const apiKey = process.env.NYT_BOOKS_API_KEY || process.env.NYT_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      console.warn("NYT_BOOKS_API_KEY is missing or empty for list fetch");
      return res.status(500).json({
        error: "NYT API Key not configured. Please add NYT_BOOKS_API_KEY to your secrets."
      });
    }

    const listName = req.query.list as string;
    const date = req.query.date as string || "current";
    if (!listName) {
      return res.status(400).json({ error: "Missing 'list' query parameter." });
    }

    console.log(`[NYT List Fetch] Fetching books for list: ${listName} at date: ${date}`);
    const url = `https://api.nytimes.com/svc/books/v3/lists/${encodeURIComponent(date)}/${encodeURIComponent(listName)}.json?api-key=${apiKey}`;
    const response = await fetchNytWithDelay(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`NYT List API returned ${response.status} for list ${listName}:`, errorText);
      return res.status(response.status).json({
        error: `NYT API returned error ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    if (data.status !== "OK") {
      console.error("NYT List API returned non-OK status:", data);
      throw new Error(data.message || data.status || "NYT API error");
    }

    res.json(data);
  } catch (err: any) {
    console.error("NYT List API handler failed:", err);
    res.status(500).json({ error: "Failed to fetch category books from NYT", details: err.message });
  }
});

// Goodreads Scraper Endpoint using cheerio and proxy fallbacks (bypassing Cloudflare without AI/Gemini)
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

// Fallback curated list when live Goodreads scrape is unavailable
async function fetchGoodreadsTrendingBooksLocal(): Promise<any[]> {
  const books = await fetchGoodreadsTrendingBooks(fetchPageHtmlWithProxies);
  if (books.length >= 3) return books;
  return mapGoodreadsTrendingFallback();
}

app.get("/api/goodreads/list", async (req, res) => {
  try {
    const listQuery = req.query.list as string;
    if (!listQuery) {
      return res.status(400).json({ error: "Missing 'list' query parameter." });
    }

    // Special case: daily-refreshed Goodreads trending list
    if (listQuery === "goodreads-blog-3182-weekly") {
      const books = await fetchGoodreadsTrendingBooksLocal();
      res.setHeader("Cache-Control", "no-store, max-age=0");
      return res.json(books);
    }

    console.log(`[Goodreads API] Fetching books for list query: ${listQuery}`);

    // Check memory cache first
    if (goodreadsCache.has(listQuery)) {
      console.log(`[Goodreads API] Returning cached results for list query: ${listQuery}`);
      return res.json(goodreadsCache.get(listQuery));
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
        return res.json(books);
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
        source: "goodreads",
      }));

      goodreadsCache.set(listQuery, mappedFallback);
      res.json(mappedFallback);
    }
  } catch (globalErr: any) {
    console.error("Critical failure in Goodreads route:", globalErr);
    res.status(500).json({ error: "Failed to load Goodreads list" });
  }
});

// Audiobooks: popular titles scraped live from source sites
app.get("/api/audiobooks/popular", async (_req, res) => {
  try {
    const scraped = await scrapePopularAudiobooks(fetchPageHtmlWithProxies);
    if (scraped.length >= 4) {
      return res.json(scraped);
    }
  } catch (err: any) {
    console.warn("[Audiobooks Popular] Scrape failed, using fallback:", err.message);
  }
  res.json(mapPopularAudiobooks());
});

// Audiobooks: search fulllengthaudiobooks.com and hdaudiobooks.com
app.get("/api/audiobooks/search", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });

  const cached = getCachedAudiobookSearch(q);
  if (cached) return res.json(cached);

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
  res.json(deduped);
});

// Audiobooks: streaming search (NDJSON — results arrive per source)
app.get("/api/audiobooks/search/stream", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const cached = getCachedAudiobookSearch(q);
  if (cached) {
    res.write(JSON.stringify({ source: "cache", results: cached }) + "\n");
    res.write(JSON.stringify({ done: true }) + "\n");
    return res.end();
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
        res.write(JSON.stringify({ source: src.name, results: batch }) + "\n");
      }
    } catch (err: any) {
      console.warn(`[Audiobook Stream] ${src.name} failed:`, err.message);
    }
  }));

  if (all.length === 0) {
    const lower = q.toLowerCase();
    const fallback = POPULAR_AUDIOBOOKS.filter(b =>
      b.title.toLowerCase().includes(lower) || b.author.toLowerCase().includes(lower)
    ).map(b => ({
      ...b,
      coverUrl: `/api/cover-redirect?title=${encodeURIComponent(b.title)}&author=${encodeURIComponent(b.author)}`,
      link: `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(b.title)}`,
      listenUrl: `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(b.title)}`,
      listenUrlAlt: `https://hdaudiobooks.com/?s=${encodeURIComponent(b.title)}`,
      source: "fulllengthaudiobooks",
    }));
    if (fallback.length) {
      all.push(...fallback);
      res.write(JSON.stringify({ source: "fallback", results: fallback }) + "\n");
    }
  }

  setCachedAudiobookSearch(q, all.slice(0, 16));
  res.write(JSON.stringify({ done: true }) + "\n");
  res.end();
});

// Audiobooks: scrape detail page for audio track URLs (pap-player data-playlist, audio elements)
app.get("/api/audiobooks/detail", async (req, res) => {
  const pageUrl = (req.query.url as string || "").trim();
  const urlsParam = (req.query.urls as string || "").trim();
  const urls = urlsParam ? urlsParam.split(",").map(u => u.trim()).filter(Boolean) : pageUrl ? [pageUrl] : [];

  if (urls.length === 0) return res.status(400).json({ error: "Missing query parameter 'url' or 'urls'" });

  const expectedTitle = (req.query.title as string || "").trim();

  try {
    const allowedHosts = ["hdaudiobooks.com", "fulllengthaudiobooks.com", "www.hdaudiobooks.com", "www.fulllengthaudiobooks.com"];
    for (const u of urls) {
      const host = new URL(u).hostname.replace(/^www\./, "");
      if (!allowedHosts.some(h => h.replace(/^www\./, "") === host)) {
        return res.status(400).json({ error: "Unsupported audiobook source URL" });
      }
    }

    const isValid = (detail: any) =>
      detail?.tracks?.length && (!expectedTitle || titlesRoughlyMatch(expectedTitle, detail.title));

    for (const u of urls) {
      const cached = getCachedAudiobookDetail(u.split("?")[0]);
      if (isValid(cached)) {
        res.setHeader("X-Cache", "HIT");
        return res.json(cached);
      }
    }

    const detail = urls.length > 1
      ? await resolveAudiobookDetailParallel(urls, fetchPageHtmlWithProxies, expectedTitle || undefined)
      : await resolveAudiobookDetailFromPage(urls[0], fetchPageHtmlWithProxies, expectedTitle || undefined);

    if (!isValid(detail)) {
      return res.status(404).json({ error: "No audio tracks found on this page" });
    }

    res.setHeader("X-Cache", "MISS");
    res.json(detail);
  } catch (err: any) {
    console.error("[Audiobook Detail] Failed:", err.message);
    res.status(500).json({ error: "Failed to load audiobook details", message: err.message });
  }
});

// Unified ebook search stream (Google Books + Anna's Archive in parallel)
app.get("/api/search/stream", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  const page = parseInt(req.query.page as string || "1", 10);
  if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const all: any[] = [];

  const googlePromise = fetch(`http://127.0.0.1:${PORT}/api/google-books/search?q=${encodeURIComponent(q)}&startIndex=${(page - 1) * 20}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data?.items) return;
      const books = data.items.slice(0, 12).map((item: any) => {
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
        res.write(JSON.stringify({ source: "google", books }) + "\n");
      }
    }).catch(() => {});

  const annasPromise = fetch(`http://127.0.0.1:${PORT}/api/annas-archive/search?q=${encodeURIComponent(q)}&page=${page}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      const books = (data?.results || data || []).slice(0, 12);
      if (books.length) {
        all.push(...books);
        res.write(JSON.stringify({ source: "annas", books }) + "\n");
      }
    }).catch(() => {});

  await Promise.allSettled([googlePromise, annasPromise]);
  res.write(JSON.stringify({ done: true, totalCount: all.length, hasMore: all.length >= 12 }) + "\n");
  res.end();
});

// Goodreads reviews endpoint
app.post("/api/goodreads/reviews", express.json(), async (req, res) => {
  const { title, author } = req.body;
  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  // 1. Clean the search query to improve Goodreads matching rate
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

  // Under the "no dont fake reviews" policy, if scraping fails, we do NOT fall back to AI/Gemini or dummy templates.
  // We return the real empty reviews list so the client can handle it or show direct search links.
  console.log(`[Goodreads Reviews API] Returning ${reviews.length} reviews via ${sourceMethod}`);
  return res.json({ reviews, source: sourceMethod });
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

    // 5. Try Google Books API fallback
    if (title) {
      try {
        const gUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`intitle:${title as string} ${author ? `inauthor:${author}` : ""}`)}&maxResults=1`;
        const gRes = await fetch(gUrl);
        if (gRes.ok) {
          const gData = await gRes.json();
          const thumb = gData.items?.[0]?.volumeInfo?.imageLinks?.thumbnail?.replace("http:", "https:");
          if (thumb) {
            return res.redirect(thumb);
          }
        }
      } catch (_) {}
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
    if (/^data:/i.test(imageUrl) || /^blob:/i.test(imageUrl)) {
      return res.status(400).send("Inline image URLs cannot be proxied");
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

// WebDAV proxy — lets the browser talk to a user's own WebDAV host without CORS issues.
async function handleWebDavProxy(req: any, res: any) {
  const method = String(req.query.method || req.body?.method || "GET").toUpperCase();
  const targetUrl = String(req.query.url || req.body?.url || "");
  const username = String(req.query.username || req.body?.username || "");
  const password = String(req.query.password || req.body?.password || "");

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: "Valid https WebDAV url is required." });
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent": "Kora-WebDAV/1.0",
    };
    if (username || password) {
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    }

    let body: Buffer | string | undefined;
    if (method === "PUT" && req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      body = Buffer.concat(chunks);
      headers["Content-Type"] = String(req.headers["content-type"] || "application/octet-stream");
    } else if (method === "PROPFIND") {
      headers.Depth = String(req.body?.depth || "0");
      headers["Content-Type"] = "application/xml";
      body =
        req.body?.bodyText ||
        `<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>`;
    }

    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" || method === "MKCOL" ? undefined : body,
      redirect: "follow",
    });

    if (method === "GET") {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status);
      res.setHeader(
        "Content-Type",
        upstream.headers.get("content-type") || "application/octet-stream"
      );
      res.setHeader("Cache-Control", "no-store");
      return res.send(buf);
    }

    if (method === "PUT") {
      return res.status(upstream.status).json({
        status: upstream.status,
        ok: upstream.ok,
      });
    }

    const text = await upstream.text();
    return res.status(200).json({
      status: upstream.status,
      ok: upstream.ok,
      bodyText: text.slice(0, 4000),
      error: upstream.ok ? undefined : text.slice(0, 200),
    });
  } catch (err: any) {
    console.error("WebDAV proxy failed:", err);
    return res.status(502).json({ error: err.message || "WebDAV proxy failed" });
  }
}

app.get("/api/webdav-proxy", handleWebDavProxy);
app.post("/api/webdav-proxy", express.json({ limit: "2mb" }), handleWebDavProxy);
app.put("/api/webdav-proxy", handleWebDavProxy);

// Same-origin Hugging Face Hub proxy for on-device Whisper (@xenova/transformers).
app.use("/api/hf", async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  try {
    const hfPath = (req.url || "").replace(/^\//, "").split("?")[0];
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/resolve\/[A-Za-z0-9_.-]+\/.+/.test(hfPath)) {
      return res.status(400).json({ error: "Invalid Hugging Face model path" });
    }
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const target = `https://huggingface.co/${hfPath}${qs}`;
    const headers: Record<string, string> = {
      "User-Agent": "Kora-HF-Proxy/1.0",
      Accept: req.headers.accept || "*/*",
    };
    if (req.headers.range) headers.Range = String(req.headers.range);
    if (req.headers["if-none-match"]) headers["If-None-Match"] = String(req.headers["if-none-match"]);

    const upstream = await fetch(target, { method: "GET", headers, redirect: "follow" });
    res.status(upstream.status);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges, ETag, Cache-Control"
    );
    const pass = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "cache-control",
      "last-modified",
    ];
    for (const key of pass) {
      const value = upstream.headers.get(key);
      if (value) res.setHeader(key, value);
    }
    if (!res.getHeader("Cache-Control")) {
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    }
    if (!res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "application/octet-stream");
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  } catch (err: any) {
    console.error("HF proxy failed:", err);
    return res.status(502).json({ error: err?.message || "HF proxy failed" });
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
    const { normalizeMediaUrl, refererForMediaUrl } = await import("./src/lib/mediaUrl");
    targetUrl = normalizeMediaUrl(targetUrl);

    const isAudioRequest = /\.(mp3|m4a|ogg|wav|aac)(\?|$)/i.test(targetUrl) || /ipaudio/i.test(targetUrl);
    if (isAudioRequest) {
      const clientReferer = (req.query.referer as string) || "";
      const referers = [
        clientReferer,
        refererForMediaUrl(targetUrl),
        `${new URL(targetUrl).origin}/`,
        "https://hdaudiobooks.com/",
        "https://fulllengthaudiobooks.com/",
      ].filter(Boolean);
      const rangeHeader = req.headers.range;

      for (const referer of referers) {
        const audioRes = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Accept": "audio/mpeg,audio/*,*/*",
            "Referer": referer,
            ...(rangeHeader ? { Range: rangeHeader } : {}),
          },
          redirect: "follow",
        });
        if (audioRes.ok || audioRes.status === 206) {
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Accept-Ranges", "bytes");
          res.setHeader("Content-Type", audioRes.headers.get("content-type") || "audio/mpeg");
          if (audioRes.headers.get("content-length")) {
            res.setHeader("Content-Length", audioRes.headers.get("content-length")!);
          }
          if (audioRes.headers.get("content-range")) {
            res.setHeader("Content-Range", audioRes.headers.get("content-range")!);
          }
          return res.status(audioRes.status).send(Buffer.from(await audioRes.arrayBuffer()));
        }
      }
      return res.status(403).send("Upstream audio error");
    }

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
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
              "Referer": new URL(gatewayUrl).origin + "/",
              "Accept": "application/octet-stream,application/epub+zip,application/pdf,*/*"
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
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
              "Referer": new URL(targetUrl).origin + "/",
              "Accept": "application/octet-stream,application/epub+zip,application/pdf,*/*"
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
        "Referer": new URL(targetUrl).origin + "/",
        "Accept": "application/octet-stream,application/epub+zip,application/pdf,*/*",
      };

      if (targetCookieHeader) {
        console.log(`[proxy-file] Forwarding user credentials cookie to bypass limits for ${new URL(targetUrl).host}`);
        finalHeaders["Cookie"] = targetCookieHeader;
      }

      if (isLibgenUrl(targetUrl)) {
        response = await fetchBinaryWithLibgenMirrors(targetUrl, finalHeaders);
      } else {
        response = await fetch(targetUrl, {
          headers: finalHeaders,
          redirect: "follow",
        });
      }
    }

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error(`Access Forbidden (403) by mirror host. This mirror may be temporarily blocking proxy requests or requires a direct browser visit.`);
      }
      throw new Error(`Remote host returned status ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const contentDisposition = response.headers.get("content-disposition");
    
    if (contentType.toLowerCase().includes("text/html") || 
        contentType.toLowerCase().includes("php") || 
        (contentDisposition && contentDisposition.toLowerCase().includes(".php"))) {
      if (contentType.toLowerCase().includes("text/html")) {
        const text = await response.text();
        if (text.includes("Cloudflare") || text.includes("captcha")) {
          throw new Error("This mirror is blocked by a CAPTCHA or Cloudflare protection. Please try a different direct mirror (like Library.lol or IPFS).");
        }
      }
      throw new Error("This mirror URL returned an incorrect file type (HTML/PHP) instead of a binary book file. This usually happens when the mirror requires manual verification or the link has expired.");
    }
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

    // Stream the body directly to allow frontend progress bar to update properly
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } else {
      res.end();
    }
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
  const { q, source, page } = req.query;
  if (!q) return res.status(400).json({ error: "Query 'q' is required." });
  
  const searchSource = (source as string) || "all";
  const searchPage = parseInt(page as string) || 1;
  const cacheKey = `${q}_${searchSource}_${searchPage}`;
  const cached = raveSearchCache.get(cacheKey);
  const now = Date.now();

  try {
    if (cached && now - cached.timestamp < RAVE_SEARCH_CACHE_TTL) {
      console.log(`Serving cached Rave Book Search for: "${q}"`);
      if (cached.data && Array.isArray(cached.data.books)) {
        cached.data.books.forEach((b: any) => {
          if (b && b.md5) bookCache.set(b.md5, b);
        });
      }
      return res.json(cached.data);
    }

    console.log(`Executing Rave Book Search for query: "${q}", source: ${searchSource}, page: ${searchPage}`);
    
    // Run Rave Search directly
    let raveResults: any[] = [];
    let meta: any = {};
    
    try {
      const initial = await fetchFromRaveBookSearch(q as string, "ebooks", searchSource, searchPage);
      raveResults = initial?.results || [];
      meta = initial?.meta || {};
    } catch (e) {
      console.error("fetchFromRaveBookSearch failed:", e);
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

    const responseData = {
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
    };

    raveSearchCache.set(cacheKey, { data: responseData, timestamp: now });
    res.json(responseData);
  } catch (err: any) {
    console.error("Rave Book Search API failed:", err);
    if (cached) {
      console.log(`Error occurred. Serving expired Rave Book Search cache for key: ${cacheKey}`);
      if (cached.data && Array.isArray(cached.data.books)) {
        cached.data.books.forEach((b: any) => {
          if (b && b.md5) bookCache.set(b.md5, b);
        });
      }
      return res.json(cached.data);
    }
    res.status(500).json({ error: err.message });
  }
});



// 7. API: Anna's Archive Download
app.get("/api/annas-archive/download", async (req, res) => {
  const { md5, iaId: iaIdParam, url: directUrlParam } = req.query;
  if (!md5) return res.status(400).json({ error: "md5 is required." });

  const md5Str = md5 as string;
  const cacheKey = `${md5Str}_${iaIdParam || ""}_${directUrlParam || ""}`;
  const now = Date.now();
  const cached = downloadLinksCache.get(cacheKey);

  try {
    if (cached && now - cached.timestamp < DOWNLOAD_LINKS_CACHE_TTL) {
      console.log(`Serving cached download links for MD5: ${md5Str}`);
      return res.json(cached.data);
    }

    const cachedBook = bookCache.get(md5Str);
    const isRealMd5 = /^[a-f0-9]{32}$/i.test(md5Str);

    let directLinks: any[] = [];
    let backupLinks: any[] = [];

    // Resolve direct URL
    const raveUrl = (directUrlParam as string) || (cachedBook?.downloadUrl as string) || "";

    // Resolve IA ID
    let iaId = (iaIdParam as string) || (cachedBook?.iaId as string) || "";
    if (!iaId && raveUrl) {
      const match = raveUrl.match(/archive\.org\/(details|download)\/([^/]+)/i);
      if (match) {
        iaId = match[2];
      }
    }

    // 1. First Priority: Rave Direct Link (if available and not an IA details page)
    if (raveUrl) {
      const isIaDetails = raveUrl.includes("archive.org/details/");
      if (!isIaDetails) {
        const urlLower = raveUrl.toLowerCase();
        const isSlow = urlLower.includes("/slow_download/") || urlLower.includes("annas-archive");
        directLinks.push({
          label: isSlow ? "Anna's Archive (Slow/Manual)" : "Rave Direct Download (Recommended)",
          url: raveUrl,
          isDirect: !isSlow
        });
      } else {
        backupLinks.push({
          label: "Internet Archive (Manual)",
          url: raveUrl,
          isDirect: false
        });
      }
    }

    // 2. Second Priority: Internet Archive Direct Links
    if (iaId) {
      try {
        const metaRes = await fetch(`https://archive.org/metadata/${iaId}`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(4000)
        });
        if (metaRes.ok) {
          const meta = await metaRes.json();
          const files: any[] = meta.files || [];
          const epubFile = files.find((f: any) => f.name?.endsWith(".epub"));
          const pdfFile = files.find((f: any) => f.name?.endsWith(".pdf"));
          if (epubFile) {
            directLinks.push({
              label: "Internet Archive (EPUB)",
              url: `https://archive.org/download/${iaId}/${encodeURIComponent(epubFile.name)}`,
              isDirect: true
            });
          }
          if (pdfFile) {
            directLinks.push({
              label: "Internet Archive (PDF)",
              url: `https://archive.org/download/${iaId}/${encodeURIComponent(pdfFile.name)}`,
              isDirect: true
            });
          }
        }
      } catch (e: any) {
        console.warn("Failed to resolve archive.org item:", e.message);
      }

      // Also add manual link as backup if not already added
      const hasManualIa = backupLinks.some(l => l.url.includes(iaId));
      if (!hasManualIa) {
        backupLinks.push({
          label: "Internet Archive (Manual)",
          url: `https://archive.org/details/${iaId}`,
          isDirect: false
        });
      }
    }

    // 3. Third Priority: Standard Libgen / Library.lol mirrors
    if (isRealMd5) {
      // Direct Mirror (library.lol)
      directLinks.push({
        label: "Library.lol (Recommended)",
        url: `https://library.lol/main/${md5Str}`,
        isDirect: true
      });

      // Libgen Mirror (libgen.li)
      directLinks.push({
        label: "Libgen Mirror",
        url: `https://libgen.li/get.php?md5=${md5Str.toLowerCase()}`,
        isDirect: true
      });

      // Anna's Archive lookup page as manual backup
      backupLinks.push({
        label: "Anna's Archive (Manual)",
        url: `https://annas-archive.org/md5/${md5Str}`,
        isDirect: false
      });
    }

    // Combine and Deduplicate
    const seenUrls = new Set<string>();
    const downloadLinks: any[] = [];

    for (const link of [...directLinks, ...backupLinks]) {
      if (!seenUrls.has(link.url)) {
        seenUrls.add(link.url);
        downloadLinks.push(link);
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

    const responseData = {
      downloadLinks: downloadLinks,
      options: downloadLinks,
      mirror: "Consolidated Search Cache",
      parsedBy: "Rave API"
    };

    downloadLinksCache.set(cacheKey, { data: responseData, timestamp: now });
    res.json(responseData);
  } catch (err: any) {
    console.error("Download route error:", err);
    if (cached) {
      console.log(`Error occurred. Serving expired download links cache for key: ${cacheKey}`);
      return res.json(cached.data);
    }
    res.status(500).json({ error: "Failed to get download links" });
  }
});

// 7. API: Open Library Proxy
app.get("/api/open-library/search", async (req, res) => {
  const { q, title, author } = req.query;
  const cacheKey = `${q || ""}_${title || ""}_${author || ""}`;
  const now = Date.now();
  const cached = openLibraryCache.get(cacheKey);

  try {
    if (cached && now - cached.timestamp < OL_CACHE_TTL) {
      console.log(`Serving cached Open Library Search for key: ${cacheKey}`);
      return res.json(cached.data);
    }

    const url = new URL("https://openlibrary.org/search.json");
    if (q) url.searchParams.append("q", q as string);
    if (title) url.searchParams.append("title", title as string);
    if (author) url.searchParams.append("author", author as string);
    url.searchParams.append("limit", "10");

    const response = await fetch(url.toString());
    const data = await response.json();
    openLibraryCache.set(cacheKey, { data, timestamp: now });
    res.json(data);
  } catch (err: any) {
    console.error("Open Library Search Error:", err);
    if (cached) {
      console.log(`Error occurred. Serving expired Open Library cache for key: ${cacheKey}`);
      return res.json(cached.data);
    }
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


// NYT Raw Details Endpoint (No AI)
app.get("/api/nytimes/book-details-raw", async (req, res) => {
  const { title, author } = req.query;
  if (!title) return res.status(400).json({ error: "Missing title" });

  const apiKey = process.env.NYT_BOOKS_API_KEY || process.env.NYT_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "NYT API Key not configured" });

  try {
    const url = `https://api.nytimes.com/svc/books/v3/lists/best-sellers/history.json?title=${encodeURIComponent(title as string)}&author=${encodeURIComponent(author as string || "")}&api-key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("NYT Raw Details Error:", err);
    res.status(500).json({ error: "Failed to fetch raw NYT details" });
  }
});

// Google Books API Proxy
app.get("/api/google-books/search", async (req, res) => {
  const { q, maxResults, startIndex } = req.query;
  if (!q) return res.status(400).json({ error: "Missing query" });

  const cacheKey = `${q}_${maxResults || 1}_${startIndex || 0}`;
  const now = Date.now();
  const cached = googleBooksCache.get(cacheKey);
  if (cached && now - cached.timestamp < GOOGLE_BOOKS_CACHE_TTL) {
    console.log(`Serving cached Google Books Search for key: ${cacheKey}`);
    return res.json(cached.data);
  }

  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  const limit = maxResults || 1;
  const start = startIndex ? `&startIndex=${startIndex}` : "";
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q as string)}&maxResults=${limit}${start}${apiKey ? `&key=${apiKey}` : ""}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    googleBooksCache.set(cacheKey, { data, timestamp: now });
    res.json(data);
  } catch (err) {
    console.error("Google Books API Proxy Error:", err);
    if (cached) {
      console.log(`Error occurred. Serving expired cache for key: ${cacheKey}`);
      return res.json(cached.data);
    }
    res.status(500).json({ error: "Failed to fetch from Google Books" });
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
