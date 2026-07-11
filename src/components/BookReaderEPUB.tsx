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
import { 
  X, ChevronLeft, ChevronRight, Menu, Settings, 
  BookOpen, Sparkles, AlertCircle, Type, Layout, Info,
  Headphones, Play, Pause, RotateCcw, Volume2, FastForward, Rewind,
  BookMarked, Copy, Check, FileText, Highlighter, Trash2
} from "lucide-react";
import { lookupWord, addDictionaryEntry } from "../lib/dictionary";

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
  };
}

interface EpubChapter {
  id: string;
  href: string;
  title: string;
  content: string;
  fullPath: string;
}

export default function BookReaderEPUB({ book, userId, onClose, onProgressUpdate, readerPrefs }: BookReaderEPUBProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  const [currentChapterIdx, setCurrentChapterIdx] = useState<number>(0);
  
  // Customization states (seeded from persisted settings, fallback to defaults)
  const [fontSize, setFontSize] = useState<number>(readerPrefs?.fontSize ?? 18); // px
  const [fontFamily, setFontFamily] = useState<string>(readerPrefs?.fontFamily ?? "font-serif");
  const [theme, setTheme] = useState<string>(readerPrefs?.theme ?? "light"); // light, dark, sepia, green
  const [marginSize, setMarginSize] = useState<string>(readerPrefs?.marginSize ?? "max-w-2xl px-6");
  const [lineSpacing, setLineSpacing] = useState<number>(readerPrefs?.lineSpacing ?? 1.6);
  const [isContinuous, setIsContinuous] = useState<boolean>(readerPrefs?.isContinuous ?? false);
  const [brightness, setBrightness] = useState<number>(readerPrefs?.brightness ?? 100);
  
  // Dictionary states
  const [dictionaryWord, setDictionaryWord] = useState<string | null>(null);
  const [dictionaryData, setDictionaryData] = useState<any>(null);
  const [dictLoading, setDictLoading] = useState<boolean>(false);
  
  // Pagination & Layout States
  const [currentPageNum, setCurrentPageNum] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(600);
  const [doubleColumns, setDoubleColumns] = useState<boolean>(false); // Dual page mode
  const [letterSpacing, setLetterSpacing] = useState<string>("tracking-normal"); // tracking-normal, tracking-wide, tracking-wider
  const [hyphenation, setHyphenation] = useState<boolean>(true);
  const [shouldAnimate, setShouldAnimate] = useState<boolean>(true);

  // Disable animation temporarily during visual style changes
  useEffect(() => {
    setShouldAnimate(false);
    const t = setTimeout(() => setShouldAnimate(true), 250);
    return () => clearTimeout(t);
  }, [fontSize, fontFamily, theme, marginSize, lineSpacing, doubleColumns, letterSpacing, hyphenation]);
  
  // Layout states
  const [showToc, setShowToc] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showAiAssistant, setShowAiAssistant] = useState<boolean>(false);
  const [showNotes, setShowNotes] = useState<boolean>(false);
  
  // Highlights & Notes State
  const [chapterNotesData, setChapterNotesData] = useState<Record<number, ChapterNote>>({});
  const [highlightsData, setHighlightsData] = useState<BookHighlight[]>([]);
  const [activeNoteText, setActiveNoteText] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);

  // AI assistant states
  const [aiResponse, setAiResponse] = useState<string>("");
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [customAiQuery, setCustomAiQuery] = useState<string>("");
  const [selectedText, setSelectedText] = useState<string>("");
  const [dictFeedback, setDictFeedback] = useState<string | null>(null);
  const [tapFeedback, setTapFeedback] = useState<"next" | "prev" | null>(null);

  // Audiobook / Speech states
  const [showAudiobook, setShowAudiobook] = useState<boolean>(false);
  const [isPlayingSpeech, setIsPlayingSpeech] = useState<boolean>(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("");
  const [currentParagraphIdx, setCurrentParagraphIdx] = useState<number>(-1);

  const contentRef = useRef<HTMLDivElement>(null);
  const zipRef = useRef<JSZip | null>(null);
  const rootDirRef = useRef<string>("");
  const blobUrlsRef = useRef<string[]>([]);
  // Maps an EPUB internal href (normalized) -> spine chapter index, so in-book
  // Table-of-Contents links (e.g. <a href="chapter1.xhtml">) navigate correctly.
  const hrefToIndexRef = useRef<Map<string, number>>(new Map());

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
      const width = container.getBoundingClientRect().width;
      if (width <= 0) return;
      
      const scrollWidth = container.scrollWidth;
      const gapWidth = 40;
      const colWidth = doubleColumns ? (width - gapWidth) / 2 : width;
      const step = colWidth + gapWidth;
      
      // Calculate total pages
      const calculatedPages = Math.max(1, Math.ceil(scrollWidth / step));
      setTotalPages(calculatedPages);
      setContainerWidth(width);
    }, 120);
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
    letterSpacing,
    hyphenation
  ]);

  useEffect(() => {
    window.addEventListener("resize", recalculateLayout);
    return () => window.removeEventListener("resize", recalculateLayout);
  }, [doubleColumns]);

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
      hyphenation
    };
    localStorage.setItem("kora_reader_prefs", JSON.stringify(prefs));
  }, [fontSize, fontFamily, theme, marginSize, lineSpacing, isContinuous, brightness, doubleColumns, letterSpacing, hyphenation]);

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

  // Record highlighted/selected text for AI helper
  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        setSelectedText(selection.toString().trim());
      }
    };

    document.addEventListener("selectionchange", handleSelection);
    
    // Dictionary lookup on double tap
    const handleDoubleClick = async () => {
      const selection = window.getSelection();
      const word = selection?.toString().trim();
      if (word && word.length > 0 && word.split(/\s+/).length === 1) {
        lookupDictionary(word);
      }
    };
    document.addEventListener("dblclick", handleDoubleClick);

    return () => {
      document.removeEventListener("selectionchange", handleSelection);
      document.removeEventListener("dblclick", handleDoubleClick);
    };
  }, []);

  const handleNextPage = () => {
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

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.closest("button") || 
      target.closest("a") || 
      target.closest("aside") || 
      target.closest("input") || 
      target.closest("select") || 
      target.closest("textarea") || 
      target.closest(".tts-highlight")
    ) {
      return;
    }
    
    // If text is highlighted, don't trigger page turn
    const sel = window.getSelection()?.toString();
    if (sel && sel.trim().length > 0) return;

    const container = contentRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const isLeftSide = clickX < rect.width / 2;
    
    if (isLeftSide) {
      handlePrevPage();
    } else {
      handleNextPage();
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
      const localDef = lookupWord(word);
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
          // Register spine href (and its basename) -> chapter index for in-book TOC links.
          const norm = pathResolve(rootDir, relativeHref).toLowerCase();
          hrefToIndexRef.current.set(norm, i);
          hrefToIndexRef.current.set(relativeHref.toLowerCase(), i);
        }
      }

      if (parsedChapters.length === 0) {
        throw new Error("No readable chapters found inside this EPUB file.");
      }

      setChapters(parsedChapters);
      setLoading(false);
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
        console.warn("EPUB image not found, dropping:", relativeSrc);
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
      const width = container.getBoundingClientRect().width;
      const scrollWidth = container.scrollWidth;
      const gapWidth = 40;
      const colWidth = doubleColumns ? (width - gapWidth) / 2 : width;
      const step = colWidth + gapWidth;
      
      const calculatedPages = Math.max(1, Math.ceil(scrollWidth / step));
      setTotalPages(calculatedPages);
      setContainerWidth(width);
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
    setShowAiAssistant(false);
  };

  async function requestAiAssistant(mode: string, query = "") {
    setAiLoading(true);
    setAiResponse("");
    try {
      const fullChapterText = chapters[currentChapterIdx]?.content || "";
      
      // Simulate highly responsive analytical processing lag (400ms)
      await new Promise((resolve) => setTimeout(resolve, 400));
      
      const response = await runOfflineCompanion(mode, selectedText, fullChapterText, book.title, query);
      setAiResponse(response);
    } catch (err: any) {
      setAiResponse(`Assistant Error: ${err.message || "Failed to analyze book content."}`);
    } finally {
      setAiLoading(false);
    }
  }

  const handleTextViewerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // In-book TOC links: data-epub-href holds the target chapter index.
    const epubLink = target.closest("[data-epub-href]") as HTMLElement | null;
    if (epubLink) {
      const idx = parseInt(epubLink.getAttribute("data-epub-href") || "", 10);
      if (!isNaN(idx) && idx >= 0 && idx < chapters.length) {
        updateProgress(idx);
        return;
      }
    }
    if (!showAudiobook) return;
    const readableEl = target.closest("p, h1, h2, h3, h4, li");
    if (!readableEl) return;

    const elements = getDOMElementsToRead();
    const idx = elements.indexOf(readableEl);
    if (idx !== -1) {
      speakParagraph(idx);
    }
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
            onClick={() => { setShowNotes(!showNotes); setShowSettings(false); setShowToc(false); setShowAudiobook(false); setShowAiAssistant(false); }}
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
              setShowAiAssistant(false);
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
            id="toggle-ai-assistant"
            onClick={() => { setShowAiAssistant(!showAiAssistant); setShowNotes(false); setShowSettings(false); setShowToc(false); setShowAudiobook(false); }}
            className={`flex items-center gap-2 px-4 py-2 ml-2 rounded-xl bg-kindle-text hover:bg-kindle-accent text-kindle-bg font-sans text-xs font-bold transition shadow-sm ${showAiAssistant ? 'ring-1 ring-kindle-accent' : ''}`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">AI Helper</span>
          </button>
        </div>
      </header>

      {/* 2. Main Reader Split Board */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar: Table of Contents */}
        {showToc && (
          <aside className={`w-full md:w-80 border-b md:border-b-0 border-r ${activeTheme.border} ${activeTheme.card} overflow-y-auto flex flex-col absolute md:relative inset-x-0 bottom-0 top-[30%] md:top-auto z-40 md:z-10 shadow-2xl md:shadow-none animate-in slide-in-from-bottom md:slide-in-from-left duration-200`}>
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
          <aside className={`w-full md:w-80 border-b md:border-b-0 border-r ${activeTheme.border} ${activeTheme.card} p-5 overflow-y-auto z-40 flex flex-col absolute md:relative inset-x-0 bottom-0 top-[30%] md:top-auto shadow-2xl md:shadow-none animate-in slide-in-from-bottom md:slide-in-from-left duration-200`}>
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
                      onClick={() => setTheme(tKey)}
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
                  { label: "None", val: "max-w-full px-4" },
                  { label: "Narrow", val: "max-w-2xl px-6" },
                  { label: "Wide", val: "max-w-xl px-12" }
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
        )}

        {/* Sidebar: Audiobook / Text-To-Speech Player */}
        {showAudiobook && (
          <aside className={`w-full md:w-80 border-b md:border-b-0 border-r ${activeTheme.border} ${activeTheme.card} p-5 overflow-y-auto z-40 flex flex-col absolute md:relative inset-x-0 bottom-0 top-[25%] md:top-auto shadow-2xl md:shadow-none animate-in slide-in-from-bottom md:slide-in-from-left duration-200`}>
            <div className={`pb-3 mb-4 border-b ${activeTheme.border} flex justify-between items-center`}>
              <span className="font-sans font-semibold text-sm flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <Headphones className="w-4 h-4" />
                Audiobook Narrator
              </span>
              <button onClick={() => { stopSpeech(); setShowAudiobook(false); }} className="text-xs p-1 hover:bg-neutral-500/10 rounded">
                Close
              </button>
            </div>

            {/* Equalizer animation when playing */}
            <div className="flex flex-col items-center justify-center p-6 bg-neutral-500/5 rounded-2xl border border-neutral-500/10 mb-5 relative overflow-hidden">
              <div className="absolute top-2 right-2 flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full text-[9px] font-mono">
                <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                <span>TTS</span>
              </div>

              {/* Disk / Cassette art */}
              <div className={`w-20 h-20 rounded-full border-4 border-neutral-500/20 flex items-center justify-center bg-neutral-900 shadow-md ${isPlayingSpeech ? "animate-spin" : ""}`} style={{ animationDuration: "6s" }}>
                <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-neutral-900 font-bold text-xs">
                  A
                </div>
              </div>

              {/* Animated Equalizer Waves */}
              {isPlayingSpeech ? (
                <div className="flex items-end gap-1 h-5 mt-4">
                  <div className="w-1 bg-amber-500 rounded-full animate-bounce" style={{ height: "60%", animationDelay: "0.1s" }} />
                  <div className="w-1 bg-amber-600 rounded-full animate-bounce" style={{ height: "100%", animationDelay: "0.3s" }} />
                  <div className="w-1 bg-amber-400 rounded-full animate-bounce" style={{ height: "40%", animationDelay: "0.5s" }} />
                  <div className="w-1 bg-amber-500 rounded-full animate-bounce" style={{ height: "80%", animationDelay: "0.2s" }} />
                  <div className="w-1 bg-amber-400 rounded-full animate-bounce" style={{ height: "50%", animationDelay: "0.4s" }} />
                </div>
              ) : (
                <p className="text-[10px] opacity-60 mt-4 font-sans italic">Narration is paused</p>
              )}

              <p className="text-xs font-semibold text-center mt-3 line-clamp-1 max-w-full font-serif text-current">
                {currentParagraphIdx >= 0 ? `Reading Section ${currentParagraphIdx + 1}` : "Click play to listen"}
              </p>
            </div>

            {/* Playback Primary Controller */}
            <div className="flex items-center justify-center gap-4 mb-6">
              <button
                onClick={() => speakParagraph(Math.max(0, currentParagraphIdx - 1))}
                className="p-2.5 rounded-full border border-neutral-500/20 hover:bg-neutral-500/10 transition"
                title="Previous section"
              >
                <Rewind className="w-4 h-4" />
              </button>

              <button
                onClick={toggleSpeechPlayback}
                className="w-12 h-12 rounded-full bg-amber-500 hover:bg-amber-600 text-neutral-950 flex items-center justify-center shadow-lg transform active:scale-95 transition"
                title={isPlayingSpeech ? "Pause Narration" : "Play Narration"}
              >
                {isPlayingSpeech ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
              </button>

              <button
                onClick={() => speakParagraph(currentParagraphIdx + 1)}
                className="p-2.5 rounded-full border border-neutral-500/20 hover:bg-neutral-500/10 transition"
                title="Next section"
              >
                <FastForward className="w-4 h-4" />
              </button>

              <button
                onClick={stopSpeech}
                className="p-2.5 rounded-full border border-neutral-500/20 text-red-500 hover:bg-red-50/10 transition"
                title="Stop & Clear"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            {/* Narrator Voice Selection */}
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-1.5 font-semibold">Narrator Voice</label>
              <select
                value={selectedVoiceName}
                onChange={(e) => {
                  setSelectedVoiceName(e.target.value);
                  if (isPlayingSpeech) {
                    setTimeout(() => speakParagraph(currentParagraphIdx >= 0 ? currentParagraphIdx : 0), 100);
                  }
                }}
                className="w-full p-2.5 text-xs rounded-xl border border-neutral-500/20 bg-transparent focus:ring-1 focus:ring-amber-500 focus:outline-none text-current"
              >
                {voices.length === 0 ? (
                  <option value="">No System Voices Found</option>
                ) : (
                  voices.map((v) => (
                    <option key={v.name} value={v.name} className="text-neutral-900 bg-white">
                      {v.name} ({v.lang})
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Playback Speed (Rate) Slider */}
            <div className="mb-5">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs opacity-75 font-sans font-semibold">Reading Speed</label>
                <span className="text-[11px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded">
                  {speechRate}x
                </span>
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
              <div className="flex justify-between text-[9px] opacity-50 mt-1 font-mono">
                <span>0.5x</span>
                <span>Normal</span>
                <span>2.0x</span>
              </div>
            </div>

            {/* Quick Helper Text */}
            <div className="mt-auto bg-amber-500/5 border border-amber-500/10 p-3 rounded-xl text-[10px] font-sans leading-relaxed">
              <p className="font-semibold text-amber-600 dark:text-amber-400 mb-0.5 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                Interactive Narration
              </p>
              As the narrator reads, the active passage is highlighted on the screen and scrolled automatically. Tap any paragraph to manually resume reading from there.
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
                
                <div className="mt-5 pt-3 border-t border-current/10">
                  <p className="text-[8px] opacity-40 uppercase tracking-widest text-center font-sans">Tap outside or press ESC to close</p>
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
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto space-y-4">
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex flex-col items-center">
                <AlertCircle className="w-12 h-12 text-red-500 mb-3" />
                <h2 className="font-semibold text-base text-[#2d2a26] mb-1">Ebook Failed to Load</h2>
                <p className="text-xs text-red-700 font-medium leading-relaxed max-w-sm mb-1">{error}</p>
                <p className="text-[10px] text-[#7c7467] max-w-xs mt-1">
                  This typically indicates a corrupted EPUB file or that a mirror returned an HTML page (such as a wait countdown or cloudflare block) instead of the actual book file.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5 w-full justify-center">
                <button 
                  onClick={loadEpubFile}
                  className="px-4 py-2 bg-white border border-[#e8e4de] text-[#5c5346] rounded-xl text-xs font-sans hover:bg-[#f0ede8] transition"
                >
                  Retry Load File
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
                  className="px-4 py-2 bg-[#5c5346] text-white rounded-xl text-xs font-sans hover:bg-[#4a4237] transition font-semibold"
                >
                  Delete File & Re-download
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden relative">
              {/* Floating highlighted text helper tip */}
              {selectedText && (
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
                      onClick={() => { setShowAiAssistant(true); requestAiAssistant("explain"); }}
                      className="bg-amber-500 hover:bg-amber-600 text-neutral-950 px-2.5 py-1 rounded-lg text-[10px] font-bold transition"
                    >
                      Explain
                    </button>
                    <button 
                      onClick={() => { setShowAiAssistant(true); requestAiAssistant("summarize"); }}
                      className="bg-neutral-800 hover:bg-neutral-700 text-white px-2.5 py-1 rounded-lg text-[10px] font-bold transition"
                    >
                      Summarize
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

              {/* Dict Saved Feedback Indicator */}
              {dictFeedback && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-emerald-950 text-emerald-100 border border-emerald-500/40 px-4 py-2 rounded-full text-xs font-sans flex items-center gap-2 shadow-lg animate-in fade-in slide-in-from-top-2 duration-250">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{dictFeedback}</span>
                </div>
              )}

              {/* The Chapter Text Container */}
              <div 
                ref={contentRef}
                onClick={handleContainerClick}
                className="flex-1 overflow-hidden relative py-6 px-4 md:py-8 md:px-16 flex items-start select-none cursor-default"
                style={{ height: "calc(100vh - 185px)" }}
              >
                {/* Visual page slide feedback */}
                <AnimatePresence mode="popLayout">
                  {tapFeedback && (
                    <motion.div
                      key={tapFeedback}
                      initial={{ opacity: 0, x: tapFeedback === "next" ? 120 : -120 }}
                      animate={{ opacity: 0.15, x: 0 }}
                      exit={{ opacity: 0, x: tapFeedback === "next" ? -60 : 60 }}
                      transition={{ duration: 0.35, ease: "easeOut" }}
                      className={`absolute inset-y-0 ${
                        tapFeedback === "next" ? "right-0" : "left-0"
                      } w-1/4 pointer-events-none z-10 bg-gradient-to-r ${
                        tapFeedback === "next" 
                          ? "from-transparent to-amber-500/40" 
                          : "from-amber-500/40 to-transparent"
                      }`}
                    />
                  )}
                </AnimatePresence>

                <motion.article 
                  animate={{ x: -(currentPageNum - 1) * (containerWidth + 40) }}
                  transition={shouldAnimate ? { type: "spring", stiffness: 220, damping: 28, mass: 0.8 } : { duration: 0 }}
                  className={`w-full ${marginSize} ${fontFamily} ${letterSpacing} ${hyphenation ? "hyphens-auto text-justify" : "hyphens-none text-left"} selection:bg-kindle-accent/20 selection:text-kindle-text`}
                  style={{
                    fontSize: `${fontSize}px`,
                    lineHeight: lineSpacing,
                    columnWidth: `${doubleColumns ? (containerWidth - 40) / 2 : containerWidth}px`,
                    columnGap: '40px',
                    height: '100%',
                    columnFill: 'auto',
                    overflow: 'visible'
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
                    onClick={handleTextViewerClick}
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

              {/* Footer Chapter Navigate Buttons */}
              <footer className={`px-6 py-4 border-t ${activeTheme.border} flex items-center justify-between font-sans shrink-0`}>
                <button
                  id="prev-chapter-btn"
                  disabled={currentChapterIdx === 0 && currentPageNum === 1}
                  onClick={handlePrevPage}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-neutral-500/10 transition"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Prev Page</span>
                </button>

                <div className="flex flex-col items-center">
                  <div className="w-48 bg-neutral-200 h-1 rounded-full overflow-hidden mb-1.5">
                    <div 
                      className="bg-kindle-text h-full transition-all duration-500" 
                      style={{ width: `${Math.round(((currentChapterIdx * totalPages + (currentPageNum - 1)) / (chapters.length * totalPages || 1)) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-bold font-mono tracking-wide text-kindle-text opacity-90">
                    page {currentChapterIdx + 1}.{currentPageNum} of {totalPages} • {Math.round(((currentChapterIdx * totalPages + (currentPageNum - 1)) / (chapters.length * totalPages || 1)) * 100)}%
                  </span>
                </div>

                <button
                  id="next-chapter-btn"
                  disabled={currentChapterIdx === chapters.length - 1 && currentPageNum === totalPages}
                  onClick={handleNextPage}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-kindle-accent transition shadow-sm"
                >
                  <span>Next Page</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </footer>
            </div>
          )}
        </main>

        {/* Sidebar: Highlights & Notes */}
        {showNotes && (
          <aside className={`w-80 md:w-96 border-l ${activeTheme.border} ${activeTheme.card} flex flex-col z-10 animate-in slide-in-from-right duration-250`}>
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

        {/* Sidebar: Gemini AI Assistant */}
        {showAiAssistant && (
          <aside className={`w-80 md:w-96 border-l ${activeTheme.border} ${activeTheme.card} flex flex-col z-10 animate-in slide-in-from-right duration-250`}>
            <div className={`p-5 border-b ${activeTheme.border} flex justify-between items-center`}>
              <span className="font-serif font-bold text-sm tracking-tight flex items-center gap-2 text-kindle-text">
                <Sparkles className="w-4 h-4 text-amber-500" />
                Kora Companion
              </span>
              <button 
                onClick={() => setShowAiAssistant(false)} 
                className="p-1.5 rounded-lg hover:bg-neutral-500/10 text-xs text-kindle-text font-medium"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
              {/* Context helper */}
              <div className="bg-[#fcfbf9] dark:bg-neutral-900 rounded-2xl p-4 border border-kindle-border text-[11px] font-sans leading-relaxed text-kindle-text-muted shadow-sm">
                <div className="font-bold text-kindle-text mb-1.5 flex items-center gap-2 uppercase tracking-widest text-[9px]">
                  <Info className="w-3.5 h-3.5 text-amber-500" />
                  E-Ink Intelligent Engine
                </div>
                Highlight any word or passage in the text to prompt instant explanation, definition, or summarization. You can also converse directly with Kora below.
              </div>

              {selectedText && (
                <div className="p-4 rounded-xl border border-amber-500/20 text-xs font-sans space-y-2 bg-amber-500/5">
                  <div className="font-bold uppercase tracking-widest text-[9px] text-amber-600 dark:text-amber-400">Target Passage</div>
                  <p className="italic line-clamp-3 text-kindle-text">"{selectedText}"</p>
                  <button 
                    onClick={() => setSelectedText("")} 
                    className="text-[10px] font-semibold text-neutral-500 hover:text-kindle-text underline block pt-1"
                  >
                    Clear selection
                  </button>
                </div>
              )}

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => requestAiAssistant("explain")}
                  disabled={aiLoading}
                  className="p-3 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-neutral-500/5 active:bg-neutral-500/10 transition disabled:opacity-30 text-kindle-text"
                >
                  Explain
                </button>
                <button
                  onClick={() => requestAiAssistant("summarize")}
                  disabled={aiLoading}
                  className="p-3 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-neutral-500/5 active:bg-neutral-500/10 transition disabled:opacity-30 text-kindle-text"
                >
                  Summarize
                </button>
              </div>

              {/* Core AI Output */}
              <div className={`p-5 rounded-2xl border border-kindle-border min-h-[220px] relative font-sans text-xs flex flex-col justify-between bg-white dark:bg-neutral-950 shadow-inner overflow-hidden`}>
                {aiLoading ? (
                  <div className="absolute inset-0 bg-white/95 dark:bg-neutral-950/95 flex flex-col items-center justify-center gap-3 z-10 rounded-2xl animate-fade-in">
                    <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-[10px] font-bold uppercase tracking-widest animate-pulse text-kindle-text-muted">Analyzing Text...</span>
                  </div>
                ) : null}

                <div className="prose prose-sm dark:prose-invert space-y-3 max-w-full leading-relaxed overflow-x-hidden text-kindle-text">
                  {aiResponse ? (
                    <div className="whitespace-pre-wrap leading-relaxed select-text font-serif text-[13px]">{aiResponse}</div>
                  ) : (
                    <div className="text-center py-12 text-kindle-text-muted font-medium opacity-60 italic text-xs">
                      Highlight book content or use the input below to trigger Kora insights.
                    </div>
                  )}
                </div>
              </div>

              {/* Custom Ask Query Box */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  if (customAiQuery.trim()) {
                    requestAiAssistant("chat", customAiQuery);
                    setCustomAiQuery("");
                  }
                }}
                className="space-y-3 pt-2"
              >
                <label className="text-[10px] font-bold uppercase tracking-widest block text-kindle-text-muted">Direct Query</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customAiQuery}
                    onChange={(e) => setCustomAiQuery(e.target.value)}
                    placeholder="Search characters, themes, style..."
                    className="flex-1 p-3 rounded-xl text-xs border border-kindle-border focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white dark:bg-neutral-900 text-kindle-text"
                  />
                  <button
                    type="submit"
                    disabled={aiLoading || !customAiQuery.trim()}
                    className="bg-kindle-text hover:bg-[#2c2a26] disabled:opacity-40 text-kindle-bg px-5 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-sm transition"
                  >
                    Send
                  </button>
                </div>
              </form>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
