/**
 * Shared `/api/source-fetch` implementation for the Worker and Node server.
 *
 * Fetches upstream HTML/JSON for installed source plugins. Callers in the SPA
 * send the target URL plus the plugin's `baseUrl` so we only relay hosts that
 * belong to that manifest (SSRF + scope). {@link assertSafeFetchTarget} blocks
 * private/metadata addresses.
 */

import { assertSafeFetchTarget } from "./ssrfGuard";

export const SOURCE_FETCH_MAX_BYTES = 5_000_000;
export const SOURCE_FETCH_TIMEOUT_MS = 25_000;

export interface SourceFetchRequest {
  /** Absolute URL to fetch */
  url: string;
  /** Plugin baseUrl from the manifest (required for host scoping) */
  baseUrl?: string;
  /** Page referer passed through to upstream */
  referer?: string;
  /** Extra headers from the plugin definition */
  extraHeaders?: Record<string, string>;
}

export interface SourceFetchResult {
  ok: boolean;
  status: number;
  body: string;
  finalUrl: string;
  error?: string;
  truncated?: boolean;
}

export const SOURCE_FETCH_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Source-Headers",
};

/** Hostnames allowed for open legal book APIs without a piracy opt-in. */
const PUBLIC_LEGAL_SOURCE_HOSTS = new Set([
  "gutendex.com",
  "www.gutenberg.org",
  "gutenberg.org",
  "archive.org",
  "chem.libretexts.org",
  "libretexts.org",
  "downloads.libretexts.org",
]);

function registrableRoot(hostname: string): string {
  const h = hostname.toLowerCase();
  const parts = h.split(".");
  if (parts.length < 2) return h;
  return parts.slice(-2).join(".");
}

/**
 * True when `target` may be fetched for a plugin whose manifest declares `baseUrl`.
 */
export function urlAllowedForPluginBase(target: URL, baseUrl: string): boolean {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  const targetHost = target.hostname.toLowerCase();
  const baseHost = base.hostname.toLowerCase();
  if (targetHost === baseHost) return true;
  if (targetHost.endsWith(`.${baseHost}`)) return true;
  const root = registrableRoot(baseHost);
  if (targetHost === root || targetHost.endsWith(`.${root}`)) return true;
  return false;
}

export function isPublicLegalSourceHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (PUBLIC_LEGAL_SOURCE_HOSTS.has(h)) return true;
  if (h.endsWith(".libretexts.org")) return true;
  return false;
}

function decodeExtraHeaders(raw: string | null | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function readLimitedText(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) {
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    return {
      text: new TextDecoder("utf-8", { fatal: false }).decode(slice),
      truncated: buf.byteLength > maxBytes,
    };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.length > maxBytes) {
      chunks.push(value.slice(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), truncated };
}

/**
 * Perform the guarded upstream fetch. Safe to call from Express or the Worker.
 */
export async function executeSourceFetch(req: SourceFetchRequest): Promise<SourceFetchResult> {
  const guard = assertSafeFetchTarget(req.url);
  if (!guard.ok || !guard.parsed) {
    return {
      ok: false,
      status: 400,
      body: "",
      finalUrl: req.url,
      error: guard.reason || "URL not allowed",
    };
  }
  const target = guard.parsed;

  const base = (req.baseUrl || "").trim();
  if (!base) {
    return {
      ok: false,
      status: 400,
      body: "",
      finalUrl: req.url,
      error: "Missing plugin base URL.",
    };
  }

  if (!urlAllowedForPluginBase(target, base)) {
    return {
      ok: false,
      status: 403,
      body: "",
      finalUrl: req.url,
      error: "That host is not allowed for this source.",
    };
  }

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    ...(req.extraHeaders || {}),
  };
  const ref = (req.referer || base).trim();
  if (ref) headers.Referer = ref;

  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
    });

    const ctype = upstream.headers.get("content-type") || "";
    if (/^image\//i.test(ctype)) {
      return {
        ok: false,
        status: 415,
        body: "",
        finalUrl: upstream.url || target.toString(),
        error: "Binary image responses must use /api/proxy-image.",
      };
    }

    const { text, truncated } = await readLimitedText(upstream, SOURCE_FETCH_MAX_BYTES);
  const finalUrl = upstream.url || target.toString();
    const ok = upstream.ok;

    return {
      ok,
      status: upstream.status,
      body: text,
      finalUrl,
      truncated: truncated || undefined,
      error: ok ? undefined : `Upstream HTTP ${upstream.status}`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 504,
      body: "",
      finalUrl: target.toString(),
      error: message.includes("abort") ? "Source fetch timed out." : message,
    };
  }
}

/** Express-style query map */
export function parseSourceFetchQuery(query: Record<string, unknown>, headerJson?: string | null): SourceFetchRequest | { error: string; status: number } {
  const url = String(query.u || query.url || "").trim();
  if (!url) return { error: "Missing url parameter (u).", status: 400 };
  const baseUrl = String(query.b || query.base || "").trim();
  const referer = String(query.r || query.referer || "").trim() || undefined;
  const extraHeaders = decodeExtraHeaders(headerJson);
  return { url, baseUrl: baseUrl || undefined, referer, extraHeaders };
}

export function sourceFetchJsonResponse(result: SourceFetchResult, initHeaders?: Record<string, string>): {
  status: number;
  body: string;
  headers: Record<string, string>;
} {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...SOURCE_FETCH_CORS_HEADERS,
    ...(initHeaders || {}),
  };
  const payload = {
    ok: result.ok,
    status: result.status,
    body: result.body,
    finalUrl: result.finalUrl,
    error: result.error,
    truncated: result.truncated,
  };
  const status = result.ok ? 200 : result.status >= 400 ? result.status : 502;
  return { status, body: JSON.stringify(payload), headers };
}
