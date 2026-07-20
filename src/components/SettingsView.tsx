import React, { useState, useEffect } from "react";
import { User } from "firebase/auth";
import {
  Moon, Sun, Monitor,
  User as UserIcon, ShieldCheck, BookOpen,
  Clock, LogIn, Type, AlignLeft, AlignCenter, Baseline,
  Database, Trash2, Search as SearchIcon, Globe, Layout,
  Info, Download, HardDrive, Bell, Volume2, Plus, BookMarked, HelpCircle, ChevronDown, Github, Headphones,
  FileText, Files, Scissors, Wrench, FolderOpen, Newspaper, Circle, Sparkles
} from "lucide-react";
import { getAllDictionaryEntries, addDictionaryEntry, deleteDictionaryEntry, DictionaryEntry } from "../lib/dictionary";
import {
  loadNewsReaderPrefs,
  NEWS_READER_FONT_OPTIONS,
  NEWS_READER_MARGIN_OPTIONS,
  NEWS_READER_PREFS_EVENT,
  NEWS_READER_THEME_OPTIONS,
  patchNewsReaderPrefs,
  type NewsReaderPrefs,
} from "../lib/newsReaderPrefs";
import { 
  getSavedDirectoryHandle, saveDirectoryHandle, clearDirectoryHandle, scanDirectoryForNewBooks,
  getVirtualDirectoryPath, setVirtualDirectoryPath, getVirtualDirectoryFiles, addVirtualDirectoryFile,
  removeVirtualDirectoryFile, scanVirtualDirectory, VirtualBookFile
} from "../lib/directoryHelper";
import { BookMetadata, syncBookToCloud, getLocalLibrary } from "../lib/firebase";
import { storeBookFile } from "../db/indexedDB";
import { inferBookTags } from "../lib/tagsHelper";
import { Cloud, CheckCircle, Upload } from "lucide-react";
import { logger } from "../lib/logger";
import { APP_SKINS, type AppSkinId } from "../lib/appSkin";

const SKIN_PREVIEW: Record<
  AppSkinId,
  { preview: string; dots: string; icon: typeof Layout }
> = {
  kora: {
    preview: "border-kindle-border bg-kindle-card/80 backdrop-blur-sm",
    dots: "rounded-md",
    icon: Layout,
  },
  paper: {
    preview: "border-amber-900/15 bg-[#f4ede3]",
    dots: "rounded-sm",
    icon: BookOpen,
  },
  studio: {
    preview: "border-2 border-kindle-text bg-kindle-bg",
    dots: "rounded-none",
    icon: AlignLeft,
  },
  soft: {
    preview: "border-kindle-border/50 bg-kindle-card shadow-md",
    dots: "rounded-full",
    icon: Circle,
  },
};
import BuiltInAudiobookConverter from "./BuiltInAudiobookConverter";
import WebClipperPanel from "./WebClipperPanel";
import DevicesSyncPanel from "./DevicesSyncPanel";
import EbookToolsPanel from "./EbookToolsPanel";

interface ReaderPrefs {
  fontSize: number;
  lineSpacing: number;
  fontFamily: string;
  theme: string;
  marginSize: string;
  isContinuous: boolean;
  brightness: number;
}

interface SearchPrefs {
  defaultSource: string;
  autoCacheDownloads: boolean;
  openInNewTab: boolean;
}

interface SettingsViewProps {
  user: User | null;
  userId?: string;
  view?: "settings" | "tools";
  grayscaleCovers: boolean;
  hideCovers?: boolean;
  displayTheme: string;
  appSkin?: AppSkinId;
  dailyRemindersEnabled?: boolean;
  onChangeDailyReminders?: (enabled: boolean) => void;
  dailyNewsBriefEnabled?: boolean;
  onChangeDailyNewsBrief?: (enabled: boolean) => void;
  onToggleGrayscale: () => void;
  onToggleHideCovers?: () => void;
  onChangeTheme: (theme: string) => void;
  onChangeAppSkin?: (skin: AppSkinId) => void;
  onSignOut: () => void;
  onSignIn: () => void;
  readerPrefs: ReaderPrefs;
  onReaderPrefsChange: (prefs: ReaderPrefs) => void;
  searchPrefs: SearchPrefs;
  onSearchPrefsChange: (prefs: SearchPrefs) => void;
  bookCount: number;
  cachedCount: number;
  onClearDeviceCache: () => void;
  onClearRecentSearches: () => void;
  books?: any[];
  onRefreshLibrary?: (uid?: string) => void;
  onCachedIdsChanged?: () => void;
  onOpenOnboarding?: () => void;
  /** When false (hidden keep-alive tab), skip heavy IDB/dir init until first activation. */
  isActive?: boolean;
}

function getRemainingGuestDays(user: User | null): number {
  if (!user || !user.metadata.creationTime) return 30;
  try {
    const creationTime = new Date(user.metadata.creationTime).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const elapsedMs = Date.now() - creationTime;
    const remainingMs = Math.max(0, thirtyDaysMs - elapsedMs);
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    return Math.min(30, remainingDays);
  } catch (e) {
    return 30;
  }
}

// Reusable toggle — kindle-accent on, muted accent shade off for clear contrast.
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${
        on ? "bg-kindle-accent" : "bg-kindle-accent/25"
      }`}
      aria-pressed={on}
    >
      <div
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transition-transform ${
          on ? "translate-x-5 bg-kindle-bg" : "translate-x-0 bg-kindle-text/70"
        }`}
      />
    </button>
  );
}

// Reusable setting row
function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <h4 className="text-xs font-bold">{title}</h4>
        {desc && <p className="text-[10px] text-kindle-text-muted">{desc}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-2">{children}</div>
    </div>
  );
}

function SettingsView({
  user,
  userId,
  view = "settings",
  grayscaleCovers,
  hideCovers = false,
  displayTheme,
  appSkin = "kora",
  dailyRemindersEnabled = false,
  onChangeDailyReminders,
  dailyNewsBriefEnabled = false,
  onChangeDailyNewsBrief,
  onToggleGrayscale,
  onToggleHideCovers,
  onChangeTheme,
  onChangeAppSkin,
  onSignOut,
  onSignIn,
  readerPrefs,
  onReaderPrefsChange,
  searchPrefs,
  onSearchPrefsChange,
  bookCount,
  cachedCount,
  onClearDeviceCache,
  onClearRecentSearches,
  books = [],
  onRefreshLibrary,
  onCachedIdsChanged,
  onOpenOnboarding,
  isActive = true,
}: SettingsViewProps) {
  const setRP = (patch: Partial<ReaderPrefs>) => onReaderPrefsChange({ ...readerPrefs, ...patch });
  const setSP = (patch: Partial<SearchPrefs>) => onSearchPrefsChange({ ...searchPrefs, ...patch });

  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    appearance: true,
    reading: false,
    newsReading: false,
    import: false,
    search: false,
    dictionary: false,
    data: false,
    tts: false,
    about: false,
  });

  const [newsReaderPrefs, setNewsReaderPrefs] = useState<NewsReaderPrefs>(() => loadNewsReaderPrefs());
  const setNRP = (patch: Partial<NewsReaderPrefs>) => {
    setNewsReaderPrefs(patchNewsReaderPrefs(patch));
  };

  useEffect(() => {
    const sync = () => setNewsReaderPrefs(loadNewsReaderPrefs());
    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<NewsReaderPrefs>).detail;
      if (detail) setNewsReaderPrefs(detail);
      else sync();
    };
    window.addEventListener(NEWS_READER_PREFS_EVENT, onCustom as EventListener);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(NEWS_READER_PREFS_EVENT, onCustom as EventListener);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggleCategory = (key: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const [dictEntries, setDictEntries] = useState<DictionaryEntry[]>([]);
  const [showLiveLogs, setShowLiveLogs] = useState(false);
  const [liveLogs, setLiveLogs] = useState(() => logger.getLogs());

  useEffect(() => {
    if (showLiveLogs) {
      setLiveLogs(logger.getLogs());
      const unsubscribe = logger.subscribe(() => {
        setLiveLogs(logger.getLogs());
      });
      return unsubscribe;
    }
  }, [showLiveLogs]);

  // File Upload and Sideloading states
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState<boolean>(false);
  const [showCloudImport, setShowCloudImport] = useState<boolean>(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileUpload = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["epub", "pdf", "mobi", "azw3", "html", "json", "txt"].includes(ext)) {
      setUploadError("Only EPUB, PDF, MOBI, AZW3, HTML, JSON, and TXT file formats are supported.");
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      const bookId = "file_" + hashHex.substring(0, 16);
      
      let mimeType = "application/octet-stream";
      if (ext === "pdf") mimeType = "application/pdf";
      else if (ext === "epub") mimeType = "application/epub+zip";
      else if (ext === "html") mimeType = "text/html";
      else if (ext === "json") mimeType = "application/json";
      else if (ext === "txt") mimeType = "text/plain";
      
      const blob = new Blob([arrayBuffer], { type: mimeType });
      
      await storeBookFile(bookId, blob, file.name, ext);
      if (onCachedIdsChanged) {
        onCachedIdsChanged();
      }

      const cleanTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
      const extStr = ext || "epub";
      
      const localBooks = getLocalLibrary();
      const existingBook = localBooks.find(b => b.id === bookId);
      
      if (!existingBook) {
        const inferredTags = inferBookTags(cleanTitle, "Local Upload", extStr);
        const newBook: BookMetadata = {
          id: bookId,
          title: cleanTitle,
          author: "Local Upload",
          extension: extStr,
          size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
          language: "English",
          tags: inferredTags,
          status: "to-read",
          progress: {
            percent: 0,
            lastReadTime: Date.now()
          },
          dateAdded: Date.now()
        };
        await syncBookToCloud(userId || "", newBook);
      }
      
      if (onRefreshLibrary) {
        onRefreshLibrary();
      }
    } catch (err: any) {
      console.error("Local Upload Error:", err);
      setUploadError("Failed to store file locally in IndexedDB: " + err.message);
    } finally {
      setUploading(false);
    }
  };
  const [dictSearch, setDictSearch] = useState<string>("");
  const [showAddWordForm, setShowAddWordForm] = useState<boolean>(false);
  const [newWord, setNewWord] = useState<string>("");
  const [newDef, setNewDef] = useState<string>("");
  const [newPos, setNewPos] = useState<string>("noun");
  const [newEx, setNewEx] = useState<string>("");

  // Download directory settings states
  const [realDirHandle, setRealDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [useVirtualDir, setUseVirtualDir] = useState<boolean>(() => localStorage.getItem("kora_use_virtual_dir") === "true");
  const [virtualPath, setVirtualPath] = useState<string>(getVirtualDirectoryPath());
  const [virtualFiles, setVirtualFiles] = useState<VirtualBookFile[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanResultText, setScanResultText] = useState<string | null>(null);

  // Virtual file creation inputs
  const [newVirtualFileName, setNewVirtualFileName] = useState<string>("");
  const [newVirtualAuthor, setNewVirtualAuthor] = useState<string>("");
  const [newVirtualExt, setNewVirtualExt] = useState<"epub" | "pdf">("epub");

  useEffect(() => {
    if (!isActive) return;
    async function loadDict() {
      const entries = await getAllDictionaryEntries();
      // Only show custom entries in settings, not the external dictionary
      setDictEntries(entries.filter(e => e.isCustom));
    }
    void loadDict();
    
    async function initDir() {
      const handle = await getSavedDirectoryHandle();
      setRealDirHandle(handle);
      setVirtualFiles(getVirtualDirectoryFiles());
    }
    void initDir();
  }, [isActive]);

  const handleSelectRealDir = async () => {
    try {
      if (!(window as any).showDirectoryPicker) {
        alert("Directory Selection is not natively supported by your browser or inside this iframe sandbox. Please enable the 'Virtual Folder Simulator' below to simulate a local downloads folder!");
        return;
      }
      const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      await saveDirectoryHandle(handle);
      setRealDirHandle(handle);
      setScanResultText(`Connected to "${handle.name}". Kora will now scan this folder on load.`);
    } catch (err: any) {
      console.warn("Directory Picker error:", err);
    }
  };

  const handleDisconnectRealDir = async () => {
    await clearDirectoryHandle();
    setRealDirHandle(null);
    setScanResultText("Disconnected from system folder.");
  };

  const handleToggleVirtualDir = () => {
    const newValue = !useVirtualDir;
    setUseVirtualDir(newValue);
    localStorage.setItem("kora_use_virtual_dir", String(newValue));
  };

  const handleUpdateVirtualPath = (path: string) => {
    setVirtualPath(path);
    setVirtualDirectoryPath(path);
  };

  const handleAddVirtualFile = () => {
    if (!newVirtualFileName.trim()) return;
    const newFile: VirtualBookFile = {
      name: newVirtualFileName.trim(),
      author: newVirtualAuthor.trim() || "Local Author",
      size: `${(0.5 + Math.random() * 2).toFixed(1)} MB`,
      extension: newVirtualExt
    };
    addVirtualDirectoryFile(newFile);
    setVirtualFiles(getVirtualDirectoryFiles());
    setNewVirtualFileName("");
    setNewVirtualAuthor("");
  };

  const handleRemoveVirtualFile = (idx: number) => {
    removeVirtualDirectoryFile(idx);
    setVirtualFiles(getVirtualDirectoryFiles());
  };

  const handleScanNow = async () => {
    setIsScanning(true);
    setScanResultText(null);
    try {
      if (realDirHandle) {
        const count = await scanDirectoryForNewBooks(
          realDirHandle,
          books,
          user?.uid || "",
          () => { if (onRefreshLibrary) onRefreshLibrary(); }
        );
        setScanResultText(`Folder analysis complete. Found and imported ${count} new books!`);
        if (onRefreshLibrary) onRefreshLibrary();
      } else if (useVirtualDir) {
        const count = await scanVirtualDirectory(
          books,
          () => { if (onRefreshLibrary) onRefreshLibrary(); }
        );
        setScanResultText(`Virtual Folder analysis complete. Found and imported ${count} new books!`);
        if (onRefreshLibrary) onRefreshLibrary();
      } else {
        setScanResultText("No directory or simulator is currently configured to scan.");
      }
    } catch (err: any) {
      setScanResultText(`Scan failed: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleAddWord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWord.trim() || !newDef.trim()) return;
    addDictionaryEntry({
      word: newWord.trim(),
      definition: newDef.trim(),
      partOfSpeech: newPos,
      example: newEx.trim() || undefined,
      isCustom: true
    });
    const entries = await getAllDictionaryEntries();
    setDictEntries(entries.filter(e => e.isCustom));
    setNewWord("");
    setNewDef("");
    setNewPos("noun");
    setNewEx("");
    setShowAddWordForm(false);
  };

  const handleDeleteWord = async (word: string) => {
    deleteDictionaryEntry(word);
    const entries = await getAllDictionaryEntries();
    setDictEntries(entries.filter(e => e.isCustom));
  };

  const fontOptions = [
    { id: "font-serif", label: "Serif" },
    { id: "font-sans", label: "Sans" },
    { id: "font-lexend", label: "Lexend" },
    { id: "font-opendyslexic", label: "OpenDyslexic" },
    { id: "font-mono", label: "Mono" },
    { id: "font-bookerly", label: "Bookerly" },
    { id: "font-chareink", label: "ChareInk7SP" },
    { id: "font-lexica", label: "Lexica Ultralegible" },
  ];
  const readerThemes = [
    { id: "sepia", label: "Sepia", bg: "bg-[#f4ecd8]", ring: "ring-[#cbb994]" },
    { id: "night", label: "Night", bg: "bg-[#1c1f26]", ring: "ring-[#3a4050]" },
    { id: "paper", label: "Paper", bg: "bg-[#faf7f2]", ring: "ring-[#e4ddd2]" },
    { id: "oled", label: "OLED", bg: "bg-black", ring: "ring-neutral-700" },
    { id: "light", label: "Light", bg: "bg-white", ring: "ring-neutral-300" },
    { id: "dark", label: "Dark", bg: "bg-[#1a1a1a]", ring: "ring-neutral-600" },
    { id: "green", label: "Green", bg: "bg-[#c7edcc]", ring: "ring-[#7fb987]" },
  ];
  const marginOptions = [
    { id: "max-w-xl px-4", label: "Narrow" },
    { id: "max-w-2xl px-6", label: "Medium" },
    { id: "max-w-4xl px-8", label: "Wide" }
  ];
  const sources = [
    { id: "all", label: "All Sources" },
    { id: "annas", label: "Anna's Archive" },
    { id: "libgen", label: "LibGen" },
    { id: "zlib", label: "Z-Library" },
    { id: "ia", label: "Archive.org" },
    { id: "openlibrary", label: "Open Library" }
  ];

  return (
    <div className="space-y-6 md:space-y-10 pb-4 md:pb-10 animate-in fade-in slide-in-from-bottom-4 duration-500 text-left">
      <header className="flex items-center justify-between pb-2 md:pb-4 border-b border-kindle-border font-sans">
        <div>
          <h2 className="text-3xl font-lexend font-bold tracking-tight text-kindle-text">
            {view === "tools" ? "Tools" : "Settings"}
          </h2>
          <p className="hidden md:block text-[10px] text-kindle-text-muted uppercase tracking-wider font-semibold font-mono mt-0.5">
            {view === "tools"
              ? "Import books, cloud sync, and read-aloud utilities"
              : "Profile, preferences & cloud sync"}
          </p>
        </div>
      </header>

      <div className="space-y-6">
        {view === "settings" && (
          <section className="bg-kindle-card border border-kindle-border rounded-2xl p-5 shadow-xs">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-kindle-bg border border-kindle-border flex items-center justify-center shrink-0">
                <UserIcon className="w-7 h-7 text-kindle-text-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-lexend font-bold text-kindle-text truncate">
                  {user && !user.isAnonymous ? user.displayName || user.email || "Kora Reader" : "Guest Reader"}
                </h3>
                <p className="text-xs text-kindle-text-muted truncate">
                  {user && !user.isAnonymous ? user.email : "Sign in to sync your library across devices"}
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {user && !user.isAnonymous ? (
                    <button
                      onClick={onSignOut}
                      className="px-3 py-1.5 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-wider hover:bg-kindle-bg transition"
                    >
                      Sign Out
                    </button>
                  ) : (
                    <button
                      onClick={onSignIn}
                      className="px-3 py-1.5 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition"
                    >
                      Sign In
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-kindle-border/60">
              <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border text-center">
                <p className="text-lg font-bold font-lexend">{bookCount}</p>
                <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">Books</p>
              </div>
              <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border text-center">
                <p className="text-lg font-bold font-lexend text-kindle-accent">{cachedCount}</p>
                <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">Cached</p>
              </div>
              <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border text-center">
                <p className="text-lg font-bold font-lexend">{getRemainingGuestDays(user)}</p>
                <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">Guest Days</p>
              </div>
            </div>
          </section>
        )}

        {view === "settings" && (
        <>
        {/* Appearance — first */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-5 shadow-xs transition-all duration-200">
          <div 
            onClick={() => toggleCategory("appearance")}
            className="flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-3">
              <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
                <Monitor className="w-4 h-4 text-kindle-text" />
              </div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Appearance Settings</h3>
            </div>
            <ChevronDown className={`w-4 h-4 text-kindle-text-muted transition-transform duration-200 ${expandedCategories.appearance ? "rotate-180" : ""}`} />
          </div>

          {expandedCategories.appearance && (
            <div className="mt-4 pt-4 border-t border-kindle-border/40 space-y-5 animate-in slide-in-from-top-2 duration-200">
              <Row title="Grayscale Covers" desc="Classic e-ink aesthetic for book covers">
                <Toggle on={grayscaleCovers} onClick={onToggleGrayscale} />
              </Row>

              <Row title="Hide Cover Images" desc="Do not show any cover images in lists and carousels">
                <Toggle on={hideCovers} onClick={onToggleHideCovers || (() => {})} />
              </Row>

              <div className="space-y-2.5">
                <div>
                  <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">App Skin</h4>
                  <p className="text-[10px] text-kindle-text-muted mt-1">
                    Skins change chrome, materials, and shapes. Display themes only recolor the active skin.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {APP_SKINS.map((skin) => {
                    const selected = appSkin === skin.id;
                    const preview = SKIN_PREVIEW[skin.id];
                    const SkinIcon = preview.icon;
                    return (
                      <button
                        key={skin.id}
                        type="button"
                        onClick={() => onChangeAppSkin?.(skin.id)}
                        className={`relative overflow-hidden flex flex-col items-start gap-2 p-3 rounded-2xl border text-left transition cursor-pointer ${
                          selected
                            ? "border-kindle-accent shadow-xs ring-1 ring-kindle-accent/30 bg-kindle-bg"
                            : "border-kindle-border hover:bg-kindle-bg opacity-80"
                        }`}
                      >
                        <div
                          className={`w-full h-14 rounded-xl border overflow-hidden ${preview.preview}`}
                        >
                          <div className="h-full flex items-end justify-center pb-2 px-3 gap-1.5">
                            {[0, 1, 2, 3].map((i) => (
                              <span
                                key={i}
                                className={`w-3.5 h-3.5 ${preview.dots} ${
                                  i === 1 ? "bg-kindle-accent" : "bg-kindle-border"
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <SkinIcon className="w-3.5 h-3.5 text-kindle-text-muted" />
                          <span className="text-[10px] font-bold uppercase tracking-widest">{skin.label}</span>
                        </div>
                        <span className="text-[9px] text-kindle-text-muted leading-snug">{skin.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2.5">
                <div>
                  <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Display Theme</h4>
                  <p className="text-[10px] text-kindle-text-muted mt-1">
                    Color palette only — White, Yellow, Grey, or Blue — for whichever skin is selected.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onChangeTheme("theme-light-white")}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition cursor-pointer ${displayTheme === 'theme-light-white' ? 'bg-kindle-card border-kindle-accent shadow-xs ring-1 ring-kindle-accent/30' : 'border-kindle-border hover:bg-kindle-card opacity-65'}`}
                  >
                    <Sun className="w-4 h-4" />
                    <span className="text-[9px] font-bold uppercase tracking-widest">White</span>
                  </button>
                  <button
                    onClick={() => onChangeTheme("theme-light-yellow")}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition cursor-pointer ${displayTheme === 'theme-light-yellow' ? 'bg-[#f7f3e3] border-[#6b6459] shadow-xs ring-1 ring-[#6b6459]/30' : 'border-[#d6d2c3] hover:bg-[#f7f3e3] opacity-65'}`}
                  >
                    <Sun className="w-4 h-4 text-yellow-700" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-yellow-900">Yellow</span>
                  </button>
                  <button
                    onClick={() => onChangeTheme("theme-dark-grey")}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition bg-[#18181b] cursor-pointer ${displayTheme === 'theme-dark-grey' ? 'border-[#f4f4f5] shadow-xs ring-1 ring-[#f4f4f5]/30' : 'border-[#3f3f46] hover:bg-[#27272a] opacity-65'}`}
                  >
                    <Moon className="w-4 h-4 text-[#f4f4f5]" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#f4f4f5]">Grey</span>
                  </button>
                  <button
                    onClick={() => onChangeTheme("theme-dark-blue")}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition bg-[#0b1120] cursor-pointer ${displayTheme === 'theme-dark-blue' ? 'border-[#38bdf8] shadow-xs ring-1 ring-[#38bdf8]/30' : 'border-[#1e3a5f] hover:bg-[#0f1f38] opacity-65'}`}
                  >
                    <Moon className="w-4 h-4 text-[#38bdf8]" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#38bdf8]">Blue</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
        </>
        )}

        {view === "tools" && (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { id: "import", icon: Upload, label: "Import", desc: "Add files" },
            { id: "cloud", icon: Cloud, label: "Cloud", desc: "Drive & Dropbox" },
            { id: "folder", icon: FolderOpen, label: "Folder", desc: "Auto-watch" },
            { id: "tts", icon: Headphones, label: "Read Aloud", desc: "TTS convert" },
          ].map((tool) => (
            <button
              key={tool.id}
              onClick={() => {
                if (tool.id === "cloud") setShowCloudImport(true);
                else if (tool.id === "folder") toggleCategory("folder");
                else if (tool.id === "tts") toggleCategory("tts");
                else document.getElementById("drag-and-drop-box")?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className="bg-kindle-card border border-kindle-border rounded-2xl p-4 text-left hover:border-kindle-text/20 transition flex flex-col gap-2"
            >
              <div className="p-2 rounded-xl bg-kindle-bg border border-kindle-border w-fit">
                <tool.icon className="w-4 h-4 text-kindle-accent" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-kindle-text">{tool.label}</p>
                <p className="text-[9px] text-kindle-text-muted">{tool.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { id: "epub-tools", icon: FileText, label: "EPUB Tools", desc: "Extract, build, metadata" },
            { id: "pdf-tools", icon: Files, label: "PDF Tools", desc: "Merge, rotate, split" },
            { id: "clipper", icon: Globe, label: "Web Clipper", desc: "URL → ebook" },
            { id: "highlights", icon: Download, label: "Highlights", desc: "Export Markdown" },
          ].map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => {
                const target =
                  tool.id === "clipper"
                    ? "web-clipper-panel"
                    : "ebook-tools-panel";
                document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
                if (tool.id !== "clipper") {
                  window.dispatchEvent(new CustomEvent("kora-tools-focus", { detail: tool.id }));
                }
              }}
              className="bg-kindle-card border border-kindle-border rounded-2xl p-4 text-left hover:border-kindle-text/20 transition flex flex-col gap-2"
            >
              <div className="p-2 rounded-xl bg-kindle-bg border border-kindle-border w-fit">
                <tool.icon className="w-4 h-4 text-kindle-accent" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-kindle-text">{tool.label}</p>
                <p className="text-[9px] text-kindle-text-muted">{tool.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <div id="ebook-tools-panel">
          <EbookToolsPanel userId={userId} books={books as BookMetadata[]} />
        </div>

        <div id="web-clipper-panel">
          <WebClipperPanel userId={userId} onRefreshLibrary={onRefreshLibrary} />
        </div>

        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-kindle-accent" />
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-kindle-text">Import Files</h3>
          </div>
          <p className="text-[10px] text-kindle-text-muted leading-relaxed">
            Drag and drop local ebooks into your private offline library.
          </p>
          <div 
            id="drag-and-drop-box"
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 ${
              isDragActive 
                ? "border-kindle-accent bg-kindle-accent/5" 
                : "border-kindle-border hover:border-kindle-text-muted bg-kindle-bg/40"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".epub,.pdf,.mobi,.azw3,.html,.json,.txt"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileUpload(e.target.files[0]);
                }
              }}
              className="hidden"
            />

            {uploading ? (
              <>
                <div className="w-5 h-5 border-2 border-kindle-accent border-t-transparent rounded-full animate-spin"></div>
                <p className="text-[9px] font-bold text-kindle-text-muted uppercase tracking-widest animate-pulse">Syncing to storage...</p>
              </>
            ) : (
              <>
                <div className="p-2 bg-kindle-bg border border-kindle-border rounded-xl text-kindle-text-muted">
                  <Upload className="w-5 h-5 text-kindle-text" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider">Drag & Drop or Tap to Add</p>
                  <p className="text-[9px] text-kindle-text-muted font-mono uppercase tracking-widest">EPUB · PDF · HTML · TXT</p>
                </div>
              </>
            )}
          </div>

          {uploadError && (
            <p className="text-[9px] text-red-500 font-bold uppercase tracking-wider text-center bg-red-500/5 py-2 rounded-lg border border-red-500/10">
              {uploadError}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <button 
              onClick={() => setShowCloudImport(true)}
              className="p-3 bg-kindle-bg border border-kindle-border rounded-xl flex items-center gap-3 hover:bg-neutral-100 dark:hover:bg-neutral-800/40 transition w-full text-left"
            >
              <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg shrink-0">
                <Cloud className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text">Cloud Import</p>
                <p className="text-[9px] text-kindle-text-muted">Google Drive or Dropbox</p>
              </div>
            </button>
            <button
              onClick={() => toggleCategory("folder")}
              className="p-3 bg-kindle-bg border border-kindle-border rounded-xl flex items-center gap-3 hover:bg-neutral-100 dark:hover:bg-neutral-800/40 transition w-full text-left"
            >
              <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg shrink-0">
                <FolderOpen className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text">Folder Watch</p>
                <p className="text-[9px] text-kindle-text-muted">Auto-ingest new files</p>
              </div>
            </button>
          </div>
        </section>
        </>
        )}

        {view === "settings" && (
        <>
        {/* Reading */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-5 shadow-xs transition-all duration-200">
          <div 
            onClick={() => toggleCategory("reading")}
            className="flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-3">
              <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
                <Type className="w-4 h-4 text-kindle-text" />
              </div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Reading Settings</h3>
            </div>
            <ChevronDown className={`w-4 h-4 text-kindle-text-muted transition-transform duration-200 ${expandedCategories.reading ? "rotate-180" : ""}`} />
          </div>

          {expandedCategories.reading && (
            <div className="mt-4 pt-4 border-t border-kindle-border/40 space-y-5 animate-in slide-in-from-top-2 duration-200">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold">Font Size</h4>
                  <span className="text-[10px] font-mono text-kindle-text-muted">{readerPrefs.fontSize}px</span>
                </div>
                <input
                  type="range" min={12} max={32} step={1} value={readerPrefs.fontSize}
                  onChange={(e) => setRP({ fontSize: Number(e.target.value) })}
                  className="w-full accent-kindle-accent cursor-pointer"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold">Line Spacing</h4>
                  <span className="text-[10px] font-mono text-kindle-text-muted">{readerPrefs.lineSpacing.toFixed(1)}</span>
                </div>
                <input
                  type="range" min={1.2} max={2.4} step={0.1} value={readerPrefs.lineSpacing}
                  onChange={(e) => setRP({ lineSpacing: Number(e.target.value) })}
                  className="w-full accent-kindle-accent cursor-pointer"
                />
              </div>

              <div className="space-y-2.5">
                <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Font Family</h4>
                <div className="grid grid-cols-3 gap-2">
                  {fontOptions.map(f => (
                    <button key={f.id} onClick={() => setRP({ fontFamily: f.id })}
                      className={`min-w-0 py-2 px-1 rounded-xl border text-[9px] font-bold uppercase tracking-wider transition ${readerPrefs.fontFamily === f.id ? 'bg-kindle-text text-kindle-bg border-kindle-text' : 'border-kindle-border text-kindle-text-muted hover:bg-kindle-bg'}`}>
                      <span className={`${f.id} truncate block`}>{f.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Reader Theme</h4>
                <div className="grid grid-cols-4 gap-2">
                  {readerThemes.map(t => (
                    <button key={t.id} onClick={() => setRP({ theme: t.id })}
                      className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition ${readerPrefs.theme === t.id ? 'border-kindle-accent ring-1 ring-kindle-accent/30' : 'border-kindle-border hover:bg-kindle-bg'}`}>
                      <div className={`w-6 h-6 rounded-md ${t.bg} ring-1 ${t.ring}`} />
                      <span className="text-[8px] font-bold uppercase tracking-widest">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Page Width</h4>
                <div className="flex gap-2">
                  {marginOptions.map(m => (
                    <button key={m.id} onClick={() => setRP({ marginSize: m.id })}
                      className={`flex-1 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition ${readerPrefs.marginSize === m.id ? 'bg-kindle-text text-kindle-bg border-kindle-text' : 'border-kindle-border text-kindle-text-muted hover:bg-kindle-bg'}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <Row title="Continuous Scroll" desc="Off = page-by-page e-reader (default). On = scroll chapters as one long page.">
                <Toggle on={readerPrefs.isContinuous} onClick={() => setRP({ isContinuous: !readerPrefs.isContinuous })} />
              </Row>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold">Brightness</h4>
                  <span className="text-[10px] font-mono text-kindle-text-muted">{readerPrefs.brightness}%</span>
                </div>
                <input
                  type="range" min={40} max={100} step={5} value={readerPrefs.brightness}
                  onChange={(e) => setRP({ brightness: Number(e.target.value) })}
                  className="w-full accent-kindle-accent cursor-pointer"
                />
              </div>
            </div>
          )}
        </section>

        {/* News Reader */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-5 shadow-xs transition-all duration-200">
          <div
            onClick={() => toggleCategory("newsReading")}
            className="flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-3">
              <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
                <Newspaper className="w-4 h-4 text-kindle-text" />
              </div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">News Reader</h3>
            </div>
            <ChevronDown className={`w-4 h-4 text-kindle-text-muted transition-transform duration-200 ${expandedCategories.newsReading ? "rotate-180" : ""}`} />
          </div>

          {expandedCategories.newsReading && (
            <div className="mt-4 pt-4 border-t border-kindle-border/40 space-y-5 animate-in slide-in-from-top-2 duration-200">
              <p className="text-[10px] text-kindle-text-muted">
                Shared text settings for Feed articles and the Daily News Brief. Changes are remembered on this device and can also be adjusted while reading.
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold">Font Size</h4>
                  <span className="text-[10px] font-mono text-kindle-text-muted">{newsReaderPrefs.fontSize}px</span>
                </div>
                <input
                  type="range"
                  min={12}
                  max={36}
                  step={1}
                  value={newsReaderPrefs.fontSize}
                  onChange={(e) => setNRP({ fontSize: Number(e.target.value) })}
                  className="w-full accent-kindle-accent cursor-pointer"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold">Line Spacing</h4>
                  <span className="text-[10px] font-mono text-kindle-text-muted">{newsReaderPrefs.lineSpacing.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={1.2}
                  max={2.6}
                  step={0.1}
                  value={newsReaderPrefs.lineSpacing}
                  onChange={(e) => setNRP({ lineSpacing: Number(e.target.value) })}
                  className="w-full accent-kindle-accent cursor-pointer"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold">Paragraph Spacing</h4>
                  <span className="text-[10px] font-mono text-kindle-text-muted">{newsReaderPrefs.paragraphSpacing.toFixed(1)}em</span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={2.2}
                  step={0.1}
                  value={newsReaderPrefs.paragraphSpacing}
                  onChange={(e) => setNRP({ paragraphSpacing: Number(e.target.value) })}
                  className="w-full accent-kindle-accent cursor-pointer"
                />
              </div>

              <div className="space-y-2.5">
                <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Font Family</h4>
                <div className="flex flex-wrap gap-2">
                  {NEWS_READER_FONT_OPTIONS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setNRP({ fontFamily: f.id })}
                      className={`px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition ${
                        newsReaderPrefs.fontFamily === f.id
                          ? "bg-kindle-text text-kindle-bg border-kindle-text"
                          : "border-kindle-border text-kindle-text-muted hover:bg-kindle-bg"
                      }`}
                    >
                      <span className={f.id}>{f.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Page Width</h4>
                <div className="flex gap-2">
                  {NEWS_READER_MARGIN_OPTIONS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setNRP({ marginSize: m.id })}
                      className={`flex-1 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition ${
                        newsReaderPrefs.marginSize === m.id
                          ? "bg-kindle-text text-kindle-bg border-kindle-text"
                          : "border-kindle-border text-kindle-text-muted hover:bg-kindle-bg"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Reader Theme</h4>
                <div className="grid grid-cols-4 gap-2">
                  {NEWS_READER_THEME_OPTIONS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setNRP({ theme: t.id })}
                      className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition ${
                        newsReaderPrefs.theme === t.id
                          ? "border-kindle-accent ring-1 ring-kindle-accent/30"
                          : "border-kindle-border hover:bg-kindle-bg"
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-md ${t.bg} ring-1 ${t.ring}`} />
                      <span className="text-[8px] font-bold uppercase tracking-widest">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold">Brightness</h4>
                  <span className="text-[10px] font-mono text-kindle-text-muted">{newsReaderPrefs.brightness}%</span>
                </div>
                <input
                  type="range"
                  min={40}
                  max={100}
                  step={5}
                  value={newsReaderPrefs.brightness}
                  onChange={(e) => setNRP({ brightness: Number(e.target.value) })}
                  className="w-full accent-kindle-accent cursor-pointer"
                />
              </div>
            </div>
          )}
        </section>

        {/* Search & Discovery */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-5 shadow-xs transition-all duration-200">
          <div 
            onClick={() => toggleCategory("search")}
            className="flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-3">
              <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
                <SearchIcon className="w-4 h-4 text-kindle-text" />
              </div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Search &amp; Discovery</h3>
            </div>
            <ChevronDown className={`w-4 h-4 text-kindle-text-muted transition-transform duration-200 ${expandedCategories.search ? "rotate-180" : ""}`} />
          </div>

          {expandedCategories.search && (
            <div className="mt-4 pt-4 border-t border-kindle-border/40 space-y-5 animate-in slide-in-from-top-2 duration-200">
              <div className="space-y-2.5">
                <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Default Source</h4>
                <div className="grid grid-cols-2 gap-2">
                  {sources.map(s => (
                    <button key={s.id} onClick={() => setSP({ defaultSource: s.id })}
                      className={`py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition ${searchPrefs.defaultSource === s.id ? 'bg-kindle-text text-kindle-bg border-kindle-text' : 'border-kindle-border text-kindle-text-muted hover:bg-kindle-bg'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <Row title="Auto-cache Downloads" desc="Save opened books to this device automatically">
                <Toggle on={searchPrefs.autoCacheDownloads} onClick={() => setSP({ autoCacheDownloads: !searchPrefs.autoCacheDownloads })} />
              </Row>
              <Row title="Open Results in New Tab" desc="Open the in-app browser in a separate tab">
                <Toggle on={searchPrefs.openInNewTab} onClick={() => setSP({ openInNewTab: !searchPrefs.openInNewTab })} />
              </Row>
              <Row title="Daily Motivation Reminders" desc="Get a daily quote and reading streak on open">
                <Toggle on={dailyRemindersEnabled} onClick={() => onChangeDailyReminders?.(!dailyRemindersEnabled)} />
              </Row>
              <Row title="Daily News Brief" desc="Morning notification with headlines from your RSS feeds">
                <Toggle on={dailyNewsBriefEnabled} onClick={() => onChangeDailyNewsBrief?.(!dailyNewsBriefEnabled)} />
              </Row>
            </div>
          )}
        </section>
        </>
        )}

        {(view === "settings" || view === "tools") && (
        <>
        {/* Personal Dictionary Section */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-kindle-border pb-3">
            <div className="flex items-center gap-3">
              <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
                <BookMarked className="w-4 h-4 text-kindle-text" />
              </div>
              <div>
                <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Personal Dictionary</h3>
                <p className="text-[10px] text-kindle-text-muted">Definitions used inside book readers</p>
              </div>
            </div>
            <button
              onClick={() => setShowAddWordForm(!showAddWordForm)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-kindle-text text-kindle-bg hover:bg-kindle-accent rounded-xl text-[9px] font-bold uppercase tracking-widest transition"
            >
              <Plus className="w-3 h-3" /> {showAddWordForm ? "Cancel" : "Add Word"}
            </button>
          </div>

          {showAddWordForm && (
            <form onSubmit={handleAddWord} className="p-4 bg-kindle-bg border border-kindle-border rounded-xl space-y-3.5 animate-in slide-in-from-top duration-200">
              <h4 className="text-[10px] uppercase tracking-widest font-bold text-kindle-text-muted">Define Custom Word</h4>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] uppercase tracking-wider font-bold text-kindle-text-muted mb-1">Word</label>
                  <input
                    type="text"
                    required
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    placeholder="e.g. Ephemeral"
                    className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase tracking-wider font-bold text-kindle-text-muted mb-1">Part of Speech</label>
                  <select
                    value={newPos}
                    onChange={(e) => setNewPos(e.target.value)}
                    className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none"
                  >
                    <option value="noun">Noun</option>
                    <option value="verb">Verb</option>
                    <option value="adjective">Adjective</option>
                    <option value="adverb">Adverb</option>
                    <option value="other">Other/Mix</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[9px] uppercase tracking-wider font-bold text-kindle-text-muted mb-1">Definition</label>
                <textarea
                  required
                  rows={2}
                  value={newDef}
                  onChange={(e) => setNewDef(e.target.value)}
                  placeholder="The meaning of the word..."
                  className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase tracking-wider font-bold text-kindle-text-muted mb-1">Example Usage (Optional)</label>
                <input
                  type="text"
                  value={newEx}
                  onChange={(e) => setNewEx(e.target.value)}
                  placeholder="Sentence using the word..."
                  className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-kindle-text text-kindle-bg hover:bg-kindle-accent rounded-lg text-[10px] font-bold uppercase tracking-widest transition"
              >
                Save Word Definition
              </button>
            </form>
          )}

          <div className="space-y-3">
            <div className="relative">
              <SearchIcon className="w-3.5 h-3.5 text-kindle-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search words in dictionary..."
                value={dictSearch}
                onChange={(e) => setDictSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-xs outline-none"
              />
            </div>

            <div className="max-h-60 overflow-y-auto border border-kindle-border rounded-xl divide-y divide-kindle-border bg-kindle-bg scrollbar-hide">
              {dictEntries
                .filter(entry => entry.word.toLowerCase().includes(dictSearch.toLowerCase()))
                .map((entry) => (
                  <div key={entry.word} className="p-3.5 flex items-start justify-between gap-3 bg-kindle-card">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold font-serif text-sm">{entry.word}</span>
                        {entry.partOfSpeech && (
                          <span className="text-[8px] uppercase tracking-wider font-mono font-bold text-kindle-text-muted/70 bg-neutral-150 px-1 py-0.5 rounded">
                            {entry.partOfSpeech}
                          </span>
                        )}
                        {entry.isCustom && (
                          <span className="text-[7px] uppercase tracking-widest font-bold bg-kindle-accent/15 text-kindle-accent px-1.5 py-0.5 rounded-full">
                            Personal
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-kindle-text leading-relaxed font-sans">{entry.definition}</p>
                      {entry.example && (
                        <p className="text-[10px] italic text-kindle-text-muted font-sans font-medium">"{entry.example}"</p>
                      )}
                    </div>
                    {entry.isCustom && (
                      <button
                        onClick={() => handleDeleteWord(entry.word)}
                        className="p-1.5 text-kindle-text-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Delete Definition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}

              {dictEntries.filter(entry => entry.word.toLowerCase().includes(dictSearch.toLowerCase())).length === 0 && (
                <div className="p-8 text-center text-xs text-kindle-text-muted italic">
                  No words matching your search
                </div>
              )}
            </div>
          </div>
        </section>
        </>
        )}

        {view === "settings" && (
        <>
        {showCloudImport && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in zoom-in duration-200">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowCloudImport(false)} />
            <div className="relative w-full max-w-sm bg-kindle-card border border-kindle-border rounded-2xl shadow-2xl p-8 text-center text-kindle-text">
              <div className="w-16 h-16 bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Cloud className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold mb-2">Cloud Connectivity</h3>
              <p className="text-xs text-kindle-text-muted mb-8 leading-relaxed">
                Connect your Google Drive or Dropbox to instantly sync your entire ebook collection. 
                Secure OAuth integration ensures your data stays private.
              </p>
              <div className="space-y-3">
                <button 
                  className="w-full py-3.5 bg-[#4285F4] text-white rounded-xl text-xs font-bold uppercase tracking-widest shadow-lg hover:brightness-110 transition cursor-pointer"
                  onClick={() => alert("Cloud Sync Integration: Please set up Google OAuth in AI Studio settings to enable this feature.")}
                >
                  Connect Google Drive
                </button>
                <button 
                  className="w-full py-3.5 bg-kindle-bg border border-kindle-border text-kindle-text rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-kindle-card transition cursor-pointer"
                  onClick={() => setShowCloudImport(false)}
                >
                  Maybe Later
                </button>
              </div>
            </div>
          </div>
        )}

        {view === "tools" && isActive ? (
          <DevicesSyncPanel
            userId={userId}
            books={books}
            onCachedIdsChanged={onCachedIdsChanged}
          />
        ) : null}

        {/* Data & Storage */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
            <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
              <Database className="w-4 h-4 text-kindle-text" />
            </div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Data & Storage</h3>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border">
              <p className="text-lg font-bold font-lexend">{bookCount}</p>
              <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">Books in Library</p>
            </div>
            <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border">
              <p className="text-lg font-bold font-lexend text-kindle-accent">{cachedCount}</p>
              <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">Cached On Device</p>
            </div>
          </div>

          <button
            onClick={onClearDeviceCache}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-bg transition cursor-pointer"
          >
            <HardDrive className="w-3.5 h-3.5" /> Clear Cached Book Files
          </button>
          <button
            onClick={onClearRecentSearches}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-bg transition cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear Recent Searches
          </button>

          <div className="border-t border-kindle-border/40 pt-4 space-y-2.5">
            <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Diagnostic & Download Logs</h4>
            <div className="flex gap-2">
              <button
                onClick={() => logger.downloadLogsAsFile()}
                className="flex-1 flex items-center justify-center gap-2 py-2 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-bg transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-kindle-accent" /> Export Logs
              </button>
              <button
                onClick={() => {
                  logger.clear();
                  alert("Diagnostic logs cleared.");
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-bg transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" /> Clear Log
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowLiveLogs(!showLiveLogs)}
              className="w-full flex items-center justify-between py-2 px-3 border border-kindle-border/60 rounded-xl text-[10px] text-kindle-text hover:bg-kindle-bg transition cursor-pointer"
            >
              <span className="font-bold uppercase tracking-wider">Live Log Console ({liveLogs.length})</span>
              <ChevronDown className={`w-3.5 h-3.5 text-kindle-text-muted transition-transform duration-200 ${showLiveLogs ? "rotate-180" : ""}`} />
            </button>

            {showLiveLogs && (
              <div className="border border-kindle-border/60 rounded-xl overflow-hidden bg-neutral-50 dark:bg-neutral-950 p-2.5 space-y-2 max-h-60 overflow-y-auto">
                {liveLogs.length === 0 ? (
                  <p className="text-[9px] text-kindle-text-muted text-center py-2">No logs captured yet.</p>
                ) : (
                  [...liveLogs].reverse().map((log, index) => {
                    const typeColors = {
                      info: "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/40 dark:border-blue-900/40",
                      warn: "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-900/40",
                      error: "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/40 dark:border-red-900/40"
                    }[log.type];

                    return (
                      <div key={index} className="text-[10px] border-b border-kindle-border/30 pb-2 last:border-0 last:pb-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`px-1 rounded text-[8px] font-bold uppercase border ${typeColors}`}>
                            {log.type}
                          </span>
                          <span className="text-[8px] text-kindle-text-muted font-mono">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-kindle-text leading-tight break-all">
                          {log.message}
                        </p>
                        {log.detail && (
                          <pre className="mt-1 bg-white dark:bg-neutral-900 border border-kindle-border/40 p-1.5 rounded text-[8px] font-mono text-kindle-text-muted max-h-24 overflow-y-auto overflow-x-auto whitespace-pre">
                            {log.detail}
                          </pre>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <p className="text-[8px] text-kindle-text-muted leading-relaxed italic">
              Includes diagnostic events, download activity history, proxy attempts, worker syncs, and system errors.
            </p>
          </div>
        </section>
        </>
        )}

        {view === "tools" && (
        <>
        {expandedCategories.folder && (
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-5 shadow-xs space-y-5 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between gap-3 border-b border-kindle-border pb-3">
            <div className="flex items-center gap-3">
              <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
                <FolderOpen className="w-4 h-4 text-emerald-500" />
              </div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Folder Auto-Ingestion</h3>
            </div>
            <button onClick={() => toggleCategory("folder")} className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">
              Close
            </button>
          </div>

          <p className="text-[11px] text-kindle-text-muted leading-relaxed">
            Map a localized system folder using native web-standard file APIs to automatically discover, index, and cache digital publications on your device.
          </p>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h5 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">System Folder Integration</h5>
                <p className="text-[9px] text-kindle-text-muted">Use native File System Access APIs</p>
              </div>
              {realDirHandle ? (
                <button
                  onClick={handleDisconnectRealDir}
                  className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/45 dark:text-red-400 rounded-lg text-[9px] font-bold uppercase tracking-widest transition cursor-pointer"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={handleSelectRealDir}
                  className="px-3 py-1.5 bg-kindle-bg border border-kindle-border hover:bg-neutral-100 rounded-lg text-[9px] font-bold uppercase tracking-widest transition cursor-pointer"
                >
                  Select Folder
                </button>
              )}
            </div>

            {realDirHandle && (
              <div className="p-2.5 bg-kindle-bg border border-kindle-border rounded-xl flex items-center justify-between animate-in fade-in">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-mono truncate max-w-xs">{realDirHandle.name}</span>
                </div>
                <span className="text-[8px] uppercase tracking-widest font-bold font-mono text-emerald-600">Active Path</span>
              </div>
            )}

            {/* Virtual Fallback Simulator Mode */}
            <div className="border-t border-kindle-border/40 pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h5 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">Virtual Folder Simulator</h5>
                  <p className="text-[9px] text-kindle-text-muted">Simulate a local downloads folder in iframe sandboxes</p>
                </div>
                <Toggle
                  on={useVirtualDir}
                  onClick={handleToggleVirtualDir}
                />
              </div>

              {useVirtualDir && (
                <div className="space-y-3 animate-in fade-in duration-300">
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-kindle-text-muted mb-1">
                      Virtual Location Path
                    </label>
                    <input
                      type="text"
                      value={virtualPath}
                      onChange={(e) => handleUpdateVirtualPath(e.target.value)}
                      placeholder="e.g. ~/Downloads/Kora"
                      className="w-full px-3 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-xs font-mono outline-none focus:border-kindle-accent"
                    />
                  </div>

                  <div className="p-4 bg-kindle-bg border border-kindle-border rounded-xl space-y-3">
                    <div className="flex items-center justify-between border-b border-kindle-border pb-2">
                      <span className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Simulated Directory Content</span>
                      <span className="text-[9px] font-mono font-bold">{virtualFiles.length} files present</span>
                    </div>

                    {virtualFiles.length === 0 ? (
                      <p className="text-[10px] text-kindle-text-muted italic text-center py-2">
                        Folder is empty. Add virtual files below to simulate downloading or side-loading.
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {virtualFiles.map((f, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px] p-2 bg-kindle-card border border-kindle-border rounded-lg">
                            <div className="flex items-center gap-2 min-w-0">
                              <BookMarked className="w-3.5 h-3.5 text-kindle-text-muted" />
                              <div className="min-w-0">
                                <p className="font-serif font-bold truncate">{f.name}</p>
                                <p className="text-[8px] text-kindle-text-muted font-sans uppercase tracking-wider">{f.author} • {f.size}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[8px] font-mono bg-kindle-bg px-1.5 py-0.5 rounded border border-kindle-border uppercase font-bold text-kindle-text-muted">
                                {f.extension}
                              </span>
                              <button
                                onClick={() => handleRemoveVirtualFile(i)}
                                className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                                title="Delete from virtual folder"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add simulated book inputs */}
                    <div className="border-t border-kindle-border/60 pt-3 space-y-2">
                      <p className="text-[8px] uppercase tracking-widest font-bold text-kindle-text-muted">
                        Add Simulated Ebook to Folder
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Book Title (e.g., Moby Dick)"
                          value={newVirtualFileName}
                          onChange={(e) => setNewVirtualFileName(e.target.value)}
                          className="p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs outline-none"
                        />
                        <input
                          type="text"
                          placeholder="Author"
                          value={newVirtualAuthor}
                          onChange={(e) => setNewVirtualAuthor(e.target.value)}
                          className="p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs outline-none"
                        />
                      </div>
                      <div className="flex gap-2 items-center">
                        <select
                          value={newVirtualExt}
                          onChange={(e) => setNewVirtualExt(e.target.value as any)}
                          className="p-1.5 bg-kindle-card border border-kindle-border rounded-lg text-xs outline-none"
                        >
                          <option value="epub">EPUB format</option>
                          <option value="pdf">PDF format</option>
                        </select>
                        <button
                          onClick={handleAddVirtualFile}
                          className="flex-1 py-1.5 bg-kindle-text text-kindle-bg hover:bg-kindle-accent rounded-lg text-[9px] font-bold uppercase tracking-widest transition flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" /> Place in Folder
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Trigger Row */}
          <div className="border-t border-kindle-border pt-4 flex flex-col gap-3">
            <button
              onClick={handleScanNow}
              disabled={isScanning || (!realDirHandle && !useVirtualDir)}
              className="w-full flex items-center justify-center gap-2 py-3 bg-kindle-text text-kindle-bg hover:bg-kindle-accent disabled:opacity-40 disabled:hover:bg-kindle-text rounded-xl text-[10px] font-bold uppercase tracking-widest transition cursor-pointer"
            >
              <HardDrive className={`w-3.5 h-3.5 ${isScanning ? "animate-spin" : ""}`} />
              {isScanning ? "Analyzing Directory..." : "Analyze Folder for New Books Now"}
            </button>

            {scanResultText && (
              <p className="text-[10px] text-center font-semibold text-emerald-600 uppercase tracking-wider animate-pulse">
                {scanResultText}
              </p>
            )}
          </div>
        </section>
        )}

        {/* Read Aloud — collapsed by default, near bottom */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-5 shadow-xs transition-all duration-200">
          <div
            onClick={() => toggleCategory("tts")}
            className="flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-3">
              <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
                <Headphones className="w-4 h-4 text-kindle-text" />
              </div>
              <div>
                <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Read Aloud</h3>
                <p className="text-[9px] text-kindle-text-muted mt-0.5">Built-in audiobook converter &amp; voice settings</p>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-kindle-text-muted transition-transform duration-200 ${expandedCategories.tts ? "rotate-180" : ""}`} />
          </div>

          {expandedCategories.tts && (
            <div className="mt-4 pt-4 border-t border-kindle-border/40 animate-in slide-in-from-top-2 duration-200">
              <BuiltInAudiobookConverter
                books={(books as BookMetadata[]) || []}
                userId={userId}
                onRefreshLibrary={onRefreshLibrary}
              />
            </div>
          )}
        </section>
        </>
        )}

        {view === "settings" && (
        <>
        {/* About */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
            <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
              <Info className="w-4 h-4 text-kindle-text" />
            </div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">About Me</h3>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-kindle-text-muted">Version</span>
              <span className="font-mono font-bold">Kora 1.2.0</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-kindle-text-muted">Powered by</span>
              <span className="font-bold flex items-center gap-1"><Sparkles className="w-3 h-3 text-kindle-accent" /> Rave Engine</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-kindle-text-muted">GitHub</span>
              <a 
                href="https://github.com/CHAOTIC-RAY/Kora-" 
                target="_blank" 
                rel="noreferrer" 
                className="font-bold flex items-center gap-1.5 hover:text-kindle-accent transition-colors"
              >
                <Github className="w-3.5 h-3.5" />
                Kora Repository
              </a>
            </div>

            <div className="pt-2 space-y-2 border-t border-kindle-border/50">
              <p className="text-[10px] leading-relaxed text-kindle-text-muted italic">
                A minimal, high-performance reader environment for digital sovereignty.
              </p>
              {onOpenOnboarding && (
                <button
                  type="button"
                  onClick={onOpenOnboarding}
                  className="w-full mt-2 py-2 px-3 bg-kindle-accent text-kindle-bg hover:opacity-90 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Booknerd Setup & Walkthrough
                </button>
              )}
            </div>
          </div>
        </section>
        </>
        )}
      </div>
    </div>
  );
}

export default React.memo(SettingsView);
