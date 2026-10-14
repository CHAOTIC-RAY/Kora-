/**
 * Thumbnail extraction for Madara listing cards and detail pages.
 *
 * These are deliberately pure and exported so the behaviour can be tested
 * without a network or a DOM: given a card fragment and a base URL, decide
 * which URL a cover should use, or that there is no usable cover at all.
 *
 * Two failure modes this exists to stop, both seen live in production:
 *
 *  1. Placeholder values. Madara's lazy loader keeps the real image in
 *     `data-src` and puts a spacer in `src` — a 1x1 gif, a `data:` URI, a
 *     `grey.gif`, or a theme's `placeholder.png`. Taking `src` there yields a
 *     grey pixel that is indistinguishable, to a user, from a broken cover.
 *
 *  2. Relative URLs. `//cdn.example/x.jpg` and `/wp-content/x.jpg` are common
 *     and must be resolved against the source's own origin, or the request
 *     goes to Kora's origin and 404s.
 *
 * The `src` attribute is a *fallback*, not a peer: a non-placeholder `src`
 * on a card that has no `data-src` is a legitimately eager image and must
 * still be used.
 */

/** Attributes a Madara lazy loader uses for the real image, best first. */
const LAZY_ATTRS = [
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-lazy",
  "data-echo",
  "data-hi-res-src",
  "data-full-src",
];

/** Attributes that hold the eager image, used only after the lazy ones. */
const EAGER_ATTRS = ["src", "data-srcset", "srcset"];

/**
 * Is this value a lazy-load spacer rather than a cover?
 *
 * True for empty strings, `data:` URIs, and the handful of filenames the
 * Madara themes (and their CDN mirrors) use for spacers. Kept as a list of
 * needles rather than a regex on the whole URL so an ordinary cover that
 * merely happens to contain "load" is not rejected.
 */
export function isPlaceholderThumb(value: string | null | undefined): boolean {
  const v = (value || "").trim();
  if (!v) return true;
  if (/^data:/i.test(v)) return true;
  if (/^javascript:/i.test(v)) return true;
  if (/^about:/i.test(v)) return true;

  // A transparent spacer expressed as a real URL, e.g. /assets/1x1.gif
  if (/(^|\/)(blank|spacer|transparent|pixel|dot)\.[a-z]{2,4}(\?|$)/i.test(v)) return true;
  // The themes' own placeholders and 1x1 tracking gifs.
  if (/(^|[/_-])(1x1|1px|px)\.(gif|png)(\?|$)/i.test(v)) return true;
  if (/placeholder/i.test(v)) return true;
  if (/grey|gray\.(gif|png)/i.test(v)) return true;
  if (/loader|spinner|loading/i.test(v) && !/\.(jpe?g|webp|avif|png)(\?|$)/i.test(v)) return true;
  // An <img> tag or a bare attribute, which happens when a site's markup is
  // captured mid-parse. Never a usable src.
  if (/^</.test(v) || /["']/.test(v)) return true;

  return false;
}

/** Read the first present value for `name` on the fragment's first <img>. */
function attrOnImage(frag: string, name: string): string {
  // Scope to the first <img ...> so an unrelated attribute on the card (a
  // data-src on the card wrapper, a src in an inline <script>) is not used.
  const img = frag.match(/<img\b[^>]*>/i);
  const scope = img ? img[0] : frag;
  const m = scope.match(new RegExp(`\\b${name.replace(/[-]/g, "\\-")}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1].trim() : "";
}

/**
 * `srcset` holds several candidates; the last is the largest, and a 1x1
 * placeholder is usually listed first. Take the last one.
 */
function fromSrcset(v: string): string {
  if (!v) return "";
  const parts = v
    .split(",")
    .map((p) => p.trim().split(/\s+/))
    .filter((p) => p[0])
    .sort((a, b) => parseInt(b[1] || "0", 10) - parseInt(a[1] || "0", 10));
  for (const p of parts) {
    if (!isPlaceholderThumb(p[0])) return p[0];
  }
  return "";
}

/**
 * The best cover URL present in a card (or detail) fragment, absolute,
 * or "" when the markup holds nothing usable.
 */
export function pickThumbUrl(frag: string, baseUrl: string): string {
  if (!frag) return "";

  for (const name of LAZY_ATTRS) {
    const v = attrOnImage(frag, name);
    if (!isPlaceholderThumb(v)) return resolveThumbUrl(v, baseUrl);
  }
  for (const name of EAGER_ATTRS) {
    const raw = attrOnImage(frag, name);
    const v = name.endsWith("srcset") ? fromSrcset(raw) : raw;
    if (!isPlaceholderThumb(v)) return resolveThumbUrl(v, baseUrl);
  }
  return "";
}

/**
 * Make a thumbnail URL absolute against the source's origin.
 *
 * `//cdn/x.jpg` and `/wp-content/x.jpg` are the two forms Madara sites
 * actually emit, and both break if passed to an <img> unresolved: the
 * browser resolves them against Kora's own origin.
 */
export function resolveThumbUrl(value: string | null | undefined, baseUrl: string): string {
  const v = (value || "").trim();
  if (!v || isPlaceholderThumb(v)) return "";

  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("//")) return `https:${v}`;

  const base = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return v.startsWith("/") ? v : "";
  const origin = base.match(/^(https?:\/\/[^/]+)/i)?.[1] || base;

  if (v.startsWith("/")) return origin + v;
  return base + "/" + v;
}
