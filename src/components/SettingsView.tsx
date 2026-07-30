import React, { useState, useEffect } from "react";
import { User } from "firebase/auth";
import {
  Moon, Sun, Monitor,
  User as UserIcon, ShieldCheck, BookOpen,
  Clock, LogIn, Type, AlignLeft, AlignCenter, Baseline,
  Database, Trash2, Search as SearchIcon, Globe, Layout,
  Info, Download, HardDrive, Bell, Volume2, Plus, BookMarked, HelpCircle, ChevronDown, Github, Headphones,
  FileText, Files, Scissors, Wrench, FolderOpen, Newspaper, RefreshCw, Grid3X3, Search, PieChart, Radio, Hammer, X,
  Flame, Calendar, Trophy, Sparkles, Award, TrendingUp, Swords
} from "lucide-react";
import { toast } from "react-hot-toast";
import { getTimeOfDayAutoTheme, DAYLIGHT_THEME_SCHEDULE } from "../lib/readerThemes";
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
import {
  BUILT_IN_TXT_PARSERS,
  getCustomTxtParsers,
  saveCustomTxtParser,
  deleteCustomTxtParser,
  getActiveTxtParser,
  setActiveTxtParserId,
  TxtParserRule
} from "../lib/txtParserHelper";
import { Cloud, CheckCircle, Upload } from "lucide-react";
import { logger } from "../lib/logger";
import BuiltInAudiobookConverter from "./BuiltInAudiobookConverter";
import WebClipperPanel from "./WebClipperPanel";
import DevicesSyncPanel from "./DevicesSyncPanel";
import P2pTransferPanel from "./P2pTransferPanel";
import CrosswordGame from "./CrosswordGame";
import WordSearchGame from "./WordSearchGame";
import GameScoreTracker from "./GameScoreTracker";
import LinguistGuardian from "./LinguistGuardian";
import OnlineScrabbleGame from "./OnlineScrabbleGame";
import ReadingInsightsTool from "./ReadingInsightsTool";
import FluidOverlay from "./FluidOverlay";
import WikipediaWidget from "./WikipediaWidget";
import { isNativeAndroid } from "../lib/capacitorNative";
import { gameViewVariant } from "../lib/canHover";
import {
  ApkReleaseInfo,
  checkForApkUpdate,
  downloadAndInstallApk,
  getInstalledApkLabel,
  getLastApkCheckAt,
  isApkAutoUpdateEnabled,
  setApkAutoUpdateEnabled,
} from "../lib/apkUpdater";
import { requestPinAndroidWidget } from "../lib/androidWidgets";
import {
  loadReadingStats,
  calculateStreak,
  minutesThisWeek,
  pagesToday,
  streakCalendarDays,
  recordReadingMinute,
  todayKey,
  legacyTodayKey
} from "../lib/readingStats";

interface ReaderPrefs {
  fontSize: number;
  lineSpacing: number;
  fontFamily: string;
  theme: string;
  marginSize: string;
  isContinuous: boolean;
  brightness: number;
  autoAdjustTheme?: boolean;
  themeManuallySet?: boolean;
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

  autoDisplayTheme: boolean;
  onChangeAutoDisplayTheme: (enabled: boolean) => void;

  appSkin?: string;
  onChangeAppSkin?: (skin: any) => void;
  loungeEnabled?: boolean;
  onChangeLoungeEnabled?: (enabled: boolean) => void;
  dailyRemindersEnabled?: boolean;
  onChangeDailyReminders?: (enabled: boolean) => void;
  dailyNewsBriefEnabled?: boolean;
  onChangeDailyNewsBrief?: (enabled: boolean) => void;
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
  /** When false (hidden keep-alive tab), skip heavy IDB/dir init until first activation. */
  isActive?: boolean;
  onModalToggle?: (isOpen: boolean) => void;
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
  autoDisplayTheme,
  onChangeAutoDisplayTheme,
  appSkin,
  onChangeAppSkin,
  loungeEnabled,
  onChangeLoungeEnabled,
  dailyRemindersEnabled = false,
  onChangeDailyReminders,
  dailyNewsBriefEnabled = false,
  onChangeDailyNewsBrief,
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
  onOpenOnboarding,
  isActive = true,
  onModalToggle,
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
    if (key === "folder") {
      setShowFolderWatch(true);
      return;
    }
    if (key === "tts") {
      setShowReadAloud(true);
      return;
    }
    setExpandedCategories(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const [dictEntries, setDictEntries] = useState<DictionaryEntry[]>([]);
  const [allEntries, setAllEntries] = useState<DictionaryEntry[]>([]);
  const [showLiveLogs, setShowLiveLogs] = useState(false);
  const [liveLogs, setLiveLogs] = useState(() => logger.getLogs());
  const [apkAutoUpdate, setApkAutoUpdate] = useState(() => isApkAutoUpdateEnabled());
  const [apkLabel, setApkLabel] = useState("Kora");
  const [apkChecking, setApkChecking] = useState(false);
  const [apkInstalling, setApkInstalling] = useState(false);
  const [apkProgress, setApkProgress] = useState(0);
  const [apkAvailable, setApkAvailable] = useState<ApkReleaseInfo | null>(null);
  const [apkLastCheck, setApkLastCheck] = useState(() => getLastApkCheckAt());
  const isAndroidApk = isNativeAndroid();

  useEffect(() => {
    if (!isAndroidApk) return;
    void getInstalledApkLabel().then(setApkLabel);
  }, [isAndroidApk]);

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
  const [showCrossword, setShowCrossword] = useState<boolean>(false);
  const [showWordSearch, setShowWordSearch] = useState<boolean>(false);
  const [showScoreTracker, setShowScoreTracker] = useState<boolean>(false);
  const [showGuardian, setShowGuardian] = useState<boolean>(false);
  const [showScrabble, setShowScrabble] = useState<boolean>(false);
  const [showInsights, setShowInsights] = useState<boolean>(false);
  const [showP2p, setShowP2p] = useState<boolean>(false);
  const [showDictionary, setShowDictionary] = useState<boolean>(false);
  const [showClipper, setShowClipper] = useState<boolean>(false);
  const [showFolderWatch, setShowFolderWatch] = useState<boolean>(false);
  const [showReadAloud, setShowReadAloud] = useState<boolean>(false);
  const [showWikipedia, setShowWikipedia] = useState<boolean>(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const isAnyOpen = Boolean(
      showCrossword ||
      showWordSearch ||
      showScoreTracker ||
      showGuardian ||
      showScrabble ||
      showInsights ||
      showP2p ||
      showDictionary ||
      showClipper ||
      showFolderWatch ||
      showReadAloud ||
      showWikipedia
    );
    onModalToggle?.(isAnyOpen);
  }, [
    showCrossword,
    showWordSearch,
    showScoreTracker,
    showGuardian,
    showScrabble,
    showInsights,
    showP2p,
    showDictionary,
    showClipper,
    showFolderWatch,
    showReadAloud,
    showWikipedia,
    onModalToggle,
  ]);

  const [readingStreak, setReadingStreak] = useState<number>(0);
  const [weeklyMinutes, setWeeklyMinutes] = useState<number>(0);
  const [todayMinutes, setTodayMinutes] = useState<number>(0);
  const [dailyGoal, setDailyGoal] = useState<number>(() => {
    try {
      const g = localStorage.getItem("kora_daily_reading_goal");
      return g ? parseInt(g, 10) : 15;
    } catch {
      return 15;
    }
  });

  const refreshReadingStats = () => {
    const stats = loadReadingStats();
    setReadingStreak(calculateStreak(stats));
    setWeeklyMinutes(minutesThisWeek(stats));
    const today = stats[todayKey()]?.minutes || stats[legacyTodayKey()]?.minutes || 0;
    setTodayMinutes(today);
  };

  useEffect(() => {
    refreshReadingStats();
  }, [view]);

  const handleUpdateDailyGoal = (newGoal: number) => {
    const val = Math.max(1, Math.min(240, newGoal));
    setDailyGoal(val);
    try {
      localStorage.setItem("kora_daily_reading_goal", String(val));
    } catch (e) {
      // ignore
    }
    toast.success(`Daily reading goal updated to ${val} minutes`);
  };

  const handleQuickLogMinutes = (mins: number) => {
    for (let i = 0; i < mins; i++) {
      recordReadingMinute();
    }
    refreshReadingStats();
    toast.success(`Logged ${mins} minutes to your reading history!`);
  };

  useEffect(() => {
    const onOpenTool = (e: Event) => {
      const tool = (e as CustomEvent<{ tool?: string }>).detail?.tool;
      if (tool === "crossword") setShowCrossword(true);
      else if (tool === "wordsearch") setShowWordSearch(true);
      else if (tool === "score-tracker" || tool === "scoretracker") setShowScoreTracker(true);
      else if (tool === "guardian" || tool === "linguist-guardian") setShowGuardian(true);
      else if (tool === "scrabble") setShowScrabble(true);
      else if (tool === "p2p") setShowP2p(true);
      else if (tool === "wikipedia" || tool === "wiki") setShowWikipedia(true);
    };
    window.addEventListener("kora-open-tool", onOpenTool as EventListener);
    return () => window.removeEventListener("kora-open-tool", onOpenTool as EventListener);
  }, []);

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

  // Performance toggle: trims non-essential animations + heavy rendering when on
  // (older/slow devices, low battery). Persisted to localStorage.
  const [performanceMode, setPerformanceMode] = useState<boolean>(
    () => localStorage.getItem("kora_performance_mode") === "true"
  );

  // TXT Chapter Parser Settings State
  const [activeTxtParserId, setActiveTxtParserIdState] = useState<string>(() => getActiveTxtParser().id);
  const [customParsers, setCustomParsers] = useState<TxtParserRule[]>(() => getCustomTxtParsers());
  const [showAddTxtParser, setShowAddTxtParser] = useState(false);
  const [newParserName, setNewParserName] = useState("");
  const [newParserPattern, setNewParserPattern] = useState("");
  const [newParserDesc, setNewParserDesc] = useState("");

  const handleSelectTxtParser = (id: string) => {
    setActiveTxtParserId(id);
    setActiveTxtParserIdState(id);
    toast.success("TXT chapter detection rule updated!");
  };

  const handleSaveCustomParser = () => {
    if (!newParserName.trim() || !newParserPattern.trim()) {
      toast.error("Please fill in both the rule name and regex pattern.");
      return;
    }
    try {
      new RegExp(newParserPattern, "i");
    } catch (e) {
      toast.error("Invalid regular expression pattern.");
      return;
    }

    const rule: TxtParserRule = {
      id: "custom_" + Date.now(),
      name: newParserName.trim(),
      pattern: newParserPattern.trim(),
      description: newParserDesc.trim() || "Custom user regex pattern"
    };

    saveCustomTxtParser(rule);
    setCustomParsers(getCustomTxtParsers());
    setActiveTxtParserId(rule.id);
    setActiveTxtParserIdState(rule.id);
    setShowAddTxtParser(false);
    setNewParserName("");
    setNewParserPattern("");
    setNewParserDesc("");
    toast.success(`Custom rule "${rule.name}" activated!`);
  };

  const handleDeleteCustomParser = (id: string) => {
    deleteCustomTxtParser(id);
    setCustomParsers(getCustomTxtParsers());
    const currentActive = getActiveTxtParser().id;
    setActiveTxtParserIdState(currentActive);
    toast.success("Custom parser rule removed.");
  };
  useEffect(() => {
    try {
      localStorage.setItem("kora_performance_mode", performanceMode ? "true" : "false");
      document.documentElement.classList.toggle("perf-mode", performanceMode);
    } catch {}
  }, [performanceMode]);
  const [virtualPath, setVirtualPath] = useState<string>(getVirtualDirectoryPath());
  const [virtualFiles, setVirtualFiles] = useState<VirtualBookFile[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanResultText, setScanResultText] = useState<string | null>(null);

  // Virtual file creation inputs
  const [newVirtualFileName, setNewVirtualFileName] = useState<string>("");
  const [newVirtualAuthor, setNewVirtualAuthor] = useState<string>("");
  const [newVirtualExt, setNewVirtualExt] = useState<"epub" | "pdf">("epub");

  useEffect(() => {
    if (!isActive && !showDictionary) return;
    async function loadDict() {
      const entries = await getAllDictionaryEntries();
      setAllEntries(entries);
      // Only show custom entries in settings, not the external dictionary
      setDictEntries(entries.filter(e => e.isCustom));
    }
    void loadDict();
    
    async function initDir() {
      if (isActive) {
        const handle = await getSavedDirectoryHandle();
        setRealDirHandle(handle);
        setVirtualFiles(getVirtualDirectoryFiles());
      }
    }
    void initDir();
  }, [isActive, showDictionary]);

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
    // Keep the native plugin + first-run flag in sync.
    localStorage.setItem("kora_storage_mode_chosen", "true");
    import("../lib/koraStorage").then(({ setKoraStorageMode }) =>
      setKoraStorageMode(newValue ? "virtual" : "saf").catch(() => {})
    );
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
    setAllEntries(entries);
    setDictEntries(entries.filter(e => e.isCustom));
    setNewWord("");
    setNewDef("");
    setNewPos("noun");
    setNewEx("");
    setShowAddWordForm(false);
  };

  const handleSaveWordToPersonal = async (entry: DictionaryEntry) => {
    addDictionaryEntry({
      ...entry,
      isCustom: true
    });
    const entries = await getAllDictionaryEntries();
    setAllEntries(entries);
    setDictEntries(entries.filter(e => e.isCustom));
    toast.success(`"${entry.word}" saved to personal dictionary`);
  };

  const handleDeleteWord = async (word: string) => {
    deleteDictionaryEntry(word);
    const entries = await getAllDictionaryEntries();
    setAllEntries(entries);
    setDictEntries(entries.filter(e => e.isCustom));
  };

  const fontOptions = [
    { id: "font-serif", label: "Serif" },
    { id: "font-sans", label: "Sans" },
    { id: "font-lexend", label: "Rakuten Sans" },
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
  const renderPersonalDictionaryContent = () => (
    <div className="space-y-5">
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
          type="button"
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
                className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none focus:border-kindle-accent"
              />
            </div>
            <div>
              <label className="block text-[9px] uppercase tracking-wider font-bold text-kindle-text-muted mb-1">Part of Speech</label>
              <select
                value={newPos}
                onChange={(e) => setNewPos(e.target.value)}
                className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none focus:border-kindle-accent"
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
              className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none focus:border-kindle-accent resize-none"
            />
          </div>

          <div>
            <label className="block text-[9px] uppercase tracking-wider font-bold text-kindle-text-muted mb-1">Example Usage (Optional)</label>
            <input
              type="text"
              value={newEx}
              onChange={(e) => setNewEx(e.target.value)}
              placeholder="Sentence using the word..."
              className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none focus:border-kindle-accent"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2 bg-kindle-text text-kindle-bg hover:bg-kindle-accent rounded-lg text-[10px] font-bold uppercase tracking-widest transition cursor-pointer"
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
          {(() => {
            const query = dictSearch.trim().toLowerCase();
            let displayedEntries: DictionaryEntry[] = [];
            
            if (query === "") {
              displayedEntries = dictEntries;
            } else {
              // Search the entire dictionary
              const exactMatches: DictionaryEntry[] = [];
              const startsWithMatches: DictionaryEntry[] = [];
              const containsMatches: DictionaryEntry[] = [];
              
              const pool = allEntries.length > 0 ? allEntries : dictEntries;
              
              for (const entry of pool) {
                const entryWord = entry.word.toLowerCase();
                if (entryWord === query) {
                  exactMatches.push(entry);
                } else if (entryWord.startsWith(query)) {
                  startsWithMatches.push(entry);
                } else if (entryWord.includes(query)) {
                  containsMatches.push(entry);
                }
              }
              
              displayedEntries = [...exactMatches, ...startsWithMatches, ...containsMatches].slice(0, 50);
            }

            if (displayedEntries.length === 0) {
              return (
                <div className="p-8 text-center text-xs text-kindle-text-muted italic flex flex-col items-center gap-2">
                  <span>No words matching "{dictSearch}" in dictionary database.</span>
                  {dictSearch.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setNewWord(dictSearch);
                        setNewDef("");
                        setNewEx("");
                        setNewPos("noun");
                        setShowAddWordForm(true);
                      }}
                      className="mt-1 px-3 py-1.5 bg-kindle-accent/10 hover:bg-kindle-accent/20 text-kindle-accent border border-kindle-accent/25 rounded-xl text-[10px] font-bold uppercase tracking-widest transition cursor-pointer"
                    >
                      Define "{dictSearch}" Custom
                    </button>
                  )}
                </div>
              );
            }

            return displayedEntries.map((entry) => (
              <div key={entry.word} className="p-3.5 flex items-start justify-between gap-3 bg-kindle-card">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold font-serif text-sm text-kindle-text">{entry.word}</span>
                    {entry.partOfSpeech && (
                      <span className="text-[8px] uppercase tracking-wider font-mono font-bold text-kindle-text-muted/70 bg-neutral-150 px-1 py-0.5 rounded">
                        {entry.partOfSpeech}
                      </span>
                    )}
                    {entry.isCustom ? (
                      <span className="text-[7px] uppercase tracking-widest font-bold bg-kindle-accent/15 text-kindle-accent px-1.5 py-0.5 rounded-full">
                        Personal
                      </span>
                    ) : (
                      <span className="text-[7px] uppercase tracking-widest font-bold bg-neutral-100 text-neutral-500 px-1.5 py-0.5 rounded-full">
                        Oxford DB
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-kindle-text leading-relaxed font-sans">{entry.definition}</p>
                  {entry.example && (
                    <p className="text-[10px] italic text-kindle-text-muted font-sans font-medium">"{entry.example}"</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {entry.isCustom ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteWord(entry.word)}
                      className="p-1.5 text-kindle-text-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                      title="Delete Definition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleSaveWordToPersonal(entry)}
                      className="px-2 py-1 bg-kindle-bg hover:bg-kindle-accent/10 border border-kindle-border rounded-lg text-[9px] font-bold uppercase tracking-wider text-kindle-text hover:text-kindle-accent transition cursor-pointer flex items-center gap-1"
                      title="Add to Personal Dictionary"
                    >
                      <Plus className="w-3 h-3 text-kindle-accent" /> Save
                    </button>
                  )}
                </div>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );

  const renderFolderWatchContent = () => (
    <div className="space-y-5">
      <p className="text-[11px] text-kindle-text-muted leading-relaxed">
        Map a localized system folder using native web-standard file APIs to automatically discover, index, and cache digital publications on your device.
      </p>

      {/* Storage Mode: Device Folder (SAF) vs App Storage (virtual) */}
      <div className="border border-kindle-border rounded-2xl p-4 space-y-3 bg-kindle-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h5 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text">Storage Mode</h5>
            <p className="text-[9px] text-kindle-text-muted">Device Folder saves to a real folder; App Storage is fully managed by Kora.</p>
          </div>
          <Toggle
            on={!useVirtualDir}
            onClick={() => handleToggleVirtualDir()}
          />
        </div>
        {!useVirtualDir && (
          <button
            type="button"
            onClick={async () => {
              try {
                const { pickKoraFolder } = await import("../lib/koraStorage");
                await pickKoraFolder();
              } catch { /* ignore */ }
            }}
            className="w-full flex items-center justify-center gap-2 py-2 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-bg transition cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-kindle-accent" /> Choose Device Folder
          </button>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h5 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">System Folder Integration</h5>
            <p className="text-[9px] text-kindle-text-muted">Use native File System Access APIs</p>
          </div>
          {realDirHandle ? (
            <button
              type="button"
              onClick={handleDisconnectRealDir}
              className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/45 dark:text-red-400 rounded-lg text-[9px] font-bold uppercase tracking-widest transition cursor-pointer"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
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
                            type="button"
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
                      type="button"
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
          type="button"
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
    </div>
  );

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
            {view === "tools" ? "Workshop" : "Settings"}
          </h2>
          <p className="hidden md:block text-[10px] text-kindle-text-muted uppercase tracking-wider font-semibold font-mono mt-0.5">
            {view === "tools"
              ? "Digital publication ingestions, utilities, and literacy widgets"
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

              <Row title="Performance Mode" desc="Reduce animations and heavy effects for older or low-battery devices">
                <Toggle on={performanceMode} onClick={() => setPerformanceMode(!performanceMode)} />
              </Row>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Display Theme</h4>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Auto Schedule</span>
                    <Toggle on={autoDisplayTheme} onClick={() => onChangeAutoDisplayTheme(!autoDisplayTheme)} />
                  </div>
                </div>
                
                <div className={`grid grid-cols-3 gap-2 ${autoDisplayTheme ? 'opacity-50 pointer-events-none' : ''}`}>
                  {[
                    { id: 'theme-paper', name: 'Paper', bg: '#FAF7F2', text: '#2C2A26', border: '#E4DDD2' },
                    { id: 'theme-sepia', name: 'Sepia', bg: '#F4ECD8', text: '#5B4636', border: '#DBCDA4' },
                    { id: 'theme-green', name: 'Mint', bg: '#E3EDD3', text: '#2D3E1E', border: '#C5D6A8' },
                    { id: 'theme-night', name: 'Dusk', bg: '#1C1F26', text: '#D6D8DE', border: '#3A4050' },
                    { id: 'theme-oled', name: 'OLED', bg: '#000000', text: '#E8E8E8', border: '#262626' },
                    { id: 'theme-light', name: 'Light', bg: '#FFFFFF', text: '#111111', border: '#E4E4E7' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onChangeTheme(t.id)}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition cursor-pointer"
                      style={{
                        backgroundColor: t.bg,
                        borderColor: displayTheme === t.id ? t.text : t.border,
                        boxShadow: displayTheme === t.id ? `0 0 0 1px ${t.text}40` : 'none',
                        opacity: displayTheme === t.id ? 1 : 0.65
                      }}
                    >
                      <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: t.text }}>{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
        </>
        )}

        {view === "tools" && (
        <div className="space-y-8 animate-in fade-in duration-300">
          
          {/* Section 1: Mind & Word Games */}
          <section className="space-y-3">
            <div className="flex flex-col gap-0.5 border-b border-kindle-border pb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-kindle-text flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-kindle-accent animate-pulse" />
                Mind & Word Games
              </h3>
              <p className="text-[10px] text-kindle-text-muted">
                Strengthen vocabulary, focus, and cognitive recall with interactive puzzles.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Board & Card Game Score Tracker Card */}
              <button
                type="button"
                onClick={() => setShowScoreTracker(true)}
                className="bg-kindle-card border border-kindle-border hover:border-kindle-accent/50 rounded-2xl p-6 text-left transition duration-300 flex flex-col gap-4 items-start group cursor-pointer shadow-xs hover:shadow-md relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-kindle-accent/5 rounded-bl-full pointer-events-none group-hover:bg-kindle-accent/10 transition" />
                <div className="p-3.5 bg-kindle-bg border border-kindle-border text-kindle-accent rounded-xl shrink-0 group-hover:scale-105 transition-transform duration-300">
                  <Trophy className="w-6 h-6" />
                </div>
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold tracking-tight text-kindle-text group-hover:text-kindle-accent transition">Game Score Tracker</h4>
                  </div>
                  <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                    Track scores for Catan, Ticket to Ride, Uno, Scrabble & Card games with turn clocks and brackets.
                  </p>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-kindle-accent flex items-center gap-1 mt-1 opacity-80 group-hover:opacity-100 group-hover:translate-x-1 transition">
                    Launch Arena →
                  </div>
                </div>
              </button>

              {/* Crossword Card */}
              <button
                type="button"
                onClick={() => setShowCrossword(true)}
                className="bg-kindle-card border border-kindle-border hover:border-kindle-accent/40 rounded-2xl p-6 text-left transition duration-300 flex flex-col gap-4 items-start group cursor-pointer shadow-xs hover:shadow-md"
              >
                <div className="p-3.5 bg-kindle-bg border border-kindle-border text-kindle-accent rounded-xl shrink-0 group-hover:scale-105 transition-transform duration-300">
                  <Grid3X3 className="w-6 h-6" />
                </div>
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold tracking-tight text-kindle-text group-hover:text-kindle-accent transition">Crossword Grid</h4>
                  </div>
                  <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                    Solve thematic word grids created dynamically from your book vocabulary bank.
                  </p>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-kindle-accent flex items-center gap-1 mt-1 opacity-80 group-hover:opacity-100 group-hover:translate-x-1 transition">
                    Play Crossword →
                  </div>
                </div>
              </button>

              {/* Word Search Card */}
              <button
                type="button"
                onClick={() => setShowWordSearch(true)}
                className="bg-kindle-card border border-kindle-border hover:border-kindle-accent/40 rounded-2xl p-6 text-left transition duration-300 flex flex-col gap-4 items-start group cursor-pointer shadow-xs hover:shadow-md"
              >
                <div className="p-3.5 bg-kindle-bg border border-kindle-border text-kindle-accent rounded-xl shrink-0 group-hover:scale-105 transition-transform duration-300">
                  <Search className="w-6 h-6" />
                </div>
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold tracking-tight text-kindle-text group-hover:text-kindle-accent transition">Word Search</h4>
                  </div>
                  <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                    Scan letter matrices to find hidden terms and boost rapid recognition patterns.
                  </p>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-kindle-accent flex items-center gap-1 mt-1 opacity-80 group-hover:opacity-100 group-hover:translate-x-1 transition">
                    Search Words →
                  </div>
                </div>
              </button>

              {/* Linguist Guardian Card */}
              <button
                type="button"
                onClick={() => setShowGuardian(true)}
                className="bg-kindle-card border border-kindle-border hover:border-[#d4a574]/50 rounded-2xl p-6 text-left transition duration-300 flex flex-col gap-4 items-start group cursor-pointer shadow-xs hover:shadow-md"
              >
                <div className="p-3.5 bg-kindle-bg border border-kindle-border text-[#d4a574] rounded-xl shrink-0 group-hover:scale-105 transition-transform duration-300">
                  <Swords className="w-6 h-6" />
                </div>
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold tracking-tight text-kindle-text group-hover:text-[#d4a574] transition">Linguist Guardian</h4>
                  </div>
                  <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                    Defend the Kora Archives — turn your highlighted words into spells against the Boss of Forgetting.
                  </p>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-[#d4a574] flex items-center gap-1 mt-1 opacity-80 group-hover:opacity-100 group-hover:translate-x-1 transition">
                    Enter Battle →
                  </div>
                </div>
              </button>

              {/* Online Scrabble Card */}
              <button
                type="button"
                onClick={() => setShowScrabble(true)}
                className="bg-kindle-card border border-kindle-border hover:border-amber-500/50 rounded-2xl p-6 text-left transition duration-300 flex flex-col gap-4 items-start group cursor-pointer shadow-xs hover:shadow-md"
              >
                <div className="p-3.5 bg-kindle-bg border border-kindle-border text-amber-500 rounded-xl shrink-0 group-hover:scale-105 transition-transform duration-300">
                  <Award className="w-6 h-6" />
                </div>
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold tracking-tight text-kindle-text group-hover:text-amber-500 transition">Online Scrabble</h4>
                  </div>
                  <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                    Classic tile placement battle. Place words on multipliers, duel Kora or match online with friends.
                  </p>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-amber-500 flex items-center gap-1 mt-1 opacity-80 group-hover:opacity-100 group-hover:translate-x-1 transition">
                    Play Scrabble →
                  </div>
                </div>
              </button>
            </div>
          </section>

          {/* Section 2: Reader Companions & Insights */}
          <section className="space-y-3">
            <div className="flex flex-col gap-0.5 border-b border-kindle-border pb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-kindle-text flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-kindle-accent/70" />
                Reader Companions & Insights
              </h3>
              <p className="text-[10px] text-kindle-text-muted">
                Analyze reading trends, maintain lookup logs, or listen on the go.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Wikipedia Research Hub Card */}
              <button
                type="button"
                onClick={() => setShowWikipedia(true)}
                className="bg-kindle-card border border-kindle-border hover:border-amber-500/50 rounded-2xl p-4 text-left transition duration-300 flex flex-col gap-3 group cursor-pointer shadow-xs relative overflow-hidden"
              >
                <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-xl w-fit group-hover:scale-105 transition-transform duration-300">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text group-hover:text-amber-600 transition">Wikipedia Hub</h4>
                  <p className="text-[10px] text-kindle-text-muted mt-1.5 leading-relaxed">
                    Search millions of articles, save bookmarks, or convert topics into Kora Ebooks.
                  </p>
                </div>
              </button>

              {/* Reading Insights Card */}
              <button
                type="button"
                onClick={() => setShowInsights(true)}
                className="bg-kindle-card border border-kindle-border hover:border-kindle-accent/35 rounded-2xl p-4 text-left transition duration-300 flex flex-col gap-3 group cursor-pointer shadow-xs"
              >
                <div className="p-2 bg-kindle-bg border border-kindle-border text-kindle-text rounded-xl w-fit group-hover:scale-105 transition-transform duration-300">
                  <PieChart className="w-4 h-4 text-kindle-accent" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text group-hover:text-kindle-accent transition">Reading Insights</h4>
                  <p className="text-[9px] text-kindle-text-muted mt-1 uppercase tracking-widest font-bold">Pacing & Moods</p>
                  <p className="text-[10px] text-kindle-text-muted mt-1.5 leading-relaxed">
                    Track your words-per-minute, session intervals, and reader emotion trends.
                  </p>
                </div>
              </button>

              {/* Personal Dictionary Card */}
              <button
                type="button"
                onClick={() => setShowDictionary(true)}
                className="bg-kindle-card border border-kindle-border hover:border-kindle-accent/35 rounded-2xl p-4 text-left transition duration-300 flex flex-col gap-3 group cursor-pointer shadow-xs"
              >
                <div className="p-2 bg-kindle-bg border border-kindle-border text-kindle-text rounded-xl w-fit group-hover:scale-105 transition-transform duration-300">
                  <BookMarked className="w-4 h-4 text-kindle-accent" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text group-hover:text-kindle-accent transition">Personal Dictionary</h4>
                  <p className="text-[9px] text-kindle-text-muted mt-1 uppercase tracking-widest font-bold">Vocabulary Bank</p>
                  <p className="text-[10px] text-kindle-text-muted mt-1.5 leading-relaxed">
                    Browse custom definitions and lookups saved during reading sessions.
                  </p>
                </div>
              </button>

              {/* Web Clipper Card */}
              <button
                type="button"
                onClick={() => setShowClipper(true)}
                className="bg-kindle-card border border-kindle-border hover:border-kindle-accent/35 rounded-2xl p-4 text-left transition duration-300 flex flex-col gap-3 group cursor-pointer shadow-xs"
              >
                <div className="p-2 bg-kindle-bg border border-kindle-border text-kindle-text rounded-xl w-fit group-hover:scale-105 transition-transform duration-300">
                  <Scissors className="w-4 h-4 text-kindle-accent" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text group-hover:text-kindle-accent transition">Web Clipper</h4>
                  <p className="text-[9px] text-kindle-text-muted mt-1 uppercase tracking-widest font-bold">Article Extraction</p>
                  <p className="text-[10px] text-kindle-text-muted mt-1.5 leading-relaxed">
                    Convert any online news article or essay into an offline-ready ebook.
                  </p>
                </div>
              </button>

              {/* Voice Reader Card */}
              <button
                type="button"
                onClick={() => setShowReadAloud(true)}
                className="bg-kindle-card border border-kindle-border hover:border-kindle-accent/35 rounded-2xl p-4 text-left transition duration-300 flex flex-col gap-3 group cursor-pointer shadow-xs"
              >
                <div className="p-2 bg-kindle-bg border border-kindle-border text-kindle-text rounded-xl w-fit group-hover:scale-105 transition-transform duration-300">
                  <Headphones className="w-4 h-4 text-kindle-accent" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text group-hover:text-kindle-accent transition">Voice Reader</h4>
                  <p className="text-[9px] text-kindle-text-muted mt-1 uppercase tracking-widest font-bold">TTS Audiobooks</p>
                  <p className="text-[10px] text-kindle-text-muted mt-1.5 leading-relaxed">
                    Generate read-aloud system audiobooks for your offline EPUB/TXT library.
                  </p>
                </div>
              </button>
            </div>
          </section>

          {/* Section 2.5: Personal Reading Streaks & Goals */}
          <section className="space-y-4">
            <div className="flex flex-col gap-0.5 border-b border-kindle-border pb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-kindle-text flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#e0533c]" />
                Reading Streaks & Habits
              </h3>
              <p className="text-[10px] text-kindle-text-muted">
                Maintain consistency, view historical tracking calendars, and log physical books.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Left Bento Panel: Current Streak & Daily Progress (5 cols) */}
              <div className="md:col-span-5 bg-kindle-card border border-kindle-border rounded-2xl p-5 flex flex-col justify-between space-y-4 shadow-xs">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">
                      Your Consistency
                    </span>
                    <h4 className="text-sm font-bold tracking-tight text-kindle-text flex items-center gap-1.5">
                      <Flame className="w-4 h-4 text-[#e0533c] fill-[#e0533c]/20" /> Active Streak
                    </h4>
                  </div>
                  <div className="px-2.5 py-1 bg-[#e0533c]/10 text-[#e0533c] border border-[#e0533c]/20 rounded-lg font-mono text-xs font-bold flex items-center gap-1">
                    <Flame className="w-3.5 h-3.5 fill-[#e0533c]" />
                    {readingStreak} Days
                  </div>
                </div>

                {/* Progress Circle & Metrics in Middle */}
                <div className="flex items-center gap-4 py-2">
                  <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                    {/* SVG Circular Progress Bar */}
                    <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        className="stroke-kindle-border"
                        strokeWidth="5"
                        fill="transparent"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        className="stroke-kindle-accent animate-pulse"
                        strokeWidth="5"
                        fill="transparent"
                        strokeDasharray={2 * Math.PI * 28}
                        strokeDashoffset={
                          2 * Math.PI * 28 * (1 - Math.min(1, todayMinutes / Math.max(1, dailyGoal)))
                        }
                        strokeLinecap="round"
                        style={{ transition: "stroke-dashoffset 0.5s ease" }}
                      />
                    </svg>
                    <div className="text-center">
                      <span className="text-xs font-bold font-mono text-kindle-text">
                        {Math.round((todayMinutes / Math.max(1, dailyGoal)) * 100)}%
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-bold text-kindle-text flex items-center gap-1">
                      <span>{todayMinutes}</span>
                      <span className="text-[10px] text-kindle-text-muted font-normal">/ {dailyGoal} mins today</span>
                    </div>
                    <div className="text-[10px] text-kindle-text-muted flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-emerald-500" />
                      <span>{weeklyMinutes} mins this week</span>
                    </div>
                  </div>
                </div>

                {/* Goals Form & Quick Actions at bottom */}
                <div className="space-y-3 pt-2 border-t border-kindle-border">
                  {/* Daily Goal Adjuster */}
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">
                      Target Goal
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleUpdateDailyGoal(dailyGoal - 5)}
                        className="w-5 h-5 bg-kindle-bg border border-kindle-border rounded flex items-center justify-center text-xs font-bold hover:bg-kindle-border transition cursor-pointer"
                        title="Decrease Goal"
                      >
                        -
                      </button>
                      <span className="text-xs font-bold font-mono px-1.5 min-w-[32px] text-center">
                        {dailyGoal}m
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdateDailyGoal(dailyGoal + 5)}
                        className="w-5 h-5 bg-kindle-bg border border-kindle-border rounded flex items-center justify-center text-xs font-bold hover:bg-kindle-border transition cursor-pointer"
                        title="Increase Goal"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Quick Book Logger */}
                  <div className="space-y-1.5">
                    <span className="text-[8px] font-bold uppercase tracking-widest text-kindle-text-muted block">
                      Read physical books / other devices? Log minutes:
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[5, 15, 30].map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => handleQuickLogMinutes(mins)}
                          className="py-1 bg-kindle-bg hover:bg-kindle-accent/10 border border-kindle-border hover:border-kindle-accent/30 rounded-xl text-[9px] font-bold text-kindle-text hover:text-kindle-accent transition cursor-pointer flex items-center justify-center gap-0.5"
                        >
                          +{mins} Min
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Bento Panel: 28-Day Streak Grid (7 cols) */}
              <div className="md:col-span-7 bg-kindle-card border border-kindle-border rounded-2xl p-5 flex flex-col justify-between space-y-4 shadow-xs">
                <div className="flex items-start justify-between pb-1 border-b border-kindle-border">
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">
                      Last 4 Weeks
                    </span>
                    <h4 className="text-sm font-bold tracking-tight text-kindle-text flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-kindle-accent" /> Streak Calendar
                    </h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] uppercase font-mono font-bold text-kindle-text-muted flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-kindle-border border border-kindle-border shrink-0" />
                      Missed
                    </span>
                    <span className="text-[8px] uppercase font-mono font-bold text-kindle-accent flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-kindle-accent shrink-0" />
                      Read
                    </span>
                  </div>
                </div>

                {/* 28-day grid rendering */}
                <div className="grid grid-cols-7 gap-2 py-3">
                  {streakCalendarDays(loadReadingStats(), 28).map((day, idx) => {
                    const parsedDate = new Date(day.key + "T12:00:00");
                    const isToday = day.key === todayKey();
                    const hasRead = day.minutes > 0;
                    const weekDayLabel = parsedDate.toLocaleDateString(undefined, { weekday: "short" });
                    const dayNumLabel = parsedDate.getDate();

                    return (
                      <div
                        key={day.key}
                        className="flex flex-col items-center gap-1 group relative"
                      >
                        {/* Interactive Tooltip on Hover */}
                        <div className="absolute bottom-full mb-1.5 scale-0 group-hover:scale-100 transition-all duration-200 bg-kindle-text text-kindle-bg text-[9px] font-bold rounded-lg px-2 py-1 shadow-md whitespace-nowrap z-50 pointer-events-none">
                          <div className="font-sans">{parsedDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                          <div className="font-mono text-kindle-accent">{day.minutes} mins {day.pages > 0 ? `· ${day.pages} pgs` : ""}</div>
                        </div>

                        {/* Weekly Header for top row */}
                        {idx < 7 && (
                          <span className="text-[8px] uppercase font-mono text-kindle-text-muted mb-0.5">
                            {weekDayLabel[0]}
                          </span>
                        )}

                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300 relative ${
                            hasRead
                              ? "bg-kindle-accent text-white dark:bg-amber-400 dark:text-neutral-900 font-extrabold shadow-sm scale-100 border border-kindle-accent dark:border-amber-400"
                              : "bg-kindle-bg text-kindle-text-muted border border-kindle-border hover:border-kindle-text-muted/30"
                          } ${isToday ? "ring-2 ring-kindle-text/40 ring-offset-2 ring-offset-kindle-card" : ""}`}
                        >
                          <span className="text-[10px] font-mono select-none">{dayNumLabel}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Milestone Support at bottom */}
                <div className="pt-2 border-t border-kindle-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-yellow-500 shrink-0">
                      <Trophy className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-kindle-text">
                        Habit Milestone
                      </p>
                      <p className="text-[9px] text-kindle-text-muted truncate">
                        {readingStreak >= 30
                          ? "Master Reader status unlocked! 🏆"
                          : readingStreak >= 7
                          ? "Solid Gold Habits! Keep going! ✨"
                          : readingStreak > 0
                          ? "Habit is building. Finish today's session!"
                          : "No active streak. Start reading to light the flame!"}
                      </p>
                    </div>
                  </div>

                  {readingStreak > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const message = `Check it out! I am on a ${readingStreak}-day reading streak on Kora Reader! 📚🔥`;
                        if (navigator.clipboard) {
                          navigator.clipboard.writeText(message)
                            .then(() => toast.success("Streak milestone copied to clipboard!"))
                            .catch(() => toast.error("Failed to copy streak"));
                        }
                      }}
                      className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1.5 bg-kindle-bg hover:bg-kindle-border border border-kindle-border rounded-lg text-kindle-text transition cursor-pointer text-center shrink-0"
                    >
                      Share Milestone →
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Imports & Wireless Sync */}
          <section className="space-y-4">
            <div className="flex flex-col gap-0.5 border-b border-kindle-border pb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-kindle-text flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-kindle-accent/50" />
                Imports & Library Sync
              </h3>
              <p className="text-[10px] text-kindle-text-muted">
                Bring in your publications manually, automatically, or wirelessly.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Left col: Drag and Drop box (takes up 2 cols on lg) */}
              <div className="lg:col-span-2 bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4 text-kindle-accent" />
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text">Import Publications</h4>
                </div>
                <div 
                  id="drag-and-drop-box"
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 ${
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
                    <div className="py-2 space-y-2 flex flex-col items-center justify-center">
                      <div className="w-5 h-5 border-2 border-kindle-accent border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-[9px] font-bold text-kindle-text-muted uppercase tracking-widest animate-pulse">Syncing to storage...</p>
                    </div>
                  ) : (
                    <>
                      <div className="p-2 bg-kindle-bg border border-kindle-border rounded-xl text-kindle-text-muted">
                        <Upload className="w-4 h-4 text-kindle-text" />
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-kindle-text">Drag & Drop or Tap to Add Files</p>
                        <p className="text-[8px] text-kindle-text-muted font-mono uppercase tracking-widest">EPUB · PDF · MOBI · AZW3 · HTML · TXT</p>
                      </div>
                    </>
                  )}
                </div>

                {uploadError && (
                  <p className="text-[9px] text-red-500 font-bold uppercase tracking-wider text-center bg-red-500/5 py-2 rounded-lg border border-red-500/10">
                    {uploadError}
                  </p>
                )}
              </div>

              {/* Right col: Other import tools (Folder Watch, Cloud Sync, P2P Beam) stacked vertically on lg */}
              <div className="flex flex-col gap-3 justify-between">
                {/* Folder Watch Card */}
                <button
                  type="button"
                  onClick={() => setShowFolderWatch(true)}
                  className="bg-kindle-card border border-kindle-border hover:border-kindle-accent/35 rounded-xl p-3 text-left transition duration-300 flex items-center gap-3 group cursor-pointer flex-1"
                >
                  <div className="p-2 bg-kindle-bg border border-kindle-border text-emerald-500 rounded-lg group-hover:scale-105 transition-transform">
                    <FolderOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text group-hover:text-kindle-accent transition">Folder Watch</h4>
                    <p className="text-[8px] text-kindle-text-muted mt-0.5 uppercase tracking-widest font-semibold">Local Auto-Ingest</p>
                  </div>
                </button>

                {/* Cloud Sync Card */}
                <button
                  type="button"
                  onClick={() => setShowCloudImport(true)}
                  className="bg-kindle-card border border-kindle-border hover:border-kindle-accent/35 rounded-xl p-3 text-left transition duration-300 flex items-center gap-3 group cursor-pointer flex-1"
                >
                  <div className="p-2 bg-kindle-bg border border-kindle-border text-blue-500 rounded-lg group-hover:scale-105 transition-transform">
                    <Cloud className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text group-hover:text-kindle-accent transition">Cloud Sync</h4>
                    <p className="text-[8px] text-kindle-text-muted mt-0.5 uppercase tracking-widest font-semibold">Drive & Dropbox</p>
                  </div>
                </button>

                {/* Secure P2P Card */}
                <button
                  type="button"
                  onClick={() => setShowP2p(true)}
                  className="bg-kindle-card border border-kindle-border hover:border-kindle-accent/35 rounded-xl p-3 text-left transition duration-300 flex items-center gap-3 group cursor-pointer flex-1"
                >
                  <div className="p-2 bg-kindle-bg border border-kindle-border text-orange-500 rounded-lg group-hover:scale-105 transition-transform">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text group-hover:text-kindle-accent transition">P2P File Beam</h4>
                    <p className="text-[8px] text-kindle-text-muted mt-0.5 uppercase tracking-widest font-semibold">Wireless Transfer</p>
                  </div>
                </button>
              </div>
            </div>
          </section>

        </div>
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

              <div className="space-y-3.5 pt-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Reader Theme</h4>
                  {readerPrefs.autoAdjustTheme && (
                    <span className="text-[9px] font-bold text-amber-600 flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                      <Sparkles className="w-2.5 h-2.5" /> Auto-Theme Active
                    </span>
                  )}
                </div>

                {/* Auto-adjust toggle card */}
                <div className="p-3.5 bg-kindle-bg/80 border border-kindle-border rounded-2xl space-y-3">
                  <Row 
                    title="Auto-Adjust Theme Throughout Day" 
                    desc="Automatically cycles through Paper, Light, Sepia, Night, and OLED presets as your local clock advances."
                  >
                    <Toggle 
                      on={!!readerPrefs.autoAdjustTheme} 
                      onClick={() => {
                        const nextAuto = !readerPrefs.autoAdjustTheme;
                        const nextTheme = nextAuto ? getTimeOfDayAutoTheme() : readerPrefs.theme;
                        setRP({ autoAdjustTheme: nextAuto, theme: nextTheme, themeManuallySet: !nextAuto });
                        if (nextAuto) {
                          toast.success(`Auto theme enabled: Current daylight preset is ${nextTheme.toUpperCase()}`);
                        }
                      }} 
                    />
                  </Row>

                  {readerPrefs.autoAdjustTheme && (
                    <div className="pt-2 border-t border-kindle-border/40 space-y-2.5 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-mono text-kindle-text-muted flex items-center gap-1">
                          <Clock className="w-3 h-3 text-kindle-accent" />
                          Local Time: <strong className="text-kindle-text font-bold">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                        </span>
                        <span className="text-[9px] font-mono text-kindle-text-muted">
                          5 Presets Schedule
                        </span>
                      </div>

                      {/* Daylight Schedule Matrix */}
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                        {DAYLIGHT_THEME_SCHEDULE.map((slot) => {
                          const isCurrentActive = getTimeOfDayAutoTheme() === slot.themeKey;
                          const themeSpec = readerThemes.find(t => t.id === slot.themeKey);
                          return (
                            <div 
                              key={slot.label}
                              className={`p-2 rounded-xl border flex flex-col justify-between text-left transition ${
                                isCurrentActive 
                                  ? "bg-kindle-card border-kindle-accent shadow-xs ring-1 ring-kindle-accent/40" 
                                  : "bg-kindle-card/40 border-kindle-border opacity-70"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[9px] font-bold text-kindle-text truncate">{slot.label}</span>
                                <div className={`w-3 h-3 rounded-full ${themeSpec?.bg || "bg-white"} ring-1 ring-black/20 shrink-0`} />
                              </div>
                              <div className="text-[8px] font-mono text-kindle-text-muted mt-1">{slot.timeRange}</div>
                              <div className="text-[8px] font-bold uppercase tracking-wider text-kindle-accent mt-1 truncate">
                                {slot.themeKey} {isCurrentActive ? "• NOW" : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Manual Theme Selector */}
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 pt-1">
                  {readerThemes.map(t => (
                    <button key={t.id} 
                      onClick={() => {
                        const wasAuto = readerPrefs.autoAdjustTheme;
                        setRP({ theme: t.id, autoAdjustTheme: false, themeManuallySet: true });
                        if (wasAuto) {
                          toast("Auto theme paused for manual selection", { icon: "🎨" });
                        }
                      }}
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition ${
                        readerPrefs.theme === t.id && !readerPrefs.autoAdjustTheme 
                          ? 'border-kindle-accent ring-1 ring-kindle-accent/30 bg-kindle-card' 
                          : 'border-kindle-border hover:bg-kindle-bg'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-md ${t.bg} ring-1 ${t.ring}`} />
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

              {/* TXT Chapter Parser Rule Selector */}
              <div className="space-y-3 pt-4 border-t border-kindle-border/40">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-kindle-text">TXT Chapter Parser</h4>
                    <p className="text-[10px] text-kindle-text-muted">Rule used when splitting raw .txt files into chapters</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddTxtParser(!showAddTxtParser)}
                    className="px-2.5 py-1 bg-kindle-bg border border-kindle-border hover:bg-kindle-card rounded-lg text-[9px] font-bold uppercase tracking-wider text-kindle-text transition cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3 text-kindle-accent" />
                    Custom Rule
                  </button>
                </div>

                {/* Built-in and Custom Rule Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[...BUILT_IN_TXT_PARSERS, ...customParsers].map((parser) => {
                    const isSelected = activeTxtParserId === parser.id;
                    const isCustom = parser.id.startsWith("custom_");
                    return (
                      <div
                        key={parser.id}
                        onClick={() => handleSelectTxtParser(parser.id)}
                        className={`p-3 rounded-xl border text-left cursor-pointer transition relative group ${
                          isSelected
                            ? "bg-kindle-accent/5 border-kindle-accent ring-1 ring-kindle-accent/30"
                            : "bg-kindle-bg border-kindle-border hover:border-kindle-accent/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-bold text-kindle-text truncate">{parser.name}</span>
                              {isSelected && (
                                <span className="text-[8px] bg-kindle-accent text-kindle-bg px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                                  Active
                                </span>
                              )}
                            </div>
                            <p className="text-[9px] text-kindle-text-muted mt-0.5 leading-tight">{parser.description}</p>
                            <p className="text-[8px] font-mono text-kindle-text-muted/80 mt-1 truncate bg-kindle-card px-1.5 py-0.5 rounded border border-kindle-border/40">
                              {parser.pattern}
                            </p>
                          </div>
                          {isCustom && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCustomParser(parser.id);
                              }}
                              className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition cursor-pointer shrink-0"
                              title="Delete custom rule"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add Custom TXT Parser Form */}
                {showAddTxtParser && (
                  <div className="p-3 bg-kindle-bg border border-kindle-border rounded-xl space-y-3 animate-in fade-in duration-200">
                    <h5 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">Create Custom TXT Rule</h5>
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Rule Name (e.g. Volume Parser)"
                        value={newParserName}
                        onChange={(e) => setNewParserName(e.target.value)}
                        className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs outline-none focus:border-kindle-accent"
                      />
                      <input
                        type="text"
                        placeholder="Regex Pattern (e.g. ^\\s*Volume\\s+\\d+)"
                        value={newParserPattern}
                        onChange={(e) => setNewParserPattern(e.target.value)}
                        className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs font-mono outline-none focus:border-kindle-accent"
                      />
                      <input
                        type="text"
                        placeholder="Short Description (optional)"
                        value={newParserDesc}
                        onChange={(e) => setNewParserDesc(e.target.value)}
                        className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs outline-none focus:border-kindle-accent"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveCustomParser}
                        className="flex-1 py-1.5 bg-kindle-text text-kindle-bg hover:bg-kindle-accent rounded-lg text-[9px] font-bold uppercase tracking-widest transition cursor-pointer"
                      >
                        Save & Activate
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddTxtParser(false)}
                        className="px-3 py-1.5 border border-kindle-border hover:bg-kindle-card rounded-lg text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted transition cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
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
              {isAndroidApk ? (
                <div className="space-y-2 px-0.5">
                  <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                    Add Kora home-screen widgets, or long-press the app icon for Continue / News / Library shortcuts.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ["continue", "Pin Continue"],
                        ["brief", "Pin Brief"],
                        ["book", "Pin Book"],
                        ["audio", "Pin Audio"],
                        ["game", "Pin Mini Game"],
                      ] as const
                    ).map(([which, label]) => (
                      <button
                        key={which}
                        type="button"
                        onClick={async () => {
                          const ok = await requestPinAndroidWidget(which);
                          toast[ok ? "success" : "error"](
                            ok
                              ? `Confirm the ${label.replace("Pin ", "")} widget on your home screen`
                              : "Open your widget picker and search “Kora”"
                          );
                        }}
                        className="py-2.5 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-bg transition"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : typeof navigator !== "undefined" && /android/i.test(navigator.userAgent) ? (
                <p className="text-[10px] text-kindle-text-muted leading-relaxed px-0.5">
                  Tip: install the Kora APK to use Continue, Brief, Audiobook, and Mini Crossword home-screen widgets.
                </p>
              ) : null}
            </div>
          )}
        </section>
        </>
        )}

        {view === "settings" && (
        <>
        {/* Personal Dictionary Section */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs">
          {renderPersonalDictionaryContent()}
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

        {/* Devices & cross-device sync — only when settings tab is visible */}
        {view === "settings" && isActive ? (
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
              <span className="font-mono font-bold">{isAndroidApk ? apkLabel : "Kora 1.2.0"}</span>
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

            {isAndroidApk && (
              <div className="pt-3 space-y-3 border-t border-kindle-border/50">
                <div className="flex items-center gap-2">
                  <Download className="w-3.5 h-3.5 text-kindle-accent" />
                  <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">
                    App updates
                  </h4>
                </div>
                <Row
                  title="Auto-check for updates"
                  desc="Periodically check GitHub Releases and notify when a newer APK is ready"
                >
                  <Toggle
                    on={apkAutoUpdate}
                    onClick={() => {
                      const next = !apkAutoUpdate;
                      setApkAutoUpdate(next);
                      setApkAutoUpdateEnabled(next);
                    }}
                  />
                </Row>

                {apkAvailable ? (
                  <div className="rounded-xl border border-kindle-border bg-kindle-bg/60 p-3 space-y-2">
                    <p className="text-[11px] font-bold text-kindle-text">
                      Update available — v{apkAvailable.versionName}
                    </p>
                    <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                      Downloaded from GitHub Releases. Android will ask to install the package.
                    </p>
                    {apkInstalling && (
                      <div className="h-1.5 rounded-full bg-kindle-card overflow-hidden">
                        <div
                          className="h-full bg-kindle-accent transition-all"
                          style={{ width: `${Math.max(2, apkProgress)}%` }}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={apkInstalling}
                      onClick={async () => {
                        setApkInstalling(true);
                        setApkProgress(0);
                        try {
                          await downloadAndInstallApk(apkAvailable, (p) => setApkProgress(p.percent));
                          toast.success("Opening installer…");
                        } catch (err: any) {
                          toast.error(err?.message || "Install failed");
                        } finally {
                          setApkInstalling(false);
                        }
                      }}
                      className="w-full py-2.5 rounded-xl bg-kindle-text text-kindle-bg font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                    >
                      {apkInstalling ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          {apkProgress > 0 ? `Downloading ${apkProgress}%` : "Preparing…"}
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5" />
                          Download &amp; Install
                        </>
                      )}
                    </button>
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={apkChecking || apkInstalling}
                  onClick={async () => {
                    setApkChecking(true);
                    try {
                      const result = await checkForApkUpdate();
                      setApkLastCheck(result.checkedAt);
                      if (result.update) {
                        setApkAvailable(result.update);
                        toast.success(`Update found: v${result.update.versionName}`);
                        window.dispatchEvent(
                          new CustomEvent("kora-apk-update", { detail: result.update })
                        );
                      } else {
                        setApkAvailable(null);
                        toast.success("You're on the latest APK");
                      }
                    } catch (err: any) {
                      toast.error(err?.message || "Update check failed");
                    } finally {
                      setApkChecking(false);
                    }
                  }}
                  className="w-full py-2.5 px-3 border border-kindle-border hover:bg-kindle-bg rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {apkChecking ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Checking GitHub…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      Check for updates
                    </>
                  )}
                </button>
                {apkLastCheck > 0 && (
                  <p className="text-[9px] text-kindle-text-muted text-center">
                    Last checked {new Date(apkLastCheck).toLocaleString()}
                  </p>
                )}
              </div>
            )}

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
                  <BookOpen className="w-3.5 h-3.5" />
                  Booknerd Setup & Walkthrough
                </button>
              )}
            </div>
          </div>
        </section>
        </>
        )}
      </div>

      <CrosswordGame open={showCrossword} onClose={() => setShowCrossword(false)} variant={gameViewVariant()} onOpenScores={() => setShowScoreTracker(true)} />
      <WordSearchGame open={showWordSearch} onClose={() => setShowWordSearch(false)} variant={gameViewVariant()} onOpenScores={() => setShowScoreTracker(true)} />
      <GameScoreTracker open={showScoreTracker} onClose={() => setShowScoreTracker(false)} />
      <LinguistGuardian open={showGuardian} onClose={() => setShowGuardian(false)} onOpenScores={() => setShowScoreTracker(true)} />
      <OnlineScrabbleGame open={showScrabble} onClose={() => setShowScrabble(false)} />
      <ReadingInsightsTool
        open={showInsights}
        onClose={() => setShowInsights(false)}
        books={(books as BookMetadata[]) || getLocalLibrary()}
      />
      <P2pTransferPanel open={showP2p} onClose={() => setShowP2p(false)} />

      <FluidOverlay open={showDictionary} onClose={() => setShowDictionary(false)} variant="sheet" panelClassName="max-w-xl p-6">
        <div className="flex items-center justify-between border-b border-kindle-border pb-3 mb-4">
          <div className="flex items-center gap-3">
            <BookMarked className="w-5 h-5 text-kindle-text" />
            <h3 className="font-lexend font-bold text-sm uppercase tracking-wider">Personal Dictionary</h3>
          </div>
          <button onClick={() => setShowDictionary(false)} className="p-1.5 hover:bg-neutral-100 rounded-lg">
            <X className="w-5 h-5 text-kindle-text" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto pr-1">
          {renderPersonalDictionaryContent()}
        </div>
      </FluidOverlay>

      <FluidOverlay open={showClipper} onClose={() => setShowClipper(false)} variant="sheet" panelClassName="max-w-xl p-6">
        <div className="flex items-center justify-between border-b border-kindle-border pb-3 mb-4">
          <div className="flex items-center gap-3">
            <Scissors className="w-5 h-5 text-kindle-text" />
            <h3 className="font-lexend font-bold text-sm uppercase tracking-wider">Web Clipper</h3>
          </div>
          <button onClick={() => setShowClipper(false)} className="p-1.5 hover:bg-neutral-100 rounded-lg">
            <X className="w-5 h-5 text-kindle-text" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto pr-1">
          <WebClipperPanel userId={userId} onRefreshLibrary={onRefreshLibrary} />
        </div>
      </FluidOverlay>

      <FluidOverlay open={showFolderWatch} onClose={() => setShowFolderWatch(false)} variant="sheet" panelClassName="max-w-xl p-6">
        <div className="flex items-center justify-between border-b border-kindle-border pb-3 mb-4">
          <div className="flex items-center gap-3">
            <FolderOpen className="w-5 h-5 text-emerald-500" />
            <h3 className="font-lexend font-bold text-sm uppercase tracking-wider">Folder Watch</h3>
          </div>
          <button onClick={() => setShowFolderWatch(false)} className="p-1.5 hover:bg-neutral-100 rounded-lg">
            <X className="w-5 h-5 text-kindle-text" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto pr-1">
          {renderFolderWatchContent()}
        </div>
      </FluidOverlay>

      <FluidOverlay open={showReadAloud} onClose={() => setShowReadAloud(false)} variant="sheet" panelClassName="max-w-2xl p-6">
        <div className="flex items-center justify-between border-b border-kindle-border pb-3 mb-4">
          <div className="flex items-center gap-3">
            <Headphones className="w-5 h-5 text-kindle-text" />
            <h3 className="font-lexend font-bold text-sm uppercase tracking-wider">Voice Reader</h3>
          </div>
          <button onClick={() => setShowReadAloud(false)} className="p-1.5 hover:bg-neutral-100 rounded-lg">
            <X className="w-5 h-5 text-kindle-text" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto pr-1">
          <BuiltInAudiobookConverter
            books={(books as BookMetadata[]) || []}
            userId={userId}
            onRefreshLibrary={onRefreshLibrary}
          />
        </div>
      </FluidOverlay>

      <FluidOverlay open={showCloudImport} onClose={() => setShowCloudImport(false)} variant="dialog" panelClassName="max-w-sm p-8 text-center bg-kindle-card">
        <div className="w-16 h-16 bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Cloud className="w-8 h-8" />
        </div>
        <h3 className="text-sm font-bold uppercase tracking-wider mb-2">Cloud Connectivity</h3>
        <p className="text-[10px] text-kindle-text-muted mb-8 leading-relaxed">
          Connect your Google Drive or Dropbox to instantly sync your entire ebook collection. 
          Secure OAuth integration ensures your data stays private.
        </p>
        <div className="space-y-3">
          <button 
            type="button"
            className="w-full py-3 bg-[#4285F4] hover:bg-[#4285F4]/90 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-sm transition cursor-pointer"
            onClick={() => toast("Cloud Sync Integration: Please set up Google OAuth in AI Studio settings to enable this feature.")}
          >
            Connect Google Drive
          </button>
          <button 
            type="button"
            className="w-full py-3 bg-kindle-bg border border-kindle-border text-kindle-text rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-kindle-card transition cursor-pointer"
            onClick={() => setShowCloudImport(false)}
          >
            Maybe Later
          </button>
        </div>
      </FluidOverlay>

      {showWikipedia && (
        <div className="fixed inset-0 z-[80] bg-kindle-bg flex flex-col w-full h-full overflow-hidden">
          <WikipediaWidget
            onClose={() => setShowWikipedia(false)}
            userId={userId}
            onRefreshLibrary={onRefreshLibrary}
          />
        </div>
      )}
    </div>
  );
}

export default React.memo(SettingsView);
