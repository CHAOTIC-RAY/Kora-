import React, { useState, useEffect } from "react";
import { User } from "firebase/auth";
import {
  Moon, Sun, Monitor,
  User as UserIcon, ShieldCheck, BookOpen,
  Clock, LogIn, Type, AlignLeft, AlignCenter, Baseline,
  Database, Trash2, Search as SearchIcon, Globe, Layout,
  Sparkles, Info, Download, HardDrive, Bell, Volume2, Plus, BookMarked, HelpCircle, ChevronDown
} from "lucide-react";
import { getAllDictionaryEntries, addDictionaryEntry, deleteDictionaryEntry, DictionaryEntry } from "../lib/dictionary";
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
  grayscaleCovers: boolean;
  hideCovers?: boolean;
  displayTheme: string;
  dailyRemindersEnabled?: boolean;
  onChangeDailyReminders?: (enabled: boolean) => void;
  onToggleGrayscale: () => void;
  onToggleHideCovers?: () => void;
  onChangeTheme: (theme: string) => void;
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

// Reusable toggle switch
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${on ? "bg-kindle-accent" : "bg-neutral-300"}`}
      aria-pressed={on}
    >
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${on ? "translate-x-5.5" : "translate-x-0.5"}`} />
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

export default function SettingsView({
  user,
  userId,
  grayscaleCovers,
  hideCovers = false,
  displayTheme,
  dailyRemindersEnabled = false,
  onChangeDailyReminders,
  onToggleGrayscale,
  onToggleHideCovers,
  onChangeTheme,
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
  onOpenOnboarding
}: SettingsViewProps) {
  const setRP = (patch: Partial<ReaderPrefs>) => onReaderPrefsChange({ ...readerPrefs, ...patch });
  const setSP = (patch: Partial<SearchPrefs>) => onSearchPrefsChange({ ...searchPrefs, ...patch });

  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    account: true,      // Expanded by default
    appearance: true,   // Expanded by default
    reading: false,     // Collapsed by default
    import: false,      // Collapsed by default
    search: false,      // Collapsed by default
    dictionary: false,  // Collapsed by default
    data: false,        // Collapsed by default
    about: false,       // Collapsed by default
  });

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
    async function loadDict() {
      const entries = await getAllDictionaryEntries();
      // Only show custom entries in settings, not the external dictionary
      setDictEntries(entries.filter(e => e.isCustom));
    }
    loadDict();
    
    async function initDir() {
      const handle = await getSavedDirectoryHandle();
      setRealDirHandle(handle);
      setVirtualFiles(getVirtualDirectoryFiles());
    }
    initDir();
  }, []);

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
    { id: "font-mono", label: "Mono" }
  ];
  const readerThemes = [
    { id: "light", label: "Light", bg: "bg-white", ring: "ring-neutral-300" },
    { id: "sepia", label: "Sepia", bg: "bg-[#f4ecd8]", ring: "ring-[#cbb994]" },
    { id: "dark", label: "Dark", bg: "bg-[#1a1a1a]", ring: "ring-neutral-600" },
    { id: "green", label: "Green", bg: "bg-[#c7edcc]", ring: "ring-[#7fb987]" }
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
          <h2 className="text-3xl font-lexend font-bold tracking-tight text-kindle-text">Settings</h2>
          <p className="hidden md:block text-[10px] text-kindle-text-muted uppercase tracking-wider font-semibold font-mono mt-0.5">Preferences &amp; Cloud Sync</p>
        </div>
      </header>

      <div className="space-y-6">
        {/* Bento Widget Grid (Add Books & Cloud Sync Ingestion) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* Tile 1: Local Ingestion (Drag & Drop) */}
          <div className="md:col-span-2 bg-kindle-card border border-kindle-border rounded-2xl p-5 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Upload className="w-4 h-4 text-kindle-accent" />
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-kindle-text">Local File Ingestion</h4>
              </div>
              <p className="text-[10px] text-kindle-text-muted leading-relaxed mb-2">
                Drag and drop your local ebook files to import them directly into your browser's private offline database.
              </p>
            </div>
            
            <div 
              id="drag-and-drop-box"
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 h-32 ${
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
                  <div className="p-1.5 bg-kindle-card border border-kindle-border rounded-lg text-kindle-text-muted">
                    <Upload className="w-4 h-4 text-kindle-text" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[9px] font-bold uppercase tracking-wider">Drag & Drop or Click to Add File</p>
                    <p className="text-[8px] text-kindle-text-muted font-mono uppercase tracking-widest">EPUB, PDF, HTML, JSON, TXT</p>
                  </div>
                </>
              )}
            </div>

            {uploadError && (
              <p className="text-[8px] text-red-500 font-bold uppercase tracking-wider text-center bg-red-500/5 py-1 rounded-lg border border-red-500/10">
                {uploadError}
              </p>
            )}
          </div>

          {/* Tile 2: Cloud Ingestion (Drive & Dropbox) */}
          <div className="md:col-span-1 bg-kindle-card border border-kindle-border rounded-2xl p-5 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Cloud className="w-4 h-4 text-blue-500" />
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-kindle-text">Cloud Sync Ingestion</h4>
              </div>
              <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                Connect external cloud accounts to pull and sideload ebooks directly.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button 
                onClick={() => setShowCloudImport(true)}
                className="p-2.5 bg-kindle-bg border border-kindle-border rounded-xl flex items-center gap-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-800/40 transition shadow-xs group cursor-pointer w-full text-left"
              >
                <div className="p-1.5 bg-blue-500/10 text-blue-500 rounded-lg group-hover:scale-105 transition shrink-0">
                  <Cloud className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text truncate">Google Drive</p>
                  <p className="text-[7px] text-kindle-text-muted font-mono uppercase">Direct Import</p>
                </div>
              </button>
              
              <button 
                onClick={() => setShowCloudImport(true)}
                className="p-2.5 bg-kindle-bg border border-kindle-border rounded-xl flex items-center gap-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-800/40 transition shadow-xs group cursor-pointer w-full text-left"
              >
                <div className="p-1.5 bg-indigo-500/10 text-indigo-500 rounded-lg group-hover:scale-105 transition shrink-0">
                  <HardDrive className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text truncate">Dropbox</p>
                  <p className="text-[7px] text-kindle-text-muted font-mono uppercase">Cloud Sideload</p>
                </div>
              </button>
            </div>
          </div>

        </div>

        {/* Appearance */}
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
                <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Display Theme</h4>
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
                <div className="flex gap-2">
                  {fontOptions.map(f => (
                    <button key={f.id} onClick={() => setRP({ fontFamily: f.id })}
                      className={`flex-1 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition ${readerPrefs.fontFamily === f.id ? 'bg-kindle-text text-kindle-bg border-kindle-text' : 'border-kindle-border text-kindle-text-muted hover:bg-kindle-bg'}`}>
                      <span className={f.id}>{f.label}</span>
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

              <Row title="Continuous Scroll" desc="Scroll chapters as one long page">
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
            </div>
          )}
        </section>

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



        {/* Cloud Import Connectivity Modal */}
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
            <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Diagnostic System Logs</h4>
            <div className="flex gap-2">
              <button
                onClick={() => logger.downloadLogsAsFile()}
                className="flex-1 flex items-center justify-center gap-2 py-2 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-bg transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-kindle-accent" /> Export Log
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
              Contains details on download links, proxy attempts, worker syncs, and system errors.
            </p>
          </div>
        </section>


        {/* System Walkthrough & Legal Guide */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
            <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
              <Sparkles className="w-4 h-4 text-amber-500" />
            </div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">System Walkthrough & Legal Guide</h3>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] text-kindle-text-muted leading-relaxed">
              Review the complete on-screen walkthrough, interactive features, disclaimers, and legal copyright guidelines regarding local book caching.
            </p>
            {onOpenOnboarding && (
              <button
                type="button"
                onClick={onOpenOnboarding}
                className="w-full sm:w-auto py-2.5 px-4 bg-kindle-accent text-kindle-bg hover:opacity-90 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs border border-transparent hover:border-kindle-text-muted/30"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Restart Setup Walkthrough & Legal Pact
              </button>
            )}
          </div>
        </section>


        {/* Folder Auto-Ingestion (Directory Access) */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
            <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
              <BookMarked className="w-4 h-4 text-emerald-500" />
            </div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Folder Auto-Ingestion</h3>
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
                href="https://github.com/2003Ray-Dark" 
                target="_blank" 
                rel="noreferrer" 
                className="font-bold flex items-center gap-1 hover:text-kindle-accent transition-colors"
              >
                @2003Ray-Dark
              </a>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-kindle-text-muted">Source Code</span>
              <a 
                href="https://github.com/2003Ray-Dark/Kora" 
                target="_blank" 
                rel="noreferrer" 
                className="font-bold flex items-center gap-1 hover:text-kindle-accent transition-colors"
              >
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
      </div>
    </div>
  );
}
