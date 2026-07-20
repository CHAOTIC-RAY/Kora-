import JSZip from "jszip";
import { extractEpubChapters, type TextChapter } from "./epubTextExtract";

export type EpubInspectInfo = {
  title: string;
  creator: string;
  language: string;
  publisher?: string;
  identifier?: string;
  chapterCount: number;
  wordCount: number;
  fileCount: number;
  sizeBytes: number;
  coverMime?: string;
  coverBytes?: ArrayBuffer;
};

export type EpubMetadataPatch = {
  title?: string;
  creator?: string;
  language?: string;
  publisher?: string;
};

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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function loadOpf(zip: JSZip): Promise<{
  rootfilePath: string;
  rootDir: string;
  opfText: string;
  opfDoc: Document;
}> {
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("Invalid EPUB: missing container.xml");
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, "text/xml");
  const rootfilePath = containerDoc.querySelector("rootfile")?.getAttribute("full-path");
  if (!rootfilePath) throw new Error("Invalid EPUB: cannot find OPF file");
  const rootDir = rootfilePath.includes("/")
    ? rootfilePath.substring(0, rootfilePath.lastIndexOf("/") + 1)
    : "";
  const opfText = await zip.file(rootfilePath)?.async("string");
  if (!opfText) throw new Error("Invalid EPUB: OPF file not readable");
  const opfDoc = parser.parseFromString(opfText, "text/xml");
  return { rootfilePath, rootDir, opfText, opfDoc };
}

function metaText(opfDoc: Document, localNames: string[]): string {
  for (const localName of localNames) {
    const nodes = [
      ...Array.from(opfDoc.getElementsByTagName(localName)),
      ...Array.from(opfDoc.getElementsByTagName(`dc:${localName}`)),
      ...Array.from(opfDoc.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", localName)),
    ];
    for (const el of nodes) {
      const text = el.textContent?.trim();
      if (text) return text;
    }
  }
  return "";
}

function setOrCreateMeta(opfDoc: Document, localName: string, value: string, ns = "http://purl.org/dc/elements/1.1/") {
  const metadata =
    opfDoc.querySelector("metadata") ||
    (() => {
      const pkg = opfDoc.querySelector("package") || opfDoc.documentElement;
      const created = opfDoc.createElement("metadata");
      pkg.insertBefore(created, pkg.firstChild);
      return created;
    })();

  let el =
    Array.from(metadata.children).find((child) => child.localName === localName) ||
    metadata.getElementsByTagNameNS(ns, localName)[0] ||
    metadata.getElementsByTagName(`dc:${localName}`)[0];

  if (!el) {
    try {
      el = opfDoc.createElementNS(ns, `dc:${localName}`);
    } catch {
      el = opfDoc.createElement(`dc:${localName}`);
    }
    metadata.appendChild(el);
  }
  el.textContent = value;
}

async function findCover(
  zip: JSZip,
  opfDoc: Document,
  rootDir: string
): Promise<{ mime: string; bytes: ArrayBuffer } | null> {
  const manifestItems = Array.from(opfDoc.querySelectorAll("manifest > item, item"));
  const byId: Record<string, Element> = {};
  for (const item of manifestItems) {
    const id = item.getAttribute("id");
    if (id) byId[id] = item;
  }

  const metaCover = opfDoc.querySelector("meta[name='cover']")?.getAttribute("content");
  let coverItem = metaCover ? byId[metaCover] : null;
  if (!coverItem) {
    coverItem =
      manifestItems.find((item) => (item.getAttribute("properties") || "").includes("cover-image")) ||
      manifestItems.find((item) => /cover/i.test(item.getAttribute("id") || "")) ||
      manifestItems.find((item) => /cover/i.test(item.getAttribute("href") || "")) ||
      null;
  }
  if (!coverItem) return null;

  const href = coverItem.getAttribute("href");
  if (!href) return null;
  const path = pathResolve(rootDir, href);
  const file = zip.file(path);
  if (!file) return null;
  const mime = coverItem.getAttribute("media-type") || "image/jpeg";
  const bytes = await file.async("arraybuffer");
  return { mime, bytes };
}

export async function inspectEpub(file: Blob): Promise<EpubInspectInfo> {
  const zip = await JSZip.loadAsync(file);
  const { rootDir, opfDoc } = await loadOpf(zip);
  const chapters = await extractEpubChapters(file).catch((): TextChapter[] => []);
  const wordCount = chapters.reduce(
    (sum, ch) => sum + (ch.text.trim() ? ch.text.trim().split(/\s+/).length : 0),
    0
  );
  const cover = await findCover(zip, opfDoc, rootDir);

  return {
    title: metaText(opfDoc, ["title"]) || "Untitled",
    creator: metaText(opfDoc, ["creator"]) || "Unknown",
    language: metaText(opfDoc, ["language"]) || "en",
    publisher: metaText(opfDoc, ["publisher"]) || undefined,
    identifier: metaText(opfDoc, ["identifier"]) || undefined,
    chapterCount: chapters.length,
    wordCount,
    fileCount: Object.keys(zip.files).length,
    sizeBytes: file.size,
    coverMime: cover?.mime,
    coverBytes: cover?.bytes,
  };
}

export async function patchEpubMetadata(file: Blob, patch: EpubMetadataPatch): Promise<Blob> {
  const zip = await JSZip.loadAsync(file);
  const { rootfilePath, opfDoc } = await loadOpf(zip);

  if (patch.title?.trim()) setOrCreateMeta(opfDoc, "title", patch.title.trim());
  if (patch.creator?.trim()) setOrCreateMeta(opfDoc, "creator", patch.creator.trim());
  if (patch.language?.trim()) setOrCreateMeta(opfDoc, "language", patch.language.trim());
  if (patch.publisher?.trim()) setOrCreateMeta(opfDoc, "publisher", patch.publisher.trim());

  const serializer = new XMLSerializer();
  let nextOpf = serializer.serializeToString(opfDoc);
  if (!nextOpf.includes("<?xml")) {
    nextOpf = `<?xml version="1.0" encoding="UTF-8"?>\n${nextOpf}`;
  }
  zip.file(rootfilePath, nextOpf);

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
  });
}

export async function epubToPlainText(file: Blob): Promise<{ title: string; text: string }> {
  const info = await inspectEpub(file);
  const chapters = await extractEpubChapters(file);
  const text = chapters
    .map((ch) => `# ${ch.title}\n\n${ch.text.trim()}`)
    .join("\n\n\n");
  return { title: info.title, text };
}

function chapterXhtml(title: string, bodyHtml: string, cssHref = "../styles/style.css"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="${cssHref}" />
</head>
<body>
  <h1>${escapeXml(title)}</h1>
  ${bodyHtml}
</body>
</html>`;
}

function textToParagraphHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeXml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

export async function buildEpubFromText(opts: {
  title: string;
  creator?: string;
  language?: string;
  chapters: Array<{ title: string; text: string }>;
}): Promise<Blob> {
  const title = opts.title.trim() || "Untitled";
  const creator = opts.creator?.trim() || "Kora";
  const language = opts.language?.trim() || "en";
  const chapters = opts.chapters.filter((ch) => ch.text.trim());
  if (!chapters.length) throw new Error("Add at least one chapter with text.");

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF")?.file(
    "container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  const oebps = zip.folder("OEBPS");
  oebps?.folder("styles")?.file(
    "style.css",
    `body{font-family:serif;line-height:1.6;margin:1.2em}
h1{font-size:1.4em;margin:0 0 1em}
p{margin:0 0 0.9em;text-indent:1.2em}
p:first-of-type{text-indent:0}`
  );

  const manifestItems: string[] = [
    `<item id="css" href="styles/style.css" media-type="text/css"/>`,
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
  ];
  const spineItems: string[] = [];
  const navPoints: string[] = [];

  chapters.forEach((chapter, index) => {
    const id = `chap${index + 1}`;
    const href = `text/${id}.xhtml`;
    oebps?.file(
      href,
      chapterXhtml(chapter.title || `Chapter ${index + 1}`, textToParagraphHtml(chapter.text))
    );
    manifestItems.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${id}"/>`);
    navPoints.push(
      `<li><a href="${href}">${escapeXml(chapter.title || `Chapter ${index + 1}`)}</a></li>`
    );
  });

  oebps?.file(
    "nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head><meta charset="UTF-8" /><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${navPoints.join("\n      ")}
    </ol>
  </nav>
</body>
</html>`
  );

  const bookId = `kora-${Date.now()}`;
  oebps?.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(creator)}</dc:creator>
    <dc:language>${escapeXml(language)}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join("\n    ")}
  </manifest>
  <spine>
    ${spineItems.join("\n    ")}
  </spine>
</package>`
  );

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
  });
}

export async function downloadBlob(filename: string, blob: Blob) {
  const safe = filename.replace(/[^\w.\- ]+/g, "_");
  try {
    const { shareOrDownloadBlob } = await import("./iosPwa");
    await shareOrDownloadBlob(blob, safe, "Kora");
  } catch {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safe;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

export function slugifyFilename(value: string, ext: string): string {
  const base = value.trim().replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").slice(0, 80) || "kora-export";
  return `${base}.${ext.replace(/^\./, "")}`;
}
