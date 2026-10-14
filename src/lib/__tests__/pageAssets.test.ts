/**
 * Decorative-asset filter tests.
 *
 * The load-bearing claim: this filter must delete site chrome and keep comic
 * art. A false positive here silently removes a page the user wanted, which
 * is worse than the sticker problem it solves — so most of these cases are
 * "must NOT match" rather than "must match".
 *
 * The URLs are lifted verbatim from the 2026-10-01 diagnostic log, so the
 * suite fails if the scraper's output shape changes underneath it.
 */
import {
  isDecorativeAsset,
  isLikelyStickerAnimation,
  filterDecorativePages,
  DECORATIVE_STEMS_FOR_TEST,
  SMALL_ANIMATED_MAX_EDGE_FOR_TEST,
} from "../pageAssets";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL  ${name}\n        expected ${expected}, got ${actual}`);
  }
}

// ── The exact assets that broke the reader ────────────────────────────────
// From the "255 page" chapter in the 2026-10-01 log.
const FROM_LOG_STICKERS = [
  "https://www.mangaread.org/wp-content/uploads/2026/03/sticker2-1.gif",
  "https://www.mangaread.org/wp-content/uploads/2026/03/sticker-2.gif",
  "https://www.mangaread.org/wp-content/uploads/2026/03/sticker1.webp",
  "https://www.mangaread.org/wp-content/uploads/2026/03/sticker.webp",
];

for (const url of FROM_LOG_STICKERS) {
  check(`log sticker removed: ${url.split("/").pop()}`, isDecorativeAsset(url), true);
}

// ── Real comic pages must survive ──────────────────────────────────────────
// Also from the log: these are genuine art that the reader must keep.
const FROM_LOG_REAL_PAGES = [
  "https://www.mangaread.org/wp-content/uploads/2023/07/47910middle.jpg",
  "https://www.mangaread.org/wp-content/uploads/2023/05/94.gif",
  "https://www.mangaread.org/wp-content/uploads/2023/03/Anime_In_Love.gif",
  "https://www.mangaread.org/wp-content/uploads/2023/03/anime_boy_serious.gif",
  "https://www.mangaread.org/wp-content/uploads/2023/03/2_Anime_zero_cansado.png",
  "https://www.mangaread.org/wp-content/uploads/2022/10/nyaKnife.png",
  "https://cdn.manhuahot.com/manga_61483453bd983/8da463e32534afe0c07d3f5d5d478c91/1-(2)-copy.jpg",
  "https://cdn-2.mangazin.org/manga_0d7d20d04b2e3f243730b0e2bc4700dc/chapter_0/ch_0_75.jpg",
];

for (const url of FROM_LOG_REAL_PAGES) {
  check(`real page kept: ${url.split("/").pop()}`, isDecorativeAsset(url), false);
}

// A GIF is not automatically a sticker — that mistake would gut whole
// series, since several sources serve every page as a GIF.
check("94.gif is a page, not a sticker", isDecorativeAsset(FROM_LOG_REAL_PAGES[3]), false);
check(
  "Anime_In_Love.gif is a page",
  isDecorativeAsset("https://x/Anime_In_Love.gif"),
  false
);

// ── Stem matching is boundary-anchored ─────────────────────────────────────
// This is the whole safety argument: prefix matching alone would delete
// "iconic-page-01.jpg" and "stickers-shop.jpg".
check("exact stem matches", isDecorativeAsset("https://x/sticker.gif"), true);
check("digit boundary matches", isDecorativeAsset("https://x/sticker2-1.gif"), true);
check("dash boundary matches", isDecorativeAsset("https://x/sticker-2.gif"), true);
check("no boundary: iconic", isDecorativeAsset("https://x/iconic-page-01.jpg"), false);
check("no boundary: stickers", isDecorativeAsset("https://x/stickers-shop.jpg"), false);
check("no boundary: emojified", isDecorativeAsset("https://x/emojified-cover.png"), false);
check("no boundary: avatarness", isDecorativeAsset("https://x/avatarness.png"), false);

// ── Case and query-string independence ─────────────────────────────────────
check("uppercase stem", isDecorativeAsset("https://x/STICKER-2.GIF"), true);
check("mixed case stem", isDecorativeAsset("https://x/StIcKeR.gif"), true);
check(
  "query string ignored",
  isDecorativeAsset("https://x/sticker.gif?width=800&v=2"),
  true
);
check(
  "fragment ignored",
  isDecorativeAsset("https://x/sticker.gif#page3"),
  true
);
check(
  "query on a real page ignored",
  isDecorativeAsset("https://x/ch_0_75.jpg?token=abc"),
  false
);

// ── Hostile inputs must not throw ─────────────────────────────────────────
check("empty string", isDecorativeAsset(""), false);
check("undefined-ish null", isDecorativeAsset(null as any), false);
check("bare path", isDecorativeAsset("/wp-content/uploads/2023/emoji.png"), true);
check("no extension", isDecorativeAsset("https://x/sticker"), true);
check("trailing slash", isDecorativeAsset("https://x/uploads/"), false);

// ── filterDecorativePages ─────────────────────────────────────────────────
// Uses `image` (the panel bitmap), matching the `Page` shape.
const mixed = [
  { image: "https://x/1.jpg" },
  { image: "https://x/sticker2-1.gif" },
  { image: "https://x/2.jpg" },
  { image: "https://x/sticker.webp" },
  { image: "https://x/3.jpg" },
];
check("mixed list keeps 3", filterDecorativePages(mixed).length, 3);
check(
  "order preserved",
  filterDecorativePages(mixed).map((p) => p.image.split("/").pop()).join(","),
  "1.jpg,2.jpg,3.jpg"
);

// The all-decorative guard: a chapter of only stickers must still open.
const allStickers = [
  { image: "https://x/sticker1.gif" },
  { image: "https://x/sticker2.gif" },
];
check("all-decorative falls back to unfiltered", filterDecorativePages(allStickers).length, 2);
check("empty input", filterDecorativePages([]).length, 0);
check("non-array input", filterDecorativePages(null as any).length, 0);

// Extra fields on the page object must survive the filter.
const rich = [{ image: "https://x/1.jpg", index: 7, url: "https://x/chapter-1" }];
check("extra fields preserved", filterDecorativePages(rich)[0].index, 7);

// A Page whose `url` is the chapter page — filtering must key on `image`,
// or every page in a chapter would be judged against the same chapter URL.
const pageShaped = [
  { image: "https://x/sticker.gif", url: "https://x/series/chapter-1" },
  { image: "https://x/1.jpg", url: "https://x/series/chapter-1" },
];
check("keys on image, not url", filterDecorativePages(pageShaped).length, 1);
check(
  "kept the real page",
  filterDecorativePages(pageShaped)[0].image,
  "https://x/1.jpg"
);

// ── The animated heuristic stays opt-in ───────────────────────────────────
check(
  "small gif is likely a sticker",
  isLikelyStickerAnimation("https://x/a.gif", 100, 100),
  true
);
check(
  "large gif is not",
  isLikelyStickerAnimation("https://x/a.gif", 1600, 2400),
  false
);
check(
  "small jpg is never a sticker",
  isLikelyStickerAnimation("https://x/a.jpg", 64, 64),
  false
);
check("zero dims rejected", isLikelyStickerAnimation("https://x/a.gif", 0, 0), false);
check("NaN dims rejected", isLikelyStickerAnimation("https://x/a.gif", NaN, 10), false);
check(
  "boundary is inclusive",
  isLikelyStickerAnimation("https://x/a.gif", SMALL_ANIMATED_MAX_EDGE_FOR_TEST, 10),
  true
);
check(
  "one past the boundary is kept",
  isLikelyStickerAnimation("https://x/a.gif", SMALL_ANIMATED_MAX_EDGE_FOR_TEST + 1, 10),
  false
);

// Every declared stem must actually match its own bare name, or the list has
// a typo that silently does nothing.
for (const stem of DECORATIVE_STEMS_FOR_TEST) {
  check(`declared stem self-matches: ${stem}`, isDecorativeAsset(`https://x/${stem}.png`), true);
}

console.log(`\npageAssets: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
