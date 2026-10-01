/**
 * Page order inside a comic archive.
 *
 * A CBZ has no page order of its own — the order is the order of the
 * filenames, and scanlation groups produce filename sets that defeat naive
 * sorting:
 *
 *     1.jpg  10.jpg  2.jpg          <- lexicographic puts 10 before 2
 *     page1.jpg page10.jpg page2.jpg
 *     001_cover.jpg 001_p001.jpg 001_p002.jpg
 *     ch01_p01.webp ch01_p02.webp ch01_p10.webp
 *     01.jpg  01 (1).jpg  01-2.jpg  01b.jpg   <- no digits to sort on
 *
 * The rule is therefore two-tier, and the tier is chosen from the whole set
 * rather than per file:
 *
 *   1. If *every* page name reduces to a number, sort numerically. This is
 *      the common case and the only one where a wrong guess silently
 *      scrambles a book — getting 2 before 10 is the difference between
 *      reading the comic and reading every tenth page.
 *   2. Otherwise natural sort: runs of digits compare as numbers, everything
 *      else compares as text. Handles "page1/page10", "ch01_p02", and a set
 *      where only some names carry digits.
 *
 * Pure and synchronous so it can be unit tested on plain strings — which is
 * the only place this logic is ever going to be wrong, and it must be
 * testable without building an archive first.
 */

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|bmp|jxl)$/i;

/** Trailing separators and `__MACOSX` noise, which is never a real page. */
function isJunkName(name: string): boolean {
  const base = name.split(/[\\/]/).pop() || "";
  if (!base) return true;
  if (base.startsWith(".")) return true;
  return /^__MACOSX([\\/]|$)/i.test(name);
}

/**
 * True for a member that is neither a page nor real content — `Thumbs.db`,
 * `.DS_Store`, `__MACOSX/._…`, an empty placeholder.
 *
 * Separate from {@link pageNameOf} because the CBZ-versus-ZIP decision needs
 * the *denominator*: an archive of 3 pages plus `Thumbs.db` is a comic, and a
 * ratio computed against the raw member count would say otherwise.
 */
export function isJunkEntry(name: string): boolean {
  if (isJunkName(name)) return true;
  const base = name.split(/[\\/]/).pop() || "";
  return base === "Thumbs.db" || base === "Thumbs.db:encryptable" || base === "desktop.ini" || base === ".nomedia";
}

/** The full in-archive path, or "" when the name is not a readable page image. */
export function pageNameOf(entry: string): string {
  if (isJunkName(entry)) return "";
  if (!IMAGE_EXT.test(entry)) return "";
  return entry;
}

/** The digits a page name is "really" about, or null when it has none. */
function numericKey(name: string): number | null {
  const base = (name.split(/[\\/]/).pop() || "").replace(IMAGE_EXT, "");
  // A run of digits, optionally zero-padded, possibly with a little prefix
  // ("p12", "page_12"). Anything else — "01 (1)" — is not a clean number.
  const m = base.match(/^(?:[^\d]*?)(\d+)$/);
  if (!m) return null;
  return Number(m[1]);
}

/** Every entry that is a readable page image, unsorted. */
export function imagePageNames(entries: Iterable<string>): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const n = pageNameOf(e);
    if (n) out.push(n);
  }
  return out;
}

/**
 * Every entry that is *real content* — a page image, or something the archive
 * genuinely ships. Used as the denominator of the CBZ image ratio.
 */
export function contentEntryNames(entries: Iterable<string>): string[] {
  const out: string[] = [];
  for (const e of entries) if (!isJunkEntry(e)) out.push(e);
  return out;
}

/**
 * Numeric when the whole set allows it, natural otherwise.
 *
 * Note the `hasDirectory` clause, which is not decoration. A numeric sort
 * keyed on the *basename* is only correct for a flat archive. With folders in
 * play, `Vol 01/001.jpg`, `Vol 01/002.jpg`, `Vol 02/001.jpg` all reduce to
 * basename 1 and 2, and a basename-only sort interleaves the volumes — so a
 * nested archive must be ordered by its whole path, which is what natural
 * comparison already does correctly.
 */
export function pageSortRule(entries: readonly string[]): "numeric" | "natural" {
  if (!entries.length) return "natural";
  if (entries.some((e) => e.includes("/") || e.includes("\\"))) return "natural";
  return entries.every((e) => numericKey(e) !== null) ? "numeric" : "natural";
}

/**
 * Front matter: a page name carrying no digits at all.
 *
 * `cover.jpg`, `back.jpg`, `inside.jpg`, `title.jpg`. These sort BEFORE every
 * numbered page, and that is a rule about the convention rather than about
 * string comparison — `cover.jpg` is page one of the book, and in every
 * archive that mixes the two it is physically first.
 *
 * It is a separate predicate rather than a branch inside
 * {@link naturalCompare} because it is only true of a *whole* page name. A
 * name like `vol2_cover.jpg` contains digits and is not front matter, it is a
 * volume two cover, which sorts after `vol1_cover.jpg` like anything else.
 */
function isFrontMatter(name: string): boolean {
  const base = (name.split(/[\\/]/).pop() || "").replace(IMAGE_EXT, "");
  return base.length > 0 && !/\d/.test(base);
}

/**
 * Natural comparison: digit runs compare as numbers, everything else as text.
 *
 * A digit run does NOT automatically outrank a text run. `cover.jpg` before
 * `01.jpg` is what a reader wants — a cover IS page one, and in the archives
 * that mix the two the cover is always named without a number. So mixed
 * names are ordered by their text first, then their number, which also puts
 * `ch01_p02` before `ch02_p01`.
 */
export function naturalCompare(a: string, b: string): number {
  const ra = a.match(/\d+|\D+/g) || [];
  const rb = b.match(/\d+|\D+/g) || [];
  const n = Math.min(ra.length, rb.length);
  for (let i = 0; i < n; i++) {
    const x = ra[i];
    const y = rb[i];
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (nx !== ny) {
      // Comparing a digit run against a text run at the same position only
      // happens when the shapes differ, which means neither name has a
      // meaningful number there — fall back to text so the order is at
      // least stable rather than arbitrary.
      return x < y ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  if (ra.length !== rb.length) return ra.length < rb.length ? -1 : 1;
  // Total order, so a set of equal-ranked names never depends on the
  // underlying sort's stability.
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Page image entries in reading order.
 *
 * Stable, total, and independent of the host `Array.prototype.sort`
 * implementation.
 */
export function sortPageNames(entries: readonly string[]): string[] {
  const pages = imagePageNames(entries);
  const rule = pageSortRule(pages);
  return pages
    .map((name, i) => ({ name, i, key: numericKey(name), front: isFrontMatter(name) }))
    .sort((a, b) => {
      // Front matter first, always — see isFrontMatter.
      if (a.front !== b.front) return a.front ? -1 : 1;
      if (rule === "numeric" && a.key !== null && b.key !== null && a.key !== b.key) {
        return a.key - b.key || a.i - b.i;
      }
      return naturalCompare(a.name, b.name) || a.i - b.i;
    })
    .map((p) => p.name);
}