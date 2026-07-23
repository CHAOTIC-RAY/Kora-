import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useAndroidBackLayer } from "../hooks/useAndroidBackLayer";
import JSZip from "jszip";
import { motion, AnimatePresence } from "motion/react";
import { 
  BookMetadata, 
  syncBookToCloud,
  ChapterNote, 
  BookHighlight,
  syncChapterNote, 
  loadChapterNotes, 
  syncBookHighlight, 
  syncDeleteHighlight, 
  loadBookHighlights
} from "../lib/firebase";
import { getBookFile, deleteBookFile } from "../db/indexedDB";
import {
  cancelSpeech,
  getEffectiveSpeechRate,
  getSpeechVoices,
  getTtsEngineHint,
  getTtsSettings,
  openNativeTtsInstall,
  resolveSpeechVoice,
  saveTtsSettings,
  subscribeToVoicesChanged,
  usesNativeTts,
  type TtsVoice,
} from "../lib/ttsSettings";
import { prepareTextForNarration } from "../lib/ttsTextPrep";
import { refreshNativeVoices, speakText } from "../lib/koraTts";
import ReaderPetCompanion from "./ReaderPetCompanion";
import { getPetById, READER_PETS, type PetId } from "../lib/readerPet";
import { runOfflineCompanion } from "../lib/offlineAssistant";
import {
  PRIMARY_READER_THEME_KEYS,
  READER_FONTS,
  READER_THEMES,
  LINE_HEIGHT_PRESETS,
  MARGIN_PRESETS,
  resolveReaderTheme,
} from "../lib/readerThemes";
import { downloadMarkdown, highlightsToMarkdown } from "../lib/annotationsExport";
import {
  estimateTimeLeftMinutes,
  formatTimeLeft,
  recordPagesRead,
  recordReadingMinute,
} from "../lib/readingStats";
import { X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Menu, Settings, BookOpen, Sparkles, CircleAlert as AlertCircle, AlertTriangle, RefreshCw, Database, Zap, Type, LayoutGrid as Layout, Info, Globe, Search, Headphones, Play, Pause, RotateCcw, Volume2, FastForward, Rewind, BookMarked, Copy, Check, FileText, Highlighter, Trash2, MoreHorizontal, Undo2, Download } from "lucide-react";
import { lookupWord, addDictionaryEntry } from "../lib/dictionary";
import { loadEpubTocLabels, resolveChapterTitle, resolveEpubPath } from "../lib/epubToc";
import {
  classifySkippableChapter,
  findFirstReadableChapterIndex,
  nextReadableChapterIndex,
} from "../lib/epubChapterSkip";
import { playFlipSound, playBookOpenSound } from "../lib/sounds";
import {
  applyHighlightsToElement,
  applyHighlightsToHtml,
  wrapSelectionWithHighlight,
} from "../lib/readerHighlights";
import { isWalkthroughBook } from "../lib/walkthroughBook";
import { completeGuide, type GuideId } from "../lib/guides";

function emitWalkthroughBookCta(
  action: "first-book" | "more-guides" | "start-guide",
  guideId?: GuideId
) {
  window.dispatchEvent(
    new CustomEvent("kora-guide:book-cta", {
      detail: { action, guideId },
    })
  );
}

function extractLookupWord(text: string): string {
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

function isCollapsedRangeNearPoint(range: Range, x: number, y: number, maxDist = 36): boolean {
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
function rangeBoundaryNearPoint(
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

function clampSelectionMenuPosition(
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
function rootUsesCssColumns(root: HTMLElement): boolean {
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

function findCaretRangeAtPoint(x: number, y: number, root: HTMLElement | null): Range | null {
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

function buildRangeFromCarets(a: Range, b: Range): Range | null {
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

function clearNativeSelection() {
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
}

function dismissSelectionState(
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

interface BookReaderEPUBProps {
  book: BookMetadata;
  userId: string;
  onClose: () => void;
  onProgressUpdate: (updatedBook: BookMetadata) => void;
  readerPrefs?: {
    fontSize: number;
    lineSpacing: number;
    fontFamily: string;
    theme: string;
    marginSize: string;
    isContinuous: boolean;
    brightness: number;
    doubleColumns?: boolean;
    pageOverlap?: number;
    letterSpacing?: string;
    hyphenation?: boolean;
    pageTurnMode?: string;
    pageTransitionEffect?: string;
    themeManuallySet?: boolean;
    grayscaleImages?: boolean;
    hideImages?: boolean;
    /** When true, mouse wheel does not turn pages in paginated mode */
    disableMouseScroll?: boolean;
    /** Enable vertical swipe-to-turn in paginated mode */
    swipeToTurn?: boolean;
    /** Reader companion pet */
    petEnabled?: boolean;
    petId?: string;
    /** Which swipe direction advances to the next page */
    swipeDirection?: "up" | "down";
  };
  onReaderPrefsChange?: (prefs: any) => void;
}

interface EpubChapter {
  id: string;
  href: string;
  title: string;
  content: string;
  fullPath: string;
  /** Front-matter / blank — skipped on open and sequential page turns */
  skip?: boolean;
}

export default function BookReaderEPUB({ book, userId, onClose, onProgressUpdate, readerPrefs, onReaderPrefsChange }: BookReaderEPUBProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  const [currentChapterIdx, setCurrentChapterIdx] = useState<number>(0);
  
  // Customization states (seeded from persisted settings, fallback to defaults)
  const [fontSize, setFontSize] = useState<number>(readerPrefs?.fontSize ?? 18); // px
  const [fontFamily, setFontFamily] = useState<string>(readerPrefs?.fontFamily ?? "font-lexica");
  const [theme, setTheme] = useState<string>(readerPrefs?.theme ?? "light"); // light, dark, sepia, green
  const [themeManuallySet, setThemeManuallySet] = useState<boolean>(readerPrefs?.themeManuallySet ?? false);
  const [marginSize, setMarginSize] = useState<string>(readerPrefs?.marginSize ?? "max-w-2xl");
  const [lineSpacing, setLineSpacing] = useState<number>(readerPrefs?.lineSpacing ?? 1.6);
  const [isContinuous, setIsContinuous] = useState<boolean>(readerPrefs?.isContinuous ?? false);

  useEffect(() => {
    setIsContinuous(readerPrefs?.isContinuous ?? false);
  }, [readerPrefs?.isContinuous]);
  const [brightness, setBrightness] = useState<number>(readerPrefs?.brightness ?? 100);
  const [grayscaleImages, setGrayscaleImages] = useState<boolean>(readerPrefs?.grayscaleImages ?? false);
  const [hideImages, setHideImages] = useState<boolean>(readerPrefs?.hideImages ?? false);
  
  // Dictionary states
  const [dictionaryWord, setDictionaryWord] = useState<string | null>(null);
  const [dictionaryData, setDictionaryData] = useState<any>(null);
  const [dictLoading, setDictLoading] = useState<boolean>(false);
  
  // Pagination & Layout States
  const [currentPageNum, setCurrentPageNum] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(600);
  const [pageViewportHeight, setPageViewportHeight] = useState<number>(0);
  const [pageStep, setPageStep] = useState<number>(600);
  const pageStepRef = React.useRef<number>(600);
  const contentHeightRef = React.useRef<number>(0);
  const viewportHeightRef = React.useRef<number>(0);
  const [doubleColumns, setDoubleColumns] = useState<boolean>(readerPrefs?.doubleColumns ?? false); // Dual page mode
  const [pageOverlap, setPageOverlap] = useState<number>(readerPrefs?.pageOverlap ?? 0); // KOReader-style page overlap (px repeated across page turns)
  const [letterSpacing, setLetterSpacing] = useState<string>(readerPrefs?.letterSpacing ?? "tracking-normal"); // tracking-normal, tracking-wide, tracking-wider
  const [hyphenation, setHyphenation] = useState<boolean>(readerPrefs?.hyphenation ?? true);
  const [pageTurnMode, setPageTurnMode] = useState<string>(() => {
    const mode = readerPrefs?.pageTurnMode ?? "fifty-fifty";
    // Legacy rename: swipe-only → keys-only
    return mode === "swipe-only" ? "keys-only" : mode;
  });
  const [pageTransitionEffect, setPageTransitionEffect] = useState<string>(() => {
    const saved = readerPrefs?.pageTransitionEffect;
    if (saved) return saved;
    // Android WebView paper-flip / spring often leaves a blank page after the turn.
    try {
      if (/android/i.test(navigator.userAgent)) return "none";
    } catch {
      /* ignore */
    }
    return "paper-flip";
  });
  // Paper-flip + spring on CSS columns blank the page in Android WebView — force instant.
  const isAndroidWebView =
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
  const effectivePageTransition =
    isAndroidWebView &&
    (pageTransitionEffect === "paper-flip" || pageTransitionEffect === "spring")
      ? "none"
      : pageTransitionEffect;
  const [disableMouseScroll, setDisableMouseScroll] = useState<boolean>(readerPrefs?.disableMouseScroll ?? false);
  const [swipeToTurn, setSwipeToTurn] = useState<boolean>(readerPrefs?.swipeToTurn ?? false);
  const [swipeDirection, setSwipeDirection] = useState<"up" | "down">(
    readerPrefs?.swipeDirection === "down" ? "down" : "up"
  );
  const [petEnabled, setPetEnabled] = useState<boolean>(readerPrefs?.petEnabled ?? false);
  const [petId, setPetId] = useState<PetId>(() => getPetById(readerPrefs?.petId).id);
  const [shouldAnimate, setShouldAnimate] = useState<boolean>(true);

  // Responsive mobile state — used for single-column layout and disabling dual-page mode
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768 || window.matchMedia("(max-width: 767px)").matches;
  });
  const [flipDirection, setFlipDirection] = useState<"next" | "prev">("next");
  const prevPageNumRef = useRef<number>(1);
  const prevChapterIdxRef = useRef<number>(0);

  // Turn.js style 3D page flip states
  const [isTurningPage, setIsTurningPage] = useState<boolean>(false);
  const [turningPageNum, setTurningPageNum] = useState<number>(1);
  const [turningChapterIdx, setTurningChapterIdx] = useState<number>(0);
  const [turnDirection, setTurnDirection] = useState<"next" | "prev">("next");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const useDoubleColumns = doubleColumns && !isMobile;
  const isWalkthroughGuide = isWalkthroughBook(book);
  // Respect Continuous Scroll preference for every book (including the guide).
  // Overflow content should paginate to the next page when continuous mode is off.
  const useScrollLayout = isContinuous;
  const columnGapPx = useDoubleColumns ? 40 : 0;
  // Full-width tap zones fight touch text selection on phones — keep turns in the margins.
  const effectivePageTurnMode =
    isMobile && (pageTurnMode === "fifty-fifty" || pageTurnMode === "classic-ereader")
      ? "margins-only"
      : pageTurnMode;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = () => setPrefersReducedMotion(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || window.matchMedia("(max-width: 767px)").matches);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (isMobile && doubleColumns) {
      setDoubleColumns(false);
    }
  }, [isMobile, doubleColumns]);

  useEffect(() => {
    if (currentPageNum !== prevPageNumRef.current || currentChapterIdx !== prevChapterIdxRef.current) {
      const isNext = 
        currentChapterIdx > prevChapterIdxRef.current || 
        (currentChapterIdx === prevChapterIdxRef.current && currentPageNum > prevPageNumRef.current);
      const dir = isNext ? "next" : "prev";
      
      setFlipDirection(dir);

      if (effectivePageTransition === "paper-flip" && shouldAnimate && !isTurningPage && !prefersReducedMotion) {
        setTurningPageNum(prevPageNumRef.current);
        setTurningChapterIdx(prevChapterIdxRef.current);
        setTurnDirection(dir);
        setIsTurningPage(true);
        // Safety: spring onAnimationComplete can miss — never leave overlay stuck (blank page)
        window.setTimeout(() => setIsTurningPage(false), 400);
      }

      prevPageNumRef.current = currentPageNum;
      prevChapterIdxRef.current = currentChapterIdx;
    }
  }, [currentPageNum, currentChapterIdx, effectivePageTransition, shouldAnimate, isTurningPage]);

  // Keep page index in range whenever totalPages shrinks (font/layout changes).
  useEffect(() => {
    if (totalPages > 0 && currentPageNum > totalPages) {
      setCurrentPageNum(totalPages);
    }
  }, [totalPages, currentPageNum]);

  // Disable animation temporarily during visual style changes
  useEffect(() => {
    setShouldAnimate(false);
    const t = setTimeout(() => setShouldAnimate(true), 250);
    return () => clearTimeout(t);
  }, [fontSize, fontFamily, theme, marginSize, lineSpacing, doubleColumns, letterSpacing, hyphenation, pageTurnMode, pageTransitionEffect]);
  
  // Sync settings back to App
  useEffect(() => {
    if (onReaderPrefsChange) {
      onReaderPrefsChange({
        fontSize,
        fontFamily,
        theme,
        marginSize,
        lineSpacing,
        isContinuous,
        brightness,
        doubleColumns,
        pageOverlap,
        letterSpacing,
        hyphenation,
        pageTurnMode,
        pageTransitionEffect,
        themeManuallySet,
        grayscaleImages,
        hideImages,
        disableMouseScroll,
        swipeToTurn,
        swipeDirection,
        petEnabled,
        petId,
      });
    }
  }, [fontSize, fontFamily, theme, marginSize, lineSpacing, isContinuous, brightness, doubleColumns, pageOverlap, letterSpacing, hyphenation, pageTurnMode, pageTransitionEffect, themeManuallySet, grayscaleImages, hideImages, disableMouseScroll, swipeToTurn, swipeDirection, petEnabled, petId, onReaderPrefsChange]);
  
  // Layout states
  const [showToc, setShowToc] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showNotes, setShowNotes] = useState<boolean>(false);
  /** Annotate mode: text selection + dictionary/highlight toolbar (not the notes sidebar). */
  const [annotateMode, setAnnotateMode] = useState<boolean>(false);
  const annotateModeRef = useRef(false);
  annotateModeRef.current = annotateMode;

  const dismissReaderSettings = useAndroidBackLayer(showSettings, "reader-settings", () => setShowSettings(false));
  const dismissReaderToc = useAndroidBackLayer(showToc, "reader-toc", () => setShowToc(false));
  const dismissReaderNotes = useAndroidBackLayer(showNotes, "reader-notes", () => setShowNotes(false));
  
  // Highlights & Notes State
  const [chapterNotesData, setChapterNotesData] = useState<Record<number, ChapterNote>>({});
  const [highlightsData, setHighlightsData] = useState<BookHighlight[]>([]);
  const [activeNoteText, setActiveNoteText] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);

  const chapterHtmlWithHighlights = useMemo(() => {
    const raw = chapters[currentChapterIdx]?.content || "";
    return applyHighlightsToHtml(raw, highlightsData, currentChapterIdx);
  }, [chapters, currentChapterIdx, highlightsData]);

  /** Plain text for pet emotion lexicon (no AI). Prefer current chapter body. */
  const petPageText = useMemo(() => {
    const raw = chapters[currentChapterIdx]?.content || "";
    return raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000);
  }, [chapters, currentChapterIdx]);

  const petPageSignal = currentChapterIdx * 100000 + currentPageNum;

  // AI/dictionary context states
  const [selectedText, setSelectedText] = useState<string>("");
  const [dictFeedback, setDictFeedback] = useState<string | null>(null);
  const [tapFeedback, setTapFeedback] = useState<"next" | "prev" | null>(null);
  const [selectionCoords, setSelectionCoords] = useState<{ x: number; y: number; top: number; bottom: number } | null>(null);
  const [selectionPins, setSelectionPins] = useState<{
    start: { x: number; y: number; height: number } | null;
    end: { x: number; y: number; height: number } | null;
  }>({ start: null, end: null });
  const [isDraggingSelection, setIsDraggingSelection] = useState<boolean>(false);
  const [showHighlightColors, setShowHighlightColors] = useState<boolean>(false);
  const [selectionDictPreview, setSelectionDictPreview] = useState<{
    word: string;
    definition?: string;
    phonetic?: string;
  } | null>(null);
  const [selectionDictLoading, setSelectionDictLoading] = useState<boolean>(false);
  const [showAnalyzer, setShowAnalyzer] = useState<boolean>(false);
  const [analyzedText, setAnalyzedText] = useState<string>("");
  const [vocabBreakdown, setVocabBreakdown] = useState<{ word: string; entry: any }[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [activeWordDefinition, setActiveWordDefinition] = useState<any>(null);

  // Audiobook / Speech states
  const [showAudiobook, setShowAudiobook] = useState<boolean>(false);
  const [isAudiobookExpanded, setIsAudiobookExpanded] = useState<boolean>(false);
  const [isPlayingSpeech, setIsPlayingSpeech] = useState<boolean>(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("");
  const [ttsEngineHint, setTtsEngineHint] = useState<string | null>(null);
  const [currentParagraphIdx, setCurrentParagraphIdx] = useState<number>(-1);
  const speechSessionRef = useRef(0);
  const [locationHistory, setLocationHistory] = useState<{ chapterIdx: number; pageNum: number }[]>([]);
  const [timeLeftLabel, setTimeLeftLabel] = useState<string>("");

  const [externalLinkToOpen, setExternalLinkToOpen] = useState<string | null>(null);

  // Walkthrough highlight step: close Narrator so its scrim doesn't eat long-press.
  useEffect(() => {
    const onPrep = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.closeNarrator) {
        setShowAudiobook(false);
        setIsAudiobookExpanded(false);
      }
      if (detail.enableAnnotate) {
        setAnnotateMode(true);
        setShowNotes(false);
      }
    };
    window.addEventListener("kora-guide:prepare-reader", onPrep);
    return () => window.removeEventListener("kora-guide:prepare-reader", onPrep);
  }, []);

  // Drop any lingering browser selection when annotate mode turns off.
  useEffect(() => {
    if (!annotateMode) {
      try {
        window.getSelection()?.removeAllRanges();
      } catch {
        /* ignore */
      }
    }
  }, [annotateMode]);

  const contentRef = useRef<HTMLElement | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const zipRef = useRef<JSZip | null>(null);
  const rootDirRef = useRef<string>("");
  const blobUrlsRef = useRef<string[]>([]);
  // Maps an EPUB internal href (normalized) -> spine chapter index, so in-book
  // Table-of-Contents links (e.g. <a href="chapter1.xhtml">) navigate correctly.
  const hrefToIndexRef = useRef<Map<string, number>>(new Map());
  const pointerStartRef = React.useRef<{ x: number; y: number; time: number } | null>(null);
  /** Set when a selection is created so the same gesture's pointerup doesn't dismiss it. */
  const justSelectedAtRef = useRef<number>(0);
  const dragStartRef = useRef<{
    isDraggingStart: boolean;
    isDraggingEnd: boolean;
    originalStartContainer: Node | null;
    originalStartOffset: number;
    originalEndContainer: Node | null;
    originalEndOffset: number;
  } | null>(null);
  const isPointerDownRef = useRef<boolean>(false);
  const wheelPageThrottleRef = useRef<number>(0);
  const pageCanvasRef = useRef<HTMLDivElement | null>(null);
  const disableMouseScrollRef = useRef(disableMouseScroll);
  disableMouseScrollRef.current = disableMouseScroll;
  const useScrollLayoutRef = useRef(useScrollLayout);
  useScrollLayoutRef.current = useScrollLayout;
  /** Cancels delayed scroll re-pins when the user scrolls or chapter changes again. */
  const scrollPinGenRef = useRef(0);
  const scrollPinTimersRef = useRef<number[]>([]);
  const scrollPinCleanupRef = useRef<(() => void) | null>(null);

  // Font & theme presets (KOReader-aligned)
  const fontFamilies = READER_FONTS;
  const themes = Object.fromEntries(
    Object.entries(READER_THEMES).map(([k, v]) => [k, { bg: v.bg, text: v.text, card: v.card, border: v.border }])
  );

  const applyPagedScroll = useCallback((page: number, step: number) => {
    const scroller = pageCanvasRef.current;
    const container = contentRef.current;
    if (!scroller || !container) return;
    const pageIndex = Math.max(0, Math.max(1, page) - 1);

    if (useDoubleColumns) {
      // Dual-page still uses CSS columns + horizontal scroll.
      const left = pageIndex * Math.max(1, step);
      container.scrollLeft = left;
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
      return;
    }

    // Single-column paged = vertical window. Overlap means the next page starts
    // `overlap` px earlier so the last lines stay visible — never a side-by-side
    // strip of the previous CSS column.
    const viewportH = Math.max(1, viewportHeightRef.current || scroller.clientHeight);
    const maxScroll = Math.max(0, (contentHeightRef.current || 0) - viewportH);
    const top = Math.min(maxScroll, pageIndex * Math.max(1, step));
    scroller.scrollTop = top;
    scroller.scrollLeft = 0;
    container.scrollLeft = 0;
  }, [useDoubleColumns]);

  const clearColumnStyles = (el: HTMLElement) => {
    el.style.width = "";
    el.style.maxWidth = "";
    el.style.height = "";
    el.style.columnWidth = "";
    el.style.columnGap = "";
    el.style.columnFill = "";
    el.style.overflow = "";
    el.style.overflowX = "";
    el.style.overflowY = "";
    (el.style as CSSStyleDeclaration & { WebkitColumnWidth?: string }).WebkitColumnWidth = "";
  };

  const measurePagedPages = useCallback(
    (container: HTMLElement, viewport: number, viewportH: number) => {
      viewportHeightRef.current = viewportH;
      setContainerWidth(viewport);
      setPageViewportHeight(viewportH);

      if (useDoubleColumns) {
        const colW = Math.max(1, Math.floor((viewport - columnGapPx) / 2));
        const step = viewport;

        pageStepRef.current = step;
        setPageStep(step);

        container.style.width = `${viewport}px`;
        container.style.maxWidth = `${viewport}px`;
        container.style.height = `${viewportH}px`;
        container.style.columnWidth = `${colW}px`;
        container.style.columnGap = `${columnGapPx}px`;
        container.style.columnFill = "auto";
        container.style.overflowX = "auto";
        container.style.overflowY = "hidden";
        (container.style as CSSStyleDeclaration & { WebkitColumnWidth?: string }).WebkitColumnWidth =
          `${colW}px`;

        void container.offsetWidth;
        const scrollWidth = Math.max(container.scrollWidth, viewport);
        const calculatedPages = Math.max(1, Math.ceil((scrollWidth - 1) / step));
        contentHeightRef.current = 0;
        return { step, calculatedPages, colW };
      }

      // Single column: normal vertical flow + sliding window. Overlap shrinks the
      // stride so trailing lines repeat at the top of the next page.
      clearColumnStyles(container);
      container.style.width = `${viewport}px`;
      container.style.maxWidth = `${viewport}px`;
      container.style.height = "auto";
      container.style.overflow = "visible";

      void container.offsetHeight;
      const contentHeight = Math.max(viewportH, container.scrollHeight);
      contentHeightRef.current = contentHeight;

      const overlapPx = Math.max(0, Math.min(pageOverlap, Math.floor(viewportH / 3)));
      const step = Math.max(1, viewportH - overlapPx);
      pageStepRef.current = step;
      setPageStep(step);

      const maxScroll = Math.max(0, contentHeight - viewportH);
      const calculatedPages = maxScroll <= 0 ? 1 : Math.ceil(maxScroll / step) + 1;

      return { step, calculatedPages, colW: viewport };
    },
    [useDoubleColumns, columnGapPx, pageOverlap],
  );

  const recalculateLayout = () => {
    window.setTimeout(() => {
      const scroller = pageCanvasRef.current;
      const container = contentRef.current;
      if (!container || !scroller) return;

      const viewport = Math.max(1, Math.floor(scroller.clientWidth));
      const viewportH = Math.max(1, Math.floor(scroller.clientHeight));
      if (viewport <= 1 || viewportH <= 1) return;

      if (useScrollLayout) {
        setTotalPages(1);
        setContainerWidth(viewport);
        setPageViewportHeight(0);
        pageStepRef.current = viewport;
        setPageStep(viewport);
        contentHeightRef.current = 0;
        viewportHeightRef.current = viewportH;
        clearColumnStyles(container);
        container.scrollLeft = 0;
        scroller.scrollLeft = 0;
        scroller.scrollTop = 0;
        if (currentPageNum !== 1) setCurrentPageNum(1);
        return;
      }

      const { calculatedPages } = measurePagedPages(container, viewport, viewportH);
      setTotalPages(calculatedPages);
      setCurrentPageNum((prev) => Math.min(Math.max(1, prev), calculatedPages));
    }, 32);
  };

  // Recalculate layout on resize or preference change
  useEffect(() => {
    recalculateLayout();
  }, [
    currentChapterIdx,
    chapters,
    fontSize,
    fontFamily,
    lineSpacing,
    marginSize,
    doubleColumns,
    useDoubleColumns,
    useScrollLayout,
    pageOverlap,
    letterSpacing,
    hyphenation
  ]);

  // Keep the paged view scrolled to the active page (vertical window or dual columns).
  useLayoutEffect(() => {
    if (useScrollLayout) return;
    const step = Math.max(1, pageStepRef.current || pageStep);
    const page = Math.min(Math.max(1, currentPageNum), Math.max(1, totalPages));
    applyPagedScroll(page, step);
  }, [currentPageNum, totalPages, pageStep, useScrollLayout, currentChapterIdx, useDoubleColumns, applyPagedScroll]);

  // Handle asynchronous image loading inside the chapter text.
  // Re-run recalculateLayout when any image loads to avoid cut-off paragraphs.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const images = container.querySelectorAll("img");
    const handleImgLoad = () => {
      recalculateLayout();
    };

    images.forEach((img) => {
      if (img.complete) {
        // Image is already loaded from cache or has layout.
      } else {
        img.addEventListener("load", handleImgLoad);
      }
    });

    return () => {
      images.forEach((img) => {
        img.removeEventListener("load", handleImgLoad);
      });
    };
  }, [currentChapterIdx, chapters]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      // Fallback
      window.addEventListener("resize", recalculateLayout);
      return () => window.removeEventListener("resize", recalculateLayout);
    }

    let resizeTimer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        recalculateLayout();
      }, 150);
    });

    observer.observe(viewer);

    return () => {
      observer.disconnect();
      clearTimeout(resizeTimer);
    };
  }, [useDoubleColumns, useScrollLayout]);

  // Auto-track reading focus session time (Reading Goals)
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        recordReadingMinute(book.id);
      } catch (e) {
        console.error("Failed to log reading timer progress:", e);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [book.id]);

  // Restore page within chapter from saved progress
  useEffect(() => {
    const savedPage = book.progress?.pageNumber;
    if (typeof savedPage === "number" && savedPage > 1 && !loading && chapters.length) {
      const t = setTimeout(() => {
        setCurrentPageNum(Math.min(savedPage, totalPages || savedPage));
      }, 400);
      return () => clearTimeout(t);
    }
  }, [loading, chapters.length]);

  // Persist page position + estimate time left
  useEffect(() => {
    if (loading || !chapters.length) return;

    const overall =
      ((currentChapterIdx + (currentPageNum - 1) / Math.max(1, totalPages)) / Math.max(1, chapters.length)) * 100;
    const remainingFraction = Math.max(0, 1 - overall / 100);
    // Rough remaining words from remaining chapters × avg chapter length heuristic
    const viewer = document.getElementById("epub-text-viewer");
    const chapterWords = (viewer?.textContent || "").split(/\s+/).filter(Boolean).length || 400;
    const remainingChapters = Math.max(0, chapters.length - currentChapterIdx - 1);
    const remainingWords =
      chapterWords * (1 - (currentPageNum - 1) / Math.max(1, totalPages)) + remainingChapters * chapterWords;
    setTimeLeftLabel(formatTimeLeft(estimateTimeLeftMinutes(remainingWords)));

    const updated: BookMetadata = {
      ...book,
      status: overall >= 99.5 ? "completed" : "reading",
      progress: {
        ...(book.progress || {}),
        chapterIndex: currentChapterIdx,
        chapterTitle: chapters[currentChapterIdx]?.title || `Chapter ${currentChapterIdx + 1}`,
        pageNumber: currentPageNum,
        percent: Math.min(100, Math.max(0, Math.round(overall))),
        lastReadTime: Date.now(),
      },
    };
    const t = setTimeout(() => {
      onProgressUpdate(updated);
      void syncBookToCloud(userId, updated);
    }, 800);
    return () => clearTimeout(t);
  }, [currentPageNum, currentChapterIdx, totalPages, chapters.length, loading]);

  // Track page turns for pages/day stats
  const prevPageRef = useRef(currentPageNum);
  useEffect(() => {
    if (currentPageNum > prevPageRef.current) {
      recordPagesRead(currentPageNum - prevPageRef.current, book.id);
    }
    prevPageRef.current = currentPageNum;
  }, [currentPageNum, book.id]);

  const pushLocation = (chapterIdx: number, pageNum: number) => {
    setLocationHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.chapterIdx === chapterIdx && last.pageNum === pageNum) return prev;
      return [...prev.slice(-19), { chapterIdx, pageNum }];
    });
  };

  const goBackLocation = () => {
    setLocationHistory((prev) => {
      if (prev.length < 2) return prev;
      const next = [...prev];
      next.pop();
      const target = next[next.length - 1];
      if (target) {
        if (target.chapterIdx !== currentChapterIdx) {
          void updateProgress(target.chapterIdx, false, { skipHistory: true }).then(() => {
            setTimeout(() => setCurrentPageNum(target.pageNum), 200);
          });
        } else {
          setCurrentPageNum(target.pageNum);
        }
      }
      return next;
    });
  };

  const scrubToPercent = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct)) / 100;
    const exact = clamped * Math.max(1, chapters.length);
    const chapterIdx = Math.min(chapters.length - 1, Math.floor(exact));
    const chapterFrac = exact - chapterIdx;
    pushLocation(currentChapterIdx, currentPageNum);
    if (chapterIdx !== currentChapterIdx) {
      void updateProgress(chapterIdx, false).then(() => {
        setTimeout(() => {
          const page = Math.max(1, Math.min(totalPages, Math.round(chapterFrac * Math.max(1, totalPages)) || 1));
          setCurrentPageNum(page);
        }, 250);
      });
    } else if (!useScrollLayout) {
      const page = Math.max(1, Math.min(totalPages, Math.round(chapterFrac * Math.max(1, totalPages)) || 1));
      setCurrentPageNum(page);
    }
  };

  // Persist customized reader preferences on change
  useEffect(() => {
    const prefs = {
      fontSize,
      fontFamily,
      theme,
      marginSize,
      lineSpacing,
      isContinuous,
      brightness,
      doubleColumns,
      pageOverlap,
      letterSpacing,
      hyphenation,
      pageTurnMode,
      pageTransitionEffect,
      themeManuallySet,
      grayscaleImages,
      hideImages,
      disableMouseScroll,
      swipeToTurn,
      swipeDirection,
      petEnabled,
      petId,
    };
    localStorage.setItem("kora_reader_prefs", JSON.stringify(prefs));
  }, [fontSize, fontFamily, theme, marginSize, lineSpacing, isContinuous, brightness, doubleColumns, pageOverlap, letterSpacing, hyphenation, pageTurnMode, pageTransitionEffect, themeManuallySet, grayscaleImages, hideImages, disableMouseScroll, swipeToTurn, swipeDirection, petEnabled, petId]);

  useEffect(() => {
    loadEpubFile();
  }, [book.id]);

  // Handle restoring the last read chapter — skip blank/front-matter when starting fresh
  useEffect(() => {
    if (chapters.length === 0) return;
    const savedIdx = book.progress?.chapterIndex ?? 0;
    const hasProgress =
      (book.progress?.percent || 0) > 1 ||
      (book.progress?.pageNumber || 0) > 1 ||
      savedIdx > 0;

    let target = savedIdx >= 0 && savedIdx < chapters.length ? savedIdx : 0;
    if (!hasProgress || chapters[target]?.skip) {
      target = findFirstReadableChapterIndex(chapters);
    }
    setCurrentChapterIdx(target);
  }, [chapters]);

  // Load Highlights and Chapter Notes Data
  useEffect(() => {
    let isMounted = true;
    async function fetchSyncData() {
      const notes = await loadChapterNotes(userId, book.id);
      const highlights = await loadBookHighlights(userId, book.id);
      if (isMounted) {
        setChapterNotesData(notes);
        setHighlightsData(highlights);
      }
    }
    fetchSyncData();
    return () => { isMounted = false; };
  }, [book.id, userId]);

  // Sync active chapter note text when chapter changes
  useEffect(() => {
    if (chapterNotesData[currentChapterIdx]) {
      setActiveNoteText(chapterNotesData[currentChapterIdx].noteText);
    } else {
      setActiveNoteText("");
    }
  }, [currentChapterIdx, chapterNotesData]);

  // Save the current chapter note
  const handleSaveChapterNote = async () => {
    setIsSavingNote(true);
    try {
      const chapterTitle = chapters[currentChapterIdx]?.title || `Chapter ${currentChapterIdx + 1}`;
      await syncChapterNote(userId, book.id, currentChapterIdx, chapterTitle, activeNoteText);
      setChapterNotesData(prev => ({
        ...prev,
        [currentChapterIdx]: {
          chapterIdx: currentChapterIdx,
          chapterTitle,
          noteText: activeNoteText,
          updatedAt: Date.now()
        }
      }));
    } catch (e) {
      console.error("Failed to save note", e);
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleDeleteHighlight = async (id: string) => {
    await syncDeleteHighlight(userId, book.id, id);
    setHighlightsData(prev => prev.filter(h => h.id !== id));
  };

  const getCaretRangeFromPoint = (x: number, y: number): Range | null => {
    return findCaretRangeAtPoint(x, y, contentRef.current);
  };

  const handlePinDragStart = (e: React.PointerEvent<HTMLDivElement>, pinType: 'start' | 'end') => {
    e.preventDefault();
    e.stopPropagation();
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      dragStartRef.current = {
        isDraggingStart: pinType === 'start',
        isDraggingEnd: pinType === 'end',
        originalStartContainer: range.startContainer,
        originalStartOffset: range.startOffset,
        originalEndContainer: range.endContainer,
        originalEndOffset: range.endOffset,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (err) {
        console.warn("Failed to set pointer capture", err);
      }
      setIsDraggingSelection(true);
    }
  };

  const handlePinDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    
    const { isDraggingStart, isDraggingEnd, originalStartContainer, originalStartOffset, originalEndContainer, originalEndOffset } = dragStartRef.current;
    if (!originalStartContainer || !originalEndContainer) return;
    
    const selection = window.getSelection();
    if (!selection) return;
    
    const caretRange = getCaretRangeFromPoint(e.clientX, e.clientY);
    if (!caretRange) return;
    
    const newRange = document.createRange();
    
    try {
      if (isDraggingStart) {
        const tempRange = document.createRange();
        tempRange.setStart(originalEndContainer, originalEndOffset);
        tempRange.collapse(true);
        
        const comparison = caretRange.compareBoundaryPoints(Range.START_TO_START, tempRange);
        if (comparison <= 0) {
          newRange.setStart(caretRange.startContainer, caretRange.startOffset);
          newRange.setEnd(originalEndContainer, originalEndOffset);
        } else {
          newRange.setStart(originalEndContainer, originalEndOffset);
          newRange.setEnd(caretRange.startContainer, caretRange.startOffset);
        }
      } else if (isDraggingEnd) {
        const tempRange = document.createRange();
        tempRange.setStart(originalStartContainer, originalStartOffset);
        tempRange.collapse(true);
        
        const comparison = caretRange.compareBoundaryPoints(Range.START_TO_START, tempRange);
        if (comparison >= 0) {
          newRange.setStart(originalStartContainer, originalStartOffset);
          newRange.setEnd(caretRange.startContainer, caretRange.startOffset);
        } else {
          newRange.setStart(caretRange.startContainer, caretRange.startOffset);
          newRange.setEnd(originalStartContainer, originalStartOffset);
        }
      }
      
      selection.removeAllRanges();
      selection.addRange(newRange);
    } catch (err) {
      console.warn("Failed to update drag range:", err);
    }
  };

  const handlePinDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
      dragStartRef.current = null;
      setIsDraggingSelection(false);
    }
  };

  const prefetchSelectionDictionary = useCallback(async (text: string) => {
    const word = extractLookupWord(text);
    if (!word || word.length < 2) {
      setSelectionDictPreview(null);
      return;
    }

    setSelectionDictLoading(true);
    try {
      const localDef = await lookupWord(word);
      if (localDef) {
        setSelectionDictPreview({
          word: localDef.word,
          definition: localDef.definition,
          phonetic: localDef.partOfSpeech,
        });
        return;
      }

      // Built-in / personal dictionary only — no online fallback
      setSelectionDictPreview({ word });
    } catch {
      setSelectionDictPreview({ word });
    } finally {
      setSelectionDictLoading(false);
    }
  }, []);

  const dismissSelection = useCallback(() => {
    dismissSelectionState({
      setSelectedText,
      setSelectionCoords,
      setSelectionPins,
      setSelectionDictPreview,
      setShowHighlightColors,
    });
  }, []);

  useAndroidBackLayer(annotateMode, "reader-annotate", () => {
    setAnnotateMode(false);
    dismissSelection();
  });

  const exitAnnotateMode = useCallback(() => {
    setAnnotateMode(false);
    dismissSelection();
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* ignore */
    }
  }, [dismissSelection]);

  const toggleAnnotateMode = useCallback(() => {
    setAnnotateMode((prev) => {
      const next = !prev;
      if (!next) {
        dismissSelection();
        try {
          window.getSelection()?.removeAllRanges();
        } catch {
          /* ignore */
        }
      } else {
        setShowNotes(false);
        setShowToc(false);
        setShowSettings(false);
        setShowAudiobook(false);
      }
      return next;
    });
  }, [dismissSelection]);

  const handleEpubContentClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const cta = target.closest("[data-kora-guide-cta]") as HTMLElement | null;
    if (cta) {
      e.preventDefault();
      e.stopPropagation();
      const action = cta.getAttribute("data-kora-guide-cta");
      const guideId = cta.getAttribute("data-guide-id") as GuideId | null;
      if (action === "first-book" || action === "more-guides") {
        completeGuide("walkthrough-book");
        emitWalkthroughBookCta(action);
      } else if (action === "start-guide" && guideId) {
        completeGuide("walkthrough-book");
        emitWalkthroughBookCta("start-guide", guideId);
      }
      return;
    }
    const anchor = target.closest("a");
    if (anchor) {
      e.preventDefault();
      const href = anchor.getAttribute("href") || "";
      if (href.startsWith("http")) {
        setExternalLinkToOpen(href);
      }
    }
  }, []);

  const showWalkthroughEndCtas =
    isWalkthroughBook(book) &&
    chapters.length > 0 &&
    currentChapterIdx >= chapters.length - 1 &&
    (useScrollLayout || currentPageNum >= totalPages);

  const syncSelectionFromRange = useCallback((range: Range, textOverride?: string) => {
    const container = contentRef.current;
    if (!container) return;
    if (!container.contains(range.startContainer) && !container.contains(range.endContainer)) return;

    const text = (textOverride ?? range.toString()).trim();
    if (!text) return;

    justSelectedAtRef.current = Date.now();
    setSelectedText(text);
    try {
      window.dispatchEvent(new CustomEvent("kora-guide:text-selected", { detail: { len: text.length } }));
    } catch {
      /* ignore */
    }

    const rect = range.getBoundingClientRect();
    const rects = range.getClientRects();
    if (rects.length > 0) {
      const firstRect = rects[0];
      const lastRect = rects[rects.length - 1];
      setSelectionPins({
        start: { x: firstRect.left, y: firstRect.top, height: firstRect.height },
        end: { x: lastRect.right, y: lastRect.top, height: lastRect.height },
      });
    } else {
      setSelectionPins({ start: null, end: null });
    }

    setSelectionCoords({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 10,
      top: rect.top,
      bottom: rect.bottom,
    });
    void prefetchSelectionDictionary(text);
  }, [prefetchSelectionDictionary]);

  // Text selection toolbar — only while annotate mode is on
  useEffect(() => {
    const readerRoot = document.getElementById("epub-reader-container");
    if (!readerRoot) return;

    let rafId: number | null = null;

    const handleSelection = () => {
      if (!annotateModeRef.current) {
        return;
      }
      if (rafId) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!annotateModeRef.current) return;
        const selection = window.getSelection();
        if (selection && selection.toString().trim().length > 0) {
          // If the pointer is down (meaning active dragging/selecting is happening)
          // and we are NOT dragging a selection pin, defer the heavy calculations until pointerup
          const isDraggingPin = dragStartRef.current !== null;
          if (isPointerDownRef.current && !isDraggingPin) {
            return;
          }

          try {
            if (selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              const container = contentRef.current;
              // Only trigger selection mode if selecting text inside the book reader content area
                if (container && (container.contains(range.startContainer) || container.contains(range.endContainer))) {
                syncSelectionFromRange(range);
              }
            }
          } catch (e) {
            console.warn("Failed to get selection coords:", e);
          }
        } else {
          setSelectionCoords(null);
          setSelectionPins({ start: null, end: null });
          setSelectedText("");
          setSelectionDictPreview(null);
          setShowHighlightColors(false);
        }
      });
    };

    document.addEventListener("selectionchange", handleSelection);
    
    // Dictionary lookup on double tap — annotate mode only
    const handleDoubleClick = async () => {
      if (!annotateModeRef.current) return;
      const selection = window.getSelection();
      const word = selection?.toString().trim();
      if (word && word.length > 0 && word.split(/\s+/).length === 1) {
        setSelectedText(word);
        lookupDictionary(word);
      }
    };
    document.addEventListener("dblclick", handleDoubleClick);

    // Support triple-click (3X) to select a whole sentence/paragraph
    const handleTripleClick = (e: MouseEvent) => {
      if (!annotateModeRef.current) return;
      if (e.detail === 3) {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (text && text.length > 0) {
          setSelectedText(text);
          void prefetchSelectionDictionary(text);
        }
      }
    };
    document.addEventListener("click", handleTripleClick);

    // Long-press word select + correct CSS-column selection that snaps to chapter top
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressStartX = 0;
    let pressStartY = 0;
    let lastX = 0;
    let lastY = 0;
    let movedDuringPress = false;
    let pressInsideContent = false;
    let gestureSelectActive = false;
    let gestureStartCaret: Range | null = null;

    const selectWordAtPoint = (x: number, y: number) => {
      const container = contentRef.current;
      const caret = findCaretRangeAtPoint(x, y, container);
      if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) return false;

      const textNode = caret.startContainer as Text;
      const offset = caret.startOffset;
      const text = textNode.textContent || "";

      let start = offset;
      while (start > 0 && /[\w'’\-]/.test(text[start - 1])) start--;
      let end = offset;
      while (end < text.length && /[\w'’\-]/.test(text[end])) end++;
      if (end <= start) return false;

      const word = text
        .slice(start, end)
        .replace(/[’‘]/g, "'")
        .replace(/^[^a-zA-Z0-9\-']+|[^a-zA-Z0-9\-']+$/g, "");
      if (!word) return false;

      const newRange = document.createRange();
      newRange.setStart(textNode, start);
      newRange.setEnd(textNode, end);
      if (!isCollapsedRangeNearPoint(newRange, x, y, 48)) return false;

      const sel = window.getSelection();
      if (!sel) return false;
      sel.removeAllRanges();
      sel.addRange(newRange);
      syncSelectionFromRange(newRange, word);
      return true;
    };

    /** CSS columns often anchor native selection at chapter start — rebuild from touch points. */
    const applyGestureSelection = (force = false): boolean => {
      if (!pressInsideContent) return false;
      const container = contentRef.current;
      if (!container) return false;

      const pagedColumns = rootUsesCssColumns(container);
      const startCaret =
        gestureStartCaret || findCaretRangeAtPoint(pressStartX, pressStartY, container);
      const endCaret = findCaretRangeAtPoint(lastX, lastY, container);
      if (!startCaret || !endCaret) return false;
      if (!gestureStartCaret) {
        try {
          gestureStartCaret = startCaret.cloneRange();
        } catch {
          gestureStartCaret = startCaret;
        }
      }

      const sel = window.getSelection();
      if (!sel) return false;

      // In column/paginated mode always rebuild — never trust native ranges.
      if (!force && !pagedColumns && sel.rangeCount > 0) {
        const current = sel.getRangeAt(0);
        if (container.contains(current.startContainer) || container.contains(current.endContainer)) {
          // Only trust native selection when BOTH boundaries match the gesture.
          // Checking "any rect near press start" was wrong — a snapped-from-top
          // selection always overlaps the finger and never got corrected.
          const startOk = rangeBoundaryNearPoint(current, "start", pressStartX, pressStartY, 52);
          const endOk = rangeBoundaryNearPoint(current, "end", lastX, lastY, 52);
          if (startOk && endOk) return false;
        }
      }

      const fixed = buildRangeFromCarets(startCaret, endCaret);
      if (!fixed || fixed.collapsed) return false;
      const text = fixed.toString();
      if (!text.trim()) return false;

      try {
        sel.removeAllRanges();
        sel.addRange(fixed);
        gestureSelectActive = true;
        syncSelectionFromRange(fixed);
        return true;
      } catch {
        return false;
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!annotateModeRef.current) {
        isPointerDownRef.current = false;
        pressInsideContent = false;
        gestureSelectActive = false;
        gestureStartCaret = null;
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        return;
      }

      const targetEl = e.target as HTMLElement | null;
      // Taps on the floating selection menu / pins must NOT tear down the menu
      if (targetEl?.closest?.("[data-kora-selection-ui], [data-kora-guide-tip]")) {
        isPointerDownRef.current = false;
        pressInsideContent = false;
        return;
      }

      isPointerDownRef.current = true;
      const container = contentRef.current;
      const pagedColumns = !!(container && rootUsesCssColumns(container));

      let overContent = !!(container && container.contains(e.target as Node));
      if (!overContent && container) {
        try {
          for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
            if (!(el instanceof Element)) continue;
            if (el.closest?.("[data-kora-selection-ui], [data-kora-guide-tip]")) {
              overContent = false;
              break;
            }
            // Scrims / dimmers: keep looking for page text below them
            if (el.closest?.("[data-kora-pass-through]")) continue;
            if (el === container || container.contains(el)) {
              overContent = true;
              break;
            }
          }
        } catch {
          /* ignore */
        }
        if (!overContent) {
          overContent = !!findCaretRangeAtPoint(e.clientX, e.clientY, container);
        }
      }
      pressInsideContent = overContent;

      if (!pressInsideContent) {
        setSelectionCoords(null);
        setSelectionPins({ start: null, end: null });
        return;
      }

      movedDuringPress = false;
      gestureSelectActive = false;
      gestureStartCaret = null;
      pressStartX = lastX = e.clientX;
      pressStartY = lastY = e.clientY;

      if (pagedColumns) {
        // Clear old selection only if nothing is currently selected to start fresh
        const currentSel = window.getSelection();
        if (!currentSel || currentSel.isCollapsed) {
          clearNativeSelection();
        }

        const start = findCaretRangeAtPoint(pressStartX, pressStartY, container);
        if (start) {
          try {
            gestureStartCaret = start.cloneRange();
          } catch {
            gestureStartCaret = start;
          }
        }

        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          pressTimer = null;
          // Don't hijack an in-progress drag selection
          if (movedDuringPress || !isPointerDownRef.current) return;
          selectWordAtPoint(pressStartX, pressStartY);
        }, 320);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const container = contentRef.current;
      const pagedColumns = !!(container && rootUsesCssColumns(container));

      if (!pagedColumns) {
        // Let browser native selection handle selection dragging natively in scroll layouts
        return;
      }

      lastX = e.clientX;
      lastY = e.clientY;
      if (!pressInsideContent || !isPointerDownRef.current) return;

      const dx = Math.abs(e.clientX - pressStartX);
      const dy = Math.abs(e.clientY - pressStartY);
      // Allow finger jitter before canceling long-press / treating as drag.
      if (dx > 8 || dy > 8) {
        movedDuringPress = true;
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        // Take over selection while dragging — native CSS-column selection snaps to chapter top.
        if (applyGestureSelection(true)) {
          try {
            e.preventDefault();
          } catch {
            /* ignore */
          }
        }
      }
    };

    const handlePointerUp = () => {
      isPointerDownRef.current = false;
      setIsDraggingSelection(false);

      const container = contentRef.current;
      const pagedColumns = !!(container && rootUsesCssColumns(container));

      if (pagedColumns) {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        if (movedDuringPress) {
          applyGestureSelection(true);
        }
      }

      handleSelection();
      pressInsideContent = false;
      gestureSelectActive = false;
      gestureStartCaret = null;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!gestureSelectActive || !pressInsideContent) return;
      if (e.cancelable) e.preventDefault();
    };

    // Capture phase on the reader only — avoids fighting the rest of the app.
    readerRoot.addEventListener("pointerdown", handlePointerDown, true);
    readerRoot.addEventListener("pointermove", handlePointerMove, true);
    readerRoot.addEventListener("pointerup", handlePointerUp, true);
    readerRoot.addEventListener("pointercancel", handlePointerUp, true);
    readerRoot.addEventListener("touchmove", handleTouchMove, { passive: false });

    return () => {
      document.removeEventListener("selectionchange", handleSelection);
      document.removeEventListener("dblclick", handleDoubleClick);
      document.removeEventListener("click", handleTripleClick);
      readerRoot.removeEventListener("pointerdown", handlePointerDown, true);
      readerRoot.removeEventListener("pointermove", handlePointerMove, true);
      readerRoot.removeEventListener("pointerup", handlePointerUp, true);
      readerRoot.removeEventListener("pointercancel", handlePointerUp, true);
      readerRoot.removeEventListener("touchmove", handleTouchMove);
      if (pressTimer) clearTimeout(pressTimer);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [prefetchSelectionDictionary, syncSelectionFromRange]);

  // Prevent viewport rubber-banding only while dragging selection handles.
  // Scope preventDefault — blanket touchmove blocks break iOS Safari scrolling.
  useEffect(() => {
    if (isDraggingSelection) {
      const preventDefaultTouch = (e: TouchEvent) => {
        if (e.touches.length > 1) {
          e.preventDefault();
          return;
        }
        const target = e.target as HTMLElement | null;
        if (target?.closest?.("[data-kora-selection-ui], .kora-sel-handle")) {
          e.preventDefault();
        }
      };

      const prevOverflow = document.body.style.overflow;
      const prevOverscroll = document.body.style.overscrollBehavior;
      document.body.style.overflow = "hidden";
      document.body.style.overscrollBehavior = "none";
      document.addEventListener("touchmove", preventDefaultTouch, { passive: false });

      return () => {
        document.body.style.overflow = prevOverflow;
        document.body.style.overscrollBehavior = prevOverscroll;
        document.removeEventListener("touchmove", preventDefaultTouch);
      };
    }
  }, [isDraggingSelection]);

  const handleNextPage = () => {
    playFlipSound();
    setTapFeedback("next");
    setTimeout(() => setTapFeedback(null), 350);
    dismissSelection();
    if (useScrollLayout) {
      if (currentChapterIdx < chapters.length - 1) {
        const next = nextReadableChapterIndex(chapters, currentChapterIdx, 1);
        if (next !== currentChapterIdx) updateProgress(next, false);
      }
      return;
    }
    if (currentPageNum < totalPages) {
      setCurrentPageNum((prev) => Math.min(prev + 1, totalPages));
    } else if (currentChapterIdx < chapters.length - 1) {
      const next = nextReadableChapterIndex(chapters, currentChapterIdx, 1);
      if (next !== currentChapterIdx) updateProgress(next, false);
    }
  };

  const handlePrevPage = () => {
    playFlipSound();
    setTapFeedback("prev");
    setTimeout(() => setTapFeedback(null), 350);
    dismissSelection();
    if (useScrollLayout) {
      if (currentChapterIdx > 0) {
        const prev = nextReadableChapterIndex(chapters, currentChapterIdx, -1);
        if (prev !== currentChapterIdx) updateProgress(prev, true);
      }
      return;
    }
    if (currentPageNum > 1) {
      setCurrentPageNum((prev) => Math.max(prev - 1, 1));
    } else if (currentChapterIdx > 0) {
      const prev = nextReadableChapterIndex(chapters, currentChapterIdx, -1);
      if (prev !== currentChapterIdx) updateProgress(prev, true);
    }
  };

  const handleContainerClick = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Annotate mode: never turn pages on tap — selection / toolbar only.
    if (annotateModeRef.current) {
      const sel = window.getSelection();
      if ((sel && sel.toString().trim().length > 0) || selectedText.trim().length > 0) {
        if (Date.now() - justSelectedAtRef.current < 600) return;
        if (!target.closest?.("[data-kora-selection-ui]")) {
          // Keep selection unless tapping empty chrome outside the text
          if (!target.closest?.(".reader-select-surface, #epub-text-viewer")) {
            dismissSelection();
          }
        }
      }
      return;
    }

    // Handle internal TOC links (data-epub-href)
    const epubLink = target.closest("[data-epub-href]") as HTMLElement | null;
    if (epubLink) {
      const idx = parseInt(epubLink.getAttribute("data-epub-href") || "", 10);
      if (!isNaN(idx) && idx >= 0 && idx < chapters.length) {
        updateProgress(idx);
        return;
      }
    }
    
    // Audiobook audio logic (if enabled)
    if (showAudiobook) {
      const readableEl = target.closest("p, h1, h2, h3, h4, li");
      if (readableEl) {
        const elements = getDOMElementsToRead();
        const idx = elements.indexOf(readableEl);
        if (idx !== -1) {
          speakParagraph(idx);
          return; // Don't turn page when speaking
        }
      }
    }

    if (
      target.closest("button") || 
      target.closest("aside") || 
      target.closest("input") || 
      target.closest("select") || 
      target.closest("textarea") || 
      target.closest(".tts-highlight")
    ) {
      return;
    }

    // Prevent any remaining internal <a> tags (that weren't rewritten to
    // data-epub-href) from navigating away and restarting the app.
    const anchor = target.closest("a");
    if (anchor) {
      const href = anchor.getAttribute("href") || "";
      e.preventDefault();
      if (href.startsWith("http")) {
        setExternalLinkToOpen(href);
      }
      return;
    }
    
    // If we are in select mode or have an active selection, dismiss/clear it and stop (do NOT turn the page!)
    const sel = window.getSelection();
    if ((sel && sel.toString().trim().length > 0) || selectedText.trim().length > 0) {
      dismissSelection();
      return; // Prevent page turn on this tap!
    }
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = clickX / rect.width;
    
    if (effectivePageTurnMode === "fifty-fifty") {
      if (ratio < 0.5) {
        handlePrevPage();
      } else {
        handleNextPage();
      }
    } else if (effectivePageTurnMode === "classic-ereader") {
      if (ratio < 0.25) {
        handlePrevPage();
      } else {
        handleNextPage();
      }
    } else if (effectivePageTurnMode === "margins-only") {
      // Wider dead-zone in the middle for comfortable touch selection on mobile.
      const edge = isMobile ? 0.22 : 0.15;
      if (ratio < edge) {
        handlePrevPage();
      } else if (ratio > 1 - edge) {
        handleNextPage();
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now()
    };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerStartRef.current) return;
    const start = pointerStartRef.current;
    pointerStartRef.current = null;

    const diffX = e.clientX - start.x;
    const diffY = e.clientY - start.y;
    const duration = Date.now() - start.time;
    const sel = window.getSelection();
    const hasSelection =
      (sel && sel.toString().trim().length > 0) || selectedText.trim().length > 0;

    // Annotate mode: do not turn pages or close on swipe — let selection finish.
    if (annotateModeRef.current) {
      if (hasSelection && Date.now() - justSelectedAtRef.current >= 600) {
        if (Math.abs(diffX) < 12 && Math.abs(diffY) < 12) {
          const target = e.target as HTMLElement;
          if (
            !target.closest?.("[data-kora-selection-ui]") &&
            !target.closest?.(".reader-select-surface, #epub-text-viewer")
          ) {
            dismissSelection();
          }
        }
      }
      return;
    }

    if (hasSelection) {
      // Don't dismiss on the same gesture that created the selection (long-press / drag).
      if (Date.now() - justSelectedAtRef.current < 500) return;
      if (Math.abs(diffX) < 15 && Math.abs(diffY) < 15) {
        const target = e.target as HTMLElement;
        if (!target.closest?.("[data-kora-selection-ui]")) {
          dismissSelection();
        }
      }
      return;
    }

    // Vertical swipe-to-turn (opt-in). Horizontal edge swipe still closes the reader.
    const edgeSwipe = start.x < 28 || start.x > (typeof window !== "undefined" ? window.innerWidth - 28 : 9999);
    const iosBrowser =
      typeof navigator !== "undefined" &&
      (/iPad|iPhone|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
      !(
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true
      );

    // Close reader: left-edge swipe right (installed PWA / Android only)
    if (
      !iosBrowser &&
      edgeSwipe &&
      start.x < 50 &&
      duration < 500 &&
      diffX > 45 &&
      Math.abs(diffY) < 60
    ) {
      onClose();
      return;
    }

    if (
      !useScrollLayout &&
      swipeToTurn &&
      duration < 550 &&
      Math.abs(diffY) > 48 &&
      Math.abs(diffY) > Math.abs(diffX) * 1.2
    ) {
      const swipedUp = diffY < 0;
      const nextOnUp = swipeDirection === "up";
      if (swipedUp === nextOnUp) handleNextPage();
      else handlePrevPage();
      return;
    }

    // Only fire standard tap handler if pointer barely moved (prevent text selection drag conflicts)
    if (Math.abs(diffX) < 15 && Math.abs(diffY) < 15) {
      handleContainerClick(e);
    }
  };

  // Keyboard navigation: arrows and space flip pages, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case " ":
          e.preventDefault();
          handleNextPage();
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          handlePrevPage();
          break;
        case "Escape":
          e.preventDefault();
          stopSpeech();
          onClose();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentChapterIdx, chapters.length, currentPageNum, totalPages]);

  // Non-passive wheel listener — React's onWheel is passive and cannot preventDefault.
  useEffect(() => {
    const el = pageCanvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (useScrollLayoutRef.current) return;
      if (e.cancelable) e.preventDefault();
      if (disableMouseScrollRef.current) return;
      if (Math.abs(e.deltaY) < 8 && Math.abs(e.deltaX) < 8) return;
      const now = Date.now();
      if (now - wheelPageThrottleRef.current < 280) return;
      wheelPageThrottleRef.current = now;
      if (e.deltaY > 0 || e.deltaX > 0) handleNextPage();
      else handlePrevPage();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [currentChapterIdx, chapters.length, currentPageNum, totalPages, useScrollLayout, loading]);

  async function lookupDictionary(word: string) {
    const clean = extractLookupWord(word);
    if (!clean) {
      setDictionaryWord(null);
      setDictionaryData(null);
      return;
    }
    try {
      setDictLoading(true);
      setDictionaryWord(clean);
      setDictionaryData(null);
      
      // 1. Check custom / bundled dictionary first
      const localDef = await lookupWord(clean);
      if (localDef) {
        setDictionaryData({
          word: localDef.word,
          phonetic: localDef.isCustom ? "Personal Definition" : "Kora Dictionary",
          meanings: [
            {
              partOfSpeech: localDef.partOfSpeech || "noun",
              definitions: [
                {
                  definition: localDef.definition,
                  example: localDef.example
                }
              ]
            }
          ]
        });
        return;
      }

      // Built-in / personal dictionary only — no online Oxford / free-dict fallback
      setDictionaryData(null);
    } catch (err) {
      console.error("Dictionary error:", err);
      setDictionaryData(null);
    } finally {
      setDictLoading(false);
    }
  }

  async function loadEpubFile() {
    try {
      setLoading(true);
      setError(null);

      // 1. Load book file from IndexedDB
      const fileData = await getBookFile(book.id);
      if (!fileData) {
        throw new Error("Book file not cached locally on this device. Please sync or re-download.");
      }

      // 2. Load Zip
      const zip = await JSZip.loadAsync(fileData.blob);
      zipRef.current = zip;

      // 3. Read container.xml to locate the .opf file
      const containerXml = await zip.file("META-INF/container.xml")?.async("string");
      if (!containerXml) {
        throw new Error("Invalid EPUB: Missing container.xml");
      }

      const parser = new DOMParser();
      const containerDoc = parser.parseFromString(containerXml, "text/xml");
      const rootfile = containerDoc.querySelector("rootfile");
      const rootfilePath = rootfile?.getAttribute("full-path");

      if (!rootfilePath) {
        throw new Error("Invalid EPUB: Cannot find root OPF file path.");
      }

      // Derive root folder directory for relative path mapping
      const rootDir = rootfilePath.includes("/") 
        ? rootfilePath.substring(0, rootfilePath.lastIndexOf("/") + 1)
        : "";
      rootDirRef.current = rootDir;

      // 4. Read the OPF file (manifest and spine)
      const opfText = await zip.file(rootfilePath)?.async("string");
      if (!opfText) {
        throw new Error("Invalid EPUB: OPF file not readable.");
      }

      const opfDoc = parser.parseFromString(opfText, "text/xml");

      // Extract and self-heal metadata (title, author, tags)
      try {
        const opfTitle = opfDoc.getElementsByTagName("dc:title")[0]?.textContent || opfDoc.getElementsByTagName("title")[0]?.textContent;
        const opfCreator = opfDoc.getElementsByTagName("dc:creator")[0]?.textContent || opfDoc.getElementsByTagName("creator")[0]?.textContent;
        const subjectNodes = opfDoc.getElementsByTagName("dc:subject");
        const opfSubjects: string[] = [];
        for (let sIdx = 0; sIdx < subjectNodes.length; sIdx++) {
          const sText = subjectNodes[sIdx]?.textContent?.trim();
          if (sText) {
            opfSubjects.push(sText);
          }
        }

        let needsMetadataUpdate = false;
        const updatedBook = { ...book };

        if (opfTitle && opfTitle.trim() !== "" && (book.title === "Untitled" || book.title.toLowerCase().startsWith("local_") || book.title.length < opfTitle.length - 5)) {
          updatedBook.title = opfTitle.trim();
          needsMetadataUpdate = true;
        }

        if (opfCreator && opfCreator.trim() !== "" && (book.author === "Local Upload" || book.author === "Unknown Author")) {
          updatedBook.author = opfCreator.trim();
          needsMetadataUpdate = true;
        }

        if (opfSubjects.length > 0) {
          const cleanTags = Array.from(new Set([
            ...book.tags,
            ...opfSubjects.map(s => s.trim()).filter(s => s.length > 2 && s.length < 25)
          ])).slice(0, 6);

          if (cleanTags.length > book.tags.length) {
            updatedBook.tags = cleanTags;
            needsMetadataUpdate = true;
          }
        }

        if (needsMetadataUpdate) {
          console.log("Self-healing book metadata inside reader:", updatedBook);
          await syncBookToCloud(userId, updatedBook);
          // Let current session state know
          onProgressUpdate(updatedBook);
        }
      } catch (metaErr) {
        console.warn("Failed to extract self-healing metadata from OPF:", metaErr);
      }
      
      // Parse manifest items (id -> href mapping)
      const manifestItems: Record<string, string> = {};
      opfDoc.querySelectorAll("manifest > item").forEach((item) => {
        const id = item.getAttribute("id");
        const href = item.getAttribute("href");
        if (id && href) {
          manifestItems[id] = href;
        }
      });

      // Parse spine items (reading order)
      const spineItems: string[] = [];
      opfDoc.querySelectorAll("spine > itemref").forEach((itemref) => {
        const idref = itemref.getAttribute("idref");
        if (idref && manifestItems[idref]) {
          spineItems.push(manifestItems[idref]);
        }
      });

      // Parse Table of Contents labels (EPUB 3 nav + NCX) for real chapter names
      const tocLabels = await loadEpubTocLabels(zip, opfDoc, rootDir);
      const parsedChapters: EpubChapter[] = [];

      // Pre-register all spine hrefs so that in-book TOC links in any chapter
      // (especially the first chapter, which is often the TOC) can be resolved
      // to the correct spine index during content processing.
      for (let i = 0; i < spineItems.length; i++) {
        const relativeHref = spineItems[i];
        const norm = resolveEpubPath(rootDir, relativeHref).toLowerCase();
        hrefToIndexRef.current.set(norm, i);
        hrefToIndexRef.current.set(relativeHref.toLowerCase(), i);
      }

      for (let i = 0; i < spineItems.length; i++) {
        const relativeHref = spineItems[i];
        const fullChapterPath = resolveEpubPath(rootDir, relativeHref);
        const chapterFile = zip.file(fullChapterPath) || zip.file(`${rootDir}${relativeHref}`);

        if (chapterFile) {
          const rawContent = await chapterFile.async("string");
          const chapterTitle = resolveChapterTitle(
            tocLabels,
            rootDir,
            relativeHref,
            rawContent,
            `Chapter ${i + 1}`
          );

          const chapterDoc = parser.parseFromString(rawContent, "text/html");
          const processedContent = await resolveInternalAssets(chapterDoc, zip, rootDir, relativeHref);
          const skipInfo = classifySkippableChapter({
            title: chapterTitle || `Chapter ${i + 1}`,
            href: relativeHref,
            html: processedContent,
            spineIndex: i,
            spineLength: spineItems.length,
          });

          parsedChapters.push({
            id: `ch-${i}`,
            href: relativeHref,
            title: chapterTitle || `Chapter ${i + 1}`,
            content: processedContent,
            fullPath: fullChapterPath,
            skip: skipInfo.skip,
          });
        }
      }

      if (parsedChapters.length === 0) {
        throw new Error("No readable chapters found inside this EPUB file.");
      }

      setChapters(parsedChapters);
      setLoading(false);
      playBookOpenSound();
    } catch (err: any) {
      console.error("EPUB Loader Error:", err);
      setError(err.message || "Failed to parse EPUB reader file.");
      setLoading(false);
    }
  }

  // Rewrite all relative images inside the EPUB chapter HTML into local blob URLs.
  // Falls back to a basename search across the whole zip (EPUB3 often nests images
  // in /images or /OEBPS/images), and drops any image that still can't be found so a
  // broken <img> never 404s against the site origin.
  async function resolveInternalAssets(chapterDoc: Document, zip: JSZip, rootDir: string, chapterHref: string): Promise<string> {

    // Pre-cache basename -> zip path for every image-like entry (cheap, ~1 pass).
    const imageMap = new Map<string, string>();
    for (const path of Object.keys(zip.files)) {
      if (zip.files[path].dir) continue;
      if (/\.(jpe?g|png|gif|webp|svg|bmp|avif)$/i.test(path)) {
        const base = path.split("/").pop()!.toLowerCase();
        if (!imageMap.has(base)) imageMap.set(base, path);
      }
    }

    const resolvePath = (relativeSrc: string): string | null => {
      // 1. Path relative to the OPF directory.
      const normalized = pathResolve(rootDir, relativeSrc);
      if (zip.file(normalized)) return normalized;
      // 2. Path relative to the current chapter file's directory.
      const alt = pathResolve(rootDir + relativeSrc.split("/").slice(0, -1).join("/") + "/", relativeSrc);
      if (zip.file(alt)) return alt;
      // 3. Basename anywhere in the zip.
      const base = relativeSrc.split("/").pop()!.toLowerCase();
      return imageMap.get(base) || null;
    };

    // Remove videos, iframes, and audios as requested
    chapterDoc.querySelectorAll("video, iframe, audio").forEach(el => el.remove());

    const images = chapterDoc.querySelectorAll("img, image");
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      let relativeSrc = img.getAttribute("src") || img.getAttribute("xlink:href") || "";
      if (!relativeSrc || relativeSrc.startsWith("data:") || relativeSrc.startsWith("http")) continue;

      const zipPath = resolvePath(relativeSrc);
      if (zipPath) {
        try {
          const imgFile = zip.file(zipPath)!;
          const imgBlob = await imgFile.async("blob");
          const localUrl = URL.createObjectURL(imgBlob);
          blobUrlsRef.current.push(localUrl);
          img.setAttribute("src", localUrl);
          img.removeAttribute("xlink:href");
          img.setAttribute("class", "max-w-full h-auto my-4 mx-auto block rounded shadow-sm select-none pointer-events-none");
        } catch (e) {
          console.warn("Failed unzipping chapter image:", zipPath, e);
          img.remove();
        }
      } else {
        // Not in the zip — drop it rather than letting the browser 404 on the site origin.
        img.remove();
      }
    }

    // Rewrite in-book internal links (e.g. EPUB Table-of-Contents entries) so they
    // navigate to the correct chapter instead of reloading the site. External/anchor
    // links are left alone; internal doc links become data-epub-href and are handled
    // by the click interceptor below.
    const anchors = chapterDoc.querySelectorAll("a[href]");
    anchors.forEach((el) => {
      const a = el as HTMLAnchorElement;
      const href = a.getAttribute("href") || "";
      if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) return;
      // Drop any fragment; resolve relative to the current chapter, then to OPF dir.
      const target = href.split("#")[0];
      if (!target) return;
      const candidates = [
        pathResolve(rootDir, target).toLowerCase(),
        pathResolve(pathResolve(rootDir, chapterHref), target).toLowerCase(),
        target.toLowerCase(),
        target.split("/").pop()!.toLowerCase()
      ];
      const idx = candidates.map(c => hrefToIndexRef.current.get(c)).find(v => v !== undefined);
      if (idx !== undefined) {
        a.setAttribute("data-epub-href", String(idx));
        a.removeAttribute("href");
        a.style.cursor = "pointer";
      }
    });

    // Strip unneeded javascript or style tags that override user customizations
    chapterDoc.querySelectorAll("script, style, link[rel='stylesheet']").forEach(el => el.remove());

    // Strip inline colors/backgrounds so night themes stay readable
    chapterDoc.querySelectorAll("[style]").forEach((el) => {
      const htmlEl = el as HTMLElement;
      htmlEl.style.removeProperty("color");
      htmlEl.style.removeProperty("background");
      htmlEl.style.removeProperty("background-color");
      htmlEl.style.removeProperty("background-image");
      // Absolute/fixed mid-chapter chrome clips instead of flowing to the next CSS column.
      const pos = (htmlEl.style.position || "").toLowerCase();
      if (pos === "absolute" || pos === "fixed") {
        htmlEl.style.position = "static";
        htmlEl.style.removeProperty("left");
        htmlEl.style.removeProperty("right");
        htmlEl.style.removeProperty("top");
        htmlEl.style.removeProperty("bottom");
        htmlEl.style.removeProperty("transform");
      }
      if (!(htmlEl.getAttribute("style") || "").trim()) {
        htmlEl.removeAttribute("style");
      }
    });

    // Normalize tables so rows can fragment across pages (tall unbreakable tables
    // were clipped at the bottom and never appeared on the next page).
    chapterDoc.querySelectorAll("table").forEach((table) => {
      const el = table as HTMLTableElement;
      el.style.breakInside = "auto";
      el.style.setProperty("-webkit-column-break-inside", "auto");
      el.style.width = "100%";
      el.style.maxWidth = "100%";
      el.style.tableLayout = "fixed";
      el.querySelectorAll("tr").forEach((row) => {
        const tr = row as HTMLTableRowElement;
        tr.style.breakInside = "avoid";
        tr.style.setProperty("-webkit-column-break-inside", "avoid");
      });
      // Drop empty spacer columns that collapse layout in fixed tables.
      el.querySelectorAll("td, th").forEach((cell) => {
        const c = cell as HTMLElement;
        if (!(c.textContent || "").trim() && !c.querySelector("img,svg,image")) {
          c.style.width = "0";
          c.style.padding = "0";
          c.style.border = "none";
        }
      });
    });

    // Soften mid-word footnote/aside spans that smash into neighboring letters
    // (e.g. "your(interest rate)terest").
    chapterDoc.querySelectorAll("span, aside, sup").forEach((node) => {
      const el = node as HTMLElement;
      const text = (el.textContent || "").trim();
      if (!text) return;
      const looksLikeNote =
        /^\(.*\)$/.test(text) ||
        el.tagName === "ASIDE" ||
        /footnote|noteref|annotation|sidenote/i.test(el.className || "") ||
        /footnote|noteref|annotation|sidenote/i.test(el.getAttribute("epub:type") || "");
      if (!looksLikeNote) return;
      el.style.display = "inline";
      el.style.whiteSpace = "normal";
      el.style.marginLeft = "0.15em";
      el.style.marginRight = "0.15em";
      el.style.fontSize = "0.85em";
      el.style.opacity = "0.75";
      if (!text.startsWith("(") && !text.startsWith("[")) {
        el.textContent = `(${text})`;
      }
    });

    return chapterDoc.body?.innerHTML || "No content in chapter";
  }

  // Simple relative path resolver
  function pathResolve(base: string, relative: string): string {
    const stack = base.split("/");
    stack.pop(); // remove current filename if base is a file, or if it has trailing folder
    const parts = relative.split("/");
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === ".") continue;
      if (parts[i] === "..") {
        stack.pop();
      } else {
        stack.push(parts[i]);
      }
    }
    return stack.filter(p => p !== "").join("/");
  }

  // Trigger progress updates and firestore syncs
  async function updateProgress(newChapterIdx: number, goToLastPage = false, opts?: { skipHistory?: boolean }) {
    if (newChapterIdx < 0 || newChapterIdx >= chapters.length) return;

    if (!opts?.skipHistory) {
      pushLocation(currentChapterIdx, currentPageNum);
    }

    // Cancel any in-flight chapter scroll pins from a previous switch.
    scrollPinGenRef.current += 1;
    scrollPinTimersRef.current.forEach((id) => window.clearTimeout(id));
    scrollPinTimersRef.current = [];
    scrollPinCleanupRef.current?.();
    scrollPinCleanupRef.current = null;

    // Disable transition temporarily and reset page index synchronously.
    // Never use an out-of-range page (e.g. 999) — that translates content off-screen.
    setShouldAnimate(false);
    setCurrentPageNum(1);
    setCurrentChapterIdx(newChapterIdx);
    setIsTurningPage(false);

    // Recalculate pages for the new chapter and set target page index
    setTimeout(() => {
      const container = contentRef.current;
      const scroller = pageCanvasRef.current;
      if (!container) return;
      const viewport = Math.max(
        1,
        scroller?.clientWidth || container.getBoundingClientRect().width || 0
      );
      if (viewport <= 1) return;

      if (useScrollLayout) {
        setTotalPages(1);
        setContainerWidth(viewport);
        pageStepRef.current = viewport;
        setPageStep(viewport);
        setCurrentPageNum(1);
        if (scroller) scroller.scrollLeft = 0;

        // Scroll the real overflow container (pageCanvasRef), not the text column.
        // Next chapter: pin to top ONCE. Do not re-force later — that yanks the user
        // back up after they start reading. Prev chapter (end): soft re-pin until
        // layout settles, cancelled as soon as the user scrolls.
        if (scroller) {
          const gen = scrollPinGenRef.current;
          let userMoved = false;
          const onUserScroll = () => {
            userMoved = true;
          };
          scroller.addEventListener("scroll", onUserScroll, { passive: true });
          const cleanup = () => {
            scroller.removeEventListener("scroll", onUserScroll);
            if (scrollPinCleanupRef.current === cleanup) scrollPinCleanupRef.current = null;
          };
          scrollPinCleanupRef.current = cleanup;

          const applyScroll = () => {
            if (gen !== scrollPinGenRef.current || userMoved || !pageCanvasRef.current) return;
            const el = pageCanvasRef.current;
            if (goToLastPage) {
              el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
            } else {
              el.scrollTop = 0;
            }
          };

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              applyScroll();
              if (!goToLastPage) {
                // Single pin is enough for chapter start.
                window.setTimeout(cleanup, 50);
                return;
              }
              // Images / late layout may grow height — re-pin bottom only if user hasn't scrolled.
              const t1 = window.setTimeout(() => {
                if (!userMoved) applyScroll();
              }, 200);
              const t2 = window.setTimeout(() => {
                if (!userMoved) applyScroll();
                cleanup();
              }, 480);
              scrollPinTimersRef.current.push(t1, t2);
            });
          });
        }
        setTimeout(() => setShouldAnimate(true), 150);
        return;
      }

      const viewportH = Math.max(1, Math.floor(scroller?.clientHeight || 0));
      if (viewportH <= 1) return;
      const { step, calculatedPages } = measurePagedPages(container, viewport, viewportH);

      setTotalPages(calculatedPages);
      const targetPage = goToLastPage ? calculatedPages : 1;
      setCurrentPageNum(targetPage);
      applyPagedScroll(targetPage, step);
      
      // Re-enable animation after layout settles
      setTimeout(() => setShouldAnimate(true), 150);
    }, 50);

    const percent = Math.round((newChapterIdx / chapters.length) * 100);
    const updated: BookMetadata = {
      ...book,
      status: percent === 100 ? "completed" : "reading",
      progress: {
        chapterIndex: newChapterIdx,
        chapterTitle: chapters[newChapterIdx]?.title || `Chapter ${newChapterIdx + 1}`,
        pageNumber: goToLastPage ? undefined : 1,
        percent,
        lastReadTime: Date.now()
      }
    };

    onProgressUpdate(updated);
    await syncBookToCloud(userId, updated);
  }

  // --- Audiobook / TTS Narration Engine ---

  // Stop current narration
  const stopSpeech = () => {
    speechSessionRef.current += 1;
    void cancelSpeech();
    setIsPlayingSpeech(false);
    setCurrentParagraphIdx(-1);

    // Clear DOM paragraph highlights
    const container = document.getElementById("epub-text-viewer");
    if (container) {
      container.querySelectorAll(".tts-highlight").forEach((el) => {
        el.classList.remove(
          "tts-highlight",
          "bg-amber-100/60",
          "dark:bg-amber-900/30",
          "ring-1",
          "ring-amber-400/50",
          "rounded-lg",
          "transition-all",
          "duration-300"
        );
      });
    }
  };

  // Get readable DOM text blocks from the parsed chapter container
  const getDOMElementsToRead = () => {
    const container = document.getElementById("epub-text-viewer");
    if (!container) return [];
    // Select paragraphs, lists, and headings for speech
    return Array.from(container.querySelectorAll("p, h1, h2, h3, h4, li")).filter(
      (el) => (el.textContent?.trim().length || 0) > 3
    );
  };

  // Highlight active speaking paragraph and scroll it smoothly into center view
  const highlightParagraphInDOM = (idx: number) => {
    const container = document.getElementById("epub-text-viewer");
    if (!container) return;

    // Remove existing highlights
    container.querySelectorAll(".tts-highlight").forEach((el) => {
      el.classList.remove(
        "tts-highlight",
        "bg-amber-100/60",
        "dark:bg-amber-900/30",
        "ring-1",
        "ring-amber-400/50",
        "rounded-lg",
        "transition-all",
        "duration-300"
      );
    });

    const elements = getDOMElementsToRead();
    if (elements[idx]) {
      const activeEl = elements[idx] as HTMLElement;
      activeEl.classList.add(
        "tts-highlight",
        "bg-amber-100/60",
        "dark:bg-amber-900/30",
        "ring-1",
        "ring-amber-400/50",
        "rounded-lg",
        "transition-all",
        "duration-300"
      );
      // Smooth visual scroll
      activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // Load available speech voices (Android = native TextToSpeech)
  useEffect(() => {
    const loadVoices = () => {
      const allVoices = getSpeechVoices();
      setVoices(allVoices);
      setTtsEngineHint(getTtsEngineHint());
      const settings = getTtsSettings();
      const resolved = resolveSpeechVoice(settings.voiceName);
      if (resolved) {
        setSelectedVoiceName(resolved.name);
        if (!settings.voiceName) saveTtsSettings({ voiceName: resolved.name });
      }
      setSpeechRate(settings.rate || 1);
    };

    const unsubscribe = subscribeToVoicesChanged(loadVoices);
    return () => {
      unsubscribe();
      void cancelSpeech();
    };
  }, []);

  // Speak a specific paragraph index
  const speakParagraph = async (idx: number, session?: number) => {
    const activeSession = session ?? ++speechSessionRef.current;
    if (session == null) {
      await cancelSpeech();
      if (activeSession !== speechSessionRef.current) return;
    }

    const domElements = getDOMElementsToRead();
    if (idx < 0 || idx >= domElements.length) {
      if (activeSession !== speechSessionRef.current) return;
      if (currentChapterIdx < chapters.length - 1) {
        const next = nextReadableChapterIndex(chapters, currentChapterIdx, 1);
        if (next !== currentChapterIdx) {
          updateProgress(next);
          setCurrentParagraphIdx(0);
        } else {
          stopSpeech();
        }
      } else {
        stopSpeech();
      }
      return;
    }

    setCurrentParagraphIdx(idx);
    highlightParagraphInDOM(idx);

    const textToSpeak = prepareTextForNarration(domElements[idx].textContent?.trim() || "", {
      quality: getTtsSettings().qualityPreset,
    });
    if (!textToSpeak) {
      await speakParagraph(idx + 1, activeSession);
      return;
    }

    const settings = getTtsSettings();

    try {
      void import("../lib/iosPwa").then((m) => m.unlockIosAudio());
    } catch {
      /* ignore */
    }

    if (usesNativeTts() && !getSpeechVoices().length) {
      await refreshNativeVoices();
      if (activeSession !== speechSessionRef.current) return;
      setVoices(getSpeechVoices());
      setTtsEngineHint(getTtsEngineHint());
    }

    const selectedVoice = resolveSpeechVoice(selectedVoiceName || settings.voiceName);
    setIsPlayingSpeech(true);

    try {
      await speakText(textToSpeak, {
        rate: getEffectiveSpeechRate(speechRate),
        pitch: settings.pitch,
        voiceName: selectedVoice?.name,
        voiceLang: selectedVoice?.lang || settings.voiceLang || "en-US",
        voiceIndex: selectedVoice?.nativeIndex,
      });
      if (activeSession !== speechSessionRef.current) return;
      await speakParagraph(idx + 1, activeSession);
    } catch (err) {
      if (activeSession !== speechSessionRef.current) return;
      console.error("Narrator TTS error:", err);
      setTtsEngineHint(getTtsEngineHint() || (err as Error).message);
      setIsPlayingSpeech(false);
    }
  };

  // Toggle Play / Pause speech
  const toggleSpeechPlayback = () => {
    if (isPlayingSpeech) {
      speechSessionRef.current += 1;
      void cancelSpeech();
      setIsPlayingSpeech(false);
    } else {
      const startIdx = currentParagraphIdx >= 0 ? currentParagraphIdx : 0;
      void speakParagraph(startIdx);
    }
  };

  // Auto-read on chapter shift if audiobook is currently running
  useEffect(() => {
    if (showAudiobook && isPlayingSpeech) {
      const timer = setTimeout(() => {
        speakParagraph(0);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [currentChapterIdx]);

  const handleClose = () => {
    stopSpeech();
    onClose();
  };

  // Request AI companion assistance using our offline engine (No keys/API needed!)
  const openWebSearch = (query: string) => {
    const q = query.trim();
    if (!q) return;
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  const handleSaveHighlight = async (color: "yellow" | "green" | "blue" | "pink") => {
    const text = selectedText.trim();
    if (!text) return;
    const highlightId = Date.now().toString();
    const chapterTitle = chapters[currentChapterIdx]?.title || `Chapter ${currentChapterIdx + 1}`;
    const newHighlight: BookHighlight = {
      id: highlightId,
      text,
      color,
      chapterIdx: currentChapterIdx,
      chapterTitle,
      createdAt: Date.now()
    };

    // Wrap the live selection BEFORE clearing it — this is what the user sees immediately.
    const viewer = document.getElementById("epub-text-viewer");
    const wrapped = wrapSelectionWithHighlight(color, highlightId, viewer);
    if (wrapped && viewer) {
      // Persist marked HTML into chapter state so React re-renders keep the mark.
      const markedHtml = viewer.innerHTML;
      setChapters((prev) =>
        prev.map((ch, i) => (i === currentChapterIdx ? { ...ch, content: markedHtml } : ch))
      );
    }

    setHighlightsData((prev) => [newHighlight, ...prev]);
    dismissSelection();
    // Stay in the book so the mark is visible (notes panel lists highlights separately).
    setDictFeedback(wrapped ? "Highlight saved" : "Highlight saved (list only)");
    window.setTimeout(() => setDictFeedback(null), 2000);

    try {
      await syncBookHighlight(userId, book.id, newHighlight);
    } catch (err) {
      console.error("Failed to sync highlight", err);
    }
  };

  // Re-apply highlights onto the live chapter DOM after React paints chapter HTML.
  // Catches cases where string injection missed a match (quotes, soft hyphens, etc.).
  useLayoutEffect(() => {
    if (loading) return;
    const viewer = document.getElementById("epub-text-viewer");
    if (!viewer) return;
    applyHighlightsToElement(viewer, highlightsData, currentChapterIdx);
  }, [loading, currentChapterIdx, chapters, highlightsData, chapterHtmlWithHighlights]);

  const handleAddSelectionToNote = () => {
    const quote = selectedText.trim();
    if (!quote) return;
    const chapterTitle = chapters[currentChapterIdx]?.title || `Chapter ${currentChapterIdx + 1}`;
    const next = `${activeNoteText}${activeNoteText.trim() ? "\n\n" : ""}"${quote}"`;
    setActiveNoteText(next);
    setChapterNotesData((prev) => ({
      ...prev,
      [currentChapterIdx]: {
        chapterIdx: currentChapterIdx,
        chapterTitle,
        noteText: next,
        updatedAt: Date.now(),
      },
    }));
    setShowNotes(true);
    dismissSelection();
    setDictFeedback("Added to note");
    window.setTimeout(() => setDictFeedback(null), 2000);
    void syncChapterNote(userId, book.id, currentChapterIdx, chapterTitle, next).catch((err) => {
      console.error("Failed to sync note", err);
    });
  };

  const expandSelectionToSentence = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return;
    
    const text = textNode.textContent || "";
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;
    
    // Scan backward for sentence delimiters: ., !, ? (or start of text)
    let start = startOffset;
    while (start > 0) {
      const prevChar = text[start - 1];
      if (/[.!?]/.test(prevChar)) {
        break;
      }
      start--;
    }
    // Trim leading whitespace
    while (start < startOffset && /\s/.test(text[start])) {
      start++;
    }
    
    // Scan forward for sentence delimiters: ., !, ? (or end of text)
    let end = endOffset;
    while (end < text.length) {
      const char = text[end];
      if (/[.!?]/.test(char)) {
        end++; // Include punctuation
        break;
      }
      end++;
    }
    
    if (end > start) {
      const newRange = document.createRange();
      newRange.setStart(textNode, start);
      newRange.setEnd(textNode, end);
      sel.removeAllRanges();
      sel.addRange(newRange);
      const sentenceText = text.slice(start, end).trim();
      setSelectedText(sentenceText);
      
      // Update coordinates
      try {
        const rect = newRange.getBoundingClientRect();
        setSelectionCoords({
          x: rect.left + rect.width / 2,
          y: rect.bottom + 10,
          top: rect.top,
          bottom: rect.bottom,
        });
      } catch (e) {
        console.warn("Failed to get expanded selection coordinates:", e);
      }
    }
  };

  const analyzeSentenceOffline = async (textToAnalyze: string) => {
    if (!textToAnalyze) return;
    setIsAnalyzing(true);
    setAnalyzedText(textToAnalyze);
    setShowAnalyzer(true);
    setActiveWordDefinition(null);
    
    // Clean and split words
    const words = textToAnalyze
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'“”—]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2);
      
    // Filter duplicates
    const uniqueWords = Array.from(new Set(words));
    
    // Common English stop words
    const stopWords = new Set([
      "the", "and", "a", "an", "of", "to", "in", "is", "you", "that", "it", "he", "was", "for", "on", "are", "as", "with", "his", "they", "i", "at", "be", "this", "have", "from", "or", "one", "had", "by", "word", "but", "not", "what", "all", "were", "we", "when", "your", "can", "said", "there", "use", "an", "each", "which", "she", "do", "how", "their", "if", "then", "them", "these", "so", "some", "her", "would", "him", "into", "has", "more", "look", "two", "more", "write", "go", "see", "no", "way", "could", "my", "than", "first", "been", "call", "who", "its", "now", "did", "get", "come", "made", "may", "part", "said"
    ]);
    
    const breakdown: { word: string; entry: any }[] = [];
    
    for (const word of uniqueWords) {
      if (stopWords.has(word)) continue;
      const entry = await lookupWord(word);
      if (entry) {
        breakdown.push({ word, entry });
      }
    }
    
    setVocabBreakdown(breakdown);
    setIsAnalyzing(false);
  };

  const activeTheme = themes[theme] || themes.sepia;

  return (
    <div
      id="epub-reader-container"
      data-guide="reader-surface"
      data-scroll-mode={useScrollLayout ? "continuous" : "paged"}
      className={`fixed inset-0 z-[100] flex flex-col touch-manipulation overscroll-none ${activeTheme.bg} ${activeTheme.text} transition-colors duration-200 ${
        useScrollLayout ? "kora-scroll-reader" : "kora-paged-reader"
      }${isWalkthroughGuide ? " kora-walkthrough-reader" : ""}${annotateMode ? " annotate-on" : ""}`}
      style={{
        paddingTop: "var(--kora-safe-top)",
        paddingBottom: "var(--kora-safe-bottom)",
        paddingLeft: "var(--kora-safe-left)",
        paddingRight: "var(--kora-safe-right)",
        // Prefer the visual viewport on mobile PWAs so chrome isn't clipped.
        height: "var(--kora-vvh, 100dvh)",
        maxHeight: "var(--kora-vvh, 100dvh)",
        top: "var(--kora-vv-offset-top, 0px)",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* 1. Header Toolbar */}
      <header className={`flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b ${activeTheme.border} bg-opacity-95 shrink-0`}>
        <div className="flex items-center gap-4">
          <button 
            id="close-reader-btn"
            onClick={handleClose} 
            className="p-2 rounded-xl hover:bg-neutral-500/10 transition text-kindle-text"
            title="Back to Library"
            aria-label="Back to library"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          {locationHistory.length > 1 && (
            <button
              type="button"
              onClick={goBackLocation}
              className="p-2 rounded-xl hover:bg-neutral-500/10 transition text-kindle-text"
              title="Back to previous location"
              aria-label="Back to previous reading location"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          )}
          <div className="hidden sm:block">
            <h1 className="font-sans font-bold text-xs uppercase tracking-widest text-kindle-text-muted">
              {book.title}
            </h1>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {annotateMode && (
            <span className="hidden sm:inline-flex items-center rounded-lg border border-kindle-accent/30 bg-kindle-accent/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-kindle-accent">
              Select text
            </span>
          )}
          <button
            data-guide="reader-notes-btn"
            onClick={() => {
              setShowNotes(!showNotes);
              setShowSettings(false);
              setShowToc(false);
              setShowAudiobook(false);
              if (!showNotes) exitAnnotateMode();
            }}
            className={`p-2 rounded-xl hover:bg-neutral-500/10 transition ${showNotes ? 'bg-neutral-500/20' : ''}`}
            title="Saved highlights & notes"
            aria-label="Saved highlights and notes"
            aria-pressed={showNotes}
          >
            <FileText className="w-5 h-5" />
          </button>
          <button
            id="toggle-toc-btn"
            onClick={() => { setShowToc(!showToc); setShowSettings(false); setShowAudiobook(false); setShowNotes(false); if (!showToc) exitAnnotateMode(); }}
            className={`p-2 rounded-xl hover:bg-neutral-500/10 transition ${showToc ? 'bg-neutral-500/20' : ''}`}
            title="Chapters"
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <button
            id="toggle-settings-btn"
            onClick={() => { setShowSettings(!showSettings); setShowToc(false); setShowAudiobook(false); setShowNotes(false); if (!showSettings) exitAnnotateMode(); }}
            className={`p-2 rounded-xl hover:bg-neutral-500/10 transition ${showSettings ? 'bg-neutral-500/20' : ''}`}
            title="Display Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
 
          <button
            id="toggle-audiobook-btn"
            onClick={() => {
              if (showAudiobook) {
                stopSpeech();
                setIsAudiobookExpanded(false);
                setShowAudiobook(false);
              } else {
                setShowAudiobook(true);
                // Open the full sheet on narrow screens so the header isn't clipped
                setIsAudiobookExpanded(typeof window !== "undefined" && window.innerWidth < 768);
                setShowToc(false);
                setShowSettings(false);
                setShowNotes(false);
                exitAnnotateMode();
              }
            }}
            className={`p-2 rounded-xl hover:bg-neutral-500/10 transition relative ${showAudiobook ? 'bg-kindle-accent/20 text-kindle-accent' : ''}`}
            title="Listen"
          >
            <Headphones className="w-5 h-5" />
            {isPlayingSpeech && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            )}
          </button>

          <button
            data-guide="reader-annotate-btn"
            onClick={toggleAnnotateMode}
            className={`p-2 rounded-xl hover:bg-neutral-500/10 transition ${annotateMode ? "bg-kindle-accent/20 text-kindle-accent font-semibold" : ""}`}
            title={annotateMode ? "Done selecting" : "Annotate — select text"}
            aria-label={annotateMode ? "Exit annotate mode" : "Annotate — select text"}
            aria-pressed={annotateMode}
          >
            <Highlighter className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* 2. Main Reader Split Board */}
      <div className="flex-1 flex flex-col-reverse md:flex-row overflow-hidden relative">
        {/* Sidebar: Table of Contents */}
        {showToc && (
          <aside className={`w-full md:w-80 h-[50vh] md:h-auto border-t md:border-t-0 md:border-r ${activeTheme.border} ${activeTheme.card} overflow-y-auto flex flex-col z-40 md:z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] md:shadow-none animate-in slide-in-from-bottom md:slide-in-from-left duration-200 shrink-0`}>
            <div className={`p-4 border-b ${activeTheme.border} flex justify-between items-center`}>
              <span className="font-sans font-semibold text-sm flex items-center gap-2 text-[#5c5346]">
                <BookOpen className="w-4 h-4 text-[#5c5346]" />
                Table of Contents
              </span>
              <button onClick={() => setShowToc(false)} className="p-1 rounded hover:bg-neutral-500/10 text-xs">
                Close
              </button>
            </div>
            <div className="flex-1 p-2">
              {chapters.map((ch, idx) => (
                <button
                  key={ch.id}
                  onClick={() => {
                    updateProgress(idx);
                    setShowToc(false);
                  }}
                  className={`w-full text-left p-2.5 rounded-lg text-xs font-sans transition flex items-start gap-2 ${
                    currentChapterIdx === idx 
                      ? "bg-[#5c5346] text-white font-medium shadow-sm" 
                      : "hover:bg-neutral-500/10"
                  }`}
                >
                  <span className="opacity-65 font-mono">{idx + 1}.</span>
                  <span className="line-clamp-2">{ch.title}</span>
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Sidebar: Reader Settings panel */}
        {showSettings && (
          <>
            <div className="absolute inset-0 z-30 bg-black/10 md:hidden" onClick={() => setShowSettings(false)} />
            <aside data-guide="reader-settings-panel" className={`w-full md:w-80 h-[min(70vh,32rem)] md:h-auto border-t md:border-t-0 md:border-r ${activeTheme.border} ${activeTheme.card} p-5 pb-[max(1.25rem,var(--kora-safe-bottom))] overflow-y-auto z-40 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.1)] md:shadow-none animate-in slide-in-from-bottom md:slide-in-from-left duration-200 shrink-0`}>
            <div className={`pb-3 mb-4 border-b ${activeTheme.border} flex justify-between items-center`}>
              <span className="font-sans font-semibold text-sm flex items-center gap-2 text-[#5c5346] dark:text-neutral-300">
                <Type className="w-4 h-4 text-[#5c5346] dark:text-neutral-300" />
                Display Settings
              </span>
              <button onClick={() => setShowSettings(false)} className="text-xs p-1 hover:bg-neutral-500/10 rounded font-sans font-semibold text-[#5c5346] dark:text-neutral-300">
                Done
              </button>
            </div>

            {/* PRIMARY SETTINGS (Always Visible) */}
            {/* Reading Modes (Themes) */}
            <div className="mb-4">
              <label className="text-xs opacity-75 font-sans block mb-2 font-semibold">Reading Theme</label>
              <div className="grid grid-cols-4 gap-1.5">
                {PRIMARY_READER_THEME_KEYS.map((tKey) => {
                  const th = resolveReaderTheme(tKey);
                  return (
                    <button
                      key={tKey}
                      type="button"
                      onClick={() => {
                        setTheme(tKey);
                        setThemeManuallySet(true);
                        window.dispatchEvent(new CustomEvent("kora-guide:reader-setting-changed"));
                      }}
                      aria-label={`${th.label} theme`}
                      aria-pressed={theme === tKey}
                      className={`h-10 rounded-lg border flex items-center justify-center text-[10px] font-semibold ${
                        theme === tKey ? "ring-2 ring-kindle-accent border-transparent" : "border-neutral-500/20"
                      }`}
                      style={{ background: th.previewBg, color: th.previewText }}
                      title={th.label}
                    >
                      {th.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                {(["light", "green", "dark"] as const).map((tKey) => {
                  const th = resolveReaderTheme(tKey);
                  return (
                    <button
                      key={tKey}
                      type="button"
                      onClick={() => {
                        setTheme(tKey);
                        setThemeManuallySet(true);
                        window.dispatchEvent(new CustomEvent("kora-guide:reader-setting-changed"));
                      }}
                      aria-label={`${th.label} theme`}
                      aria-pressed={theme === tKey}
                      className={`h-8 rounded-lg border flex items-center justify-center text-[9px] font-semibold ${
                        theme === tKey ? "ring-2 ring-kindle-accent border-transparent" : "border-neutral-500/20"
                      }`}
                      style={{ background: th.previewBg, color: th.previewText }}
                    >
                      {th.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Font Family Selection */}
            <div className="mb-4">
              <label className="text-xs opacity-75 font-sans block mb-2 font-semibold">Font Style</label>
              <div className="grid grid-cols-2 gap-2">
                {fontFamilies.map((ff) => (
                  <button
                    key={ff.value}
                    type="button"
                    onClick={() => setFontFamily(ff.value)}
                    aria-pressed={fontFamily === ff.value}
                    className={`p-2 text-xs rounded-lg border text-center transition ${ff.value} ${
                      fontFamily === ff.value
                        ? "border-[#5c5346] bg-[#5c5346]/10 font-semibold"
                        : "border-neutral-500/20 hover:border-neutral-500/50"
                    }`}
                  >
                    {ff.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size Adjuster */}
            <div className="mb-4" data-guide="reader-font-size">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs opacity-75 font-sans font-semibold">Font Size</label>
                <span className="text-xs font-mono">{fontSize}px</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setFontSize(Math.max(12, fontSize - 1));
                    window.dispatchEvent(new CustomEvent("kora-guide:font-size-changed"));
                  }}
                  className="flex-1 p-2 border border-neutral-500/20 rounded-lg text-sm hover:bg-neutral-500/10 font-bold"
                >
                  A -
                </button>
                <button
                  onClick={() => {
                    setFontSize(Math.min(32, fontSize + 1));
                    window.dispatchEvent(new CustomEvent("kora-guide:font-size-changed"));
                  }}
                  className="flex-1 p-2 border border-neutral-500/20 rounded-lg text-sm hover:bg-neutral-500/10 font-bold"
                >
                  A +
                </button>
              </div>
            </div>

            {/* Brightness Control */}
            <div className="mb-5">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs opacity-75 font-sans font-semibold">Brightness</label>
                <span className="text-[10px] font-mono">{brightness}%</span>
              </div>
              <input
                type="range"
                min="20"
                max="100"
                value={brightness}
                onChange={(e) => setBrightness(parseInt(e.target.value))}
                className="w-full accent-kindle-accent h-1 bg-neutral-200 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* COLLAPSIBLE SETTINGS - KEPT FULLY EXPANDED AS REQUESTED */}
            <div className="space-y-6 border-t border-neutral-500/15 pt-4">
              {/* Section 1: Typography Details */}
              <div className="border-b border-neutral-500/10 pb-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-kindle-text-muted py-1.5 select-none">
                  Typography Details
                </h3>
                <div className="mt-3 space-y-4">
                  {/* Line Spacing */}
                  <div>
                    <label className="text-[10px] opacity-75 font-sans block mb-1.5 uppercase font-bold tracking-wider">Line Spacing</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[1.2, 1.6, 2.0].map((spacing) => (
                        <button
                          key={spacing}
                          onClick={() => {
                            setLineSpacing(spacing);
                            window.dispatchEvent(new CustomEvent("kora-guide:reader-setting-changed"));
                          }}
                          className={`p-2 text-xs rounded-lg border text-center font-sans transition ${
                            lineSpacing === spacing
                              ? "bg-kindle-text text-kindle-bg border-transparent"
                              : "border-neutral-500/20 hover:border-neutral-500/50"
                          }`}
                        >
                          {spacing === 1.2 ? "Compact" : spacing === 1.6 ? "Regular" : "Wide"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Letter Spacing Selection */}
                  <div>
                    <label className="text-[10px] opacity-75 font-sans block mb-1.5 uppercase font-bold tracking-wider">Letter Spacing</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { label: "Normal", val: "tracking-normal" },
                        { label: "Wide", val: "tracking-wide" },
                        { label: "Wider", val: "tracking-wider" }
                      ].map((ls) => (
                        <button
                          key={ls.val}
                          onClick={() => setLetterSpacing(ls.val)}
                          className={`p-2 text-[10px] rounded-lg border text-center font-sans transition ${
                            letterSpacing === ls.val
                              ? "bg-kindle-text text-kindle-bg border-transparent"
                              : "border-neutral-500/20 hover:border-neutral-500/50"
                          }`}
                        >
                          {ls.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Margins */}
                  <div>
                    <label className="text-[10px] opacity-75 font-sans block mb-1.5 uppercase font-bold tracking-wider">Margins</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { label: "None", val: "max-w-full" },
                        { label: "Narrow", val: "max-w-2xl" },
                        { label: "Wide", val: "max-w-xl" }
                      ].map((m) => (
                        <button
                          key={m.val}
                          onClick={() => setMarginSize(m.val)}
                          className={`p-2 text-xs rounded-lg border text-center font-sans transition ${
                            marginSize === m.val
                              ? "bg-kindle-text text-kindle-bg border-transparent"
                              : "border-neutral-500/20 hover:border-neutral-500/50"
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Hyphenation Toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold">Auto Hyphenation</h4>
                      <p className="text-[10px] text-kindle-text-muted font-sans">Improve alignment with hyphens</p>
                    </div>
                    <button 
                      onClick={() => setHyphenation(!hyphenation)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${hyphenation ? "bg-kindle-accent" : "bg-kindle-accent/25"}`}
                      aria-pressed={hyphenation}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transition-transform ${hyphenation ? "translate-x-5 bg-kindle-bg" : "translate-x-0 bg-kindle-text/70"}`} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Section 2: Layout & Media */}
              <div className="border-b border-neutral-500/10 pb-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-kindle-text-muted py-1.5 select-none">
                  Layout & Media
                </h3>
                <div className="mt-3 space-y-4">
                  {/* Double Column Spread Toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold">Dual Page Spread</h4>
                      <p className="text-[10px] text-kindle-text-muted">Show 2 pages side-by-side</p>
                    </div>
                    <button 
                      onClick={() => setDoubleColumns(!doubleColumns)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${doubleColumns ? "bg-kindle-accent" : "bg-kindle-accent/25"}`}
                      aria-pressed={doubleColumns}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transition-transform ${doubleColumns ? "translate-x-5 bg-kindle-bg" : "translate-x-0 bg-kindle-text/70"}`} />
                    </button>
                  </div>

                  {/* Continuous Scroll Toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold">Continuous Scroll</h4>
                      <p className="text-[10px] text-kindle-text-muted">Scroll instead of page-by-page turns</p>
                    </div>
                    <button
                      onClick={() => {
                        setIsContinuous(!isContinuous);
                        window.dispatchEvent(new CustomEvent("kora-guide:reader-setting-changed"));
                      }}
                      className={`w-10 h-5 rounded-full transition-colors relative ${isContinuous ? "bg-kindle-accent" : "bg-kindle-accent/25"}`}
                      aria-pressed={isContinuous}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transition-transform ${isContinuous ? "translate-x-5 bg-kindle-bg" : "translate-x-0 bg-kindle-text/70"}`} />
                    </button>
                  </div>

                  {/* Grayscale Images Toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold">Grayscale Images</h4>
                      <p className="text-[10px] text-kindle-text-muted">Convert all book images to b&w</p>
                    </div>
                    <button 
                      onClick={() => setGrayscaleImages(!grayscaleImages)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${grayscaleImages ? "bg-kindle-accent" : "bg-kindle-accent/25"}`}
                      aria-pressed={grayscaleImages}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transition-transform ${grayscaleImages ? "translate-x-5 bg-kindle-bg" : "translate-x-0 bg-kindle-text/70"}`} />
                    </button>
                  </div>

                  {/* Hide Images Toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold">Hide Images</h4>
                      <p className="text-[10px] text-kindle-text-muted">Do not display any images in book</p>
                    </div>
                    <button 
                      onClick={() => setHideImages(!hideImages)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${hideImages ? "bg-kindle-accent" : "bg-kindle-accent/25"}`}
                      aria-pressed={hideImages}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transition-transform ${hideImages ? "translate-x-5 bg-kindle-bg" : "translate-x-0 bg-kindle-text/70"}`} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Section 3: Navigation & Gestures */}
              <div className="border-b border-neutral-500/10 pb-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-kindle-text-muted py-1.5 select-none">
                  Navigation & Gestures
                </h3>
                <div className="mt-3 space-y-4">
                  {/* Page Change Control Options */}
                  <div>
                    <label className="text-[10px] opacity-75 font-sans block mb-1.5 uppercase font-bold tracking-wider">Page Turn Zones</label>
                    <div className="space-y-1.5">
                      {[
                        { label: "Classic 50/50 Split", val: "fifty-fifty", desc: "Left half goes backward, right half goes forward." },
                        { label: "Classic E-Reader", val: "classic-ereader", desc: "Left 25% goes backward, right 75% goes forward." },
                        { label: "Margins Only (15%)", val: "margins-only", desc: "Only tapping outer 15% edges turns pages." },
                        { label: "Floating Buttons", val: "floating-buttons", desc: "Use on-screen circular buttons to turn pages." },
                        { label: "Keys Only", val: "keys-only", desc: "Disable tap-to-turn entirely. Use keyboard arrows or space." }
                      ].map((mode) => (
                        <button
                          key={mode.val}
                          onClick={() => setPageTurnMode(mode.val)}
                          className={`w-full p-2.5 rounded-xl border text-left font-sans transition flex flex-col gap-0.5 ${
                            pageTurnMode === mode.val
                              ? "bg-kindle-text text-kindle-bg border-transparent"
                              : "border-neutral-500/20 hover:border-neutral-500/50"
                          }`}
                        >
                          <span className="text-xs font-semibold">{mode.label}</span>
                          <span className={`text-[10px] ${pageTurnMode === mode.val ? "opacity-80" : "text-kindle-text-muted"}`}>{mode.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {!useScrollLayout && (
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-bold">Disable mouse scroll</h4>
                        <p className="text-[10px] text-kindle-text-muted">Block wheel from turning pages in tap-to-turn mode</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDisableMouseScroll(!disableMouseScroll)}
                        className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${disableMouseScroll ? "bg-kindle-accent" : "bg-kindle-accent/25"}`}
                        aria-pressed={disableMouseScroll}
                      >
                        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transition-transform ${disableMouseScroll ? "translate-x-5 bg-kindle-bg" : "translate-x-0 bg-kindle-text/70"}`} />
                      </button>
                    </div>
                  )}

                  {!useScrollLayout && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-xs font-bold">Swipe to turn</h4>
                          <p className="text-[10px] text-kindle-text-muted">Vertical swipe turns the page</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSwipeToTurn(!swipeToTurn)}
                          className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${swipeToTurn ? "bg-kindle-accent" : "bg-kindle-accent/25"}`}
                          aria-pressed={swipeToTurn}
                        >
                          <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transition-transform ${swipeToTurn ? "translate-x-5 bg-kindle-bg" : "translate-x-0 bg-kindle-text/70"}`} />
                        </button>
                      </div>
                      {swipeToTurn && (
                        <div className="flex gap-2 p-1 bg-neutral-500/10 rounded-xl font-sans text-xs">
                          {(
                            [
                              { val: "up" as const, label: "Swipe up → next" },
                              { val: "down" as const, label: "Swipe down → next" },
                            ]
                          ).map((opt) => (
                            <button
                              key={opt.val}
                              type="button"
                              onClick={() => setSwipeDirection(opt.val)}
                              className={`flex-1 py-1.5 rounded-lg transition ${
                                swipeDirection === opt.val
                                  ? "bg-kindle-text text-kindle-bg shadow"
                                  : "hover:bg-neutral-500/10 text-kindle-text-muted hover:text-kindle-text"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Page Transition Effect */}
                  <div>
                    <label className="text-[10px] opacity-75 font-sans block mb-1.5 uppercase font-bold tracking-wider">Page Transition Effect</label>
                    <div className="flex gap-2 p-1 bg-neutral-500/10 rounded-xl font-sans text-xs">
                      {["paper-flip", "spring", "none"].map((effect) => (
                        <button
                          key={effect}
                          onClick={() => setPageTransitionEffect(effect)}
                          className={`flex-1 py-1.5 rounded-lg transition capitalize ${pageTransitionEffect === effect ? "bg-kindle-text text-kindle-bg shadow" : "hover:bg-neutral-500/10 text-kindle-text-muted hover:text-kindle-text"}`}
                        >
                          {effect.replace("-", " ")}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Page Overlap (KOReader-style) — single-column paged only */}
                  <div className={useScrollLayout || useDoubleColumns ? "opacity-50 pointer-events-none" : ""}>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-[10px] opacity-75 font-sans uppercase font-bold tracking-wider">Page Overlap</label>
                      <span className="text-[10px] font-mono">{pageOverlap}px</span>
                    </div>
                    <p className="text-[10px] text-kindle-text-muted mb-2 font-sans">
                      {useScrollLayout
                        ? "Unavailable in continuous scroll."
                        : useDoubleColumns
                          ? "Unavailable in dual-page mode."
                          : "Repeat the last few lines at the top of the next page."}
                    </p>
                    <input
                      type="range"
                      min="0"
                      max="60"
                      step="2"
                      value={pageOverlap}
                      disabled={useScrollLayout || useDoubleColumns}
                      onChange={(e) => setPageOverlap(parseInt(e.target.value))}
                      className="w-full accent-kindle-accent h-1 bg-neutral-200 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Reading companion pet */}
            <div className="pt-4 border-t border-kindle-border space-y-3 mt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-[10px] uppercase tracking-widest font-bold text-kindle-text-muted">Reading Pet</h4>
                  <p className="text-[10px] text-kindle-text-muted mt-0.5">
                    Pixel buddy in the corner — reacts to the page mood (no AI).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPetEnabled(!petEnabled)}
                  className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${petEnabled ? "bg-kindle-accent" : "bg-kindle-accent/25"}`}
                  aria-pressed={petEnabled}
                >
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transition-transform ${petEnabled ? "translate-x-5 bg-kindle-bg" : "translate-x-0 bg-kindle-text/70"}`} />
                </button>
              </div>
              {petEnabled ? (
                <div className="grid grid-cols-2 gap-2">
                  {READER_PETS.map((pet) => {
                    const selected = petId === pet.id;
                    return (
                      <button
                        key={pet.id}
                        type="button"
                        onClick={() => setPetId(pet.id)}
                        className={`text-left rounded-xl border px-2.5 py-2 transition ${
                          selected
                            ? "border-kindle-text bg-kindle-text/10"
                            : "border-kindle-border hover:bg-kindle-text/5"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ background: pet.accent, boxShadow: `0 0 0 1px ${pet.accent}55` }}
                          />
                          <span className="text-[11px] font-bold font-mono tracking-wide">{pet.name}</span>
                        </div>
                        <p className="text-[9px] opacity-60 leading-snug line-clamp-2">{pet.tagline}</p>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </aside>
          </>
        )}
          {/* Sidebar / Popup: Voice Narrator panel */}
        {showAudiobook && (
          <>
            {/* Mobile expanded backdrop */}
            <div
              data-kora-pass-through
              className={`absolute inset-0 z-30 bg-black/25 md:hidden transition-opacity ${isAudiobookExpanded ? "opacity-100" : "opacity-0 pointer-events-none"}`}
              onClick={() => setIsAudiobookExpanded(false)}
            />

            {/* Mobile mini player — only when collapsed */}
            {!isAudiobookExpanded && (
              <div
                className={`md:hidden fixed left-4 right-4 z-[60] h-16 rounded-2xl border ${activeTheme.border} ${activeTheme.card} shadow-xl flex items-center px-4 py-2`}
                style={{ bottom: "max(1rem, var(--kora-safe-bottom))" }}
                onClick={() => setIsAudiobookExpanded(true)}
              >
                <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
                  <div className={`w-8 h-8 rounded-full border border-current/10 flex items-center justify-center bg-black/10 shrink-0 ${isPlayingSpeech ? "animate-spin" : ""}`} style={{ animationDuration: "6s" }}>
                    <div className="w-3.5 h-3.5 rounded-full bg-amber-500 flex items-center justify-center text-neutral-900 font-bold text-[7px]">
                      A
                    </div>
                  </div>
                  <div className="min-w-0 truncate">
                    <span className="font-semibold text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-wider block truncate">
                      {isPlayingSpeech ? "Narrating..." : "Ready to listen"}
                    </span>
                    <p className="text-[10px] opacity-70 truncate font-serif">
                      {currentParagraphIdx >= 0 ? `Section ${currentParagraphIdx + 1}` : "Tap to open"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={toggleSpeechPlayback}
                    className="w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-600 text-neutral-950 flex items-center justify-center shadow-sm transform active:scale-95 transition"
                  >
                    {isPlayingSpeech ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>
                  <button
                    onClick={() => { stopSpeech(); setShowAudiobook(false); }}
                    className="w-8 h-8 flex items-center justify-center text-neutral-500 hover:text-current rounded-full"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* Full panel: desktop sidebar always; mobile sheet when expanded */}
            <aside
              className={`
                ${activeTheme.border} ${activeTheme.card}
                flex flex-col overflow-hidden shrink-0
                animate-in slide-in-from-bottom md:slide-in-from-left duration-200
                ${isAudiobookExpanded
                  ? `fixed inset-x-0 z-[70] rounded-t-3xl border-t shadow-[0_-10px_40px_rgba(0,0,0,0.2)] md:static md:inset-auto md:z-40 md:rounded-none md:border-t-0 md:border-r md:shadow-none md:h-auto md:w-80`
                  : `hidden md:flex md:relative md:w-80 md:h-auto md:border-r`
                }
              `}
              style={isAudiobookExpanded ? {
                bottom: 0,
                top: "auto",
                maxHeight: "min(70dvh, calc(100dvh - 5.5rem))",
                paddingBottom: "max(1.25rem, var(--kora-safe-bottom))",
              } : undefined}
            >
              <div className="w-full flex flex-col h-full min-h-0 p-5 md:p-5">
                {isAudiobookExpanded && (
                  <div className="w-full flex justify-center pb-2 md:hidden shrink-0" onClick={() => setIsAudiobookExpanded(false)}>
                    <div className="w-12 h-1.5 bg-current opacity-20 rounded-full" />
                  </div>
                )}

                <div className={`pb-3 mb-4 border-b ${activeTheme.border} flex justify-between items-center shrink-0`}>
                  <span className="font-sans font-semibold text-sm flex items-center gap-2 text-[#5c5346] dark:text-neutral-300">
                    <Headphones className="w-4 h-4" />
                    Voice Narrator
                  </span>
                  <button
                    onClick={() => {
                      if (isAudiobookExpanded) setIsAudiobookExpanded(false);
                      else { stopSpeech(); setShowAudiobook(false); }
                    }}
                    className="text-xs px-2 py-1 hover:bg-neutral-500/10 rounded font-sans font-semibold text-[#5c5346] dark:text-neutral-300"
                  >
                    {isAudiobookExpanded ? "Collapse" : "Done"}
                  </button>
                </div>

                <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-h-0 overscroll-contain">
                  {/* Status Indicator */}
                  <div className={`p-4 rounded-xl border ${activeTheme.border} bg-white/5 flex items-center gap-3`}>
                    <div className={`w-8 h-8 rounded-full border border-current/10 flex items-center justify-center bg-black/10 shrink-0 ${isPlayingSpeech ? "animate-spin" : ""}`} style={{ animationDuration: "6s" }}>
                      <div className="w-3.5 h-3.5 rounded-full bg-amber-500 flex items-center justify-center text-neutral-900 font-bold text-[7px]">
                        A
                      </div>
                    </div>
                    <div className="min-w-0">
                      <span className="font-semibold text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 uppercase tracking-wider">
                        {isPlayingSpeech ? "Narrating..." : "Ready to listen"}
                      </span>
                      <p className="text-xs opacity-70 truncate font-serif mt-0.5">
                        {currentParagraphIdx >= 0 ? `Reading Section ${currentParagraphIdx + 1}` : "Click play to start"}
                      </p>
                    </div>
                  </div>

                  {/* Primary Playback controls */}
                  <div className="flex items-center gap-2 justify-center py-2">
                    <button
                      onClick={() => speakParagraph(Math.max(0, currentParagraphIdx - 1))}
                      className="p-2.5 rounded-lg border border-neutral-500/20 hover:bg-neutral-500/10 transition"
                      title="Previous Section"
                    >
                      <Rewind className="w-4 h-4 text-kindle-text" />
                    </button>
                    <button
                      onClick={toggleSpeechPlayback}
                      className="w-12 h-12 rounded-full bg-amber-500 hover:bg-amber-600 text-neutral-950 flex items-center justify-center shadow-md transform active:scale-95 transition"
                      title={isPlayingSpeech ? "Pause" : "Play"}
                    >
                      {isPlayingSpeech ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </button>
                    <button
                      onClick={() => speakParagraph(currentParagraphIdx + 1)}
                      className="p-2.5 rounded-lg border border-neutral-500/20 hover:bg-neutral-500/10 transition"
                      title="Next Section"
                    >
                      <FastForward className="w-4 h-4 text-kindle-text" />
                    </button>
                    <button
                      onClick={stopSpeech}
                      className="p-2.5 rounded-lg border border-neutral-500/20 text-red-500 hover:bg-red-50/10 transition"
                      title="Reset Speech"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Settings Block (Voice, Speed, etc) */}
                  <div className="space-y-4 pt-2">
                    {/* Voice selector */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest opacity-60 block mb-1">Voice Accent</label>
                      <select
                        value={selectedVoiceName}
                        onChange={(e) => {
                          setSelectedVoiceName(e.target.value);
                          saveTtsSettings({ voiceName: e.target.value });
                          if (isPlayingSpeech) {
                            setTimeout(() => speakParagraph(currentParagraphIdx >= 0 ? currentParagraphIdx : 0), 100);
                          }
                        }}
                        className="w-full p-2 text-xs rounded-lg border border-neutral-500/20 bg-transparent focus:ring-1 focus:ring-amber-500 focus:outline-none text-current"
                      >
                        {voices.length === 0 ? (
                          <option value="">
                            {usesNativeTts()
                              ? "Loading Android system voices…"
                              : "Loading voices…"}
                          </option>
                        ) : (
                          voices.map((v) => (
                            <option key={`${v.name}-${v.lang}`} value={v.name} className="text-neutral-900 bg-white">
                              {v.name.slice(0, 28)} ({v.lang.split("-")[0].toUpperCase()})
                            </option>
                          ))
                        )}
                      </select>
                      {ttsEngineHint ? (
                        <p className="text-[10px] text-amber-500/90 mt-1.5 leading-snug">{ttsEngineHint}</p>
                      ) : null}
                      {usesNativeTts() && voices.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => void openNativeTtsInstall()}
                          className="mt-2 text-[10px] font-bold uppercase tracking-wider text-amber-400 underline"
                        >
                          Open Android TTS settings
                        </button>
                      ) : null}
                    </div>

                    {/* Speed */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest opacity-60">Speech Speed</label>
                        <span className="text-xs font-mono font-semibold">{speechRate}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={speechRate}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setSpeechRate(val);
                          saveTtsSettings({ rate: val });
                          if (isPlayingSpeech) {
                            setTimeout(() => speakParagraph(currentParagraphIdx >= 0 ? currentParagraphIdx : 0), 100);
                          }
                        }}
                        className="w-full accent-amber-500 cursor-pointer h-1 bg-neutral-500/20 rounded-lg appearance-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </>
        )}

        {/* Sidebar: Highlights & Notes */}
        {showNotes && (
          <aside className={`w-full md:w-80 h-[50vh] md:h-auto border-t md:border-t-0 md:border-r ${activeTheme.border} ${activeTheme.card} overflow-y-auto flex flex-col z-40 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] md:shadow-none animate-in slide-in-from-bottom md:slide-in-from-left duration-200 shrink-0`}>
            <div className={`p-4 border-b ${activeTheme.border} flex justify-between items-center bg-black/5`}>
              <span className="font-serif font-bold text-sm tracking-tight flex items-center gap-2 text-kindle-text">
                <FileText className="w-4 h-4 text-emerald-500" />
                Highlights & Notes
              </span>
              <button 
                onClick={() => setShowNotes(false)}
                className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition text-kindle-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-8">
              {/* Chapter Notes Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-widest text-kindle-text-muted flex items-center gap-2">
                  <BookOpen className="w-3.5 h-3.5" />
                  Chapter Notes
                </h3>
                
                <div className={`p-3 rounded-xl border ${activeTheme.border} bg-white/5`}>
                  <p className="text-[10px] font-semibold text-kindle-text-muted mb-2 font-sans truncate">
                    {chapters[currentChapterIdx]?.title || `Chapter ${currentChapterIdx + 1}`}
                  </p>
                  <textarea
                    value={activeNoteText}
                    onChange={(e) => setActiveNoteText(e.target.value)}
                    placeholder="Add your notes for this chapter..."
                    className="w-full h-24 bg-transparent resize-none text-sm font-sans focus:outline-none text-kindle-text placeholder:text-kindle-text-muted/50"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={handleSaveChapterNote}
                      disabled={isSavingNote || activeNoteText === chapterNotesData[currentChapterIdx]?.noteText}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[10px] font-bold rounded-lg transition flex items-center gap-1"
                    >
                      {isSavingNote ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-3 h-3" />}
                      Save
                    </button>
                  </div>
                </div>
              </div>

              {/* Highlights Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-kindle-text-muted flex items-center gap-2">
                    <Highlighter className="w-3.5 h-3.5" />
                    My Highlights
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      const md = highlightsToMarkdown({
                        book,
                        highlights: highlightsData,
                        notes: activeNoteText.trim()
                          ? [{
                              chapterIdx: currentChapterIdx,
                              chapterTitle: chapters[currentChapterIdx]?.title || `Chapter ${currentChapterIdx + 1}`,
                              noteText: activeNoteText,
                              updatedAt: Date.now(),
                            }]
                          : [],
                      });
                      downloadMarkdown(`${book.title} — annotations.md`, md);
                    }}
                    className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border border-kindle-border flex items-center gap-1 hover:bg-black/5"
                    aria-label="Export highlights to Markdown"
                  >
                    <Download className="w-3 h-3" />
                    MD
                  </button>
                </div>
                
                {highlightsData.length === 0 ? (
                  <div className="text-center p-6 border border-dashed border-kindle-border rounded-xl">
                    <p className="text-xs text-kindle-text-muted italic">
                      Tap the highlighter icon, then select text to create highlights.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {highlightsData.map(h => (
                      <div key={h.id} className={`p-3 rounded-xl border ${activeTheme.border} bg-white/5 relative group`}>
                        <p className="text-[9px] font-semibold text-kindle-text-muted/60 mb-1 font-sans truncate pr-6">
                          {h.chapterTitle}
                        </p>
                        <p className={`text-sm italic leading-relaxed text-kindle-text border-l-2 pl-2 ${
                          h.color === 'yellow' ? 'border-yellow-400' :
                          h.color === 'green' ? 'border-emerald-400' :
                          h.color === 'blue' ? 'border-blue-400' :
                          'border-pink-400'
                        }`}>
                          "{h.text}"
                        </p>
                        <button
                          onClick={() => handleDeleteHighlight(h.id)}
                          className="absolute top-2 right-2 p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition"
                          title="Delete highlight"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}

        {/* EPUB Page Screen Core */}
        <main className="flex-1 flex flex-col relative overflow-hidden">
          {/* Brightness Overlay */}
          <div 
            className="fixed inset-0 pointer-events-none z-[60] bg-black" 
            style={{ opacity: `${(100 - brightness) * 0.7}%` }} 
          />

          {/* Dictionary Modal — anchored near the selection so the word stays visible */}
          {dictionaryWord && (
            <div className="absolute inset-0 z-[70] pointer-events-none">
              <div
                className="absolute inset-0 bg-black/25 pointer-events-auto"
                onClick={() => setDictionaryWord(null)}
              />
              <div
                className={`pointer-events-auto absolute left-1/2 w-[min(100%-1.5rem,22rem)] max-h-[min(52dvh,22rem)] ${activeTheme.card} ${activeTheme.text} border ${activeTheme.border} rounded-2xl shadow-2xl p-4 sm:p-5 overflow-y-auto animate-in fade-in zoom-in-95 duration-200`}
                style={(() => {
                  const pad = 12;
                  const panelH = Math.min(window.innerHeight * 0.52, 352);
                  const coords = selectionCoords;
                  if (!coords) {
                    return {
                      top: "auto",
                      bottom: pad,
                      transform: "translateX(-50%)",
                    } as React.CSSProperties;
                  }
                  const spaceBelow = window.innerHeight - coords.bottom;
                  const spaceAbove = coords.top;
                  const placeBelow = spaceBelow >= Math.min(panelH, 220) || spaceBelow >= spaceAbove;
                  if (placeBelow) {
                    return {
                      top: Math.min(coords.bottom + 10, window.innerHeight - panelH - pad),
                      transform: "translateX(-50%)",
                    } as React.CSSProperties;
                  }
                  return {
                    top: Math.max(pad, coords.top - 10 - Math.min(panelH, spaceAbove - 16)),
                    transform: "translateX(-50%)",
                  } as React.CSSProperties;
                })()}
              >
                <div className="flex justify-between items-start gap-3 mb-3 min-w-0">
                  <div className="min-w-0">
                    <span className="text-[8px] uppercase tracking-widest font-bold font-sans text-amber-600 dark:text-amber-400">Oxford Dictionary</span>
                    <h3 className="text-xl font-extrabold font-serif leading-tight mt-0.5 break-words">{dictionaryWord}</h3>
                  </div>
                  <button onClick={() => setDictionaryWord(null)} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {dictLoading ? (
                  <div className="flex items-center gap-2 py-4">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-sans">Looking up...</span>
                  </div>
                ) : dictionaryData ? (
                  <div className="space-y-3 max-h-[28vh] overflow-y-auto pr-1 custom-scrollbar">
                    {dictionaryData.phonetic && (
                      <p className="text-xs font-mono opacity-60 bg-current/5 px-2 py-1 rounded inline-block">{dictionaryData.phonetic}</p>
                    )}

                    {dictionaryData.origin && (
                      <div className="bg-neutral-500/5 p-3 rounded-xl border border-current/5">
                        <p className="text-[9px] uppercase font-bold tracking-widest opacity-40 mb-1 font-sans">Etymology / Origin</p>
                        <p className="text-xs leading-relaxed font-sans italic opacity-85">{dictionaryData.origin}</p>
                      </div>
                    )}

                    {dictionaryData.meanings.map((meaning: any, i: number) => (
                      <div key={i} className="space-y-2">
                        <p className="text-[9px] uppercase font-bold tracking-widest text-amber-600 dark:text-amber-400 font-sans">{meaning.partOfSpeech}</p>
                        <ul className="space-y-3">
                          {meaning.definitions.slice(0, 3).map((def: any, j: number) => (
                            <li key={j} className="text-xs leading-relaxed">
                              <span className="font-semibold opacity-40 mr-1.5 font-sans">{j + 1}.</span>
                              {def.definition}
                              {def.example && (
                                <p className="italic opacity-60 mt-1 pl-3 border-l border-current/15">"{def.example}"</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}

                    {dictionaryData.synonyms && dictionaryData.synonyms.length > 0 && (
                      <div className="pt-2 border-t border-current/5">
                        <p className="text-[9px] uppercase font-bold tracking-widest opacity-40 mb-1 font-sans">Synonyms</p>
                        <p className="text-xs font-sans opacity-80 leading-relaxed">{dictionaryData.synonyms.slice(0, 5).join(", ")}</p>
                      </div>
                    )}

                    {dictionaryData.antonyms && dictionaryData.antonyms.length > 0 && (
                      <div className="pt-2 border-t border-current/5">
                        <p className="text-[9px] uppercase font-bold tracking-widest opacity-40 mb-1 font-sans">Antonyms</p>
                        <p className="text-xs font-sans opacity-80 leading-relaxed">{dictionaryData.antonyms.slice(0, 5).join(", ")}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs opacity-60 py-4 font-sans">No definition found for "{dictionaryWord}".</p>
                )}
                
                {/* KOReader-style dictionary actions: Wikipedia, Search, Highlight, Close */}
                <div className="mt-5 pt-3 border-t border-current/10 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => window.open(`https://en.wikipedia.org/wiki/${encodeURIComponent(dictionaryWord || "")}`, "_blank")}
                    className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-current/15 text-[10px] font-bold uppercase tracking-widest hover:bg-current/5 transition min-w-0"
                    title="Open Wikipedia"
                  >
                    <Globe className="w-3.5 h-3.5 shrink-0" /> Wiki
                  </button>
                  <button
                    onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(dictionaryWord || "")}`, "_blank")}
                    className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-current/15 text-[10px] font-bold uppercase tracking-widest hover:bg-current/5 transition min-w-0"
                    title="Search the web"
                  >
                    <Search className="w-3.5 h-3.5 shrink-0" /> Search
                  </button>
                  <button
                    onClick={() => {
                      const text = selectedText || dictionaryWord || "";
                      if (text) {
                        addDictionaryEntry({
                          word: text.length > 30 ? text.slice(0, 30) + "..." : text,
                          definition: `Highlighted from '${book.title}': "${text}"`,
                          partOfSpeech: "highlight",
                          isCustom: true
                        });
                        setDictFeedback("Saved highlight to personal dictionary!");
                        setTimeout(() => setDictFeedback(null), 2500);
                      }
                      setDictionaryWord(null);
                    }}
                    className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-700 dark:text-yellow-300 border border-yellow-500/30 text-[10px] font-bold uppercase tracking-widest transition min-w-0"
                    title="Highlight selection"
                  >
                    <Highlighter className="w-3.5 h-3.5 shrink-0" /> Highlight
                  </button>
                  <button
                    onClick={() => setDictionaryWord(null)}
                    className="flex items-center justify-center px-2 py-2 rounded-lg bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-widest hover:opacity-80 transition min-w-0"
                    title="Close"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-4 border-[#5c5346] border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-sans animate-pulse opacity-75">Unzipping & loading ebook chapters...</p>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
              <div className="w-full bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-[2rem] p-8 md:p-10 shadow-xl flex flex-col items-center animate-in fade-in zoom-in-95 duration-500">
                <div className="w-20 h-20 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center mb-6 shadow-inner">
                  <AlertTriangle className="w-10 h-10 text-red-600 dark:text-red-400" />
                </div>
                
                <h2 className="text-xl md:text-2xl font-serif font-bold text-red-900 dark:text-red-100 mb-3">
                  Reader Initialization Failed
                </h2>
                
                <div className="bg-white/50 dark:bg-black/20 rounded-2xl p-4 mb-6 border border-red-200/50 dark:border-red-800/30 w-full">
                  <p className="text-xs md:text-sm text-red-700 dark:text-red-300 font-mono leading-relaxed break-words">
                    Error: {error}
                  </p>
                </div>

                <div className="space-y-4 text-left w-full">
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 font-medium px-1 uppercase tracking-widest opacity-70">
                    Troubleshooting Steps:
                  </p>
                  <ul className="grid grid-cols-1 gap-2.5">
                    {[
                      { icon: <RefreshCw className="w-3.5 h-3.5" />, text: "Try refreshing the page or restarting the reader." },
                      { icon: <Database className="w-3.5 h-3.5" />, text: "Clear local cache and re-download (mirror might have failed)." },
                      { icon: <FileText className="w-3.5 h-3.5" />, text: "Verify the file is a valid EPUB (not an HTML error page)." },
                      { icon: <Zap className="w-3.5 h-3.5" />, text: "Check if the file is DRM protected (which we cannot decrypt)." }
                    ].map((step, idx) => (
                      <li key={idx} className="flex items-start gap-3 p-3 bg-white/40 dark:bg-white/5 rounded-xl border border-white/60 dark:border-white/5 shadow-sm">
                        <span className="mt-0.5 text-red-500">{step.icon}</span>
                        <span className="text-[11px] md:text-xs text-red-900 dark:text-red-100 font-medium leading-snug">{step.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full mt-8">
                  <button 
                    onClick={loadEpubFile}
                    className="flex-1 px-6 py-3 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-all flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" /> Retry
                  </button>
                  <button 
                    onClick={async () => {
                      try {
                        await deleteBookFile(book.id);
                        onClose();
                      } catch (err) {
                        console.error("Failed to delete local cache", err);
                      }
                    }}
                    className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs font-bold uppercase tracking-widest shadow-lg shadow-red-600/20 transition-all flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" /> Reset & Close
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col relative overflow-hidden h-full">
              {/* Dict Saved Feedback Indicator */}
              {dictFeedback && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-emerald-950 text-emerald-100 border border-emerald-500/40 px-4 py-2 rounded-full text-xs font-sans flex items-center gap-2 shadow-lg animate-in fade-in slide-in-from-top-2 duration-250">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{dictFeedback}</span>
                </div>
              )}

              <div 
                ref={viewerRef}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onClick={() => {
                  if (showSettings) {
                    setShowSettings(false);
                  }
                }}
                className={`flex-1 min-h-0 w-full relative py-3 px-3 md:py-8 md:px-16 flex items-start justify-start mx-auto overflow-hidden ${
                  annotateMode
                    ? "select-text cursor-text"
                    : "select-none cursor-default"
                } ${useDoubleColumns ? "max-w-[95%] xl:max-w-7xl px-4 md:px-8" : marginSize}`}
              >
                <div
                  ref={pageCanvasRef}
                  className={`w-full h-full relative kora-page-canvas ${
                    useScrollLayout
                      ? "overflow-y-auto overflow-x-hidden overscroll-y-contain flex items-start justify-start"
                      : useDoubleColumns
                        ? "overflow-hidden overscroll-none block"
                        : "overflow-y-auto overflow-x-hidden overscroll-none block"
                  }`}
                  style={
                    !useScrollLayout
                      ? {
                          scrollbarWidth: "none",
                          msOverflowStyle: "none",
                          overscrollBehavior: "none",
                          // Programmatic paging only — don't let touch pans free-scroll.
                          touchAction: annotateMode ? "auto" : "manipulation",
                        }
                      : undefined
                  }
                >
                  {/* Turn.js style 3D page flip transition — decorative only; never blocks reading */}
                  {!useScrollLayout && effectivePageTransition === "paper-flip" && shouldAnimate && isTurningPage && !prefersReducedMotion && (
                    <div 
                      className="absolute inset-0 pointer-events-none z-40 overflow-hidden"
                      aria-hidden
                      style={{ perspective: "2500px" }}
                    >
                      <motion.div
                        key={`page-turn-${turningChapterIdx}-${turningPageNum}-${currentPageNum}`}
                        initial={{ rotateY: 0 }}
                        animate={{ rotateY: turnDirection === "next" ? -180 : 180 }}
                        transition={{ type: "spring", stiffness: 180, damping: 22, mass: 0.9 }}
                        onAnimationComplete={() => setIsTurningPage(false)}
                        onAnimationStart={() => {
                          // Keep underlying page visible — overlay is decorative only
                        }}
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: useDoubleColumns 
                            ? (turnDirection === "next" ? "calc(50% + 20px)" : "0")
                            : "0",
                          width: useDoubleColumns ? `${(containerWidth - 40) / 2}px` : "100%",
                          transformOrigin: useDoubleColumns
                            ? (turnDirection === "next" ? "left center" : "right center")
                            : "left center",
                          transformStyle: "preserve-3d",
                          willChange: "transform",
                          pointerEvents: "none",
                        }}
                      >
                        {/* Front Face: Old Page */}
                        <div
                          className={`absolute inset-0 overflow-hidden rounded-md ${activeTheme.bg} ${activeTheme.text}`}
                          style={{
                            backfaceVisibility: "hidden",
                            transform: "rotateY(0deg)",
                            borderLeft: useDoubleColumns && turnDirection === "next" ? `1px solid ${activeTheme.border.replace('border-', '') || 'rgba(0,0,0,0.1)'}` : "none",
                            borderRight: useDoubleColumns && turnDirection === "prev" ? `1px solid ${activeTheme.border.replace('border-', '') || 'rgba(0,0,0,0.1)'}` : "none",
                            boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
                          }}
                        >
                          <div
                            className={`ml-0 ${fontFamily} ${letterSpacing} ${hyphenation ? "hyphens-auto text-justify" : "hyphens-none text-left"}`}
                            style={{
                              fontSize: `${fontSize}px`,
                              lineHeight: lineSpacing,
                              width: useDoubleColumns ? `${containerWidth}px` : "100%",
                              maxWidth: "none",
                              columnWidth: `${useDoubleColumns ? (containerWidth - columnGapPx) / 2 : containerWidth}px`,
                              columnGap: `${columnGapPx}px`,
                              height: "100%",
                              columnFill: "auto",
                              overflow: "visible",
                              transform: `translateX(-${(turningPageNum - 1) * pageStep + (useDoubleColumns ? ((containerWidth - 40) / 2 + 40) : 0)}px)`,
                              paddingTop: "12px",
                              paddingBottom: "12px",
                            }}
                          >
                            <div className={`mb-6 border-b ${activeTheme.border} pb-4`}>
                              <span className="text-[10px] uppercase font-mono opacity-60 tracking-wider">
                                Chapter {turningChapterIdx + 1} of {chapters.length}
                              </span>
                              <h2 className="font-serif font-bold text-2xl mt-1 leading-tight tracking-tight">
                                {chapters[turningChapterIdx]?.title}
                              </h2>
                            </div>
                            <div 
                              className={`epub-content reader-select-surface leading-relaxed space-y-5 ${fontFamily} break-words`}
                              dangerouslySetInnerHTML={{ __html: chapters[turningChapterIdx]?.content || "" }}
                              onClick={handleEpubContentClick}
                            />
                          </div>
                          {/* Page curl edge shader */}
                          <motion.div
                            className="absolute inset-y-0 pointer-events-none"
                            style={{
                              width: "28%",
                              [turnDirection === "next" ? "right" : "left"]: 0,
                              background: turnDirection === "next"
                                ? "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0.22) 100%)"
                                : "linear-gradient(270deg, transparent 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0.22) 100%)",
                              clipPath: turnDirection === "next"
                                ? "polygon(0 0, 100% 8%, 100% 92%, 0 100%)"
                                : "polygon(0 8%, 100% 0, 100% 100%, 0 92%)",
                            }}
                            animate={{ opacity: [0, 0.5, 0.15] }}
                            transition={{ type: "spring", stiffness: 180, damping: 22 }}
                          />
                          {/* Shading / Shadow Overlay during curl fold */}
                          <motion.div
                            className="absolute inset-0 pointer-events-none bg-gradient-to-r from-black/12 via-transparent to-black/4"
                            animate={{ opacity: [0, 0.22, 0.06] }}
                            transition={{ type: "spring", stiffness: 180, damping: 22 }}
                          />
                        </div>

                        {/* Back Face: New Page */}
                        <div
                          className={`absolute inset-0 overflow-hidden rounded-md ${activeTheme.bg} ${activeTheme.text}`}
                          style={{
                            backfaceVisibility: "hidden",
                            transform: "rotateY(180deg)",
                            borderLeft: useDoubleColumns && turnDirection === "prev" ? `1px solid ${activeTheme.border.replace('border-', '') || 'rgba(0,0,0,0.1)'}` : "none",
                            borderRight: useDoubleColumns && turnDirection === "next" ? `1px solid ${activeTheme.border.replace('border-', '') || 'rgba(0,0,0,0.1)'}` : "none",
                            boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
                          }}
                        >
                          <div
                            className={`ml-0 ${fontFamily} ${letterSpacing} ${hyphenation ? "hyphens-auto text-justify" : "hyphens-none text-left"}`}
                            style={{
                              fontSize: `${fontSize}px`,
                              lineHeight: lineSpacing,
                              width: useDoubleColumns ? `${containerWidth}px` : "100%",
                              maxWidth: "none",
                              columnWidth: `${useDoubleColumns ? (containerWidth - columnGapPx) / 2 : containerWidth}px`,
                              columnGap: `${columnGapPx}px`,
                              height: "100%",
                              columnFill: "auto",
                              overflow: "visible",
                              transform: `translateX(-${
                                useDoubleColumns && turnDirection === "prev"
                                  ? (currentPageNum - 1) * pageStep + ((containerWidth - 40) / 2 + 40)
                                  : (currentPageNum - 1) * pageStep
                              }px)`,
                              paddingTop: "12px",
                              paddingBottom: "12px",
                            }}
                          >
                            <div className={`mb-6 border-b ${activeTheme.border} pb-4`}>
                              <span className="text-[10px] uppercase font-mono opacity-60 tracking-wider">
                                Chapter {currentChapterIdx + 1} of {chapters.length}
                              </span>
                              <h2 className="font-serif font-bold text-2xl mt-1 leading-tight tracking-tight">
                                {chapters[currentChapterIdx]?.title}
                              </h2>
                            </div>
                            <div 
                              className={`epub-content reader-select-surface leading-relaxed space-y-5 ${fontFamily} break-words`}
                              dangerouslySetInnerHTML={{ __html: chapterHtmlWithHighlights }}
                              onClick={handleEpubContentClick}
                            />
                          </div>
                          {/* Shading / Shadow Overlay during curl fold */}
                          <motion.div
                            className="absolute inset-0 pointer-events-none bg-gradient-to-r from-black/15 via-transparent to-black/30"
                            animate={{ opacity: [0.15, 0.45, 0] }}
                            transition={{ duration: 0.8 }}
                          />
                        </div>
                      </motion.div>
                    </div>
                  )}

                  {/* Visual page slide feedback */}
                  <AnimatePresence>
                    {tapFeedback && (
                      <motion.div
                        key={tapFeedback}
                        initial={{ opacity: 0, x: tapFeedback === "next" ? 120 : -120 }}
                        animate={{ opacity: 0.15, x: 0 }}
                        exit={{ opacity: 0, x: tapFeedback === "next" ? -60 : 60 }}
                        transition={{ duration: 0.35, ease: "easeOut" }}
                        className={`absolute inset-y-0 pointer-events-none ${
                          tapFeedback === "next" ? "right-0" : "left-0"
                        } w-1/4 pointer-events-none z-10 bg-gradient-to-r ${
                          tapFeedback === "next" 
                            ? "from-transparent to-current" 
                            : "from-current to-transparent"
                        }`}
                        style={{ opacity: 0.05 }}
                      />
                    )}
                  </AnimatePresence>
                  {/*
                    Single-column paged: vertical sliding window (supports page overlap).
                    Dual-column: CSS columns + horizontal scrollLeft.
                  */}
                  {!useScrollLayout && !useDoubleColumns && pageOverlap > 0 && currentPageNum > 1 ? (
                    <div className="sticky top-0 h-0 z-20 pointer-events-none" aria-hidden>
                      <div
                        className="absolute left-0 right-0 top-0 border-b border-current/25"
                        style={{
                          height: Math.min(
                            pageOverlap,
                            Math.floor((pageViewportHeight || 0) / 3) || pageOverlap,
                          ),
                          background:
                            "linear-gradient(to bottom, color-mix(in srgb, currentColor 10%, transparent), transparent)",
                        }}
                      />
                    </div>
                  ) : null}
                  <article 
                    ref={contentRef}
                    className={`w-full ml-0 kora-paged-article ${fontFamily} ${letterSpacing} ${hyphenation ? "hyphens-auto text-justify" : "hyphens-none text-left"} selection:bg-kindle-accent/20 selection:text-kindle-text ${grayscaleImages ? "[&_img]:grayscale" : ""} ${hideImages ? "[&_img]:hidden [&_image]:hidden" : ""} [&_img]:select-none [&_img]:pointer-events-none [&_image]:select-none [&_image]:pointer-events-none ${
                      annotateMode ? "select-text cursor-text" : "select-none"
                    }`}
                    style={{
                      fontSize: `${fontSize}px`,
                      lineHeight: lineSpacing,
                      WebkitUserSelect: annotateMode ? "text" : "none",
                      userSelect: annotateMode ? "text" : "none",
                      WebkitTouchCallout: annotateMode ? "default" : "none",
                      touchAction: annotateMode ? "auto" : useScrollLayout ? "pan-y" : swipeToTurn ? "pan-x" : "manipulation",
                      visibility: "visible",
                      color: "inherit",
                      ...(useScrollLayout
                        ? {
                            height: "auto",
                            minHeight: "100%",
                            overflow: "visible",
                          }
                        : useDoubleColumns
                          ? {
                              width: `${Math.max(1, containerWidth)}px`,
                              maxWidth: `${Math.max(1, containerWidth)}px`,
                              height: pageViewportHeight > 0 ? `${pageViewportHeight}px` : "100%",
                              columnWidth: `${Math.max(1, Math.floor((containerWidth - columnGapPx) / 2))}px`,
                              columnGap: `${columnGapPx}px`,
                              columnFill: "auto",
                              overflowX: "auto",
                              overflowY: "hidden",
                              WebkitOverflowScrolling: "auto",
                              scrollbarWidth: "none",
                              msOverflowStyle: "none",
                              boxShadow: "inset 50% 0 0 -20px rgba(0,0,0,0.10)",
                            }
                          : {
                              width: `${Math.max(1, containerWidth)}px`,
                              maxWidth: `${Math.max(1, containerWidth)}px`,
                              height: "auto",
                              overflow: "visible",
                            }),
                    } as React.CSSProperties}
                  >
                    <div className={`mb-6 border-b ${activeTheme.border} pb-4`}>
                      <span className="text-[10px] uppercase font-mono opacity-60 tracking-wider">
                        Chapter {currentChapterIdx + 1} of {chapters.length}
                      </span>
                      <h2 className="font-serif font-bold text-2xl mt-1 leading-tight tracking-tight">
                        {chapters[currentChapterIdx]?.title}
                      </h2>
                    </div>

                    {/* EPUB HTML Content Injection */}
                    <div 
                      id="epub-text-viewer"
                      className={`epub-content reader-select-surface leading-relaxed ${fontFamily} break-words ${showAudiobook ? "cursor-pointer" : ""}`}
                      dangerouslySetInnerHTML={{ __html: chapterHtmlWithHighlights }}
                      onClick={handleEpubContentClick}
                    />

                    {useScrollLayout && (
                      <div
                        className={`mt-16 pt-6 pb-8 border-t flex justify-between items-center gap-3 text-[10px] font-sans opacity-55 ${activeTheme.border} ${activeTheme.text}`}
                      >
                        <span className="truncate">End of {chapters[currentChapterIdx]?.title}</span>
                        <span className="shrink-0">
                          {Math.round(((currentChapterIdx + 1) / Math.max(1, chapters.length)) * 100)}% read
                        </span>
                      </div>
                    )}
                  </article>
                </div>

                {showWalkthroughEndCtas && (
                  <div
                    className={`absolute left-3 right-3 md:left-8 md:right-8 z-30 flex flex-col gap-2 ${
                      useScrollLayout ? "bottom-20 md:bottom-24" : "bottom-20 md:bottom-24"
                    }`}
                  >
                    <div
                      className={`rounded-2xl border px-3 py-3 shadow-lg backdrop-blur-sm ${activeTheme.card} ${activeTheme.border} ${activeTheme.text}`}
                    >
                      <p className="text-[11px] font-sans opacity-70 mb-2">
                        End of Getting started — scroll the last chapter for terms and next steps.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-full px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-white bg-kindle-accent"
                          onClick={() => {
                            completeGuide("walkthrough-book");
                            emitWalkthroughBookCta("first-book");
                          }}
                        >
                          Download your first book
                        </button>
                        <button
                          type="button"
                          className={`rounded-full border px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider ${activeTheme.border}`}
                          onClick={() => {
                            completeGuide("walkthrough-book");
                            emitWalkthroughBookCta("more-guides");
                          }}
                        >
                          Lounge guides
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* External Link Intercept Dialog */}
                {externalLinkToOpen && (
                  <div className="absolute inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm bg-black/60 animate-in fade-in duration-200">
                    <div className={`relative w-full max-w-md p-6 ${activeTheme.card} ${activeTheme.text} border ${activeTheme.border} rounded-2xl shadow-2xl flex flex-col space-y-4 animate-in zoom-in-95 duration-250 text-left`}>
                      <div className="flex items-start gap-3">
                        <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                          <Globe className="w-6 h-6 animate-pulse" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base font-bold font-sans tracking-tight">External Link Intercepted</h3>
                          <p className="text-xs opacity-60 font-sans mt-0.5">To prevent accidental navigation while reading, we have blocked direct redirection.</p>
                        </div>
                      </div>

                      <div className="bg-current/[0.03] border border-current/10 p-3 rounded-xl font-mono text-xs break-all select-all select-text flex items-center gap-2">
                        <span className="opacity-80 flex-1">{externalLinkToOpen}</span>
                      </div>

                      <p className="text-xs opacity-85 leading-relaxed font-sans">
                        Would you like to open this website in a new browser tab?
                      </p>

                      <div className="flex items-center gap-3 pt-2">
                        <button
                          onClick={() => setExternalLinkToOpen(null)}
                          className="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest rounded-xl border border-current/20 hover:bg-current/5 transition"
                        >
                          Cancel
                        </button>
                        <a
                          href={externalLinkToOpen}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setExternalLinkToOpen(null)}
                          className="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-center rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition shadow-sm font-sans"
                        >
                          Open Site
                        </a>
                      </div>
                    </div>
                  </div>
                )}

                {/* Offline Selection Analyzer Sheet */}
                {showAnalyzer && (
                  <div className="absolute inset-0 z-[80] flex items-end justify-center p-0 md:p-6 animate-in fade-in duration-200">
                    <div className="absolute inset-0 bg-black/60" onClick={() => setShowAnalyzer(false)} />
                    <div className={`relative w-full md:max-w-2xl h-[75vh] md:h-auto md:max-h-[85vh] ${activeTheme.card} ${activeTheme.text} border-t md:border ${activeTheme.border} rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300`}>
                      
                      {/* Panel Header */}
                      <div className="px-6 py-4 border-b border-current/10 flex justify-between items-center bg-current/[0.02]">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-5 h-5 text-amber-500 animate-pulse" />
                          <div>
                            <h3 className="text-sm font-black uppercase tracking-widest font-sans">Offline Selection Analyzer</h3>
                            <p className="text-[10px] opacity-50 font-sans">100% offline dictionary & stats breakdown</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => setShowAnalyzer(false)} 
                          className="p-2 hover:bg-current/5 rounded-xl transition"
                          title="Close Analyzer"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar text-left">
                        {/* 1. Selected passage display with clickable words */}
                        <div className="space-y-2">
                          <p className="text-[9px] uppercase font-bold tracking-widest opacity-40 font-sans">Selected Passage (Tap any word to look up definition)</p>
                          <div className="bg-current/[0.03] border border-current/10 p-5 rounded-2xl">
                            <p className="text-sm leading-relaxed font-serif italic text-center md:text-left flex flex-wrap gap-x-1.5 gap-y-1 justify-center md:justify-start">
                              {analyzedText.split(/\s+/).map((word, idx) => {
                                const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'“”—]/g, "");
                                return (
                                  <button
                                    key={idx}
                                    onClick={async () => {
                                      const entry = await lookupWord(cleanWord);
                                      if (entry) {
                                        setActiveWordDefinition(entry);
                                      } else {
                                        setActiveWordDefinition({
                                          word: cleanWord,
                                          definition: "No offline definition found in StarDict dictionary. Save custom entry to add it!",
                                          partOfSpeech: "unknown"
                                        });
                                      }
                                    }}
                                    className="hover:bg-amber-500/20 hover:text-amber-600 dark:hover:text-amber-400 px-1 rounded transition duration-150 border-b border-dashed border-current/20 hover:border-transparent font-medium font-serif"
                                  >
                                    {word}
                                  </button>
                                );
                              })}
                            </p>
                          </div>
                        </div>

                        {/* 2. Focused Word Definition Area */}
                        {activeWordDefinition && (
                          <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl animate-in zoom-in-95 duration-150 relative">
                            <button 
                              onClick={() => setActiveWordDefinition(null)}
                              className="absolute top-2 right-2 p-1 text-xs opacity-50 hover:opacity-100"
                              title="Dismiss"
                            >
                              ✕
                            </button>
                            <span className="text-[8px] uppercase tracking-widest font-bold text-amber-600 dark:text-amber-400 font-sans">Quick Offline Lookup</span>
                            <div className="flex items-baseline gap-2 mt-0.5 mb-1.5">
                              <h4 className="text-base font-extrabold font-serif">{activeWordDefinition.word}</h4>
                              {activeWordDefinition.partOfSpeech && (
                                <span className="text-[10px] italic opacity-60 font-mono">({activeWordDefinition.partOfSpeech})</span>
                              )}
                            </div>
                            <p className="text-xs leading-relaxed font-sans opacity-85">{activeWordDefinition.definition}</p>
                            {activeWordDefinition.example && (
                              <p className="text-[11px] italic opacity-60 mt-1 border-l-2 border-amber-500/30 pl-3 font-sans">"{activeWordDefinition.example}"</p>
                            )}
                          </div>
                        )}

                        {/* 3. Text statistics metrics */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="bg-current/[0.02] border border-current/5 p-3 rounded-xl text-center">
                            <p className="text-[9px] uppercase font-bold tracking-widest opacity-40 font-sans">Words</p>
                            <p className="text-lg font-black font-mono mt-0.5">{analyzedText.split(/\s+/).filter(Boolean).length}</p>
                          </div>
                          <div className="bg-current/[0.02] border border-current/5 p-3 rounded-xl text-center">
                            <p className="text-[9px] uppercase font-bold tracking-widest opacity-40 font-sans">Characters</p>
                            <p className="text-lg font-black font-mono mt-0.5">{analyzedText.length}</p>
                          </div>
                          <div className="bg-current/[0.02] border border-current/5 p-3 rounded-xl text-center">
                            <p className="text-[9px] uppercase font-bold tracking-widest opacity-40 font-sans">Est. Reading</p>
                            <p className="text-xs font-bold font-sans mt-2">
                              {Math.max(1, Math.round(analyzedText.split(/\s+/).length / 3))} seconds
                            </p>
                          </div>
                          <div className="bg-current/[0.02] border border-current/5 p-3 rounded-xl text-center">
                            <p className="text-[9px] uppercase font-bold tracking-widest opacity-40 font-sans">Complexity</p>
                            <p className="text-xs font-bold font-sans mt-2">
                              {analyzedText.split(/\s+/).length > 15 ? "Moderate" : "Simple"}
                            </p>
                          </div>
                        </div>

                        {/* 4. Vocabulary Breakdown */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[9px] uppercase font-bold tracking-widest opacity-40 font-sans">Vocabulary Key Terms ({vocabBreakdown.length})</p>
                            <span className="text-[8px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest font-sans">Matched StarDict Dictionaries</span>
                          </div>

                          {isAnalyzing ? (
                            <div className="flex items-center justify-center py-8 gap-2">
                              <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                              <span className="text-xs font-sans opacity-60">Scanning sentence terms...</span>
                            </div>
                          ) : vocabBreakdown.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {vocabBreakdown.map(({ word, entry }, index) => (
                                <div 
                                  key={index}
                                  onClick={() => setActiveWordDefinition(entry)}
                                  className="bg-current/[0.02] hover:bg-current/[0.04] border border-current/5 hover:border-current/10 p-4 rounded-xl cursor-pointer transition duration-150 group"
                                >
                                  <div className="flex justify-between items-start">
                                    <h5 className="font-extrabold font-serif text-sm group-hover:text-amber-500 transition">{word}</h5>
                                    {entry.partOfSpeech && (
                                      <span className="text-[9px] font-mono px-1.5 py-0.5 bg-current/5 rounded uppercase opacity-60">{entry.partOfSpeech}</span>
                                    )}
                                  </div>
                                  <p className="text-[11px] leading-relaxed mt-1.5 opacity-80 line-clamp-3 font-sans text-left">{entry.definition}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="bg-current/[0.01] border border-current/5 p-8 rounded-2xl text-center">
                              <p className="text-xs opacity-50 font-sans">No complex vocabulary terms found in StarDict dictionary matching this passage.</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Panel Footer */}
                      <div className="px-6 py-4 border-t border-current/10 flex justify-between gap-3 bg-current/[0.01]">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(analyzedText);
                            setDictFeedback("Copied passage!");
                            setTimeout(() => setDictFeedback(null), 2000);
                          }}
                          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-current/15 text-xs font-bold uppercase tracking-widest hover:bg-current/5 transition font-sans"
                        >
                          <Copy className="w-4 h-4" /> Copy Passage
                        </button>
                        <button
                          onClick={() => setShowAnalyzer(false)}
                          className="flex-1 py-3 px-4 rounded-xl bg-kindle-text text-kindle-bg hover:opacity-90 font-bold uppercase tracking-widest text-xs transition font-sans"
                        >
                          Done Analyzing
                        </button>
                      </div>

                    </div>
                  </div>
                )}
              </div>



              {/* Footer Chapter Navigate Buttons */}
              <footer
                className={`px-4 sm:px-6 pt-3 pb-3 border-t ${activeTheme.border} flex items-center justify-between gap-2 font-sans shrink-0`}
              >
                {!(pageTurnMode === "fifty-fifty" || pageTurnMode === "classic-ereader" || pageTurnMode === "margins-only") ? (
                  <button
                    id="prev-chapter-btn"
                    disabled={currentChapterIdx === 0 && currentPageNum === 1}
                    onClick={handlePrevPage}
                    className={`flex items-center justify-center w-11 h-11 shrink-0 rounded-full shadow-sm border backdrop-blur-xs transition-all duration-200 ${
                      theme === "dark"
                        ? "bg-neutral-900/60 text-white border-white/10 hover:bg-neutral-800"
                        : "bg-white text-neutral-800 border-neutral-200 hover:bg-neutral-50"
                    } disabled:opacity-30`}
                    title="Previous Page"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                ) : (
                  <div className="w-11 shrink-0 hidden sm:block" />
                )}

                <div className="flex flex-col items-center min-w-0 flex-1 max-w-md px-1 sm:px-2">
                  <label className="sr-only" htmlFor="reader-progress-scrubber">Reading progress</label>
                  <input
                    id="reader-progress-scrubber"
                    type="range"
                    min={0}
                    max={1000}
                    value={Math.round(
                      Math.min(
                        1000,
                        Math.max(
                          0,
                          ((currentChapterIdx + (currentPageNum - 1) / Math.max(1, totalPages)) /
                            Math.max(1, chapters.length)) *
                            1000
                        )
                      )
                    )}
                    onChange={(e) => scrubToPercent((parseInt(e.target.value, 10) / 1000) * 100)}
                    className="w-full max-w-xs accent-kindle-accent h-1.5 bg-neutral-200 rounded-full appearance-none cursor-pointer"
                    aria-valuetext={timeLeftLabel}
                  />
                  {!useScrollLayout && currentPageNum >= totalPages ? (
                    <span className="text-[9px] sm:text-[10px] font-mono tracking-wide opacity-60 mt-1 text-center leading-snug max-w-full truncate px-1">
                      End of {chapters[currentChapterIdx]?.title}
                      {" · "}
                      {Math.round(
                        ((currentChapterIdx + 1) / Math.max(1, chapters.length)) * 100
                      )}
                      % read
                    </span>
                  ) : null}
                  <span className="text-[10px] sm:text-[11px] font-bold font-mono tracking-wide text-kindle-text opacity-90 mt-1.5 text-center leading-snug">
                    {useScrollLayout
                      ? `chapter ${currentChapterIdx + 1} of ${chapters.length} • ${Math.min(100, Math.max(0, Math.round(((currentChapterIdx + 1) / (chapters.length || 1)) * 100)))}%`
                      : `page ${currentPageNum} of ${totalPages} (Ch. ${currentChapterIdx + 1}) • ${Math.min(100, Math.max(0, Math.round(
                    ((currentChapterIdx + (currentPageNum - 1) / (totalPages || 1)) / (chapters.length || 1)) * 100
                  )))}%`}
                    {timeLeftLabel ? ` · ${timeLeftLabel}` : ""}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setDoubleColumns(!doubleColumns)}
                    className={`hidden md:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition shrink-0 ${
                      doubleColumns
                        ? theme === "dark"
                          ? "bg-white text-neutral-950 border-transparent"
                          : "bg-neutral-900 text-white border-transparent"
                        : theme === "dark"
                          ? "bg-white/10 text-white border-white/25 hover:bg-white/15"
                          : "bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-50"
                    }`}
                    title="Toggle two-column spread (KOReader style)"
                    aria-pressed={doubleColumns}
                  >
                    <Layout className="w-3.5 h-3.5 shrink-0" />
                    <span>2-Page</span>
                  </button>

                  {!(pageTurnMode === "fifty-fifty" || pageTurnMode === "classic-ereader" || pageTurnMode === "margins-only") && (
                    <button
                      id="next-chapter-btn"
                      disabled={currentChapterIdx === chapters.length - 1 && currentPageNum === totalPages}
                      onClick={handleNextPage}
                      className={`flex items-center justify-center w-11 h-11 shrink-0 rounded-full shadow-sm border backdrop-blur-xs transition-all duration-200 ${
                        theme === "dark"
                          ? "bg-neutral-900/60 text-white border-white/10 hover:bg-neutral-800"
                          : "bg-neutral-900 text-white border-neutral-800 hover:bg-neutral-800"
                      } disabled:opacity-30`}
                      title="Next Page"
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </footer>
            </div>
          )}
        </main>

        <ReaderPetCompanion
          enabled={petEnabled && !loading && !error}
          petId={petId}
          pageText={petPageText}
          pageSignal={petPageSignal}
        />
      </div>

      {/* Kindle-Style Selection Pin Handles rendered at top level to avoid overflow clipping and CSS transform offsets */}
      {selectedText && selectionPins.start && (
        <div 
          data-kora-selection-ui
          className="fixed bg-[#3390ff] z-[9999] pointer-events-none transition-all duration-75"
          style={{
            left: `${selectionPins.start.x}px`,
            top: `${selectionPins.start.y - 4}px`,
            width: "3px",
            height: `${selectionPins.start.height + 4}px`
          }}
        >
          {/* Start Pin Handle with Enlarged Touch/Pointer Target */}
          <div 
            data-kora-selection-ui
            onPointerDown={(e) => handlePinDragStart(e, 'start')}
            onPointerMove={handlePinDragMove}
            onPointerUp={handlePinDragEnd}
            onPointerCancel={handlePinDragEnd}
            className="absolute -top-6 -left-5 w-10 h-10 flex items-center justify-center pointer-events-auto cursor-col-resize active:scale-110 transition-transform"
            style={{ touchAction: "none" }}
            title="Drag to adjust start"
          >
            {/* Visual Teardrop/Balloon Pin resembling Kindle/iOS/Android select pin */}
            <div className="w-4 h-4 rounded-full rounded-tr-none bg-[#3390ff] shadow-lg border-2 border-white dark:border-neutral-900 rotate-45 transform" />
          </div>
        </div>
      )}
      {selectedText && selectionPins.end && (
        <div 
          data-kora-selection-ui
          className="fixed bg-[#3390ff] z-[9999] pointer-events-none transition-all duration-75"
          style={{
            left: `${selectionPins.end.x}px`,
            top: `${selectionPins.end.y}px`,
            width: "3px",
            height: `${selectionPins.end.height + 4}px`
          }}
        >
          {/* End Pin Handle with Enlarged Touch/Pointer Target */}
          <div 
            data-kora-selection-ui
            onPointerDown={(e) => handlePinDragStart(e, 'end')}
            onPointerMove={handlePinDragMove}
            onPointerUp={handlePinDragEnd}
            onPointerCancel={handlePinDragEnd}
            className="absolute -bottom-6 -left-5 w-10 h-10 flex items-center justify-center pointer-events-auto cursor-col-resize active:scale-110 transition-transform"
            style={{ touchAction: "none" }}
            title="Drag to adjust end"
          >
            {/* Visual Teardrop/Balloon Pin resembling Kindle/iOS/Android select pin */}
            <div className="w-4 h-4 rounded-full rounded-bl-none bg-[#3390ff] shadow-lg border-2 border-white dark:border-neutral-900 -rotate-45 transform" />
          </div>
        </div>
      )}

      {/* Native-style floating selection menu */}
      {selectedText && selectionCoords && !isDraggingSelection && (() => {
        const preferTop = selectionCoords.bottom > window.innerHeight * 0.62;
        const pos = clampSelectionMenuPosition(
          selectionCoords.x,
          preferTop,
          selectionCoords.top,
          selectionCoords.bottom
        );
        return (
        <div
          data-kora-selection-ui
          className="fixed z-[9999] max-w-[min(96vw,24rem)] animate-in fade-in zoom-in-95 duration-150"
          style={{
            left: `${pos.left}px`,
            top: `${pos.top}px`,
            transform: pos.transform,
            boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="rounded-2xl border border-neutral-700/80 bg-[#1a1816]/96 backdrop-blur-xl text-white overflow-hidden">
            {(selectionDictPreview || selectionDictLoading) && (
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => lookupDictionary(selectionDictPreview?.word || extractLookupWord(selectedText))}
                className="w-full text-left px-3.5 py-2.5 border-b border-neutral-800/80 hover:bg-white/5 transition"
              >
                {selectionDictLoading ? (
                  <p className="text-[11px] text-neutral-400 font-sans">Looking up definition…</p>
                ) : selectionDictPreview ? (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-bold font-serif text-amber-300">{selectionDictPreview.word}</span>
                      {selectionDictPreview.phonetic && (
                        <span className="text-[10px] font-mono text-neutral-400">{selectionDictPreview.phonetic}</span>
                      )}
                    </div>
                    {selectionDictPreview.definition && (
                      <p className="text-[11px] text-neutral-300 leading-snug mt-1 line-clamp-2 font-sans">
                        {selectionDictPreview.definition}
                      </p>
                    )}
                  </>
                ) : null}
              </button>
            )}

            <div className="flex items-center gap-0.5 p-1.5">
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => lookupDictionary(selectionDictPreview?.word || extractLookupWord(selectedText) || selectedText)}
                className="flex-1 min-w-[4.5rem] flex flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-xl bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 active:scale-[0.98] transition"
                title="Dictionary"
              >
                <BookOpen className="w-5 h-5" />
                <span className="text-[10px] font-bold uppercase tracking-wide font-sans">Dictionary</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void handleSaveHighlight("yellow")}
                className="flex-1 min-w-[4.5rem] flex flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-xl hover:bg-white/10 active:scale-[0.98] transition text-neutral-200"
                title="Highlight selection"
              >
                <Highlighter className="w-5 h-5" />
                <span className="text-[10px] font-bold uppercase tracking-wide font-sans">Highlight</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAddSelectionToNote}
                className="flex-1 min-w-[4.5rem] flex flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-xl hover:bg-white/10 active:scale-[0.98] transition text-neutral-200"
                title="Add to note"
              >
                <FileText className="w-5 h-5" />
                <span className="text-[10px] font-bold uppercase tracking-wide font-sans">Note</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const q = selectedText;
                  openWebSearch(q);
                  dismissSelection();
                }}
                className="flex-1 min-w-[4.5rem] flex flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-xl hover:bg-white/10 active:scale-[0.98] transition text-neutral-200"
                title="Search on web"
              >
                <Search className="w-5 h-5" />
                <span className="text-[10px] font-bold uppercase tracking-wide font-sans">Web</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={dismissSelection}
                className="w-9 h-full flex items-center justify-center rounded-xl text-neutral-500 hover:text-white hover:bg-white/5 transition"
                title="Clear selection"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-center gap-3 px-3 py-2.5 border-t border-neutral-800/80">
              {(["yellow", "green", "blue", "pink"] as const).map((color) => {
                const colorClasses = {
                  yellow: "bg-yellow-400",
                  green: "bg-emerald-400",
                  blue: "bg-sky-400",
                  pink: "bg-pink-400",
                };
                return (
                  <button
                    key={color}
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void handleSaveHighlight(color)}
                    className={`w-8 h-8 rounded-full border-2 border-white/20 shadow-md active:scale-110 transition ${colorClasses[color]}`}
                    title={`Highlight ${color}`}
                    aria-label={`Highlight ${color}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
