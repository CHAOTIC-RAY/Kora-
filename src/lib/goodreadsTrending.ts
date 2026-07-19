import * as cheerio from "cheerio";

let trendingCache: any[] | null = null;
let trendingCacheDate = "";

export const GOODREADS_TRENDING_FALLBACK = [
  { rank: 1, title: "The Calamity Club", author: "Kathryn Stockett", description: "Trending #1 on Goodreads this week — the highly anticipated new novel from the author of The Help.", rating: 4.2, ratingCount: "Trending on Goodreads", goodreadsId: "", source: "goodreads" },
  { rank: 2, title: "Yesteryear", author: "Caro Claire Burke", description: "Trending #2 on Goodreads — also the NYT #1 Hardcover Fiction bestseller this week.", rating: 4.1, ratingCount: "Trending on Goodreads", goodreadsId: "", source: "goodreads" },
  { rank: 3, title: "The Correspondent", author: "Virginia Evans", description: "Trending #3 on Goodreads this week.", rating: 4.0, ratingCount: "Trending on Goodreads", goodreadsId: "", source: "goodreads" },
  { rank: 4, title: "Whistler", author: "Ann Patchett", description: "Trending #4 on Goodreads — the latest novel from beloved author Ann Patchett.", rating: 4.1, ratingCount: "Trending on Goodreads", goodreadsId: "", source: "goodreads" },
  { rank: 5, title: "Dolly All the Time", author: "Annabel Monaghan", description: "Trending #5 on Goodreads — a GMA Book Club Pick and instant NYT bestseller.", rating: 4.0, ratingCount: "Trending on Goodreads", goodreadsId: "", source: "goodreads" },
  { rank: 6, title: "Theo of Golden", author: "Allen Levi", description: "Trending #6 on Goodreads — a national bestseller about faith, community, and a small-town coffee shop.", rating: 4.3, ratingCount: "Trending on Goodreads", goodreadsId: "", source: "goodreads" },
  { rank: 7, title: "The Shampoo Effect", author: "Jenny Jackson", description: "Trending #7 on Goodreads this week — from the author of Pineapple Street.", rating: 4.0, ratingCount: "Trending on Goodreads", goodreadsId: "", source: "goodreads" },
  { rank: 8, title: "Heart the Lover", author: "Lily King", description: "Trending #8 on Goodreads — an instant NYT bestseller and PEN/Faulkner Award finalist.", rating: 4.1, ratingCount: "Trending on Goodreads", goodreadsId: "", source: "goodreads" },
];

export function mapGoodreadsTrendingFallback() {
  return GOODREADS_TRENDING_FALLBACK.map((b) => ({
    ...b,
    coverUrl: `/api/cover-redirect?title=${encodeURIComponent(b.title)}&author=${encodeURIComponent(b.author)}`,
  }));
}

export async function fetchGoodreadsTrendingBooks(
  fetchHtml: (url: string, marker?: string) => Promise<string>
): Promise<any[]> {
  const today = new Date().toISOString().split("T")[0];
  if (trendingCache && trendingCacheDate === today) {
    return trendingCache;
  }

  try {
    const html = await fetchHtml("https://www.goodreads.com/book/most_read", "bookTitle");
    const $ = cheerio.load(html);
    const books: any[] = [];

    $("tr[itemtype='http://schema.org/Book'], tr[itemscope][itemtype*='Book']").each((_idx, el) => {
      if (books.length >= 12) return false as any;
      const row = $(el);

      const titleAnchor = row.find("a.bookTitle").first();
      const title = titleAnchor.find("span[itemprop='name']").text().trim() || titleAnchor.text().trim();
      if (!title) return;

      const author = row.find("a.authorName span[itemprop='name']").first().text().trim()
        || row.find("a.authorName").first().text().trim();

      let coverUrl = row.find("img.bookCover, img[itemprop='image']").attr("src") || null;
      if (coverUrl) {
        coverUrl = coverUrl.replace(/\._SY\d+_\./, "._SY475_.");
      }
      if (coverUrl && (coverUrl.includes("nophoto") || coverUrl.includes("nocover"))) {
        coverUrl = null;
      }

      const ratingText = row.find("span.minirating").text().trim();
      let rating = 4.0;
      const ratingMatch = ratingText.match(/([\d.]+)\s*avg/i);
      if (ratingMatch) rating = parseFloat(ratingMatch[1]);

      const bookPath = titleAnchor.attr("href") || "";
      const idMatch = bookPath.match(/\/book\/show\/(\d+)/);
      const goodreadsId = idMatch ? idMatch[1] : "";

      books.push({
        rank: books.length + 1,
        title,
        author,
        description: "Currently trending on Goodreads — one of the most-read books this week.",
        rating,
        ratingCount: "Trending this week",
        coverUrl: coverUrl || `/api/cover-redirect?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author || "")}`,
        goodreadsId,
        source: "goodreads",
      });
    });

    if (books.length >= 3) {
      trendingCache = books;
      trendingCacheDate = today;
      return books;
    }
    throw new Error(`Only ${books.length} books parsed`);
  } catch (err: any) {
    console.warn("[Goodreads Trending] Scrape failed:", err.message);
    return [];
  }
}
