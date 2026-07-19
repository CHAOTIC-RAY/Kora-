import type { BookHighlight } from "./firebase";

const COLOR_CLASS: Record<BookHighlight["color"], string> = {
  yellow: "kora-hl kora-hl-yellow",
  green: "kora-hl kora-hl-green",
  blue: "kora-hl kora-hl-blue",
  pink: "kora-hl kora-hl-pink",
};

/** Normalize typography so selection text matches EPUB source text. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[\u2018\u2019\u201A\u2032\u0060]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(part: string): string {
  return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function needleToPattern(target: string): string {
  // Escape each character individually — escaping the whole word then splitting
  // would break sequences like "\." into "\" + "." and match incorrectly.
  return target
    .split(" ")
    .map((part) =>
      Array.from(part)
        .map((ch) => `${escapeRegex(ch)}[\\u00AD\\u200B\\u200C\\u200D\\uFEFF]?`)
        .join("")
    )
    .join("\\s+");
}

/**
 * Length-preserving flatten so regex indices map back to text nodes.
 * Curly quotes / nbsp become ASCII equivalents of the same length.
 */
function flattenForSearch(raw: string): string {
  return raw
    .replace(/[\u2018\u2019\u201A\u2032\u0060]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u00A0/g, " ");
}

function createMark(
  doc: Document,
  highlightId: string,
  color: BookHighlight["color"]
): HTMLElement {
  const mark = doc.createElement("mark");
  mark.className = COLOR_CLASS[color] || COLOR_CLASS.yellow;
  mark.setAttribute("data-hl-id", highlightId);
  return mark;
}

function wrapRange(
  range: Range,
  highlightId: string,
  color: BookHighlight["color"]
): boolean {
  const doc = range.startContainer.ownerDocument || document;
  const mark = createMark(doc, highlightId, color);
  try {
    range.surroundContents(mark);
    return true;
  } catch {
    try {
      const contents = range.extractContents();
      mark.appendChild(contents);
      range.insertNode(mark);
      // Avoid empty text-node leftovers breaking layout
      mark.normalize();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Wrap the first occurrence of `needle` across text nodes under `root`.
 */
export function wrapFirstOccurrence(
  root: HTMLElement,
  needle: string,
  highlightId: string,
  color: BookHighlight["color"]
): boolean {
  const target = normalizeForMatch(needle);
  if (target.length < 2) return false;

  const safeId = highlightId.replace(/["'\\]/g, "");
  if (root.querySelector(`mark[data-hl-id="${safeId}"]`)) return true;

  const ownerDoc = root.ownerDocument || document;
  const walker = ownerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent || !/\S/.test(node.textContent)) return NodeFilter.FILTER_REJECT;
      if ((node.parentElement as HTMLElement | null)?.closest("mark.kora-hl, script, style")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  type Piece = { node: Text; start: number; end: number };
  const pieces: Piece[] = [];
  let flatRaw = "";
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const node = n as Text;
    const value = node.textContent || "";
    pieces.push({ node, start: flatRaw.length, end: flatRaw.length + value.length });
    flatRaw += value;
  }

  const flat = flattenForSearch(flatRaw);
  const re = new RegExp(needleToPattern(target));
  const match = re.exec(flat);
  if (!match || match.index == null) return false;

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;

  const startPiece = pieces.find((p) => matchStart >= p.start && matchStart < p.end);
  const endPiece = pieces.find((p) => matchEnd > p.start && matchEnd <= p.end);
  if (!startPiece || !endPiece) return false;

  try {
    const range = ownerDoc.createRange();
    range.setStart(startPiece.node, matchStart - startPiece.start);
    range.setEnd(endPiece.node, matchEnd - endPiece.start);
    return wrapRange(range, highlightId, color);
  } catch {
    return false;
  }
}

/** Apply highlights onto a live DOM subtree (preferred — matches what the user sees). */
export function applyHighlightsToElement(
  root: HTMLElement | null | undefined,
  highlights: BookHighlight[],
  chapterIdx: number
): number {
  if (!root) return 0;
  const chapterHighlights = highlights
    .filter((h) => h.chapterIdx === chapterIdx && h.text?.trim())
    .sort((a, b) => b.text.length - a.text.length);
  let applied = 0;
  for (const h of chapterHighlights) {
    if (wrapFirstOccurrence(root, h.text, h.id, h.color)) applied += 1;
  }
  return applied;
}

/** Wrap the current window selection in a highlight mark (call before clearing selection). */
export function wrapSelectionWithHighlight(
  color: BookHighlight["color"],
  highlightId: string,
  container?: HTMLElement | null
): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (container) {
    const ancestor = range.commonAncestorContainer;
    if (!container.contains(ancestor.nodeType === 1 ? ancestor : ancestor.parentNode)) {
      return false;
    }
  }
  return wrapRange(range.cloneRange(), highlightId, color);
}

/**
 * Inject saved highlights into chapter HTML for in-book display.
 * Parses into document.body (no wrapper div) so EPUB </div> tags cannot truncate content.
 */
export function applyHighlightsToHtml(
  html: string,
  highlights: BookHighlight[],
  chapterIdx: number
): string {
  if (!html || typeof DOMParser === "undefined") return html;
  const chapterHighlights = highlights
    .filter((h) => h.chapterIdx === chapterIdx && h.text?.trim())
    .sort((a, b) => b.text.length - a.text.length);
  if (!chapterHighlights.length) return html;

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const root = doc.body;
    if (!root) return html;

    for (const h of chapterHighlights) {
      wrapFirstOccurrence(root, h.text, h.id, h.color);
    }
    return root.innerHTML;
  } catch {
    return html;
  }
}
