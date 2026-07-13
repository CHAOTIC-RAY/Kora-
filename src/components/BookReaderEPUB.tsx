import React, { useState, useEffect, useRef } from "react";
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
import { runOfflineCompanion } from "../lib/offlineAssistant";
import { X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Menu, Settings, BookOpen, Sparkles, CircleAlert as AlertCircle, AlertTriangle, RefreshCw, Database, Zap, Type, LayoutGrid as Layout, Info, Globe, Search, Headphones, Play, Pause, RotateCcw, Volume2, FastForward, Rewind, BookMarked, Copy, Check, FileText, Highlighter, Trash2 } from "lucide-react";
import { lookupWord, addDictionaryEntry } from "../lib/dictionary";
import { playFlipSound, playBookOpenSound } from "../lib/sounds";

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
  const [brightness, setBrightness] = useState<number>(readerPrefs?.brightness ?? 100);
  const [grayscaleImages, setGrayscaleImages] = useState<boolean>(readerPrefs?.grayscaleImages ?? false);
  
  // Dictionary states
  const [dictionaryWord, setDictionaryWord] = useState<string | null>(null);
  const [dictionaryData, setDictionaryData] = useState<any>(null);
  const [dictLoading, setDictLoading] = useState<boolean>(false);
  
  // Pagination & Layout States
  const [currentPageNum, setCurrentPageNum] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(600);
  const pageStepRef = React.useRef<number>(600 + 40); // last computed per-page stride
  const [doubleColumns, setDoubleColumns] = useState<boolean>(readerPrefs?.doubleColumns ?? false); // Dual page mode
  const [pageOverlap, setPageOverlap] = useState<number>(readerPrefs?.pageOverlap ?? 0); // KOReader-style page overlap (px repeated across page turns)
  const [letterSpacing, setLetterSpacing] = useState<string>(readerPrefs?.letterSpacing ?? "tracking-normal"); // tracking-normal, tracking-wide, tracking-wider
  const [hyphenation, setHyphenation] = useState<boolean>(readerPrefs?.hyphenation ?? true);
  const [pageTurnMode, setPageTurnMode] = useState<string>(readerPrefs?.pageTurnMode ?? "fifty-fifty");
  const [pageTransitionEffect, setPageTransitionEffect] = useState<string>(readerPrefs?.pageTransitionEffect ?? "paper-flip");
  const [shouldAnimate, setShouldAnimate] = useState<boolean>(true);

  // Responsive mobile state
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [flipDirection, setFlipDirection] = useState<"next" | "prev">("next");
  const prevPageNumRef = useRef<number>(1);

  const useDoubleColumns = doubleColumns && !isMobile;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (currentPageNum !== prevPageNumRef.current) {
      const dir = currentPageNum > prevPageNumRef.current ? "next" : "prev";
      setFlipDirection(dir);
      prevPageNumRef.current = currentPageNum;
    }
  }, [currentPageNum]);

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
        grayscaleImages
      });
    }
  }, [fontSize, fontFamily, theme, marginSize, lineSpacing, isContinuous, brightness, doubleColumns, pageOverlap, letterSpacing, hyphenation, pageTurnMode, pageTransitionEffect, themeManuallySet, grayscaleImages, onReaderPrefsChange]);
  
  // Layout states
  const [showToc, setShowToc] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showNotes, setShowNotes] = useState<boolean>(false);
  
  // Handle Android back gesture for settings overlay
  useEffect(() => {
    if (showSettings) {
      window.history.pushState({ readerSettingsOpen: true }, "");
      const handlePopState = (e: PopStateEvent) => {
        if (!e.state?.readerSettingsOpen) {
          setShowSettings(false);
        }
      };
      window.addEventListener("popstate", handlePopState);
      return () => {
        window.removeEventListener("popstate", handlePopState);
      };
    } else {
      if (window.history.state?.readerSettingsOpen) {
        window.history.back();
      }
    }
  }, [showSettings]);
  
  // Highlights & Notes State
  const [chapterNotesData, setChapterNotesData] = useState<Record<number, ChapterNote>>({});
  const [highlightsData, setHighlightsData] = useState<BookHighlight[]>([]);
  const [activeNoteText, setActiveNoteText] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);

  // AI/dictionary context states
  const [selectedText, setSelectedText] = useState<string>("");
  const [dictFeedback, setDictFeedback] = useState<string | null>(null);
  const [tapFeedback, setTapFeedback] = useState<"next" | "prev" | null>(null);
  const [selectMode, setSelectMode] = useState<boolean>(false);
  const [selectionCoords, setSelectionCoords] = useState<{ x: number; y: number } | null>(null);
  const [showAnalyzer, setShowAnalyzer] = useState<boolean>(false);
  const [analyzedText, setAnalyzedText] = useState<string>("");
  const [vocabBreakdown, setVocabBreakdown] = useState<{ word: string; entry: any }[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [activeWordDefinition, setActiveWordDefinition] = useState<any>(null);

  // Audiobook / Speech states
  const [showAudiobook, setShowAudiobook] = useState<boolean>(false);
  const [isPlayingSpeech, setIsPlayingSpeech] = useState<boolean>(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("");
  const [currentParagraphIdx, setCurrentParagraphIdx] = useState<number>(-1);

  const [isAudiobookExpanded, setIsAudiobookExpanded] = useState<boolean>(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const zipRef = useRef<JSZip | null>(null);
  const rootDirRef = useRef<string>("");
  const blobUrlsRef = useRef<string[]>([]);
  // Maps an EPUB internal href (normalized) -> spine chapter index, so in-book
  // Table-of-Contents links (e.g. <a href="chapter1.xhtml">) navigate correctly.
  const hrefToIndexRef = useRef<Map<string, number>>(new Map());
  const pointerStartRef = React.useRef<{ x: number; y: number; time: number } | null>(null);

  // Font choices
  const fontFamilies = [
    { name: "Lora Serif", value: "font-serif" },
    { name: "Inter Sans", value: "font-sans" },
    { name: "JetBrains Mono", value: "font-mono" },
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
      
      // Use the article's actual rendered width (border-box, excludes the
      // container's own padding). This is the true on-screen width of one page,
      // whether single- or double-column. Using the padded container width
      // (or half-width+gap) made each page turn overshoot and clip the left
      // column — the "page display" bug.
      const textWidth = container.offsetWidth;
      if (textWidth <= 0) return;
      
      const scrollWidth = container.scrollWidth;
      const gapWidth = 40;
      // Column width for the CSS column layout (matches the measured width so
      // the content fills exactly one page stride).
      const colWidth = useDoubleColumns ? (textWidth - gapWidth) / 2 : textWidth;
      // The exact horizontal stride is the full page width plus the column gap (40px)
      // minus any desired page overlap.
      const step = textWidth + gapWidth - pageOverlap;
      // Avoid tiny subpixel overflows from creating a blank page
      const adjustedScroll = Math.max(textWidth, scrollWidth - 10);
      const calculatedPages = Math.max(1, Math.ceil((adjustedScroll - textWidth) / step) + 1);
      setTotalPages(calculatedPages);
      setContainerWidth(textWidth);
      pageStepRef.current = step;
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
    letterSpacing,
    hyphenation
  ]);

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
  }, [useDoubleColumns]);

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
      letterSpacing,
      hyphenation,
      pageTurnMode
    };
    localStorage.setItem("kora_reader_prefs", JSON.stringify(prefs));
  }, [fontSize, fontFamily, theme, marginSize, lineSpacing, isContinuous, brightness, doubleColumns, letterSpacing, hyphenation, pageTurnMode]);

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

  // Record highlighted/selected text for AI helper and handle Selection Mode
  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        const text = selection.toString().trim();
        setSelectedText(text);
        
        try {
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            setSelectionCoords({
              x: rect.left + rect.width / 2,
              y: rect.bottom + 10
            });
          }
        } catch (e) {
          console.warn("Failed to get selection coords:", e);
        }
      } else {
        // Clear coords when selection collapses
        setSelectionCoords(null);
      }
    };

    document.addEventListener("selectionchange", handleSelection);
    
    // Dictionary lookup on double tap -> also enters select mode for convenience!
    const handleDoubleClick = async () => {
      const selection = window.getSelection();
      const word = selection?.toString().trim();
      if (word && word.length > 0 && word.split(/\s+/).length === 1) {
        setSelectMode(true);
        setSelectedText(word);
        lookupDictionary(word);
      }
    };
    document.addEventListener("dblclick", handleDoubleClick);

    // Enter Select Mode and highlight word on long press
    let pressTimer: NodeJS.Timeout | null = null;
    let pressStartX = 0;
    let pressStartY = 0;

    const handlePointerDown = (e: PointerEvent) => {
      // Don't restart long-press timer if already in selectMode
      if (selectMode) return;
      
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
                setSelectMode(true);
                
                try {
                  const rect = newRange.getBoundingClientRect();
                  setSelectionCoords({
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10
                  });
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
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.removeEventListener("selectionchange", handleSelection);
      document.removeEventListener("dblclick", handleDoubleClick);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
      if (pressTimer) clearTimeout(pressTimer);
    };
  }, [selectMode]);

  const handleNextPage = () => {
    playFlipSound();
    setTapFeedback("next");
    setTimeout(() => setTapFeedback(null), 350);
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
      if (!href.startsWith("http") && !href.startsWith("mailto:") && !href.startsWith("#")) {
        e.preventDefault();
      }
      return;
    }
    
    // If text is highlighted, clear it and continue to allow page turn
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      sel.removeAllRanges();
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
          let chapterTitle = chapterDoc.querySelector("title")?.textContent || 
                             chapterDoc.querySelector("h1")?.textContent || 
                             chapterDoc.querySelector("h2")?.textContent || 
                             `Chapter ${i + 1}`;

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
          img.setAttribute("class", "max-w-full h-auto my-4 mx-auto block rounded shadow-sm");
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
      const textWidth = container.offsetWidth;
      if (textWidth <= 0) return;
      const scrollWidth = container.scrollWidth;
      const gapWidth = 40;
      const colWidth = useDoubleColumns ? (textWidth - gapWidth) / 2 : textWidth;
      // The exact horizontal stride is the full page width plus the column gap (40px)
      // minus any desired page overlap.
      const step = textWidth + gapWidth - pageOverlap;
      
      // Avoid tiny subpixel overflows from creating a blank page
      const adjustedScroll = Math.max(textWidth, scrollWidth - 10);
      const calculatedPages = Math.max(1, Math.ceil((adjustedScroll - textWidth) / step) + 1);
      setTotalPages(calculatedPages);
      setContainerWidth(textWidth);
      pageStepRef.current = step;
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
      const allVoices = window.speechSynthesis.getVoices();
      setVoices(allVoices);

      // Select default voice (prefer english)
      const defaultVoice = 
        allVoices.find((v) => v.lang.startsWith("en-US") && v.name.includes("Natural")) ||
        allVoices.find((v) => v.lang.startsWith("en") && v.localService) ||
        allVoices.find((v) => v.lang.startsWith("en")) ||
        allVoices[0];

      if (defaultVoice) {
        setSelectedVoiceName(defaultVoice.name);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
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

    const textToSpeak = domElements[idx].textContent?.trim() || "";
    if (!textToSpeak) {
      speakParagraph(idx + 1);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    
    // Assign voice if selected
    const selectedVoice = voices.find((v) => v.name === selectedVoiceName);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.rate = speechRate;

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
    setSelectedText("");
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
          y: rect.bottom + 10
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
              const newMode = !selectMode;
              setSelectMode(newMode);
              if (!newMode) {
                setSelectedText("");
                setSelectionCoords(null);
                const sel = window.getSelection();
                if (sel) sel.removeAllRanges();
              }
              setShowToc(false);
              setShowSettings(false);
              setShowAudiobook(false);
              setShowNotes(false);
            }}
            className={`p-2 rounded-xl hover:bg-neutral-500/10 transition ${selectMode ? 'bg-kindle-accent/20 text-kindle-accent font-semibold' : ''}`}
            title="Text Selection Mode"
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
              <span className="font-sans font-semibold text-sm flex items-center gap-2 text-[#5c5346]">
                <Type className="w-4 h-4 text-[#5c5346]" />
                Typography Settings
              </span>
              <button onClick={() => setShowSettings(false)} className="text-xs p-1 hover:bg-neutral-500/10 rounded">
                Done
              </button>
            </div>

            {/* Font Family Selection */}
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-2">Font Style</label>
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
            <div className="mb-5">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs opacity-75 font-sans">Font Size</label>
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

            {/* Reading Modes (Themes) */}
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-2">Reading Theme</label>
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

            {/* Line Spacing */}
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-2">Line Spacing</label>
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

            {/* Brightness Control */}
            <div className="mb-5">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs opacity-75 font-sans">Brightness</label>
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

            {/* Grayscale Images Toggle */}
            <div className="mb-5 flex items-center justify-between">
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

            {/* Double Column Spread Toggle */}
            <div className="mb-5 flex items-center justify-between">
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

            {/* Page Overlap (KOReader-style) */}
            <div className="mb-5">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs opacity-75 font-sans">Page Overlap</label>
                <span className="text-[10px] font-mono">{pageOverlap}px</span>
              </div>
              <p className="text-[10px] text-kindle-text-muted mb-2">Repeat the last few lines on the next page (like KOReader).</p>
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

            {/* Letter Spacing Selection */}
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-2">Letter Spacing</label>
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

            {/* Hyphenation Toggle */}
            <div className="mb-5 flex items-center justify-between">
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

            {/* Margins */}
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-2">Margins</label>
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

            {/* Page Change Control Options */}
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-2">Page Turn Zones</label>
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
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-2">Page Transition Effect</label>
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

            {/* Export Actions */}
            <div className="pt-4 border-t border-kindle-border space-y-2">
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
                        <span className="text-[11px] md:text-xs text-neutral-700 dark:text-neutral-300 leading-snug">{step.text}</span>
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
            <div className="flex-1 flex flex-col relative">
              {/* Floating highlighted text helper tip */}
              {selectedText && !selectMode && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-[#1e1c19] text-white px-4 py-2.5 rounded-full shadow-xl text-xs font-sans flex items-center gap-3 border border-[#3e3933] animate-fade-in max-w-[90vw] w-max md:max-w-3xl overflow-x-auto no-scrollbar">
                  <span className="font-medium truncate max-w-[100px] md:max-w-xs shrink-0">Selected: "{selectedText}"</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button 
                      onClick={() => handleSaveHighlight("yellow")}
                      className="bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-200 px-2.5 py-1 rounded-lg text-[10px] font-bold transition flex items-center gap-1 border border-yellow-500/30"
                    >
                      <Highlighter className="w-3 h-3" /> Highlight
                    </button>
                    <button 
                      onClick={() => {
                        addDictionaryEntry({
                          word: selectedText.length > 30 ? selectedText.slice(0, 30) + "..." : selectedText,
                          definition: `Passage highlighted from '${book.title}': "${selectedText}"`,
                          partOfSpeech: "excerpt",
                          isCustom: true
                        });
                        setDictFeedback(`Saved excerpt to personal dictionary!`);
                        setTimeout(() => setDictFeedback(null), 2500);
                        setSelectedText("");
                      }}
                      className="bg-[#2c3e2b] hover:bg-[#3d5c3b] text-emerald-200 px-2.5 py-1 rounded-lg text-[10px] font-bold transition flex items-center gap-1 border border-emerald-500/20"
                    >
                      <BookMarked className="w-3 h-3 text-emerald-400" /> Save
                    </button>
                    <button onClick={() => setSelectedText("")} className="text-neutral-400 hover:text-white pl-1.5 text-sm font-semibold">✕</button>
                  </div>
                </div>
              )}

              {/* Select Mode Top Banner */}
              {selectMode && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-[#1e1c19]/90 backdrop-blur-md text-white px-5 py-3 rounded-2xl shadow-2xl text-xs font-sans flex items-center gap-4 border border-amber-500/20 animate-fade-in w-[90%] md:w-max max-w-xl justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping shrink-0" />
                    <span className="font-semibold tracking-wider text-amber-400 text-[10px] uppercase">Selection Mode Active</span>
                    <span className="hidden md:inline text-neutral-400">| Drag text or double-click.</span>
                  </div>
                  <button 
                    onClick={() => {
                      setSelectMode(false);
                      setSelectedText("");
                      setSelectionCoords(null);
                      const sel = window.getSelection();
                      if (sel) sel.removeAllRanges();
                    }}
                    className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition font-sans"
                  >
                    Exit Selection Mode
                  </button>
                </div>
              )}

              {/* Custom Floating Context Selection Toolbar */}
              {selectMode && selectedText && (
                <div 
                  className="fixed z-50 bg-[#1e1c19]/95 backdrop-blur-lg text-white px-3 py-2 rounded-2xl shadow-3xl flex items-center gap-1.5 border border-amber-500/30 animate-in fade-in zoom-in-95 duration-200 max-w-[95vw] md:max-w-max overflow-x-auto no-scrollbar"
                  style={{
                    top: selectionCoords ? `${selectionCoords.y}px` : "15%",
                    left: selectionCoords ? `${selectionCoords.x}px` : "50%",
                    transform: selectionCoords ? "translate(-50%, 0)" : "translate(-50%, -50%)",
                    position: "fixed",
                    boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5)"
                  }}
                >
                  {/* Color Highlighter Dots */}
                  <div className="flex items-center gap-1.5 px-2 border-r border-neutral-800 pr-3 mr-1 shrink-0">
                    {(["yellow", "green", "blue", "pink"] as const).map((color) => {
                      const colorClasses = {
                        yellow: "bg-yellow-400 hover:scale-110",
                        green: "bg-emerald-400 hover:scale-110",
                        blue: "bg-sky-400 hover:scale-110",
                        pink: "bg-pink-400 hover:scale-110"
                      };
                      return (
                        <button
                          key={color}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSaveHighlight(color)}
                          className={`w-4 h-4 rounded-full transition-all duration-150 ${colorClasses[color]}`}
                          title={`Highlight ${color}`}
                        />
                      );
                    })}
                  </div>

                  {/* Actions */}
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => analyzeSentenceOffline(selectedText)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest transition text-amber-400 shrink-0"
                    title="Analyze word or sentence offline"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Analyze (Offline)
                  </button>

                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={expandSelectionToSentence}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest transition text-neutral-300 shrink-0"
                    title="Select entire sentence containing current selection"
                  >
                    <Type className="w-3.5 h-3.5" /> Select Sentence
                  </button>

                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      navigator.clipboard.writeText(selectedText);
                      setDictFeedback("Copied to clipboard!");
                      setTimeout(() => setDictFeedback(null), 2000);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest transition text-neutral-300 shrink-0"
                    title="Copy selection"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>

                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      addDictionaryEntry({
                        word: selectedText.length > 30 ? selectedText.slice(0, 30) + "..." : selectedText,
                        definition: `Saved vocabulary from '${book.title}': "${selectedText}"`,
                        partOfSpeech: "phrase",
                        isCustom: true
                      });
                      setDictFeedback("Saved to personal dictionary!");
                      setTimeout(() => setDictFeedback(null), 2500);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest transition text-neutral-300 shrink-0"
                    title="Save to offline dictionary"
                  >
                    <BookMarked className="w-3.5 h-3.5" /> Save Vocab
                  </button>

                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setActiveNoteText(prev => `${prev}\n"${selectedText}"\n`);
                      setShowNotes(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest transition text-neutral-300 shrink-0"
                    title="Add to Notes"
                  >
                    <FileText className="w-3.5 h-3.5" /> Add Note
                  </button>

                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const sel = window.getSelection();
                      if (sel) sel.removeAllRanges();
                      setSelectedText("");
                    }}
                    className="p-2 text-neutral-400 hover:text-white hover:bg-white/5 rounded-xl transition text-[10px]"
                    title="Clear selection"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Dict Saved Feedback Indicator */}
              {dictFeedback && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-emerald-950 text-emerald-100 border border-emerald-500/40 px-4 py-2 rounded-full text-xs font-sans flex items-center gap-2 shadow-lg animate-in fade-in slide-in-from-top-2 duration-250">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{dictFeedback}</span>
                </div>
              )}

              {/* The Chapter Text Container — a strict single-page viewport */}
              <div 
                ref={viewerRef}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                className={`flex-1 relative py-3 px-3 md:py-8 md:px-16 flex items-start justify-start ${selectMode ? "select-text cursor-text" : "select-none cursor-default"} mx-auto w-full ${useDoubleColumns ? "max-w-[95%] xl:max-w-7xl px-4 md:px-8" : marginSize}`}
                style={{ height: isMobile ? "calc(100vh - 120px)" : "calc(100vh - 185px)" }}
              >
                <div className="w-full h-full overflow-hidden relative flex items-start justify-start" style={{ perspective: "1200px" }}>
                  {/* Premium Page Curl & Light Sweep shadow overlay */}
                  {pageTransitionEffect === "paper-flip" && shouldAnimate && (
                    <motion.div
                      key={`shadow-${currentPageNum}`}
                      initial={{ 
                        x: flipDirection === "next" ? "100%" : "-100%",
                        opacity: 0.5
                      }}
                      animate={{ 
                        x: flipDirection === "next" ? "-100%" : "100%",
                        opacity: 0
                      }}
                      transition={{ 
                        duration: 0.45, 
                        ease: "easeInOut" 
                      }}
                      className="absolute inset-y-0 w-1/3 pointer-events-none z-10 bg-gradient-to-r from-transparent via-black/10 dark:via-black/30 to-transparent shadow-[0_0_30px_currentColor]"
                      style={{ opacity: 0.1 }}
                    />
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

                  {pageTurnMode === "floating-buttons" && (
                    <>
                      <button
                        onPointerUp={(e) => {
                          e.stopPropagation();
                          handlePrevPage();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        disabled={currentChapterIdx === 0 && currentPageNum === 1}
                        className={`absolute left-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full shadow-lg border backdrop-blur-xs transition-all duration-200 ${
                          theme === "dark"
                            ? "bg-neutral-900/60 text-white border-white/10 hover:bg-neutral-800"
                            : "bg-white/60 text-neutral-800 border-neutral-200 hover:bg-neutral-50/80"
                        } disabled:opacity-20 disabled:pointer-events-none`}
                        title="Previous Page"
                      >
                        <ChevronLeft className="w-6 h-6" />
                      </button>
                      <button
                        onPointerUp={(e) => {
                          e.stopPropagation();
                          handleNextPage();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        disabled={currentChapterIdx === chapters.length - 1 && currentPageNum === totalPages}
                        className={`absolute right-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full shadow-lg border backdrop-blur-xs transition-all duration-200 ${
                          theme === "dark"
                            ? "bg-neutral-900/60 text-white border-white/10 hover:bg-neutral-800"
                            : "bg-white/60 text-neutral-800 border-neutral-200 hover:bg-neutral-50/80"
                        } disabled:opacity-20 disabled:pointer-events-none`}
                        title="Next Page"
                      >
                        <ChevronRight className="w-6 h-6" />
                      </button>
                    </>
                  )}

                  <motion.article 
                    ref={contentRef}
                    animate={{ 
                      x: -(currentPageNum - 1) * pageStepRef.current,
                      rotateY: pageTransitionEffect === "paper-flip" && shouldAnimate 
                        ? [0, flipDirection === "next" ? -6 : 6, 0] 
                        : 0,
                      skewY: pageTransitionEffect === "paper-flip" && shouldAnimate 
                        ? [0, flipDirection === "next" ? -2.5 : 2.5, 0] 
                        : 0,
                      scaleX: pageTransitionEffect === "paper-flip" && shouldAnimate 
                        ? [1, 0.97, 1] 
                        : 1
                    }}
                    transition={shouldAnimate ? (pageTransitionEffect === "spring" ? { type: "spring", stiffness: 220, damping: 28, mass: 0.8 } : pageTransitionEffect === "none" ? { duration: 0 } : { type: "tween", ease: [0.33, 1, 0.68, 1], duration: 0.35 }) : { duration: 0 }}
                    className={`w-full ml-0 ${fontFamily} ${letterSpacing} ${hyphenation ? "hyphens-auto text-justify" : "hyphens-none text-left"} selection:bg-kindle-accent/20 selection:text-kindle-text ${grayscaleImages ? "[&_img]:grayscale" : ""}`}
                    style={{
                      fontSize: `${fontSize}px`,
                      lineHeight: lineSpacing,
                      columnWidth: `${useDoubleColumns ? (containerWidth - 40) / 2 : containerWidth}px`,
                      columnGap: '40px',
                      height: '100%',
                      columnFill: 'auto',
                      // Strictly clip to the current page so exactly one page (or one
                      // 2-page spread) is visible at a time — true page-by-page reading.
                      overflow: 'visible',
                      // Center "book spine" gutter between the two columns in 2-col mode
                      boxShadow: useDoubleColumns ? 'inset 50% 0 0 -20px rgba(0,0,0,0.10)' : 'none',
                      transformOrigin: flipDirection === "next" ? "left center" : "right center"
                    }}
                  >
                    <div className={`mb-6 border-b ${activeTheme.border} pb-4`} style={{ columnSpan: "all" }}>
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
                      className={`epub-content leading-relaxed space-y-5 ${fontFamily} break-words ${showAudiobook ? "cursor-pointer" : ""}`}
                      dangerouslySetInnerHTML={{ __html: chapters[currentChapterIdx]?.content || "" }}
                    />

                    {/* Bottom Controls */}
                    <div className={`mt-12 pt-6 border-t ${activeTheme.border} flex justify-between items-center text-xs font-sans opacity-70`} style={{ columnSpan: "all" }}>
                      <span>End of {chapters[currentChapterIdx]?.title}</span>
                      <span>{Math.round((currentChapterIdx / chapters.length) * 100)}% read</span>
                    </div>
                  </motion.article>
                </div>

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

              {/* Audiobook Bottom Control Bar */}
              {showAudiobook && (
                <div className={`fixed bottom-0 left-0 w-full border-t ${activeTheme.border} ${activeTheme.card} ${activeTheme.text} px-4 py-2 md:px-6 md:py-3 z-[100] shadow-[0_-8px_30px_rgb(0,0,0,0.12)] animate-in slide-in-from-bottom duration-250 shrink-0 font-sans`}>
                  <div className="max-w-6xl mx-auto">
                    {/* Collapsed / Mini View */}
                    <div className="flex items-center justify-between gap-4">
                      {/* Left Column: Visual feedback & Status */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-full border-2 border-neutral-500/10 flex items-center justify-center bg-neutral-900 shrink-0 shadow ${isPlayingSpeech ? "animate-spin" : ""}`} style={{ animationDuration: "6s" }}>
                          <div className="w-3.5 h-3.5 rounded-full bg-amber-500 flex items-center justify-center text-neutral-900 font-bold text-[7px]">
                            A
                          </div>
                        </div>
                        
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 uppercase tracking-wider">
                              <Headphones className="w-3 h-3" />
                              Narrator
                            </span>
                            {isPlayingSpeech && (
                              <div className="flex items-end gap-0.5 h-2">
                                <div className="w-0.5 bg-amber-500 rounded-full animate-bounce h-1.5" style={{ animationDelay: "0.1s" }} />
                                <div className="w-0.5 bg-amber-600 rounded-full animate-bounce h-2" style={{ animationDelay: "0.3s" }} />
                              </div>
                            )}
                          </div>
                          <p className="text-[10px] opacity-70 truncate max-w-[150px] md:max-w-[300px] font-serif leading-none mt-0.5">
                            {currentParagraphIdx >= 0 ? `Reading Section ${currentParagraphIdx + 1}` : "Ready to listen"}
                          </p>
                        </div>
                      </div>

                      {/* Right Column: Mini Controls & Expand Toggle */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={toggleSpeechPlayback}
                          className="w-8 h-8 rounded-full bg-amber-500 hover:bg-amber-600 text-neutral-950 flex items-center justify-center shadow-sm transform active:scale-95 transition"
                          title={isPlayingSpeech ? "Pause" : "Play"}
                        >
                          {isPlayingSpeech ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                        </button>

                        <button 
                          onClick={() => {
                            console.log("Toggling audiobook expanded:", !isAudiobookExpanded);
                            setIsAudiobookExpanded(prev => !prev);
                          }}
                          className={`p-2 rounded-xl transition ${isAudiobookExpanded ? 'bg-neutral-500/20' : 'hover:bg-neutral-500/10'} pointer-events-auto relative z-[110]`}
                          title={isAudiobookExpanded ? "Collapse Controls" : "Expand Controls"}
                        >
                          {isAudiobookExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        </button>

                        <button 
                          onClick={() => { stopSpeech(); setShowAudiobook(false); }}
                          className="p-2 hover:bg-neutral-500/10 rounded-xl text-xs"
                          title="Close Narrator"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded View: Voice & Speed Settings */}
                    {isAudiobookExpanded && (
                      <div className="mt-4 pt-4 border-t border-neutral-500/10 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-300 max-h-[40vh] overflow-y-auto custom-scrollbar">
                        {/* Playback step controls */}
                        <div className="flex items-center gap-4 justify-center md:justify-start">
                          <button
                            onClick={() => speakParagraph(Math.max(0, currentParagraphIdx - 1))}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-500/20 hover:bg-neutral-500/10 transition text-[10px] font-bold uppercase tracking-widest"
                          >
                            <Rewind className="w-3.5 h-3.5" /> Previous
                          </button>
                          <button
                            onClick={() => speakParagraph(currentParagraphIdx + 1)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-500/20 hover:bg-neutral-500/10 transition text-[10px] font-bold uppercase tracking-widest"
                          >
                            Next <FastForward className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={stopSpeech}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50/10 transition"
                            title="Reset"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center gap-4">
                          {/* Voice selection */}
                          <div className="w-full">
                            <label className="text-[9px] font-bold uppercase tracking-widest opacity-50 block mb-1">Voice</label>
                            <select
                              value={selectedVoiceName}
                              onChange={(e) => {
                                setSelectedVoiceName(e.target.value);
                                if (isPlayingSpeech) {
                                  setTimeout(() => speakParagraph(currentParagraphIdx >= 0 ? currentParagraphIdx : 0), 100);
                                }
                              }}
                              className="w-full p-1.5 text-[11px] rounded-lg border border-neutral-500/20 bg-transparent focus:ring-1 focus:ring-amber-500 focus:outline-none text-current"
                            >
                              {voices.length === 0 ? (
                                <option value="">No System Voices</option>
                              ) : (
                                voices.map((v) => (
                                  <option key={v.name} value={v.name} className="text-neutral-900 bg-white">
                                    {v.name.slice(0, 18)} ({v.lang.split("-")[0]})
                                  </option>
                                ))
                              )}
                            </select>
                          </div>

                          {/* Speed controls */}
                          <div className="w-full sm:w-48">
                            <div className="flex justify-between items-center mb-1">
                              <label className="text-[9px] font-bold uppercase tracking-widest opacity-50">Speed</label>
                              <span className="text-[10px] font-mono">{speechRate}x</span>
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
                                if (isPlayingSpeech) {
                                  setTimeout(() => speakParagraph(currentParagraphIdx >= 0 ? currentParagraphIdx : 0), 100);
                                }
                              }}
                              className="w-full accent-amber-500 cursor-pointer h-1 bg-neutral-500/20 rounded-lg appearance-none"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Footer Chapter Navigate Buttons */}
              <footer className={`px-6 py-4 border-t ${activeTheme.border} flex items-center justify-between font-sans shrink-0`}>
                {!(pageTurnMode === "fifty-fifty" || pageTurnMode === "classic-ereader" || pageTurnMode === "margins-only") ? (
                  <button
                    id="prev-chapter-btn"
                    disabled={currentChapterIdx === 0 && currentPageNum === 1}
                    onClick={handlePrevPage}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-neutral-500/10 transition"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Prev Page</span>
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
                    page {currentPageNum} of {totalPages} (Ch. {currentChapterIdx + 1}) • {Math.min(100, Math.max(0, Math.round(
                    ((currentChapterIdx + (currentPageNum - 1) / (totalPages || 1)) / (chapters.length || 1)) * 100
                  )))}%
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
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-kindle-accent transition shadow-sm"
                    >
                      <span>Next Page</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </footer>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
