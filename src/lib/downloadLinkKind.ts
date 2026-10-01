/**
 * What KIND of download link is this?
 *
 * The download-links sheet used to derive three things about a mirror from
 * three independent places: the title came from `m.label` (set upstream, by
 * the Worker or by `buildInstantMirrors`), the "Direct" badge came from
 * `m.isDirect` (also set upstream), and the subtext came from an inline
 * `m.url.includes("mobilism")` check written twice in the component. Nothing
 * reconciled them, so a Mobilism forum link could render as
 *
 *     Rave Direct Download          [Direct]
 *     Mobilism Forum link (requires external browser login)
 *
 * which is a self-contradiction the user can read on one row: a "direct
 * download" that requires an external login is not a direct download, and
 * tapping it yields a login page rather than a file.
 *
 * So classify ONCE, from the URL — the one thing that cannot lie — and
 * render the title, the badge and the subtext from that single result. An
 * upstream label is then a *fallback* for display only; it can never
 * contradict the badge.
 *
 * Pure and dependency-free so it can be tested directly.
 */

export type DownloadLinkKind = "direct" | "forum-login" | "search" | "external";

export interface ClassifiedLink {
  kind: DownloadLinkKind;
  /** "Direct" | "Login" | "Search" | "External" */
  badge: string;
  /** A title that cannot contradict the badge. */
  title: string;
  /** The line under the title. */
  subtext: string;
  /** True only for a link that genuinely serves a file without a login. */
  isDirect: boolean;
  /** Badge tone, so the two surfaces render identically. */
  tone: "emerald" | "amber" | "slate";
}

const u = (url?: string | null) => (url || "").trim().toLowerCase();

/**
 * If the Worker already returned a relative proxy URL, classify the inner
 * upstream target — not the `/api/proxy-file` path itself.
 */
export function unwrapProxyUrl(url?: string | null): string {
  const raw = (url || "").trim();
  if (!raw) return raw;
  const tryParse = (href: string) => {
    try {
      const u = new URL(href, "https://kora.invalid");
      if (u.pathname === "/api/proxy-file" || u.pathname === "/api/proxy-file/") {
        const inner = u.searchParams.get("url");
        if (inner) return inner;
      }
    } catch {
      /* ignore */
    }
    return href;
  };
  if (raw.startsWith("/api/proxy-file")) return tryParse(raw);
  return tryParse(raw);
}

/** Signed file links that really do stream a file with no account. */
const DIRECT_HOSTS = [
  "libgen.is",
  "libgen.rs",
  "libgen.li",
  "libgen.st",
  "libgen.ro",
  "library.lol",
  "z-lib.io",
  "annas-archive.org",
  "annas-archive.se",
  "archive.org",
  "booksdl.lc",
  "cloudflare-ipfs.com",
];

/** Forum/thread pages that are behind a login wall. */
const FORUM_HOSTS = ["mobilism.org", "mobilism.net", "mobilism"];

const SEARCH_HOSTS = ["duckduckgo.com", "google.com", "bing.com", "search."];

export function classifyDownloadLink(
  link: { url?: string | null; label?: string | null; isDirect?: boolean } | null | undefined
): ClassifiedLink {
  const url = unwrapProxyUrl(link?.url || "").trim();
  const lower = u(url);
  const host = (() => {
    const m = lower.match(/^https?:\/\/([^/?#]+)/);
    return m ? m[1] : lower;
  })();

  // 1. A forum link is never direct, whatever the upstream label claims.
  if (FORUM_HOSTS.some((h) => host.includes(h) || lower.includes(h))) {
    return {
      kind: "forum-login",
      badge: "Login",
      title: "Mobilism Forum Thread",
      subtext: "Opens the Mobilism forum — you will need to log in there first",
      isDirect: false,
      tone: "amber",
    };
  }

  // 2. A signed file link really is a direct download.
  //    `get.php?md5=` is LibGen's file endpoint specifically; a bare
  //    `libgen` search or book page is not a file.
  const isSignedFile =
    /\bget\.php\?[^#]*\bmd5=/i.test(url) ||
    /\bmd5=[0-9a-f]{16,}/i.test(url) ||
    (DIRECT_HOSTS.some((h) => host.includes(h)) &&
      !SEARCH_HOSTS.some((h) => host.includes(h)) &&
      /\.(epub|pdf|mobi|azw3?|djvu|cbz|cbr|zip)(\?|$)/i.test(url));
  if (isSignedFile) {
    return {
      kind: "direct",
      badge: "Direct",
      title: link?.label || "Direct Download",
      subtext: "Downloads the file directly — no login needed",
      isDirect: true,
      tone: "emerald",
    };
  }

  // 3. A search page: a starting point, not a file.
  if (SEARCH_HOSTS.some((h) => host.includes(h))) {
    return {
      kind: "search",
      badge: "Search",
      title: link?.label || "Find this title",
      subtext: "Search page — you will need to pick the file yourself",
      isDirect: false,
      tone: "slate",
    };
  }

  // 4. Anything else the upstream called direct is a bare external page.
  //    Trust `isDirect` only as a hint here, never over a forum URL.
  return {
    kind: "external",
    badge: "External",
    title: link?.label || "External Link",
    subtext: "Opens an external site",
    isDirect: false,
    tone: "amber",
  };
}
