/**
 * Detect EPUB spine items that are blank or non-story front/back matter
 * so the reader can skip them during open + sequential navigation.
 */

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countImages(html: string): number {
  return (html.match(/<img\b/gi) || []).length;
}

const FRONT_MATTER_TITLE =
  /^(cover|title\s*page|half[- ]?title|copyright|copyright\s*page|dedication|colophon|frontispiece|also by|books by|about the author|acknowledg(e)?ments?|contents|table of contents|toc|epigraph|imprint|legal|credits?)$/i;

const FRONT_MATTER_HREF =
  /(^|\/)(cover|titlepage|title[-_]?page|copyright|dedication|colophon|frontispiece|toc|nav|fm[-_]?\d|halftitle|half[-_]?title)(\.|_|-|$)/i;

const STORY_HINT =
  /\b(chapter|part|prologue|epilogue|section|book\s+\d+|one|two|three|four|five)\b/i;

export type ChapterSkipInfo = {
  skip: boolean;
  reason?: "blank" | "front-matter" | "image-only";
  wordCount: number;
};

/**
 * True when a chapter is blank or typical front-matter the reader should skip
 * when opening a book or turning pages sequentially.
 */
export function classifySkippableChapter(opts: {
  title: string;
  href: string;
  html: string;
  spineIndex: number;
  spineLength: number;
}): ChapterSkipInfo {
  const title = (opts.title || "").trim();
  const href = (opts.href || "").trim();
  const text = stripHtmlToText(opts.html);
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const images = countImages(opts.html);
  const early = opts.spineIndex <= 8;
  const late = opts.spineIndex >= Math.max(0, opts.spineLength - 3);

  // Essentially empty (cover image removed, spacer XHTML, etc.)
  if (wordCount < 4 && images === 0) {
    return { skip: true, reason: "blank", wordCount };
  }

  // Cover / image-only splash with almost no text
  if (wordCount < 12 && images > 0 && (early || FRONT_MATTER_TITLE.test(title) || FRONT_MATTER_HREF.test(href))) {
    return { skip: true, reason: "image-only", wordCount };
  }

  const titledFront = FRONT_MATTER_TITLE.test(title) || FRONT_MATTER_HREF.test(href);
  if (titledFront && (early || late) && wordCount < 450 && !STORY_HINT.test(title)) {
    return { skip: true, reason: "front-matter", wordCount };
  }

  // Author-name / series splash: very short, early, not a numbered chapter
  if (
    early &&
    wordCount > 0 &&
    wordCount < 18 &&
    !STORY_HINT.test(title) &&
    !/\d/.test(title) &&
    images === 0
  ) {
    // Text is mostly the title repeated
    const compact = text.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const titleCompact = title.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (titleCompact && (compact.includes(titleCompact) || titleCompact.includes(compact.slice(0, 24)))) {
      return { skip: true, reason: "front-matter", wordCount };
    }
  }

  return { skip: false, wordCount };
}

export function findFirstReadableChapterIndex(
  chapters: { title: string; href: string; content: string; skip?: boolean }[]
): number {
  const idx = chapters.findIndex((ch) => !ch.skip);
  return idx >= 0 ? idx : 0;
}

export function nextReadableChapterIndex(
  chapters: { skip?: boolean }[],
  fromIdx: number,
  direction: 1 | -1
): number {
  let i = fromIdx + direction;
  while (i >= 0 && i < chapters.length) {
    if (!chapters[i].skip) return i;
    i += direction;
  }
  return fromIdx;
}
