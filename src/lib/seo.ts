/**
 * Lightweight SEO helper for the Kora SPA.
 *
 * Kora is client-rendered, so crawlers see the static shell in index.html.
 * This module keeps per-route <title>/meta consistent and updates the
 * document head when the active view changes (progressive enhancement).
 *
 * The homepage-level Open Graph / Twitter / JSON-LD tags live in index.html;
 * here we only patch the dynamic bits (title + description + canonical).
 */

export interface SeoOptions {
  title?: string;
  description?: string;
  /** Path or absolute URL used for <link rel="canonical"> and og:url. */
  canonical?: string;
  /** "article" for blog/guide pages, "website" otherwise. */
  type?: "website" | "article";
  image?: string;
  noindex?: boolean;
}

const BASE_URL = "https://kora.chaoticstudio.workers.dev";
const SITE_NAME = "Kora — Your Reading Lounge";

function ensureMeta(selector: string, attr: "name" | "property", key: string): HTMLMetaElement {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  return el;
}

function ensureLink(rel: string): HTMLLinkElement {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  return el;
}

export function setSeo(opts: SeoOptions): void {
  if (typeof document === "undefined") return;

  const title = opts.title ? `${opts.title} · Kora` : SITE_NAME;
  if (document.title !== title) document.title = title;

  if (opts.description) {
    ensureMeta('meta[name="description"]', "name", "description").setAttribute("content", opts.description);
    ensureMeta('meta[property="og:description"]', "property", "og:description").setAttribute("content", opts.description);
    ensureMeta('meta[name="twitter:description"]', "name", "twitter:description").setAttribute("content", opts.description);
  }

  const url = opts.canonical
    ? opts.canonical.startsWith("http")
      ? opts.canonical
      : `${BASE_URL}${opts.canonical.startsWith("/") ? "" : "/"}${opts.canonical}`
    : BASE_URL;

  ensureLink("canonical").setAttribute("href", url);
  ensureMeta('meta[property="og:url"]', "property", "og:url").setAttribute("content", url);

  if (opts.type) {
    ensureMeta('meta[property="og:type"]', "property", "og:type").setAttribute("content", opts.type);
  }

  if (opts.image) {
    const img = opts.image.startsWith("http") ? opts.image : `${BASE_URL}${opts.image.startsWith("/") ? "" : "/"}${opts.image}`;
    ensureMeta('meta[property="og:image"]', "property", "og:image").setAttribute("content", img);
    ensureMeta('meta[name="twitter:image"]', "name", "twitter:image").setAttribute("content", img);
  }

  // Robots: allow indexing by default; support noindex for transient views.
  ensureMeta('meta[name="robots"]', "name", "robots").setAttribute("content", opts.noindex ? "noindex, nofollow" : "index, follow");
}

/** Reset to the default homepage SEO state. */
export function resetSeo(): void {
  setSeo({ title: "", description: undefined });
}
