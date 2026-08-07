/**
 * Native HTTP bridge for the Kora APK.
 *
 * Android WebView (Chromium 128+) blocks cross-origin requests from the secure
 * `https://localhost` origin to external HTTPS hosts (the APK loads its bundle
 * at https://localhost). That surfaces as `TypeError: Failed to fetch` in the
 * JS console for every `/api/*` call to the Kora Cloudflare worker.
 *
 * This module exposes `nativeFetch`, which routes `/api/*` requests through a
 * Capacitor plugin (`KoraHttp`) that uses the platform HttpURLConnection stack
 * instead of the WebView. That bypasses the localhost exception entirely.
 *
 * On web / non-native, `nativeFetch` is a no-op wrapper around the native
 * fetch so callers can use it unconditionally.
 */
import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "./capacitorNative";
import { getApiBaseUrl } from "./capacitorNative";

export interface KoraHttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  /** AbortSignal support (best-effort; the native plugin has no cancellation). */
  signal?: AbortSignal;
}

interface KoraHttpPlugin {
  request(options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
  }>;
}

let _plugin: KoraHttpPlugin | null = null;
function plugin(): KoraHttpPlugin | null {
  if (!isNativeApp()) return null;
  if (_plugin) return _plugin;
  try {
    _plugin = registerPlugin<KoraHttpPlugin>("KoraHttp");
    return _plugin;
  } catch {
    return null;
  }
}

/** Whether the native KoraHttp plugin is registered and usable. */
export function isNativeHttpAvailable(): boolean {
  if (!isNativeApp()) return false;
  return plugin() !== null;
}

/**
 * Resolve a /api/* input against the worker base URL. Mirrors resolveApiUrl but
 * returns the absolute URL for the native plugin to call directly.
 */
export function resolveApiUrlAbsolute(input: string): string {
  const base = getApiBaseUrl();
  if (!base) return input;
  if (input.startsWith("/api/") || input === "/api") {
    return `${base}${input}`;
  }
  try {
    const u = new URL(input, typeof window !== "undefined" ? window.location.origin : "https://localhost");
    if (u.pathname.startsWith("/api/")) {
      return `${base}${u.pathname}${u.search}${u.hash}`;
    }
  } catch {
    /* ignore */
  }
  return input;
}

/**
 * Fetch via the native HTTP stack. On non-native platforms falls back to fetch.
 * Accepts the same shapes as window.fetch (string URL, URL, Request) but only
 * the string form is needed for the /api/* call sites in Kora.
 */
export async function nativeFetch(
  input: RequestInfo | URL,
  init?: KoraHttpRequestOptions
): Promise<Response> {
  // Non-native: delegate to the browser/network stack (no localhost exception).
  if (!isNativeApp()) {
    return fetch(input as RequestInfo, init as RequestInit | undefined);
  }

  const p = plugin();
  if (!p) {
    // Plugin unavailable — fall back to fetch; it will hit the same localhost
    // error, but we'd rather degrade than crash.
    return fetch(input as RequestInfo, init as RequestInit | undefined);
  }

  // Abort handling (best-effort).
  if ((init?.signal as any)?.aborted) {
    throw new DOMException("The user aborted a request.", "AbortError");
  }
  const signal = init?.signal;
  if (signal?.aborted) {
    throw new DOMException("The user aborted a request.", "AbortError");
  }

  let urlStr: string;
  if (typeof input === "string") {
    urlStr = resolveApiUrlAbsolute(input);
  } else if (input instanceof URL) {
    urlStr = resolveApiUrlAbsolute(input.toString());
  } else {
    // Request object.
    urlStr = resolveApiUrlAbsolute(input.url);
  }

  const method = (init?.method || "GET").toUpperCase();
  const headers = (init?.headers as Record<string, string>) || {};

  let body: string | undefined;
  if (init?.body != null) {
    if (typeof init.body === "string") {
      body = init.body;
    } else if (init.body instanceof FormData) {
      // Native plugin can't handle FormData; fall back to fetch (rare for /api).
      return fetch(input as RequestInfo, init as RequestInit | undefined);
    } else {
      body = String(init.body);
    }
  }

  const result = await p.request({ url: urlStr, method, headers, body });

  // Build a Response the same way fetch would. We synthesize a body stream
  // from the returned text so response.body.getReader() (NDJSON streaming) works.
  const respHeaders = new Headers();
  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) {
      if (k) respHeaders.set(k, v);
    }
  }

  const responseInit: ResponseInit = {
    status: result.status,
    statusText: result.statusText || "",
    headers: respHeaders,
  };

  // For streaming NDJSON endpoints, constructing a Response from a string gives
  // a proper readable body stream on modern WebView. We pass the full body and
  // let the JS consumer read it line-by-line (the existing parsers split on
  // newlines, which works on the assembled text too).
  return new Response(result.body, responseInit);
}

/**
 * Patch window.fetch so that relative /api/* requests go through the native
 * HTTP bridge when running in the APK. Non-/api requests and non-native
 * platforms are untouched (delegating to the original fetch).
 */
export function installNativeHttpShim(): void {
  if (typeof window === "undefined") return;
  if (!isNativeApp()) return;

  const p = plugin();
  if (!p) {
    console.warn("[Kora/Http] KoraHttp native plugin unavailable — /api calls may fail.");
    return;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const base = getApiBaseUrl();
      let isApi = false;
      if (typeof input === "string") {
        isApi = input.startsWith("/api/") || (base && input.startsWith(base + "/api/"));
      } else if (input instanceof URL) {
        isApi = input.pathname.startsWith("/api/") || (base && input.href.startsWith(base + "/api/"));
      } else if (input instanceof Request) {
        const href = input.url || "";
        isApi = href.startsWith("/api/") || (base && href.startsWith(base + "/api/")) || href.includes("/api/");
      }

      if (!isApi) {
        return originalFetch(input, init);
      }

      return nativeFetch(input, init as KoraHttpRequestOptions | undefined);
    } catch (err) {
      // If the native bridge itself fails, fall back to the original fetch.
      // It may produce the same localhost error, but we avoid a hard crash.
      console.warn("[Kora/Http] native bridge error, falling back to fetch:", err);
      return originalFetch(input, init);
    }
  }) as typeof window.fetch;

  console.info("[Kora/Http] /api/* routed through native HTTP bridge");
}
