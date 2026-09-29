/**
 * End-to-end test of the source runtime against a realistic listing page,
 * using selectors shaped like a real Madara-family theme (the pattern that
 * covers the largest share of Gen 2 sources).
 */
import { createSourceClient } from "../client";
import type { SourcePlugin } from "../types";

// Madara-family shape: .manga-item-badges / .manga-item-title / a@href / img@data-src
const listingHtml = `
<html><body>
  <div class="page-item-detail manga">
    <div class="item-summary">
      <div class="item-thumb">
        <img class="lazyload" data-src="https://cdn.example.com/cover1.jpg" src="data:image/gif;base64,R0lGOD"/>
      </div>
      <div class="item-title">
        <h3><a href="/series/one-piece">One Piece</a></h3>
        <div class="item-author">Eiichiro Oda</div>
      </div>
    </div>
  </div>
  <div class="page-item-detail manga">
    <div class="item-summary">
      <div class="item-thumb">
        <img class="lazyload" data-src="https://cdn.example.com/cover2.jpg" src="data:image/gif;base64,R0lGOD"/>
      </div>
      <div class="item-title">
        <h3><a href="/series/naruto">Naruto</a></h3>
        <div class="item-author">Masashi Kishimoto</div>
      </div>
    </div>
  </div>
  <a class="page-nav" href="/page/2">Next</a>
</body></html>`;

const detailsHtml = `
<html><body>
  <div class="post-content">
    <div class="post-title"><h1>One Piece</h1></div>
    <div class="post-status"><span class="post-status__badge">Ongoing</span></div>
    <div class="post-content_item"><div class="summary">
      <div class="post-content_item__author">Eiichiro Oda</div>
      <div class="post-content_item__genre"><a href="/genre/action">Action</a><a href="/genre/adventure">Adventure</a></div>
    </div></div>
    <div class="description-summary">Gol D. Roger was known as the Pirate King.</div>
  </div>
</body></html>`;

const chaptersHtml = `
<html><body>
  <div class="eplister" id="chapterlist">
    <ul class="dunst">
      <li><a href="/chapter/1085">Chapter 1085</a></li>
      <li><a href="/chapter/1086">Chapter 1086</a></li>
      <li><a href="/chapter/1087">Chapter 1087</a></li>
    </ul>
  </div>
</body></html>`;

const pagesHtml = `
<html><body>
  <div class="readers">
    <div class="reader-image"><img src="//cdn.example.com/p1.jpg"></div>
    <div class="reader-image"><img src="//cdn.example.com/p2.jpg"></div>
    <div class="reader-image"><img src="https://cdn.example.com/p3.jpg"></div>
  </div>
</body></body></html>`;

// Route relay fetches to fixtures so the runtime can be exercised offline.
// The relay passes the target as an encoded `?u=` param, so decode before
// matching — otherwise every path looks like "%2Fseries%2F...".
(globalThis as any).fetch = async (input: any) => {
  const raw = String(input);
  const url = decodeURIComponent(raw);
  const body =
    url.includes("/chapters?") ? chaptersHtml
    : url.includes("/reader?") ? pagesHtml
    : url.includes("/series/one-piece") ? detailsHtml
    : listingHtml;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 200,
      body,
      finalUrl: "https://example.com" + (url.includes("chapter") ? "/ch" : "/list"),
    }),
  } as any;
};

const plugin: SourcePlugin = {
  id: "1234567890",
  name: "Example Madara",
  lang: "en",
  version: 1,
  nsfw: false,
  baseUrl: "https://example.com",
  endpoints: {
    popular: {
      url: "/manga?page={page}",
      nextPage: "a.page-nav",
      mangas: {
        selector: "div.page-item-detail",
        title: "h3 a",
        url: "h3 a@href",
        thumb: "img.lazyload@data-src",
        author: ".item-author",
      },
    },
    details: {
      url: "{mangaUrl}",
      title: ".post-title h1",
      author: ".post-content_item__author",
      description: ".description-summary",
      status: { selector: ".post-status__badge", map: { Ongoing: 1, Completed: 2 } },
    },
    chapters: {
      url: "/chapters?manga={mangaUrl}",
      selector: ".eplister ul li a",
      name: "@text",
      url_: "@href",
      transform: "reverse",
    },
    pages: {
      url: "/reader?chapter={chapterUrl}",
      selector: ".reader-image img",
      image: "@src",
    },
  },
};

let pass = 0,
  fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + "  " + detail); }
}

const client = createSourceClient(plugin);

const pop = await client.popular(1);
check("popular returns 2 manga", pop.mangas.length === 2, "n=" + pop.mangas.length);
check("title parsed", pop.mangas[0]?.title === "One Piece", pop.mangas[0]?.title);
check("url stored relative (setUrlWithoutDomain)", pop.mangas[0]?.url === "/series/one-piece", pop.mangas[0]?.url);
check("thumb from data-src not lazyload gif", pop.mangas[0]?.thumbnailUrl === "https://cdn.example.com/cover1.jpg", pop.mangas[0]?.thumbnailUrl);
check("author parsed", pop.mangas[0]?.author === "Eiichiro Oda", pop.mangas[0]?.author);
check("hasNextPage detected", pop.hasNextPage === true);
check("manga marked uninitialised", pop.mangas[0]?.initialized === false);

const det = await client.details(pop.mangas[0]);
check("details title", det.title === "One Piece", det.title);
check("details description", det.description === "Gol D. Roger was known as the Pirate King.", det.description);
check("details status mapped", det.status === 1, String(det.status));
check("details marks initialised", det.initialized === true);

const chs = await client.chapters(pop.mangas[0]);
check("chapters found", chs.length === 3, "n=" + chs.length);
// Fixture order is 1085,1086,1087 and the source asks for `reverse`,
// so the newest (1087) must come first — same as Tachiyomi's sorted list.
check("transform reverse applied", chs[0]?.name === "Chapter 1087", chs[0]?.name);
check("chapter number parsed", chs[0]?.chapterNumber === 1087, String(chs[0]?.chapterNumber));
check("chapter url relative", chs[0]?.url === "/chapter/1087", chs[0]?.url);

const pgs = await client.pages(chs[0], pop.mangas[0]);
check("pages found", pgs.length === 3, "n=" + pgs.length);
check("protocol-relative page url resolved", pgs[0]?.url === "https://cdn.example.com/p1.jpg", pgs[0]?.url);
check("absolute page url untouched", pgs[2]?.url === "https://cdn.example.com/p3.jpg", pgs[2]?.url);
check("page index is positional", pgs.map((p) => p.index).join(",") === "0,1,2", pgs.map((p) => p.index).join(","));

// Resilience: a source with no endpoints must degrade, not throw.
const bare = createSourceClient({ ...plugin, endpoints: {} });
const bareRes = await bare.popular(1);
check("missing endpoint -> empty, no throw", bareRes.mangas.length === 0);

// A broken selector must yield an empty list rather than exploding.
const broken = createSourceClient({
  ...plugin,
  endpoints: { popular: { url: "/manga", mangas: { selector: ">>>bad[[", title: "h3", url: "a@href" } } },
});
const brokenRes = await broken.popular(1);
check("broken selector -> empty list, no throw", brokenRes.mangas.length === 0);

console.log("\n" + pass + " pass, " + fail + " fail");
if (fail) process.exit(1);
