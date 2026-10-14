/**
 * Shareable book links.
 *
 * One canonical deep link format used by every share surface in the app:
 *   https://kora.chaoticstudio.workers.dev/book?id=<id>&q=<title author>
 *
 * `id` lets the receiver jump straight to the exact book when it can be
 * resolved; `q` is the search query, so when the id is unknown locally the
 * receiver can at least search Discover for the title + author.
 */

const KORA_ORIGIN = "https://kora.chaoticstudio.workers.dev";

export interface ShareableBookLike {
  id?: string | null;
  md5?: string | null;
  downloadId?: string | null;
  title?: string | null;
  author?: string | null;
}

/** Filesystem/URL-safe version of a search query. */
function buildQueryText(title: string, author?: string | null): string {
  return `${title || ""} ${author || ""}`.trim();
}

/** The canonical deep link for a book. */
export function buildBookDeepLink(book: ShareableBookLike): string {
  const id = book.id || book.md5 || book.downloadId || "";
  const title = (book.title || "").trim();
  const author = (book.author || "").trim();
  const q = buildQueryText(title, author);
  // URLSearchParams does the percent-encoding for us; encoding here as well
  // would double-encode and the receiver would decode to a mangled query.
  const params = new URLSearchParams();
  if (id) params.set("id", id);
  // Title and author travel separately so the receiver can open the book's
  // detail view directly, without a search round-trip that may return the
  // wrong book entirely. `q` stays for search fallback + older links.
  if (title) params.set("t", title);
  if (author) params.set("a", author);
  if (q && q !== title) params.set("q", q);
  return `${KORA_ORIGIN}/book?${params.toString()}`;
}

/** Parsed pieces of a shared book link. */
export interface ParsedBookLink {
  id: string;
  query: string;
  title: string;
  author: string;
}

/**
 * Read a shared book link out of a full URL (or a bare path+query).
 * Returns null when the URL is not a Kora book link.
 */
export function parseBookLink(url: string): ParsedBookLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url, KORA_ORIGIN);
  } catch {
    return null;
  }
  const isBookPath = /^\/book\/?$/.test(parsed.pathname);
  if (!isBookPath) return null;
  const id = parsed.searchParams.get("id") || "";
  const query = parsed.searchParams.get("q") || "";
  // Older links only carried `q` (title + author mashed together); newer ones
  // carry `t` and `a` separately so no parsing guesswork is needed.
  const title = parsed.searchParams.get("t") || "";
  const author = parsed.searchParams.get("a") || "";
  if (!id && !query && !title) return null;
  return { id, query, title, author };
}

/** Promo blurb used when a book link is shared as text. */
export function buildBookPromoText(book: ShareableBookLike): string {
  const link = buildBookDeepLink(book);
  const author = book.author ? ` by ${book.author}` : "";
  return `“${book.title || "a book"}”${author}\n\nFind it and thousands more free on Kora:\n${link}`;
}

/**
 * Share a book link using the platform share sheet, falling back to copying
 * the text. Used by Discover, where there is no local file to attach — the
 * receiver is sent to Kora to get the book.
 */
export async function shareBookLink(book: ShareableBookLike): Promise<void> {
  const text = buildBookPromoText(book);
  const link = buildBookDeepLink(book);
  const title = book.title || "Kora";

  // Native (APK) share sheet.
  try {
    const { Share } = await import("@capacitor/share");
    await Share.share({ title, text, url: link, dialogTitle: "Share book" });
    return;
  } catch (err) {
    console.warn("[Kora/Share] native link share failed, trying web", err);
  }

  // Web share sheet.
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url: link });
      return;
    }
  } catch (err: any) {
    if (err?.name === "AbortError") return; // user cancelled
  }

  // Last resort: copy the promo text (which contains the link).
  try {
    await navigator.clipboard.writeText(text);
    alert("Book link copied to clipboard");
  } catch {
    alert("Couldn't share this book.");
  }
}
