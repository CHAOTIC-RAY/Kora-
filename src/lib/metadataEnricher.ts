import { BookMetadata, syncBookToCloud } from "./firebase";

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\[source\]\s*\([^)]*\)/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function titleMatches(wanted: string, candidate: string): boolean {
  const a = normalize(wanted);
  const b = normalize(candidate);
  if (!a || !b) return false;
  if (a === b || b.startsWith(a + " ") || a.startsWith(b + " ")) return true;
  const wa = new Set(a.split(" ").filter((x) => x.length > 2));
  const wb = new Set(b.split(" ").filter((x) => x.length > 2));
  if (!wa.size || !wb.size) return false;
  const overlap = [...wa].filter((x) => wb.has(x)).length;
  return overlap / wa.size >= 0.8 && overlap / wb.size >= 0.65;
}

function candidateScore(title: string, author: string, info: any): number {
  const candidateTitle = String(info?.title || "");
  if (!titleMatches(title, candidateTitle)) return -100;
  let score = normalize(title) === normalize(candidateTitle) ? 10 : 5;
  const wantedAuthor = normalize(author);
  const authors = (Array.isArray(info?.authors) ? info.authors : []).map((x: unknown) => normalize(String(x)));
  if (wantedAuthor && authors.some((a: string) => a && (a.includes(wantedAuthor) || wantedAuthor.includes(a)))) score += 4;
  else if (wantedAuthor && authors.length) score -= 2;
  if (info?.description) score += 1;
  if (info?.imageLinks?.thumbnail) score += 1;
  return score;
}

/**
 * Enrich from independent catalogues. Search returns multiple candidates and
 * rejects unrelated editions instead of blindly trusting items[0]. Descriptions
 * are cleaned because provider pages often contain HTML/source annotations.
 */
export async function enrichBookMetadata(userId: string, book: BookMetadata): Promise<BookMetadata> {
  const cleanTitle = book.title.replace(/\.[^/.]+$/, "").trim();
  const author = String(book.author || "").trim();
  const enriched: BookMetadata = { ...book, progress: { ...book.progress }, tags: [...(book.tags || [])] };

  try {
    const query = encodeURIComponent("intitle:" + cleanTitle + (author ? " inauthor:" + author : ""));
    const response = await fetch("/api/google-books/search?q=" + query + "&maxResults=10");
    if (response.ok) {
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      const match = items
        .map((item: any) => ({ info: item?.volumeInfo, score: candidateScore(cleanTitle, author, item?.volumeInfo) }))
        .filter((x: any) => x.info && x.score >= 5)
        .sort((a: any, b: any) => b.score - a.score)[0]?.info;

      if (match) {
        if (!enriched.description && match.description) enriched.description = cleanText(match.description);
        if (!enriched.publisher && match.publisher) enriched.publisher = String(match.publisher).trim();
        if (!enriched.year && match.publishedDate) enriched.year = String(match.publishedDate).slice(0, 4);
        if (!enriched.progress.totalPages && Number(match.pageCount) > 0) enriched.progress.totalPages = Number(match.pageCount);
        if ((!enriched.language || enriched.language === "English") && match.language) enriched.language = String(match.language).toUpperCase();
        const cover = match.imageLinks?.thumbnail?.replace(/^http:/, "https:");
        if ((!enriched.coverUrl || /placeholder|cover-redirect/i.test(enriched.coverUrl)) && cover) enriched.coverUrl = cover;
        if (Array.isArray(match.categories)) {
          const tags = new Set(enriched.tags);
          match.categories.forEach((category: string) => String(category).split("/").map((s) => s.trim()).filter((s) => s.length > 1).forEach((s) => tags.add(s)));
          enriched.tags = [...tags];
        }
      }
    }
  } catch (error) {
    console.warn("[MetadataEnricher] Google Books unavailable; keeping existing metadata", error);
  }

  // NetGalley is a supplementary source only; never replace a valid description.
  try {
    const response = await fetch("/api/netgalley/book?title=" + encodeURIComponent(cleanTitle) + "&author=" + encodeURIComponent(author));
    if (response.ok) {
      const data = await response.json();
      const details = data?.details;
      if (details && (!details.title || titleMatches(cleanTitle, String(details.title)))) {
        if (!enriched.description && details.description) enriched.description = cleanText(details.description);
        if (!enriched.publisher && details.publisher) enriched.publisher = String(details.publisher).trim();
        if ((!enriched.coverUrl || /placeholder|cover-redirect/i.test(enriched.coverUrl)) && details.coverUrl) enriched.coverUrl = details.coverUrl;
      }
    }
  } catch {
    // Optional provider: the app remains usable when it is unavailable.
  }

  // Last-resort cover lookup by a validated ISBN only; avoid opaque catalogue IDs.
  if (!enriched.coverUrl || /placeholder|cover-redirect/i.test(enriched.coverUrl)) {
    try {
      const response = await fetch("https://openlibrary.org/search.json?title=" + encodeURIComponent(cleanTitle) + (author ? "&author=" + encodeURIComponent(author) : "") + "&limit=5");
      if (response.ok) {
        const data = await response.json();
        const docs = Array.isArray(data.docs) ? data.docs : [];
        const match = docs.find((doc: any) => titleMatches(cleanTitle, String(doc.title || "")) &&
          (!author || (doc.author_name || []).some((a: string) => titleMatches(author, a))));
        if (match?.cover_i) enriched.coverUrl = "https://covers.openlibrary.org/b/id/" + match.cover_i + "-L.jpg";
      }
    } catch {
      // Open Library is a best-effort fallback, not a hard dependency.
    }
  }

  if (JSON.stringify(enriched) !== JSON.stringify(book)) {
    enriched.dateModified = Date.now();
    await syncBookToCloud(userId, enriched);
    return enriched;
  }
  return book;
}
