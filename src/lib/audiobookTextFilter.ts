const FRONT_MATTER_TITLE =
  /^(cover|title\s*page|half\s*title|copyright|dedication|acknowledg(e)?ments|table\s+of\s+contents|contents|toc|list\s+of\s+(illustrations|characters)|front\s*matter|prologue|preface|foreword|introduction|about\s+the\s+author|also\s+by|epigraph|map|praise\s+for|notes\s+on\s+the\s+type|imprint|colophon|half-title)\b/i;

export function isFrontMatterTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return false;
  if (FRONT_MATTER_TITLE.test(trimmed)) return true;
  if (/^(part|book|volume)\s+[ivxlcdm\d]+$/i.test(trimmed) && trimmed.length < 24) return false;
  return false;
}

export function isTocLikeText(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) return false;

  const tocLines = lines.filter(
    (line) =>
      /\.{2,}\s*\d+\s*$/.test(line) ||
      /^\s*(chapter|part|section)\s+.+?\s+\d+\s*$/i.test(line) ||
      /^\s*\d+\s*$/.test(line) ||
      /^\.+\s*\d+/.test(line)
  );
  return tocLines.length / lines.length >= 0.45;
}

export function isFrontMatterChapter(title: string, text: string): boolean {
  if (isFrontMatterTitle(title)) return true;
  if (isTocLikeText(text)) return true;

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount < 80 && /^(copyright|published|printed|isbn|all rights)/i.test(text.slice(0, 300))) {
    return true;
  }

  return false;
}

export function findFirstNarrativeChapterIndex(
  chapters: { title: string; text: string }[]
): number {
  const idx = chapters.findIndex((chapter) => !isFrontMatterChapter(chapter.title, chapter.text));
  return idx >= 0 ? idx : 0;
}

export function isGibberishLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.length < 3) return true;

  const letters = (trimmed.match(/[a-zA-Z]/g) || []).length;
  const digits = (trimmed.match(/\d/g) || []).length;
  const symbols = trimmed.length - letters - digits - (trimmed.match(/\s/g) || []).length;

  if (letters === 0 && digits > 0) return true;
  if (symbols / trimmed.length > 0.35 && letters / trimmed.length < 0.4) return true;
  if (/(.)\1{5,}/.test(trimmed)) return true;
  if (/^[^a-zA-Z0-9\s]{4,}$/.test(trimmed)) return true;
  if (/^[A-Z0-9._\-/\\|]{6,}$/.test(trimmed)) return true;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    const avgLen = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    if (avgLen < 2.2 && letters / trimmed.length < 0.55) return true;
  }

  return false;
}

export function isGibberishParagraph(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  if (!trimmed) return true;
  if (trimmed.length < 12) return isGibberishLine(trimmed);

  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return true;

  const badLines = lines.filter((line) => isGibberishLine(line)).length;
  if (badLines / lines.length >= 0.6) return true;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 4 && isGibberishLine(trimmed)) return true;

  return false;
}
