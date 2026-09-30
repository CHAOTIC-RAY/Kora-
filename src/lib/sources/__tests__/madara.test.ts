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

/* resilience: a dead page must not throw */
const dead = createMadaraClient(PLUGIN, async () => { throw new Error("502"); });
ok("dead listing -> empty, no throw", (await dead.popular(1)).mangas.length === 0);
ok("dead details -> no throw", Boolean(await dead.details(listing.mangas[0])));
ok("dead chapters -> empty", (await dead.chapters(listing.mangas[0])).length === 0);
ok("dead pages -> empty", (await dead.pages(chs[0])).length === 0);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
