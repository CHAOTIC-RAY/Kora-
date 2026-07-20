/**
 * Resolve human-readable EPUB chapter titles from NCX / EPUB3 nav,
 * falling back to headings (never Calibre-style file ids like "c42").
 */

import type JSZip from "jszip";

function pathResolve(base: string, href: string): string {
  if (href.startsWith("/")) return href.slice(1);
  if (!base) return href;
  const stack = base.split("/").filter(Boolean);
  for (const part of href.split("/")) {
    if (part === "..") stack.pop();
    else if (part !== "." && part !== "") stack.push(part);
  }
  return stack.join("/");
}

/** Titles that are filenames / spine ids, not real chapter names. */
export function isBogusChapterTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (/^(unknown|untitled|index|toc|contents|nav)$/i.test(t)) return true;
  // Calibre / converter ids: c42, ch01, section0001, xhtml0001
  if (/^[a-z]?\d{1,5}$/i.test(t)) return true;
  if (/^(ch|chapter|sec|section|part|xhtml|item|file)[-_]?\d+$/i.test(t)) return true;
  if (/^[a-z0-9_-]{1,16}$/i.test(t) && !/\s/.test(t) && /\d/.test(t)) return true;
  return false;
}

function rememberTitle(map: Record<string, string>, rootDir: string, contentSrc: string, label: string) {
  const clean = label.replace(/\s+/g, " ").trim();
  if (!clean || isBogusChapterTitle(clean)) return;
  const href = contentSrc.split("#")[0];
  if (!href) return;
  const full = pathResolve(rootDir, href);
  map[full] = clean;
  map[href] = clean;
  map[full.toLowerCase()] = clean;
  map[href.toLowerCase()] = clean;
  const base = href.split("/").pop();
  if (base) {
    map[base] = clean;
    map[base.toLowerCase()] = clean;
  }
}

async function parseNcxTitles(
  zip: JSZip,
  opfDoc: Document,
  manifestItems: Record<string, { href: string; properties: string }>,
  rootDir: string
): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  const ncxId = opfDoc.querySelector("spine")?.getAttribute("toc");
  const ncxHref =
    (ncxId && manifestItems[ncxId]?.href) ||
    Object.values(manifestItems).find((item) => /\.ncx$/i.test(item.href))?.href;
  if (!ncxHref) return titles;

  const ncxPath = pathResolve(rootDir, ncxHref);
  const ncxText = await zip.file(ncxPath)?.async("string");
  if (!ncxText) return titles;

  const ncxDoc = new DOMParser().parseFromString(ncxText, "text/xml");
  ncxDoc.querySelectorAll("navPoint").forEach((point) => {
    const label = point.querySelector("navLabel > text")?.textContent?.trim();
    const content = point.querySelector("content")?.getAttribute("src");
    if (label && content) rememberTitle(titles, rootDir, content, label);
  });
  return titles;
}

async function parseEpub3NavTitles(
  zip: JSZip,
  manifestItems: Record<string, { href: string; properties: string }>,
  rootDir: string
): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  const navHref =
    Object.values(manifestItems).find((item) => /\bnav\b/i.test(item.properties || ""))?.href ||
    Object.values(manifestItems).find((item) => /nav\.(xhtml|html|xml)$/i.test(item.href))?.href;
  if (!navHref) return titles;

  const navPath = pathResolve(rootDir, navHref);
  const navText = await zip.file(navPath)?.async("string");
  if (!navText) return titles;

  const navDoc = new DOMParser().parseFromString(navText, "text/html");
  const tocNav =
    navDoc.querySelector('nav[epub\\:type="toc"], nav[*|type="toc"]') ||
    navDoc.querySelector("nav#toc, nav.toc") ||
    navDoc.querySelector("nav");
  if (!tocNav) return titles;

  tocNav.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const label = anchor.textContent?.replace(/\s+/g, " ").trim() || "";
    if (href && label) rememberTitle(titles, rootDir, href, label);
  });
  return titles;
}

export function titleFromChapterHtml(html: string, fallback: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const heading =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.querySelector("h2")?.textContent?.trim() ||
    doc.querySelector("h3")?.textContent?.trim() ||
    "";
  const pageTitle = doc.querySelector("title")?.textContent?.trim() || "";

  if (heading && !isBogusChapterTitle(heading)) return heading.replace(/\s+/g, " ").trim();
  if (pageTitle && !isBogusChapterTitle(pageTitle)) return pageTitle.replace(/\s+/g, " ").trim();
  if (heading) return heading.replace(/\s+/g, " ").trim();
  return fallback;
}

/**
 * Build href → label map from EPUB TOC (EPUB3 nav preferred, then NCX).
 */
export async function loadEpubTocLabels(
  zip: JSZip,
  opfDoc: Document,
  rootDir: string
): Promise<Record<string, string>> {
  const manifestItems: Record<string, { href: string; properties: string }> = {};
  opfDoc.querySelectorAll("manifest > item, item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) {
      manifestItems[id] = {
        href,
        properties: item.getAttribute("properties") || "",
      };
    }
  });

  const navTitles = await parseEpub3NavTitles(zip, manifestItems, rootDir);
  const ncxTitles = await parseNcxTitles(zip, opfDoc, manifestItems, rootDir);
  return { ...ncxTitles, ...navTitles };
}

export function resolveChapterTitle(
  tocLabels: Record<string, string>,
  rootDir: string,
  relativeHref: string,
  html: string,
  fallback: string
): string {
  const full = pathResolve(rootDir, relativeHref);
  const fromToc =
    tocLabels[full] ||
    tocLabels[relativeHref] ||
    tocLabels[full.toLowerCase()] ||
    tocLabels[relativeHref.toLowerCase()] ||
    tocLabels[relativeHref.split("/").pop() || ""] ||
    tocLabels[(relativeHref.split("/").pop() || "").toLowerCase()];

  if (fromToc && !isBogusChapterTitle(fromToc)) {
    return fromToc.length > 60 ? `${fromToc.slice(0, 57)}…` : fromToc;
  }

  let title = titleFromChapterHtml(html, fallback);
  title = title.replace(/\s+/g, " ").trim();
  if (isBogusChapterTitle(title)) title = fallback;
  if (title.length > 60) title = `${title.slice(0, 57)}…`;
  return title;
}

export { pathResolve as resolveEpubPath };
