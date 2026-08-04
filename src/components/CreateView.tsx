import React, { useState, useEffect, useRef } from "react";
import {
  BookOpen,
  ArrowLeft,
  Save,
  Download,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Copy,
  Sparkles,
  FileText,
  Eye,
  Settings,
  Code,
  Image as ImageIcon,
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Check,
  Loader2,
  FileDown,
  Palette,
  Wand2,
  BookMarked,
  Share2,
  X,
  ChevronLeft,
  Menu,
  Type,
  Search,
  Replace,
  Maximize2,
  Minimize2,
  FileType2,
} from "lucide-react";
import { motion, LayoutGroup } from "motion/react";
import { BookMetadata } from "../lib/firebase";
import { getBookFile, storeBookFile } from "../db/indexedDB";
import {
  buildEpubFromText,
  extractEpubChaptersHtml,
  downloadBlob,
  slugifyFilename,
  EpubHtmlChapter,
} from "../lib/epubTools";
import { exportBookToPdf } from "../lib/pdfTools";
import { replaceAll } from "../lib/textUtils";
import { chaptersToMarkdown } from "../lib/htmlToMarkdown";
import { toast } from "react-hot-toast"; // using custom or console toast fallback

interface CreateViewProps {
  book: BookMetadata;
  userId: string;
  onClose: () => void;
  onOpenReader?: (book: BookMetadata) => void;
  onBookUpdated?: (updatedBook: BookMetadata) => void;
}

const editorFonts = [
  { name: "Lora Serif", value: "font-serif" },
  { name: "Lexend Sans", value: "font-sans" },
  { name: "JetBrains Mono", value: "font-mono" },
  { name: "Bookerly", value: "font-bookerly" },
  { name: "ChareInk7SP", value: "font-chareink" },
  { name: "Lexica Ultralegible", value: "font-lexica" },
  { name: "Rakuten Sans", value: "font-rakuten" },
];

export default function CreateView({
  book,
  userId,
  onClose,
  onOpenReader,
  onBookUpdated,
}: CreateViewProps) {
  const [title, setTitle] = useState(book.title || "My New Book");
  const [author, setAuthor] = useState(book.author || "Unknown Author");
  const [language, setLanguage] = useState(book.language || "en");
  const [publisher, setPublisher] = useState(book.publisher || "Kora EPUB Studio");
  const [description, setDescription] = useState(book.notes || "");
  const [tags, setTags] = useState<string[]>(book.tags || ["created", "epub"]);

  // Cover image / style
  const [coverBg, setCoverBg] = useState("linear-gradient(135deg, #2c3e50 0%, #000000 100%)");
  const [coverImage, setCoverImage] = useState<string | null>(book.coverUrl || null);

  // Chapters state
  const [chapters, setChapters] = useState<EpubHtmlChapter[]>([
    {
      id: "chap_1",
      title: "Chapter 1: The Beginning",
      html: "<p>Start writing your story here. Use the toolbar above to format headings, quotes, and paragraphs.</p>",
      text: "Start writing your story here. Use the toolbar above to format headings, quotes, and paragraphs.",
    },
  ]);
  const [activeChapterId, setActiveChapterId] = useState<string>("chap_1");

  // View modes: 'editor' | 'metadata' | 'preview'
  const [activeTab, setActiveTab] = useState<"editor" | "metadata" | "preview">("editor");
  const [editorMode, setEditorMode] = useState<"visual" | "html" | "split">("visual");
  const [showChaptersSidebar, setShowChaptersSidebar] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 1024;
    }
    return true;
  });

  const [isLoadingFile, setIsLoadingFile] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloadingEpub, setIsDownloadingEpub] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // New writer features state
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findMatches, setFindMatches] = useState(0);
  const [distractionFree, setDistractionFree] = useState(false);
  const [typewriter, setTypewriter] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  // Chapter templates (seeded HTML when adding a chapter)
  const CHAPTER_TEMPLATES = {
    blank: { label: "Blank Chapter", title: "Chapter", html: "<p></p>" },
    sceneBreak: {
      label: "Chapter + Scene Break",
      title: "Chapter",
      html: "<p>Opening line of the chapter…</p><div class=\"scene-break\" style=\"text-align:center;margin:2rem 0;color:#888;\">♦ ♦ ♦</div><p>Continued…</p>",
    },
    frontMatter: {
      label: "Front Matter (Title Page)",
      title: "Title Page",
      html: "<h1 style=\"text-align:center\">Book Title</h1><p style=\"text-align:center\">by Author Name</p><p style=\"text-align:center\"><em>A Kora Original</em></p>",
    },
    dialogue: {
      label: "Dialogue Scene",
      title: "Chapter",
      html: "<p><strong>Alice:</strong> …</p><p><strong>Bob:</strong> …</p>",
    },
  } as const;
  type TemplateKey = keyof typeof CHAPTER_TEMPLATES;

  // Download menu dropdown state
  const [showDownloadDropdown, setShowDownloadDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Font chooser for visual editor & preview
  const [editorFont, setEditorFont] = useState<string>(() => {
    return localStorage.getItem("kora_editor_font") || "font-serif";
  });

  useEffect(() => {
    localStorage.setItem("kora_editor_font", editorFont);
  }, [editorFont]);

  const editorRef = useRef<HTMLDivElement>(null);

  // Load existing book file chapters if available
  useEffect(() => {
    async function loadBookData() {
      setIsLoadingFile(true);
      try {
        const fileData = await getBookFile(book.id);
        if (fileData && fileData.blob) {
          const loadedChapters = await extractEpubChaptersHtml(fileData.blob);
          if (loadedChapters && loadedChapters.length > 0) {
            setChapters(loadedChapters);
            setActiveChapterId(loadedChapters[0].id);
          }
        }
      } catch (err) {
        console.warn("[CreateView] Error loading book file:", err);
      } finally {
        setIsLoadingFile(false);
      }
    }
    loadBookData();
  }, [book.id]);

  // Handle click outside download dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDownloadDropdown(false);
      }
      if (templateMenuRef.current && !templateMenuRef.current.contains(event.target as Node)) {
        setShowTemplateMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Debounced autosave to IndexedDB (local only) — never alerts, just updates indicator.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const epubBlob = await buildEpubFromText({
          title,
          creator: author,
          language,
          chapters: chapters.map((c) => ({ title: c.title, html: c.html, text: c.text })),
        });
        await storeBookFile(book.id, epubBlob, `${title}.epub`, "epub");
        setLastSavedAt(Date.now());
        setHasUnsavedChanges(false);
      } catch (e) {
        console.warn("[CreateView] autosave failed", e);
      }
    }, 1500);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [hasUnsavedChanges, chapters, title, author, language]);

  // Lock body scroll on mobile when chapters bottom sheet is expanded
  useEffect(() => {
    if (showChaptersSidebar && window.innerWidth < 768) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev || "";
      };
    }
  }, [showChaptersSidebar]);

  const activeChapter = chapters.find((c) => c.id === activeChapterId) || chapters[0];

  // Sync content when typing in contentEditable or textarea
  const updateChapterHtml = (newHtml: string) => {
    setChapters((prev) =>
      prev.map((chap) => {
        if (chap.id === activeChapterId) {
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = newHtml;
          const text = tempDiv.innerText || tempDiv.textContent || "";
          return { ...chap, html: newHtml, text };
        }
        return chap;
      })
    );
    setHasUnsavedChanges(true);
  };

  // Sync title of chapter
  const updateChapterTitle = (newTitle: string) => {
    setChapters((prev) =>
      prev.map((chap) => (chap.id === activeChapterId) ? { ...chap, title: newTitle } : chap)
    );
    setHasUnsavedChanges(true);
  };

  // Chapter management actions
  const handleAddChapter = (templateKey: TemplateKey = "blank") => {
    const tpl = CHAPTER_TEMPLATES[templateKey];
    const plainText = (() => {
      const d = document.createElement("div");
      d.innerHTML = tpl.html;
      return d.textContent || "";
    })();
    const newId = "chap_" + Date.now().toString(36);
    const newNum = chapters.length + 1;
    const baseTitle = tpl.title === "Chapter" ? `Chapter ${newNum}` : tpl.title;
    const newChap: EpubHtmlChapter = {
      id: newId,
      title: baseTitle,
      html: tpl.html,
      text: plainText || baseTitle,
    };
    setChapters((prev) => [...prev, newChap]);
    setActiveChapterId(newId);
    setHasUnsavedChanges(true);
    setShowTemplateMenu(false);
  };

  // Find & Replace within the active chapter
  const countFindMatches = (html: string, q: string): number => {
    if (!q) return 0;
    const text = html.replace(/<[^>]+>/g, " ");
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    const m = text.match(re);
    return m ? m.length : 0;
  };

  const runReplaceAll = () => {
    if (!findQuery) return;
    const updated = replaceAll(activeChapter.html, findQuery, replaceQuery);
    updateChapterHtml(updated);
    setFindMatches(0);
    toast.success(`Replaced all occurrences of "${findQuery}"`);
  };


  const handleDuplicateChapter = (chap: EpubHtmlChapter) => {
    const newId = "chap_" + Date.now().toString(36);
    const copyChap: EpubHtmlChapter = {
      ...chap,
      id: newId,
      title: `${chap.title} (Copy)`,
    };
    const index = chapters.findIndex((c) => c.id === chap.id);
    const next = [...chapters];
    next.splice(index + 1, 0, copyChap);
    setChapters(next);
    setActiveChapterId(newId);
    setHasUnsavedChanges(true);
  };

  const handleDeleteChapter = (id: string) => {
    if (chapters.length <= 1) {
      alert("An EPUB book must have at least one chapter.");
      return;
    }
    const next = chapters.filter((c) => c.id !== id);
    setChapters(next);
    if (activeChapterId === id) {
      setActiveChapterId(next[0].id);
    }
    setHasUnsavedChanges(true);
  };

  const handleMoveChapter = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === chapters.length - 1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const next = [...chapters];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setChapters(next);
    setHasUnsavedChanges(true);
  };

  // Rich Text Editor formatting commands
  const execCmd = (cmd: string, val: string | undefined = undefined) => {
    document.execCommand(cmd, false, val);
    if (editorRef.current) {
      updateChapterHtml(editorRef.current.innerHTML);
    }
  };

  // Total statistics
  const totalWords = chapters.reduce((sum, c) => {
    const words = c.text.trim() ? c.text.trim().split(/\s+/).length : 0;
    return sum + words;
  }, 0);
  const estimatedReadMins = Math.max(1, Math.ceil(totalWords / 200));

  // Per-chapter live statistics
  const activeText = activeChapter?.text ?? "";
  const activeChapterWords = activeText.trim() ? activeText.trim().split(/\s+/).length : 0;
  const activeChapterChars = activeText.replace(/\s/g, "").length;
  const activeChapterMins = Math.max(1, Math.ceil(activeChapterWords / 200));

  // Keep the caret vertically centered when typewriter mode is on.
  const handleEditorInput = (e: React.FormEvent<HTMLDivElement>) => {
    const html = e.currentTarget.innerHTML;
    updateChapterHtml(html);
    if (typewriter && editorScrollRef.current) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const box = editorScrollRef.current.getBoundingClientRect();
        if (rect.top > 0) {
          editorScrollRef.current.scrollTop += rect.top - box.top - box.height / 2;
        }
      }
    }
  };

  // Live find-match count for the active chapter
  useEffect(() => {
    setFindMatches(countFindMatches(activeChapter?.html ?? "", findQuery));
  }, [findQuery, activeChapter?.html]);


  // Save book to IndexedDB & Firebase
  const handleSaveBook = async () => {
    try {
      setIsSaving(true);
      const epubBlob = await buildEpubFromText({
        title,
        creator: author,
        language,
        chapters: chapters.map((c) => ({
          title: c.title,
          html: c.html,
          text: c.text,
        })),
      });

      const updatedBook: BookMetadata = {
        ...book,
        title,
        author,
        publisher,
        language,
        notes: description,
        extension: "epub",
        size: `${Math.round(epubBlob.size / 1024)} KB`,
        tags: Array.from(new Set([...tags, "created", "epub"])),
        progress: book.progress || { percent: 0, lastReadTime: Date.now() },
      };

      await storeBookFile(book.id, epubBlob, `${title}.epub`, "epub");
      if (onBookUpdated) onBookUpdated(updatedBook);

      setHasUnsavedChanges(false);
      alert("Book saved successfully as EPUB!");
    } catch (err) {
      console.error("[CreateView] Save failed:", err);
      alert("Failed to save EPUB. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  // Download EPUB
  const handleDownloadEpub = async () => {
    try {
      setIsDownloadingEpub(true);
      const blob = await buildEpubFromText({
        title,
        creator: author,
        language,
        chapters: chapters.map((c) => ({
          title: c.title,
          html: c.html,
          text: c.text,
        })),
      });
      const filename = slugifyFilename(title, "epub");
      await downloadBlob(filename, blob);
    } catch (err) {
      console.error("[CreateView] Download EPUB failed:", err);
      alert("Could not generate EPUB download.");
    } finally {
      setIsDownloadingEpub(false);
    }
  };

  // Download PDF
  const handleDownloadPdf = async () => {
    try {
      setIsDownloadingPdf(true);
      const pdfBlob = await exportBookToPdf({
        title,
        author,
        chapters: chapters.map((c) => ({
          title: c.title,
          html: c.html,
          text: c.text,
        })),
      });
      const filename = slugifyFilename(title, "pdf");
      await downloadBlob(filename, pdfBlob);
    } catch (err) {
      console.error("[CreateView] Download PDF failed:", err);
      alert("Could not generate PDF download.");
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-kindle-bg text-kindle-text flex flex-col font-sans overflow-hidden">
      {/* Top Navigation Header */}
      <header
        className="h-14 px-4 border-b border-kindle-border flex items-center justify-between shrink-0 shadow-xs z-20"
        style={{ backgroundColor: "var(--color-kindle-card)" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-md border border-kindle-border hover:bg-kindle-bg/80 text-kindle-text-muted hover:text-kindle-text transition flex items-center justify-center cursor-pointer"
            title="Back to Library"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-md bg-kindle-accent/15 text-kindle-accent shrink-0 hidden sm:block">
              <BookMarked className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                className="text-xs font-bold bg-transparent border-b border-transparent hover:border-kindle-border focus:border-kindle-accent focus:outline-none text-kindle-text truncate w-24 sm:w-56"
                placeholder="Book Title"
              />
              <p className="text-[10px] text-kindle-text-muted truncate">
                by {author} • EPUB Creator
              </p>
            </div>
          </div>

          {hasUnsavedChanges ? (
            <span className="hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[10px] font-bold">
              Unsaved Changes
            </span>
          ) : (
            <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
        </div>

        {/* Center Tabs: Editor / Metadata / Preview */}
        <div className="hidden md:flex items-center p-0.5 rounded-md bg-kindle-bg border border-kindle-border gap-0.5">
          <button
            type="button"
            onClick={() => setActiveTab("editor")}
            title="Editor"
            className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center justify-center transition cursor-pointer ${
              activeTab === "editor"
                ? "bg-kindle-accent text-kindle-bg shadow-xs"
                : "text-kindle-text-muted hover:text-kindle-text"
            }`}
          >
            <FileText className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("metadata")}
            title="Metadata & Cover"
            className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center justify-center transition cursor-pointer ${
              activeTab === "metadata"
                ? "bg-kindle-accent text-kindle-bg shadow-xs"
                : "text-kindle-text-muted hover:text-kindle-text"
            }`}
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("preview")}
            title="Live Preview"
            className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center justify-center transition cursor-pointer ${
              activeTab === "preview"
                ? "bg-kindle-accent text-kindle-bg shadow-xs"
                : "text-kindle-text-muted hover:text-kindle-text"
            }`}
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>

        {/* Right Actions: Save, Combined Download Dropdown, Read Mode */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={handleSaveBook}
            disabled={isSaving}
            className="p-1.5 sm:px-3 sm:py-1.5 rounded-md bg-kindle-accent text-kindle-bg text-xs font-bold flex items-center gap-1.5 hover:opacity-95 transition cursor-pointer disabled:opacity-50"
            title="Save EPUB to Library"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span className="hidden lg:inline">Save</span>
          </button>

          {lastSavedAt && !hasUnsavedChanges && (
            <span className="hidden md:inline text-[10px] font-bold text-emerald-500/80 flex items-center gap-1" title={new Date(lastSavedAt).toLocaleTimeString()}>
              <Check className="w-3 h-3" /> Saved
            </span>
          )}

          {/* Combined Download Dropdown */}
          <div
            className="relative"
            ref={dropdownRef}
            onMouseEnter={() => setShowDownloadDropdown(true)}
            onMouseLeave={() => setShowDownloadDropdown(false)}
          >
            <button
              type="button"
              onClick={() => setShowDownloadDropdown(!showDownloadDropdown)}
              className="p-1.5 sm:px-3 sm:py-1.5 rounded-md border border-kindle-border bg-kindle-bg hover:bg-kindle-card text-kindle-text text-xs font-bold flex items-center gap-1 transition cursor-pointer shrink-0"
              title="Download or Export Options"
            >
              {isDownloadingEpub || isDownloadingPdf ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-kindle-accent" />
              ) : (
                <Download className="w-3.5 h-3.5 text-kindle-accent" />
              )}
              <span className="hidden sm:inline">Download</span>
              <ChevronDown className="w-3 h-3 text-kindle-text-muted" />
            </button>

            {showDownloadDropdown && (
              <div className="absolute right-0 mt-1 w-44 bg-kindle-card border border-kindle-border rounded-md shadow-lg py-1 z-50">
                <button
                  type="button"
                  onClick={() => {
                    handleDownloadEpub();
                    setShowDownloadDropdown(false);
                  }}
                  disabled={isDownloadingEpub}
                  className="w-full text-left px-3 py-2 text-xs font-bold text-kindle-text hover:bg-kindle-bg flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {isDownloadingEpub ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                  <span>Download EPUB</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleDownloadPdf();
                    setShowDownloadDropdown(false);
                  }}
                  disabled={isDownloadingPdf}
                  className="w-full text-left px-3 py-2 text-xs font-bold text-kindle-text hover:bg-kindle-bg flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {isDownloadingPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5 text-rose-500" />
                  )}
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const md = chaptersToMarkdown(title, author, chapters.map((c) => ({ title: c.title, html: c.html })));
                    downloadBlob(slugifyFilename(title, "md"), new Blob([md], { type: "text/markdown" }));
                    setShowDownloadDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-bold text-kindle-text hover:bg-kindle-bg flex items-center gap-2 transition cursor-pointer"
                >
                  <FileType2 className="w-3.5 h-3.5 text-sky-500" />
                  <span>Download Markdown</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const txt = chapters.map((c) => `${c.title}\n\n${c.text}`).join("\n\n");
                    downloadBlob(slugifyFilename(title, "txt"), new Blob([txt], { type: "text/plain" }));
                    setShowDownloadDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-bold text-kindle-text hover:bg-kindle-bg flex items-center gap-2 transition cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  <span>Download Text</span>
                </button>
              </div>
            )}
          </div>

          {onOpenReader && (
            <button
              type="button"
              onClick={() => onOpenReader(book)}
              className="p-1.5 sm:px-3 sm:py-1.5 rounded-md border border-kindle-border bg-kindle-card hover:bg-kindle-bg text-kindle-accent text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              title="Open in Reader"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Read</span>
            </button>
          )}
        </div>
      </header>

      {/* Mobile Tab Strip */}
      <div
        className="md:hidden border-b border-kindle-border p-2 shrink-0 z-20"
        style={{ backgroundColor: "var(--color-kindle-card)" }}
      >
        <LayoutGroup id="create-view-tabs">
          <nav className="flex items-center justify-around bg-kindle-bg border border-kindle-border/40 p-1 rounded-md text-xs font-bold relative" aria-label="Editor sections">
            {[
              { id: "editor", label: "Editor" },
              { id: "metadata", label: "Metadata" },
              { id: "preview", label: "Preview" }
            ].map(({ id, label }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id as any)}
                  className={`flex-1 py-2 mx-0.5 rounded-md transition-colors relative flex items-center justify-center text-[11px] ${
                    isActive ? "text-kindle-text font-bold" : "text-kindle-text-muted hover:text-kindle-text"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="create-tab-pill"
                      className="absolute inset-0 rounded-md bg-kindle-card border border-kindle-border/60 shadow-xs"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10">{label}</span>
                </button>
              );
            })}
          </nav>
        </LayoutGroup>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {isLoadingFile ? (
          <div className="flex-1 flex items-center justify-center gap-3 text-kindle-text-muted">
            <Loader2 className="w-6 h-6 animate-spin text-kindle-accent" />
            <span className="text-xs font-bold">Loading book chapters...</span>
          </div>
        ) : (
          <>
            {/* 1. EDITOR TAB */}
            {activeTab === "editor" && (
              <div className="flex-1 flex min-h-0 w-full relative">
                {/* Left Chapter Sidebar overlay backdrop on mobile */}
                {showChaptersSidebar && (
                  <div
                    className="md:hidden absolute inset-0 bg-black/20 backdrop-blur-xs z-25 transition-opacity"
                    onClick={() => setShowChaptersSidebar(false)}
                  />
                )}

                {/* Chapters Sidebar / Bottom Sheet */}
                <aside 
                  className={`absolute md:relative bottom-0 md:bottom-auto md:top-0 left-0 right-0 md:right-auto z-30 bg-kindle-card border-t md:border-t-0 md:border-r border-kindle-border flex flex-col shrink-0 transition-all duration-300 ease-in-out rounded-t-2xl md:rounded-none overflow-hidden ${
                    showChaptersSidebar 
                      ? "h-[60vh] md:h-auto w-full md:w-64 sm:md:w-72 translate-y-0 md:translate-x-0 opacity-100" 
                      : "h-[60vh] md:h-auto w-full md:w-0 translate-y-full md:-translate-x-full md:translate-y-0 opacity-0 pointer-events-none md:border-r-0"
                  }`}
                >
                  <div className="p-3 border-b border-kindle-border flex items-center justify-between whitespace-nowrap min-w-[240px]">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowChaptersSidebar(false)}
                        className="p-1.5 rounded-lg hover:bg-kindle-bg text-kindle-text-muted hover:text-kindle-text transition shrink-0"
                        title="Collapse Chapters Sidebar"
                      >
                        <ChevronLeft className="w-4 h-4 hidden md:block" />
                        <ChevronDown className="w-4 h-4 md:hidden" />
                      </button>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-kindle-text-muted">
                        Chapters ({chapters.length})
                      </span>
                    </div>
                    <div className="relative" ref={templateMenuRef}>
                      <button
                        type="button"
                        onClick={() => setShowTemplateMenu((v) => !v)}
                        className="p-1.5 rounded-lg bg-kindle-accent/10 border border-kindle-accent/30 text-kindle-accent hover:bg-kindle-accent hover:text-kindle-bg transition flex items-center gap-1 text-xs font-bold cursor-pointer"
                        title="Add Chapter"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>New</span>
                      </button>
                      {showTemplateMenu && (
                        <div className="absolute right-0 mt-1 z-30 w-56 bg-kindle-card border border-kindle-border rounded-xl shadow-lg p-1 space-y-0.5">
                          {(Object.keys(CHAPTER_TEMPLATES) as TemplateKey[]).map((key) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => handleAddChapter(key)}
                              className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold text-kindle-text hover:bg-kindle-bg transition cursor-pointer"
                            >
                              {CHAPTER_TEMPLATES[key].label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Chapter List */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-w-[240px]">
                    {chapters.map((chap, idx) => {
                      const isActive = chap.id === activeChapterId;
                      const wordCount = chap.text.trim()
                        ? chap.text.trim().split(/\s+/).length
                        : 0;

                      return (
                        <div
                          key={chap.id}
                          onClick={() => {
                            setActiveChapterId(chap.id);
                            if (window.innerWidth < 768) {
                              setShowChaptersSidebar(false);
                            }
                          }}
                          className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between group ${
                            isActive
                              ? "bg-kindle-accent/10 border-kindle-accent text-kindle-text"
                              : "bg-kindle-bg/40 border-kindle-border hover:border-kindle-text/30 text-kindle-text-muted"
                          }`}
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <p className="text-xs font-bold truncate">{chap.title}</p>
                            <p className="text-[10px] text-kindle-text-muted mt-0.5">
                              {wordCount} words
                            </p>
                          </div>

                          {/* Quick chapter reorder / duplicate / delete */}
                          <div className={`flex items-center gap-1 transition ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveChapter(idx, "up");
                              }}
                              disabled={idx === 0}
                              className="p-1 hover:text-kindle-text disabled:opacity-20 cursor-pointer"
                              title="Move Up"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveChapter(idx, "down");
                              }}
                              disabled={idx === chapters.length - 1}
                              className="p-1 hover:text-kindle-text disabled:opacity-20 cursor-pointer"
                              title="Move Down"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicateChapter(chap);
                              }}
                              className="p-1 hover:text-kindle-text cursor-pointer"
                              title="Duplicate"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteChapter(chap.id);
                              }}
                              className="p-1 hover:text-rose-500 cursor-pointer"
                              title="Delete Chapter"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Sidebar Stats Footer */}
                  <div className="p-3 bg-kindle-bg/60 border-t border-kindle-border text-[11px] text-kindle-text-muted space-y-1">
                    <div className="flex justify-between font-mono">
                      <span>This Chapter:</span>
                      <span className="font-bold text-kindle-text">{activeChapterWords} w · {activeChapterChars} ch · {activeChapterMins} min</span>
                    </div>
                    <div className="flex justify-between font-mono">
                      <span>Total Words:</span>
                      <span className="font-bold text-kindle-text">{totalWords}</span>
                    </div>
                    <div className="flex justify-between font-mono">
                      <span>Est. Read Time:</span>
                      <span className="font-bold text-kindle-text">{estimatedReadMins} min</span>
                    </div>
                  </div>
                </aside>

                {/* Center Editor Area */}
                <main className="flex-1 flex flex-col min-w-0 bg-kindle-bg overflow-hidden">
                  {/* Chapter Header Bar */}
                  <div
                    className="p-3 border-b border-kindle-border flex items-center justify-between gap-3 shrink-0"
                    style={{ backgroundColor: "var(--color-kindle-card)" }}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => setShowChaptersSidebar(!showChaptersSidebar)}
                        className="p-1.5 rounded-md border border-kindle-border bg-kindle-bg text-kindle-text-muted hover:text-kindle-text transition shrink-0 flex items-center gap-1 cursor-pointer"
                        title={showChaptersSidebar ? "Collapse Chapters Sidebar" : "Expand Chapters Sidebar"}
                      >
                        <Menu className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">Chapters</span>
                      </button>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted shrink-0 hidden lg:inline">
                        Chapter Title:
                      </span>
                      <input
                        type="text"
                        value={activeChapter.title}
                        onChange={(e) => updateChapterTitle(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-kindle-bg border border-kindle-border rounded-md text-xs font-bold text-kindle-text focus:outline-none focus:border-kindle-accent transition"
                        placeholder="Chapter Title"
                      />
                    </div>

                    {/* Editor View Switcher */}
                    <div className="flex items-center p-0.5 rounded-md bg-kindle-bg border border-kindle-border text-xs font-bold">
                      <button
                        onClick={() => setEditorMode("visual")}
                        className={`px-2.5 py-1 rounded-sm text-[11px] transition cursor-pointer ${
                          editorMode === "visual"
                            ? "bg-kindle-accent text-kindle-bg shadow-xs font-bold"
                            : "text-kindle-text-muted hover:text-kindle-text"
                        }`}
                      >
                        Visual
                      </button>
                      <button
                        onClick={() => setEditorMode("html")}
                        className={`px-2.5 py-1 rounded-sm text-[11px] transition cursor-pointer ${
                          editorMode === "html"
                            ? "bg-kindle-accent text-kindle-bg shadow-xs font-bold"
                            : "text-kindle-text-muted hover:text-kindle-text"
                        }`}
                      >
                        HTML
                      </button>
                      <button
                        onClick={() => setEditorMode("split")}
                        className={`hidden md:block px-2.5 py-1 rounded-sm text-[11px] transition cursor-pointer ${
                          editorMode === "split"
                            ? "bg-kindle-accent text-kindle-bg shadow-xs font-bold"
                            : "text-kindle-text-muted hover:text-kindle-text"
                        }`}
                      >
                        Split
                      </button>
                    </div>
                  </div>

                  {/* Rich Text Toolbar (when in visual/split mode) */}
                  {editorMode !== "html" && (
                    <div className="p-2 bg-kindle-bg border-b border-kindle-border flex flex-nowrap md:flex-wrap items-center gap-1 shrink-0 overflow-x-auto text-xs scrollbar-none whitespace-nowrap">
                      {/* Font Family Chooser */}
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-kindle-border bg-kindle-card text-kindle-text">
                        <Type className="w-3.5 h-3.5 text-kindle-text-muted shrink-0" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted hidden sm:inline">Font:</span>
                        <select
                          value={editorFont}
                          onChange={(e) => setEditorFont(e.target.value)}
                          className="bg-transparent text-[11px] font-bold focus:outline-none cursor-pointer pr-1"
                        >
                          {editorFonts.map((f) => (
                            <option key={f.value} value={f.value} className="bg-kindle-card text-kindle-text">
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="w-px h-5 bg-kindle-border mx-1" />

                      <button
                        type="button"
                        onClick={() => execCmd("bold")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Bold"
                      >
                        <Bold className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd("italic")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Italic"
                      >
                        <Italic className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd("underline")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Underline"
                      >
                        <Underline className="w-3.5 h-3.5" />
                      </button>

                      <div className="w-px h-5 bg-kindle-border mx-1" />

                      <button
                        type="button"
                        onClick={() => execCmd("formatBlock", "<h1>")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Heading 1"
                      >
                        <Heading1 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd("formatBlock", "<h2>")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Heading 2"
                      >
                        <Heading2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd("formatBlock", "<h3>")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Heading 3"
                      >
                        <Heading3 className="w-3.5 h-3.5" />
                      </button>

                      <div className="w-px h-5 bg-kindle-border mx-1" />

                      <button
                        type="button"
                        onClick={() => execCmd("insertUnorderedList")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Bullet List"
                      >
                        <List className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd("insertOrderedList")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Numbered List"
                      >
                        <ListOrdered className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd("formatBlock", "<blockquote>")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Blockquote"
                      >
                        <Quote className="w-3.5 h-3.5" />
                      </button>

                      <div className="w-px h-5 bg-kindle-border mx-1" />

                      <button
                        type="button"
                        onClick={() => execCmd("justifyLeft")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Align Left"
                      >
                        <AlignLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd("justifyCenter")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Align Center"
                      >
                        <AlignCenter className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd("justifyRight")}
                        className="p-2 sm:p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text transition-colors"
                        title="Align Right"
                      >
                        <AlignRight className="w-3.5 h-3.5" />
                      </button>

                      <div className="w-px h-5 bg-kindle-border mx-1" />

                      <button
                        type="button"
                        onClick={() =>
                          execCmd(
                            "insertHTML",
                            '<div class="scene-break" style="text-align:center;margin:2rem 0;font-size:1.2rem;color:#888;">♦ ♦ ♦</div>'
                          )
                        }
                        className="px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-lg border border-kindle-border hover:bg-kindle-card text-kindle-text text-[11px] font-bold flex items-center gap-1 transition-colors"
                        title="Insert Scene Separator"
                      >
                        <span>♦ ♦ ♦</span>
                      </button>

                      <div className="w-px h-5 bg-kindle-border mx-1" />

                      <button
                        type="button"
                        onClick={() => setFindOpen((v) => !v)}
                        className={`p-2 sm:p-1.5 rounded-lg border transition-colors ${findOpen ? "bg-kindle-accent text-kindle-bg border-kindle-accent" : "border-kindle-border hover:bg-kindle-card text-kindle-text"}`}
                        title="Find & Replace"
                      >
                        <Search className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setTypewriter((v) => !v)}
                        className={`p-2 sm:p-1.5 rounded-lg border transition-colors ${typewriter ? "bg-kindle-accent text-kindle-bg border-kindle-accent" : "border-kindle-border hover:bg-kindle-card text-kindle-text"}`}
                        title="Typewriter scroll"
                      >
                        <Type className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDistractionFree((v) => !v)}
                        className={`p-2 sm:p-1.5 rounded-lg border transition-colors ${distractionFree ? "bg-kindle-accent text-kindle-bg border-kindle-accent" : "border-kindle-border hover:bg-kindle-card text-kindle-text"}`}
                        title="Distraction-free mode"
                      >
                        {distractionFree ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}

                  {/* Find & Replace bar */}
                  {findOpen && (
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-kindle-card border border-kindle-border rounded-xl mb-3 text-kindle-text">
                      <Search className="w-3.5 h-3.5 text-kindle-text-muted" />
                      <input
                        value={findQuery}
                        onChange={(e) => setFindQuery(e.target.value)}
                        placeholder="Find"
                        className="w-36 px-2 py-1 bg-kindle-bg border border-kindle-border rounded-md text-xs outline-none focus:ring-1 focus:ring-kindle-accent"
                      />
                      <Replace className="w-3.5 h-3.5 text-kindle-text-muted" />
                      <input
                        value={replaceQuery}
                        onChange={(e) => setReplaceQuery(e.target.value)}
                        placeholder="Replace"
                        className="w-36 px-2 py-1 bg-kindle-bg border border-kindle-border rounded-md text-xs outline-none focus:ring-1 focus:ring-kindle-accent"
                      />
                      <span className="text-[11px] text-kindle-text-muted font-bold">{findMatches} match{findMatches === 1 ? "" : "es"}</span>
                      <button
                        type="button"
                        onClick={runReplaceAll}
                        disabled={!findQuery}
                        className="px-2.5 py-1 rounded-md bg-kindle-accent text-kindle-bg text-[11px] font-bold disabled:opacity-40 hover:opacity-90 transition"
                      >
                        Replace All
                      </button>
                      <button
                        type="button"
                        onClick={() => { setFindOpen(false); setFindQuery(""); setReplaceQuery(""); setFindMatches(0); }}
                        className="ml-auto p-1 rounded-md hover:bg-kindle-bg text-kindle-text-muted"
                        title="Close"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Editor Workspace */}
                  <div
                    ref={editorScrollRef}
                    className={`flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 flex flex-col lg:flex-row gap-6 bg-kindle-bg ${distractionFree ? "lg:max-w-3xl lg:mx-auto" : ""}`}
                  >
                    {/* Visual WYSIWYG Editor */}
                    {(editorMode === "visual" || editorMode === "split") && (
                      <div className={`flex-1 bg-kindle-card border border-kindle-border rounded-none p-6 sm:p-14 shadow-xs min-h-[500px] overflow-y-auto ${editorFont} text-base leading-relaxed text-kindle-text focus:outline-none max-w-4xl mx-auto w-full ${typewriter ? "typewriter-mode" : ""}`}>
                        <div
                          key={activeChapterId}
                          ref={editorRef}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={handleEditorInput}
                          dangerouslySetInnerHTML={{ __html: activeChapter.html }}
                          className={`min-h-[450px] outline-none prose dark:prose-invert max-w-none ${typewriter ? "typewriter-caret" : ""}`}
                        />
                      </div>
                    )}

                    {/* Source HTML Editor */}
                    {(editorMode === "html" || editorMode === "split") && (
                      <div className="flex-1 bg-neutral-950 border border-neutral-800 rounded-none p-4 sm:p-6 shadow-xs min-h-[500px] flex flex-col font-mono text-xs text-emerald-400 max-w-4xl mx-auto w-full">
                        <div className="text-[10px] uppercase font-bold text-neutral-500 mb-2 tracking-wider">
                          HTML Source Editor
                        </div>
                        <textarea
                          value={activeChapter.html}
                          onChange={(e) => updateChapterHtml(e.target.value)}
                          className="flex-1 w-full bg-transparent text-emerald-400 focus:outline-none resize-none font-mono leading-relaxed"
                          spellCheck={false}
                        />
                      </div>
                    )}
                  </div>
                </main>
              </div>
            )}

            {/* 2. METADATA & COVER TAB */}
            {activeTab === "metadata" && (
              <div className="flex-1 overflow-y-auto p-6 sm:p-10 max-w-4xl mx-auto w-full space-y-8">
                <div>
                  <h2 className="text-lg font-bold text-kindle-text mb-1">
                    Book Metadata & Rights
                  </h2>
                  <p className="text-xs text-kindle-text-muted">
                    Configure EPUB metadata that will be embedded inside the OPF package.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-kindle-card p-6 rounded-2xl border border-kindle-border shadow-md">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-kindle-text-muted mb-1">
                      Title
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      className="w-full px-3.5 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-xs font-bold text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-kindle-text-muted mb-1">
                      Author / Creator
                    </label>
                    <input
                      type="text"
                      value={author}
                      onChange={(e) => {
                        setAuthor(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      className="w-full px-3.5 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-xs font-bold text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-kindle-text-muted mb-1">
                      Language Code
                    </label>
                    <input
                      type="text"
                      value={language}
                      onChange={(e) => {
                        setLanguage(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      className="w-full px-3.5 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-xs font-bold text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                      placeholder="en"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-kindle-text-muted mb-1">
                      Publisher
                    </label>
                    <input
                      type="text"
                      value={publisher}
                      onChange={(e) => {
                        setPublisher(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      className="w-full px-3.5 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-xs font-bold text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-kindle-text-muted mb-1">
                      Book Description / Synopsis
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      rows={3}
                      className="w-full px-3.5 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-xs font-bold text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                      placeholder="Write a brief overview of this EPUB book..."
                    />
                  </div>
                </div>

                {/* Cover Designer */}
                <div>
                  <h2 className="text-lg font-bold text-kindle-text mb-1 flex items-center gap-2">
                    <Palette className="w-5 h-5 text-kindle-accent" />
                    <span>EPUB Cover Studio</span>
                  </h2>
                  <p className="text-xs text-kindle-text-muted mb-4">
                    Select a gradient preset or upload a custom image for the front cover.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-6 items-start bg-kindle-card p-6 rounded-2xl border border-kindle-border shadow-md">
                    {/* Live Cover Preview Box */}
                    <div
                      style={{ background: coverBg }}
                      className="w-44 h-64 rounded-xl shadow-2xl p-4 flex flex-col justify-between text-white shrink-0 relative overflow-hidden border border-white/20"
                    >
                      <div className="z-10">
                        <span className="text-[9px] uppercase tracking-widest opacity-75 font-mono">
                          EPUB Edition
                        </span>
                        <h3 className="text-sm font-bold leading-tight mt-1 line-clamp-3">
                          {title}
                        </h3>
                      </div>
                      <div className="z-10">
                        <p className="text-[10px] font-medium opacity-90 truncate">{author}</p>
                      </div>
                    </div>

                    <div className="flex-1 space-y-4">
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-kindle-text-muted mb-2">
                          Color Theme Palette
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {[
                            "linear-gradient(135deg, #2c3e50 0%, #000000 100%)",
                            "linear-gradient(135deg, #134e5e 0%, #71b280 100%)",
                            "linear-gradient(135deg, #614385 0%, #516395 100%)",
                            "linear-gradient(135deg, #021b79 0%, #0575e6 100%)",
                            "linear-gradient(135deg, #200122 0%, #6f0000 100%)",
                          ].map((bg, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setCoverBg(bg);
                                setHasUnsavedChanges(true);
                              }}
                              style={{ background: bg }}
                              className="w-8 h-8 rounded-full border-2 border-white/50 shadow-md cursor-pointer hover:scale-110 transition"
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 4. LIVE PREVIEW TAB */}
            {activeTab === "preview" && (
              <div className="flex-1 overflow-y-auto p-6 sm:p-10 flex items-center justify-center bg-kindle-bg/80">
                <div className="w-full max-w-xl bg-kindle-card border border-kindle-border rounded-3xl p-8 sm:p-12 shadow-2xl space-y-6">
                  <div className="border-b border-kindle-border pb-4 text-center">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-kindle-text-muted">
                      EPUB Reader Preview
                    </span>
                    <h1 className={`text-xl font-bold ${editorFont} text-kindle-text mt-1`}>
                      {activeChapter.title}
                    </h1>
                  </div>

                  <div
                    dangerouslySetInnerHTML={{ __html: activeChapter.html }}
                    className={`${editorFont} text-sm leading-relaxed text-kindle-text space-y-4 prose dark:prose-invert max-w-none`}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
