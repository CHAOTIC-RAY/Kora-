import React, { useState, useEffect, useRef } from "react";
import JSZip from "jszip";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { getBookFile, deleteBookFile } from "../db/indexedDB";
import { runOfflineCompanion } from "../lib/offlineAssistant";
import { 
  X, ChevronLeft, ChevronRight, Menu, Settings, 
  BookOpen, Sparkles, AlertCircle, Type, Layout, Info,
  Headphones, Play, Pause, RotateCcw, Volume2, FastForward, Rewind
} from "lucide-react";

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
  
  // Layout states
  const [showToc, setShowToc] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showAiAssistant, setShowAiAssistant] = useState<boolean>(false);

  // AI assistant states
  const [aiResponse, setAiResponse] = useState<string>("");
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [customAiQuery, setCustomAiQuery] = useState<string>("");
  const [selectedText, setSelectedText] = useState<string>("");

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

  // Keyboard navigation: arrows flip chapters / scroll, Space scrolls, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const viewer = contentRef.current;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          if (currentChapterIdx < chapters.length - 1) updateProgress(currentChapterIdx + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (currentChapterIdx > 0) updateProgress(currentChapterIdx - 1);
          break;
        case "ArrowDown":
          if (viewer) { e.preventDefault(); viewer.scrollBy({ top: 120, behavior: "smooth" }); }
          break;
        case "ArrowUp":
          if (viewer) { e.preventDefault(); viewer.scrollBy({ top: -120, behavior: "smooth" }); }
          break;
        case " ":
          if (viewer) { e.preventDefault(); viewer.scrollBy({ top: 240, behavior: "smooth" }); }
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
  }, [currentChapterIdx, chapters.length]);

  async function lookupDictionary(word: string) {
    try {
      setDictLoading(true);
      setDictionaryWord(word);
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`);
      if (res.ok) {
        const data = await res.json();
        setDictionaryData(data[0]);
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
  async function updateProgress(newChapterIdx: number) {
    if (newChapterIdx < 0 || newChapterIdx >= chapters.length) return;
    setCurrentChapterIdx(newChapterIdx);
    
    // Save scroll position at top of new chapter
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }

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
            id="toggle-toc-btn"
            onClick={() => { setShowToc(!showToc); setShowSettings(false); setShowAudiobook(false); }}
            className={`p-2 rounded-xl hover:bg-neutral-500/10 transition ${showToc ? 'bg-neutral-500/20' : ''}`}
            title="Chapters"
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <button
            id="toggle-settings-btn"
            onClick={() => { setShowSettings(!showSettings); setShowToc(false); setShowAudiobook(false); }}
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
            onClick={() => setShowAiAssistant(!showAiAssistant)}
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

            {/* Continuous Scrolling Toggle */}
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold">Continuous Scrolling</h4>
                <p className="text-[10px] text-kindle-text-muted">Vertical layout instead of pages</p>
              </div>
              <button 
                onClick={() => setIsContinuous(!isContinuous)}
                className={`w-10 h-5 rounded-full transition-colors relative ${isContinuous ? "bg-kindle-accent" : "bg-neutral-300"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${isContinuous ? "translate-x-5.5" : "translate-x-0.5"}`} />
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
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold font-serif">{dictionaryWord}</h3>
                  <button onClick={() => setDictionaryWord(null)} className="p-1 hover:bg-black/5 rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {dictLoading ? (
                  <div className="flex items-center gap-2 py-4">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-sans">Looking up...</span>
                  </div>
                ) : dictionaryData ? (
                  <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                    {dictionaryData.phonetic && (
                      <p className="text-xs font-mono opacity-60">{dictionaryData.phonetic}</p>
                    )}
                    {dictionaryData.meanings.map((meaning: any, i: number) => (
                      <div key={i} className="space-y-2">
                        <p className="text-[10px] uppercase font-bold tracking-widest opacity-40">{meaning.partOfSpeech}</p>
                        <ul className="space-y-2">
                          {meaning.definitions.slice(0, 2).map((def: any, j: number) => (
                            <li key={j} className="text-xs leading-relaxed">
                              {def.definition}
                              {def.example && (
                                <p className="italic opacity-60 mt-1">"{def.example}"</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs opacity-60 py-4">No definition found for "{dictionaryWord}".</p>
                )}
                
                <div className="mt-6 pt-4 border-t border-current/10">
                  <p className="text-[9px] opacity-40 uppercase tracking-widest text-center">Tap outside to close</p>
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
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Floating highlighted text helper tip */}
              {selectedText && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-[#5c5346] text-white px-4 py-2 rounded-full shadow-md text-xs font-sans flex items-center gap-2 border border-[#e8e4de] animate-fade-in">
                  <span>Selected text! Ask companion:</span>
                  <button 
                    onClick={() => { setShowAiAssistant(true); requestAiAssistant("explain"); }}
                    className="bg-black/30 hover:bg-black/50 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition"
                  >
                    Explain
                  </button>
                  <button 
                    onClick={() => { setShowAiAssistant(true); requestAiAssistant("summarize"); }}
                    className="bg-black/30 hover:bg-black/50 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition"
                  >
                    Summarize
                  </button>
                  <button onClick={() => setSelectedText("")} className="text-neutral-200 hover:text-white ml-1">✕</button>
                </div>
              )}

              {/* The Chapter Text Container */}
              <div 
                ref={contentRef}
                className="flex-1 overflow-y-auto overflow-x-hidden py-12 px-4 md:px-12 flex justify-center"
              >
                <article 
                  className={`w-full ${marginSize} ${fontFamily} selection:bg-kindle-accent/20 selection:text-kindle-text transition-all duration-300`}
                  style={{ fontSize: `${fontSize}px`, lineHeight: lineSpacing }}
                >
                  <div className={`mb-8 border-b ${activeTheme.border} pb-4`}>
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
                  <div className={`mt-16 pt-6 border-t ${activeTheme.border} flex justify-between items-center text-xs font-sans opacity-70`}>
                    <span>End of {chapters[currentChapterIdx]?.title}</span>
                    <span>{Math.round((currentChapterIdx / chapters.length) * 100)}% read</span>
                  </div>
                </article>
              </div>

              {/* Footer Chapter Navigate Buttons */}
              <footer className={`px-6 py-4 border-t ${activeTheme.border} flex items-center justify-between font-sans`}>
                <button
                  id="prev-chapter-btn"
                  disabled={currentChapterIdx === 0}
                  onClick={() => updateProgress(currentChapterIdx - 1)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-neutral-500/10 transition"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Prev</span>
                </button>

                <div className="flex flex-col items-center">
                  <div className="w-48 bg-neutral-200 h-1 rounded-full overflow-hidden mb-1.5">
                    <div 
                      className="bg-kindle-text h-full transition-all duration-500" 
                      style={{ width: `${Math.round((currentChapterIdx / chapters.length) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-bold text-kindle-text-muted uppercase tracking-widest">
                    {currentChapterIdx + 1} of {chapters.length} • {Math.round((currentChapterIdx / chapters.length) * 100)}%
                  </span>
                </div>

                <button
                  id="next-chapter-btn"
                  disabled={currentChapterIdx === chapters.length - 1}
                  onClick={() => updateProgress(currentChapterIdx + 1)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-kindle-accent transition shadow-sm"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </footer>
            </div>
          )}
        </main>

        {/* Sidebar: Gemini AI Assistant */}
        {showAiAssistant && (
          <aside className={`w-80 md:w-96 border-l ${activeTheme.border} ${activeTheme.card} flex flex-col z-10 animate-in slide-in-from-right duration-200`}>
            <div className={`p-5 border-b ${activeTheme.border} flex justify-between items-center`}>
              <span className="font-sans font-bold text-xs uppercase tracking-widest flex items-center gap-2 text-kindle-text">
                <Sparkles className="w-4 h-4 text-kindle-accent" />
                AI Reader Helper
              </span>
              <button 
                onClick={() => setShowAiAssistant(false)} 
                className="p-1.5 rounded-lg hover:bg-neutral-500/10 text-xs"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Context helper */}
              <div className="bg-neutral-100 rounded-xl p-4 border border-kindle-border text-[11px] font-sans leading-relaxed text-kindle-text-muted">
                <div className="font-bold text-kindle-text mb-1.5 flex items-center gap-2 uppercase tracking-widest text-[9px]">
                  <Info className="w-3.5 h-3.5 text-kindle-accent" />
                  Offline AI Companion
                </div>
                Highlight text inside the book to explain or summarize specific passages. Or ask questions below about motifs, characters, and plot.
              </div>

              {selectedText && (
                <div className={`p-4 rounded-xl border border-kindle-border text-xs font-sans space-y-2 bg-white/50`}>
                  <div className="font-bold uppercase tracking-widest text-[9px] opacity-60">Selected passage</div>
                  <p className="italic line-clamp-3 text-kindle-text">"{selectedText}"</p>
                  <button 
                    onClick={() => setSelectedText("")} 
                    className="text-[10px] font-bold text-red-600 hover:underline block pt-1"
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
                  className="p-3 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-neutral-100 transition disabled:opacity-30"
                >
                  Explain
                </button>
                <button
                  onClick={() => requestAiAssistant("summarize")}
                  disabled={aiLoading}
                  className="p-3 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-neutral-100 transition disabled:opacity-30"
                >
                  Summarize
                </button>
              </div>

              {/* Core AI Output */}
              <div className={`p-5 rounded-2xl border border-kindle-border min-h-[180px] relative font-sans text-xs flex flex-col justify-between bg-white shadow-sm`}>
                {aiLoading ? (
                  <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center gap-3 z-10 rounded-2xl">
                    <div className="w-6 h-6 border-3 border-kindle-accent border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-[10px] font-bold uppercase tracking-widest animate-pulse text-kindle-text-muted">Consulting AI...</span>
                  </div>
                ) : null}

                <div className="prose prose-sm dark:prose-invert space-y-3 max-w-full leading-relaxed overflow-x-hidden text-kindle-text">
                  {aiResponse ? (
                    <div className="whitespace-pre-wrap">{aiResponse}</div>
                  ) : (
                    <div className="text-center py-10 text-kindle-text-muted font-medium opacity-60 italic">
                      Select text or ask a question to generate analysis
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
                <label className="text-[10px] font-bold uppercase tracking-widest block text-kindle-text-muted">Ask a question</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customAiQuery}
                    onChange={(e) => setCustomAiQuery(e.target.value)}
                    placeholder="Search motifs, plot..."
                    className="flex-1 p-3 rounded-xl text-xs border border-kindle-border focus:outline-none focus:ring-1 focus:ring-kindle-accent bg-white text-kindle-text"
                  />
                  <button
                    type="submit"
                    disabled={aiLoading || !customAiQuery.trim()}
                    className="bg-kindle-text hover:bg-kindle-accent disabled:opacity-40 text-kindle-bg px-5 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-sm transition"
                  >
                    Ask
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
