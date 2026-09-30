/**
 * Send to Kobo/Kindle — the browser-facing side of the sender.
 *
 * WHAT THIS USED TO BE, AND WHY IT IS NOT ANY MORE. This module shipped with
 * three routes: a real upload to send.djazz.se, a manual open of kdrop.me, and
 * a manual open of Amazon's Send to Kindle. djazz is gone. kdrop is gone. Both
 * are gone because the ask was to stop leaning on somebody else's server for a
 * feature people use weekly — a reader's library passing through an unrelated
 * third party's disk, under their retention policy and their uptime, is a
 * dependency Kora should not have. Kora's own Worker now does the job:
 *
 *   1. On the e-reader, open <origin>/send. The page shows a 4-character code
 *      and waits.
 *   2. Here, type that code and send. The file goes to Kora's Worker.
 *   3. The device page notices, downloads, and the Worker deletes the file the
 *      moment it is taken.
 *
 * The relay's endpoints, TTLs, rate limits and filename sanitisation live in
 * `src/lib/relay/`. Its HTTP client is `koraRelaySender.ts`, kept separate so
 * this module stays free of network code — which is also what lets the
 * structural test at the bottom of koboKindleSender.test.ts assert that no
 * `fetch(` appears here at all.
 *
 * WHAT IS STILL HERE AND WHY. Amazon's own Send to Kindle page is kept, as
 * asked. It is a genuinely different thing rather than a leftover: it is the
 * route that works when the device cannot run Kora's page — no code, no
 * polling, just Amazon's own import. It stays labelled as the alternative and
 * is never a fallback; see `shareOrDownloadForAmazon`, a separate exported
 * call precisely so that no code path can quietly turn into it.
 *
 * WHAT WENT WITH kdrop. `api.kdrop.me` does not resolve (NXDOMAIN against
 * 8.8.8.8) and the site is behind a Cloudflare Turnstile human check, so there
 * was never a POST contract to call — it could only ever be a manual "go open
 * this page yourself" route, i.e. a worse version of the Amazon route with a
 * worse reputation. Keeping it would have kept a third-party dependency alive
 * for zero capability.
 *
 * CANCELLATION. An empty or malformed code, an aborted upload, or a dismissed
 * share sheet is the user changing their mind. That is reported as
 * `cancelled`, never as `ok` and never as a failure toast. Same convention as
 * the OS share path in `kindleClient.ts`.
 *
 * NO CREDENTIALS. Nothing here reads, stores, or sends an account, key, or
 * token. The 4-character code is a pairing code for one transfer between two
 * devices the user is holding, not a secret — the relay's actual authorisation
 * is a 128-bit secret that never leaves the e-reader page.
 */

import type { PluginManifest } from "./types";
import {
  normalizeDeviceCode,
  sendToDeviceViaRelay,
  type SendToDeviceResult,
} from "./koraRelaySender";

// ── Kora's own relay ────────────────────────────────────────────────────────

/** The e-reader page. Same-origin, so the path is the whole URL. */
export const EREADER_URL = "/send";
export const EREADER_UPLOAD_ENDPOINT = "/api/relay/upload";
export const EREADER_REGISTER_ENDPOINT = "/api/relay/register";
export const EREADER_STATUS_ENDPOINT = "/api/relay/status";

/** Alias, so callers written against the newer name resolve. */
export const RELAY_PAGE_URL = EREADER_URL;

/** Amazon's own page. Kept as the official alternative, per the ask. */
export const AMAZON_SEND_URL = "https://www.amazon.com/sendtokindle";

/**
 * kdrop.me. NOT a route any more. Retained as an exported constant so the
 * removal is visible in one place rather than as an absence nobody can grep
 * for. Nothing in this file opens it, and `koboKindleSender.test.ts` asserts
 * that.
 */
export const KDROP_URL = "https://kdrop.me/";

/**
 * What the relay will carry. Wider than djazz's form was, on purpose: this is
 * now OUR list, and the formats a Kora library actually holds include the
 * Amazon-native ones djazz would have refused (.azw3, .azw) plus Kindle's
 * .kfx. Refusing to send a Kindle a .azw3 would be refusing to do the job, so
 * they are accepted; `KINDLE_NATIVE_EXTENSIONS` lets the panel still say which
 * device each format suits.
 */
export const EREADER_ACCEPT = ".epub,.mobi,.azw3,.azw,.kfx,.pdf,.txt,.cbz,.cbr";
export const EREADER_EXTENSIONS = [
  ".epub",
  ".mobi",
  ".azw3",
  ".azw",
  ".kfx",
  ".pdf",
  ".txt",
  ".cbz",
  ".cbr",
];

/** Amazon-native formats, called out so the panel can label them. */
export const KINDLE_NATIVE_EXTENSIONS = [".azw3", ".azw", ".kfx", ".mobi"];

/**
 * The relay's multipart fields. A `code` and a `file`.
 *
 * djazz's conversion checkboxes (kepubify, kindlegen, pdfcropmargins,
 * transliteration) were conversions performed on djazz's server. There is no
 * equivalent here, so they are accepted as arguments and ignored rather than
 * posted as fields that do nothing.
 */
export const EREADER_FIELDS = {
  code: "code",
  file: "file",
} as const;

/** The pairing code the device shows is exactly four characters. */
export const EREADER_KEY_LENGTH = 4;

export type EreaderRoute = "kora-relay" | "amazon-manual";

export interface EreaderResult {
  ok: boolean;
  route: EreaderRoute;
  /** Human-readable, shown verbatim. Never claim more than actually happened. */
  reason: string;
  /** The user's own decision, not a failure. */
  cancelled?: boolean;
  /** Which path actually ran. Never omitted on a success. */
  method?: "kora-relay" | "local-download" | "share-sheet";
}

export interface EreaderDeps {
  document?: EreaderDocumentLike;
  navigator?: EreaderNavigatorLike;
  openUrl?: (url: string) => void;
  getCachedFile?: (bookId: string) => Promise<CachedFileLike | null>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  /**
   * The relay HTTP call, injectable.
   *
   * The real one is a same-origin XHR with real byte progress; the seam exists
   * so this module can be exercised in plain Node, and so a test can prove the
   * cancellation contract without a network stack.
   */
  sendViaRelay?: typeof sendToDeviceViaRelay;
  /** Cancellation handle for the in-flight upload. */
  abortSignal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

export interface CachedFileLike {
  blob: Blob;
  fileName: string;
  extension: string;
}

interface EreaderElementLike {
  tagName?: string;
  type?: string;
  name?: string;
  value?: string;
  href?: string;
  checked?: boolean;
  enctype?: string;
  method?: string;
  action?: string;
  target?: string;
  accept?: string;
  files?: unknown;
  setAttribute?: (k: string, v: string) => void;
  appendChild?: (c: unknown) => void;
  remove?: () => void;
  click?: () => void;
  submit?: () => void;
  style?: { display?: string };
}

interface EreaderDocumentLike {
  createElement: (tag: string) => EreaderElementLike;
  body?: { appendChild: (c: unknown) => void } | null;
}

interface EreaderNavigatorLike {
  canShare?: (d: { files?: File[] }) => boolean;
  share?: (d: { files?: File[]; title?: string }) => Promise<void>;
}

/**
 * Normalise the 4-character device code.
 *
 * Delegates to the relay's own normaliser, which is authoritative: it enforces
 * the 31-character alphabet (no 0/O, no 1/I/L, no lowercase after folding). A
 * code containing an ambiguous glyph is rejected rather than sent, because a
 * silently "corrected" code on an unauthenticated fetch endpoint is a code
 * that means something other than what the user believes they typed.
 *
 * Kept under its old name because the panel, the tests and the plugin all call
 * it; the behaviour is the relay's, not this module's.
 */
export function normalizeEreaderKey(raw: string | null | undefined): string | null {
  return normalizeDeviceCode(raw ?? "");
}

/** Whether the relay will carry this file type at all. */
export function isEreaderAcceptedExtension(ext: string | undefined | null): boolean {
  const e = (ext || "").trim().toLowerCase().replace(/^\./, "");
  return EREADER_EXTENSIONS.includes(`.${e}`);
}

export function isKindleNativeExtension(ext: string | undefined | null): boolean {
  const e = (ext || "").trim().toLowerCase().replace(/^\./, "");
  return KINDLE_NATIVE_EXTENSIONS.includes(`.${e}`);
}

/**
 * The exact multipart field set the relay's upload takes.
 *
 * Pure and exported so the contract is assertable without a DOM — this is the
 * thing that would silently rot if it were buried inside an upload handler.
 * The conversion flags are accepted for call-site compatibility and produce
 * nothing: they were djazz server-side conversions, and posting a field the
 * server ignores would be a lie in the form.
 */
export function buildEreaderUploadFields(opts: {
  key: string;
  kepubify?: boolean;
  kindlegen?: boolean;
  pdfCropMargins?: boolean;
  transliteration?: boolean;
}): Record<string, string> {
  const fields: Record<string, string> = {};
  const key = normalizeEreaderKey(opts.key);
  if (key) fields[EREADER_FIELDS.code] = key;
  return fields;
}

// ── The plugin's display name ────────────────────────────────────────────────

/** The name this integration ships under in-app. */
export const KOBO_KINDLE_LABEL = "Send to Kobo/Kindle";

/** The name it shipped under before the rename. */
const LEGACY_KINDLE_LABELS = new Set(["send to kindle"]);

/**
 * Display name for an installed plugin, with the Kindle integration renamed.
 *
 * The registry manifest is a separate, externally-fetched artefact (the Kora
 * -Sources repo), so its `name` is still the old one and this repo must not
 * pretend the registry was rewritten. Rather than show a stale "Send to
 * Kindle" on a panel that now uploads to Kobo as well, the label is normalised
 * here — one place, so the hub card and the Workshop tile can never disagree.
 */
export function pluginDisplayName(manifest: Pick<PluginManifest, "name" | "category" | "target">): string {
  if (manifest.category !== "integration") return manifest.name;
  // `target` is the reliable signal. The name check is a fallback for a manifest
  // that predates it — scoped to integrations on purpose, so a theme or tool
  // that happens to be called "Send to Kindle" is left alone.
  if (manifest.target === "kindle" || LEGACY_KINDLE_LABELS.has(manifest.name.trim().toLowerCase())) {
    return KOBO_KINDLE_LABEL;
  }
  return manifest.name;
}

/** One line describing where each route actually sends the file. */
export function describeEreaderRoute(route: EreaderRoute): string {
  switch (route) {
    case "kora-relay":
      return "Uploads straight to your device through Kora's own relay. Nothing goes to a third party.";
    case "amazon-manual":
      return "Opens Amazon's own Send to Kindle page.";
  }
}

// ── The real upload ──────────────────────────────────────────────────────────

const DEFAULT_MIME = "application/octet-stream";

function resolve<T>(override: T | undefined, fallback: T | undefined): T | undefined {
  return override !== undefined ? override : fallback;
}

/** Map a relay result onto the panel's result shape, without inventing success. */
function fromRelayResult(result: SendToDeviceResult, fileName: string, code: string): EreaderResult {
  if (result.status === "cancelled") {
    return {
      ok: false,
      cancelled: true,
      route: "kora-relay",
      reason: "Upload cancelled. Nothing was sent.",
    };
  }
  if (result.status === "error") {
    return { ok: false, route: "kora-relay", reason: result.error };
  }
  return {
    ok: true,
    route: "kora-relay",
    method: result.method,
    reason: `Sent ${result.fileName || fileName} to your e-reader using code ${code}. ${result.message}`,
  };
}

/**
 * Upload a cached book to the device through Kora's own relay.
 *
 * The flow is: the device sits on `<origin>/send` showing a 4-character code;
 * the user types it here; the bytes go to Kora's Worker tagged with that code;
 * the device page polls, downloads, and the Worker deletes the file. No tab
 * opens and no third party is involved, which is the whole improvement over the
 * form POST this used to build.
 *
 * The contract preserved from the sender it replaces: `ok: true` means the file
 * is in the device's waiting slot, a cancellation is never a success, and no
 * path here degrades to a local download.
 */
export async function uploadToEreader(
  bookId: string,
  opts: {
    key: string;
    title?: string;
    extension?: string;
    /** Accepted and ignored — djazz's server-side conversions have no equivalent. */
    kepubify?: boolean;
    kindlegen?: boolean;
    pdfCropMargins?: boolean;
    transliteration?: boolean;
  } & EreaderDeps
): Promise<EreaderResult> {
  const { key, title, extension, abortSignal, onProgress, ...deps } = opts;

  const code = normalizeEreaderKey(key);
  if (!code) {
    // An empty or malformed code is the user not having got to the device yet.
    return {
      ok: false,
      cancelled: true,
      route: "kora-relay",
      reason: `No device code yet. Open Kora's Send page in your Kobo/Kindle's browser and enter the ${EREADER_KEY_LENGTH}-character code it shows.`,
    };
  }

  const getCachedFile = deps.getCachedFile;
  if (!getCachedFile) {
    return {
      ok: false,
      route: "kora-relay",
      reason: "This build has no book cache wired up, so there is no file to send.",
    };
  }

  let cached: CachedFileLike | null = null;
  try {
    cached = await getCachedFile(bookId);
  } catch (err) {
    return {
      ok: false,
      route: "kora-relay",
      reason: `Could not read the cached book: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  if (!cached || !cached.blob) {
    return {
      ok: false,
      route: "kora-relay",
      reason: "This book isn't downloaded on this device yet. Download it first, then send it.",
    };
  }

  const ext = (extension || cached.extension || "").trim().toLowerCase().replace(/^\./, "");
  if (!isEreaderAcceptedExtension(ext)) {
    return {
      ok: false,
      route: "kora-relay",
      reason: `The relay takes ${EREADER_ACCEPT} — this one is .${ext || "?"}.`,
    };
  }

  const fileName = (title ? `${sanitizeFileName(title)}.${ext}` : cached.fileName) || `book.${ext}`;

  const send = resolve(deps.sendViaRelay, sendToDeviceViaRelay);
  try {
    const result = await send(cached.blob, fileName, code, abortSignal, onProgress);
    return fromRelayResult(result, fileName, code);
  } catch (err) {
    return {
      ok: false,
      route: "kora-relay",
      reason: `Could not reach the relay: ${(err as Error)?.message ?? String(err)}`,
    };
  }
}

/**
 * Hand the file to the OS share sheet, or download it, for the Amazon route.
 *
 * Deliberately a separate call from `uploadToEreader`: the Amazon path is an
 * alternative, never a silent fallback. The caller has to name it.
 */
export async function shareOrDownloadForAmazon(
  bookId: string,
  opts: { title?: string; extension?: string } & EreaderDeps
): Promise<EreaderResult & { fileName?: string }> {
  const { title, extension, ...deps } = opts;
  const doc = resolve(
    deps.document,
    typeof document === "undefined" ? undefined : (document as unknown as EreaderDocumentLike)
  );
  const nav = resolve(
    deps.navigator,
    typeof navigator === "undefined" ? undefined : (navigator as unknown as EreaderNavigatorLike)
  );
  const openUrl = resolve(deps.openUrl, defaultOpenUrl);
  const createObjectUrl = deps.createObjectUrl;
  const getCachedFile = deps.getCachedFile;

  if (!getCachedFile) {
    return { ok: false, route: "amazon-manual", reason: "This build has no book cache wired up." };
  }

  let cached: CachedFileLike | null = null;
  try {
    cached = await getCachedFile(bookId);
  } catch (err) {
    return {
      ok: false,
      route: "amazon-manual",
      reason: `Could not read the cached book: ${(err as Error)?.message ?? String(err)}`,
    };
  }
  if (!cached || !cached.blob) {
    return {
      ok: false,
      route: "amazon-manual",
      reason: "This book isn't downloaded on this device yet. Download it first.",
    };
  }

  const ext = (extension || cached.extension || "").trim().toLowerCase().replace(/^\./, "");
  const fileName = (title ? `${sanitizeFileName(title)}.${ext}` : cached.fileName) || `book.${ext}`;

  if (nav?.share && typeof nav.canShare === "function") {
    try {
      const shareFile = new File([cached.blob], fileName, { type: mimeFor(ext) });
      if (nav.canShare({ files: [shareFile] })) {
        await nav.share({ files: [shareFile], title: title || fileName });
        return {
          ok: true,
          route: "amazon-manual",
          method: "share-sheet",
          fileName,
          reason: `Opened the share sheet with ${fileName} — pick your own Kindle app there.`,
        };
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // Backing out of the share sheet is a decision, not a failure.
        return {
          ok: false,
          cancelled: true,
          route: "amazon-manual",
          fileName,
          reason: "Share cancelled.",
        };
      }
      // Anything else: fall through to download, and say so.
    }
  }

  if (!createObjectUrl || !doc?.createElement) {
    return {
      ok: false,
      route: "amazon-manual",
      reason: "This browser can neither share a file nor save one.",
    };
  }

  let url: string | null = null;
  try {
    url = createObjectUrl(cached.blob);
    const a = doc.createElement("a");
    a.href = url;
    a.setAttribute?.("download", fileName);
    doc.body?.appendChild(a);
    a.click?.();
    a.remove?.();
  } catch (err) {
    return {
      ok: false,
      route: "amazon-manual",
      reason: `Could not save the file: ${(err as Error)?.message ?? String(err)}`,
    };
  } finally {
    if (url && deps.revokeObjectUrl) {
      setTimeout(() => {
        try {
          deps.revokeObjectUrl?.(url as string);
        } catch {
          /* best effort */
        }
      }, 1000);
    }
  }

  openUrl(AMAZON_SEND_URL);

  return {
    ok: true,
    route: "amazon-manual",
    // Said out loud, because this IS a local download: the user must be told
    // rather than discovering it when the file turns up in Downloads.
    method: "local-download",
    fileName,
    reason: `Saved ${fileName} to your downloads and opened Amazon's Send to Kindle page — drag the file onto it to finish. This path did not use Kora's relay.`,
  };
}

/** Open a manual-upload page. Never presented as an upload that happened. */
export function openManualSender(route: "amazon-manual", openUrl?: (url: string) => void): EreaderResult {
  const open = resolve(openUrl, defaultOpenUrl);
  try {
    open(AMAZON_SEND_URL);
  } catch (err) {
    return {
      ok: false,
      route,
      reason: `Could not open that page: ${(err as Error)?.message ?? String(err)}`,
    };
  }
  return {
    ok: true,
    route,
    reason: "Opened Amazon's Send to Kindle page. Drop the downloaded file onto it to finish.",
  };
}

// ── Small pure helpers ───────────────────────────────────────────────────────

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").slice(0, 80).trim() || "book";
}

const MIMES: Record<string, string> = {
  txt: "text/plain",
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
  azw: "application/vnd.amazon.ebook",
  kfx: "application/vnd.amazon.ebook",
  pdf: "application/pdf",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook-rar",
};

function mimeFor(ext: string): string {
  return MIMES[ext] || DEFAULT_MIME;
}

function defaultOpenUrl(url: string): void {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
}
