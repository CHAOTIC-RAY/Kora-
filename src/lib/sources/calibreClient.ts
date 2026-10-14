/**
 * Calibre Content Server client.
 *
 * Talks to the HTTP Content Server that ships with Calibre
 * (`calibre server`, usually port 8080). Endpoints and response shapes are
 * taken from Calibre's own source, not from guesswork:
 *
 *   GET /ajax/library-info            -> { library_map, default_library }
 *   GET /ajax/books/{library_id}      -> { "<book_id>": Book }   (ids=?a,b)
 *   GET /ajax/book/{book_id}/{lib}    -> Book
 *   GET /ajax/categories/{library_id} -> { tags: CategoryNode[] }
 *   GET /ajax/search/{library_id}     -> { book_ids, total_num, ... }
 *   GET /get/{fmt}/{book_id}/{lib}    -> raw file bytes
 *
 * (`src/calibre/srv/ajax.py` and `content.py` in the calibre repo.)
 *
 * ## Why this does NOT go through the Worker relay
 *
 * The source plugins relay through `/api/source-fetch` because manga sites sit
 * behind bot walls. Calibre is the opposite case: it is a server *you* run,
 * usually on your own LAN, and its content server sends **no CORS headers at
 * all** (verified across every module in `src/calibre/srv/`). So:
 *
 *  - A Cloudflare Worker cannot reach `192.168.x.x` anyway, and shipping the
 *    user's LAN address plus their password to a third-party relay would be
 *    both useless and reckless.
 *  - A plain browser `fetch` is blocked by CORS, so it only works when the
 *    server is same-origin or has been put behind a proxy that adds the
 *    headers.
 *  - In the **Android APK** it works properly: `nativeFetch` routes through the
 *    `KoraHttp` Capacitor plugin, which uses the platform HTTP stack and is
 *    not subject to CORS at all. That is the supported path.
 *
 * So this client calls the server directly and reports *why* a failure
 * happened, instead of pretending a LAN address is reachable from a Worker.
 * Credentials never leave the device and are never written to a log.
 */

import { nativeFetch } from "../nativeHttp";

export interface CalibreConfig {
  /** Base URL of the content server, e.g. `http://192.168.1.20:8080`. */
  serverUrl: string;
  /** HTTP Basic username. Calibre defaults to `calibre`. */
  username: string;
  /** HTTP Basic password. Stored locally only; never sent anywhere but the server. */
  password: string;
}

export interface CalibreLibrary {
  /** The `library_id` used in every other endpoint's path. */
  libraryId: string;
  name: string;
  path: string;
}

/** A book as Calibre's JSON codec returns it. */
export interface CalibreBook {
  id: number;
  title: string;
  authors: string[];
  /** Lower-case format names, e.g. `["epub", "pdf"]`. */
  formats: string[];
  /** e.g. `"2024-03-01T00:00:00+00:00"`, or absent. */
  pubdate?: string;
  series?: string | null;
  series_index?: number | null;
  publisher?: string | null;
  tags?: string[];
  identifiers?: Record<string, string>;
  /** Path on the Calibre server, e.g. `/get/cover/42/calibre%20Library`. */
  cover?: string;
  thumbnail?: string;
  /** Absolute-path hints Calibre attaches; used for download URLs. */
  main_format?: Record<string, string> | null;
  other_formats?: Record<string, string> | null;
}

export interface CalibreSearchResult {
  bookIds: number[];
  total: number;
}

/** A failure the UI can show verbatim, with a reason the user can act on. */
export class CalibreError extends Error {
  readonly status: number;
  readonly reason: CalibreErrorReason;
  constructor(message: string, status: number, reason: CalibreErrorReason) {
    super(message);
    this.name = "CalibreError";
    this.status = status;
    this.reason = reason;
  }
}

export type CalibreErrorReason =
  | "unreachable"
  | "cors"
  | "unauthorized"
  | "not-found"
  | "malformed"
  | "server";

/**
 * Normalise a base URL: no trailing slash, scheme required.
 *
 * A user typing `192.168.1.5:8080` means http, so a bare host gets `http://`.
 * But an *explicit* non-http scheme (`ftp://`, `file://`) must be rejected
 * rather than prefixed — prefixing it would produce `http://ftp://h`, which
 * parses cleanly as host `ftp` and sails through validation as a valid address
 * pointing at the wrong place entirely.
 */
export function normaliseServerUrl(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  const scheme = schemeMatch?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return "";
  const withScheme = scheme ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

/** Reject an obviously wrong host before we bother the network. */
export function validateServerUrl(
  raw: string
): { ok: true; url: string; error?: undefined } | { ok: false; url?: undefined; error: string } {
  const url = normaliseServerUrl(raw);
  if (!url) return { ok: false, error: "Enter your Calibre server address." };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "That is not a valid address." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Address must start with http:// or https://" };
  }
  if (!parsed.hostname) return { ok: false, error: "That address has no host." };
  return { ok: true, url };
}

function authHeader(cfg: CalibreConfig): string {
  // btoa is unavailable in some non-browser test environments; Buffer is not
  // available in the browser. Use whichever exists.
  const raw = `${cfg.username}:${cfg.password}`;
  const b64 =
    typeof btoa === "function"
      ? btoa(raw)
      : Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${b64}`;
}

/**
 * Turn a thrown fetch error into something a person can act on.
 *
 * A TypeError from `fetch` is the browser refusing to tell us why, and in
 * practice it means one of: no route to the host, or a CORS preflight block.
 * Those need very different advice, so say both.
 */
function explainTransportError(err: unknown, url: string): CalibreError {
  const detail = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(detail)) {
    return new CalibreError(
      `Could not reach ${url}. Check that the Calibre server is running, that ` +
        "this device is on the same network, and that the address is correct. " +
        "In a desktop browser the Calibre content server also sends no CORS " +
        "headers, so use the Android app, or put the server behind a proxy " +
        "that adds them.",
      0,
      "unreachable"
    );
  }
  return new CalibreError(detail || "Request failed", 0, "server");
}

interface RawResult {
  status: number;
  body: string;
  contentType: string;
}

/** One authenticated GET against the Calibre server. */
async function calibreGet(
  cfg: CalibreConfig,
  path: string
): Promise<RawResult> {
  const base = normaliseServerUrl(cfg.serverUrl);
  const url = `${base}${path}`;
  let res: Response;
  try {
    res = await nativeFetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader(cfg),
        Accept: "application/json, text/plain, */*",
      },
    });
  } catch (err) {
    throw explainTransportError(err, base);
  }

  const contentType = res.headers?.get?.("content-type") || "";
  const body = await res.text();

  if (res.status === 401 || res.status === 403) {
    throw new CalibreError(
      "Calibre rejected these credentials. Check the username and password " +
        "in Calibre's server settings.",
      res.status,
      "unauthorized"
    );
  }
  if (res.status === 404) {
    throw new CalibreError(
      `Calibre has no such endpoint: ${path}`,
      404,
      "not-found"
    );
  }
  if (!res.ok) {
    throw new CalibreError(
      `Calibre returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      res.status,
      "server"
    );
  }
  return { status: res.status, body, contentType };
}

async function calibreGetJson<T>(cfg: CalibreConfig, path: string): Promise<T> {
  const raw = await calibreGet(cfg, path);
  if (!raw.body.trim()) {
    throw new CalibreError(
      `Calibre returned an empty body for ${path}`,
      raw.status,
      "malformed"
    );
  }
  try {
    return JSON.parse(raw.body) as T;
  } catch {
    // A non-JSON body here almost always means the URL pointed at something
    // that is not Calibre (a captive portal, a router login page).
    throw new CalibreError(
      "Calibre did not return JSON. Check that the address points at the " +
        "Calibre content server and not a login page or router.",
      raw.status,
      "malformed"
    );
  }
}

/** `library_id` is a path segment, so it must be encoded. */
function libSeg(libraryId: string): string {
  return encodeURIComponent(libraryId);
}

/**
 * The libraries this server exposes.
 *
 * `library_map` is `{ library_id: path }`; the readable name is the last path
 * segment, which is how Calibre itself derives it.
 */
export async function listLibraries(
  cfg: CalibreConfig
): Promise<{ libraries: CalibreLibrary[]; defaultLibraryId: string | null }> {
  const data = await calibreGetJson<{
    library_map?: Record<string, string> | null;
    default_library?: string | null;
  }>(cfg, "/ajax/library-info");

  const map = data.library_map;
  if (!map || typeof map !== "object") {
    throw new CalibreError(
      "Calibre did not return a library map.",
      200,
      "malformed"
    );
  }
  const libraries = Object.entries(map).map(([libraryId, path]) => ({
    libraryId,
    path: String(path),
    name: String(path).split(/[/\\]/).filter(Boolean).pop() || libraryId,
  }));
  return { libraries, defaultLibraryId: data.default_library || null };
}

/**
 * Fetch specific books by id.
 *
 * `/ajax/books/{lib}` returns an object keyed by book id, and accepts an
 * `ids=` query. An empty result is a legitimate answer (the ids are gone), not
 * an error, so it resolves to an empty array.
 */
export async function listBooks(
  cfg: CalibreConfig,
  libraryId: string,
  ids: number[]
): Promise<CalibreBook[]> {
  if (!libraryId) {
    throw new CalibreError("No library selected.", 0, "malformed");
  }
  if (!ids.length) return [];

  const query = ids.map((id) => String(id)).join(",");
  const data = await calibreGetJson<Record<string, unknown>>(
    cfg,
    `/ajax/books/${libSeg(libraryId)}?ids=${encodeURIComponent(query)}`
  );

  return Object.values(data ?? {})
    .map((b) => normaliseBook(b))
    .filter((b): b is CalibreBook => b !== null);
}

/** One book, by id. Returns null when Calibre no longer has it. */
export async function getBook(
  cfg: CalibreConfig,
  libraryId: string,
  bookId: number
): Promise<CalibreBook | null> {
  const data = await calibreGetJson<unknown>(
    cfg,
    `/ajax/book/${bookId}/${libSeg(libraryId)}`
  );
  return normaliseBook(data);
}

/**
 * Search. `query` uses Calibre's own search syntax (empty = everything).
 * `num`/`offset` are Calibre's pagination; it caps `num` server-side.
 */
export async function searchBooks(
  cfg: CalibreConfig,
  libraryId: string,
  query: string,
  opts: { num?: number; offset?: number; sort?: string; sortOrder?: "asc" | "desc" } = {}
): Promise<CalibreSearchResult> {
  if (!libraryId) {
    throw new CalibreError("No library selected.", 0, "malformed");
  }
  const num = Math.max(1, Math.min(100, opts.num ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const sort = opts.sort || "title";
  const sortOrder = opts.sortOrder === "desc" ? "desc" : "asc";

  const params = new URLSearchParams({
    query,
    num: String(num),
    offset: String(offset),
    sort,
    sort_order: sortOrder,
  });
  const data = await calibreGetJson<{
    book_ids?: number[] | null;
    total_num?: number | null;
  }>(cfg, `/ajax/search/${libSeg(libraryId)}?${params.toString()}`);

  return {
    bookIds: Array.isArray(data.book_ids) ? data.book_ids : [],
    total: typeof data.total_num === "number" ? data.total_num : 0,
  };
}

/** The tag/category tree, for browsing. */
export async function listCategories(
  cfg: CalibreConfig,
  libraryId: string
): Promise<CalibreCategory[]> {
  const data = await calibreGetJson<{ tags?: unknown }>(
    cfg,
    `/ajax/categories/${libSeg(libraryId)}`
  );
  const tags = (data.tags ?? {}) as Record<string, unknown>;
  return Object.entries(tags).flatMap(([field, value]) => {
    const nodes = Array.isArray(value) ? value : [];
    return nodes.map((n) => {
      const node = (n ?? {}) as Record<string, unknown>;
      return {
        field,
        name: String(node.name ?? ""),
        count: typeof node.count === "number" ? node.count : 0,
      };
    });
  });
}

export interface CalibreCategory {
  field: string;
  name: string;
  count: number;
}

/**
 * Download URL for one format of a book.
 *
 * Calibre serves raw bytes at `/get/{fmt}/{book_id}/{library_id}`. We return
 * the URL rather than the bytes so the caller can hand it to the normal
 * download path (and so a multi-megabyte EPUB never round-trips through JSON).
 */
export function bookDownloadUrl(
  cfg: CalibreConfig,
  libraryId: string,
  bookId: number,
  format: string
): string {
  const base = normaliseServerUrl(cfg.serverUrl);
  return `${base}/get/${encodeURIComponent(format.toLowerCase())}/${bookId}/${libSeg(libraryId)}`;
}

/** Cover/thumbnail URL, resolved against the server base. */
export function coverUrl(cfg: CalibreConfig, path: string | undefined): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const base = normaliseServerUrl(cfg.serverUrl);
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * Download a book's bytes. Needs auth, so it cannot be a plain `<img>` or
 * `<a href>` — it goes through the same authenticated fetch path.
 */
export async function fetchBookFile(
  cfg: CalibreConfig,
  libraryId: string,
  bookId: number,
  format: string
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const base = normaliseServerUrl(cfg.serverUrl);
  const url = bookDownloadUrl(cfg, libraryId, bookId, format);
  let res: Response;
  try {
    res = await nativeFetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader(cfg),
        Accept: "*/*",
      },
    });
  } catch (err) {
    throw explainTransportError(err, base);
  }
  if (res.status === 401 || res.status === 403) {
    throw new CalibreError("Calibre rejected these credentials.", res.status, "unauthorized");
  }
  if (!res.ok) {
    throw new CalibreError(
      `Calibre returned ${res.status} downloading ${format}.`,
      res.status,
      "server"
    );
  }
  const contentType = res.headers?.get?.("content-type") || "application/octet-stream";
  const bytes = await res.arrayBuffer();
  return { bytes, contentType };
}

/**
 * Coerce one entry from Calibre's book JSON into our shape.
 *
 * Calibre omits null fields entirely and leaves `authors` as a list of
 * strings, but custom columns can put odd values in `series`/`publisher`, so
 * nothing here trusts the type it was handed.
 */
export function normaliseBook(raw: unknown): CalibreBook | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const id = typeof b.id === "number" ? b.id : Number(b.id);
  if (!Number.isFinite(id)) return null;
  const title = typeof b.title === "string" ? b.title : "";
  if (!title) return null;

  const authors = Array.isArray(b.authors)
    ? b.authors.filter((a): a is string => typeof a === "string")
    : [];

  const formats = Array.isArray(b.formats)
    ? b.formats.filter((f): f is string => typeof f === "string").map((f) => f.toLowerCase())
    : [];

  const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  const asNumber = (v: unknown): number | null => (typeof v === "number" ? v : null);

  return {
    id,
    title,
    authors,
    formats,
    pubdate: asString(b.pubdate) ?? undefined,
    series: asString(b.series),
    series_index: asNumber(b.series_index),
    publisher: asString(b.publisher),
    tags: Array.isArray(b.tags) ? b.tags.filter((t): t is string => typeof t === "string") : [],
    identifiers:
      b.identifiers && typeof b.identifiers === "object"
        ? (b.identifiers as Record<string, string>)
        : {},
    cover: asString(b.cover) ?? undefined,
    thumbnail: asString(b.thumbnail) ?? undefined,
    main_format:
      b.main_format && typeof b.main_format === "object"
        ? (b.main_format as Record<string, string>)
        : null,
    other_formats:
      b.other_formats && typeof b.other_formats === "object"
        ? (b.other_formats as Record<string, string>)
        : null,
  };
}

/** A short "did it work" probe for the settings screen's Test button. */
export async function testConnection(
  cfg: CalibreConfig
): Promise<
  | { ok: true; libraries: CalibreLibrary[]; defaultLibraryId: string | null; error?: undefined }
  | { ok: false; libraries?: undefined; defaultLibraryId?: undefined; error: CalibreError }
> {
  try {
    const res = await listLibraries(cfg);
    return { ok: true, ...res };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof CalibreError
          ? err
          : new CalibreError(String(err), 0, "server"),
    };
  }
}
