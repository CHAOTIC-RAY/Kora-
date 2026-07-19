import { canonicalFeedItemId } from "./feedNormalize";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const TELEGRAM_HANDLE_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,64}$/;

export function parseTelegramChannelInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (raw.startsWith("@")) {
    const handle = raw.slice(1).trim();
    return TELEGRAM_HANDLE_RE.test(handle) ? handle : null;
  }

  if (/^telegram:/i.test(raw)) {
    const handle = raw.replace(/^telegram:/i, "").replace(/^\/+/, "").trim();
    return TELEGRAM_HANDLE_RE.test(handle) ? handle : null;
  }

  if (/^kora:\/\/telegram\//i.test(raw)) {
    const handle = raw.replace(/^kora:\/\/telegram\//i, "").split(/[/?#]/)[0];
    return TELEGRAM_HANDLE_RE.test(handle) ? handle : null;
  }

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "t.me" && host !== "telegram.me" && host !== "telegram.dog") {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;
    // skip /s/ preview prefix, invite links (+…), joinchat
    let idx = 0;
    if (parts[0]?.toLowerCase() === "s") idx = 1;
    if (parts[0]?.toLowerCase() === "joinchat") return null;
    if (parts[idx]?.startsWith("+")) return null;
    const handle = parts[idx];
    if (!handle || !TELEGRAM_HANDLE_RE.test(handle)) return null;
    return handle;
  } catch {
    return null;
  }
}

export function telegramFeedUrl(username: string): string {
  return `kora://telegram/${username}`;
}

export function isTelegramFeedUrl(feedUrl: string): boolean {
  return /^kora:\/\/telegram\//i.test(feedUrl);
}

export function isTelegramArticleLink(link: string): boolean {
  try {
    const host = new URL(link).hostname.replace(/^www\./, "").toLowerCase();
    return host === "t.me" || host === "telegram.me" || host === "telegram.dog";
  } catch {
    return false;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function extractBackgroundImage(style: string | undefined): string | undefined {
  if (!style) return undefined;
  const match = style.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
  return match?.[1] || undefined;
}

function extractChannelTitle(html: string, username: string): string {
  const og =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
  if (og) return decodeEntities(og).replace(/\s+/g, " ").trim();
  const pageTitle = html.match(/<div[^>]+class=["'][^"']*tgme_channel_info_header_title[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1];
  if (pageTitle) return stripTags(pageTitle) || username;
  return username;
}

export async function discoverTelegramChannel(input: string): Promise<{
  title: string;
  siteUrl: string;
  feedUrl: string;
} | null> {
  const username = parseTelegramChannelInput(input);
  if (!username) return null;

  const previewUrl = `https://t.me/s/${username}`;
  const response = await fetch(previewUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Telegram channel not reachable (HTTP ${response.status})`);
  }
  const html = await response.text();
  if (!/tgme_widget_message/i.test(html)) {
    throw new Error(
      "No public posts found. Only public Telegram channels with web preview enabled can be added."
    );
  }

  const title = extractChannelTitle(html, username);
  return {
    title: title.includes("Telegram") ? `@${username}` : title,
    siteUrl: `https://t.me/${username}`,
    feedUrl: telegramFeedUrl(username),
  };
}

export async function fetchTelegramChannelFeed(feedUrl: string): Promise<{
  title: string;
  link: string;
  items: Array<{
    id: string;
    title: string;
    link: string;
    author?: string;
    summary?: string;
    publishedAt: number;
    imageUrl?: string;
  }>;
}> {
  const username = parseTelegramChannelInput(feedUrl);
  if (!username) throw new Error(`Invalid Telegram feed: ${feedUrl}`);

  const previewUrl = `https://t.me/s/${username}`;
  const response = await fetch(previewUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Telegram fetch failed: HTTP ${response.status}`);
  const html = await response.text();

  const title = extractChannelTitle(html, username);
  const postMatches = [
    ...html.matchAll(
      /data-post=["']([^"']+)["'][\s\S]*?(?=data-post=["']|<\/section>|$)/gi
    ),
  ];

  // Prefer widget blocks when available
  const widgetChunks =
    html.match(
      /<div[^>]+class="[^"]*tgme_widget_message[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*tgme_widget_message[^"]*"|<\/section>|$)/gi
    ) || [];

  const blocks = widgetChunks.length ? widgetChunks : postMatches.map((m) => m[0]);

  const items = blocks
    .map((block) => {
      const dataPost = block.match(/data-post=["']([^"']+)["']/i)?.[1];
      if (!dataPost) return null;
      const [channel, messageId] = dataPost.split("/");
      if (!messageId || (channel && channel.toLowerCase() !== username.toLowerCase())) {
        // still accept if channel missing match (renamed handles rare)
        if (!messageId) return null;
      }

      const textHtml =
        block.match(
          /<div[^>]+class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i
        )?.[1] || "";
      const text = stripTags(textHtml);
      const datetime = block.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
      const publishedAt = datetime ? Date.parse(datetime) : Date.now();
      const photoStyle =
        block.match(
          /<a[^>]+class="[^"]*tgme_widget_message_photo_wrap[^"]*"[^>]*style=["']([^"']+)["']/i
        )?.[1] ||
        block.match(
          /style=["']([^"']*background-image[^"']*)["'][^>]*class=["'][^"']*tgme_widget_message_photo/i
        )?.[1];
      const imageUrl = extractBackgroundImage(photoStyle);

      const titleLine = text.split(/(?<=[.!?])\s+/)[0]?.slice(0, 140) || `Post #${messageId}`;
      const link = `https://t.me/${username}/${messageId}`;

      return {
        id: canonicalFeedItemId(link),
        title: titleLine || `Post #${messageId}`,
        link,
        author: title,
        summary: text.slice(0, 800) || undefined,
        publishedAt: Number.isNaN(publishedAt) ? Date.now() : publishedAt,
        imageUrl,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    title: string;
    link: string;
    author?: string;
    summary?: string;
    publishedAt: number;
    imageUrl?: string;
  }>;

  // Newest first
  items.sort((a, b) => b.publishedAt - a.publishedAt);

  if (!items.length) {
    throw new Error("This Telegram channel has no public preview posts.");
  }

  return {
    title,
    link: `https://t.me/${username}`,
    items: items.slice(0, 40),
  };
}

/** Build readable HTML for a Telegram post from feed summary/title. */
export function telegramPostHtml(item: {
  title: string;
  summary?: string;
  imageUrl?: string;
  link: string;
}): string {
  const paragraphs = (item.summary || item.title || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");

  const image = item.imageUrl
    ? `<p><img src="${escapeHtml(item.imageUrl)}" alt="" /></p>`
    : "";

  return `${image}${paragraphs || `<p>${escapeHtml(item.title)}</p>`}<p><a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">Open in Telegram</a></p>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
