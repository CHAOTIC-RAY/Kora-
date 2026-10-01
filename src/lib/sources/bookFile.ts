/**
 * How a `kind: "book"` source plugin hands back a FILE for a result.
 *
 * The book branch exists because LibreTexts returns a page id (`@id`) and the
 * PDF lives at a fixed path under the plugin's own host. Nothing about that is
 * LibreTexts-specific, so the mapping is declared in the manifest as
 * `endpoints.json.file` and resolved here — the same way `thumb` and `url_` are
 * already declared, rather than hardcoded in a component.
 *
 * A plugin with no `file` rule is not broken, it is simply not downloadable:
 * callers fall back to the online reading link.
 */

/** The subset of a manifest needed to resolve a file URL. */
export interface FileUrlRule {
  /** Path on the plugin's `baseUrl`, e.g. `/@api/deki/pages/{mangaId}/pdf/{title}.pdf`. */
  url: string;
}

interface JsonLike {
  baseUrl?: string;
  endpoints?: { json?: { file?: FileUrlRule } };
}

/**
 * Absolute download URL for a book-plugin result, or "" when the plugin does
 * not declare one.
 *
 * `{mangaId}` is the upstream id the listing returned (`url_`). `{title}` is the
 * display title, which several backends use only as the filename and ignore
 * otherwise — so it is passed through unencoded here and the caller encodes it,
 * matching how the listing already treats it as display text.
 */
export function resolveBookFileUrl(plugin: JsonLike | undefined | null, mangaId: string, title = ""): string {
  const rule = plugin?.endpoints?.json?.file;
  if (!rule?.url || !mangaId) return "";
  const path = rule.url
    .replace(/\{mangaId\}/g, encodeURIComponent(mangaId))
    .replace(/\{id\}/g, encodeURIComponent(mangaId))
    .replace(/\{title\}/g, encodeURIComponent(title));
  if (/^https?:\/\//i.test(path)) return path;
  const base = (plugin?.baseUrl || "").replace(/\/+$/, "");
  return base ? `${base}${path.startsWith("/") ? "" : "/"}${path}` : path;
}
