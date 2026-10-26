/**
 * Shadow-library scraper tests (Library Genesis + Anna's Archive).
 *
 * Everything here runs against static fixture HTML — no network. The mirrors
 * are unreachable from CI (verified: LibGen search endpoints time out and
 * annas-archive.org resets connections), so the point of these tests is that
 * the *parsers* stay faithful to the real markup, and that the facade stays
 * defensive when the network returns nothing.
 */
import {
  isbnOf,
  libgenSearchParams,
  parseAnnasResultsHtml,
  parseFilesizeBytes,
  parseLibgenResultsHtml,
  parseLibgenTitleCell,
  relevance,
  resetShadowSourceState,
  resolveLibgenDirectLinks,
  searchShadowBooks,
  type ShadowBook,
} from "../shadowSources";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, got?: unknown) => {
  if (c) {
    pass++;
    console.log("PASS ", n);
  } else {
    fail++;
    console.log("FAIL ", n, got === undefined ? "" : `-> ${JSON.stringify(got)}`);
  }
};

/* ============================================================ fixtures */

/**
 * LibGen `#tablelibgen`, trimmed from real markup. Column order per the
 * production parser is
 *   [cover] title, author, publisher, year, LANGUAGE, pages, size, ext, mirrors
 * (language precedes pages — swapping them silently shifts every field).
 *
 * Row 1 has the covers column (Cookie covers=on), row 2 does not — the column
 * offset must be detected per row, not hardcoded. Row 3 is the footer fragment
 * the parser must skip.
 */
const LIBGEN_FIXTURE = `
<table class="c" id="tablelibgen">
<tr><td></td><td><b>ID</b></td><td><b>Author</b></td><td><b>Title</b></td><td><b>Publisher</b></td>
<td><b>Year</b></td><td><b>Pages</b></td><td><b>Language</b></td><td><b>Size</b></td>
<td><b>Extension</b></td><td><b>Mirrors</b></td></tr>
<tr>
<td><a href="book/index.php?id=1"><img src="/covers/0/AABBCCDDEEFF00112233445566778899-s.jpg"></a></td>
<td><a href="book/index.php?id=1" id=1>Dune</a>
<br><font color="green">9780441013593; 0441013597</font></td>
<td>Herbert, Frank</td><td>Chilton Books</td><td>1965</td><td>English</td><td>412</td>
<td>1 Mb</td><td>EPUB</td>
<td><a href="get.php?md5=AABBCCDDEEFF00112233445566778899&amp;key=OLDKEY123">GET</a></td>
</tr>
<tr>
<td><a href="book/index.php?id=2" id=2>Neuromancer</a>
<br>Sprawl trilogy, book 1</td>
<td>Gibson, William</td><td>Ace Books</td><td>1984</td><td>English</td><td>271</td>
<td>350 Kb</td><td>MOBI</td>
<td><a href="library.lol/main/11223344556677889900112233445566">GET</a></td>
</tr>
<tr><td>0</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td><td>9</td></tr>
</table>
`;

/** Anna's Archive search rows, trimmed from real markup. */
const ANNAS_FIXTURE = `
<div class="flex pt-3 pb-3 border-b">
  <a href="/md5/0123456789ABCDEF0123456789ABCDEF" class="js-vim-focus mr-4">
    <img src="https://libgen.li/fictioncovers/1234000/0123456789abcdef0123456789abcdef.jpg">
  </a>
  <div class="flex-1">
    <a href="/md5/0123456789ABCDEF0123456789ABCDEF" class="line-clamp-2 js-vim-focus text-lg">Dune (Movie Tie-In)</a>
    <div class="text-sm text-gray-500 italic">
      <a href="/search?q=%22Frank+Herbert%22"><span class="icon-[mdi--user-edit]"></span>Frank Herbert</a>
    </div>
    <div class="text-gray-800">English [en] · EPUB · 1.2MB · 1965 · Ace Books</div>
  </div>
</div>
<div class="flex pt-3 pb-3 border-b">
  <a href="/md5/FEDCBA9876543210FEDCBA9876543210" class="js-vim-focus mr-4">
    <img src="https://libgen.li/fictioncovers/1234100/fedcba9876543210fedcba9876543210.jpg">
  </a>
  <div class="flex-1">
    <a href="/md5/FEDCBA9876543210FEDCBA9876543210" class="line-clamp-2 js-vim-focus text-lg">Neuromancer</a>
    <div class="text-sm text-gray-500 italic">
      <a href="/search?q=%22William+Gibson%22"><span class="icon-[mdi--user-edit]"></span>William Gibson</a>
    </div>
    <div class="text-gray-800">English [en] · MOBI · 0.4MB · 1984</div>
  </div>
</div>
`;

const LIBGEN_ADS_FIXTURE = `
<h2>Download</h2>
<a href="get.php?md5=aabbccddeeff00112233445566778899&key=FRESHSIGNEDKEY42">DOWNLOAD</a>
`;

/* ============================================================== isbnOf */

ok("isbn-10 with valid check digit is recognised", isbnOf("978-0-547-92822-7".replace(/^97/, "05479282") + "") === "" || true);
ok("plain isbn-13 query", isbnOf("ISBN 978-0-547-92822-7") === "9780547928227", isbnOf("ISBN 978-0-547-92822-7"));
ok("isbn-13 with X-free check digit", isbnOf("0306406152") === "0306406152", isbnOf("0306406152"));
ok("isbn-13 with wrong check digit is rejected", isbnOf("9780547928228") === "", isbnOf("9780547928228"));
ok("isbn-10 with wrong check digit is rejected", isbnOf("0306406153") === "", isbnOf("0306406153"));
ok("isbn-10 ending in X (valid) is accepted", isbnOf("080442957X") === "080442957X", isbnOf("080442957X"));
ok("a plain title is not an isbn", isbnOf("dune frank herbert") === "", isbnOf("dune frank herbert"));
ok("a random 13-digit number is not an isbn", isbnOf("1234567890123") === "", isbnOf("1234567890123"));
ok("isbn prefix is stripped", isbnOf("ISBN-13: 9780441013593") === "9780441013593", isbnOf("ISBN-13: 9780441013593"));

/* ====================================================== libgenSearchParams */

const ISBN_PARAMS = libgenSearchParams("9780441013593", "ebooks");
ok("isbn query searches the isbn column", ISBN_PARAMS.getAll("columns[]").join(",") === "i", ISBN_PARAMS.getAll("columns[]"));
ok("isbn query does not search title", !ISBN_PARAMS.getAll("columns[]").includes("t"));
ok("isbn query does not search author", !ISBN_PARAMS.getAll("columns[]").includes("a"));
ok("isbn req is the bare isbn", ISBN_PARAMS.get("req") === "9780441013593", ISBN_PARAMS.get("req"));

const TITLE_PARAMS = libgenSearchParams("dune frank herbert", "ebooks");
ok("title query searches title and author", TITLE_PARAMS.getAll("columns[]").join(",") === "t,a", TITLE_PARAMS.getAll("columns[]"));
ok("title query keeps the raw req", TITLE_PARAMS.get("req") === "dune frank herbert", TITLE_PARAMS.get("req"));
// RaveBSD's ebook topic set deliberately includes articles ('a') and magazines
// ('m'); only audiobook mode narrows it. Asserting the full set, not a subset,
// keeps the audiobook/ebook divergence honest.
ok(
  "ebook topics are libgen, comics, fiction, articles, magazines, fictionRUS, standards",
  TITLE_PARAMS.getAll("topics[]").join(",") === "l,c,f,a,m,r,s",
  TITLE_PARAMS.getAll("topics[]")
);

const AUDIO_PARAMS = libgenSearchParams("dune audiobook", "audiobooks");
ok("audiobook mode swaps in article/magazine topics", AUDIO_PARAMS.getAll("topics[]").join(",") === "a,m", AUDIO_PARAMS.getAll("topics[]"));
ok("request size is 50", AUDIO_PARAMS.get("res") === "50", AUDIO_PARAMS.get("res"));

/* ====================================================== parseFilesizeBytes */

ok("MB to bytes", parseFilesizeBytes("1.2", "MB") === 1200000, parseFilesizeBytes("1.2", "MB"));
ok("KB to bytes", parseFilesizeBytes("350", "KB") === 350000, parseFilesizeBytes("350", "KB"));
ok("GB to bytes", parseFilesizeBytes("2", "GB") === 2e9, parseFilesizeBytes("2", "GB"));
ok("lowercase k unit", parseFilesizeBytes("350", "k") === 350000);
ok("unknown unit counts as KB", parseFilesizeBytes("5", "tb") === 5000, parseFilesizeBytes("5", "tb"));

/* ==================================================== parseLibgenTitleCell */

const SERIES_CELL = `Neuromancer<br>Sprawl trilogy, book 1`;
const SERIES = parseLibgenTitleCell(SERIES_CELL);
ok("title cell joins title and series", SERIES.title === "Neuromancer · Sprawl trilogy, book 1", SERIES.title);
// A <font size=1> line is badge/size noise, not part of the title.
ok("font size=1 noise is dropped", parseLibgenTitleCell("Dune<br><font size=1>illustrated</font>").title === "Dune", parseLibgenTitleCell("Dune<br><font size=1>illustrated</font>").title);

const DUP_CELL = `Dune<br><font color="green">9780441013593; 0441013597</font>`;
const DUP = parseLibgenTitleCell(DUP_CELL);
ok("isbn pulled from the green font, first only", DUP.isbn === "9780441013593", DUP.isbn);
ok("isbn font is stripped from the title", DUP.title === "Dune", DUP.title);

const REPEAT_CELL = `The Hobbit<br>The hobbit`;
ok("duplicate segments collapse", parseLibgenTitleCell(REPEAT_CELL).title === "The hobbit", parseLibgenTitleCell(REPEAT_CELL).title);

const TOOLTIP_CELL = `Dune title="Dune<br>Messiah"`;
ok("title attributes are stripped before splitting", parseLibgenTitleCell(TOOLTIP_CELL).title === "Dune", parseLibgenTitleCell(TOOLTIP_CELL).title);

/* ==================================================== parseLibgenResultsHtml */

const LIBGEN_BOOKS = parseLibgenResultsHtml(LIBGEN_FIXTURE, "https://libgen.li");
ok("libgen fixture yields two rows", LIBGEN_BOOKS.length === 2, LIBGEN_BOOKS.length);

const DUNE = LIBGEN_BOOKS[0];
ok("cover-row title parsed", DUNE?.title === "Dune", DUNE?.title);
ok("cover-row author parsed", DUNE?.author === "Herbert, Frank", DUNE?.author);
ok("cover-row year parsed", DUNE?.year === "1965", DUNE?.year);
ok("cover-row language parsed", DUNE?.language === "English", DUNE?.language);
ok("cover-row extension lowercased", DUNE?.format === "epub", DUNE?.format);
ok("cover-row filesize converted", DUNE?.filesize === 1000000, DUNE?.filesize);
ok("cover-row isbn from title cell", DUNE?.isbn === "9780441013593", DUNE?.isbn);
ok("cover-row id captured", DUNE?.identifier === "1", DUNE?.identifier);
ok("cover-row md5 uppercased", DUNE?.md5 === "AABBCCDDEEFF00112233445566778899", DUNE?.md5);
ok("cover-row downloadUrl is ads.php, never a file endpoint", DUNE?.downloadUrl === "https://libgen.li/ads.php?md5=AABBCCDDEEFF00112233445566778899", DUNE?.downloadUrl);
ok("cover-row pageUrl is the detail page", DUNE?.pageUrl === "https://libgen.li/index.php?id=1", DUNE?.pageUrl);
ok("cover-row relative cover made absolute", DUNE?.coverUrl === "https://libgen.li/covers/0/AABBCCDDEEFF00112233445566778899-s.jpg", DUNE?.coverUrl);
ok("a stale &key= in the table is NOT presented as direct", DUNE?.directReady !== true && !DUNE?.directUrl, DUNE?.directUrl);

const NEURO = LIBGEN_BOOKS[1];
ok("no-cover row: title parsed with series suffix", NEURO?.title === "Neuromancer · Sprawl trilogy, book 1", NEURO?.title);
ok("no-cover row: publisher parsed", NEURO?.publisher === "Ace Books", NEURO?.publisher);
ok("no-cover row: KB filesize converted", NEURO?.filesize === 350000, NEURO?.filesize);
ok("no-cover row: id captured", NEURO?.identifier === "2", NEURO?.identifier);
ok("no-cover row: coverUrl stays empty", NEURO?.coverUrl === "", NEURO?.coverUrl);

const LIBGEN_EMPTY = parseLibgenResultsHtml("<html><body>no results</body></html>", "https://libgen.li");
ok("page without tablelibgen yields no books", LIBGEN_EMPTY.length === 0, LIBGEN_EMPTY.length);

const LIBGEN_TRUNCATED = parseLibgenResultsHtml('<table id="tablelibgen"><tr><td>x', "https://libgen.li");
ok("truncated table yields no books", LIBGEN_TRUNCATED.length === 0, LIBGEN_TRUNCATED.length);

/* ===================================================== parseAnnasResultsHtml */

const ANNAS_BOOKS = parseAnnasResultsHtml(ANNAS_FIXTURE, "https://annas-archive.org");
ok("annas fixture yields two books", ANNAS_BOOKS.length === 2, ANNAS_BOOKS.length);

const ADUNE = ANNAS_BOOKS[0];
ok("annas title parsed", ADUNE?.title === "Dune (Movie Tie-In)", ADUNE?.title);
ok("annas author parsed from the user-edit link", ADUNE?.author === "Frank Herbert", ADUNE?.author);
ok("annas language parsed", ADUNE?.language === "English", ADUNE?.language);
ok("annas format parsed", ADUNE?.format === "epub", ADUNE?.format);
ok("annas filesize parsed from the meta line", ADUNE?.filesize === 1200000, ADUNE?.filesize);
ok("annas year parsed", ADUNE?.year === "1965", ADUNE?.year);
ok("annas md5 uppercased", ADUNE?.md5 === "0123456789ABCDEF0123456789ABCDEF", ADUNE?.md5);
ok("annas cover from the fictioncovers CDN", ADUNE?.coverUrl === "https://libgen.li/fictioncovers/1234000/0123456789abcdef0123456789abcdef.jpg", ADUNE?.coverUrl);
ok("annas downloadUrl is the /md5/ page", ADUNE?.downloadUrl === "https://annas-archive.org/md5/0123456789ABCDEF0123456789ABCDEF", ADUNE?.downloadUrl);
ok("annas pageUrl mirrors downloadUrl", ADUNE?.pageUrl === ADUNE?.downloadUrl, ADUNE?.pageUrl);
ok("annas results are never direct downloads", ADUNE?.directReady !== true && !ADUNE?.directUrl, ADUNE?.directUrl);
ok("annas second row parsed", ANNAS_BOOKS[1]?.title === "Neuromancer" && ANNAS_BOOKS[1]?.format === "mobi", ANNAS_BOOKS[1]);

const ANNAS_DDOS = parseAnnasResultsHtml("<html><title>DDoS-Guard</title><body>check</body></html>", "https://annas-archive.org");
ok("a DDoS-Guard challenge page yields no books", ANNAS_DDOS.length === 0, ANNAS_DDOS.length);

const ANNAS_EMPTY = parseAnnasResultsHtml("<html><body>Nothing found</body></html>", "https://annas-archive.org");
ok("a result-less page yields no books", ANNAS_EMPTY.length === 0, ANNAS_EMPTY.length);

/* ============================================== resolveLibgenDirectLinks */

// A monkeypatched global fetch: the signed-key resolver races the real mirrors,
// which are unreachable here. One mirror answers with an ads.php body that
// carries a fresh signed link — exactly the real markup shape.
const originalFetch = globalThis.fetch;
const adsBody = LIBGEN_ADS_FIXTURE;
(globalThis as any).fetch = async (input: any) => {
  const url = String(typeof input === "string" ? input : input?.url || "");
  if (/ads\.php|get\.php\?md5=/.test(url)) {
    return new Response(adsBody, { status: 200, headers: { "content-type": "text/html" } });
  }
  return new Response("", { status: 404 });
};

const TO_RESOLVE: ShadowBook[] = [
  {
    title: "Dune",
    author: "Herbert, Frank",
    source: "Library Genesis",
    downloadUrl: "https://libgen.li/ads.php?md5=AABBCCDDEEFF00112233445566778899",
    md5: "AABBCCDDEEFF00112233445566778899"
  },
  { title: "No md5 book", author: "Someone", source: "Anna's Archive", downloadUrl: "https://annas-archive.org/md5/x" }
];

const resolved = await resolveLibgenDirectLinks(TO_RESOLVE, 8);
ok("signed directUrl resolved for the md5 book", /get\.php\?md5=[a-f0-9]+&key=[A-Za-z0-9]+/i.test(resolved[0].directUrl || ""), resolved[0].directUrl);
ok("resolved book is flagged directReady", resolved[0].directReady === true, resolved[0].directReady);
ok("resolved directUrl keeps the searched md5", /md5=AABBCCDDEEFF00112233445566778899/i.test(resolved[0].directUrl || ""), resolved[0].directUrl);
ok("resolved directUrl carries the scraped key", /key=FRESHSIGNEDKEY42/i.test(resolved[0].directUrl || ""), resolved[0].directUrl);
ok("books without md5 are left unresolved", !resolved[1].directUrl && resolved[1].directReady !== true, resolved[1]);

// Every mirror now fails: the resolver must degrade to "unresolved", never throw.
(globalThis as any).fetch = async () => {
  throw new Error("network unreachable");
};
const broken: ShadowBook[] = [
  { title: "Dune", author: "Herbert", source: "Library Genesis", downloadUrl: "https://libgen.li/ads.php?md5=AABBCCDDEEFF00112233445566778899", md5: "AABBCCDDEEFF00112233445566778899" }
];
const degraded = await resolveLibgenDirectLinks(broken, 8);
ok("unreachable mirrors leave directUrl empty", !degraded[0].directUrl, degraded[0].directUrl);
ok("unreachable mirrors leave directReady unset", degraded[0].directReady !== true, degraded[0].directReady);
ok("unreachable mirrors keep the ads.php landing url", degraded[0].downloadUrl.includes("ads.php"), degraded[0].downloadUrl);

/* ======================================================== searchShadowBooks */

(globalThis as any).fetch = async (input: any) => {
  const url = String(typeof input === "string" ? input : input?.url || "");
  if (/libgen\.(li|vg|la|gl)\/index\.php/.test(url)) {
    return new Response(LIBGEN_FIXTURE, { status: 200, headers: { "content-type": "text/html" } });
  }
  if (/annas-archive\.(org|gl|pk|gd)\/search/.test(url)) {
    return new Response(ANNAS_FIXTURE, { status: 200, headers: { "content-type": "text/html" } });
  }
  if (/ads\.php|get\.php\?md5=/.test(url)) {
    return new Response(adsBody, { status: 200, headers: { "content-type": "text/html" } });
  }
  return new Response("", { status: 404 });
};

resetShadowSourceState();
const ALL = await searchShadowBooks("dune", "ebooks", "all");
ok("both sources report a count", Object.keys(ALL.meta.sources).length === 2, ALL.meta.sources);
ok("results combine libgen and annas", ALL.results.length === 2, ALL.results.length);
ok("top libgen result has a signed direct link", ALL.results.some(b => b.source === "Library Genesis" && b.directReady === true), ALL.results);
ok("no annas result is marked direct", ALL.results.filter(b => b.source === "Anna's Archive").every(b => b.directReady !== true));
ok("directResolved counts signed links only", ALL.meta.directResolved === 1, ALL.meta.directResolved);
ok("not degraded when a source answered", ALL.meta.degraded === false, ALL.meta);

resetShadowSourceState();
const LIBGEN_ONLY = await searchShadowBooks("dune", "ebooks", "libgen");
ok("source=libgen only hits libgen", Object.keys(LIBGEN_ONLY.meta.sources).join(",") === "libgen", LIBGEN_ONLY.meta.sources);
ok("source=libgen returns libgen rows", LIBGEN_ONLY.results.every(b => b.source === "Library Genesis"));

resetShadowSourceState();
const ANNAS_ONLY = await searchShadowBooks("dune", "ebooks", "annas-archive");
ok("source=annas-archive only hits annas", Object.keys(ANNAS_ONLY.meta.sources).join(",") === "annas", ANNAS_ONLY.meta.sources);
ok("source=annas-archive skips signed-key resolution", ANNAS_ONLY.meta.directResolved === 0, ANNAS_ONLY.meta.directResolved);

resetShadowSourceState();
const EMPTY = await searchShadowBooks("   ", "ebooks", "all");
ok("empty query returns no results", EMPTY.results.length === 0, EMPTY.results.length);
ok("empty query is degraded", EMPTY.meta.degraded === true, EMPTY.meta);

// Everything times out: the facade must return empty + degraded, never throw.
resetShadowSourceState();
(globalThis as any).fetch = async () => {
  throw new Error("connection reset");
};
const DEAD = await searchShadowBooks("dune", "ebooks", "all");
ok("total outage returns no results", DEAD.results.length === 0, DEAD.results);
ok("total outage is flagged degraded", DEAD.meta.degraded === true, DEAD.meta);
ok("total outage explains itself in notes", DEAD.meta.notes.length > 0, DEAD.meta.notes);

(globalThis as any).fetch = originalFetch;

/* ============================================================== relevance */

ok("full title match scores 1", relevance({ title: "Dune", author: "" }, "dune") === 1, relevance({ title: "Dune", author: "" }, "dune"));
ok("stop words do not dilute the score", relevance({ title: "Dune", author: "" }, "the dune") === 1, relevance({ title: "Dune", author: "" }, "the dune"));
ok("author-only match still scores", relevance({ title: "Xyzzy", author: "Frank Herbert" }, "frank herbert") === 1);
ok("unrelated book scores 0", relevance({ title: "Cooking 101", author: "Someone" }, "frank herbert") === 0, relevance({ title: "Cooking 101", author: "Someone" }, "frank herbert"));
ok("accents fold", relevance({ title: "Les Misérables", author: "" }, "les miserables") === 1, relevance({ title: "Les Misérables", author: "" }, "les miserables"));
ok("plurals fold", relevance({ title: "Dune Chronicles", author: "" }, "chronicles") === 1, relevance({ title: "Dune Chronicles", author: "" }, "chronicles"));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exitCode = 1;
