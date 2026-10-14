/**
 * Calibre Content Server client tests.
 *
 * The fixtures are taken from Calibre's own `srv/ajax.py` — `book_to_json`
 * and `search_result` — so these assert against the real response shape
 * rather than a shape I wished the server returned.
 *
 * `nativeFetch` is faked so no socket is ever opened.
 */

import {
  CalibreError,
  bookDownloadUrl,
  coverUrl,
  fetchBookFile,
  getBook,
  listBooks,
  listCategories,
  listLibraries,
  normaliseBook,
  normaliseServerUrl,
  searchBooks,
  testConnection,
  validateServerUrl,
  type CalibreConfig,
} from "../calibreClient";

// ── Fixture: /ajax/library-info ──────────────────────────────────────────
// `library_map` is {library_id: path}; `default_library` is a library id.
const LIBRARY_INFO = {
  library_map: { Calibre: "/home/user/Calibre Library", Fiction: "/mnt/books/fiction" },
  default_library: "Calibre",
};

// ── Fixture: one book as JsonCodec encodes it ────────────────────────────
// Mirrors book_to_json: cover/thumbnail are /get/... paths, formats is a
// lower-cased sorted list, main_format is {fmt: url}.
const BOOK = {
  id: 42,
  title: "The Left Hand of Darkness",
  authors: ["Ursula K. Le Guin"],
  formats: ["epub", "pdf"],
  pubdate: "1969-03-01T00:00:00+00:00",
  series: "Hainish Cycle",
  series_index: 4,
  publisher: "Ace Books",
  tags: ["Science Fiction"],
  identifiers: { isbn: "9780441478125" },
  cover: "/get/cover/42/calibre%20Library",
  thumbnail: "/get/thumb/42/calibre%20Library",
  main_format: { epub: "/get/epub/42/calibre%20Library" },
  other_formats: { pdf: "/get/pdf/42/calibre%20Library" },
};

const CFG: CalibreConfig = {
  serverUrl: "http://192.168.1.20:8080",
  username: "calibre",
  password: "calibre",
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

/** Captured request log, so we can assert on the wire format too. */
let requests: { url: string; headers: Record<string, string> }[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input);
  const headers = (init.headers || {}) as Record<string, string>;
  requests.push({ url, headers });

  const json = (body: unknown, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
      text: async () => JSON.stringify(body),
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
    }) as any;

  if (url.endsWith("/ajax/library-info")) return json(LIBRARY_INFO);
  if (/\/ajax\/books\//.test(url)) {
    // Calibre keys the response by book id and only returns the ids asked for.
    const q = new URL(url).searchParams.get("ids") || "";
    const wanted = new Set(q.split(",").filter(Boolean).map(Number));
    const out: Record<string, unknown> = {};
    for (const b of [BOOK, { ...BOOK, id: 7, title: "Kindred" }]) {
      if (wanted.has(b.id)) out[String(b.id)] = b;
    }
    return json(out);
  }
  if (/\/ajax\/book\/42\//.test(url)) return json(BOOK);
  if (/\/ajax\/search\//.test(url)) {
    return json({ total_num: 2, num: 2, offset: 0, sort: "title", book_ids: [42, 7] });
  }
  if (/\/ajax\/categories\//.test(url)) {
    return json({ tags: { tags: [{ name: "Science Fiction", count: 12 }] } });
  }
  if (/\/get\/epub\/42\//.test(url)) {
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/epub+zip" : null) },
      arrayBuffer: async () => new TextEncoder().encode("PK\u0003\u0004fake-epub").buffer,
    } as any;
  }
  return { ok: false, status: 404, headers: { get: () => null }, text: async () => "not found" } as any;
}) as any;

const { nativeFetch } = await import("../../nativeHttp");
void nativeFetch; // the client imports it; node runs the plain-fetch path

// ── URL handling ─────────────────────────────────────────────────────────
check("trailing slash stripped", normaliseServerUrl("http://h:8080/") === "http://h:8080");
check("scheme defaulted to http", normaliseServerUrl("192.168.1.5:8080") === "http://192.168.1.5:8080");
check("https preserved", normaliseServerUrl("https://books.example.com/") === "https://books.example.com");
check("empty stays empty", normaliseServerUrl("") === "");
check("valid url passes", validateServerUrl("192.168.1.5:8080").ok === true);
check(
  "ftp rejected",
  (validateServerUrl("ftp://h") as any).ok === false
);
check("blank rejected", (validateServerUrl("   ") as any).ok === false);

// ── listLibraries ────────────────────────────────────────────────────────
{
  const res = await listLibraries(CFG);
  check("two libraries returned", res.libraries.length === 2, res.libraries.length);
  check("default library id", res.defaultLibraryId === "Calibre", res.defaultLibraryId);
  const first = res.libraries[0];
  // Calibre derives a library's display name from the last path segment, so
  // "/home/user/Calibre Library" is named "Calibre Library", not "Calibre".
  check("library name from path basename", first?.name === "Calibre Library", first?.name);
  check("library id preserved", first?.libraryId === "Calibre", first?.libraryId);
  const second = res.libraries[1];
  check("second library name", second?.name === "fiction", second?.name);
}

// ── Basic auth is actually sent ──────────────────────────────────────────
{
  requests = [];
  await listLibraries(CFG);
  const auth = requests[0]?.headers?.Authorization || "";
  check("Basic auth header sent", auth.startsWith("Basic "), auth);
  const decoded = Buffer.from(auth.slice(6), "base64").toString();
  check("auth decodes to user:pass", decoded === "calibre:calibre", decoded);
}

// ── listBooks ────────────────────────────────────────────────────────────
{
  const books = await listBooks(CFG, "Calibre Library", [42, 7]);
  check("two books parsed", books.length === 2, books.length);
  const lhg = books.find((b) => b.id === 42)!;
  check("title", lhg.title === "The Left Hand of Darkness", lhg.title);
  check("authors", lhg.authors[0] === "Ursula K. Le Guin", lhg.authors[0]);
  check("formats lower-cased", lhg.formats.join(",") === "epub,pdf", lhg.formats.join(","));
  check("series", lhg.series === "Hainish Cycle", lhg.series);
  check("series_index numeric", lhg.series_index === 4, lhg.series_index);
  check("cover path kept", lhg.cover === "/get/cover/42/calibre%20Library", lhg.cover);
}
{
  // Empty ids short-circuits: a legitimate no-op, not a request.
  requests = [];
  const books = await listBooks(CFG, "Calibre", []);
  check("no ids -> no request", requests.length === 0 && books.length === 0);
}
{
  // A library id with a space must be encoded into the path.
  requests = [];
  await listBooks(CFG, "My Library", [42]);
  check("library id path-encoded", requests[0]?.url.includes("/ajax/books/My%20Library"), requests[0]?.url);
}

// ── getBook ──────────────────────────────────────────────────────────────
{
  const b = await getBook(CFG, "Calibre", 42);
  check("book fetched", b?.id === 42, b?.id);
}

// ── searchBooks ──────────────────────────────────────────────────────────
{
  const res = await searchBooks(CFG, "Calibre", "le guin", { num: 20, sort: "title" });
  check("search returns ids", res.bookIds.join(",") === "42,7", res.bookIds.join(","));
  check("search total", res.total === 2, res.total);
  requests = [];
  await searchBooks(CFG, "Calibre", "x", { num: 9999 });
  check("num clamped to 100", requests[0]?.url.includes("num=100"), requests[0]?.url);
  requests = [];
  await searchBooks(CFG, "Calibre", "x", { offset: -5 });
  check("offset floored at 0", requests[0]?.url.includes("offset=0"), requests[0]?.url);
  requests = [];
  await searchBooks(CFG, "Calibre", "x", { sortOrder: "sideways" as any });
  check("bogus sort order coerced to asc", requests[0]?.url.includes("sort_order=asc"), requests[0]?.url);
}

// ── listCategories ───────────────────────────────────────────────────────
{
  const cats = await listCategories(CFG, "Calibre");
  check("one category", cats.length === 1, cats.length);
  check("category name", cats[0]?.name === "Science Fiction", cats[0]?.name);
  check("category count", cats[0]?.count === 12, cats[0]?.count);
}

// ── Download URL + bytes ─────────────────────────────────────────────────
{
  const url = bookDownloadUrl(CFG, "Calibre Library", 42, "EPUB");
  check("download url shape", url === "http://192.168.1.20:8080/get/epub/42/Calibre%20Library", url);
}
{
  const { bytes, contentType } = await fetchBookFile(CFG, "Calibre", 42, "epub");
  check("bytes returned", bytes.byteLength > 0, bytes.byteLength);
  check("content type kept", contentType === "application/epub+zip", contentType);
}
{
  check("absolute cover url untouched", coverUrl(CFG, "https://x/y.png") === "https://x/y.png");
  check("relative cover url resolved", coverUrl(CFG, "/get/cover/1/L") === "http://192.168.1.20:8080/get/cover/1/L");
  check("missing cover -> empty", coverUrl(CFG, undefined) === "");
}

// ── normaliseBook is defensive about odd server data ─────────────────────
{
  check("null rejected", normaliseBook(null) === null);
  check("no id rejected", normaliseBook({ title: "x" }) === null);
  check("no title rejected", normaliseBook({ id: 1 }) === null);
  const b = normaliseBook({ id: 5, title: "T", authors: "not-an-array", formats: [1, "EPUB", null] });
  check("bad authors coerced to []", Array.isArray(b?.authors) && b.authors.length === 0, b?.authors);
  check("bad formats filtered + lower-cased", b?.formats.join(",") === "epub", b?.formats.join(","));
  check("missing series -> null", b?.series === null, b?.series);
  check("string id coerced to number", normaliseBook({ id: "9", title: "x" })?.id === 9);
}

// ── Error mapping ────────────────────────────────────────────────────────
{
  const realFetchRef = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({ ok: false, status: 401, headers: { get: () => "text/html" }, text: async () => "nope" }) as any) as any;
  try {
    await listLibraries(CFG);
    check("401 -> unauthorized", false, "did not throw");
  } catch (e: any) {
    check("401 -> CalibreError", e instanceof CalibreError, e?.name);
    check("401 -> reason unauthorized", e.reason === "unauthorized", e.reason);
    check("401 -> mentions credentials", /credential/i.test(e.message), e.message);
  } finally {
    globalThis.fetch = realFetchRef;
  }
}
{
  const realFetchRef = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({ ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => "<html>router login</html>" }) as any) as any;
  const res = await testConnection(CFG);
  check("non-JSON -> not ok", res.ok === false);
  if (!res.ok) {
    check("non-JSON -> malformed", res.error.reason === "malformed", res.error.reason);
    check("non-JSON message is actionable", /login page|router/i.test(res.error.message), res.error.message);
  }
  globalThis.fetch = realFetchRef;
}
{
  const realFetchRef = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as any;
  const res = await testConnection(CFG);
  check("network failure -> not ok", res.ok === false);
  if (!res.ok) {
    check("network failure -> unreachable", res.error.reason === "unreachable", res.error.reason);
    check("unreachable message mentions CORS + app", /CORS|Android app/i.test(res.error.message), res.error.message);
  }
  globalThis.fetch = realFetchRef;
}
{
  const realFetchRef = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({ ok: false, status: 404, headers: { get: () => null }, text: async () => "" }) as any) as any;
  const res = await testConnection(CFG);
  check("404 -> not-found", !res.ok && res.error.reason === "not-found", res.ok ? "ok" : res.error.reason);
  globalThis.fetch = realFetchRef;
}
{
  // No library selected is a caller error, and must not hit the network.
  requests = [];
  let threw = false;
  try {
    await listBooks(CFG, "", [1]);
  } catch (e: any) {
    threw = e.reason === "malformed";
  }
  check("empty library id -> malformed, no request", threw && requests.length === 0);
}

// ── Credentials never leak into a URL ────────────────────────────────────
{
  requests = [];
  await listLibraries(CFG);
  check("password not in url", !requests[0]?.url.includes("calibre"), requests[0]?.url);
}

globalThis.fetch = realFetch;

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
