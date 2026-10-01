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
 * WHAT IS *NOT* IMPLEMENTED, and is said so rather than faked:
 *
 *   - **Password-protected archives.** RAR and 7z both support them; libarchive
 *     exposes the encryption flag but this build cannot supply a passphrase, so
 *     such a file is REFUSED with a clear message rather than half-opened.
 *   - **Multi-volume / split archives.** `.part1.rar`, `.r00`, `.7z.001` and
 *     friends are one comic split across files. Only the first volume arrives,
 *     and it extracts to garbage. Detected from the header and the filename and
 *     refused up front — see `detectSplitArchive`.
 *   - **MOBI, PDF.** Genuinely different document models, not containers.
 *
 * Solid archives are NOT in this list, because they work. A solid `.cb7`
 * (all pages in one compression stream) and a solid RAR5 archive both decode
 * correctly through the same path, verified against real fixtures.
 *
 * Both RAR and 7z are *detected with certainty* — `detect.ts` reads their magic
 * bytes — and are now actually readable through `libarchiveReader.ts`, which
 * wraps libarchive-WASM (MIT, zero runtime deps). The ZIP path below is
 * untouched: it is faster, needs no WASM, and stays the default for `.cbz`.
 */

import { detectFormat, isReadableContainer, supportedForReading, unsupportedReason, type Detection } from "./detect";
import { listZipEntries, readStoredEntry, ZipError, type ZipEntry } from "./zip";
import { pageSortRule, sortPageNames } from "./pageOrder";
import {
  extractLibarchivePages,
  LibarchiveError,
  describeLibarchiveFailure,
} from "./libarchiveReader";

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
  /**
   * Where late pages come from, discriminated by container.
   *
   * Deliberately ONE field, not an optional `archive` for ZIP plus an optional
   * `libarchive` for RAR/7z. Two optional fields would make the handle's key
   * set differ per container, so a reader could branch on `handle.archive`
   * being present — which is exactly the container leak this module exists to
   * prevent. Here the shape is identical for every archive and only
   * {@link loadArchivePageFromHandle} ever looks at `kind`.
   */
  source?:
    | { kind: "zip"; archive: LoadedArchive }
    | { kind: "libarchive"; data: Map<string, Uint8Array> };
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

/** ZIP-based formats. These go through the fast, WASM-free path below. */
const INFLATABLE = new Set(["cbz", "epub", "zip"]);

/**
 * Formats that need a real decoder, i.e. libarchive.
 *
 * Kept separate from {@link INFLATABLE} rather than folded into one set because
 * the two paths have materially different costs: ZIP is parsed in-tree and
 * inflates through JSZip, while RAR/7z load a ~600KB WASM module on first use.
 * A `.cbz` must never pay that, so the two are never merged.
 */
const LIBARCHIVE_BACKED = new Set(["cbr", "cb7"]);

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

  // RAR/CBR and 7z/CB7: one shared extraction path, results shaped exactly
    // like the ZIP path below so the reader cannot tell the difference.
    if (LIBARCHIVE_BACKED.has(detection.format)) {
      // `openLibarchiveBacked` is async and this function is already async, so
      // the promise is adopted by the caller's `await`. Both entry points into
      // this module await `openArchive`, so no caller can observe a pending
      // handle or an unresolved result union.
      return openLibarchiveBacked(bytes, detection, claimed);
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
        handle: {
          urls,
          ok: true,
          order: names,
          source: { kind: "zip", archive: parsed },
        },
      };
    }

  /**
   * Open a RAR/CBR or 7z/CB7 archive through libarchive.
   *
   * The contract with the rest of the app is that this is INVISIBLE. It returns
   * the same {@link OpenArchiveResult} union, the same {@link ArchivePage}
   * shape, the same `order` rule, and an {@link ArchiveHandle} whose `urls` are
   * `blob:` URLs the ZIP path would have produced. A reader holding a CBR handle
   * and a reader holding a CBZ handle have no way to tell them apart — which is
   * the point: `openArchive` is the only place that knows about containers.
   *
   * Why the adapter, rather than teaching `extract` about RAR:
   *
   *   - **Traversal.** `extractLibarchivePages` runs `isSafeArchiveEntry` on
   *     `entry.pathname` BEFORE the name is used as a map key, a blob label, or
   *     a sort input. libarchive hands RAR/7z member names back verbatim, and
   *     those containers are attacker-controlled by default, so the gate is the
   *     load-bearing security property here (CVE-2023-43616 /
   *     GHSA-8c8w-f7wp-2jr2 class). It is enforced at the point the name enters
   *     the process, not here, so there is exactly one place to audit. Names
   *     that fail it are counted and dropped, never rewritten.
   *   - **Memory.** Every declared failure kind maps onto a *named refusal*,
   *     never a partial page list. A split volume that yields 40 of 80 pages
   *     would otherwise render as a scrambled book that looks like success.
   *   - **Ownership.** `extractLibarchivePages` copies each page out of WASM
   *     heap (`HEAP8.slice`) before returning, so the `data` map owns its bytes
   *     independently of the reader. Blob URLs minted from it stay valid after
   *     `reader.free()`, which is what makes `releaseArchive` sufficient.
   *
   * One honest asymmetry with the ZIP path: libarchive is a *single-pass*
   * decoder — `read_next_entry` walks a forward-only cursor — so all pages are
   * decompressed in one go and there is no re-read for a late page. The eager
   * head is therefore minted the same way (so the reader's shape is identical),
   * but every page's bytes are already resident in `data`. The handle keeps
   * `data` so {@link loadArchivePageFromLibarchive} can mint the rest on demand
   * rather than this function minting 200 object URLs at once.
   */
  async function openLibarchiveBacked(
    bytes: Uint8Array,
    detection: Detection,
    claimed?: string | null
  ): Promise<OpenArchiveResult> {
    let extracted: Awaited<ReturnType<typeof extractLibarchivePages>>;
    try {
      extracted = await extractLibarchivePages(bytes, claimed);
    } catch (e) {
      if (e instanceof LibarchiveError) {
        // `describeLibarchiveFailure` gives the user-facing sentence for
        // password / split / too-large / damaged / no-pages. The distinction
        // that matters for the result union: "we cannot read this" (unsupported)
        // versus "this file is broken" (rejected) versus "there is nothing to
        // read" (empty) is the same distinction the ZIP branch draws.
        const status =
          e.failure === "damaged"
            ? "rejected"
            : e.failure === "no-pages"
              ? "empty"
              : "unsupported";
        return {
          status,
          detection,
          message: describeLibarchiveFailure(e.failure),
        };
      }
      // Anything that is not a LibarchiveError is a bug in the WASM glue, a
      // missing asset, or an OOM inside the emulator. It is still a result, not
      // a throw: the caller has a reader open and needs a sentence to show.
      return {
        status: "unsupported",
        detection,
        message:
          "This archive could not be opened — the RAR/7z decoder failed to load on this device.",
      };
    }

    // Same ordering the ZIP path applies, from the same functions, so a RAR with
    // `1.jpg, 10.jpg, 2.jpg` reads in the same order a CBZ of the same names
    // would.
    const allNames = extracted.pages.map((p) => p.name);
    const order = pageSortRule(allNames);
    const names = sortPageNames(allNames);
    if (!names.length) {
      return {
        status: "empty",
        detection,
        message: "This archive contains no readable image pages.",
      };
    }

    const head = names.slice(0, EAGER_PAGES);
    const pages: ArchivePage[] = [];
    const urls: string[] = [];

    try {
      for (const name of head) {
        const blob = await extractLibarchivePageBlob(extracted.data, name);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        pages.push({ url, name, size: blob.size });
      }
    } catch (e) {
      // A URL minted before the throw is still a URL the document is holding.
      // Revoking here is what keeps a mid-extraction failure from leaking the
      // pages that did succeed — the same obligation `releaseArchive` exists
      // to discharge on the success path.
      for (const url of urls) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* a URL revoked twice is not an error worth surfacing */
        }
      }
      urls.length = 0;
      return {
        status: "rejected",
        detection,
        message:
          e instanceof LibarchiveError
            ? describeLibarchiveFailure(e.failure)
            : "This archive could not be opened.",
      };
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
        handle: {
          urls,
          ok: true,
          order: names,
          source: { kind: "libarchive", data: extracted.data },
        },
      };
    }

  /**
   * One already-decompressed page as a typed Blob.
   *
   * The bytes are owned by `data` (copied out of WASM heap at extraction time),
   * so this only wraps them. Returns null only when the name is absent, which
   * means the ordering and the extracted set disagreed — a real bug worth a null
   * rather than an empty image.
   */
  async function extractLibarchivePageBlob(
    data: Map<string, Uint8Array>,
    name: string
  ): Promise<Blob | null> {
    const bytes = data.get(name);
    if (!bytes) return null;
    return new Blob([bytes], { type: mimeOf(name) });
  }

  /**
   * Mint an object URL for a page past the eager head of a libarchive handle.
   *
   * Returns null for an unknown name. As with the ZIP path, a late page that
   * cannot be produced is null — never a blank page.
   */
  function loadLibarchivePage(handle: ArchiveHandle, name: string): ArchivePage | null {
    const source = handle.source;
    if (!source || source.kind !== "libarchive") return null;
    const bytes = source.data.get(name);
    if (!bytes) return null;
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(name) }));
    // Tracked immediately: a URL the caller might not keep is still a URL the
    // document holds until revoked, so it belongs to the handle either way.
    trackUrl(handle, url);
    return { url, name, size: bytes.byteLength };
  }

  /**
   * Load one page from a handle, whichever container it came from.
   *
   * The single entry point a reader should use, so that "give me page N" is the
   * whole contract and no caller has to know whether it is holding a CBZ or a
   * CBR. The ZIP path goes through the in-tree inflater; the RAR/7z path wraps
   * bytes libarchive already decompressed, because its reader is single-pass and
   * offers no re-read.
   */
  export async function loadArchivePageFromHandle(
    handle: ArchiveHandle,
    name: string
  ): Promise<ArchivePage | null> {
    const source = handle.source;
    if (!source) return null;
    if (source.kind === "libarchive") return loadLibarchivePage(handle, name);
    const page = await loadArchivePage(source.archive, name);
    if (page) trackUrl(handle, page.url);
    return page;
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
    // Drop the decompressed page bytes too. A RAR/7z handle holds every page of
    // the book in this map — for a 200-page CBR that is the whole payload — so
    // revoking the URLs without clearing it would leave the memory pinned for
    // the life of the handle. Done last, because revoking must not be able to
    // throw before the reference drop happens.
    if (handle.source?.kind === "libarchive") {
      handle.source.data.clear();
    }
    handle.source = undefined;
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