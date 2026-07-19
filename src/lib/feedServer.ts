import { COMMON_FEED_PATHS, discoverFeedUrlFromHtml, parseFeedXml } from "./rssParser";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

function isFeedUrl(url: string): boolean {
  return /(\/feed|\.rss|\.xml|\.atom)(\/|$|\?)/i.test(url) || /rss|atom/i.test(url);
}

export async function discoverFeedFromUrl(inputUrl: string): Promise<{
  title: string;
  siteUrl: string;
  feedUrl: string;
}> {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (isFeedUrl(parsed.toString())) {
    const xml = await fetchText(parsed.toString());
    const feed = parseFeedXml(xml);
    return {
      title: feed.title,
      siteUrl: feed.link || parsed.origin,
      feedUrl: parsed.toString(),
    };
  }

  const html = await fetchText(parsed.toString());
  const discovered = discoverFeedUrlFromHtml(html, parsed.toString());
  if (discovered) {
    const xml = await fetchText(discovered);
    const feed = parseFeedXml(xml);
    return {
      title: feed.title,
      siteUrl: parsed.toString(),
      feedUrl: discovered,
    };
  }

  for (const suffix of COMMON_FEED_PATHS) {
    try {
      const candidate = new URL(suffix, parsed.origin).toString();
      const xml = await fetchText(candidate);
      if (/<(rss|feed|channel|entry|item)[\s>]/i.test(xml)) {
        const feed = parseFeedXml(xml);
        return {
          title: feed.title,
          siteUrl: parsed.toString(),
          feedUrl: candidate,
        };
      }
    } catch {
      // try next path
    }
  }

  throw new Error("No RSS or Atom feed found for this site");
}

export async function fetchFeedFromUrl(feedUrl: string) {
  if (feedUrl.startsWith("kora://")) {
    return fetchCustomFeed(feedUrl);
  }

  const xml = await fetchText(feedUrl);
  const feed = parseFeedXml(xml);
  return {
    title: feed.title,
    link: feed.link,
    items: feed.items.slice(0, 50),
  };
}

function parseDateLoose(value?: string): number {
  if (!value) return Date.now();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function extractArticlesFromEditionPayload(data: unknown, found: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (!data || typeof data !== "object") return found;
  if (Array.isArray(data)) {
    for (const entry of data) extractArticlesFromEditionPayload(entry, found);
    return found;
  }

  const record = data as Record<string, unknown>;
  if (typeof record.headline === "string" && typeof record.article_url === "string") {
    found.push(record);
  }

  for (const value of Object.values(record)) {
    extractArticlesFromEditionPayload(value, found);
  }
  return found;
}

async function fetchEditionMvFeed(): Promise<{ title: string; link: string; items: ReturnType<typeof mapCustomItem>[] }> {
  const html = await fetchText("https://edition.mv/");
  const payloadMatch = html.match(/href="(\/_payload\.json[^"]+)"/i);
  const payloadPath = payloadMatch?.[1] || "/_payload.json";
  const payloadUrl = new URL(payloadPath, "https://edition.mv/").toString();
  const payloadRaw = await fetchText(payloadUrl);
  const payload = JSON.parse(payloadRaw) as unknown;
  const articles = extractArticlesFromEditionPayload(payload);

  const seen = new Set<string>();
  const items = articles
    .filter((article) => {
      const url = String(article.article_url || "");
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, 40)
    .map((article) => {
      const media = Array.isArray(article.media) ? article.media[0] as Record<string, unknown> | undefined : undefined;
      const photo = media?.photo as Record<string, unknown> | undefined;
      const variants = photo?.variants as Record<string, string> | undefined;
      const imageUrl =
        (media?.proxy_file_url as string | undefined) ||
        variants?.large ||
        variants?.medium ||
        (photo?.public_file as string | undefined);

      return mapCustomItem({
        title: String(article.headline || "Untitled"),
        link: String(article.article_url).startsWith("http")
          ? String(article.article_url)
          : new URL(String(article.article_url), "https://edition.mv/").toString(),
        summary: typeof article.summary === "string" ? article.summary : undefined,
        publishedAt: parseDateLoose(String(article.datetime || article.created_at || "")),
        imageUrl: typeof imageUrl === "string" ? imageUrl.replace(/\\u002F/g, "/") : undefined,
      });
    });

  return { title: "Edition", link: "https://edition.mv/", items };
}

async function fetchMihaaruFeed(): Promise<{ title: string; link: string; items: ReturnType<typeof mapCustomItem>[] }> {
  const response = await fetch("https://mihaaru.com/api/search?q=2026&per_page=25", {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Mihaaru API failed: HTTP ${response.status}`);
  const data = await response.json() as { hits?: Array<Record<string, unknown>> };
  const hits = data.hits || [];

  const items = hits.map((hit) => {
    const media = Array.isArray(hit.media) ? hit.media[0] as Record<string, unknown> | undefined : undefined;
    const photo = media?.photo as Record<string, unknown> | undefined;
    const variants = photo?.variants as Record<string, string> | undefined;
    const imageUrl =
      (media?.proxy_file_url as string | undefined) ||
      variants?.large ||
      variants?.medium ||
      (photo?.public_file as string | undefined);

    const title = String(hit.latin_headline || hit.short_headline || hit.headline || "Untitled");
    const link = hit.article_url
      ? String(hit.article_url).startsWith("http")
        ? String(hit.article_url)
        : `https://mihaaru.com${String(hit.article_url)}`
      : `https://mihaaru.com/${hit.id}`;

    return mapCustomItem({
      title,
      link,
      summary: typeof hit.summary === "string" ? hit.summary : undefined,
      publishedAt: parseDateLoose(String(hit.datetime || hit.created_at || "")),
      imageUrl: typeof imageUrl === "string" ? imageUrl : undefined,
    });
  });

  return { title: "Mihaaru", link: "https://mihaaru.com/", items };
}

function mapCustomItem(item: {
  title: string;
  link: string;
  summary?: string;
  publishedAt: number;
  imageUrl?: string;
  author?: string;
}) {
  return {
    id: `${item.link}::${item.title}`.slice(0, 240),
    title: item.title,
    link: item.link,
    author: item.author,
    summary: item.summary?.slice(0, 500),
    publishedAt: item.publishedAt,
    imageUrl: item.imageUrl,
  };
}

async function fetchCustomFeed(feedUrl: string) {
  const path = feedUrl.replace("kora://", "");
  if (path.startsWith("edition.mv/")) return fetchEditionMvFeed();
  if (path.startsWith("mihaaru.com/")) return fetchMihaaruFeed();
  throw new Error(`Unknown custom feed: ${feedUrl}`);
}

function metaContent(html: string, property: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

export async function fetchArticlePreview(articleUrl: string): Promise<{
  title?: string;
  description?: string;
  imageUrl?: string;
  author?: string;
  siteName?: string;
}> {
  const html = await fetchText(articleUrl);
  const title =
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description =
    metaContent(html, "og:description") ||
    metaContent(html, "twitter:description") ||
    metaContent(html, "description");
  const imageUrl = metaContent(html, "og:image") || metaContent(html, "twitter:image");
  const author = metaContent(html, "author") || metaContent(html, "article:author");
  const siteName = metaContent(html, "og:site_name");

  let resolvedImage = imageUrl;
  if (imageUrl) {
    try {
      resolvedImage = new URL(imageUrl, articleUrl).toString();
    } catch {
      resolvedImage = imageUrl;
    }
  }

  return {
    title: title?.replace(/\s+/g, " ").slice(0, 300),
    description: description?.replace(/\s+/g, " ").slice(0, 500),
    imageUrl: resolvedImage,
    author,
    siteName,
  };
}

export async function proxyFeedImage(imageUrl: string): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return new Response("Bad protocol", { status: 400 });
  }

  const upstream = await fetch(parsed.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*",
      Referer: `${parsed.protocol}//${parsed.hostname}/`,
    },
    redirect: "follow",
  });

  if (!upstream.ok) {
    return new Response("Upstream error", { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    return new Response("Not an image", { status: 415 });
  }

  const outHeaders = new Headers();
  outHeaders.set("Content-Type", contentType);
  outHeaders.set("Cache-Control", "public, max-age=86400");
  outHeaders.set("Access-Control-Allow-Origin", "*");
  return new Response(upstream.body, { status: 200, headers: outHeaders });
}
