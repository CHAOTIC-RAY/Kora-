/**
 * Decorative-asset filtering for scraped manga pages.
 *
 * Why this exists. MangaRead (and sites built on the same WordPress theme)
 * serve their reader pages from the same upload directory as the site's own
 * chrome. A chapter scrape that walks every image on the page therefore picks
 * up reaction stickers, emoji and nav badges alongside the actual comic
 * pages. The evidence is in the 2026-10-01 diagnostic log: a "255 page"
 * chapter whose first fourteen pages were
 *
 *   sticker2-1.gif, sticker-2.gif, sticker1.webp, sticker.webp,
 *   758887120290578432.webp, boruto123.gif, crusader.gif,
 *   8c003218-….gif, 36-e1694464363798.webp, 47910middle.jpg, 94.gif,
 *   Anime_In_Love.gif, anime_boy_serious.gif, 2_Anime_zero_cansado.png,
 *   animated_shaqkiss.gif
 *
 * Every one of those failed to load, so the reader opened on a wall of
 * unavailable cards before reaching real art. Four of them are unambiguously
 * stickers (`sticker*`), and the rest are reaction art by the same taxonomy.
 *
 * The real fix is upstream: scrape the chapter's page container rather than
 * every `<img>` on the document. That is a scraper change and belongs with
 * the scraper. This is the cheap mitigation that keeps the reader usable
 * today, and it is deliberately conservative — a false positive here deletes
 * a page the user wanted, which is far worse than showing one sticker.
 */

/**
 * Basename patterns that mark a decorative asset rather than comic art.
 *
 * Matched as a prefix or a whole-token against the lowercased filename with
 * its extension stripped. Prefix matching (rather than substring) is what
 * keeps `sticker.webp` out while leaving a page called `stickers-shop.jpg`
 * alone. Each entry is anchored at a word boundary so `iconic-page-01.jpg`
 * is not mistaken for an icon.
 */
const DECORATIVE_STEMS: readonly string[] = [
  "sticker",
  "emoji",
  "emoticon",
  "smilie",
  "smiley",
  "icon",
  "badge",
  "banner",
  "button",
  "logo",
  "avatar",
  "sprite",
  "reaction",
  "spinner",
  "loader",
  "placeholder",
  "pixel",
  "throbber",
  "gravatar",
  "profile",
];

/**
 * Animated reaction art that MangaRead serves under content-hash names, so
 * there is no stem to match on. These are caught by shape instead: a small
 * GIF is a sticker in this corpus, a comic page is not.
 *
 * Kept separate from the stem list because the heuristic is genuinely
 * different in kind — it can be wrong — and the tests should say so.
 */
const ANIMATED_EXTENSIONS = /\.(gif|webp)$/i;

/**
 * Below this, an animated image is treated as decoration. Comic pages on
 * these scrapes are far larger; reaction GIFs are typically a few hundred
 * pixels on a side. The threshold is deliberately low so it only catches
 * the obvious cases.
 */
const SMALL_ANIMATED_MAX_EDGE = 320;

/** Pull the filename out of a URL or path, ignoring query and fragment. */
function basename(rawUrl: string): string {
  const withoutFragment = rawUrl.split("#")[0];
  const withoutQuery = withoutFragment.split("?")[0];
  const segments = withoutQuery.split("/");
  return segments[segments.length - 1] || "";
}

/** Lowercased filename with its extension removed. */
function stemOf(rawUrl: string): string {
  return basename(rawUrl).replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}

/**
 * True when the stem is one of the known decorative names.
 *
 * Word-boundary anchored: the stem must either equal the pattern or begin
 * with it followed by a non-alphanumeric character or a digit. So `sticker`,
 * `sticker2`, `sticker-2` and `sticker2-1` all match, while `stickers` and
 * `iconic` do not.
 */
function hasDecorativeStem(stem: string): boolean {
  return DECORATIVE_STEMS.some((word) => {
    if (stem === word) return true;
    if (!stem.startsWith(word)) return false;
    const next = stem.charAt(word.length);
    return next !== undefined && !/[a-z]/i.test(next);
  });
}

/**
 * Filename-only by design. At filter time we have the URL and nothing else —
 * no bytes, no dimensions — so any size-based rule would have to be a guess.
 * The animated heuristic below therefore keys off the extension plus an
 * explicit width/height *only when the caller already knows them*, which is
 * why it is a separate function rather than folded in here.
 */
export function isDecorativeAsset(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  const stem = stemOf(rawUrl);
  if (!stem) return false;
  return hasDecorativeStem(stem);
}

/**
 * Drop decorative assets from a scraped page list.
 *
 * Keys on `image` (the panel bitmap), not `url` (the chapter page it was
 * found on) — those are different fields and filtering on the wrong one
 * would compare every page against the same chapter URL.
 *
 * Order is preserved — page order is the whole point of the list, so this
 * filters rather than sorts.
 *
 * The all-decorative guard matters: if a scrape returns nothing *but*
 * stickers, the chapter is malformed, and showing those pages is a far better
 * outcome than the reader reporting "this chapter returned no page images"
 * and leaving the user with no way forward. Filtered-away pages are still
 * reachable through Retry on the failure card.
 */
export function filterDecorativePages<T extends { image: string }>(
  pages: readonly T[]
): T[] {
  if (!Array.isArray(pages) || pages.length === 0) return [];
  const kept = pages.filter((p) => !isDecorativeAsset(p?.image ?? ""));
  return kept.length > 0 ? kept : [...pages];
}

/**
 * The animated-sticker heuristic, for callers that have measured the asset.
 *
 * Deliberately NOT used by `isDecorativeAsset`, because it needs dimensions
 * and it can be wrong. Only apply it when a chapter scrape produced
 * something suspicious — an all-GIF chapter, or a chapter whose every page
 * failed — and never on a mixed chapter, where real art would be at risk.
 */
export function isLikelyStickerAnimation(
  rawUrl: string,
  width: number,
  height: number
): boolean {
  if (!ANIMATED_EXTENSIONS.test(rawUrl)) return false;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  return Math.max(width, height) <= SMALL_ANIMATED_MAX_EDGE;
}

export const DECORATIVE_STEMS_FOR_TEST = DECORATIVE_STEMS;
export const SMALL_ANIMATED_MAX_EDGE_FOR_TEST = SMALL_ANIMATED_MAX_EDGE;
