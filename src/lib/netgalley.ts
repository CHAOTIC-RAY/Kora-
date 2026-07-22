import * as cheerio from "cheerio";

export interface NetgalleyBookResult {
  bookId: string;
  title: string;
  author: string;
  publisher?: string;
  description?: string;
  coverUrl: string;
  netgalleyUrl: string;
  isAudiobook?: boolean;
}

/**
 * Searches the NetGalley catalog (https://www.netgalley.com/catalog) for book/audiobook metadata and covers.
 */
export async function searchNetgalleyCatalog(
  query: string,
  options?: { isAudiobook?: boolean; limit?: number }
): Promise<NetgalleyBookResult[]> {
  const limit = options?.limit || 5;
  const isAudiobook = options?.isAudiobook || false;

  const searchQuery = isAudiobook && !query.toLowerCase().includes("audiobook")
    ? `${query} audiobook`
    : query;

  const searchUrl = `https://www.netgalley.com/catalog?q=${encodeURIComponent(searchQuery)}`;

  try {
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });

    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    const results: NetgalleyBookResult[] = [];
    const seenIds = new Set<string>();

    $("a[href*='/catalog/book/'], a[href*='/catalog/title/'], a[href*='/catalog/audiobook/']").each((_, el) => {
      if (results.length >= limit) return;

      const href = $(el).attr("href") || "";
      const match = href.match(/\/catalog\/(?:book|title|audiobook)\/(\d+)/);
      const bookId = match ? match[1] : null;

      if (!bookId || seenIds.has(bookId)) return;

      const parent = $(el).closest(".col, .card, tr, li, div[class*='col'], .title-card, .book-card");
      const cardTitle = parent.find(".title, .title-link, h3, h4, strong, a").first().text().trim() || $(el).attr("title") || "";
      const cardAuthor = parent.find(".author, .by-author, .author-name, span.small").text().trim().replace(/^by\s+/i, "");
      const cardPub = parent.find(".publisher, .pub-name, .publisher-name").text().trim();
      const cardDesc = parent.find(".description, .synopsis, p").text().trim();

      const coverUrl = `https://covers.bksh.co/cover${bookId}-large.png`;
      seenIds.add(bookId);

      results.push({
        bookId,
        title: cardTitle || query,
        author: cardAuthor,
        publisher: cardPub,
        description: cardDesc,
        coverUrl,
        netgalleyUrl: `https://www.netgalley.com${href}`,
        isAudiobook: isAudiobook || href.includes("audiobook")
      });
    });

    return results;
  } catch (error) {
    console.error("[NetGalley] Catalog search error:", error);
    return [];
  }
}

/**
 * Fetches a single best-matching NetGalley cover URL for a given title/author.
 */
export async function getNetgalleyCoverUrl(
  title: string,
  author?: string,
  options?: { isAudiobook?: boolean }
): Promise<string | null> {
  if (!title) return null;

  const cleanTitle = title.replace(/\.[^/.]+$/, "").replace(/\baudiobook\b/gi, "").trim();
  const query = author ? `${cleanTitle} ${author}` : cleanTitle;

  const results = await searchNetgalleyCatalog(query, {
    isAudiobook: options?.isAudiobook,
    limit: 3
  });

  if (results.length > 0) {
    return results[0].coverUrl;
  }

  // Fallback try title alone
  if (author) {
    const titleOnlyResults = await searchNetgalleyCatalog(cleanTitle, {
      isAudiobook: options?.isAudiobook,
      limit: 1
    });
    if (titleOnlyResults.length > 0) {
      return titleOnlyResults[0].coverUrl;
    }
  }

  return null;
}

/**
 * Fetches detailed book metadata from NetGalley.
 */
export interface NetgalleyCategory {
  id: string;
  name: string;
  path: string;
  type?: "audiobook" | "drc" | "category";
}

export const NETGALLEY_CATEGORIES: NetgalleyCategory[] = [
  { id: "recentlyAddedAudiobooks", name: "Recently Added Audiobooks", path: "/catalog/recentlyAddedAudiobooks", type: "audiobook" },
  { id: "mostRequestedAudiobooks", name: "Most Requested Audiobooks", path: "/catalog/mostRequestedAudiobooks", type: "audiobook" },
  { id: "recentlyAddedDRCs", name: "Recently Added Books", path: "/catalog/recentlyAddedDRCs", type: "drc" },
  { id: "mostRequested", name: "Most Requested Books", path: "/catalog/mostRequested", type: "drc" },
  { id: "16", name: "Mystery & Thrillers", path: "/catalog/category/16", type: "category" },
  { id: "22", name: "Sci-Fi & Fantasy", path: "/catalog/category/22", type: "category" },
  { id: "41", name: "Horror", path: "/catalog/category/41", type: "category" },
  { id: "21", name: "Romance", path: "/catalog/category/21", type: "category" },
  { id: "35", name: "General Fiction (Adult)", path: "/catalog/category/35", type: "category" },
  { id: "46", name: "Historical Fiction", path: "/catalog/category/46", type: "category" },
  { id: "43", name: "Literary Fiction", path: "/catalog/category/43", type: "category" },
  { id: "27", name: "Young Adult", path: "/catalog/category/27", type: "category" },
  { id: "6", name: "Comics, Graphic Novels, Manga", path: "/catalog/category/6", type: "category" },
  { id: "2", name: "Biographies & Memoirs", path: "/catalog/category/2", type: "category" },
  { id: "3", name: "Business & Finance", path: "/catalog/category/3", type: "category" },
  { id: "8", name: "Cooking, Food & Wine", path: "/catalog/category/8", type: "category" },
  { id: "13", name: "History", path: "/catalog/category/13", type: "category" },
  { id: "11", name: "LGBTQIAP+", path: "/catalog/category/11", type: "category" },
  { id: "1", name: "Arts & Photography", path: "/catalog/category/1", type: "category" },
  { id: "37", name: "Children's Fiction", path: "/catalog/category/37", type: "category" },
  { id: "44", name: "Middle Grade", path: "/catalog/category/44", type: "category" }
];

/**
 * Returns available NetGalley catalog categories
 */
export function getNetgalleyCategories(): NetgalleyCategory[] {
  return NETGALLEY_CATEGORIES;
}

/**
 * Scrapes book and audiobook listings from a NetGalley category or section URL
 */
export async function fetchNetgalleyCategoryListings(
  catPathOrId: string,
  limit = 24
): Promise<NetgalleyBookResult[]> {
  let targetPath = catPathOrId;
  if (!targetPath.startsWith("/")) {
    const matched = NETGALLEY_CATEGORIES.find((c) => c.id === catPathOrId);
    targetPath = matched ? matched.path : `/catalog/category/${catPathOrId}`;
  }

  const url = `https://www.netgalley.com${targetPath}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    const results: NetgalleyBookResult[] = [];
    const seenIds = new Set<string>();

    $("a[href*='/catalog/book/']").each((_, el) => {
      if (results.length >= limit) return;

      const href = $(el).attr("href") || "";
      const match = href.match(/\/catalog\/book\/(\d+)/);
      const bookId = match ? match[1] : null;

      if (!bookId || seenIds.has(bookId)) return;

      const imgAlt = $(el).find("img").attr("alt") || "";
      let title = "";
      if (imgAlt.toLowerCase().startsWith("book cover for ")) {
        title = imgAlt.replace(/^book cover for\s+/i, "").trim();
      }

      const parent = $(el).closest(
        ".card, .title-card, .book-card, .carousel-1-book, div[class*='col'], tr, li"
      );

      if (!title) {
        title =
          parent.find(".headline [itemprop='name'], a.headline, [itemprop='name'], .title, h3, h4")
            .first()
            .text()
            .trim() || $(el).attr("title") || "";
      }

      const author =
        parent
          .find("[itemprop='author'] [itemprop='name'], .author, .by-author, .author-name, span.small")
          .first()
          .text()
          .trim()
          .replace(/^by\s+/i, "") || "";

      const publisher = parent
        .find("[itemprop='publisher'] [itemprop='name'], .publisher, .pub-name")
        .first()
        .text()
        .trim();

      const coverUrl = `https://covers.bksh.co/cover${bookId}-large.png`;
      seenIds.add(bookId);

      if (title || bookId) {
        results.push({
          bookId,
          title: title || `NetGalley Book #${bookId}`,
          author,
          publisher,
          coverUrl,
          netgalleyUrl: `https://www.netgalley.com${href}`,
          isAudiobook: targetPath.toLowerCase().includes("audiobook") || href.includes("audiobook")
        });
      }
    });

    return results;
  } catch (error) {
    console.error(`[NetGalley] Category fetch error for ${targetPath}:`, error);
    return [];
  }
}

/**
 * Fetches details for a NetGalley book by title/author
 */
export async function getNetgalleyBookDetails(title: string, author?: string) {
  const results = await searchNetgalleyCatalog(author ? `${title} ${author}` : title, { limit: 1 });
  return results.length > 0 ? results[0] : null;
}

