/**
 * Send to Kobo/Kindle — the real browser upload.
 *
 * WHAT THIS IS. There is no Amazon-side API a third-party app can use to push a
 * book to a device: KDP's Personal Document Service needs an Amazon-approved
 * developer account, and Amazon issues those tokens to nobody else. The old
 * version of this plugin therefore did the only thing it could — save the file
 * and call it a day, which is exactly the "it just downloads the book" bug.
 *
 * WHAT ACTUALLY WORKS. Two browser-based senders do the real upload on the
 * user's behalf, with no account in Kora and no credential of any kind. Both
 * were read directly off the wire before this module was written; the
 * contract below is theirs, not a guess:
 *
 * 1. send.djazz.se ("Send to Ereader" by Daniel Jansén, MIT). A plain HTML
 *    form, read from the live page:
 *      <form action="./upload" method="post" enctype="multipart/form-data">
 *        <input name="key"  maxlength="4" required>   <- the 4-char code the
 *                                                          device's own browser
 *                                                          displays
 *        <input name="file" type="file" required
 *               accept=".txt,.epub,.mobi,.pdf,.cbz,.cbr">
 *        <input name="url">                           <- fetch-by-URL instead
 *        <input type="checkbox" name="kepubify">      <- Kobo EPUB fixups
 *        <input type="checkbox" name="kindlegen">     <- Kindle conversion
 *        <input type="checkbox" name="pdfcropmargins">
 *        <input type="checkbox" name="transliteration">
 *    POST https://send.djazz.se/upload  ->  text/plain reply. A bad key comes
 *    back as HTTP 400 with the body "Unknown key ABCD" (verified live).
 *
 * 2. kdrop.me (KindleDrop). NOT used for programmatic upload. Its page carries
 *    a Cloudflare Turnstile widget (`<div id="cf-turnstile">`, the client chunk
 *    references `turnstile` / `cf-turnstile-response`), which is a human
 *    anti-bot challenge. Its CSP allow-lists `https://api.kdrop.me`, but that
 *    host does not resolve in DNS (NXDOMAIN against 8.8.8.8), so there is no
 *    reachable POST contract to call even ignoring the challenge. So kdrop is
 *    offered the only honest way: open their upload page and let the user drop
 *    the file in. No endpoint is invented for it.
 *
 * WHY A FORM AND NOT fetch(). `send.djazz.se` returns no
 * `Access-Control-Allow-Origin` header — neither on the OPTIONS preflight nor
 * on the POST — so a cross-origin `fetch`/XHR upload is blocked by the browser
 * and would fail in front of the user. A native form POST is a top-level
 * navigation and is not subject to CORS, so it genuinely uploads from the
 * page. This is also why the reply lands in a tab the user can read: we cannot
 * read the response from here, and the code says so rather than claiming a
 * success it cannot observe.
 *
 * CANCELLATION. Dismissing the share sheet, clearing the device code, or
 * closing the tab before it loads is the user changing their mind. That is
 * reported as `cancelled`, never as `ok` and never as a failure toast. Same
 * convention as the OS share path in `kindleClient.ts`.
 *
 * NO CREDENTIALS. Nothing here reads, stores, or sends an account, key, or
 * token. The `key` field below is the 4-character code the *device* shows the
 * user, which is a pairing code for one upload, not a secret.
 */

import type { PluginManifest } from "./types";

/** The sender that does a real upload. Field names read off the live form. */
export const EREADER_URL = "https://send.djazz.se/";
export const EREADER_UPLOAD_ENDPOINT = "https://send.djazz.se/upload";

/** KindleDrop. Manual upload only — Turnstile-gated, see the header. */
export const KDROP_URL = "https://kdrop.me/";

/** Amazon's own page. Kept as the official alternative, per the ask. */
export const AMAZON_SEND_URL = "https://www.amazon.com/sendtokindle";

/** Exactly what the live form's `accept` attribute lists. */
export const EREADER_ACCEPT = ".txt,.epub,.mobi,.pdf,.cbz,.cbr";
export const EREADER_EXTENSIONS = [".txt", ".epub", ".mobi", ".pdf", ".cbz", ".cbr"];

/** The sender's own field names, so nothing is spelled from memory. */
export const EREADER_FIELDS = {
  key: "key",
  file: "file",
  url: "url",
  /** Kobo-side Kepubify fixups (metadata + cover sizing). */
  kepubify: "kepubify",
  /** Kindle-side conversion via kindlegen. */
  kindlegen: "kindlegen",
  pdfCropMargins: "pdfcropmargins",
  transliteration: "transliteration",
} as const;

/** The pairing code the device shows is exactly four characters. */
export const EREADER_KEY_LENGTH = 4;

export type EreaderRoute = "djazz-upload" | "kdrop-manual" | "amazon-manual";

export interface EreaderResult {
  ok: boolean;
  route: EreaderRoute;
  /** Human-readable, shown verbatim. Never claim more than actually happened. */
  reason: string;
  /** The user's own decision, not a failure. */
  cancelled?: boolean;
}

export interface EreaderDeps {
  document?: EreaderDocumentLike;
  navigator?: EreaderNavigatorLike;
  openUrl?: (url: string) => void;
  getCachedFile?: (bookId: string) => Promise<CachedFileLike | null>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
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
 * Uppercased and stripped of separators, because it is typed by hand off a
 * small e-ink screen and people paste it with a space in it. Anything that is
 * not exactly four letters/digits afterwards is rejected rather than sent —
 * the sender answers 400 "Unknown key" and the user is left guessing which of
 * the two halves was wrong.
 */
export function normalizeEreaderKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length === EREADER_KEY_LENGTH ? cleaned : null;
}

/** Whether the sender would accept this file type at all. */
export function isEreaderAcceptedExtension(ext: string | undefined | null): boolean {
  const e = (ext || "").trim().toLowerCase().replace(/^\./, "");
  return EREADER_EXTENSIONS.includes(`.${e}`);
}

/**
 * The exact multipart field set the sender's form would post.
 *
 * Pure and exported so the contract is assertable without a DOM — this is the
 * thing that would silently rot if it were buried inside a submit handler.
 * Unchecked boxes are omitted entirely, which is what an unchecked
 * `<input type="checkbox">` posts (nothing), so the sender's defaults win.
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
  if (key) fields[EREADER_FIELDS.key] = key;
  if (opts.kepubify) fields[EREADER_FIELDS.kepubify] = "on";
  if (opts.kindlegen) fields[EREADER_FIELDS.kindlegen] = "on";
  if (opts.pdfCropMargins) fields[EREADER_FIELDS.pdfCropMargins] = "on";
  if (opts.transliteration) fields[EREADER_FIELDS.transliteration] = "on";
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
    case "djazz-upload":
      return "Uploads straight to your device through send.djazz.se.";
    case "kdrop-manual":
      return "Opens KindleDrop — you drop the file in yourself.";
    case "amazon-manual":
      return "Opens Amazon's own Send to Kindle page.";
  }
}

// ── The real upload ──────────────────────────────────────────────────────────

const DEFAULT_MIME = "application/octet-stream";

function resolve<T>(override: T | undefined, fallback: T | undefined): T | undefined {
  return override !== undefined ? override : fallback;
}

/**
 * Upload a cached book to the device via send.djazz.se.
 *
 * Builds the sender's own multipart form in the page and submits it. The file
 * is attached by assigning a `File` onto a file input through a
 * `DataTransfer`, which is the only way to put bytes into a form input
 * programmatically; engines without it are told so plainly rather than
 * silently downloading instead.
 *
 * The response goes to a new tab. That is deliberate: it is the sender's own
 * plain-text answer ("Uploaded", or "Unknown key ABCD"), and it is visible
 * rather than swallowed.
 */
export async function uploadToEreader(
  bookId: string,
  opts: {
    key: string;
    title?: string;
    extension?: string;
    kepubify?: boolean;
    kindlegen?: boolean;
    pdfCropMargins?: boolean;
    transliteration?: boolean;
  } & EreaderDeps
): Promise<EreaderResult> {
  const { key, title, extension, kepubify, kindlegen, pdfCropMargins, transliteration, ...deps } = opts;

  const key_ = normalizeEreaderKey(key);
  if (!key_) {
    // An empty or malformed code is the user not having got to the device yet.
    return {
      ok: false,
      cancelled: true,
      route: "djazz-upload",
      reason: `No device code yet. Open send.djazz.se in your Kobo/Kindle's browser and enter the ${EREADER_KEY_LENGTH}-character code it shows.`,
    };
  }

  const doc = resolve(
    deps.document,
    typeof document === "undefined" ? undefined : (document as unknown as EreaderDocumentLike)
  );
  const getCachedFile = deps.getCachedFile;

  if (!getCachedFile) {
    return {
      ok: false,
      route: "djazz-upload",
      reason: "This build has no book cache wired up, so there is no file to upload.",
    };
  }

  let cached: CachedFileLike | null = null;
  try {
    cached = await getCachedFile(bookId);
  } catch (err) {
    return {
      ok: false,
      route: "djazz-upload",
      reason: `Could not read the cached book: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  if (!cached || !cached.blob) {
    return {
      ok: false,
      route: "djazz-upload",
      reason: "This book isn't downloaded on this device yet. Download it first, then send it.",
    };
  }

  const ext = (extension || cached.extension || "").trim().toLowerCase().replace(/^\./, "");
  if (!isEreaderAcceptedExtension(ext)) {
    return {
      ok: false,
      route: "djazz-upload",
      reason: `The sender takes ${EREADER_ACCEPT} — this one is .${ext || "?"}.`,
    };
  }

  if (!doc?.createElement) {
    return {
      ok: false,
      route: "djazz-upload",
      reason: "This browser cannot build the upload form.",
    };
  }

  const fileName = (title ? `${sanitizeFileName(title)}.${ext}` : cached.fileName) || `book.${ext}`;
  const file = new File([cached.blob], fileName, { type: mimeFor(ext) });

  // A form can only be submitted with a real File in a file input.
  const DataTransferCtor = typeof DataTransfer !== "undefined" ? DataTransfer : undefined;
  if (!DataTransferCtor) {
    return {
      ok: false,
      route: "djazz-upload",
      reason:
        "This browser can't attach a file to a form without a picker, so the upload can't be prepared. Use KindleDrop or Amazon below instead.",
    };
  }

  const fields = buildEreaderUploadFields({ key: key_, kepubify, kindlegen, pdfCropMargins, transliteration });

  try {
    const form = doc.createElement("form");
    form.method = "POST";
    form.action = EREADER_UPLOAD_ENDPOINT;
    form.enctype = "multipart/form-data";
    form.target = "_blank";
    if (form.setAttribute) {
      form.setAttribute("accept-charset", "UTF-8");
      form.setAttribute("rel", "noopener");
    }
    if (form.style) form.style.display = "none";

    for (const [name, value] of Object.entries(fields)) {
      const input = doc.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild?.(input);
    }

    const fileInput = doc.createElement("input");
    fileInput.type = "file";
    fileInput.name = EREADER_FIELDS.file;
    fileInput.accept = EREADER_ACCEPT;
    const dt = new DataTransferCtor();
    dt.items.add(file);
    fileInput.files = dt.files;
    form.appendChild?.(fileInput);

    doc.body?.appendChild(form);
    if (typeof form.submit !== "function") {
      form.remove?.();
      return {
        ok: false,
        route: "djazz-upload",
        reason: "This browser refused to submit the upload form.",
      };
    }
    form.submit();
    form.remove?.();

    return {
      ok: true,
      route: "djazz-upload",
      reason: `Sent ${fileName} to send.djazz.se using code ${key_}. A tab opened with the sender's reply — read it to confirm the book landed on your device.`,
    };
  } catch (err) {
    return {
      ok: false,
      route: "djazz-upload",
      reason: `Could not start the upload: ${(err as Error)?.message ?? String(err)}`,
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
    fileName,
    reason: `Saved ${fileName} and opened Amazon's Send to Kindle page — drag the file onto it to finish.`,
  };
}

/** Open a manual-upload page. Never presented as an upload that happened. */
export function openManualSender(route: "kdrop-manual" | "amazon-manual", openUrl?: (url: string) => void): EreaderResult {
  const url = route === "kdrop-manual" ? KDROP_URL : AMAZON_SEND_URL;
  const open = resolve(openUrl, defaultOpenUrl);
  try {
    open(url);
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
    reason:
      route === "kdrop-manual"
        ? "Opened KindleDrop. It asks for the file itself — drop it in there; Kora cannot upload to it, because its page is behind a human anti-bot check."
        : "Opened Amazon's Send to Kindle page. Drop the downloaded file onto it to finish.",
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
