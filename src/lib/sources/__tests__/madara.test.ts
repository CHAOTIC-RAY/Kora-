/**
 * Madara engine unit tests, against HTML captured from live sites.
 *
 * These are the exact markup shapes that broke during the port: the logo
 * block posing as a card, a locked chapter, a chapter link relative to the
 * page directory, extensionless CDN panel urls, and a status row that is
 * not the first `summary-content` on the page.
 */
import { createMadaraClient } from "../madara";
import type { SourcePlugin } from "../types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, got?: unknown) => {
  if (c) { pass++; console.log("PASS ", n); }
  else { fail++; console.log("FAIL ", n, got === undefined ? "" : `-> ${JSON.stringify(got)}`); }
};

const PLUGIN = {
  id: "t", name: "T", lang: "en", version: 1, nsfw: false, kind: "manga",
  baseUrl: "https://example.test", theme: "madara", endpoints: {},
} as unknown as SourcePlugin;

const LISTING = `<body><div class="page-item-detail manga">
  <div class="item-thumb"><a href="https://example.test/" title="SITE LOGO">
    <img data-src="https://example.test/wp-content/themes/x/logo.png"></a></div></div>
  <div class="page-item-detail manga"><div class="item-thumb">
    <a href="https://example.test/manga/alpha/" title="Alpha Series">
    <img data-src="https://example.test/uploads/alpha-175x238.jpg"></a></div></div>
  <div class="page-item-detail manga"><div class="item-thumb">
    <a href="/manga/beta/" title="Beta &amp; Friends">
    <img data-src="/uploads/beta.jpg"></a></div></div>
  <a class="next page-numbers" href="/manga/?page=2">Next</a></body>`;

const DETAILS = `<body>
  <div class="post-title"><h1>Alpha Series</h1></div>
  <div class="author-content"><a href="/author/x">Author Name</a></div>
  <div class="post-content_item"><div class="summary-heading"><span class="h5">Release</span></div>
    <div class="summary-content"><a href="/y/2017/">2017</a></div></div>
  <div class="post-content_item"><div class="summary-heading"><span class="h5">Status</span></div>
    <div class="summary-content">OnGoing</div></div>
  <div class="description-summary"><div class="summary__content">A blurb.</div></div>
  <ul>
    <li class="wp-manga-chapter"><a href="https://example.test/manga/alpha/chapter-2/">Chapter 2</a>
      <span class="chapter-release-date"><i>Jan 2, 2024</i></span></li>
    <li class="wp-manga-chapter"><a href="#">Chapter 3 <i class="fa-lock"></i></a></li>
    <li class="wp-manga-chapter"><a href="ch-1/">Chapter 1</a>
      <span class="chapter-release-date"><i>Jan 1, 2024</i></span></li>
  </ul></body>`;

const READER = `<body><div class="reading-content">
  <div class="page-break"><img src="https://example.test/wp-content/themes/x/logo.png"></div>
  <div class="page-break"><img data-src="https://cdn.example.test/WP-manga/data/m_abc/chapter_abc_001deadbeef"></div>
  <div class="page-break"><img data-src="https://cdn.example.test/WP-manga/data/m_abc/chapter_abc_002cafebabe"></div>
  <div class="page-break"><img data-src="https://example.test/uploads/cover-75x106.jpg"></div>
  <div class="page-break"><img src="https://example.test/wp-content/themes/madara/images/dflazy.jpg"></div>
  <div class="page-break"><img data-src="https://cdn.example.test/WP-manga/data/m_abc/thumbnail/thumbnail.webp"></div>
</div></body>`;

const pages: Record<string, string> = {
  "https://example.test/manga/?m_orderby=views&page=1": LISTING,
  "https://example.test/manga/alpha/": DETAILS,
  "https://example.test/manga/alpha/chapter-2/": READER,
  "https://example.test/manga/alpha/ch-1/": READER,
};

const client = createMadaraClient(PLUGIN, async (url) => {
  const html = pages[url];
  if (!html) throw new Error("404 " + url);
  return html;
});

/* listing */
const listing = await client.popular(1);
ok("listing skips the site logo", !listing.mangas.some((m) => m.url === "https://example.test/"), listing.mangas.map((m) => m.url));
ok("listing returns 2 manga", listing.mangas.length === 2, listing.mangas.length);
ok("absolute href kept", listing.mangas[0]?.url === "https://example.test/manga/alpha/", listing.mangas[0]?.url);
ok("root-relative href resolved", listing.mangas[1]?.url === "https://example.test/manga/beta/", listing.mangas[1]?.url);
ok("title from anchor title attr", listing.mangas[0]?.title === "Alpha Series", listing.mangas[0]?.title);
ok("entities decoded", listing.mangas[1]?.title === "Beta & Friends", listing.mangas[1]?.title);
ok("cover from data-src", listing.mangas[0]?.thumbnailUrl?.includes("alpha-175x238"), listing.mangas[0]?.thumbnailUrl);
// A short fixture page is the last page: the site keeps paginating while a
// page comes back full. Real listings hold 12, so the threshold sits below
// that. This is not derived from a `next` anchor because Madara themes
// frequently render pagination as a bare <ul> with no link classes, and
// trusting their markup made every browsable source read as exhausted.
ok("a short page is the last page", listing.hasNextPage === false);

/* details */
const det = await client.details(listing.mangas[0]);
ok("details title", det.title === "Alpha Series", det.title);
ok("details author", det.author === "Author Name", det.author);
ok("status reads the Status row, not Release", det.status === 1, det.status);
ok("description", det.description === "A blurb.", det.description);

/* chapters */
const chs = await client.chapters(listing.mangas[0]);
ok("locked chapter dropped", !chs.some((c) => c.url === "#"), chs.map((c) => c.url));
ok("two chapters", chs.length === 2, chs.length);
ok("chapter name", chs[0]?.name === "Chapter 2", chs[0]?.name);
ok("page-relative href resolved against the page", chs[1]?.url === "https://example.test/manga/alpha/ch-1/", chs[1]?.url);
ok("chapter 1 name not stolen from chapter 2", chs[1]?.name === "Chapter 1", chs[1]?.name);

/* pages */
const pgs = await client.pages(chs[0]);
ok("exactly 2 real panels", pgs.length === 2, pgs.map((p) => p.image));
ok("theme logo dropped", !pgs.some((p) => /logo/.test(p.image)));
ok("lazy placeholder dropped", !pgs.some((p) => /dflazy/.test(p.image)));
ok("wp thumbnail dropped", !pgs.some((p) => /75x106/.test(p.image)));
ok("cdn thumbnail dropped", !pgs.some((p) => /thumbnail/.test(p.image)));
ok("extensionless cdn panel kept", pgs[0]?.image.includes("chapter_abc_001deadbeef"), pgs[0]?.image);
ok("pages indexed in order", pgs[0]?.index === 0 && pgs[1]?.index === 1);

/* ------------------------------------------------------------------
 * Real scraper-site detail page, captured verbatim from mangazin.org.
 *
 * Every field below was wrong on this page and each defect is a distinct
 * failure mode, so the fixture carries the whole trap: ~18KB of inlined theme
 * CSS that mentions `.post-title` before the real element does, a `<script>`
 * whose `src` is the first `src` attribute in the document, SEO headings
 * wrapped around the plot, and a `Genre(s)` row.
 * ------------------------------------------------------------------ */
const CSS_NOISE = `<style>.c-blog__heading.style-2 i {
  background: -webkit-linear-gradient(left, #f680e0 40%, #f680e0 100%);
  background: linear-gradient(left, #f680e0 40%, #f680e0 100%);
} body.manga-page .profile-manga .post-title h1, .genres_wrap .genres ul li a:hover { color: #333; }</style>`;

const SCRAPER_DETAILS = `<!DOCTYPE html><html><head>
${CSS_NOISE}
<script src="https://mangazin.test/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script>
<meta property="og:image" content="https://mangazin.test/wp-content/uploads/2019/11/post_7030_image.jpg" />
</head><body>
  <div class="post-title"><span class="manga-title-badges hot">HOT</span> <h1> Beauty and the Beasts </h1></div>
  <div class="tab-summary">
    <div class="summary_image"><a href="https://mangazin.test/manga/beauty-and-the-beasts/">
      <img width="193" height="278" data-src="https://mangazin.test/wp-content/uploads/2019/11/post_7030_image-193x278.jpg"
           src="https://mangazin.test/wp-content/themes/madara/images/dflazy.jpg" alt="Beauty and the Beasts"/></a></div>
    <div class="summary_content"><div class="post-content">
      <div class="post-content_item"><div class="summary-heading"><span class="h5">Author(s)</span></div>
        <div class="author-content"><a href="/manga-artist/china-reading/">CHINA READING</a></div></div>
      <div class="post-content_item"><div class="summary-heading"><span class="h5">Genre(s)</span></div>
        <div class="summary-content"><div class="genres-content">
          <a href="https://mangazin.test/manga-genre/ecchi/" rel="tag">Ecchi</a>,
          <a href="https://mangazin.test/manga-genre/fantasy/" rel="tag">Fantasy</a>,
          <a href="https://mangazin.test/manga-genre/harem/" rel="tag">Harem</a>
        </div></div></div>
    </div></div>
  </div>
  <div class="description-summary"><div class="summary__content">
    <h2>Read Beauty and the Beasts Novel &#8211; Beauty and the Beasts Manhua Online Free At <a href="https://mangazin.test/manga-tag/zinmanga.net/">ZINMANGA.NET</a></h2>
    <h3>The summary of the comic Beauty and the Beasts:</h3>
    <p>As soon as she fell into the world of beastmen, a leopard forcibly took her back to his home. Indeed, Bai Jingjing is at a complete and utter loss.</p>
    <h3>&#8220;Beauty and the Beasts&#8221; is also known as:</h3>
    <p>Carefree Beast Life / GO WILD: Kemonohito no Koi wa Yasei-teki</p>
  </div></div>
  <ul><li class="wp-manga-chapter"><a href="https://mangazin.test/manga/beauty-and-the-beasts/chapter-1/">Chapter 1</a></li></ul>
</body></html>`;

const scraper = createMadaraClient(
  { ...PLUGIN, baseUrl: "https://mangazin.test" } as unknown as SourcePlugin,
  async () => SCRAPER_DETAILS
);
const sd = await scraper.details({
  url: "https://mangazin.test/manga/beauty-and-the-beasts/",
  title: "stale listing title",
} as any);

// (b) The title. `div.post-title` appears in the inlined CSS ~200 bytes
// before the real element, and the theme's HOT badge sits beside the <h1>.
ok("title is not the inlined stylesheet", !(sd.title || "").includes("linear-gradient"), sd.title);
ok("title has sane length", (sd.title || "").length < 100, sd.title);
ok("title badge stripped", sd.title === "Beauty and the Beasts", sd.title);

// (a) The cover. The first `src` in this document is jquery.min.js; the real
// cover is the lazy `data-src` on the summary image.
ok("cover is not a script url", !/\.(js|css|json|php)(\?|#|$)/i.test(sd.thumbnailUrl || ""), sd.thumbnailUrl);
ok("cover is not the lazy placeholder", !/dflazy/.test(sd.thumbnailUrl || ""), sd.thumbnailUrl);
ok("cover from data-src", (sd.thumbnailUrl || "").includes("post_7030_image"), sd.thumbnailUrl);

// (c) The synopsis. Only the plot paragraph should survive.
ok("SEO 'Read … Online Free At' prefix stripped", !/ZINMANGA/i.test(sd.description || ""), sd.description);
ok("'summary of the comic' heading stripped", !/summary of the comic/i.test(sd.description || ""), sd.description);
ok("'also known as' heading stripped", !/also known as/i.test(sd.description || ""), sd.description);
ok("synopsis keeps the real prose", (sd.description || "").startsWith("As soon as she fell into the world of beastmen"), sd.description);
ok("synopsis drops the alternate-title list", !/Carefree Beast Life/.test(sd.description || ""), sd.description);

// (d) Genres.
ok("genres parsed", (sd.genres || []).length === 3, sd.genres);
ok("genre names, not urls", sd.genres?.[0] === "Ecchi" && sd.genres?.[2] === "Harem", sd.genres);

/* A detail page with no cover block at all must still resolve one, so the
   cover is never a blank box just because the theme moved its markup. */
const NO_IMAGE_BLOCK = SCRAPER_DETAILS.replace(
  /<div class="summary_image">[\s\S]*?<\/div>/,
  '<div class="summary_image"><span>no cover here</span></div>'
);
const noCover = createMadaraClient(
  { ...PLUGIN, baseUrl: "https://mangazin.test" } as unknown as SourcePlugin,
  async () => NO_IMAGE_BLOCK
);
const nc = await noCover.details({ url: "https://mangazin.test/manga/beauty-and-the-beasts/", title: "x" } as any);
ok("cover falls back to og:image", (nc.thumbnailUrl || "").includes("post_7030_image.jpg"), nc.thumbnailUrl);

/* A site with no genre row must return an empty list, not the header menu's
   links — the nav lists every genre the site has, for every series. */
const NO_GENRES = SCRAPER_DETAILS
  .replace(/<div class="post-content_item"><div class="summary-heading"><span class="h5">Genre\(s\)<\/span>[\s\S]*?<\/div><\/div>\s*<\/div>/, "</div>")
  .replace("</body>", '<nav><a href="https://mangazin.test/manga-genre/ecchi/">Ecchi</a><a href="https://mangazin.test/manga-genre/fantasy/">Fantasy</a></nav></body>');
const noGenres = createMadaraClient(
  { ...PLUGIN, baseUrl: "https://mangazin.test" } as unknown as SourcePlugin,
  async () => NO_GENRES
);
const ng = await noGenres.details({ url: "https://mangazin.test/manga/beauty-and-the-beasts/", title: "x" } as any);
ok("no genre row -> no genres, nav links ignored", (ng.genres || []).length === 0, ng.genres);

/* A page whose FIRST <p> is a site promo and whose real plot is the second —
   s2read prints `Read Manga X at s2read.com` as its own paragraph. Taking the
   first paragraph verbatim made the synopsis read "Read Manga … at s2read.com". */
const PROMO_FIRST = `<body>
  <div class="post-title"><h1>Return of the Mount Hua Sect</h1></div>
  <div class="summary_image"><img data-src="https://s2read.test/x.jpg" src="https://s2read.test/dflazy.jpg"></div>
  <div class="description-summary"><div class="summary__content show-more">
    <h1><a href="/manga/return-of-the-mount-hua-sect/">Return of the Mount Hua Sect</a></h1>
    <p>Read Manga Return of the Mount Hua Sect at <strong>s2read.com</strong></p>
    <p>Chung Myung, the 13th Disciple of the Mount Hua Sect, defeated Chun Ma, who has brought destruction onto the world. He is reborn after 100 years in the body of a child.</p>
    <ul><li>Return of the Flowery Mountain Sect</li></ul>
  </div></div></body>`;
const promo = createMadaraClient(
  { ...PLUGIN, baseUrl: "https://s2read.test" } as unknown as SourcePlugin,
  async () => PROMO_FIRST
);
const pd = await promo.details({ url: "https://s2read.test/manga/return-of-the-mount-hua-sect/", title: "x" } as any);
ok("promo paragraph not used as the synopsis", !/s2read\.com/.test(pd.description || ""), pd.description);
ok("second paragraph used as the synopsis", (pd.description || "").startsWith("Chung Myung, the 13th Disciple"), pd.description);
ok("promo-page cover still resolves", (pd.thumbnailUrl || "").includes("/x.jpg"), pd.thumbnailUrl);

/* resilience: a dead page must not throw */
const dead = createMadaraClient(PLUGIN, async () => { throw new Error("502"); });
ok("dead listing -> empty, no throw", (await dead.popular(1)).mangas.length === 0);
ok("dead details -> no throw", Boolean(await dead.details(listing.mangas[0])));
ok("dead chapters -> empty", (await dead.chapters(listing.mangas[0])).length === 0);
ok("dead pages -> empty", (await dead.pages(chs[0])).length === 0);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
