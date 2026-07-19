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
  const xml = await fetchText(feedUrl);
  const feed = parseFeedXml(xml);
  return {
    title: feed.title,
    link: feed.link,
    items: feed.items.slice(0, 50),
  };
}
