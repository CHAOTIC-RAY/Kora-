import type { BookHighlight } from "./firebase";

const COLOR_CLASS: Record<BookHighlight["color"], string> = {
  yellow: "kora-hl kora-hl-yellow",
  green: "kora-hl kora-hl-green",
  blue: "kora-hl kora-hl-blue",
  pink: "kora-hl kora-hl-pink",
};

function normalizeForMatch(text: string): string {
  return text
    .replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Wrap the first occurrence of `needle` across text nodes under `root`
 * in a <mark data-hl-id="..."> element.
 */
function wrapFirstOccurrence(
  root: HTMLElement,
  needle: string,
  highlightId: string,
  color: BookHighlight["color"]
): boolean {
  const target = normalizeForMatch(needle);
  if (target.length < 2) return false;

  const safeId = highlightId.replace(/["'\\]/g, "");
  if (root.querySelector(`mark[data-hl-id="${safeId}"]`)) return true;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
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
  let flat = "";
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const node = n as Text;
    const value = node.textContent || "";
    pieces.push({ node, start: flat.length, end: flat.length + value.length });
    flat += value;
  }

  const pattern = target
    .split(" ")
    .map((part) =>
      part
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .split("")
        .join("[\\u00AD\\u200B\\u200C\\u200D\\uFEFF]?")
    )
    .join("\\s+");
  const re = new RegExp(pattern);
  const match = re.exec(flat);
  if (!match || match.index == null) return false;

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;

  const startPiece = pieces.find((p) => matchStart >= p.start && matchStart < p.end);
  const endPiece = pieces.find((p) => matchEnd > p.start && matchEnd <= p.end);
  if (!startPiece || !endPiece) return false;

  const mark = root.ownerDocument!.createElement("mark");
  mark.className = COLOR_CLASS[color] || COLOR_CLASS.yellow;
  mark.setAttribute("data-hl-id", highlightId);

  try {
    const range = document.createRange();
    range.setStart(startPiece.node, matchStart - startPiece.start);
    range.setEnd(endPiece.node, matchEnd - endPiece.start);

    try {
      range.surroundContents(mark);
      return true;
    } catch {
      // Range crosses element boundaries — extract + reinsert works more often.
      const contents = range.extractContents();
      mark.appendChild(contents);
      range.insertNode(mark);
      return true;
    }
  } catch {
    try {
      const local = startPiece.node.textContent || "";
      const localIdx = local.search(
        new RegExp(
          target
            .split(" ")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("\\s+")
        )
      );
      if (localIdx < 0) return false;
      const endLocal = localIdx + (local.slice(localIdx).match(
        new RegExp(
          target
            .split(" ")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("\\s+")
        )
      )?.[0].length || 0);
      const range = document.createRange();
      range.setStart(startPiece.node, localIdx);
      range.setEnd(startPiece.node, endLocal);
      range.surroundContents(mark);
      return true;
    } catch {
      return false;
    }
  }
}

/** Inject saved highlights into chapter HTML for in-book display. */
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
    const doc = new DOMParser().parseFromString(`<div id="kora-hl-root">${html}</div>`, "text/html");
    const root = doc.getElementById("kora-hl-root");
    if (!root) return html;

    for (const h of chapterHighlights) {
      wrapFirstOccurrence(root, h.text, h.id, h.color);
    }
    return root.innerHTML;
  } catch {
    return html;
  }
}
