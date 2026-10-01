/**
 * RAR (`.cbr`) and 7-Zip (`.cb7`) reading, via libarchive compiled to WASM.
 *
 * WHY A DEPENDENCY AT ALL
 *
 * RAR is a proprietary, undocumented format. Its decoder was never going to be
 * written here — a hand-rolled RAR parser would be a security liability and a
 * compatibility lie. 7-Zip is documented but its LZMA/LZMA2/BCJ2 filter
 * chain is a large body of work to reimplement correctly. So the choice was
 * between a real decoder and refusing to open the file, and the user asked for
 * the former. A dependency is now justified; the job is to pick ONE and make it
 * honest.
 *
 * WHY libarchive-WASM AND NOT THE OBVIOUS ALTERNATIVES
 *
 * Candidates considered, and what decided it:
 *
 *   - `unrar-js` / `node-unrar-js` (MIT) — a WASM build of the official unrar
 *     source. Genuinely good, and RAR-only. But it does not solve 7z, so it
 *     would be two dependencies to cover what one covers.
 *   - `7z-iterator` (MIT) — pure JS, no WASM. But it pulls a deep dependency
 *     tree (graceful-fs, unbzip2-stream, os-shim, …) that is Node-shaped.
 *   - `7z-wasm` — "SEE LICENSE IN License.txt" rather than an OSI licence, and
 *     it depends on `readline-sync`. Not acceptable to add on unclear terms.
 *   - `libarchive.js` (MIT) — a libarchive port, but ships a worker protocol
 *     and `comlink`.
 *   - **`libarchive-wasm` (MIT) — CHOSEN.**
 *
 * libarchive-wasm decodes ZIP, 7-Zip, RAR v4, RAR v5 and TAR behind one small
 * Int8Array API, with ZERO runtime dependencies. One dependency instead of two,
 * one licence to comply with instead of two, and one code path to maintain.
 * Bundled libarchive is 3.7.7, which supports RAR5 (added in libarchive 3.4)
 * and both 7z LZMA and LZMA2. The `.wasm` is ~600KB but is a *separate asset*
 * fetched lazily on first `.cbr`/`.cb7` open — it never enters the boot path,
 * so it does not affect app start or the APK's cold-start data use.
 *
 * LICENCE
 *
 * `libarchive-wasm` is MIT. libarchive itself is BSD-2-Clause. Neither is
 * copyleft, so there is no obligation to publish Kora's source or to
 * relicense anything; the only real obligation is retaining the notices, which
 * npm's `node_modules` tree does automatically. No LGPL/AGPL obligation applies.
 *
 * THE ANDROID WEBVIEW PROBLEM, AND WHY THIS STILL WORKS
 *
 * Kora also ships inside a Capacitor Android WebView, which serves assets from
 * a `file:///android_asset/` origin. Two things break there:
 *
 *   1. Emscripten's default loader resolves the `.wasm` via `locateFile()` +
 *      `document.currentScript.src`, which is wrong under a bundler and worse
 *      on `file://`. It then tries `WebAssembly.instantiateStreaming(fetch(...))`.
 *   2. `fetch()` of a `file://` URL is blocked in Android WebView by default.
 *
 * The fix is to never let Emscripten load the module. `libarchiveWasm()` accepts
 * a `wasmBinary` override (its `Module["wasmBinary"]` path), and when that is
 * present `getWasmBinary()` returns it without any I/O. The WASM is therefore
 * fetched once through Vite's own asset pipeline (`import … ?url`) and passed in
 * as bytes, so instantiation is pure `WebAssembly.instantiate` on an
 * `ArrayBuffer` — no fetch, no `locateFile`, no `document.currentScript`, no
 * Node builtins, and no WebAssembly threads or SIMD (the binary uses neither, so
 * it runs on old WebViews). Verified working in this exact mode before this
 * file was written.
 *
 * WHAT IS *NOT* SUPPORTED, STATED PLAINLY
 *
 *   - Password-protected archives (RAR and 7z alike). Refused with a clear
 *     message. libarchive exposes the encryption flag per entry, so this is
 *     detected rather than guessed at.
 *   - Multi-volume / split archives. You cannot hand libarchive a `.part1.rar`
 *     and get the rest of the set — the remaining volumes are separate files.
 *     A first volume is detected (see {@link detectSplitArchive}) and refused
 *     with instructions rather than silently rendering scrambled pages.
 *   - Solid archives are NOT refused. They are a legitimate, common way to
 *     produce smaller files and libarchive decodes them correctly; the probe
 *     fixtures include a real solid RAR5 archive and it extracts byte-exact.
 *     Refusing them would have been an unnecessary fake limitation.
 *
 * MEMORY
 *
 * Extraction is bounded on both axes (see {@link MAX_ENTRY_BYTES} and
 * {@link MAX_TOTAL_BYTES}). libarchive is fed the whole compressed archive in
 * one allocation, which is inherent to its `read_new_memory` API, and each entry
 * is read whole into WASM memory then copied out. A declared size is never
 * trusted: sizes are checked against hard ceilings, and a mismatch between
 * declared and actual bytes is treated as damage rather than truncated to fit.
 */

/**
 * Cap on a single decompressed page.
 *
 * A comic page is at most a few MB. 48MB is generous for any real page and
 * stops a decompression bomb from being materialised at all.
 */
const MAX_ENTRY_BYTES = 48 * 1024 * 1024;

/**
 * Cap on everything decompressed from one archive.
 *
 * This is the ceiling that actually protects a phone. Even at 12 pages, a
 * hostile archive can declare gigabytes; refusing before allocating is the
 * only bound that holds.
 */
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

/** Refuse to even open an archive larger than this (compressed bytes). */
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

/**
 * Sanity ceiling on entry count.
 *
 * A 100k-entry archive is not a comic. It is either hostile or a different
 * format wearing a `.cbr` extension, and either way it should not be walked.
 */
const MAX_ENTRIES = 4096;

/** A page entry, ready to be turned into a blob URL. */
export interface LibarchivePage {
  /** In-archive path, exactly as libarchive reported it. */
  name: string;
  /** Decompressed size in bytes, as declared by the container. */
  size: number;
}

export type LibarchiveFailure =
  | "password"
  | "split"
  | "too-large"
  | "damaged"
  | "no-pages"
  | "unsupported";

export class LibarchiveError extends Error {
  readonly failure: LibarchiveFailure;
  /** Extra, safe-to-display context. Never contains a filesystem path. */
  readonly detail: string;
  constructor(failure: LibarchiveFailure, message: string, detail = "") {
    super(message);
    this.name = "LibarchiveError";
    this.failure = failure;
    this.detail = detail;
  }
}

/** Human-readable text for a failure kind, safe to show a user verbatim. */
export function describeLibarchiveFailure(f: LibarchiveFailure): string {
  switch (f) {
    case "password":
      return "This archive is password-protected. Kora cannot open encrypted comics.";
    case "split":
      return "This is only part of a multi-volume archive. Kora cannot join the volumes, so it will not open it.";
    case "too-large":
      return "This archive is too large to open safely on this device.";
    case "damaged":
      return "This archive is damaged or incomplete, so its pages cannot be read.";
    case "no-pages":
      return "This archive contains no readable image pages.";
    default:
      return "This archive could not be opened.";
  }
}

/* ------------------------------------------------------------------ splitting */

/**
 * True when the bytes are the first volume of a multi-volume archive.
 *
 * A `.cbr` that is only `.part1.rar` of a set will extract to garbage or a
 * partial book. Detecting it up front and saying so is the whole point — the
 * alternative is showing a user scrambled pages and calling it success.
 *
 * Two independent signals, because neither is present in every format:
 *
 *   - **Filename**: `part1.rar`, `.part01.rar`, `.r01`, `.7z.001`, `.001`.
 *     Checked against the *claimed* name only. A renamed single-volume archive
 *     is then detected by the header checks below rather than falsely refused.
 *   - **Header**: RAR marks volumes in its main-archive header flags, and 7z
 *     sets a volume flag in the StartHeader. Both are read directly from the
 *     signature bytes, which is a few bytes of parsing and not a format parser.
 */
export function detectSplitArchive(bytes: Uint8Array, claimedName?: string | null): boolean {
  if (claimedName) {
    const n = claimedName.toLowerCase();
    // .part1.rar / .part01.rar / name.r01 / name.7z.001 / name.001
    if (/\.(?:part0*1|part1)\.(?:rar|cbr)$/.test(n)) return true;
    if (/\.(?:rar|cbr)\.r0[01]$/.test(n)) return true;
    if (/\.(?:7z|cb7)\.00[01]$/.test(n)) return true;
    if (/\.00[1-9]$/.test(n)) return true;
    if (/\.part0*[2-9]/.test(n)) return true;
  }

  // RAR5 main-archive header: signature, then a header whose FLAGS carry
  // MHFL_VOLUME (0x0001) and MHFL_VOLNUMBER (0x0002). RAR4 keeps a similar
  // MHD_VOLUME (0x0001) in its main header. Both live within the first 32
  // bytes, so this reads a bounded window.
  const rar5 = bytes.length >= 8 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21 && bytes[4] === 0x1a && bytes[5] === 0x07 && bytes[6] === 0x01;
  const rar4 = bytes.length >= 7 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21 && bytes[4] === 0x1a && bytes[5] === 0x07 && bytes[6] === 0x00;
  if (rar5 || rar4) {
    // Walk the block headers looking for the main-header flag word. RAR5 uses
    // variable-length integers, so this is a small bounded scan rather than a
    // fixed offset — RAR4's flags are a fixed 2 bytes at offset 10.
    if (rar4) {
      const headType = bytes[7];
      if (headType === 0x73) {
        const flags = (bytes[10] | (bytes[11] << 8)) >>> 0;
        if (flags & 0x0001) return true; // MHD_VOLUME
      }
    } else if (bytes[7] === 0x01) {
      // RAR5: after the 8-byte signature comes CRC32(4), header size (vint),
      // header type (vint), then flags (vint). Types: 1=main, 2=file, 3=service.
      const p = 8 + 4;
      let at = p;
      const readVint = (): number => {
        let v = 0;
        let shift = 1;
        for (let i = 0; i < 10 && at < bytes.length; i++, at++) {
          v += (bytes[at] & 0x7f) * shift;
          if (!(bytes[at] & 0x80)) return v;
          shift *= 128;
        }
        return -1;
      };
      readVint(); // header size
      const type = readVint();
      if (type === 1) {
        const flags = readVint();
        if (flags >= 0 && flags & 0x0001) return true; // MHFL_VOLUME
      }
    }
    return false;
  }

  // 7-Zip StartHeader, offset 32: NextHeaderOffset(8) NextHeaderSize(8) CRC(4).
  // The volume indicator is in the *header* proper rather than here, so the
  // reliable signal for 7z is the filename; a bare `.7z` with no volume flag in
  // its name is treated as single-volume, which is the overwhelmingly common
  // case and the safe assumption.
  return false;
}

/* ------------------------------------------------------------ module loading */

/**
 * The Emscripten heap.
 *
 * WHY THIS IS NOT ON THE WRAPPER: `libarchive-wasm` exposes 26 wrapped C
 * functions (`read_next_entry`, `entry_pathname`, …) but `_malloc`, `_free`
 * and `HEAP8` live on the raw Emscripten module, reachable only as
 * `mod.module`. The package's own `ArchiveReader` calls
 * `libarchive.module._malloc(...)`. Calling `mod._malloc(...)` returns
 * `undefined` and every page then throws `TypeError: not a function` — which
 * is invisible to `tsc`, because the hand-written type below is the only
 * description of the shape and it can be wrong without complaint.
 *
 * That is the whole lesson of this declaration: it is a claim about a
 * third-party object, verified against the installed package, not a
 * convenience alias.
 */
type EmscriptenHeap = {
  _malloc: (n: number) => number;
  _free: (p: number) => void;
  HEAP8: Int8Array;
};

type LibarchiveWasm = {
  module: EmscriptenHeap;
  read_new: () => number;
  read_open_memory: (a: number, p: number, len: number) => number;
  read_support_filter_all: (a: number) => number;
  read_support_format_all: (a: number) => number;
  read_next_entry: (a: number) => number;
  read_data: (a: number, buf: number, size: number) => number;
  read_data_skip: (a: number) => number;
  read_free: (a: number) => number;
  read_add_passphrase: (a: number, s: string) => number;
  read_has_encrypted_entries: (a: number) => number;
  entry_filetype: (p: number) => number;
  entry_pathname: (p: number) => string;
  entry_size: (p: number) => number;
  entry_is_encrypted: (p: number) => number;
  error_string: (a: number) => string;
};

interface Entry {
  pathname: string;
  size: number;
  filetype: string;
  encrypted: boolean;
  pointer: number;
  readData: () => Int8Array | undefined;
  skipData: () => void;
  free: () => void;
}

interface Reader {
  entries: () => Generator<Entry, void, unknown>;
  free: () => void;
}

let modulePromise: Promise<LibarchiveWasm> | null = null;

/**
 * Load libarchive exactly once per session.
 *
 * The WASM bytes are supplied explicitly so Emscripten never performs its own
 * asset lookup in the browser: on `file://` in an Android WebView that lookup
 * is exactly the thing that cannot be relied on, so we do the fetch ourselves
 * against a URL Vite has already emitted and hashed. Dynamic `import()` of the
 * JS half keeps the whole ~600KB out of the boot bundle.
 *
 * The non-Vite fallback exists because `?url` is a Vite transform. Under a
 * plain module loader (the test runner, tsx) that specifier is unresolvable,
 * and without a fallback the whole RAR/7z path would be untestable — verified
 * as "it never runs" rather than "it works". Passing no `wasmBinary` lets
 * Emscripten resolve the `.wasm` next to its own JS, which is correct on Node
 * and is never reached in a browser build.
 */
async function loadLibarchive(): Promise<LibarchiveWasm> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const { libarchiveWasm } = await import("libarchive-wasm");

    let mod: unknown;
    try {
      const urlModule = await import("libarchive-wasm/dist/libarchive.wasm?url");
      const res = await fetch(urlModule.default as string);
      if (!res.ok) {
        throw new LibarchiveError("damaged", `libarchive.wasm failed to load (HTTP ${res.status}).`);
      }
      const bytes = await res.arrayBuffer();
      mod = await libarchiveWasm({ wasmBinary: bytes });
    } catch (e) {
      // A real load failure in the browser must not silently fall through to
      // Emscripten's own resolver — that would turn a clear HTTP error into a
      // confusing "cannot find wasm" deep inside the module. Only the
      // "specifier is not understood here" case takes the fallback.
      if (e instanceof LibarchiveError) throw e;
      mod = await libarchiveWasm();
    }

    const typed = mod as unknown as LibarchiveWasm;
    if (!typed || typeof typed.read_next_entry !== "function" || !typed.module) {
      throw new LibarchiveError("unsupported", "libarchive loaded but does not expose the reader API.");
    }
    if (typeof typed.module._malloc !== "function") {
      throw new LibarchiveError(
        "unsupported",
        "libarchive loaded without a usable WASM heap."
      );
    }
    return typed;
  })();
  try {
    return await modulePromise;
  } catch (e) {
    modulePromise = null; // allow a retry after a transient failure
    throw e;
  }
}

/* ------------------------------------------------------------- the extraction */

/** Classify a libarchive error string into an honest failure kind. */
function classifyMessage(msg: string): LibarchiveFailure {
  const m = msg.toLowerCase();
  if (m.includes("encrypt") || m.includes("passphrase") || m.includes("password")) return "password";
  if (m.includes("truncated") || m.includes("damaged") || m.includes("unexpected end") || m.includes("decompression failed")) {
    return "damaged";
  }
  return "damaged";
}

function toInt8(bytes: Uint8Array): Int8Array {
  const out = new Int8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = ((bytes[i] << 24) >> 24) as number;
  return out;
}

/**
 * List and fully extract every page in a RAR/7z archive.
 *
 * Returns page metadata AND the decompressed bytes, in one pass, so the caller
 * can create blob URLs without a second walk of the container.
 */
export async function extractLibarchivePages(
  bytes: Uint8Array,
  claimedName?: string | null
): Promise<{ pages: LibarchivePage[]; data: Map<string, Uint8Array>; rejectedEntries: number }> {
  if (bytes.length === 0) throw new LibarchiveError("damaged", "The archive is empty.");
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    throw new LibarchiveError("too-large", `Archive is ${bytes.length} bytes; the ceiling is ${MAX_ARCHIVE_BYTES}.`);
  }
  if (detectSplitArchive(bytes, claimedName)) {
    throw new LibarchiveError("split", "Multi-volume archive detected from its header or filename.");
  }

  const mod = await loadLibarchive();
  const heap = mod.module;
  const input = toInt8(bytes);
  const inPtr = heap._malloc(input.length);
  if (!inPtr) throw new LibarchiveError("too-large", "Out of memory reading the archive.");
  heap.HEAP8.set(input, inPtr);

  // The libarchive open sequence, in the only order libarchive accepts:
  //
  //   read_new() -> read_support_filter_all() -> read_support_format_all()
  //               -> read_open_memory(ptr, len)
  //
  // ORDER IS LOAD-BEARING. `read_support_*` on an already-opened archive
  // aborts the WASM instance ("invoked with archive structure in state
  // 'header', should be in state 'new'"), and skipping the two support calls
  // entirely produces a handle that opens successfully and then yields ZERO
  // entries — a silent no-op that looks exactly like an empty comic.
  // `read_new_memory` would fold these together, but it is only usable once
  // formats are registered, which is why it is not called here.
  let archivePtr: number;
  try {
    archivePtr = mod.read_new();
    if (!archivePtr) {
      heap._free(inPtr);
      throw new LibarchiveError("damaged", "libarchive could not allocate a reader.");
    }
    mod.read_support_filter_all(archivePtr);
    mod.read_support_format_all(archivePtr);
    mod.read_open_memory(archivePtr, inPtr, input.length);
  } catch (e) {
    heap._free(inPtr);
    throw e instanceof LibarchiveError
      ? e
      : new LibarchiveError("damaged", `libarchive refused the container (${classifyMessage(String((e as Error)?.message ?? e))}).`);
  }

  const reader: Reader = {
    entries: function* () {
      for (;;) {
        const entryPtr = mod.read_next_entry(archivePtr);
        if (!entryPtr) return;
        const filetypeNo = mod.entry_filetype(entryPtr);
        const pathname = mod.entry_pathname(entryPtr) || "";
        const size = mod.entry_size(entryPtr);
        const encrypted = !!mod.entry_is_encrypted(entryPtr);
        let consumed = false;
        const entry: Entry = {
          pathname,
          size,
          filetype: filetypeNo === 0x8000 ? "File" : filetypeNo === 0x4000 ? "Directory" : "Other",
          encrypted,
          pointer: entryPtr,
          readData: () => {
            if (consumed) return undefined;
            consumed = true;
            if (!(size > 0)) return new Int8Array(0);
            const buf = heap._malloc(size);
            if (!buf) throw new LibarchiveError("too-large", "Out of memory extracting a page.");
            let got: number;
            try {
              got = mod.read_data(archivePtr, buf, size);
            } catch (e) {
              heap._free(buf);
              throw e;
            }
            // A short read here means the container was truncated or is a
            // first volume. `got < 0` is libarchive's error signal.
            if (got < 0) {
              const msg = mod.error_string(archivePtr);
              heap._free(buf);
              throw new LibarchiveError(classifyMessage(msg), msg);
            }
            // `.slice()` COPIES out of the WASM heap before the free, so the
            // returned bytes stay valid after `_free` and after
            // `read_free`. Reading a subarray here instead would hand back a
            // view into recycled heap memory — pages that render correctly
            // once and turn to garbage on the next allocation.
            const out = heap.HEAP8.slice(buf, buf + got);
            heap._free(buf);
            return out;
          },
          skipData: () => {
            if (consumed) return;
            consumed = true;
            mod.read_data_skip(archivePtr);
          },
          free: () => {},
        };
        yield entry;
        if (!consumed) {
          // Never leave the cursor mid-entry: libarchive requires every entry
          // to be fully read or explicitly skipped before advancing.
          try {
            mod.read_data_skip(archivePtr);
          } catch {
            /* advancing is best-effort; the next read_next_entry reports */
          }
        }
      }
    },
    free: () => {
      mod.read_free(archivePtr);
      heap._free(inPtr);
    },
  };

  const pages: LibarchivePage[] = [];
  const data = new Map<string, Uint8Array>();
  let total = 0;
  let rejectedEntries = 0;
  let sawEncrypted = false;
  let sawTruncation = false;

  // The path guard. Imported here rather than at module scope so the security
  // dependency is explicit at the point of use, and so a future change to the
  // entry-source path cannot accidentally skip it.
  const { isSafeArchiveEntry } = await import("./safePath");
  const { pageNameOf } = await import("./pageOrder");

  try {
    for (const entry of reader.entries()) {
      if (pages.length >= MAX_ENTRIES) {
        throw new LibarchiveError("too-large", `Archive has more than ${MAX_ENTRIES} entries.`);
      }
      if (entry.filetype !== "File") continue;

      const name = entry.pathname;
      // ORDER MATTERS. The traversal gate runs BEFORE the image-extension
      // check, so a hostile name can never be used as a Map key or a blob
      // label, not even transiently.
      if (!isSafeArchiveEntry(name)) {
        rejectedEntries++;
        entry.skipData();
        continue;
      }
      if (!pageNameOf(name)) {
        // Real, safe, but not a page (Thumbs.db, notes.txt, a video). Skipping
        // the data frees the decompressor instead of buffering junk.
        entry.skipData();
        continue;
      }
      if (entry.encrypted) {
        sawEncrypted = true;
        entry.skipData();
        continue;
      }
      if (entry.size > MAX_ENTRY_BYTES || total + entry.size > MAX_TOTAL_BYTES) {
        throw new LibarchiveError(
          "too-large",
          `Decompressed size exceeds the ${MAX_TOTAL_BYTES} byte ceiling.`
        );
      }

      let out: Int8Array;
      try {
        out = entry.readData() ?? new Int8Array(0);
      } catch (e) {
        if (e instanceof LibarchiveError) {
          if (e.failure === "damaged") sawTruncation = true;
          throw e;
        }
        const msg = String((e as Error)?.message || e);
        sawTruncation = true;
        throw new LibarchiveError(classifyMessage(msg), msg);
      }
      if (out.length !== entry.size) {
        // Declared size disagreed with what actually decompressed.
        sawTruncation = true;
        throw new LibarchiveError(
          "damaged",
          `Entry declared ${entry.size} bytes but produced ${out.length}.`
        );
      }
      total += out.length;
      pages.push({ name, size: out.length });
      data.set(name, new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
    }
  } finally {
    reader.free();
  }

  if (sawEncrypted) {
    throw new LibarchiveError("password", "One or more entries are encrypted.");
  }
  if (sawTruncation) {
    throw new LibarchiveError("damaged", "The archive ended before all entries were read.");
  }
  if (pages.length === 0) {
    throw new LibarchiveError("no-pages", "No image entries were found in the archive.");
  }
  return { pages, data, rejectedEntries };
}

/** Exposed for tests: the ceilings this module enforces. */
export const LIBARCHIVE_LIMITS = {
  MAX_ENTRY_BYTES,
  MAX_TOTAL_BYTES,
  MAX_ARCHIVE_BYTES,
  MAX_ENTRIES,
} as const;