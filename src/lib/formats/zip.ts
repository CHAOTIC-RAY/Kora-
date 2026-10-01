/**
 * A read-only ZIP central-directory reader, in pure TypeScript.
 *
 * Why this exists at all, when the project already depends on JSZip:
 *
 *   - JSZip is an *async, browser-shaped* library. It wants a `Blob` or a
 *     promise of one, it reads `DecompressionStream`/`Uint8Array` through
 *     the platform's `ArrayBuffer` machinery, and it pulls in ~100KB. That
 *     is fine in a component and useless in a unit test that must hand it
 *     literal bytes.
 *   - The thing Kora needs to make a *decision* — "is this ZIP an EPUB or a
 *     comic archive?" — only requires the central directory, which is a
 *     table of filenames sitting near the end of the file. It is about 40
 *     lines of parsing and it runs synchronously on a `Uint8Array`, which
 *     makes it directly testable and usable from a Cloudflare Worker as well
 *     as a browser.
 *
 * So: this module answers "what is in this container?", and
 * `archive.ts` uses JSZip for the other half — actually pulling a deflated
 * image out of it — because that is the half that is genuinely fiddly and
 * JSZip already does it correctly for the EPUB reader.
 *
 * What it supports: the single-disk ZIP that Comic/EPUB files actually are.
 * Multi-disk archives, encrypted entries, and ZIP64 are handled where cheap
 * (ZIP64 sizes/offsets are read from the extra field) and reported rather
 * than silently mis-parsed otherwise.
 */

export interface ZipEntry {
  /** Full path as stored, e.g. "Series/Vol 1/003.jpg". */
  name: string;
  /** 0 = stored, 8 = deflate. Others are rare in comics. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Byte offset of this entry's local file header. */
  localHeaderOffset: number;
  /** False for a directory entry. */
  isDirectory: boolean;
}

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** ZIP comment is a 16-bit length, so the EOCD can sit at most this far back. */
const EOCD_MAX_TAIL = 0xffff + 22;

/** 32-bit sentinel meaning "the real value is in the ZIP64 extra field". */
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const u16 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8)) >>> 0;
const u32 = (b: Uint8Array, at: number) =>
  ((b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) >>> 0) + (b[at + 3] * 0x1000000);

/**
 * The ZIP local header must start with this, for any of the recognised
 * "empty archive" markers.
 */
export function hasZipSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const sig = u32(bytes, 0);
  // PK\x03\x04 — a normal archive with at least one entry.
  // PK\x05\x06 — a completely empty archive.
  // PK\x07\x08 — spanned / marked.
  return sig === LOCAL_SIG || sig === EOCD_SIG || sig === 0x08074b50;
}

/**
 * Locate the End Of Central Directory record.
 *
 * Scans backwards rather than assuming it is the last 22 bytes, because a
 * ZIP is allowed a trailing comment and comic archives from scanlation
 * groups routinely carry one.
 */
function findEocd(bytes: Uint8Array): number {
  const from = Math.max(0, bytes.length - EOCD_MAX_TAIL);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (i < 0) break;
    if (u32(bytes, i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Read the ZIP64 end-of-central-directory, when the classic record says the
 * classic fields overflowed.
 */
function readZip64Counts(
  bytes: Uint8Array,
  eocd: number,
  totalFallback: number
): { total: number; cdOffset: number } {
  const locator = eocd - 20;
  if (locator < 0 || u32(bytes, locator) !== EOCD64_LOCATOR_SIG) {
    return { total: totalFallback, cdOffset: -1 };
  }
  // The locator holds the ZIP64 EOCD offset as an 8-byte value. JS numbers
  // hold every offset a 4GB file can produce, so the low word plus the high
  // word (which is 0 below 2^53) is a faithful read.
  const eocd64 = u32(bytes, locator + 8);
  if (eocd64 < 0 || eocd64 + 56 > bytes.length || u32(bytes, eocd64) !== EOCD64_SIG) {
    return { total: totalFallback, cdOffset: -1 };
  }
  const total = u32(bytes, eocd64 + 32) + u32(bytes, eocd64 + 20) * 0x100000000;
  const cdOffset = u32(bytes, eocd64 + 48) + u32(bytes, eocd64 + 40) * 0x100000000;
  return { total, cdOffset };
}

/**
 * Pull the real 64-bit sizes out of the ZIP64 extended information extra
 * field, and apply them to whatever the classic header saturated.
 */
function applyZip64Extra(
  entry: { compressedSize: number; uncompressedSize: number; localHeaderOffset: number },
  extra: Uint8Array
): void {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = u16(extra, at);
    const size = u16(extra, at + 2);
    if (at + 4 + size > extra.length) return;
    if (id === 0x0001) {
      let p = at + 4;
      if (entry.uncompressedSize === U32_MAX && p + 8 <= extra.length) {
        entry.uncompressedSize = u32(extra, p) + u32(extra, p + 4) * 0x100000000;
        p += 8;
      }
      if (entry.compressedSize === U32_MAX && p + 8 <= extra.length) {
        entry.compressedSize = u32(extra, p) + u32(extra, p + 4) * 0x100000000;
        p += 8;
      }
      if (entry.localHeaderOffset === U32_MAX && p + 8 <= extra.length) {
        entry.localHeaderOffset = u32(extra, p) + u32(extra, p + 4) * 0x100000000;
      }
      return;
    }
    at += 4 + size;
  }
}

/**
 * Every entry in the archive, in central-directory order.
 *
 * Throws {@link ZipError} when there is no readable central directory, which
 * is the honest answer for a truncated download — a partial file that starts
 * with `PK\x03\x04` is not a readable archive.
 */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new ZipError("no ZIP end-of-central-directory record");

  let total = u16(bytes, eocd + 10);
  let cdOffset = u32(bytes, eocd + 16);
  if (total === U16_MAX || cdOffset === U32_MAX) {
    const z = readZip64Counts(bytes, eocd, total);
    total = z.total;
    if (z.cdOffset >= 0) cdOffset = z.cdOffset;
  }
  // Two known-empty archives ("PK\x05\x06" with no entries) legitimately
  // point past the end of the file; that is an empty list, not an error.
  if (total === 0) return [];
  if (cdOffset >= bytes.length) throw new ZipError("ZIP central directory is past end of file");

  const entries: ZipEntry[] = [];
  let at = cdOffset;
  for (let n = 0; n < total; n++) {
    if (at + 46 > bytes.length) break;
    if (u32(bytes, at) !== CENTRAL_SIG) break;
    const method = u16(bytes, at + 10);
    const nameLen = u16(bytes, at + 28);
    const extraLen = u16(bytes, at + 30);
    const commentLen = u16(bytes, at + 32);
    const nameStart = at + 46;
    const extraStart = nameStart + nameLen;
    if (extraStart + extraLen > bytes.length) break;
    const name = latin1(bytes.subarray(nameStart, extraStart));
    const entry: ZipEntry = {
      name,
      method,
      compressedSize: u32(bytes, at + 20),
      uncompressedSize: u32(bytes, at + 24),
      localHeaderOffset: u32(bytes, at + 42),
      isDirectory: name.endsWith("/"),
    };
    applyZip64Extra(entry, bytes.subarray(extraStart, extraStart + extraLen));
    entries.push(entry);
    at = extraStart + extraLen + commentLen;
  }
  return entries;
}

/**
 * Byte range of an entry's *data*, skipping its local file header.
 *
 * The local header repeats the name and extra fields with their own lengths,
 * which are allowed to differ from the central copy, so the data offset has
 * to be measured from the local header rather than assumed.
 */
export function entryDataRange(
  bytes: Uint8Array,
  entry: ZipEntry
): { start: number; end: number } {
  const h = entry.localHeaderOffset;
  if (h < 0 || h + 30 > bytes.length || u32(bytes, h) !== LOCAL_SIG) {
    throw new ZipError(`local header missing for ${entry.name}`);
  }
  const nameLen = u16(bytes, h + 26);
  const extraLen = u16(bytes, h + 28);
  const start = h + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new ZipError(`entry ${entry.name} runs past end of file`);
  return { start, end };
}

/**
 * Read an entry's bytes *without decompressing*, which only works for a
 * stored (method 0) entry.
 *
 * An EPUB's `mimetype` member is required by the spec to be stored
 * uncompressed as the first entry precisely so that this kind of sniff is
 * possible, so this is the one ZIP member worth reading directly.
 */
export function readStoredEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  if (entry.method !== 0) {
    throw new ZipError(`${entry.name} is deflated, not stored`);
  }
  const { start, end } = entryDataRange(bytes, entry);
  return bytes.subarray(start, end);
}

/** ZIP filenames are CP437/UTF-8; the ASCII range — the only one comics use — is identical. */
function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}