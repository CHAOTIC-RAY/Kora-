import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  auth, 
  isRealFirebase, 
  loadLibrary, 
  BookMetadata, 
  syncBookToCloud,
  initFirebase 
} from "./lib/firebase";
import { enrichBookMetadata } from "./lib/metadataEnricher";
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  User,
  GoogleAuthProvider,
  signInWithPopup
} from "firebase/auth";
import { getBookFile, clearAllCachedBooks, storeBookFile } from "./db/indexedDB";
import { inferBookTags } from "./lib/tagsHelper";
import LibraryManager from "./components/LibraryManager";
import DiscoverView from "./components/DiscoverView";
import SettingsView from "./components/SettingsView";
import BookReaderEPUB from "./components/BookReaderEPUB";
import BookReaderPDF from "./components/BookReaderPDF";
import BookReaderText from "./components/BookReaderText";
import AudiobookPlayer from "./components/AudiobookPlayer";
import { loadAudiobookSession } from "./lib/audiobookSession";
import { KoraIcon, KoraWordmark } from "./components/KoraLogo";
import { enqueueAudiobookDownload, handleAudiobookSwMessage } from "./lib/audiobookSyncQueue";
import { useAndroidBackLayer } from "./hooks/useAndroidBackLayer";
import { removeAndroidBackLayer } from "./lib/androidGestures";
import {
  ensureServiceWorkerReady,
  handoffBookDownload,
  isDailyNewsBriefEnabled,
  markBriefNotificationShown,
  registerBackgroundCapabilities,
  setDailyNewsBriefEnabled as persistDailyNewsBriefEnabled,
  syncServiceWorkerPrefs,
} from "./lib/swBridge";
import { applySelectedFeedSources } from "./lib/feedStorage";
import Quote from "./components/Quote";
import FeedView from "./components/FeedView";
import DownloadBookBtn from "./components/DownloadBookBtn";
import OnboardingModal from "./components/OnboardingModal";
import DailyReminderModal from "./components/DailyReminderModal";
import KoraLoading from "./components/KoraLoading";
import { toast, Toaster } from "react-hot-toast";
import { logger } from "./lib/logger";
import { 
  BookOpen, Search, User as UserIcon, LogOut, Cloud, 
  CloudLightning, Key, Smartphone, Sparkles, LogIn, Mail,
  Settings as SettingsIcon, Moon, Sun, Monitor, Clock, Bookmark,
  Compass, Play, Download, Globe, FileText, AlertCircle, AlertTriangle, Rss,
  RefreshCw, Zap, Database, Trash2, Library, BookMarked, Wrench
} from "lucide-react";
import JSZip from "jszip";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import FluidOverlay, { koraEase, koraSpring } from "./components/FluidOverlay";
import {
  hydrateBookFile,
  maybePushBookToWebDav,
  loadSyncPrefs,
  registerThisDevice,
  listenAndServePeerRequests,
} from "./lib/crossDeviceSync";

const MOBILE_TABS = [
  { id: "library" as const, label: "Library", Icon: Library },
  { id: "discover" as const, label: "Discover", Icon: Compass },
  { id: "feed" as const, label: "Read", Icon: Rss },
  { id: "tools" as const, label: "Tools", Icon: Wrench },
];

async function injectMetadataIntoEpub(
  fileBlob: Blob,
  title: string,
  author: string,
  description?: string,
  publisher?: string,
  year?: string
): Promise<Blob> {
  try {
    const zip = await JSZip.loadAsync(fileBlob);
    let opfPath = "";
    
    const containerFile = zip.file("META-INF/container.xml");
    if (containerFile) {
      const containerXml = await containerFile.async("text");
      const parser = new DOMParser();
      const doc = parser.parseFromString(containerXml, "text/xml");
      const rootfile = doc.querySelector("rootfile");
      if (rootfile) {
        opfPath = rootfile.getAttribute("full-path") || "";
      }
    }
    
    if (!opfPath) {
      opfPath = Object.keys(zip.files).find(name => name.endsWith(".opf")) || "";
    }
    
    if (opfPath) {
      const opfFile = zip.file(opfPath);
      if (opfFile) {
        const opfText = await opfFile.async("text");
        const parser = new DOMParser();
        const doc = parser.parseFromString(opfText, "text/xml");
        
        const metadataNode = doc.querySelector("metadata") || doc.querySelector("opf\\:metadata");
        if (metadataNode) {
          const setMetadataTag = (tagName: string, value: string, attributes?: Record<string, string>) => {
            let el = doc.querySelector(tagName.replace(":", "\\:"));
            if (!el) {
              const localName = tagName.split(":").pop() || tagName;
              el = doc.querySelector(localName);
            }
            if (el) {
              el.textContent = value;
            } else {
              const newEl = doc.createElementNS("http://purl.org/dc/elements/1.1/", tagName);
              newEl.textContent = value;
              if (attributes) {
                Object.entries(attributes).forEach(([k, v]) => newEl.setAttribute(k, v));
              }
              metadataNode.appendChild(newEl);
            }
          };
          
          setMetadataTag("dc:title", title);
          setMetadataTag("dc:creator", author, { "opf:role": "aut" });
          if (description) {
            setMetadataTag("dc:description", description);
          }
          if (publisher) {
            setMetadataTag("dc:publisher", publisher);
          }
          if (year) {
            setMetadataTag("dc:date", year);
          }
          
          const serializer = new XMLSerializer();
          const updatedOpfText = serializer.serializeToString(doc);
          zip.file(opfPath, updatedOpfText);
          
          const newBlob = await zip.generateAsync({ 
            type: "blob", 
            mimeType: "application/epub+zip",
            compression: "DEFLATE",
            compressionOptions: { level: 5 }
          });
          return newBlob;
        }
      }
    }
  } catch (err) {
    console.warn("Failed to inject metadata into EPUB file:", err);
  }
  return fileBlob;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: any, errorInfo: any) { console.error("ErrorBoundary caught an error", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-center">
          <p className="text-xs text-red-600 font-bold uppercase tracking-widest">Something went wrong in this section.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // Navigation & view states
  const [activeTab, setActiveTab] = useState<"library" | "discover" | "feed" | "tools" | "settings">("library");
  const [activeBook, setActiveBook] = useState<BookMetadata | null>(null);
  const [audiobookPlayback, setAudiobookPlayback] = useState<BookMetadata | null>(null);
  const [lastReadBook, setLastReadBook] = useState<BookMetadata | null>(() => {
    const saved = localStorage.getItem("kindle_last_read");
    return saved ? JSON.parse(saved) : null;
  });
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [grayscaleCovers, setGrayscaleCovers] = useState<boolean>(() => {
    return localStorage.getItem("kindle_grayscale_covers") === "true";
  });
  const [displayTheme, setDisplayTheme] = useState<string>(() => {
    return localStorage.getItem("kora_display_theme") || "theme-light-white";
  });

  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    return localStorage.getItem("kora_onboarding_completed") !== "true";
  });
  const [userNickname, setUserNickname] = useState<string>(() => {
    return localStorage.getItem("kora_user_nickname") || "Fellow Bookworm";
  });
  const [dailyRemindersEnabled, setDailyRemindersEnabled] = useState<boolean>(() => {
    return localStorage.getItem("kora_daily_reminders") === "true";
  });
  const [dailyNewsBriefEnabled, setDailyNewsBriefEnabled] = useState<boolean>(() => isDailyNewsBriefEnabled());
  const [showDailyReminder, setShowDailyReminder] = useState<boolean>(false);

  const handleDailyNewsBriefChange = async (enabled: boolean) => {
    setDailyNewsBriefEnabled(enabled);
    persistDailyNewsBriefEnabled(enabled);
    await syncServiceWorkerPrefs();
    await registerBackgroundCapabilities();
    if (enabled && "serviceWorker" in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: "check-daily-brief" });
    }
  };

  useEffect(() => {
    if (dailyRemindersEnabled && !showOnboarding) {
      const lastReminder = localStorage.getItem("kora_last_reminder_date");
      const today = new Date().toDateString();
      if (lastReminder !== today) {
        setShowDailyReminder(true);
        localStorage.setItem("kora_last_reminder_date", today);
      }
    }
  }, [dailyRemindersEnabled, showOnboarding]);

  const handleOnboardingComplete = (prefs: {
    nickname: string;
    archetype: string;
    displayTheme: string;
    fontSize: number;
    dailyGoal: number;
    autoCache: boolean;
    dailyReminders: boolean;
    selectedFeedUrls: string[];
  }) => {
    localStorage.setItem("kora_onboarding_completed", "true");
    localStorage.setItem("kora_user_nickname", prefs.nickname);
    localStorage.setItem("kora_user_archetype", prefs.archetype);
    localStorage.setItem("kora_display_theme", prefs.displayTheme);
    localStorage.setItem("kora_daily_reminders", String(prefs.dailyReminders));
    setDisplayTheme(prefs.displayTheme);
    setUserNickname(prefs.nickname);
    
    const updatedPrefs = {
      ...readerPrefs,
      fontSize: prefs.fontSize,
      theme: prefs.displayTheme.includes("dark") ? "dark" : "light"
    };
    setReaderPrefs(updatedPrefs);
    localStorage.setItem("kora_reader_prefs", JSON.stringify(updatedPrefs));
    
    localStorage.setItem("kora_reading_goal", String(prefs.dailyGoal));
    
    const updatedSearch = {
      ...searchPrefs,
      autoCacheDownloads: prefs.autoCache
    };
    setSearchPrefs(updatedSearch);
    localStorage.setItem("kora_search_prefs", JSON.stringify(updatedSearch));

    applySelectedFeedSources(prefs.selectedFeedUrls);

    setShowOnboarding(false);
    toast.success(`Welcome, ${prefs.nickname}! Your reading identity has been forged.`);
  };

  // Reader / reading preferences (persisted, consumed by BookReaderEPUB on open)
  const [readerPrefs, setReaderPrefs] = useState(() => {
    const saved = localStorage.getItem("kora_reader_prefs");
    const initialDisplayTheme = localStorage.getItem("kora_display_theme") || "theme-light-white";
    return saved ? JSON.parse(saved) : {
      fontSize: 18,
      lineSpacing: 1.6,
      fontFamily: "font-serif",
      theme: initialDisplayTheme.includes("dark") ? "dark" : "light",
      themeManuallySet: false,
      marginSize: "max-w-2xl px-6",
      isContinuous: false,
      brightness: 100,
      grayscaleImages: false,
    };
  });

  // Automatically update reader theme if not manually set by user
  useEffect(() => {
    if (!readerPrefs.themeManuallySet) {
      setReaderPrefs((prev: any) => ({
        ...prev,
        theme: displayTheme.includes("dark") ? "dark" : "light"
      }));
    }
  }, [displayTheme]);

  // Search / discovery preferences
  const [searchPrefs, setSearchPrefs] = useState(() => {
    const saved = localStorage.getItem("kora_search_prefs");
    return saved ? JSON.parse(saved) : {
      defaultSource: "all",
      autoCacheDownloads: true,
      openInNewTab: false,
    };
  });

  const [zlibConfig, setZlibConfig] = useState(() => {
    const saved = localStorage.getItem("kora_zlib_config");
    return saved ? JSON.parse(saved) : {
      baseUrl: "https://z-library.rs",
      email: "",
      password: "",
      autoDiscover: true,
    };
  });

  // Auth states
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState<boolean>(true);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [isSignUp, setIsSignUp] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Books Library list
  const [books, setBooks] = useState<BookMetadata[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState<boolean>(false);
  const [cachedBookIds, setCachedBookIds] = useState<Set<string>>(new Set());
  const [selectedBookForDownload, setSelectedBookForDownload] = useState<any | null>(null);
  const [discoverInitialQuery, setDiscoverInitialQuery] = useState<string | null>(null);
  const [feedInitialUrl, setFeedInitialUrl] = useState<string | null>(null);

  // Restore minimized audiobook player after reload if playback was active.
  useEffect(() => {
    if (audiobookPlayback || books.length === 0) return;
    const session = loadAudiobookSession();
    if (!session?.isPlaying) return;
    const book = books.find((b) => b.id === session.bookId);
    if (!book?.audiobookTracks?.length) return;
    setAudiobookPlayback({
      ...book,
      audiobookCurrentTrack: session.trackIndex,
      audiobookCurrentTime: session.currentTime,
    });
  }, [audiobookPlayback, books]);

  // Mobile Web App / PWA Share Target state variables
  const [sharingStatus, setSharingStatus] = useState<"idle" | "converting" | "success" | "error">("idle");
  const [sharingUrl, setSharingUrl] = useState<string>("");
  const [sharingError, setSharingError] = useState<string | null>(null);

  // Global Background Downloads State
  const [globalDownloads, setGlobalDownloads] = useState<any[]>(() => {
    const saved = localStorage.getItem("kora_downloads_log");
    return saved ? JSON.parse(saved) : [];
  });
  const foregroundDownloadAborts = useRef<Map<string, AbortController>>(new Map());

  const removeDownloadEntry = useCallback((downloadId: string) => {
    setGlobalDownloads((prev) => {
      const updated = prev.filter((dl) => dl.id !== downloadId);
      localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
      return updated;
    });
    try {
      const payloads = JSON.parse(localStorage.getItem("kora_sw_payloads") || "{}");
      delete payloads[downloadId];
      localStorage.setItem("kora_sw_payloads", JSON.stringify(payloads));
    } catch {
      /* ignore */
    }
    try {
      toast.dismiss(downloadId);
    } catch {
      /* ignore */
    }
  }, []);

  const cancelBackgroundDownload = useCallback(
    (downloadId: string) => {
      const fg = foregroundDownloadAborts.current.get(downloadId);
      if (fg) {
        try {
          fg.abort();
        } catch {
          /* ignore */
        }
        foregroundDownloadAborts.current.delete(downloadId);
      }
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "bgf-cancel",
          downloadId,
        });
      }
      removeDownloadEntry(downloadId);
      toast("Download stopped", { id: downloadId });
    },
    [removeDownloadEntry]
  );

  const dismissDownload = useCallback(
    (downloadId: string) => {
      removeDownloadEntry(downloadId);
    },
    [removeDownloadEntry]
  );

  // Background download handler
  async function startBackgroundDownload(book: any, mirrors: any | any[], variant: any) {
    const mirrorList = Array.isArray(mirrors) ? mirrors : [mirrors];
    if (!mirrorList || mirrorList.length === 0) {
      toast.error("No valid download mirrors available for auto-download.");
      return;
    }
    
    const downloadId = Math.random().toString(36).substring(7);
    const newDl = {
      id: downloadId,
      md5: variant.md5,
      title: book.title,
      author: book.author || "Unknown",
      coverUrl: book.coverUrl || "",
      size: variant.size || "Unknown",
      status: "downloading",
      percent: 0,
      timestamp: Date.now()
    };

    setGlobalDownloads(prev => {
      const updated = [newDl, ...prev];
      localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
      return updated;
    });

    toast.loading(`Downloading ${book.title}...`, { id: downloadId });

    // --- Background download via Service Worker (survives app exit + shows
    // Android progress notification). Falls back to the foreground loop below
    // if the SW isn't controlling the page yet. ---
    try {
      if ("Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch (e) {}
      }
      const proxyUrl = `/api/proxy-file?url=${encodeURIComponent(mirrorList[0].url)}`;
      const payloads = JSON.parse(localStorage.getItem("kora_sw_payloads") || "{}");
      payloads[downloadId] = {
        book: { title: book.title, author: book.author, coverUrl: book.coverUrl, tags: book.tags, language: book.language, description: book.description, publisher: book.publisher, year: book.year },
        variant: { md5: variant.md5, size: variant.size, extension: variant.extension, format: variant.format, downloadUrl: variant.downloadUrl, directUrl: variant.directUrl },
        fileExtension: variant.extension || variant.format || "epub"
      };
      localStorage.setItem("kora_sw_payloads", JSON.stringify(payloads));

      const handedOff = await handoffBookDownload({
        downloadId,
        title: book.title,
        author: book.author || "Unknown",
        coverUrl: book.coverUrl || "",
        md5: variant.md5,
        fileExtension: variant.extension || variant.format || "epub",
        proxyUrl,
      });
      if (handedOff) return;
    } catch (swErr) {
      logger.warn("SW download handoff failed, using foreground fallback:", swErr);
    }

    let finalError: any = null;
    let success = false;

    for (let index = 0; index < mirrorList.length; index++) {
      const mirror = mirrorList[index];
      try {
        const attemptLabel = mirrorList.length > 1 ? `(Mirror ${index + 1}/${mirrorList.length}) ` : '';
        logger.info(`Starting background download for "${book.title}" ${attemptLabel}. Size: ${variant.size || 'Unknown'}. Mirror: ${mirror.url}`);

        setGlobalDownloads(prev => {
          const updated = prev.map(dl => dl.id === downloadId ? { 
            ...dl, 
            status: "downloading", 
            percent: 0,
            speed: "Connecting...",
            eta: "",
            transferred: attemptLabel
          } : dl);
          localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
          return updated;
        });

        const proxyUrl = `/api/proxy-file?url=${encodeURIComponent(mirror.url)}`;
        const abortController = new AbortController();
        foregroundDownloadAborts.current.set(downloadId, abortController);
        
        const response = await fetch(proxyUrl, { signal: abortController.signal });
        if (!response.ok) {
          let errMsg = `Mirror unresponsive (HTTP ${response.status}).`;
          try {
            const errData = await response.json();
            if (errData && errData.error) {
              errMsg = errData.error;
            }
          } catch (e) {
            try {
              const errText = await response.text();
              if (errText && errText.length < 200) errMsg = errText;
            } catch (e2) {}
          }
          throw new Error(errMsg);
        }

        // Determine the correct file extension based on response headers, metadata, and URL
        const contentDisposition = response.headers.get("content-disposition");
        const contentType = response.headers.get("content-type");
        
        if (contentType && contentType.toLowerCase().includes("text/html")) {
          throw new Error("Mirror returned a webpage instead of a book file. Trying next link...");
        }

        let fileExtension = "epub"; // safe fallback

        // 1. Check Content-Disposition first
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename\*?=["']?([^"';]+)["']?/i);
          if (filenameMatch && filenameMatch[1]) {
            let filename = filenameMatch[1];
            if (filename.startsWith("UTF-8''")) {
              filename = decodeURIComponent(filename.substring(7));
            }
            const ext = filename.split('.').pop()?.toLowerCase();
            if (ext && ext !== "php" && ext !== "html" && ext.length <= 4) {
              fileExtension = ext;
            }
          }
        }

        // 2. Fallback to Content-Type
        if (fileExtension === "epub" && contentType) {
          const ct = contentType.toLowerCase();
          if (ct.includes("epub")) fileExtension = "epub";
          else if (ct.includes("pdf")) fileExtension = "pdf";
          else if (ct.includes("mobi")) fileExtension = "mobi";
          else if (ct.includes("azw3")) fileExtension = "azw3";
          else if (ct.includes("zip")) fileExtension = "zip";
        }

        // 3. Fallback to variant/metadata extension
        if (fileExtension === "epub" && (variant.extension || variant.format)) {
          const ext = (variant.extension || variant.format).toLowerCase();
          if (ext && ext !== "php" && ext !== "html") {
            fileExtension = ext;
          }
        }

        // 4. Fallback to safe parsing of original mirror URL
        if (fileExtension === "epub" && mirror.url) {
          try {
            const urlObj = new URL(mirror.url);
            const pathname = urlObj.pathname;
            const ext = pathname.split('.').pop()?.toLowerCase();
            if (ext && ext !== "php" && ext !== "html" && ext.length <= 4) {
              fileExtension = ext;
            }
          } catch (e) {}
        }

        const reader = response.body?.getReader();
        const contentLength = +(response.headers.get('Content-Length') || 0);
        let receivedLength = 0;
        const chunks = [];

        const formatBytes = (bytes: number) => {
          if (bytes === 0) return "0 B";
          const k = 1024;
          const sizes = ["B", "KB", "MB", "GB"];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
        };

        if (reader) {
          const startTime = Date.now();
          let lastUpdateTime = Date.now();

          while(true) {
            if (abortController.signal.aborted) {
              try { await reader.cancel(); } catch { /* ignore */ }
              throw new DOMException("Cancelled", "AbortError");
            }
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            
            const percent = contentLength > 0 
              ? Math.round((receivedLength / contentLength) * 100) 
              : null;
              
            const now = Date.now();
            // Throttle state updates to once every 150ms for buttery-smooth UI rendering
            if (now - lastUpdateTime > 150 || receivedLength === contentLength) {
              lastUpdateTime = now;
              const elapsed = (now - startTime) / 1000; // seconds
              const speedBytes = elapsed > 0 ? (receivedLength / elapsed) : 0;
              const speedStr = speedBytes > 1024 * 1024 
                ? `${(speedBytes / (1024 * 1024)).toFixed(1)} MB/s` 
                : speedBytes > 1024 
                  ? `${(speedBytes / 1024).toFixed(0)} KB/s` 
                  : `${Math.round(speedBytes)} B/s`;

              let etaStr = "";
              if (contentLength > 0 && speedBytes > 0) {
                const remainingBytes = contentLength - receivedLength;
                const remainingSeconds = Math.round(remainingBytes / speedBytes);
                if (remainingSeconds > 60) {
                  const mins = Math.floor(remainingSeconds / 60);
                  const secs = remainingSeconds % 60;
                  etaStr = `${mins}m ${secs}s remaining`;
                } else if (remainingSeconds > 0) {
                  etaStr = `${remainingSeconds}s remaining`;
                } else {
                  etaStr = "finishing...";
                }
              } else {
                etaStr = "downloading...";
              }

              const transferredStr = contentLength > 0 
                ? `${formatBytes(receivedLength)} of ${formatBytes(contentLength)}`
                : formatBytes(receivedLength);

              setGlobalDownloads(prev => {
                const updated = prev.map(dl => dl.id === downloadId ? { 
                  ...dl, 
                  percent,
                  speed: speedStr,
                  transferred: transferredStr,
                  eta: etaStr
                } : dl);
                localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
                return updated;
              });
            }
          }
        }

        let fileBlob = new Blob(chunks);
        const id = variant.md5 || Math.random().toString(36).substring(7);

        // Check if downloading using normal discovery search (non-advanced Google Book based search)
        const isGoogleBookSearch = book.isGoogleBook || book.source === "google";
        
        let finalTitle = book.title;
        let finalAuthor = book.author;
        let finalDescription = book.description || "";
        let finalPublisher = book.publisher || "";
        let finalYear = book.year || "";
        let finalLanguage = book.language || variant.language || "English";
        let finalCoverUrl = book.coverUrl || "";
        let finalPageCount = book.pages ? parseInt(book.pages) : undefined;
        let finalTags = Array.from(new Set([
          ...inferBookTags(finalTitle, finalAuthor, fileExtension),
          ...(book.categories || [])
        ]));

        if (isGoogleBookSearch) {
          logger.info(`Normal discovery search download detected. Fetching complete Google Books metadata for "${book.title}"`);
          try {
            const query = encodeURIComponent(`intitle:${book.title} inauthor:${book.author}`);
            const gRes = await fetch(`/api/google-books/search?q=${query}&maxResults=1`);
            if (gRes.ok) {
              const gData = await gRes.json();
              if (gData.items && gData.items[0]) {
                const info = gData.items[0].volumeInfo;
                if (info) {
                  finalTitle = info.title || finalTitle;
                  finalAuthor = info.authors?.join(", ") || finalAuthor;
                  finalDescription = info.description || finalDescription;
                  finalPublisher = info.publisher || finalPublisher;
                  finalYear = info.publishedDate?.split("-")[0] || finalYear;
                  finalLanguage = info.language || finalLanguage;
                  if (info.imageLinks?.thumbnail) {
                    finalCoverUrl = info.imageLinks.thumbnail.replace("http:", "https:");
                  }
                  if (info.pageCount) {
                    finalPageCount = info.pageCount;
                  }
                  if (info.categories) {
                    const parsedCats = info.categories.flatMap((cat: string) => {
                      const parts = cat.split("/").map(s => s.trim()).filter(Boolean);
                      return [cat, ...parts];
                    });
                    finalTags = Array.from(new Set([...finalTags, ...parsedCats]));
                  }
                }
              }
            }
          } catch (e) {
            console.warn("Failed on-the-fly Google Books metadata enrich:", e);
          }

          // Inject metadata into the EPUB zip before storing it
          if (fileExtension === "epub") {
            logger.info(`Injecting updated Google Books metadata into EPUB file for "${finalTitle}"`);
            try {
              fileBlob = await injectMetadataIntoEpub(
                fileBlob,
                finalTitle,
                finalAuthor,
                finalDescription,
                finalPublisher,
                finalYear
              );
            } catch (injectErr) {
              console.warn("Failed to inject metadata into EPUB blob:", injectErr);
            }
          }
        }

        await storeBookFile(id, fileBlob, `${finalTitle}.${fileExtension}`, fileExtension);

        // Save to library
        const newBook: BookMetadata = {
          id,
          title: finalTitle,
          author: finalAuthor,
          extension: fileExtension,
          size: variant.size || "Unknown",
          language: finalLanguage,
          coverUrl: finalCoverUrl,
          md5: variant.md5,
          source: "Kora Store",
          tags: finalTags,
          status: "to-read",
          progress: { 
            percent: 0, 
            lastReadTime: Date.now(),
            totalPages: finalPageCount || 0
          },
          dateAdded: Date.now(),
          description: finalDescription,
          publisher: finalPublisher,
          year: finalYear,
          downloadUrl: variant.downloadUrl || variant.directUrl
        };

        void maybePushBookToWebDav(newBook, fileBlob).catch(() => undefined);

        await syncBookToCloud(user?.uid || "", newBook);
        
        setGlobalDownloads(prev => {
          const updated = prev.map(dl => dl.id === downloadId ? { ...dl, status: "completed", percent: 100 } : dl);
          localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
          return updated;
        });

        logger.info(`Successfully completed download for "${book.title}". Saved to IndexedDB with ID: ${id}`);
        toast.success(`${book.title} downloaded!`, { id: downloadId });
        refreshLibrary();
        
        success = true;
        break; // Stop iterating on success
      } catch (err: any) {
        const cancelled =
          err?.name === "AbortError" ||
          /abort|cancel/i.test(String(err?.message || ""));
        if (cancelled) {
          foregroundDownloadAborts.current.delete(downloadId);
          removeDownloadEntry(downloadId);
          return;
        }
        logger.warn(`Mirror ${index + 1} failed for "${book.title}". URL: ${mirror.url}. Error: ${err.message || err}`);
        finalError = err;
        // Proceed to the next mirror if this one failed
      } finally {
        foregroundDownloadAborts.current.delete(downloadId);
      }
    }
    
    if (!success) {
      logger.error(`All mirrors failed for "${book.title}". Last error: ${finalError?.message || finalError}`, finalError);
      console.error("Background download failed on all mirrors:", finalError);
      setGlobalDownloads(prev => {
        const updated = prev.map(dl => dl.id === downloadId ? { ...dl, status: "error", error: finalError?.message } : dl);
        localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
        return updated;
      });
      toast.error(`Failed to download ${book.title}`, { id: downloadId });
    }
  }

  // 1. Authenticate user anonymously on mount if not logged in
  useEffect(() => {
    initFirebase();
    // Apply theme to body
    document.body.className = displayTheme;
    if (displayTheme.includes("dark")) {
      document.body.classList.add("dark");
    }
  }, [displayTheme]);

  // Listen for download progress / completion from the service worker
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = async (event: MessageEvent) => {
      const data = event.data || {};
      if (data.type === "download-progress") {
        setGlobalDownloads(prev => {
          const updated = prev.map(dl => dl.id === data.downloadId ? {
            ...dl,
            status: "downloading",
            percent: data.percent,
            transferred: data.transferred,
            speed: data.speed
          } : dl);
          localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
          return updated;
        });
      } else if (data.type === "download-complete") {
        await ingestDownload(data.downloadId, data.title, data.size);
      } else if (data.type === "audiobook-track-complete") {
        // Only notify the queue waiter — ingest happens once in audiobookSyncQueue
        // after the waiter resolves (avoids double pickup → 404 spam).
        handleAudiobookSwMessage(data);
      } else if (data.type === "audiobook-track-progress" || data.type === "audiobook-track-error") {
        handleAudiobookSwMessage(data);
      } else if (data.type === "download-error") {
        if (data.error === "Cancelled") {
          removeDownloadEntry(data.downloadId);
          return;
        }
        setGlobalDownloads(prev => {
          const updated = prev.map(dl => dl.id === data.downloadId ? { ...dl, status: "error", error: data.error } : dl);
          localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
          return updated;
        });
        toast.error(data.error || "Download failed", { id: data.downloadId });
      } else if (data.type === "open-downloads") {
        setActiveTab("library");
      } else if (data.type === "open-feed-briefs") {
        setActiveTab("feed");
      } else if (data.type === "brief-notification-shown") {
        markBriefNotificationShown();
      } else if (data.type === "bgf-retry") {
        setActiveTab("library");
        toast.loading("Retry available in your Library downloads");
      } else if (data.type === "bgf-cancel") {
        removeDownloadEntry(data.downloadId);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [user?.uid, refreshLibrary]);

  useEffect(() => {
    void (async () => {
      await ensureServiceWorkerReady();
      await syncServiceWorkerPrefs();
      await registerBackgroundCapabilities();
      if (dailyNewsBriefEnabled && "serviceWorker" in navigator) {
        navigator.serviceWorker.controller?.postMessage({ type: "check-daily-brief" });
      }
    })();
  }, [dailyNewsBriefEnabled]);

  // Pick up a finished blob from the SW store, store it in the library, then
  // tell the SW to delete its copy. Shared by the completion handler and the
  // on-launch leftover sweep (C7).
  async function ingestDownload(downloadId: string, fallbackTitle: string, fallbackSize?: string) {
    try {
      const res = await fetch(`/__kora_sw_pickup__?id=${encodeURIComponent(downloadId)}`);
      if (!res.ok) throw new Error("pickup failed");
      const blob = await res.blob();

      const mirror = JSON.parse(localStorage.getItem("kora_sw_payloads") || "{}")[downloadId];
      const book = mirror?.book || { title: fallbackTitle };
      const variant = mirror?.variant || {};
      const fileExtension = mirror?.fileExtension || (blob.type.includes("pdf") ? "pdf" : "epub");
      const finalTitle = book.title || fallbackTitle;
      const finalAuthor = book.author || "Unknown";
      const id = variant.md5 || downloadId;
      const finalCoverUrl = book.coverUrl || "";
      const finalTags = Array.from(new Set([...(book.tags || []), ...inferBookTags(finalTitle, finalAuthor, fileExtension)]));

      await storeBookFile(id, blob, `${finalTitle}.${fileExtension}`, fileExtension);
      const newBook: BookMetadata = {
        id,
        title: finalTitle,
        author: finalAuthor,
        extension: fileExtension,
        size: fallbackSize || variant.size || "Unknown",
        language: book.language || variant.language || "English",
        coverUrl: finalCoverUrl,
        md5: variant.md5,
        source: "Kora Store",
        tags: finalTags,
        status: "to-read",
        progress: { percent: 0, lastReadTime: Date.now() },
        dateAdded: Date.now(),
        description: book.description || "",
        publisher: book.publisher || "",
        year: book.year || "",
        downloadUrl: variant.downloadUrl || variant.directUrl
      };
      void maybePushBookToWebDav(newBook, blob).catch(() => undefined);
      await syncBookToCloud(user?.uid || "", newBook);
      setGlobalDownloads(prev => {
        const updated = prev.map(dl => dl.id === downloadId ? { ...dl, status: "completed", percent: 100 } : dl);
        localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
        return updated;
      });
      toast.success(`${finalTitle} downloaded!`, { id: downloadId });
      refreshLibrary();
      navigator.serviceWorker.controller?.postMessage({ type: "pickup-complete", downloadId });
    } catch (err) {
      console.error("SW pickup failed:", err);
      setGlobalDownloads(prev => prev.map(dl => dl.id === downloadId ? { ...dl, status: "error", error: "Pickup failed" } : dl));
    }
  }

  // On launch, sweep any blobs the SW finished while the app was closed and
  // ingest them into the library (C7).
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
    (async () => {
      try {
        const res = await fetch("/__kora_sw_list__");
        if (!res.ok) return;
        const pending: string[] = await res.json();
        for (const id of pending) {
          // Skip audiobook track pickups (handled by audiobookSyncQueue).
          if (String(id).includes("::") || String(id).startsWith("audiobook-")) continue;
          await ingestDownload(id, "Downloaded book");
        }
      } catch (e) {
        /* SW not ready yet; will retry on next launch */
      }
    })();
  }, [user?.uid, ingestDownload]);

  // Web Share Target API helper to extract a URL
  function extractUrl(text: string | null): string | null {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex);
    return matches ? matches[0] : null;
  }

  // Handle incoming mobile shared webpages automatically
  useEffect(() => {
    if (loadingAuth) return; // wait until auth is complete

    const searchParams = new URLSearchParams(window.location.search);
    const sharedText = searchParams.get("text");
    const sharedUrlParam = searchParams.get("url");
    const sharedTitle = searchParams.get("title");

    const rawUrl = sharedUrlParam || sharedText;
    const extractedUrl = extractUrl(rawUrl);

    if (extractedUrl) {
      console.log("[PWA Share Target] Detected shared URL:", extractedUrl);
      setSharingUrl(extractedUrl);
      
      // Clean query parameters from URL so reloads don't convert again
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);

      // Start conversion
      handleConvertSharedUrl(extractedUrl, sharedTitle || "Shared Article");
    }
  }, [loadingAuth, user]);

  async function handleConvertSharedUrl(urlToConvert: string, initialTitle: string) {
    setSharingStatus("converting");
    setSharingError(null);
    try {
      const response = await fetch("/api/convert-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToConvert.trim() })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `HTTP error ${response.status}`);
      }

      const data = await response.json();
      const bookId = `clipper-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const sizeStr = `${(data.htmlContent.length / 1024).toFixed(1)} KB`;
      
      const newBook: BookMetadata = {
        id: bookId,
        title: data.title || initialTitle || "Clipped Article",
        author: data.author || "Web Article",
        extension: "html",
        size: sizeStr,
        tags: ["Clipped", "Web"],
        status: "to-read",
        progress: {
          percent: 0,
          lastReadTime: Date.now()
        },
        dateAdded: Date.now(),
        description: data.description || `Clipped from ${new URL(urlToConvert).hostname}`
      };

      // Store in IndexedDB
      const blob = new Blob([data.htmlContent], { type: "text/html" });
      await storeBookFile(bookId, blob, `${newBook.title}.html`, "html");

      // Sync to cloud/localStorage
      await syncBookToCloud(user?.uid || "", newBook);

      setSharingStatus("success");
      await refreshLibrary(user?.uid || "");
      
      // Instantly open the newly added webpage in reader
      setActiveBook(newBook);

      setTimeout(() => setSharingStatus("idle"), 5000);
    } catch (err: any) {
      console.error("[PWA Share Target Error]:", err);
      setSharingError(err.message || "Failed to convert shared webpage.");
      setSharingStatus("error");
    }
  }

  useEffect(() => {
    if (!auth) {
      setLoadingAuth(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setLoadingAuth(false);
        await refreshLibrary(currentUser.uid);

        // Check if guest account has expired (30 days limit)
        if (currentUser.isAnonymous && currentUser.metadata.creationTime) {
          try {
            const creationTime = new Date(currentUser.metadata.creationTime).getTime();
            const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
            if (Date.now() - creationTime >= thirtyDaysMs) {
              console.log("Guest account expired (30 days limit). Resetting session...");
              await signOut(auth);
            }
          } catch (e) {
            console.error("Error checking guest expiration:", e);
          }
        }
      } else {
        // Auto sign in anonymously for a seamless sandbox sync space
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.error("Anonymous authentication failed:", err);
          setLoadingAuth(false);
          // Load local library even without account
          await refreshLibrary("");
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Cross-device: register this device + serve P2P file requests when enabled
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    let unsubPeer: (() => void) | undefined;
    const syncPeer = () => {
      const prefs = loadSyncPrefs();
      void registerThisDevice(uid, prefs.peerSharingEnabled);
      unsubPeer?.();
      unsubPeer = listenAndServePeerRequests(
        uid,
        prefs.peerSharingEnabled,
        (msg) => toast(msg, { id: "peer-serve" })
      );
    };
    syncPeer();
    const heartbeat = window.setInterval(syncPeer, 45_000);
    return () => {
      unsubPeer?.();
      window.clearInterval(heartbeat);
    };
  }, [user?.uid]);

  useEffect(() => {
    localStorage.setItem("kora_zlib_config", JSON.stringify(zlibConfig));
  }, [zlibConfig]);

  useEffect(() => {
    localStorage.setItem("kora_reader_prefs", JSON.stringify(readerPrefs));
  }, [readerPrefs]);

  useEffect(() => {
    localStorage.setItem("kora_search_prefs", JSON.stringify(searchPrefs));
  }, [searchPrefs]);

  // ZLib Auto-discover Base URL
  useEffect(() => {
    if (zlibConfig.autoDiscover) {
      fetch("/api/zlib/domains")
        .then(res => res.json())
        .then(data => {
          if (data && data.domains && data.domains.length > 0) {
            // Select a random domain
            const randomDomainObj = data.domains[Math.floor(Math.random() * data.domains.length)];
            let domainUrl = randomDomainObj.domain || randomDomainObj;
            if (typeof domainUrl === 'string') {
              if (!domainUrl.startsWith("http")) domainUrl = "https://" + domainUrl;
              
              if (domainUrl !== zlibConfig.baseUrl) {
                setZlibConfig((prev: any) => ({ ...prev, baseUrl: domainUrl }));
              }
            }
          }
        })
        .catch(err => console.error("Failed to auto-discover zlib domains:", err));
    }
  }, [zlibConfig.autoDiscover]);

  // Sync index of locally cached books in IndexedDB
  useEffect(() => {
    updateCachedBookIndex();
  }, [books]);

  async function updateCachedBookIndex() {
    const ids = new Set<string>();
    for (const book of books) {
      const exists = await getBookFile(book.id);
      if (exists) {
        ids.add(book.id);
      }
    }
    setCachedBookIds(ids);
  }

  // Keep track of the active tab before transitioning to settings
  const prevTabRef = useRef<"library" | "discover" | "feed" | "tools" | "settings">("library");
  useEffect(() => {
    if (activeTab !== "settings") {
      prevTabRef.current = activeTab;
    }
  }, [activeTab]);

  const isAudiobookBook = activeBook?.extension?.toLowerCase() === "audiobook";
  const audiobookFullscreen = !!(audiobookPlayback && activeBook?.id === audiobookPlayback.id);
  const readerOpen = !!activeBook && !isAudiobookBook;

  const closeReader = useCallback(() => {
    setActiveBook(null);
    refreshLibrary();
  }, [refreshLibrary]);

  const closeAudiobook = useCallback(() => {
    setAudiobookPlayback(null);
    setActiveBook(null);
    refreshLibrary();
  }, [refreshLibrary]);

  const minimizeAudiobook = useCallback(() => {
    setActiveBook(null);
  }, []);

  const dismissReader = useAndroidBackLayer(readerOpen, `reader-${activeBook?.id || "none"}`, closeReader);
  const dismissAudiobookFullscreen = useAndroidBackLayer(
    audiobookFullscreen,
    `audiobook-fullscreen-${audiobookPlayback?.id || "none"}`,
    minimizeAudiobook
  );
  const dismissAudiobookMini = useAndroidBackLayer(
    !!audiobookPlayback && !audiobookFullscreen,
    `audiobook-mini-${audiobookPlayback?.id || "none"}`,
    closeAudiobook
  );
  const dismissSettings = useAndroidBackLayer(activeTab === "settings", "settings", () => {
    setActiveTab(prevTabRef.current);
  });
  const dismissAuthModal = useAndroidBackLayer(showAuthModal, "auth-modal", () => setShowAuthModal(false));
  const dismissSharingModal = useAndroidBackLayer(sharingStatus === "error", "share-error", () => setSharingStatus("idle"));

  const handleAudiobookClose = useCallback(() => {
    if (audiobookPlayback) {
      if (audiobookFullscreen) {
        removeAndroidBackLayer(`audiobook-fullscreen-${audiobookPlayback.id}`, { navigateBack: true });
      } else {
        removeAndroidBackLayer(`audiobook-mini-${audiobookPlayback.id}`, { navigateBack: true });
      }
    }
    closeAudiobook();
  }, [audiobookFullscreen, audiobookPlayback, closeAudiobook]);

  // Startup directory scan trigger
  const hasScannedRef = useRef<boolean>(false);

  useEffect(() => {
    if (books.length > 0 && !hasScannedRef.current) {
      hasScannedRef.current = true;
      runStartupFolderScan();
    }
  }, [books]);

  async function runStartupFolderScan() {
    try {
      const { getSavedDirectoryHandle, scanDirectoryForNewBooks, scanVirtualDirectory } = await import("./lib/directoryHelper");
      
      const realHandle = await getSavedDirectoryHandle();
      const onImport = async (newBook: BookMetadata) => {
        setBooks(prev => {
          if (prev.some(b => b.title.toLowerCase().trim() === newBook.title.toLowerCase().trim())) return prev;
          return [...prev, newBook];
        });
        await syncBookToCloud(user?.uid || "", newBook);
        
        // Enrich metadata in background after import
        enrichBookMetadata(user?.uid || "", newBook).then(enriched => {
          setBooks(prev => prev.map(b => b.id === enriched.id ? enriched : b));
        });
      };

      if (realHandle) {
        console.log("Auto-scanning real download directory...");
        const imported = await scanDirectoryForNewBooks(realHandle, books, user?.uid || "", onImport);
        if (imported > 0) {
          console.log(`Auto-imported ${imported} new books from folder scan.`);
          updateCachedBookIndex();
        }
      } else {
        const isVirtualActive = localStorage.getItem("kora_use_virtual_dir") === "true";
        if (isVirtualActive) {
          console.log("Auto-scanning virtual download directory...");
          const imported = await scanVirtualDirectory(books, onImport);
          if (imported > 0) {
            console.log(`Auto-imported ${imported} new virtual books.`);
            updateCachedBookIndex();
          }
        }
      }
    } catch (err) {
      console.error("Startup folder scan failed:", err);
    }
  }

  // Load books metadata
  async function refreshLibrary(uid = user?.uid || "") {
    setLoadingLibrary(true);
    try {
      const data = await loadLibrary(uid);
      setBooks(data);
    } catch (err) {
      console.error("Failed to load library:", err);
    } finally {
      setLoadingLibrary(false);
    }
  }

  function removeBooksFromLibrary(bookIds: string[]) {
    if (!bookIds.length) return;
    const removeSet = new Set(bookIds);
    setBooks((current) => current.filter((book) => !removeSet.has(book.id)));
    setCachedBookIds((current) => {
      const next = new Set(current);
      bookIds.forEach((id) => next.delete(id));
      return next;
    });
  }

  // Handle manual login/signup
  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth) {
      setAuthError("Authentication is unavailable. Check your connection or disable ad blockers for this site.");
      return;
    }
    if (!authEmail.trim() || !authPassword.trim()) return;

    setAuthError(null);
    setLoadingAuth(true);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
      setShowAuthModal(false);
      setAuthEmail("");
      setAuthPassword("");
    } catch (err: any) {
      setAuthError(err.message || "Authentication failed. Check credentials.");
    } finally {
      setLoadingAuth(false);
    }
  }

  // Handle Google Sign-In
  async function handleGoogleSignIn() {
    if (!auth) {
      setAuthError("Authentication is unavailable. Check your connection or disable ad blockers for this site.");
      return;
    }
    setAuthError(null);
    setLoadingAuth(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setShowAuthModal(false);
    } catch (err: any) {
      console.error("Google sign in failed:", err);
      // Suppress showing canceled error if user closed the popup
      if (err.code !== "auth/popup-closed-by-user") {
        setAuthError(err.message || "Google Sign-In failed.");
      }
    } finally {
      setLoadingAuth(false);
    }
  }

  // Handle logout (returns to anonymous account)
  async function handleSignOut() {
    if (auth) {
      try {
        await signOut(auth);
        setUser(null);
        // Will auto trigger onAuthStateChanged and sign back in anonymously
      } catch (err) {
        console.error("Sign out failed:", err);
      }
    }
  }

  // Handle settings toggle
  function toggleGrayscale() {
    const newValue = !grayscaleCovers;
    setGrayscaleCovers(newValue);
    localStorage.setItem("kindle_grayscale_covers", String(newValue));
  }

  function changeTheme(newTheme: string) {
    setDisplayTheme(newTheme);
    localStorage.setItem("kora_display_theme", newTheme);
  }

  // Clear locally cached book files from IndexedDB
  async function handleClearDeviceCache() {
    try {
      await clearAllCachedBooks();
      await updateCachedBookIndex();
    } catch (err) {
      console.error("Failed to clear device cache:", err);
    }
  }

  // Clear recent searches
  function handleClearRecentSearches() {
    localStorage.removeItem("kora_recent_searches");
  }

  // Handle book selection for reading
  async function handleOpenBook(book: BookMetadata) {
    if (book.extension?.toLowerCase() === "audiobook") {
      if (!book.audiobookTracks?.length) {
        toast.error("This audiobook has no tracks. Open it from Discover to load audio files.");
        return;
      }
      // Kick off track hydrate in background if needed
      void enqueueAudiobookDownload(book.id, book.title, book.audiobookTracks);
      setAudiobookPlayback(book);
      setActiveBook(book);
      setLastReadBook(book);
      localStorage.setItem("kindle_last_read", JSON.stringify(book));
      return;
    }

    if (!cachedBookIds.has(book.id)) {
      const toastId = `hydrate-${book.id}`;
      toast.loading(`Getting “${book.title}” on this device…`, { id: toastId });
      const result = await hydrateBookFile(book, {
        onProgress: (label) => toast.loading(label, { id: toastId }),
      });
      if (!result.ok) {
        toast.error(result.error || "Could not sync this book to this device", { id: toastId });
        return;
      }
      toast.success(
        result.source === "cache"
          ? "Ready"
          : `Synced via ${result.source === "md5" ? "catalog" : result.source}`,
        { id: toastId }
      );
      setCachedBookIds((prev) => {
        const next = new Set(prev);
        next.add(book.id);
        return next;
      });
    }
    setActiveBook(book);
    setLastReadBook(book);
    localStorage.setItem("kindle_last_read", JSON.stringify(book));
  }

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-kindle-bg flex items-center justify-center">
        <KoraLoading />
      </div>
    );
  }

  return (
    <div id="app-root-container" className="min-h-screen min-h-[100dvh] flex flex-col font-sans selection:bg-kindle-accent/20 selection:text-kindle-text transition-colors duration-300">
      {/* 1. Global Navigation Header - Kora Style */}
      <header className="border-b border-kindle-border bg-kindle-bg relative md:sticky top-0 z-40 h-16 kora-safe-top">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-full flex items-center justify-between gap-2 md:gap-4">
        <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
          <button 
            id="kora-logo-home"
            onClick={() => setActiveTab("library")}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity focus:outline-none cursor-pointer shrink-0"
            aria-label="Kora Library Home"
          >
            <KoraIcon className="w-7 h-7 text-kindle-text" />
            <div className="hidden sm:block pr-4 border-r border-kindle-border">
              <KoraWordmark className="h-4 text-kindle-text" />
            </div>
          </button>
          <div className="flex flex-1 min-w-0 max-w-sm sm:max-w-md md:max-w-xl lg:max-w-2xl">
            <Quote />
          </div>
        </div>

        {/* Tab Controls & Cloud Auth Sync Info */}
        <div className="flex items-center gap-2 shrink-0">
          <nav className="hidden md:flex bg-kindle-bg p-1 rounded-xl items-center gap-1 border border-kindle-border">
            <button
              id="library-tab"
              onClick={() => setActiveTab("library")}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-bold font-sans transition-all flex items-center gap-1.5 ${
                activeTab === "library" 
                  ? "bg-kindle-card text-kindle-text shadow-xs border border-kindle-border" 
                  : "text-kindle-text-muted hover:text-kindle-text"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Library</span>
            </button>
            <button
              id="discover-tab"
              onClick={() => setActiveTab("discover")}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-bold font-sans transition-all flex items-center gap-1.5 ${
                activeTab === "discover" 
                  ? "bg-kindle-card text-kindle-text shadow-xs border border-kindle-border" 
                  : "text-kindle-text-muted hover:text-kindle-text"
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>Discover</span>
            </button>
            <button
              id="feed-tab"
              onClick={() => setActiveTab("feed")}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-bold font-sans transition-all flex items-center gap-1.5 ${
                activeTab === "feed" 
                  ? "bg-kindle-card text-kindle-text shadow-xs border border-kindle-border" 
                  : "text-kindle-text-muted hover:text-kindle-text"
              }`}
            >
              <Rss className="w-3.5 h-3.5" />
              <span>Read</span>
            </button>
            <button
              id="tools-tab"
              onClick={() => setActiveTab("tools")}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-bold font-sans transition-all flex items-center gap-1.5 ${
                activeTab === "tools" 
                  ? "bg-kindle-card text-kindle-text shadow-xs border border-kindle-border" 
                  : "text-kindle-text-muted hover:text-kindle-text"
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Tools</span>
            </button>
          </nav>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab("settings")}
              className={`p-2 rounded-xl transition cursor-pointer relative z-40 ${
                activeTab === "settings"
                  ? "bg-kindle-accent/15 text-kindle-accent"
                  : "text-kindle-text-muted hover:text-kindle-text hover:bg-neutral-100"
              }`}
              title="Settings"
              aria-label="Settings"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        </div>
      </header>

      {/* 2. Main Page View Content */}
      <main className={`flex-1 w-full mx-auto max-w-6xl p-4 md:p-8 md:pb-8 kora-main-mobile${
        audiobookPlayback && activeBook?.id !== audiobookPlayback.id ? " has-audiobook-mini" : ""
      }`}>
        
        {/* Sync loading status indicator */}
        {loadingLibrary && (
          <div className="flex items-center gap-2 text-[10px] text-kindle-text-muted font-mono mb-6 px-2">
            <div className="w-3 h-3 border-2 border-kindle-accent border-t-transparent rounded-full animate-spin"></div>
            <span className="uppercase tracking-widest font-bold">Syncing Library...</span>
          </div>
        )}

        {/* Tab Displays */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            className="kora-tab-panel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: koraEase }}
          >
        {activeTab === "library" && (
          <LibraryManager
            userId={user?.uid || ""}
            books={books}
            onBookSelected={handleOpenBook}
            onRefreshLibrary={() => refreshLibrary()}
            onBooksRemoved={removeBooksFromLibrary}
            cachedBookIds={cachedBookIds}
            onCachedIdsChanged={updateCachedBookIndex}
            grayscaleCovers={grayscaleCovers}
            downloads={globalDownloads}
            onCancelDownload={cancelBackgroundDownload}
            onDismissDownload={dismissDownload}
            onSearchTrigger={(query) => {
              setDiscoverInitialQuery(query);
              setActiveTab("discover");
            }}
          />
        )}

        {activeTab === "feed" && (
          <FeedView
            userId={user?.uid || ""}
            onRefreshLibrary={() => refreshLibrary()}
            onOpenBook={handleOpenBook}
            initialUrl={feedInitialUrl}
            onClearInitialUrl={() => setFeedInitialUrl(null)}
          />
        )}
        
        {activeTab === "discover" && (
          <DiscoverView
            userId={user?.uid || ""}
            books={books}
            zlibConfig={zlibConfig}
            selectedBook={selectedBookForDownload}
            onSelectedBookChange={setSelectedBookForDownload}
            onTriggerDownload={startBackgroundDownload}
            onOpenBrowser={(url) => {
              setFeedInitialUrl(url);
              setActiveTab("feed");
            }}
            onBookAdded={async (book) => {
              setBooks(prev => {
                const updated = [...prev];
                if (!updated.some(b => b.id === book.id)) {
                  updated.push(book);
                }
                return updated;
              });

              if (book.extension?.toLowerCase() === "audiobook" && book.audiobookTracks?.length) {
                try {
                  await syncBookToCloud(user?.uid || "", book);
                  await enqueueAudiobookDownload(book.id, book.title, book.audiobookTracks);
                } catch (err) {
                  console.error("Audiobook auto-download failed:", err);
                }
              } else if (book.extension !== "audiobook") {
                setActiveTab("library");
              }
              
              // Enrich metadata in background after addition
              const enriched = await enrichBookMetadata(user?.uid || "", book);
              setBooks(prev => prev.map(b => b.id === enriched.id ? enriched : b));
            }}
            onPlayAudiobook={(book) => {
              setBooks(prev => {
                if (prev.some(b => b.id === book.id)) return prev;
                return [...prev, book];
              });
              if (book.audiobookTracks?.length) {
                syncBookToCloud(user?.uid || "", book).catch(console.error);
                enqueueAudiobookDownload(book.id, book.title, book.audiobookTracks).catch(console.error);
              }
              setActiveBook(book);
              setLastReadBook(book);
              localStorage.setItem("kindle_last_read", JSON.stringify(book));
            }}
            cachedBookIds={cachedBookIds}
            grayscaleCovers={grayscaleCovers}
            initialQuery={discoverInitialQuery}
            onClearInitialQuery={() => setDiscoverInitialQuery(null)}
          />
        )}


        {activeTab === "tools" && (
          <SettingsView
            view="tools"
            user={user}
            userId={user?.uid || ""}
            grayscaleCovers={grayscaleCovers}
            hideCovers={false}
            displayTheme={displayTheme}
            dailyRemindersEnabled={dailyRemindersEnabled}
            onChangeDailyReminders={(enabled) => {
              setDailyRemindersEnabled(enabled);
              localStorage.setItem("kora_daily_reminders", String(enabled));
            }}
            dailyNewsBriefEnabled={dailyNewsBriefEnabled}
            onChangeDailyNewsBrief={handleDailyNewsBriefChange}
            onToggleGrayscale={toggleGrayscale}
            onChangeTheme={(theme) => {
              setDisplayTheme(theme);
              localStorage.setItem("kora_display_theme", theme);
            }}
            onSignOut={handleSignOut}
            onSignIn={() => setShowAuthModal(true)}
            readerPrefs={readerPrefs}
            onReaderPrefsChange={setReaderPrefs}
            searchPrefs={searchPrefs}
            onSearchPrefsChange={setSearchPrefs}
            bookCount={books.length}
            cachedCount={cachedBookIds.size}
            onClearDeviceCache={handleClearDeviceCache}
            onClearRecentSearches={handleClearRecentSearches}
            books={books}
            onRefreshLibrary={() => refreshLibrary()}
            onCachedIdsChanged={updateCachedBookIndex}
            onOpenOnboarding={() => setShowOnboarding(true)}
          />
        )}

        {activeTab === "settings" && (
          <SettingsView
            view="settings" 
            user={user}
            userId={user?.uid || ""}
            grayscaleCovers={grayscaleCovers}
            onToggleGrayscale={toggleGrayscale}
            displayTheme={displayTheme}
            dailyRemindersEnabled={dailyRemindersEnabled}
            onChangeDailyReminders={(enabled) => {
              setDailyRemindersEnabled(enabled);
              localStorage.setItem("kora_daily_reminders", String(enabled));
            }}
            dailyNewsBriefEnabled={dailyNewsBriefEnabled}
            onChangeDailyNewsBrief={handleDailyNewsBriefChange}
            onChangeTheme={changeTheme}
            onSignOut={handleSignOut}
            onSignIn={() => setShowAuthModal(true)}
            readerPrefs={readerPrefs}
            onReaderPrefsChange={setReaderPrefs}
            searchPrefs={searchPrefs}
            onSearchPrefsChange={setSearchPrefs}
            bookCount={books.length}
            cachedCount={cachedBookIds.size}
            onClearDeviceCache={handleClearDeviceCache}
            onClearRecentSearches={handleClearRecentSearches}
            books={books}
            onRefreshLibrary={refreshLibrary}
            onCachedIdsChanged={updateCachedBookIndex}
            onOpenOnboarding={() => setShowOnboarding(true)}
          />
        )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile media dock: mini player (left) + Continue (right), joined as one control */}
      {(() => {
        const showContinueFab = Boolean(lastReadBook && activeTab === "library");
        const showMiniHost = Boolean(
          audiobookPlayback && activeBook?.id !== audiobookPlayback.id
        );
        if (!showContinueFab && !showMiniHost) return null;
        return (
          <div
            className={`md:hidden fixed kora-mobile-media-dock z-[45] flex items-stretch${
              showMiniHost ? " kora-mobile-media-dock--joined" : " justify-end"
            }`}
          >
            {showMiniHost && (
              <div id="kora-audiobook-mini-host" className="min-w-0 flex-1" />
            )}
            {showContinueFab && (
              <button
                type="button"
                onClick={() => handleOpenBook(lastReadBook!)}
                className={
                  showMiniHost
                    ? "kora-continue-attached shrink-0 flex items-center justify-center bg-kindle-text text-kindle-bg transition-transform active:scale-95"
                    : "kora-continue-solo w-14 h-14 bg-kindle-text text-kindle-bg rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 ring-4 ring-kindle-bg"
                }
                title={`Continue Reading: ${lastReadBook!.title}`}
                aria-label={`Continue reading ${lastReadBook!.title}`}
              >
                <Play className="w-6 h-6 ml-1 fill-current" />
              </button>
            )}
          </div>
        );
      })()}

      {/* 3. Full-Screen Reader Component Viewports */}
      {audiobookPlayback && (
          <AudiobookPlayer
            book={audiobookPlayback}
            userId={user?.uid || ""}
            grayscaleCovers={grayscaleCovers}
            viewMode={activeBook?.id === audiobookPlayback.id ? "fullscreen" : "minimized"}
            onMinimize={() => dismissAudiobookFullscreen()}
            onExpand={() => setActiveBook(audiobookPlayback)}
            onClose={handleAudiobookClose}
            onProgressUpdate={(updatedBook) => {
              setBooks((prev) => prev.map((b) => (b.id === updatedBook.id ? updatedBook : b)));
              setLastReadBook(updatedBook);
              setAudiobookPlayback(updatedBook);
              if (activeBook?.id === updatedBook.id) setActiveBook(updatedBook);
              localStorage.setItem("kindle_last_read", JSON.stringify(updatedBook));
            }}
          />
        )}
      {activeBook && activeBook.extension?.toLowerCase() !== "audiobook" && (
        activeBook.extension?.toLowerCase() === "pdf" ? (
          <BookReaderPDF
            book={activeBook}
            userId={user?.uid || ""}
            onClose={dismissReader}
            onProgressUpdate={(updatedBook) => {
              setBooks(prev => prev.map(b => b.id === updatedBook.id ? updatedBook : b));
              setLastReadBook(updatedBook);
              localStorage.setItem("kindle_last_read", JSON.stringify(updatedBook));
            }}
          />
        ) : (activeBook.extension?.toLowerCase() === "epub" || !activeBook.extension) ? (
          <BookReaderEPUB
            book={activeBook}
            userId={user?.uid || ""}
            readerPrefs={readerPrefs}
            onReaderPrefsChange={setReaderPrefs}
            onClose={dismissReader}
            onRefreshLibrary={refreshLibrary}
            onProgressUpdate={(updatedBook) => {
              setBooks(prev => prev.map(b => b.id === updatedBook.id ? updatedBook : b));
              setLastReadBook(updatedBook);
              localStorage.setItem("kindle_last_read", JSON.stringify(updatedBook));
            }}
          />
        ) : ["html", "htm", "json", "txt", "md", "csv"].includes(activeBook.extension?.toLowerCase() || "") ? (
          <BookReaderText
            book={activeBook}
            readerPrefs={readerPrefs}
            onReaderPrefsChange={setReaderPrefs}
            onClose={dismissReader}
           />
        ) : (
          <div className="fixed inset-0 bg-kindle-bg z-[100] flex flex-col items-center justify-center p-8 text-center animate-in zoom-in-95 duration-300">
            <div className="max-w-md space-y-6 bg-kindle-card p-8 rounded-3xl border border-kindle-border shadow-2xl overflow-hidden relative">
              <div className="absolute top-0 left-0 w-full h-1 bg-red-500/30" />
              <div className="pt-4">
                <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-red-500" />
                </div>
                <div className="px-8 pb-2 space-y-2">
                  <h2 className="text-xl font-bold font-lexend text-kindle-text leading-tight line-clamp-2">
                    {(() => {
                      const t = activeBook.title;
                      // Detect duplicate-ish title chunks (e.g. "TitleTitle" or "Title Title")
                      if (t.length > 20) {
                        const mid = Math.floor(t.length / 2);
                        const first = t.slice(0, mid).trim().toLowerCase();
                        const second = t.slice(mid).trim().toLowerCase();
                        if (first === second || second.startsWith(first) || first.startsWith(second)) {
                          return t.slice(0, mid).trim();
                        }
                      }
                      return t;
                    })()}
                  </h2>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-kindle-text/5 border border-kindle-border text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                    <FileText className="w-3 h-3" /> {activeBook.extension?.toUpperCase() || "UNKNOWN"} FORMAT
                  </div>
                </div>
                
                <div className="p-6 bg-kindle-bg/50 border-t border-b border-kindle-border text-left space-y-3">
                  <p className="text-xs text-kindle-text font-medium">
                    The {activeBook.extension?.toUpperCase()} format is not currently supported by Kora's built-in reader engine.
                  </p>
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold text-kindle-text-muted uppercase tracking-wider">Troubleshooting</p>
                    <ul className="text-[11px] text-kindle-text-muted space-y-1 ml-4 list-disc">
                      <li>Kora natively supports <b>EPUB</b> and <b>PDF</b> formats.</li>
                      <li>Text-based formats (TXT, MD, HTML) are supported in draft mode.</li>
                      <li>Try converting your file to <b>EPUB</b> using a tool like Calibre.</li>
                    </ul>
                  </div>
                </div>

                <div className="p-8 flex flex-col gap-3">
                  <div className="flex justify-center">
                    <DownloadBookBtn book={activeBook} />
                  </div>
                  <button 
                    onClick={dismissReader} 
                    className="px-6 py-3 rounded-xl hover:bg-kindle-bg text-[10px] font-bold uppercase tracking-widest transition text-kindle-text-muted hover:text-kindle-text"
                  >
                    Return to Library
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      )}

      {/* Settings Modal */}
      <Toaster position="bottom-center" toastOptions={{
        duration: 5000,
        style: {
          background: 'var(--toast-bg, var(--kindle-card))',
          color: 'var(--kindle-text)',
          border: '1px solid var(--kindle-border)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          fontSize: '11px',
          fontWeight: '700',
          borderRadius: '16px',
          fontFamily: 'var(--font-sans)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          padding: '12px 20px',
          boxShadow: '0 10px 40px -10px rgba(0,0,0,0.25)',
          marginBottom: '60px', // Add margin to avoid overlapping tab bar
        },
        success: {
          iconTheme: {
            primary: '#10b981',
            secondary: '#fff',
          },
        },
        error: {
          iconTheme: {
            primary: '#ef4444',
            secondary: '#fff',
          },
        }
      }} />
      <FluidOverlay
        open={showAuthModal}
        onClose={() => {
          setShowAuthModal(false);
          setAuthError(null);
        }}
        variant="dialog"
        zIndexClassName="z-50"
        panelClassName="p-6 rounded-kindle max-w-sm"
      >
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-sans font-bold text-lg">
                {isSignUp ? "Create Account" : "Sign In"}
              </h3>
              <button 
                onClick={() => {
                  setShowAuthModal(false);
                  setAuthError(null);
                }}
                className="p-2 hover:bg-neutral-100 rounded-xl transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              {authError && (
                <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 font-sans space-y-2">
                  <p>{authError}</p>
                  {authError.toLowerCase().includes("unauthorized-domain") && (
                    <div className="mt-2 p-3 bg-amber-50/80 border border-amber-200/60 text-amber-900 rounded-xl text-[10px] space-y-1 text-left">
                      <p className="font-bold text-amber-800">⚠️ Action Required in Firebase Console:</p>
                      <p>Firebase requires adding your custom domain to its authorized list for Google Sign-In to work. Follow these steps:</p>
                      <ol className="list-decimal pl-4 space-y-1 mt-1 font-medium text-amber-800">
                        <li>Go to your <strong>Firebase Console</strong>.</li>
                        <li>Select <strong>Authentication</strong> &gt; <strong>Settings</strong> &gt; <strong>Authorized domains</strong>.</li>
                        <li>Click <strong>Add domain</strong>.</li>
                        <li>Enter <code className="bg-white/80 px-1 py-0.5 rounded border border-amber-200 font-mono">kora.chaoticstudio.workers.dev</code> (or your current active domain).</li>
                        <li>Click <strong>Add</strong> and try logging in again!</li>
                      </ol>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-kindle-text-muted mb-1.5 font-sans">
                  Email Address
                </label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-3 w-4 h-4 text-kindle-text-muted animate-pulse" />
                  <input
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-kindle-border bg-kindle-bg text-sm focus:outline-none focus:ring-1 focus:ring-kindle-text transition font-sans"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-kindle-text-muted mb-1.5 font-sans">
                  Password
                </label>
                <div className="relative flex items-center">
                  <Key className="absolute left-3 w-4 h-4 text-kindle-text-muted animate-pulse" />
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-kindle-border bg-kindle-bg text-sm focus:outline-none focus:ring-1 focus:ring-kindle-text transition font-sans"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-kindle-text text-kindle-bg hover:bg-opacity-90 rounded-xl text-sm font-bold font-sans transition mt-4"
              >
                {isSignUp ? "Sign Up" : "Sign In"}
              </button>

              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-kindle-border"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-kindle-card px-2 text-kindle-text-muted font-sans font-medium">Or continue with</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full py-2.5 bg-kindle-bg border border-kindle-border text-kindle-text hover:bg-neutral-50 dark:hover:bg-neutral-900 rounded-xl text-sm font-bold font-sans transition flex items-center justify-center gap-2.5 cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google
              </button>

              <div className="text-center mt-4">
                <button
                  type="button"
                  onClick={() => setIsSignUp(!isSignUp)}
                  className="text-xs text-kindle-accent hover:underline font-bold font-sans"
                >
                  {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up"}
                </button>
              </div>
            </form>
      </FluidOverlay>

      {/* 4. Settings Modal */}
      <FluidOverlay
        open={showSettings}
        onClose={() => setShowSettings(false)}
        variant="dialog"
        zIndexClassName="z-50"
        panelClassName="p-6 rounded-kindle max-w-sm"
      >
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-sans font-bold text-lg">Settings</h3>
              <button 
                onClick={() => setShowSettings(false)}
                className="p-2 hover:bg-neutral-100 rounded-xl transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold">Grayscale Covers</h4>
                  <p className="text-[11px] text-kindle-text-muted">Classic e-ink aesthetic for book covers</p>
                </div>
                <button 
                  onClick={toggleGrayscale}
                  className={`w-12 h-6 rounded-full transition-colors relative ${grayscaleCovers ? "bg-kindle-accent" : "bg-neutral-300"}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${grayscaleCovers ? "translate-x-7" : "translate-x-1"}`} />
                </button>
              </div>

              <div className="pt-4 border-t border-kindle-border">
                <h4 className="text-[10px] uppercase tracking-widest font-bold text-kindle-text-muted mb-2">Display Mode</h4>
                <div className="grid grid-cols-3 gap-2">
                  <button className="flex flex-col items-center gap-1 p-2 rounded-xl border border-kindle-border bg-white shadow-xs">
                    <Sun className="w-4 h-4" />
                    <span className="text-[9px] font-bold">Light</span>
                  </button>
                  <button className="flex flex-col items-center gap-1 p-2 rounded-xl border border-transparent hover:border-kindle-border opacity-50">
                    <Moon className="w-4 h-4" />
                    <span className="text-[9px] font-bold">Dark</span>
                  </button>
                  <button className="flex flex-col items-center gap-1 p-2 rounded-xl border border-transparent hover:border-kindle-border opacity-50">
                    <Monitor className="w-4 h-4" />
                    <span className="text-[9px] font-bold">Auto</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-8 text-center">
              <p className="text-[10px] text-kindle-text-muted">v2.4.0 • Kindle Modern Edition</p>
            </div>
      </FluidOverlay>

      {/* 5. Modern Floating Mobile Navigation Bar */}
      <footer className="md:hidden fixed kora-mobile-footer z-50 mx-auto max-w-md bg-kindle-card/90 backdrop-blur-xl border border-kindle-border/80 rounded-2xl shadow-[0_10px_35px_rgba(0,0,0,0.12)] kora-safe-bottom">
        <LayoutGroup id="kora-mobile-tabs">
          <nav className="kora-tab-bar grid grid-cols-4 h-14 px-1.5 py-1" aria-label="Main">
            {MOBILE_TABS.map(({ id, label, Icon }) => {
              const isActive = activeTab === id || (id === "tools" && activeTab === "settings");
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`kora-tab-item relative flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                    isActive ? "text-kindle-text" : "text-kindle-text-muted"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {isActive && (
                    <motion.span
                      layoutId="kora-tab-pill"
                      className="absolute inset-y-0.5 inset-x-0.5 rounded-xl bg-kindle-bg/90 border border-kindle-border/70 shadow-sm"
                      transition={koraSpring}
                    />
                  )}
                  <Icon
                    className={`relative z-[1] w-5 h-5 shrink-0 transition-transform duration-300 ${
                      isActive ? "scale-105" : "opacity-80"
                    }`}
                    strokeWidth={isActive ? 2.25 : 2}
                  />
                  <span className="relative z-[1] text-[8px] font-sans font-bold uppercase tracking-wider leading-none text-center">
                    {label}
                  </span>
                </button>
              );
            })}
          </nav>
        </LayoutGroup>
      </footer>

      {/* 6. Compact Desktop Footer */}
      <footer className="hidden md:block border-t border-kindle-border py-10 px-4 text-center text-[10px] text-kindle-text-muted font-sans mt-auto bg-kindle-bg">
        <div className="flex flex-col items-center gap-4 max-w-2xl mx-auto">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">
            <span className="w-1 h-1 rounded-full bg-kindle-accent animate-pulse" />
            Created from passion by <a href="https://portfolio.chaoticstudio.workers.dev/studio" target="_blank" rel="noopener noreferrer" className="text-kindle-accent hover:underline">chaos.studio.mv</a>
            <span className="w-1 h-1 rounded-full bg-kindle-accent animate-pulse" />
          </div>
          
          <div className="flex items-center gap-4 text-[10px] text-kindle-text-muted font-medium">
            <a href="mailto:chaos.studio.mv@gmail.com" className="hover:text-kindle-text transition">chaos.studio.mv@gmail.com</a>
            <span>•</span>
            <a href="https://t.me/+9609401011" target="_blank" rel="noopener noreferrer" className="hover:text-kindle-text transition">+960 9401011 (Telegram)</a>
            <span>•</span>
            <span className="font-bold tracking-[0.1em] text-kindle-text">chaos.studio</span>
          </div>

          <div className="pt-4 border-t border-kindle-border/50 w-full flex flex-col items-center gap-1">
            <p>© 2026 Kora • Next-Gen Reader</p>
            <p className="font-mono uppercase tracking-[0.2em] opacity-50 text-[9px]">Secure Firestore Cloud Persistence</p>
          </div>
        </div>
      </footer>

      {sharingStatus !== "idle" && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-[999] font-sans text-left">
          <div className="w-full max-w-md bg-kindle-card border border-kindle-border rounded-3xl p-6 shadow-2xl text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-kindle-accent/10 border border-kindle-accent/20 rounded-2xl flex items-center justify-center">
              {sharingStatus === "converting" ? (
                <div className="w-5 h-5 border-3 border-kindle-accent border-t-transparent rounded-full animate-spin" />
              ) : sharingStatus === "success" ? (
                <Zap className="w-6 h-6 text-emerald-500 animate-bounce" />
              ) : (
                <AlertCircle className="w-6 h-6 text-red-500" />
              )}
            </div>

            <div className="space-y-1">
              <h3 className="font-lexend font-bold text-sm text-kindle-text uppercase tracking-wider">
                {sharingStatus === "converting" ? "Converting Shared Webpage" :
                 sharingStatus === "success" ? "Webpage Saved Successfully!" : "Web Conversion Failed"}
              </h3>
              <p className="text-xs text-kindle-text-muted break-all leading-relaxed">
                {sharingStatus === "converting" ? `Saving offline readable version of ${sharingUrl}...` :
                 sharingStatus === "success" ? "The webpage has been converted to an ebook and added to your library." :
                 sharingError || "An unexpected error occurred while converting."}
              </p>
            </div>

            {sharingStatus === "error" && (
              <button
                onClick={() => setSharingStatus("idle")}
                className="w-full py-2.5 bg-kindle-accent text-kindle-bg text-xs font-bold uppercase tracking-wider rounded-xl transition hover:bg-opacity-95"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {/* Daily Motivation Reminder Modal */}
      <DailyReminderModal
        isOpen={showDailyReminder}
        onClose={() => setShowDailyReminder(false)}
        nickname={userNickname}
      />

      {/* Playful Booknerd Onboarding Modal */}
      <OnboardingModal
        isOpen={showOnboarding}
        onComplete={handleOnboardingComplete}
        currentTheme={displayTheme}
        onThemeChange={(newTheme) => changeTheme(newTheme)}
      />
    </div>
  );
}
