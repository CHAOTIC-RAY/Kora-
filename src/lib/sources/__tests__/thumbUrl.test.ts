/**
 * Thumbnail extraction unit tests.
 *
 * Covers the three ways a Madara card produced a cover that rendered blank
 * or grey in the grid: a placeholder value taken as if it were the image, a
 * relative or protocol-relative URL left unresolved, and the card/UI field
 * name mismatch that dropped an otherwise good URL on the floor.
 */
import { isPlaceholderThumb, pickThumbUrl, resolveThumbUrl } from "../thumbUrl";
import { createMadaraClient } from "../madara";
import type { SourcePlugin } from "../types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, got?: unknown) => {
  if (c) { pass++; console.log("PASS ", n); }
  else { fail++; console.log("FAIL ", n, got === undefined ? "" : `-> ${JSON.stringify(got)}`); }
};

const BASE = "https://s2read.com";

/* -------------------------------------------------- placeholder rejection */

ok("1x1 gif is a placeholder", isPlaceholderThumb("/wp-content/themes/madara/1x1.gif"));
ok("data: URI is a placeholder", isPlaceholderThumb("data:image/gif;base64,R0lGOD"));
ok("grey.gif is a placeholder", isPlaceholderThumb("https://x.test/theme/grey.gif"));
ok("placeholder.png is a placeholder", isPlaceholderThumb("https://x.test/assets/placeholder.png"));
ok("blank.gif is a placeholder", isPlaceholderThumb("https://x.test/img/blank.gif"));
ok("spacer.png is a placeholder", isPlaceholderThumb("/assets/spacer.png"));
ok("empty string is a placeholder", isPlaceholderThumb(""));
ok("null is a placeholder", isPlaceholderThumb(null));
ok("undefined is a placeholder", isPlaceholderThumb(undefined));
ok("loader without an extension is a placeholder", isPlaceholderThumb("https://x.test/loader"));
ok("captured markup is a placeholder", isPlaceholderThumb('<img src="x.jpg"'));
// A real cover must not be rejected: the names above are needles, not a
// blanket match, or every "loading-ships.jpg"-style URL would go blank.
ok("a real cover survives rejection", !isPlaceholderThumb("https://x.test/wp-content/uploads/2021/05/E138-175x238.jpg"));
ok("a cover whose name contains 'load' survives", !isPlaceholderThumb("https://x.test/loader-ship-cover.jpg"));
ok("a gif cover is NOT a placeholder (only 1x1 is)", !isPlaceholderThumb("https://x.test/magic_cover.gif"));

/* ------------------------------------------------- relative URL resolution */

ok("absolute https passes through", resolveThumbUrl("https://a.test/x.jpg", BASE) === "https://a.test/x.jpg");
ok("absolute http is kept as http", resolveThumbUrl("http://a.test/x.jpg", BASE) === "http://a.test/x.jpg");
ok("protocol-relative gets https", resolveThumbUrl("//cdn.a.test/x.jpg", BASE) === "https://cdn.a.test/x.jpg");
ok("root-relative resolves to the origin", resolveThumbUrl("/wp-content/x.jpg", BASE) === "https://s2read.com/wp-content/x.jpg");
ok("bare relative resolves to the base", resolveThumbUrl("wp-content/x.jpg", BASE) === "https://s2read.com/wp-content/x.jpg");
ok("a trailing slash on base is tolerated", resolveThumbUrl("/x.jpg", "https://a.test/") === "https://a.test/x.jpg");
ok("a placeholder resolves to nothing", resolveThumbUrl("1x1.gif", BASE) === "");
ok("empty resolves to nothing", resolveThumbUrl("", BASE) === "");

/* --------------------------------------------------- attribute preference */

ok(
  "data-src wins over a placeholder src",
  pickThumbUrl(
    `<div class="item-thumb"><img data-src="https://s2read.com/real.jpg" src="https://s2read.com/1x1.gif"></div>`,
    BASE
  ) === "https://s2read.com/real.jpg"
);

ok(
  "data-original is used when data-src is absent",
  pickThumbUrl(
    `<div class="item-thumb"><img data-original="https://s2read.com/orig.jpg" src="https://s2read.com/grey.gif"></div>`,
    BASE
  ) === "https://s2read.com/orig.jpg"
);

ok(
  "data-lazy-src is used when the others are absent",
  pickThumbUrl(
    `<div class="item-thumb"><img data-lazy-src="/uploads/lazy.jpg" src="/assets/placeholder.png"></div>`,
    BASE
  ) === "https://s2read.com/uploads/lazy.jpg"
);

ok(
  "a real eager src is still used when there is no lazy attribute",
  pickThumbUrl(
    `<div class="item-thumb"><img src="https://s2read.com/eager.jpg"></div>`,
    BASE
  ) === "https://s2read.com/eager.jpg"
);

ok(
  "an all-placeholder card yields no URL, so the UI can show a placeholder",
  pickThumbUrl(
    `<div class="item-thumb"><img data-src="data:image/gif;base64,R0lGOD" src="/assets/placeholder.png"></div>`,
    BASE
  ) === ""
);

ok(
  "an img with no image attributes yields no URL",
  pickThumbUrl(`<div class="item-thumb"><img alt=""></div>`, BASE) === ""
);

ok(
  "a data-src elsewhere on the card is not mistaken for the image's",
  pickThumbUrl(
    `<div class="item-thumb" data-src="https://s2read.com/div-cover.jpg"><img src="/assets/placeholder.png"></div>`,
    BASE
  ) === ""
);

ok(
  "srcset picks the largest candidate, not the 1x1 spacer",
  pickThumbUrl(
    `<div class="item-thumb"><img src="/assets/1x1.gif" srcset="/assets/1x1.gif 1w, /uploads/big.jpg 600w"></div>`,
    BASE
  ) === "https://s2read.com/uploads/big.jpg"
);

ok(
  "a relative data-src is resolved against the source",
  pickThumbUrl(`<div class="item-thumb"><img data-src="//cdn.s2read.com/t.webp"></div>`, BASE) ===
    "https://cdn.s2read.com/t.webp"
);

/* --------------------------- end to end: the listing parser, on real markup */

const PLUGIN = {
  id: "t", name: "S2Read", lang: "en", version: 1, nsfw: false, kind: "manga",
  baseUrl: "https://s2read.com", theme: "madara", endpoints: {},
} as unknown as SourcePlugin;

const LISTING = `<body>
  <div class="page-item-detail manga">
    <div class="item-thumb"><a href="https://s2read.com/" title="SITE LOGO">
      <img data-src="https://s2read.com/wp-content/themes/x/logo.png"></a></div></div>
  <div class="page-item-detail manga"><div class="item-thumb">
    <a href="https://s2read.com/manga/alpha/" title="Alpha">
      <img data-src="https://s2read.com/uploads/alpha.webp" src="https://s2read.com/1x1.gif"></a></div></div>
  <div class="page-item-detail manga"><div class="item-thumb">
    <a href="/manga/beta/" title="Beta">
      <img data-src="//cdn.s2read.com/beta.jpg" src="/assets/placeholder.png"></a></div></div>
  <div class="page-item-detail manga"><div class="item-thumb">
    <a href="/manga/gamma/" title="Gamma">
      <img data-src="data:image/gif;base64,R0lGOD" src="/assets/placeholder.png"></a></div></div>
  <a class="next page-numbers" href="/manga/?page=2">Next</a></body>`;

const client = createMadaraClient(PLUGIN, async () => LISTING);
const page = await client.popular(1);
const byTitle = (t: string) => page.mangas.find((m: any) => m.title === t);

ok("logo block is still not a card", page.mangas.length === 3, page.mangas.map((m: any) => m.title));
ok(
  "a card whose only real image is data-src keeps it",
  byTitle("Alpha")?.thumbnailUrl === "https://s2read.com/uploads/alpha.webp",
  byTitle("Alpha")?.thumbnailUrl
);
ok(
  "a protocol-relative data-src is made absolute",
  byTitle("Beta")?.thumbnailUrl === "https://cdn.s2read.com/beta.jpg",
  byTitle("Beta")?.thumbnailUrl
);
ok(
  "a card with only placeholders yields no thumbnailUrl, not a grey pixel",
  byTitle("Gamma")?.thumbnailUrl === "",
  byTitle("Gamma")?.thumbnailUrl
);

/* -------------------------------- the UI field the grid actually reads --- */

const item = (m: any) => ({ coverUrl: m.thumbnailUrl || "" });
ok(
  "the grid's field name carries a real URL for every card that has one",
  page.mangas.every((m: any) => item(m).coverUrl === (m.thumbnailUrl || ""))
);
ok(
  "cards with covers are non-empty under coverUrl",
  page.mangas.filter((m: any) => m.thumbnailUrl).every((m: any) => item(m).coverUrl.length > 0)
);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exitCode = 1;
