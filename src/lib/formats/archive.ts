/**
 * Open a comic archive and hand ComicReader a list of images it can show.
 *
 * The whole point of this file is that a CBZ is a *container*, and the reader
 * only knows how to display `<img src>`. So opening one is: read the
 * central directory, pick the image members, sort them into reading order,
 * inflate each one, and mint an object URL per page. The reader then cannot
 * tell the difference between a page from a Madara CDN and a page out of a
 * ZIP, which is the correct outcome.
 *
 * Dependency choice, deliberately:
 *
 *   - **No new dependency.** JSZip is already in `package.json` and already
 *     used by the EPUB reader, so the deflate half comes from there rather
 *     than from a second unzipper. Adding `fflate` or `unzipper` on top of
 *     JSZip would mean shipping two implementations of the same format.
 *   - **Listing is not JSZip.** `zip.ts` lists the central directory
 *     synchronously off the raw bytes, because deciding *whether* this is a
 *     CBZ has to happen before deciding to inflate anything, and because a
 *     truncated download should be rejected by that decision rather than by
 *     an exception thrown from deep inside a loader.
 *
 * What is NOT implemented, and is said so rather than faked:
 *
 *   - **RAR/CBR.** RAR's compression (and especially RAR5's) is a
 *     non-trivial decoder. There is no small, well-maintained, already-shipped
 *     implementation in this project, and pulling one in for a format that
 *     is a minority of mirrors is not a trade this task should make silently.
 *     `openArchive` returns an explicit `unsupported` result and the UI says
 *     so in words.
 *   - **CB7.** Same answer, different format: 7z is a full container format
 *     with its own header, LZMA decoder and BCJ filters.
 *
 * Both are *detected with certainty* — `detect.ts` reads their magic bytes —
 * which is a different claim from "can open it", and the result type keeps
 * those two claims apart so nothing in the UI has to guess.
 */

import { detectFormat, isReadableContainer, supportedForReading, unsupportedReason, type Detection } from "./detect";
import { listZipEntries, readStoredEntry, ZipError, type ZipEntry } from "./zip";
import { pageSortRule, sortPageNames } from "./pageOrder";

export interface ArchivePage {
  /** Object URL for the inflated image. Revoke it via {@link releaseArchive}. */
  url: string;
  /** In-archive path, kept for diagnostics and for the alt text. */
  name: string;
  /** Uncompressed byte length. */
  size: number;
}

/**
 * The live object URLs an archive owns, plus the parsed archive itself.
 *
 * Grouping them is the entire memory-management story: one handle to revoke,
 * one handle to hand to the lazy loader, and no way to forget a URL that was
 * minted on the eager path but not tracked.
 */
export interface ArchiveHandle {
  urls: string[];
  /** The parse, for pages past the eager head. */
  archive?: LoadedArchive;
  /** Every page name in reading order. */
  order?: string[];
  ok: boolean;
}

export type OpenArchiveResult =
  | {
      status: "ok";
      detection: Detection;
      pages: ArchivePage[];
      /** Which ordering rule produced `pages`. */
      order: "numeric" | "natural";
      handle: ArchiveHandle;
    }
  | {
      status: "unsupported";
      detection: Detection;
      /** A sentence to show the user, in the reader's own failure-card style. */
      message: string;
    }
  | {
      status: "rejected";
      detection: Detection;
      message: string;
    }
  | {
      status: "empty";
      detection: Detection;
      message: string;
    };

/** Formats this module can actually inflate. Everything else is `unsupported`. */
const INFLATABLE = new Set(["cbz", "epub", "zip"]);

/**
 * How many pages to inflate up front.
 *
 * A 200-page CBZ is ~150MB of decoded images; minting 200 object URLs at
 * once pins every one of them in memory with no eviction, which on a phone
 * is an OOM rather than a slow read. The rest are inflated on demand by
 * {@link loadArchivePage}, one page per turn.
 */
export const EAGER_PAGES = 6;

/**
 * Open archive bytes for reading.
 *
 * Never throws for a bad file: a rejection, an unsupported container and an
 * archive with no images are all *results*, because every one of them is a
 * state the user can be told about. Only a genuine bug throws.
 */
export async function openArchive(bytes: Uint8Array, claimed?: string | null): Promise<OpenArchiveResult> {
  const detection = detectFormat(bytes, claimed);

  if (detection.rejected) {
    return {
      status: "rejected",
      detection,
      message: detection.detail,
    };
  }

  if (!INFLATABLE.has(detection.format)) {
    return {
      status: "unsupported",
      detection,
      message:
        isReadableContainer(detection.format) && !supportedForReading(detection.format)
          ? unsupportedReason(detection.format)
          : `${detection.label} files cannot be opened in Kora.`,
    };
  }

  let entries: ZipEntry[];
  try {
    entries = listZipEntries(bytes).filter((e) => !e.isDirectory);
  } catch (e) {
    return {
      status: "rejected",
      detection,
      message:
        e instanceof ZipError
          ? `This archive is damaged and cannot be opened (${e.message}). It may have downloaded incompletely.`
          : "This archive could not be opened.",
    };
  }

  const order = pageSortRule(entries.map((e) => e.name));
  const names = sortPageNames(entries.map((e) => e.name));
  if (!names.length) {
    return {
      status: "empty",
      detection,
      message:
        detection.format === "epub"
          ? "This EPUB has no embedded page images. Kora's comic reader cannot show a text-only book."
          : "This archive contains no readable page images.",
    };
  }

  // The reader's `pages` prop is URLs, so the first page has to exist before
    // the reader opens. The rest are loaded lazily.
    const head = names.slice(0, EAGER_PAGES);
    const parsed = await parseArchive(bytes);
    const pages: ArchivePage[] = [];
    const urls: string[] = [];

    for (const name of head) {
      const blob = await extract(parsed, name);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      pages.push({ url, name, size: blob.size });
    }

    if (!pages.length) {
      return {
        status: "rejected",
        detection,
        message: "Every page in this archive failed to decompress. The download is likely incomplete.",
      };
    }

    return {
      status: "ok",
      detection,
      pages,
      order,
      handle: { urls, ok: true, archive: parsed, order: names },
    };
  }

  /**
   * A parsed archive, kept so pages past the eager head need no re-parse.
   *
   * Deliberately NOT the JSZip instance alone. JSZip's async load is a second
   * full parse of the file, and a page that is asked for late — which is most
   * of them — must not pay for it again. Holding the raw bytes *and* the
   * central directory means a stored member can be sliced out with no decoder
   * at all, and a deflate member falls back to JSZip if the eager load failed.
   */
  export interface LoadedArchive {
    bytes: Uint8Array;
    entries: Map<string, ZipEntry>;
    /** Present only when JSZip was importable AND loaded without throwing. */
    zip: { files: Record<string, { async: (t: string) => Promise<ArrayBuffer> }> } | null;
    /** Every page name, already in reading order. */
    order: string[];
  }

  async function parseArchive(bytes: Uint8Array): Promise<LoadedArchive> {
    const entries = new Map<string, ZipEntry>();
    for (const e of listZipEntries(bytes)) if (!e.isDirectory) entries.set(e.name, e);
    let zip: LoadedArchive["zip"] = null;
    try {
      const { default: JSZip } = await import("jszip");
      zip = (await JSZip.loadAsync(bytes)) as unknown as LoadedArchive["zip"];
    } catch {
      // No JSZip, or it refused a truncated file. Stored members still work via
      // the direct slice below, and a deflate archive reports its failure
      // honestly rather than producing blank pages.
    }
    return { bytes, entries, zip, order: [] };
  }

  /**
   * Inflate one page by its in-archive name, minting its object URL.
   *
   * The counterpart to the eager head above: the reader asks for the page it is
   * about to show, this inflates exactly that one, and nothing else is held in
   * memory. Returns null when the member cannot be inflated.
   */
  export async function loadArchivePage(
    archive: LoadedArchive,
    name: string
  ): Promise<ArchivePage | null> {
    const blob = await extract(archive, name);
    if (!blob) return null;
    return { url: URL.createObjectURL(blob), name, size: blob.size };
  }

/**
 * Revoke every object URL an archive produced.
 *
 * Object URLs are not garbage collected with their blob — the URL mapping is
 * held by the document until `revokeObjectURL`. A reader opened and closed
 * ten times without this leaks every page of all ten, which is exactly the
 * failure `ReaderPageImage` was written to avoid.
 */
export function releaseArchive(handle: ArchiveHandle | null | undefined): void {
  if (!handle) return;
  for (const url of handle.urls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* a URL revoked twice is not an error worth surfacing */
    }
  }
  handle.urls.length = 0;
}

/** Append to a handle so a late-loaded page is revoked with the rest. */
export function trackUrl(handle: ArchiveHandle, url: string): void {
  handle.urls.push(url);
}

/* ------------------------------------------------------------------ internals */

/**
 * Bytes for one member, or null when it cannot be produced.
 *
 * Two paths, in order:
 *
 *   1. **JSZip.** It handles deflate correctly and is already in the bundle
 *      for the EPUB reader, so reusing it beats shipping a second unzipper.
 *   2. **A direct slice**, for a stored (method 0) member. This needs no
 *      decoder at all, which is what makes an all-stored CBZ work when the
 *      JSZip dynamic import is unavailable — a real condition in a test
 *      runner, and the reason the reader is testable outside a browser.
 *
 * A member that is deflated AND has no JSZip is `null`, not a blank page: a
 * silently empty page is the failure this whole module exists to prevent.
 */
async function extract(archive: LoadedArchive, name: string): Promise<Blob | null> {
  const entry = archive.entries.get(name);
  if (!entry) return null;

  if (archive.zip?.files?.[name]) {
    try {
      const buf = await archive.zip.files[name].async("arraybuffer");
      return new Blob([buf], { type: mimeOf(name) });
    } catch {
      /* fall through to the direct slice */
    }
  }

  if (entry.method === 0) {
    try {
      return new Blob([readStoredEntry(archive.bytes, entry)], { type: mimeOf(name) });
    } catch {
      return null;
    }
  }
  return null;
}

/** Content type per page extension, so the blob URL is not an untyped blob. */
export function mimeOf(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".avif")) return "image/avif";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".bmp")) return "image/bmp";
  if (n.endsWith(".jxl")) return "image/jxl";
  return "application/octet-stream";
}

/**
 * A one-line description of what an archive turned out to be, for the UI.
 * Says the format, and says whether the content beat the extension.
 */
export function describeArchive(d: Detection): string {
  if (d.savedByContent) {
    return `${d.label} — the file says .${d.claimed} but its contents are ${d.label}.`;
  }
  return `${d.label}${d.pageCount ? ` · ${d.pageCount} pages` : ""}`;
}