import React, { useState, useEffect, useRef, useCallback } from "react";
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
  getEffectiveSpeechRate,
  getSpeechVoices,
  getTtsSettings,
  resolveSpeechVoice,
  saveTtsSettings,
  subscribeToVoicesChanged,
} from "../lib/ttsSettings";
import { prepareTextForNarration } from "../lib/ttsTextPrep";
import { runOfflineCompanion } from "../lib/offlineAssistant";
import { X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Menu, Settings, BookOpen, Sparkles, CircleAlert as AlertCircle, AlertTriangle, RefreshCw, Database, Zap, Type, LayoutGrid as Layout, Info, Globe, Search, Headphones, Play, Pause, RotateCcw, Volume2, FastForward, Rewind, BookMarked, Copy, Check, FileText, Highlighter, Trash2, MoreHorizontal } from "lucide-react";
import { lookupWord, addDictionaryEntry } from "../lib/dictionary";
import { playFlipSound, playBookOpenSound } from "../lib/sounds";

function extractLookupWord(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const words = trimmed.split(/\s+/).filter(Boolean);
  const candidate = words.length === 1 ? words[0] : words[0];
  return candidate.replace(/^[^a-zA-Z0-9'-]+|[^a-zA-Z0-9'-]+$/g, "");
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
  };
  onReaderPrefsChange?: (prefs: any) => void;
}

interface EpubChapter {
  id: string;
  href: string;
  title: string;
  content: string;
  fullPath: string;
}

export default function BookReaderEPUB({ book, userId, onClose, onProgressUpdate, readerPrefs, onReaderPrefsChange }: BookReaderEPUBProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  const [currentChapterIdx, setCurrentChapterIdx] = useState<number>(0);
  
  // Customization states (seeded from persisted settings, fallback to defaults)
  const [fontSize, setFontSize] = useState<number>(readerPrefs?.fontSize ?? 18); // px
  const [fontFamily, setFontFamily] = useState<string>(readerPrefs?.fontFamily ?? "font-serif");
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
  const [pageStep, setPageStep] = useState<number>(600);
  const pageStepRef = React.useRef<number>(600);
  const [doubleColumns, setDoubleColumns] = useState<boolean>(readerPrefs?.doubleColumns ?? false); // Dual page mode
  const [pageOverlap, setPageOverlap] = useState<number>(readerPrefs?.pageOverlap ?? 0); // KOReader-style page overlap (px repeated across page turns)
  const [letterSpacing, setLetterSpacing] = useState<string>(readerPrefs?.letterSpacing ?? "tracking-normal"); // tracking-normal, tracking-wide, tracking-wider
  const [hyphenation, setHyphenation] = useState<boolean>(readerPrefs?.hyphenation ?? true);
  const [pageTurnMode, setPageTurnMode] = useState<string>(readerPrefs?.pageTurnMode ?? "fifty-fifty");
  const [pageTransitionEffect, setPageTransitionEffect] = useState<string>(readerPrefs?.pageTransitionEffect ?? "paper-flip");
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
  const useScrollLayout = isContinuous;
  const columnGapPx = useDoubleColumns ? 40 : 0;

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

      if (pageTransitionEffect === "paper-flip" && shouldAnimate && !isTurningPage && !prefersReducedMotion) {
        setTurningPageNum(prevPageNumRef.current);
        setTurningChapterIdx(prevChapterIdxRef.current);
        setTurnDirection(dir);
        setIsTurningPage(true);
      }

      prevPageNumRef.current = currentPageNum;
      prevChapterIdxRef.current = currentChapterIdx;
    }
  }, [currentPageNum, currentChapterIdx, pageTransitionEffect, shouldAnimate, isTurningPage]);

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
        hideImages
      });
    }
  }, [fontSize, fontFamily, theme, marginSize, lineSpacing, isContinuous, brightness, doubleColumns, pageOverlap, letterSpacing, hyphenation, pageTurnMode, pageTransitionEffect, themeManuallySet, grayscaleImages, hideImages, onReaderPrefsChange]);
  
  // Layout states
  const [showToc, setShowToc] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showNotes, setShowNotes] = useState<boolean>(false);

  const dismissReaderSettings = useAndroidBackLayer(showSettings, "reader-settings", () => setShowSettings(false));
  const dismissReaderToc = useAndroidBackLayer(showToc, "reader-toc", () => setShowToc(false));
  const dismissReaderNotes = useAndroidBackLayer(showNotes, "reader-notes", () => setShowNotes(false));
  
  // Highlights & Notes State
  const [chapterNotesData, setChapterNotesData] = useState<Record<number, ChapterNote>>({});
  const [highlightsData, setHighlightsData] = useState<BookHighlight[]>([]);
  const [activeNoteText, setActiveNoteText] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);

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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("");
  const [currentParagraphIdx, setCurrentParagraphIdx] = useState<number>(-1);

  const [externalLinkToOpen, setExternalLinkToOpen] = useState<string | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const zipRef = useRef<JSZip | null>(null);
  const rootDirRef = useRef<string>("");
  const blobUrlsRef = useRef<string[]>([]);
  // Maps an EPUB internal href (normalized) -> spine chapter index, so in-book
  // Table-of-Contents links (e.g. <a href="chapter1.xhtml">) navigate correctly.
  const hrefToIndexRef = useRef<Map<string, number>>(new Map());
  const pointerStartRef = React.useRef<{ x: number; y: number; time: number } | null>(null);
  const dragStartRef = useRef<{
    isDraggingStart: boolean;
    isDraggingEnd: boolean;
    originalStartContainer: Node | null;
    originalStartOffset: number;
    originalEndContainer: Node | null;
    originalEndOffset: number;
  } | null>(null);
  const isPointerDownRef = useRef<boolean>(false);

  // Font choices
  const fontFamilies = [
    { name: "Lora Serif", value: "font-serif" },
    { name: "Inter Sans", value: "font-sans" },
    { name: "JetBrains Mono", value: "font-mono" },
    { name: "Dhivehi", value: "font-thaana" },
    { name: "Lexend (Readable)", value: "font-lexend" }
  ];

  // Theme specs
  const themes: Record<string, { bg: string; text: string; card: string; border: string }> = {
    light: { bg: "bg-[#FFFFFF]", text: "text-[#1A1A1A]", card: "bg-[#F9F9F9]", border: "border-[#E5E5E5]" },
    sepia: { bg: "bg-[#F4ECD8]", text: "text-[#5B4636]", card: "bg-[#EFE3C5]", border: "border-[#DBCDA4]" },
    green: { bg: "bg-[#E3EDD3]", text: "text-[#2D3E1E]", card: "bg-[#D9E6C3]", border: "border-[#C5D6A8]" },
    dark: { bg: "bg-[#1A1A1A]", text: "text-[#E5E5E5]", card: "bg-[#262626]", border: "border-[#333333]" }
  };

  const recalculateLayout = () => {
    setTimeout(() => {
      const container = contentRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const textWidth = rect.width;
      if (textWidth <= 0) return;

      if (useScrollLayout) {
        setTotalPages(1);
        setContainerWidth(textWidth);
        pageStepRef.current = textWidth;
        setPageStep(textWidth);
        if (currentPageNum !== 1) setCurrentPageNum(1);
        return;
      }

      const scrollWidth = container.scrollWidth;
      const step = Math.max(1, textWidth - pageOverlap);
      const adjustedScroll = Math.max(textWidth, scrollWidth - 10);
      const calculatedPages = Math.max(1, Math.ceil((adjustedScroll - textWidth) / step) + 1);
      setTotalPages(calculatedPages);
      setContainerWidth(textWidth);
      pageStepRef.current = step;
      setPageStep(step);
    }, 150);
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
        const todayStr = new Date().toDateString();
        const savedStats = localStorage.getItem("kora_reading_stats");
        let stats = savedStats ? JSON.parse(savedStats) : {};
        
        if (!stats[todayStr]) {
          stats[todayStr] = { minutes: 0, date: todayStr };
        }
        stats[todayStr].minutes = (stats[todayStr].minutes || 0) + 1;
        
        localStorage.setItem("kora_reading_stats", JSON.stringify(stats));
      } catch (e) {
        console.error("Failed to log reading timer progress:", e);
      }
    }, 60000); // every minute
    
    return () => clearInterval(interval);
  }, []);

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
      grayscaleImages
    };
    localStorage.setItem("kora_reader_prefs", JSON.stringify(prefs));
  }, [fontSize, fontFamily, theme, marginSize, lineSpacing, isContinuous, brightness, doubleColumns, pageOverlap, letterSpacing, hyphenation, pageTurnMode, pageTransitionEffect, themeManuallySet, grayscaleImages]);

  useEffect(() => {
    loadEpubFile();
  }, [book.id]);

  // Handle restoring the last read chapter
  useEffect(() => {
    if (chapters.length > 0) {
      const savedIdx = book.progress?.chapterIndex ?? 0;
      if (savedIdx >= 0 && savedIdx < chapters.length) {
        setCurrentChapterIdx(savedIdx);
      }
    }
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
    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(x, y);
    } else if ((document as any).caretPositionFromPoint) {
      const pos = (document as any).caretPositionFromPoint(x, y);
      if (pos && pos.offsetNode) {
        const range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
        return range;
      }
    }
    return null;
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

      const res = await fetch(`/api/oxford-dictionary?word=${encodeURIComponent(word)}`);
      if (res.ok) {
        const data = await res.json();
        setSelectionDictPreview({
          word,
          phonetic: data.phonetic,
          definition: data.meanings?.[0]?.definitions?.[0]?.definition,
        });
      } else {
        setSelectionDictPreview({ word });
      }
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

  // Native text selection toolbar — no separate "selection mode" required
  useEffect(() => {
    let rafId: number | null = null;

    const handleSelection = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(() => {
        rafId = null;
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
                const text = selection.toString().trim();
                setSelectedText(text);
                
                const rect = range.getBoundingClientRect();
                
                const rects = range.getClientRects();
                if (rects.length > 0) {
                  const firstRect = rects[0];
                  const lastRect = rects[rects.length - 1];
                  setSelectionPins({
                    start: {
                      x: firstRect.left,
                      y: firstRect.top,
                      height: firstRect.height
                    },
                    end: {
                      x: lastRect.right,
                      y: lastRect.top,
                      height: lastRect.height
                    }
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
    
    // Dictionary lookup on double tap -> also enters select mode for convenience!
    const handleDoubleClick = async () => {
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

    // Enter Select Mode and highlight word on long press
    let pressTimer: NodeJS.Timeout | null = null;
    let pressStartX = 0;
    let pressStartY = 0;

    const handlePointerDown = (e: PointerEvent) => {
      isPointerDownRef.current = true;

      const container = contentRef.current;
      const target = e.target as Node;
      if (!container?.contains(target)) {
        setSelectionCoords(null);
        setSelectionPins({ start: null, end: null });
      }
      
      pressStartX = e.clientX;
      pressStartY = e.clientY;
      pressTimer = setTimeout(() => {
        let range: Range | null = null;
        if (document.caretRangeFromPoint) {
          range = document.caretRangeFromPoint(e.clientX, e.clientY);
        } else if ((document as any).caretPositionFromPoint) {
          const pos = (document as any).caretPositionFromPoint(e.clientX, e.clientY);
          if (pos && pos.offsetNode) {
            range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
          }
        }

        if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
          const textNode = range.startContainer;
          const offset = range.startOffset;
          const text = textNode.textContent || "";
          
          let start = offset;
          while (start > 0 && /[\w\-]/.test(text[start - 1])) start--;
          let end = offset;
          while (end < text.length && /[\w\-]/.test(text[end])) end++;
          
          if (end > start) {
            const word = text.slice(start, end).replace(/^[^a-zA-Z0-9\-]+|[^a-zA-Z0-9\-]+$/g, "");
            if (word && word.length > 1) {
              const newRange = document.createRange();
              newRange.setStart(textNode, start);
              newRange.setEnd(textNode, end);
              const sel = window.getSelection();
              if (sel) {
                sel.removeAllRanges();
                sel.addRange(newRange);
                setSelectedText(word);
                
                try {
                  const rect = newRange.getBoundingClientRect();
                  const rects = newRange.getClientRects();
                  if (rects.length > 0) {
                    const firstRect = rects[0];
                    const lastRect = rects[rects.length - 1];
                    setSelectionPins({
                      start: { x: firstRect.left, y: firstRect.top, height: firstRect.height },
                      end: { x: lastRect.right, y: lastRect.top, height: lastRect.height }
                    });
                  }
                  setSelectionCoords({
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10,
                    top: rect.top,
                    bottom: rect.bottom,
                  });
                  void prefetchSelectionDictionary(word);
                  lookupDictionary(word);
                } catch (err) {
                  // fallback
                }
              }
            }
          }
        }
      }, 700);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (pressTimer) {
        const dx = Math.abs(e.clientX - pressStartX);
        const dy = Math.abs(e.clientY - pressStartY);
        if (dx > 10 || dy > 10) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      }
    };

    const handlePointerUp = () => {
      isPointerDownRef.current = false;
      setIsDraggingSelection(false);
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      // Re-evaluate selection immediately on pointer up to position pins and menu
      handleSelection();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.removeEventListener("selectionchange", handleSelection);
      document.removeEventListener("dblclick", handleDoubleClick);
      document.removeEventListener("click", handleTripleClick);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
      if (pressTimer) clearTimeout(pressTimer);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [prefetchSelectionDictionary]);

  // Prevent viewport rubber-banding only while dragging selection handles
  useEffect(() => {
    if (isDraggingSelection) {
      const preventDefaultTouch = (e: TouchEvent) => {
        // Only prevent touch movements when active selecting or dragging to lock position
        e.preventDefault();
      };
      
      document.body.style.overflow = "hidden";
      document.body.style.overscrollBehavior = "none";
      document.addEventListener("touchmove", preventDefaultTouch, { passive: false });
      
      return () => {
        document.body.style.overflow = "";
        document.body.style.overscrollBehavior = "";
        document.removeEventListener("touchmove", preventDefaultTouch);
      };
    }
  }, [isDraggingSelection]);

  const handleNextPage = () => {
    playFlipSound();
    setTapFeedback("next");
    setTimeout(() => setTapFeedback(null), 350);
    if (useScrollLayout) {
      if (currentChapterIdx < chapters.length - 1) {
        updateProgress(currentChapterIdx + 1, false);
      }
      return;
    }
    if (currentPageNum < totalPages) {
      setCurrentPageNum(prev => prev + 1);
    } else {
      if (currentChapterIdx < chapters.length - 1) {
        updateProgress(currentChapterIdx + 1, false);
      }
    }
  };

  const handlePrevPage = () => {
    playFlipSound();
    setTapFeedback("prev");
    setTimeout(() => setTapFeedback(null), 350);
    if (useScrollLayout) {
      if (currentChapterIdx > 0) {
        updateProgress(currentChapterIdx - 1, true);
      }
      return;
    }
    if (currentPageNum > 1) {
      setCurrentPageNum(prev => prev - 1);
    } else {
      if (currentChapterIdx > 0) {
        updateProgress(currentChapterIdx - 1, true);
      }
    }
  };

  const handleContainerClick = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

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
    if (sel && sel.toString().trim().length > 0) {
      dismissSelection();
      return; // Prevent page turn on this tap!
    }
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = clickX / rect.width;
    
    if (pageTurnMode === "fifty-fifty") {
      if (ratio < 0.5) {
        handlePrevPage();
      } else {
        handleNextPage();
      }
    } else if (pageTurnMode === "classic-ereader") {
      if (ratio < 0.25) {
        handlePrevPage();
      } else {
        handleNextPage();
      }
    } else if (pageTurnMode === "margins-only") {
      if (ratio < 0.15) {
        handlePrevPage();
      } else if (ratio > 0.85) {
        handleNextPage();
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;
    if (!e.isPrimary) return;
    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now()
    };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;
    if (!pointerStartRef.current) return;
    const start = pointerStartRef.current;
    pointerStartRef.current = null;

    const diffX = e.clientX - start.x;
    const diffY = e.clientY - start.y;
    const duration = Date.now() - start.time;

    // Check if it's a swipe (fast flick or drag)
    if (duration < 500 && Math.abs(diffX) > 40 && Math.abs(diffY) < 60) {
      // Swipe from left edge of screen to right -> go back / close reader (native iOS/Android gesture)
      if (start.x < 50 && diffX > 45) {
        onClose();
        return;
      }

      if (diffX > 40) {
        // Swipe Right -> Prev Page
        handlePrevPage();
        return;
      } else if (diffX < -40) {
        // Swipe Left -> Next Page
        handleNextPage();
        return;
      }
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

  async function lookupDictionary(word: string) {
    try {
      setDictLoading(true);
      setDictionaryWord(word);
      
      // 1. Check custom dictionary first
      const localDef = await lookupWord(word);
      if (localDef) {
        setDictionaryData({
          word: localDef.word,
          phonetic: localDef.isCustom ? "Personal Definition" : "Kora System Definition",
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

      // 2. Fall back to online dictionary
      const res = await fetch(`/api/oxford-dictionary?word=${encodeURIComponent(word)}`);
      if (res.ok) {
        const data = await res.json();
        setDictionaryData(data);
      } else {
        setDictionaryData(null);
      }
    } catch (err) {
      console.error("Dictionary error:", err);
      setDictionaryData(null);
    } finally {
      setDictLoading(false);
    }
  }

  function exportToPensieve() {
    const content = `Book: ${book.title}\nAuthor: ${book.author}\n\nNotes:\n${book.notes || "No notes yet."}`;
    const url = `https://github.com/CHAOTIC-RAY/Pensieve?content=${encodeURIComponent(content)}`;
    window.open(url, "_blank");
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

      // Parse Table of Contents labels (EPUB 3 navigation, fallback to NCX)
      // For this lightweight parser, we'll map spine indices as chapters, 
      // and read title metadata or HTML headings as title defaults
      const parsedChapters: EpubChapter[] = [];

      // Pre-register all spine hrefs so that in-book TOC links in any chapter
      // (especially the first chapter, which is often the TOC) can be resolved
      // to the correct spine index during content processing.
      for (let i = 0; i < spineItems.length; i++) {
        const relativeHref = spineItems[i];
        const norm = pathResolve(rootDir, relativeHref).toLowerCase();
        hrefToIndexRef.current.set(norm, i);
        hrefToIndexRef.current.set(relativeHref.toLowerCase(), i);
      }

      for (let i = 0; i < spineItems.length; i++) {
        const relativeHref = spineItems[i];
        const fullChapterPath = `${rootDir}${relativeHref}`;
        const chapterFile = zip.file(fullChapterPath);

        if (chapterFile) {
          const rawContent = await chapterFile.async("string");
          const chapterDoc = parser.parseFromString(rawContent, "text/html");
          
          // Get beautiful title from H1/H2 or title element
          let chapterTitle = chapterDoc.querySelector("title")?.textContent?.trim() || "";
          
          if (!chapterTitle || chapterTitle.toLowerCase() === "unknown" || chapterTitle.toLowerCase() === "untitled") {
             chapterTitle = chapterDoc.querySelector("h1")?.textContent || 
                            chapterDoc.querySelector("h2")?.textContent || 
                            chapterDoc.querySelector("h3")?.textContent ||
                            `Chapter ${i + 1}`;
          }

          chapterTitle = chapterTitle.trim().replace(/\s+/g, " ");
          if (chapterTitle.length > 50) {
            chapterTitle = chapterTitle.substring(0, 47) + "...";
          }

          // Process chapter document images and style links in-memory
          // Find all images, retrieve binary blobs, and map to local blob URLs
          const processedContent = await resolveInternalAssets(chapterDoc, zip, rootDir, relativeHref);

          parsedChapters.push({
            id: `ch-${i}`,
            href: relativeHref,
            title: chapterTitle || `Chapter ${i + 1}`,
            content: processedContent,
            fullPath: fullChapterPath
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
  async function updateProgress(newChapterIdx: number, goToLastPage = false) {
    if (newChapterIdx < 0 || newChapterIdx >= chapters.length) return;
    
    // Disable transition temporarily and reset page index synchronously
    setShouldAnimate(false);
    setCurrentPageNum(goToLastPage ? 999 : 1);
    setCurrentChapterIdx(newChapterIdx);
    
    // Save scroll position at top of new chapter
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }

    // Recalculate pages for the new chapter and set target page index
    setTimeout(() => {
      const container = contentRef.current;
      if (!container) return;
      const textWidth = container.getBoundingClientRect().width;
      if (textWidth <= 0) return;

      if (useScrollLayout) {
        setTotalPages(1);
        setContainerWidth(textWidth);
        pageStepRef.current = textWidth;
        setPageStep(textWidth);
        setCurrentPageNum(1);
        setTimeout(() => setShouldAnimate(true), 150);
        return;
      }

      const scrollWidth = container.scrollWidth;
      const step = Math.max(1, textWidth - pageOverlap);
      const adjustedScroll = Math.max(textWidth, scrollWidth - 10);
      const calculatedPages = Math.max(1, Math.ceil((adjustedScroll - textWidth) / step) + 1);
      setTotalPages(calculatedPages);
      setContainerWidth(textWidth);
      pageStepRef.current = step;
      setPageStep(step);
      setCurrentPageNum(goToLastPage ? calculatedPages : 1);
      
      // Re-enable animation after layout settles
      setTimeout(() => setShouldAnimate(true), 150);
    }, 150);

    const percent = Math.round((newChapterIdx / chapters.length) * 100);
    const updated: BookMetadata = {
      ...book,
      status: percent === 100 ? "completed" : "reading",
      progress: {
        chapterIndex: newChapterIdx,
        chapterTitle: chapters[newChapterIdx]?.title || `Chapter ${newChapterIdx + 1}`,
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
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
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

  // Load available speech voices
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const loadVoices = () => {
      const allVoices = getSpeechVoices();
      setVoices(allVoices);
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
      window.speechSynthesis.cancel();
    };
  }, []);

  // Speak a specific paragraph index
  const speakParagraph = (idx: number) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    window.speechSynthesis.cancel(); // Stop active speaking

    const domElements = getDOMElementsToRead();
    if (idx < 0 || idx >= domElements.length) {
      // End of chapter! Advance to next chapter if available
      if (currentChapterIdx < chapters.length - 1) {
        updateProgress(currentChapterIdx + 1);
        setCurrentParagraphIdx(0);
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
      speakParagraph(idx + 1);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    const settings = getTtsSettings();
    
    // Assign voice if selected
    const selectedVoice = resolveSpeechVoice(selectedVoiceName || settings.voiceName);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.rate = getEffectiveSpeechRate(speechRate);
    utterance.pitch = settings.pitch;

    utterance.onend = () => {
      speakParagraph(idx + 1);
    };

    utterance.onerror = (event) => {
      if (event.error !== "interrupted") {
        console.error("SpeechSynthesisUtterance error:", event);
        setIsPlayingSpeech(false);
      }
    };

    setIsPlayingSpeech(true);
    window.speechSynthesis.speak(utterance);
  };

  // Toggle Play / Pause speech
  const toggleSpeechPlayback = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    if (isPlayingSpeech) {
      window.speechSynthesis.pause();
      setIsPlayingSpeech(false);
    } else {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        setIsPlayingSpeech(true);
      } else {
        const startIdx = currentParagraphIdx >= 0 ? currentParagraphIdx : 0;
        speakParagraph(startIdx);
      }
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
  const handleSaveHighlight = async (color: "yellow" | "green" | "blue" | "pink") => {
    if (!selectedText) return;
    const highlightId = Date.now().toString();
    const chapterTitle = chapters[currentChapterIdx]?.title || `Chapter ${currentChapterIdx + 1}`;
    const newHighlight: BookHighlight = {
      id: highlightId,
      text: selectedText,
      color,
      chapterIdx: currentChapterIdx,
      chapterTitle,
      createdAt: Date.now()
    };
    
    await syncBookHighlight(userId, book.id, newHighlight);
    setHighlightsData(prev => [newHighlight, ...prev]);
    dismissSelection();
    setShowNotes(true);
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
    <div id="epub-reader-container" className={`fixed inset-0 z-50 flex flex-col ${activeTheme.bg} ${activeTheme.text} transition-colors duration-200`}>
      {/* 1. Header Toolbar */}
      <header className={`flex items-center justify-between px-6 py-4 border-b ${activeTheme.border} bg-opacity-95`}>
        <div className="flex items-center gap-4">
          <button 
            id="close-reader-btn"
            onClick={handleClose} 
            className="p-2 rounded-xl hover:bg-neutral-500/10 transition text-kindle-text"
            title="Back to Library"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="hidden sm:block">
            <h1 className="font-sans font-bold text-xs uppercase tracking-widest text-kindle-text-muted">
              {book.title}
            </h1>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowNotes(!showNotes); setShowSettings(false); setShowToc(false); setShowAudiobook(false); }}
            className={`p-2 rounded-xl hover:bg-neutral-500/10 transition ${showNotes ? 'bg-neutral-500/20' : ''}`}
            title="Highlights & Notes"
          >
            <FileText className="w-5 h-5" />
          </button>
          <button
            id="toggle-toc-btn"
            onClick={() => { setShowToc(!showToc); setShowSettings(false); setShowAudiobook(false); setShowNotes(false); }}
            className={`p-2 rounded-xl hover:bg-neutral-500/10 transition ${showToc ? 'bg-neutral-500/20' : ''}`}
            title="Chapters"
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <button
            id="toggle-settings-btn"
            onClick={() => { setShowSettings(!showSettings); setShowToc(false); setShowAudiobook(false); setShowNotes(false); }}
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
              }
              setShowAudiobook(!showAudiobook);
              setShowToc(false);
              setShowSettings(false);
              setShowNotes(false);
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
            onClick={() => {
              setShowNotes(true);
              setShowToc(false);
              setShowSettings(false);
              setShowAudiobook(false);
            }}
            className={`p-2 rounded-xl hover:bg-neutral-500/10 transition ${showNotes ? "bg-kindle-accent/20 text-kindle-accent font-semibold" : ""}`}
            title="Highlights & Notes"
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
            <aside className={`w-full md:w-80 h-[50vh] md:h-auto border-t md:border-t-0 md:border-r ${activeTheme.border} ${activeTheme.card} p-5 overflow-y-auto z-40 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.1)] md:shadow-none animate-in slide-in-from-bottom md:slide-in-from-left duration-200 shrink-0`}>
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
                {Object.keys(themes).map((tKey) => {
                  const th = themes[tKey];
                  return (
                    <button
                      key={tKey}
                      onClick={() => {
                        setTheme(tKey);
                        setThemeManuallySet(true);
                      }}
                      className={`h-10 rounded-lg border flex items-center justify-center text-xs font-semibold capitalize ${th.bg} ${th.text} ${
                        theme === tKey ? "ring-2 ring-kindle-accent border-transparent" : "border-neutral-500/20"
                      }`}
                      title={tKey}
                    >
                      {tKey[0].toUpperCase()}
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
                    onClick={() => setFontFamily(ff.value)}
                    className={`p-2 text-xs rounded-lg border text-center font-sans transition ${
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
            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs opacity-75 font-sans font-semibold">Font Size</label>
                <span className="text-xs font-mono">{fontSize}px</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setFontSize(Math.max(12, fontSize - 1))}
                  className="flex-1 p-2 border border-neutral-500/20 rounded-lg text-sm hover:bg-neutral-500/10 font-bold"
                >
                  A -
                </button>
                <button
                  onClick={() => setFontSize(Math.min(32, fontSize + 1))}
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
                          onClick={() => setLineSpacing(spacing)}
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
                      className={`w-10 h-5 rounded-full transition-colors relative ${hyphenation ? "bg-kindle-accent" : "bg-neutral-300"}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${hyphenation ? "translate-x-5.5" : "translate-x-0.5"}`} />
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
                      className={`w-10 h-5 rounded-full transition-colors relative ${doubleColumns ? "bg-kindle-accent" : "bg-neutral-300"}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${doubleColumns ? "translate-x-5.5" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  {/* Continuous Scroll Toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold">Continuous Scroll</h4>
                      <p className="text-[10px] text-kindle-text-muted">Scroll instead of page-by-page turns</p>
                    </div>
                    <button
                      onClick={() => setIsContinuous(!isContinuous)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${isContinuous ? "bg-kindle-accent" : "bg-neutral-300"}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${isContinuous ? "translate-x-5.5" : "translate-x-0.5"}`} />
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
                      className={`w-10 h-5 rounded-full transition-colors relative ${grayscaleImages ? "bg-kindle-accent" : "bg-neutral-300"}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${grayscaleImages ? "translate-x-5.5" : "translate-x-0.5"}`} />
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
                      className={`w-10 h-5 rounded-full transition-colors relative ${hideImages ? "bg-kindle-accent" : "bg-neutral-300"}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${hideImages ? "translate-x-5.5" : "translate-x-0.5"}`} />
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
                        { label: "Swipe & Keys Only", val: "swipe-only", desc: "Disable tap-to-turn entirely." }
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

                  {/* Page Overlap (KOReader-style) */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-[10px] opacity-75 font-sans uppercase font-bold tracking-wider">Page Overlap</label>
                      <span className="text-[10px] font-mono">{pageOverlap}px</span>
                    </div>
                    <p className="text-[10px] text-kindle-text-muted mb-2 font-sans">Repeat the last few lines on the next page.</p>
                    <input
                      type="range"
                      min="0"
                      max="60"
                      step="2"
                      value={pageOverlap}
                      onChange={(e) => setPageOverlap(parseInt(e.target.value))}
                      className="w-full accent-kindle-accent h-1 bg-neutral-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Export Actions */}
            <div className="pt-4 border-t border-kindle-border space-y-2 mt-4">
              <h4 className="text-[10px] uppercase tracking-widest font-bold text-kindle-text-muted">Export</h4>
              <button
                onClick={exportToPensieve}
                className="w-full py-2.5 bg-[#1A1A1A] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-black transition shadow-sm"
              >
                Export to Pensieve
              </button>
            </div>
          </aside>
          </>
        )}
          {/* Sidebar / Popup: Voice Narrator panel */}
        {showAudiobook && (
          <>
            <div className={`absolute inset-0 z-30 bg-black/10 md:hidden transition-opacity ${isAudiobookExpanded ? "opacity-100" : "opacity-0 pointer-events-none"}`} onClick={() => setIsAudiobookExpanded(false)} />
            
            {/* Desktop Sidebar OR Mobile Expanded Popup OR Mobile Mini Player */}
            <aside className={`
              w-full md:w-80 border-t md:border-t-0 md:border-r ${activeTheme.border} ${activeTheme.card} overflow-y-auto flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.1)] md:shadow-none animate-in slide-in-from-bottom md:slide-in-from-left duration-200 shrink-0
              md:relative md:h-auto md:translate-y-0
              ${isAudiobookExpanded ? 'fixed bottom-0 left-0 right-0 h-[60vh] z-40 rounded-t-3xl p-5' : 'fixed bottom-4 left-4 right-4 h-16 z-40 rounded-2xl shadow-xl flex-row items-center px-4 py-2 border'}
            `}>
              
              {/* Mobile Mini Player Layout */}
              {!isAudiobookExpanded && (
                <div className="flex md:hidden items-center justify-between w-full h-full" onClick={() => setIsAudiobookExpanded(true)}>
                  <div className="flex items-center gap-3 overflow-hidden flex-1">
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
                  
                  <div className="flex items-center gap-1 shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={toggleSpeechPlayback}
                      className="w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-600 text-neutral-950 flex items-center justify-center shadow-sm transform active:scale-95 transition"
                    >
                      {isPlayingSpeech ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                    </button>
                    <button 
                      onClick={() => setShowAudiobook(false)}
                      className="w-8 h-8 flex items-center justify-center text-neutral-500 hover:text-current rounded-full"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Desktop / Expanded Mobile Layout */}
              <div className={`w-full flex-col h-full ${!isAudiobookExpanded ? 'hidden md:flex' : 'flex'}`}>
                {/* Drag handle for mobile */}
                <div className="w-full flex justify-center pb-2 md:hidden" onClick={() => setIsAudiobookExpanded(false)}>
                  <div className="w-12 h-1.5 bg-current opacity-20 rounded-full" />
                </div>

                <div className={`pb-3 mb-4 border-b ${activeTheme.border} flex justify-between items-center ${isAudiobookExpanded ? '' : 'p-5 md:p-0'}`}>
                  <span className="font-sans font-semibold text-sm flex items-center gap-2 text-[#5c5346] dark:text-neutral-300">
                    <Headphones className="w-4 h-4" />
                    Voice Narrator
                  </span>
                  <button 
                    onClick={() => {
                      if (isAudiobookExpanded) setIsAudiobookExpanded(false);
                      else { stopSpeech(); setShowAudiobook(false); }
                    }} 
                    className="text-xs p-1 hover:bg-neutral-500/10 rounded font-sans font-semibold text-[#5c5346] dark:text-neutral-300"
                  >
                    {isAudiobookExpanded ? 'Collapse' : 'Done'}
                  </button>
                </div>

                <div className={`flex-1 flex flex-col gap-4 overflow-y-auto ${isAudiobookExpanded ? '' : 'px-5 md:px-0 pb-5 md:pb-0'}`}>
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
                          <option value="">No System Voices</option>
                        ) : (
                          voices.map((v) => (
                            <option key={v.name} value={v.name} className="text-neutral-900 bg-white">
                              {v.name.slice(0, 24)} ({v.lang.split("-")[0].toUpperCase()})
                            </option>
                          ))
                        )}
                      </select>
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
                <h3 className="text-xs font-bold uppercase tracking-widest text-kindle-text-muted flex items-center gap-2">
                  <Highlighter className="w-3.5 h-3.5" />
                  My Highlights
                </h3>
                
                {highlightsData.length === 0 ? (
                  <div className="text-center p-6 border border-dashed border-kindle-border rounded-xl">
                    <p className="text-xs text-kindle-text-muted italic">Select text in the book to create highlights.</p>
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

          {/* Dictionary Modal */}
          {dictionaryWord && (
            <div className="absolute inset-0 z-[70] flex items-center justify-center p-6 animate-in fade-in zoom-in duration-200">
              <div className="absolute inset-0 bg-black/40" onClick={() => setDictionaryWord(null)} />
              <div className={`relative w-full max-w-sm ${activeTheme.card} ${activeTheme.text} border ${activeTheme.border} rounded-2xl shadow-2xl p-6 overflow-hidden`}>
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <span className="text-[8px] uppercase tracking-widest font-bold font-sans text-amber-600 dark:text-amber-400">Oxford Dictionary</span>
                    <h3 className="text-xl font-extrabold font-serif leading-tight mt-0.5">{dictionaryWord}</h3>
                  </div>
                  <button onClick={() => setDictionaryWord(null)} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {dictLoading ? (
                  <div className="flex items-center gap-2 py-4">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-sans">Looking up...</span>
                  </div>
                ) : dictionaryData ? (
                  <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-2 custom-scrollbar">
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
                <div className="mt-5 pt-3 border-t border-current/10 flex items-center gap-2">
                  <button
                    onClick={() => window.open(`https://en.wikipedia.org/wiki/${encodeURIComponent(dictionaryWord || "")}`, "_blank")}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-current/15 text-[10px] font-bold uppercase tracking-widest hover:bg-current/5 transition"
                    title="Open Wikipedia"
                  >
                    <Globe className="w-3.5 h-3.5" /> Wiki
                  </button>
                  <button
                    onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(dictionaryWord || "")}`, "_blank")}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-current/15 text-[10px] font-bold uppercase tracking-widest hover:bg-current/5 transition"
                    title="Search the web"
                  >
                    <Search className="w-3.5 h-3.5" /> Search
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
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-700 dark:text-yellow-300 border border-yellow-500/30 text-[10px] font-bold uppercase tracking-widest transition"
                    title="Highlight selection"
                  >
                    <Highlighter className="w-3.5 h-3.5" /> Highlight
                  </button>
                  <button
                    onClick={() => setDictionaryWord(null)}
                    className="px-3 py-2 rounded-lg bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-widest hover:opacity-80 transition"
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
                className={`flex-1 min-h-0 w-full relative py-3 px-3 md:py-8 md:px-16 flex items-start justify-start select-text cursor-text mx-auto ${useDoubleColumns ? "max-w-[95%] xl:max-w-7xl px-4 md:px-8" : marginSize}`}
              >
                <div className={`w-full h-full ${useScrollLayout ? "overflow-y-auto overflow-x-hidden" : "overflow-hidden"} relative flex items-start justify-start`} style={{ perspective: "1200px" }}>
                  {/* Turn.js style 3D page flip transition */}
                  {!useScrollLayout && pageTransitionEffect === "paper-flip" && shouldAnimate && isTurningPage && !prefersReducedMotion && (
                    <div 
                      className="absolute inset-0 pointer-events-none z-50 overflow-hidden"
                      style={{ perspective: "2500px" }}
                    >
                      <motion.div
                        key={`page-turn-${turningChapterIdx}-${turningPageNum}-${currentPageNum}`}
                        initial={{ rotateY: 0 }}
                        animate={{ rotateY: turnDirection === "next" ? -180 : 180 }}
                        transition={{ type: "spring", stiffness: 180, damping: 22, mass: 0.9 }}
                        onAnimationComplete={() => setIsTurningPage(false)}
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
                            className={`w-full ml-0 ${fontFamily} ${letterSpacing} ${hyphenation ? "hyphens-auto text-justify" : "hyphens-none text-left"}`}
                            style={{
                              fontSize: `${fontSize}px`,
                              lineHeight: lineSpacing,
                              columnWidth: `${useDoubleColumns ? (containerWidth - columnGapPx) / 2 : containerWidth}px`,
                              columnGap: `${columnGapPx}px`,
                              height: "100%",
                              columnFill: "auto",
                              overflow: "visible",
                              transform: `translateX(-${(turningPageNum - 1) * pageStep}px)`,
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
                              onClick={(e) => {
                                const target = e.target as HTMLElement;
                                const anchor = target.closest("a");
                                if (anchor) {
                                  e.preventDefault();
                                  const href = anchor.getAttribute("href") || "";
                                  if (href.startsWith("http")) {
                                    setExternalLinkToOpen(href);
                                  }
                                }
                              }}
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
                            className={`w-full ml-0 ${fontFamily} ${letterSpacing} ${hyphenation ? "hyphens-auto text-justify" : "hyphens-none text-left"}`}
                            style={{
                              fontSize: `${fontSize}px`,
                              lineHeight: lineSpacing,
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
                              dangerouslySetInnerHTML={{ __html: chapters[currentChapterIdx]?.content || "" }}
                              onClick={(e) => {
                                const target = e.target as HTMLElement;
                                const anchor = target.closest("a");
                                if (anchor) {
                                  e.preventDefault();
                                  const href = anchor.getAttribute("href") || "";
                                  if (href.startsWith("http")) {
                                    setExternalLinkToOpen(href);
                                  }
                                }
                              }}
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
                  <AnimatePresence mode="popLayout">
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
                  <motion.article 
                    ref={contentRef}
                    animate={{ 
                      x: useScrollLayout ? 0 : -(currentPageNum - 1) * pageStep,
                      rotateY: 0,
                      skewY: 0,
                      scaleX: 1
                    }}
                    transition={shouldAnimate ? (pageTransitionEffect === "paper-flip" ? { duration: 0 } : pageTransitionEffect === "spring" ? { type: "spring", stiffness: 220, damping: 28, mass: 0.8 } : pageTransitionEffect === "none" ? { duration: 0 } : { type: "tween", ease: [0.33, 1, 0.68, 1], duration: 0.35 }) : { duration: 0 }}
                    className={`w-full ml-0 ${fontFamily} ${letterSpacing} ${hyphenation ? "hyphens-auto text-justify" : "hyphens-none text-left"} selection:bg-kindle-accent/20 selection:text-kindle-text ${grayscaleImages ? "[&_img]:grayscale" : ""} ${hideImages ? "[&_img]:hidden [&_image]:hidden" : ""} [&_img]:select-none [&_img]:pointer-events-none [&_image]:select-none [&_image]:pointer-events-none`}
                    style={{
                      fontSize: `${fontSize}px`,
                      lineHeight: lineSpacing,
                      ...(useScrollLayout
                        ? {
                            height: "auto",
                            minHeight: "100%",
                            overflow: "visible",
                          }
                        : {
                            columnWidth: `${useDoubleColumns ? (containerWidth - columnGapPx) / 2 : containerWidth}px`,
                            columnGap: `${columnGapPx}px`,
                            height: "100%",
                            columnFill: "auto",
                            overflow: "visible",
                            boxShadow: useDoubleColumns ? "inset 50% 0 0 -20px rgba(0,0,0,0.10)" : "none",
                            transformOrigin: flipDirection === "next" ? "left center" : "right center",
                          }),
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

                    {/* EPUB HTML Content Injection */}
                    <div 
                      id="epub-text-viewer"
                      className={`epub-content reader-select-surface leading-relaxed space-y-5 ${fontFamily} break-words ${showAudiobook ? "cursor-pointer" : ""}`}
                      dangerouslySetInnerHTML={{ __html: chapters[currentChapterIdx]?.content || "" }}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        const anchor = target.closest("a");
                        if (anchor) {
                          e.preventDefault();
                          const href = anchor.getAttribute("href") || "";
                          if (href.startsWith("http")) {
                            setExternalLinkToOpen(href);
                          }
                        }
                      }}
                    />

                    {/* Bottom Controls */}
                    <div className={`mt-12 pt-6 border-t ${activeTheme.border} flex justify-between items-center text-xs font-sans opacity-70`}>
                      <span>End of {chapters[currentChapterIdx]?.title}</span>
                      <span>{Math.round((currentChapterIdx / chapters.length) * 100)}% read</span>
                    </div>
                  </motion.article>
                </div>

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
              <footer className={`px-6 py-4 border-t ${activeTheme.border} flex items-center justify-between font-sans shrink-0`}>
                {!(pageTurnMode === "fifty-fifty" || pageTurnMode === "classic-ereader" || pageTurnMode === "margins-only") ? (
                  <button
                    id="prev-chapter-btn"
                    disabled={currentChapterIdx === 0 && currentPageNum === 1}
                    onClick={handlePrevPage}
                    className={`flex items-center justify-center p-3 rounded-full shadow-sm border backdrop-blur-xs transition-all duration-200 ${
                      theme === "dark"
                        ? "bg-neutral-900/60 text-white border-white/10 hover:bg-neutral-800"
                        : "bg-white text-neutral-800 border-neutral-200 hover:bg-neutral-50"
                    } disabled:opacity-30`}
                    title="Previous Page"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                ) : (
                  <div className="w-[100px] hidden sm:block" />
                )}

                <div className="flex flex-col items-center">
                  <div className="w-48 bg-neutral-200 h-1 rounded-full overflow-hidden mb-1.5">
                    <div 
                      className="bg-kindle-text h-full transition-all duration-500" 
                      style={{ 
                        width: `${Math.min(100, Math.max(0, Math.round(
                          ((currentChapterIdx + (currentPageNum - 1) / (totalPages || 1)) / (chapters.length || 1)) * 100
                        )))}%` 
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-bold font-mono tracking-wide text-kindle-text opacity-90">
                    {useScrollLayout
                      ? `chapter ${currentChapterIdx + 1} of ${chapters.length} • ${Math.min(100, Math.max(0, Math.round(((currentChapterIdx + 1) / (chapters.length || 1)) * 100)))}%`
                      : `page ${currentPageNum} of ${totalPages} (Ch. ${currentChapterIdx + 1}) • ${Math.min(100, Math.max(0, Math.round(
                    ((currentChapterIdx + (currentPageNum - 1) / (totalPages || 1)) / (chapters.length || 1)) * 100
                  )))}%`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDoubleColumns(!doubleColumns)}
                    className={`hidden md:flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition ${doubleColumns ? "bg-kindle-accent text-white border-transparent" : "border-kindle-border hover:bg-neutral-500/10"}`}
                    title="Toggle two-column spread (KOReader style)"
                  >
                    <Layout className="w-3.5 h-3.5" /> 2-Page
                  </button>

                  {!(pageTurnMode === "fifty-fifty" || pageTurnMode === "classic-ereader" || pageTurnMode === "margins-only") && (
                    <button
                      id="next-chapter-btn"
                      disabled={currentChapterIdx === chapters.length - 1 && currentPageNum === totalPages}
                      onClick={handleNextPage}
                      className={`flex items-center justify-center p-3 rounded-full shadow-sm border backdrop-blur-xs transition-all duration-200 ${
                        theme === "dark"
                          ? "bg-neutral-900/60 text-white border-white/10 hover:bg-neutral-800"
                          : "bg-neutral-900 text-white border-neutral-800 hover:bg-neutral-800"
                      } disabled:opacity-30`}
                      title="Next Page"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </footer>
            </div>
          )}
        </main>
      </div>

      {/* Kindle-Style Selection Pin Handles rendered at top level to avoid overflow clipping and CSS transform offsets */}
      {selectedText && selectionPins.start && (
        <div 
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
      {selectedText && selectionCoords && !isDraggingSelection && (
        <div
          className="fixed z-[9999] max-w-[min(96vw,24rem)] animate-in fade-in zoom-in-95 duration-150"
          style={{
            left: `${selectionCoords.x}px`,
            top: selectionCoords.bottom > window.innerHeight * 0.62
              ? `${selectionCoords.top - 12}px`
              : `${selectionCoords.bottom + 12}px`,
            transform: selectionCoords.bottom > window.innerHeight * 0.62
              ? "translate(-50%, -100%)"
              : "translate(-50%, 0)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
          }}
        >
          <div className="rounded-2xl border border-neutral-700/80 bg-[#1a1816]/96 backdrop-blur-xl text-white overflow-hidden">
            {(selectionDictPreview || selectionDictLoading) && (
              <button
                type="button"
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
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowHighlightColors((open) => !open)}
                className="flex-1 min-w-[4.5rem] flex flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-xl hover:bg-white/10 active:scale-[0.98] transition text-neutral-200"
                title="Highlight"
              >
                <Highlighter className="w-5 h-5" />
                <span className="text-[10px] font-bold uppercase tracking-wide font-sans">Highlight</span>
              </button>

              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setActiveNoteText((prev) => `${prev}${prev ? "\n" : ""}"${selectedText}"\n`);
                  setShowNotes(true);
                  dismissSelection();
                }}
                className="flex-1 min-w-[4.5rem] flex flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-xl hover:bg-white/10 active:scale-[0.98] transition text-neutral-200"
                title="Add to note"
              >
                <FileText className="w-5 h-5" />
                <span className="text-[10px] font-bold uppercase tracking-wide font-sans">Note</span>
              </button>

              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  window.open(`https://www.google.com/search?q=${encodeURIComponent(selectedText)}`, "_blank", "noopener,noreferrer");
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
                onMouseDown={(e) => e.preventDefault()}
                onClick={dismissSelection}
                className="w-9 h-full flex items-center justify-center rounded-xl text-neutral-500 hover:text-white hover:bg-white/5 transition"
                title="Clear selection"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <AnimatePresence>
              {showHighlightColors && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-neutral-800/80"
                >
                  <div className="flex items-center justify-center gap-3 px-3 py-2.5">
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
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSaveHighlight(color)}
                          className={`w-8 h-8 rounded-full border-2 border-white/20 shadow-md active:scale-110 transition ${colorClasses[color]}`}
                          title={`Highlight ${color}`}
                        />
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
