import type { BookHighlight } from "./firebase";

const HL_STYLES: Record<BookHighlight["color"], string> = {
  yellow: "background-color:rgba(250,204,21,.45);border-radius:2px;padding:0 .05em",
  green: "background-color:rgba(52,211,153,.45);border-radius:2px;padding:0 .05em",
  blue: "background-color:rgba(56,189,248,.45);border-radius:2px;padding:0 .05em",
  pink: "background-color:rgba(244,114,182,.45);border-radius:2px;padding:0 .05em",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wrap highlight snippets in chapter HTML for in-page display.
 * Prefer exact contiguous text matches (typical for a single selection).
 */
export function applyHighlightsToHtml(
  html: string,
  highlights: BookHighlight[],
  chapterIdx: number
): string {
  const list = highlights
    .filter((h) => h.chapterIdx === chapterIdx && h.text?.trim())
    .sort((a, b) => b.text.length - a.text.length);
  if (!list.length || !html) return html;

  const doc = new DOMParser().parseFromString(`<div id="kora-hl-root">${html}</div>`, "text/html");
  const root = doc.getElementById("kora-hl-root");
  if (!root) return html;

  for (const highlight of list) {
    if (root.querySelector(`mark.kora-hl[data-hl-id="${highlight.id.replace(/"/g, "")}"]`)) continue;
    wrapFirstMatch(doc, root, highlight);
  }

  return root.innerHTML;
}

function wrapFirstMatch(doc: Document, root: HTMLElement, highlight: BookHighlight) {
  const needle = highlight.text;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    if (textNode.parentElement?.closest("mark.kora-hl, script, style")) continue;
    nodes.push(textNode);
  }

  for (const textNode of nodes) {
    const idx = textNode.data.indexOf(needle);
    if (idx === -1) continue;
    const range = doc.createRange();
    range.setStart(textNode, idx);
    range.setEnd(textNode, idx + needle.length);
    const mark = doc.createElement("mark");
    mark.className = "kora-hl";
    mark.dataset.hlId = highlight.id;
    mark.setAttribute("style", HL_STYLES[highlight.color] || HL_STYLES.yellow);
    try {
      range.surroundContents(mark);
    } catch {
      // Selection spanned element boundaries — fall through to HTML replace.
      break;
    }
    return;
  }

  // Fallback: replace first plain-text occurrence in serialized HTML.
  const pattern = new RegExp(escapeRegExp(needle).replace(/\s+/g, "\\s+"));
  const replaced = root.innerHTML.replace(pattern, (match) => {
    return `<mark class="kora-hl" data-hl-id="${highlight.id}" style="${
      HL_STYLES[highlight.color] || HL_STYLES.yellow
    }">${match}</mark>`;
  });
  if (replaced !== root.innerHTML) root.innerHTML = replaced;
}
