/**
 * Exercise the jsoup-selector shim against selectors taken from real
 * Tachiyomi Gen 2 sources, so the dialect gaps are proven closed rather than
 * assumed closed.
 */
import { load } from "cheerio";
import {
  normaliseSelector,
  selectAll,
  absUrl,
  toRelativeUrl,
  expandTemplate,
} from "../selector";

let pass = 0,
  fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log("PASS  " + name);
  } else {
    fail++;
    console.log("FAIL  " + name + "  " + detail);
  }
}

function q(html: string, selector: string) {
  return load(html)(selector);
}

// --- :eq(n) shim -------------------------------------------------------
// ExistentialComics: chapterListSelector() = "div#date-comics ul li a:eq(0)"
const html = `
<html><body>
  <div id="date-comics"><ul>
    <li><a href="/c/one">One</a></li>
    <li><a href="/c/two">Two</a></li>
    <li><a href="/c/three">Three</a></li>
  </ul></div>
</body></html>`;

const n = normaliseSelector("div#date-comics ul li a:eq(0)");
check("eq(0) stripped from selector", n.selector === "div#date-comics ul li a", 'got "' + n.selector + '"');
check("eq index captured", n.eqIndices.length === 1 && n.eqIndices[0] === 0, JSON.stringify(n.eqIndices));

const eqd = selectAll(html, "div#date-comics ul li a:eq(0)");
check("eq(0) selects first anchor", eqd.length === 1 && eqd.first().text() === "One", "n=" + eqd.length);

const eqLast = selectAll(html, "div#date-comics ul li a:eq(-1)");
check("eq(-1) selects last anchor", eqLast.length === 1 && eqLast.first().text() === "Three", "n=" + eqLast.length);

check("plain selector returns all 3", selectAll(html, "div#date-comics ul li a").length === 3);

// --- listing cards ------------------------------------------------------
const listHtml =
  '<div class="entry"><h2>Title A</h2><a href="/m/a"></a><img src="/t/a.jpg"></div>' +
  '<div class="entry"><h2>Title B</h2><a href="/m/b"></a><img src="https://cdn/t/b.jpg"></div>';

const cards = selectAll(listHtml, "div.entry");
check("listing selector finds cards", cards.length === 2, "n=" + cards.length);
check("title from child selector", q(listHtml, "div.entry h2").first().text() === "Title A");

const src = q(listHtml, "div.entry img").first().attr("src");
check("relative img src captured", src === "/t/a.jpg", String(src));
check("absUrl resolves relative", absUrl("https://site.com/list", src!) === "https://site.com/t/a.jpg", absUrl("https://site.com/list", src!));
check("absUrl leaves absolute alone", absUrl("https://site.com/list", "https://cdn/t/b.jpg") === "https://cdn/t/b.jpg");

// ExistentialComics builds urls as "https:" + src.substring(1)
const protoRel = "//i.ibb.co/pykMVYM/x.png";
check(
  "protocol-relative -> https",
  absUrl("https://existentialcomics.com", protoRel) === "https://i.ibb.co/pykMVYM/x.png",
  absUrl("https://existentialcomics.com", protoRel)
);

// --- relative-path storage (setUrlWithoutDomain behaviour) -------------
const rel1 = toRelativeUrl("https://site.com", "https://site.com/m/a?x=1");
check("toRelativeUrl strips origin", rel1 === "/m/a?x=1", rel1);
check("toRelativeUrl keeps foreign origin", toRelativeUrl("https://site.com", "https://other.com/m") === "https://other.com/m");

// --- template expansion -------------------------------------------------
check("expand {page}", expandTemplate("/page/{page}", { page: 2 }) === "/page/2");
check("expand {query} encoded", expandTemplate("/search?q={query}", { query: "a b&c" }) === "/search?q=a%20b%26c", expandTemplate("/search?q={query}", { query: "a b&c" }));
check("expand missing var -> empty", expandTemplate("/x/{nope}", {}) === "/x/");

// --- page images (.comicImg) -------------------------------------------
const pageHtml =
  '<div class="comicImg"><img src="//cdn/p1.jpg"></div>' +
  '<div class="comicImg"><img src="//cdn/p2.jpg"></div>';
check("page selector finds 2", selectAll(pageHtml, ".comicImg").length === 2);
const p0 = q(pageHtml, ".comicImg img").first().attr("src");
check("page img protocol-relative resolves", absUrl("https://site.com/c/1", p0!) === "https://cdn/p1.jpg", absUrl("https://site.com/c/1", p0!));

// --- graceful degradation ----------------------------------------------
let threw = false;
try {
  selectAll(html, ">>>bad[[");
} catch {
  threw = true;
}
check("malformed selector does not throw", !threw);
check("no-match returns empty", selectAll(html, ".does-not-exist").length === 0);

console.log("\n" + pass + " pass, " + fail + " fail");
if (fail) process.exit(1);
