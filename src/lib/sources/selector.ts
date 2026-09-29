/**
 * jsoup-flavoured selector engine for Kora source plugins.
 *
 * Tachiyomi sources are written against jsoup's selector grammar. To make porting
 * mechanical we accept the same strings and normalise them onto Cheerio, which
 * is the direct jsoup analogue in the JS ecosystem.
 *
 * The two dialects differ in a handful of places, all handled here:
 *   - `:eq(n)`      jsoup indexes 0-based; Cheerio exposes `.eq(n)`. Shimmed.
 *   - `:contains()` jsoup pseudo-class; Cheerio has `:contains()` too, but not
 *                   with a leading `*` in every position — normalised.
 *   - `:first-child` etc. are identical in both.
 */

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

/**
 * Translate a jsoup selector into a css-select/cheerio selector.
 *
 * `a:eq(0)` -> `a` + `.eq(0)` applied afterwards, because css-select does not
 * understand `:eq`. We return the stripped selector plus a list of `:eq(n)`
 * indices to apply in order.
 */
export interface NormalisedSelector {
  selector: string;
  /** Indices pulled out of `:eq(n)`, in the order they appeared. */
  eqIndices: number[];
}

export function normaliseSelector(input: string): NormalisedSelector {
  const eqIndices: number[] = [];
  let out = input;

  // `:eq(3)` -> capture and drop. Supports several in one selector.
  out = out.replace(/:eq\(\s*(-?\d+)\s*\)/gi, (_m, n: string) => {
    eqIndices.push(parseInt(n, 10));
    return "";
  });

  // jsoup writes `:contains("x")`; css-select wants `:contains("x")` too, but
  // a bare `div:contains(...)` is fine. Nothing to change today — kept as an
  // explicit seam if a future dialect gap appears.
  return { selector: out.trim(), eqIndices };
}

export interface SelectOptions {
  /** URL of the document the selection was made from, for absUrl resolution. */
  baseUrl: string;
}

/**
 * Run a jsoup-flavoured selector, applying any `:eq(n)` shims in order.
 * Returns an empty array rather than throwing on a no-match — a broken
 * selector should degrade to "no results", not take down the whole source.
 * A malformed selector is the same class of problem, so it is caught too.
 */
export function selectAll(html: string, selector: string): cheerio.Cheerio<Element> {
  const { selector: normalised, eqIndices } = normaliseSelector(selector);

  // Load once; on a bad selector, hand back an empty selection rather than
  // propagating css-select's parse error into the caller.
  const $ = cheerio.load(html);
  const empty = (): cheerio.Cheerio<Element> =>
    $("*").slice(0, 0) as unknown as cheerio.Cheerio<Element>;

  if (!normalised) return empty();

  let result: cheerio.Cheerio<Element>;
  try {
    result = $(normalised) as unknown as cheerio.Cheerio<Element>;
  } catch {
    return empty();
  }

  for (const idx of eqIndices) {
    // `:eq(-1)` is jsoup's "last match". Cheerio's `.eq` supports negatives too.
    result = result.eq(idx) as unknown as cheerio.Cheerio<Element>;
  }
  return result;
}

/** True when at least one element matches. Used for `nextPage` detection. */
export function exists(html: string, selector: string): boolean {
  if (!selector.trim()) return false;
  try {
    return selectAll(html, selector).length > 0;
  } catch {
    return false;
  }
}

/** Resolve a possibly-relative url against the page it was found on. */
export function absUrl(baseUrl: string, value: string): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

/**
 * Split a site path into the base URL and the extension-relative form.
 *
 * Tachiyomi stores `manga.url` as a path and re-applies `baseUrl` at request
 * time, which is what lets a source survive the site moving. We do the same:
 * `url` fields in a plugin are relative unless they match the base.
 */
export function toRelativeUrl(baseUrl: string, absolute: string): string {
  if (!absolute) return "";
  try {
    const b = new URL(baseUrl);
    const a = new URL(absolute, baseUrl);
    if (a.origin === b.origin) {
      return a.pathname + a.search + a.hash;
    }
  } catch {
    /* fall through to the raw value */
  }
  return absolute;
}

/** Expand `{page}`, `{query}` and friends in a url template. */
export function expandTemplate(
  template: string,
  vars: Record<string, string | number | undefined>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : encodeURIComponent(String(v));
  });
}

/** Text content of a node, whitespace-collapsed the way jsoup's `text()` does. */
export function nodeText(node: AnyNode): string {
  const el = node as Element;
  const children = (el as unknown as { children?: AnyNode[] }).children;
  if (!children) return "";
  const raw = children.map((c) => nodeText(c)).join(" ");
  return raw.replace(/\s+/g, " ").trim();
}
