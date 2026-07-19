export interface ParsedFeedItem {
  id: string;
  title: string;
  link: string;
  author?: string;
  summary?: string;
  publishedAt: number;
  imageUrl?: string;
}

export interface ParsedFeed {
  title: string;
  link?: string;
  description?: string;
  items: ParsedFeedItem[];
}

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function stripTags(html: string): string {
  const decoded = decodeEntities(html);
  return decoded.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractAtomLink(block: string): string {
  const links = [...block.matchAll(/<link\b([^>]*)>/gi)];
  for (const match of links) {
    const attrs = match[1] || "";
    const rel = attrs.match(/\brel=["']([^"']+)["']/i)?.[1] || "";
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (href && (!rel || /alternate/i.test(rel))) {
      return decodeEntities(href);
    }
  }
  return "";
}

export function normalizeFeedArticleLink(link: string, feedUrl?: string): string {
  if (!link || !feedUrl) return link;
  try {
    const article = new URL(link);
    if (article.hostname !== "psmnews.mv") return link;
    if (article.pathname.match(/^\/\d+\/?$/)) {
      const feed = new URL(feedUrl);
      const locale = feed.pathname.match(/^\/(en|dv)\//i)?.[1];
      if (locale) {
        return `https://psmnews.mv/${locale}${article.pathname}`;
      }
    }
  } catch {
    // keep original link
  }
  return link;
}

function parseDate(value?: string): number {
  if (!value) return Date.now();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function itemId(link: string, title: string): string {
  return `${link}::${title}`.slice(0, 240);
}

function extractImageUrl(block: string, descriptionHtml?: string): string | undefined {
  const candidates = [
    block.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i)?.[1],
    block.match(/<media:content[^>]*url=["']([^"']+)["'][^>]*(?:medium=["']image["']|type=["']image)/i)?.[1],
    block.match(/<media:content[^>]*(?:medium=["']image["']|type=["']image)[^>]*url=["']([^"']+)["']/i)?.[1],
    block.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image/i)?.[1],
    block.match(/<image[^>]*>[\s\S]*?<url[^>]*>([\s\S]*?)<\/url>/i)?.[1],
    descriptionHtml?.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1],
    descriptionHtml?.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1],
    descriptionHtml?.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1],
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const cleaned = decodeEntities(candidate.trim());
    if (cleaned && !/1x1|pixel|spacer|blank\.gif/i.test(cleaned)) {
      return cleaned;
    }
  }
  return undefined;
}

function parseRss(xml: string): ParsedFeed {
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
  const channel = channelMatch?.[1] || xml;
  const feedTitle = stripTags(channel.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "RSS Feed");
  const feedLink = decodeEntities(channel.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || "");
  const items: ParsedFeedItem[] = [];

  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(channel))) {
    const block = match[1];
    const title = stripTags(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Untitled");
    const link = decodeEntities(
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ||
        block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ||
        ""
    );
    if (!link) continue;
    const pubDate = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1];
    const description =
      block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ||
      block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i)?.[1] ||
      "";
    const author = stripTags(
      block.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1] ||
        block.match(/<author[^>]*>([\s\S]*?)<\/author>/i)?.[1] ||
        ""
    );
    const imageUrl = extractImageUrl(block, description);

    items.push({
      id: itemId(link, title),
      title,
      link,
      author: author || undefined,
      summary: stripTags(description).slice(0, 500) || undefined,
      publishedAt: parseDate(pubDate),
      imageUrl,
    });
  }

  return { title: feedTitle, link: feedLink, items };
}

function parseAtom(xml: string): ParsedFeed {
  const feedTitle = stripTags(xml.match(/<feed[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Atom Feed");
  const feedLink = decodeEntities(
    xml.match(/<feed[\s\S]*?<link[^>]*href="([^"]+)"/i)?.[1] ||
      xml.match(/<feed[\s\S]*?<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ||
      ""
  );
  const items: ParsedFeedItem[] = [];
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml))) {
    const block = match[1];
    const title = stripTags(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Untitled");
    const link =
      extractAtomLink(block) ||
      decodeEntities(block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || "");
    if (!link) continue;
    const updated = block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1];
    const published = block.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1];
    const summary =
      block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ||
      block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ||
      "";
    const author = stripTags(block.match(/<name[^>]*>([\s\S]*?)<\/name>/i)?.[1] || "");
    const imageUrl = extractImageUrl(block, summary);

    items.push({
      id: itemId(link, title),
      title,
      link,
      author: author || undefined,
      summary: stripTags(summary).slice(0, 500) || undefined,
      publishedAt: parseDate(published || updated),
      imageUrl,
    });
  }

  return { title: feedTitle, link: feedLink, items };
}

export function parseFeedXml(xml: string): ParsedFeed {
  const normalized = xml.trim();
  if (/<feed[\s>]/i.test(normalized)) return parseAtom(normalized);
  return parseRss(normalized);
}

export function discoverFeedUrlFromHtml(html: string, siteUrl: string): string | null {
  const linkRegex = /<link[^>]+type=["'](application\/rss\+xml|application\/atom\+xml)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html))) {
    const tag = match[0];
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      return new URL(href, siteUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

export const COMMON_FEED_PATHS = ["/feed", "/rss", "/rss.xml", "/atom.xml", "/feed.xml", "/index.xml"];
