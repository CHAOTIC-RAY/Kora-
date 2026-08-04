// Small text helpers for the Kora writer (Find & Replace, etc.)

/** Replace every occurrence of `find` with `replace` (case-sensitive). */
export function replaceAll(haystack: string, find: string, replace: string): string {
  if (!find) return haystack;
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return haystack.replace(new RegExp(escaped, "g"), replace);
}

/** Count words in a plain-text string. */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Count characters excluding whitespace. */
export function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}
