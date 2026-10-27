/* DOM text-selection and caret hit-testing helpers shared by the EPUB reader. */

export function extractLookupWord(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const words = trimmed.split(/\s+/).filter(Boolean);
  const candidate = words[0] || "";
  return candidate
    .replace(/[’‘]/g, "'")
    .replace(/^[^a-zA-Z0-9'-]+|[^a-zA-Z0-9'-]+$/g, "");
}

/** Distance from a point to the nearest edge of a rect (0 if inside). */
function distPointToRect(x: number, y: number, rect: DOMRect): number {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return Math.hypot(dx, dy);
}

export function isCollapsedRangeNearPoint(range: Range, x: number, y: number, maxDist = 36): boolean {
  try {
    const probe = range.cloneRange();
    if (probe.collapsed && probe.startContainer.nodeType === Node.TEXT_NODE) {
      const node = probe.startContainer as Text;
      const off = probe.startOffset;
      probe.setStart(node, Math.max(0, off > 0 ? off - 1 : off));
      probe.setEnd(node, Math.min(node.length, off === 0 ? 1 : off));
    }
    const rects = probe.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      if (distPointToRect(x, y, rects[i]) <= maxDist) return true;
    }
    const br = probe.getBoundingClientRect();
    return br.width + br.height > 0 && distPointToRect(x, y, br) <= maxDist;
  } catch {
    return false;
  }
}

/** True only if the start (or end) boundary of a range sits near a point — not any mid-selection rect. */
export function rangeBoundaryNearPoint(
  range: Range,
  boundary: "start" | "end",
  x: number,
  y: number,
  maxDist = 48
): boolean {
  try {
    const probe = range.cloneRange();
    probe.collapse(boundary === "start");
    return isCollapsedRangeNearPoint(probe, x, y, maxDist);
  } catch {
    return false;
  }
}

export function clampSelectionMenuPosition(
  x: number,
  preferTop: boolean,
  anchorTop: number,
  anchorBottom: number
): { left: number; top: number; transform: string } {
  const padX = 12;
  const safeTop = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kora-safe-top")) || 0;
  const safeBottom =
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kora-safe-bottom")) || 0;
  const menuH = 168;
  const left = Math.min(window.innerWidth - padX, Math.max(padX, x));
  if (preferTop) {
    const top = Math.max(safeTop + 8 + menuH, anchorTop - 12);
    return { left, top, transform: "translate(-50%, -100%)" };
  }
  const top = Math.min(window.innerHeight - safeBottom - 12 - menuH, anchorBottom + 12);
  return { left, top: Math.max(safeTop + 8, top), transform: "translate(-50%, 0)" };
}

/**
 * Hit-test a caret in reader content. Native caretRangeFromPoint is unreliable
 * with CSS multi-column pagination (often snaps to the chapter start) — skip it
 * whenever the root uses columns / horizontal page translation.
 */
export function rootUsesCssColumns(root: HTMLElement): boolean {
  const style = getComputedStyle(root);
  const cw = style.columnWidth || (style as CSSStyleDeclaration & { webkitColumnWidth?: string }).webkitColumnWidth;
  if (cw && cw !== "auto" && parseFloat(cw) > 0) return true;
  const count = style.columnCount || (style as CSSStyleDeclaration & { webkitColumnCount?: string }).webkitColumnCount;
  if (count && count !== "auto" && Number(count) > 1) return true;
  return false;
}

function rectVisibleInClip(rect: DOMRectReadOnly, clip: DOMRectReadOnly, pad = 1): boolean {
  return (
    rect.width >= 0.25 &&
    rect.height >= 0.25 &&
    rect.right >= clip.left + pad &&
    rect.left <= clip.right - pad &&
    rect.bottom >= clip.top + pad &&
    rect.top <= clip.bottom - pad
  );
}

function collectTextNodes(scope: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent && /\S/.test(node.textContent)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let current: Node | null;
  while ((current = walker.nextNode())) out.push(current as Text);
  return out;
}

export function findCaretRangeAtPoint(x: number, y: number, root: HTMLElement | null): Range | null {
  if (!root) return null;

  const skipNative =
    rootUsesCssColumns(root) || /matrix|translate/i.test(getComputedStyle(root).transform);

  if (!skipNative) {
    let native: Range | null = null;
    if (document.caretRangeFromPoint) {
      native = document.caretRangeFromPoint(x, y);
    } else if ((document as any).caretPositionFromPoint) {
      const pos = (document as any).caretPositionFromPoint(x, y);
      if (pos?.offsetNode) {
        native = document.createRange();
        native.setStart(pos.offsetNode, pos.offset);
        native.collapse(true);
      }
    }
    if (
      native &&
      root.contains(native.startContainer) &&
      isCollapsedRangeNearPoint(native, x, y, 28)
    ) {
      return native;
    }
  }

  // Only score glyph boxes that sit inside the visible page clip — off-page
  // CSS-column fragments otherwise steal the hit test toward chapter start.
  const clipEl =
    (root.closest("#epub-reader-container") as HTMLElement | null) ||
    root.parentElement ||
    root;
  const clip = clipEl.getBoundingClientRect();

  // Prefer the element under the finger so we don't scan the whole chapter.
  let seed: Node = root;
  try {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el instanceof Element && (el === root || root.contains(el))) {
        seed = el;
        break;
      }
    }
  } catch {
    /* elementsFromPoint can throw in detached docs */
  }

  let candidates = collectTextNodes(seed);
  if (candidates.length === 0 && seed !== root) {
    let parent: Element | null = seed instanceof Element ? seed.parentElement : null;
    while (parent && root.contains(parent)) {
      candidates = collectTextNodes(parent);
      if (candidates.length > 0) break;
      if (parent === root) break;
      parent = parent.parentElement;
    }
  }
  if (candidates.length === 0) candidates = collectTextNodes(root);

  let best: { node: Text; offset: number; dist: number } | null = null;

  for (const textNode of candidates) {
    const len = textNode.length;
    if (!len) continue;

    const whole = document.createRange();
    whole.selectNodeContents(textNode);
    const lineRects = whole.getClientRects();
    let nodeNear = false;
    for (let i = 0; i < lineRects.length; i++) {
      const line = lineRects[i];
      if (!rectVisibleInClip(line, clip)) continue;
      if (distPointToRect(x, y, line) <= 28) {
        nodeNear = true;
        break;
      }
    }
    if (!nodeNear) continue;

    // Per-glyph scan — binary search + getBoundingClientRect is wrong across
    // CSS column / multi-line fragmentation (union boxes jump to page start).
    for (let i = 0; i < len; i++) {
      const slice = document.createRange();
      slice.setStart(textNode, i);
      slice.setEnd(textNode, Math.min(len, i + 1));
      const rects = slice.getClientRects();
      for (let r = 0; r < rects.length; r++) {
        const rect = rects[r];
        if (!rectVisibleInClip(rect, clip)) continue;
        const dist = distPointToRect(x, y, rect);
        if (dist > 28) continue;
        const bias = Math.abs(y - (rect.top + rect.height / 2)) * 0.2;
        const score = dist + bias;
        if (!best || score < best.dist) {
          const ratio = rect.width > 0 ? (x - rect.left) / rect.width : 0;
          const offset = Math.min(len, Math.max(0, i + (ratio > 0.55 ? 1 : 0)));
          best = { node: textNode, offset, dist: score };
        }
      }
    }
  }

  // If the finger missed tight glyph boxes, retry against the full root once.
  if ((!best || best.dist > 32) && seed !== root) {
    return findCaretRangeAtPointOnNodes(x, y, collectTextNodes(root), clip);
  }

  if (!best || best.dist > 32) return null;
  const range = document.createRange();
  range.setStart(best.node, best.offset);
  range.collapse(true);
  return range;
}

function findCaretRangeAtPointOnNodes(
  x: number,
  y: number,
  candidates: Text[],
  clip: DOMRectReadOnly
): Range | null {
  let best: { node: Text; offset: number; dist: number } | null = null;
  for (const textNode of candidates) {
    const len = textNode.length;
    if (!len) continue;
    const whole = document.createRange();
    whole.selectNodeContents(textNode);
    const lineRects = whole.getClientRects();
    let nodeNear = false;
    for (let i = 0; i < lineRects.length; i++) {
      const line = lineRects[i];
      if (!rectVisibleInClip(line, clip)) continue;
      if (distPointToRect(x, y, line) <= 28) {
        nodeNear = true;
        break;
      }
    }
    if (!nodeNear) continue;
    for (let i = 0; i < len; i++) {
      const slice = document.createRange();
      slice.setStart(textNode, i);
      slice.setEnd(textNode, Math.min(len, i + 1));
      const rects = slice.getClientRects();
      for (let r = 0; r < rects.length; r++) {
        const rect = rects[r];
        if (!rectVisibleInClip(rect, clip)) continue;
        const dist = distPointToRect(x, y, rect);
        if (dist > 28) continue;
        const bias = Math.abs(y - (rect.top + rect.height / 2)) * 0.2;
        const score = dist + bias;
        if (!best || score < best.dist) {
          const ratio = rect.width > 0 ? (x - rect.left) / rect.width : 0;
          const offset = Math.min(len, Math.max(0, i + (ratio > 0.55 ? 1 : 0)));
          best = { node: textNode, offset, dist: score };
        }
      }
    }
  }
  if (!best || best.dist > 32) return null;
  const range = document.createRange();
  range.setStart(best.node, best.offset);
  range.collapse(true);
  return range;
}

export function buildRangeFromCarets(a: Range, b: Range): Range | null {
  try {
    const range = document.createRange();
    const cmp = a.compareBoundaryPoints(Range.START_TO_START, b);
    if (cmp <= 0) {
      range.setStart(a.startContainer, a.startOffset);
      range.setEnd(b.startContainer, b.startOffset);
    } else {
      range.setStart(b.startContainer, b.startOffset);
      range.setEnd(a.startContainer, a.startOffset);
    }
    return range;
  } catch {
    return null;
  }
}

export function clearNativeSelection() {
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
}

export function dismissSelectionState(
  setters: {
    setSelectedText: (v: string) => void;
    setSelectionCoords: (v: null) => void;
    setSelectionPins: (v: { start: null; end: null }) => void;
    setSelectionDictPreview: (v: null) => void;
    setShowHighlightColors: (v: boolean) => void;
  }
) {
  clearNativeSelection();
  setters.setSelectedText("");
  setters.setSelectionCoords(null);
  setters.setSelectionPins({ start: null, end: null });
  setters.setSelectionDictPreview(null);
  setters.setShowHighlightColors(false);
}
