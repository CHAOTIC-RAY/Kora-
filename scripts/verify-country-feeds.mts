/**
 * Live check every curated country feed.
 *
 * Feeds rot silently — a dead feed shows an empty Local tab with no error.
 * Run this to find which ones to replace.
 *
 *   npx tsx scripts/verify-country-feeds.mts
 */
import { COUNTRY_FEEDS, WORLDWIDE_FEEDS } from "../src/lib/countryFeeds";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

async function check(url: string): Promise<string> {
  if (url.startsWith("kora://")) return "local"; // Kora scrapes these itself
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "User-Agent": UA } });
    const body = await r.text();
    // 403/404 pages still return a body, so require real feed markup too.
    const looksLikeFeed = /<rss|<feed|<entry\b|<item\b/i.test(body);
    if (!r.ok) return `HTTP ${r.status}`;
    if (!looksLikeFeed) return `not feed (${body.length}b)`;
    return `ok ${body.length}b`;
  } catch (e) {
    return e instanceof Error && e.name === "AbortError" ? "timeout" : "error";
  } finally {
    clearTimeout(t);
  }
}

let bad = 0;
for (const group of [{ code: "WW", name: "Worldwide", feeds: WORLDWIDE_FEEDS }, ...COUNTRY_FEEDS]) {
  const results: string[] = [];
  for (const f of group.feeds) {
    const status = await check(f.feedUrl);
    const good = status.startsWith("ok") || status === "local";
    if (!good) bad++;
    results.push(`${good ? " " : "!"} ${f.title}: ${status}`);
  }
  console.log(`\n== ${group.code} ${group.name}`);
  for (const r of results) console.log(`  ${r}`);
}
console.log(`\nSUMMARY ${bad} broken feed(s) across ${COUNTRY_FEEDS.length} countries`);
