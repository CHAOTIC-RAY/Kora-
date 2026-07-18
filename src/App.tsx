import React, { useState, useEffect, useRef } from "react";
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
import { KoraIcon, KoraWordmark } from "./components/KoraLogo";
import KoraLoading from "./components/KoraLoading";
import Quote from "./components/Quote";
import DownloadsManager from "./components/DownloadsManager";
import DownloadBookBtn from "./components/DownloadBookBtn";
import { toast, Toaster } from "react-hot-toast";
import { logger } from "./lib/logger";
import { 
  BookOpen, Search, User as UserIcon, LogOut, Cloud, 
  CloudLightning, Key, Smartphone, Sparkles, LogIn, Mail,
  Settings as SettingsIcon, Moon, Sun, Monitor, Clock, Bookmark,
  Compass, Play, Download, Globe, FileText, AlertCircle, AlertTriangle,
  RefreshCw, Zap, Database, Trash2
} from "lucide-react";

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
  const [activeTab, setActiveTab] = useState<"library" | "discover" | "downloads" | "settings">("library");
  const [activeBook, setActiveBook] = useState<BookMetadata | null>(null);
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
  const [browserInitialUrl, setBrowserInitialUrl] = useState<string | null>(null);

  // Mobile Web App / PWA Share Target state variables
  const [sharingStatus, setSharingStatus] = useState<"idle" | "converting" | "success" | "error">("idle");
  const [sharingUrl, setSharingUrl] = useState<string>("");
  const [sharingError, setSharingError] = useState<string | null>(null);

  // Global Background Downloads State
  const [globalDownloads, setGlobalDownloads] = useState<any[]>(() => {
    const saved = localStorage.getItem("kora_downloads_log");
    return saved ? JSON.parse(saved) : [];
  });

  // Background download handler
  async function startBackgroundDownload(book: any, mirror: any, variant: any) {
    const downloadId = Math.random().toString(36).substring(7);
    const newDl = {
      id: downloadId,
      title: book.title,
      author: book.author || "Unknown",
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
    logger.info(`Starting background download for "${book.title}" by ${book.author || 'Unknown'}. Size: ${variant.size || 'Unknown'}. Mirror: ${mirror.url}`);

    try {
      const proxyUrl = `/api/proxy-file?url=${encodeURIComponent(mirror.url)}`;
      
      const response = await fetch(proxyUrl);
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

            setGlobalDownloads(prev => prev.map(dl => dl.id === downloadId ? { 
              ...dl, 
              percent,
              speed: speedStr,
              transferred: transferredStr,
              eta: etaStr
            } : dl));
          }
        }
      }

      const fileBlob = new Blob(chunks);
      const id = variant.md5 || Math.random().toString(36).substring(7);
      await storeBookFile(id, fileBlob, `${book.title}.${fileExtension}`, fileExtension);

      // Save to library
      const newBook: BookMetadata = {
        id,
        title: book.title,
        author: book.author,
        extension: fileExtension,
        size: variant.size || "Unknown",
        language: variant.language || "English",
        coverUrl: book.coverUrl,
        md5: variant.md5,
        source: "Kora Store",
        tags: inferBookTags(book.title, book.author, fileExtension),
        status: "to-read",
        progress: { percent: 0, lastReadTime: Date.now() },
        dateAdded: Date.now(),
        description: book.description || ""
      };

      await syncBookToCloud(user?.uid || "", newBook);
      
      setGlobalDownloads(prev => {
        const updated = prev.map(dl => dl.id === downloadId ? { ...dl, status: "completed", percent: 100 } : dl);
        localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
        return updated;
      });

      logger.info(`Successfully completed download for "${book.title}". Saved to IndexedDB with ID: ${id}`);
      toast.success(`${book.title} downloaded!`, { id: downloadId });
      refreshLibrary();
    } catch (err: any) {
      logger.error(`Background download failed for "${book.title}". Mirror URL: ${mirror.url}. Error: ${err.message || err}`, err);
      console.error("Background download failed:", err);
      setGlobalDownloads(prev => {
        const updated = prev.map(dl => dl.id === downloadId ? { ...dl, status: "error", error: err.message } : dl);
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

  // Handle physical/native back button and gesture navigation (iOS/Android/Browser edge-swipe or back button)
  useEffect(() => {
    if (activeBook) {
      // Push history state to block native back navigation from leaving the application,
      // converting it into a close-reader command instead.
      window.history.pushState({ isReading: true, bookId: activeBook.id }, "", `#read-${activeBook.id}`);
      
      const handlePopState = (event: PopStateEvent) => {
        if (!event.state || !event.state.isReading) {
          setActiveBook(null);
          refreshLibrary();
        }
      };
      
      window.addEventListener("popstate", handlePopState);
      return () => {
        window.removeEventListener("popstate", handlePopState);
      };
    }
  }, [activeBook]);

  // Keep track of the active tab before transitioning to settings
  const prevTabRef = useRef<"library" | "discover" | "downloads" | "settings">("library");
  useEffect(() => {
    if (activeTab !== "settings") {
      prevTabRef.current = activeTab;
    }
  }, [activeTab]);

  // Handle physical/native back button and gesture navigation for the settings tab on mobile
  const lastTabRef = useRef(activeTab);
  useEffect(() => {
    if (activeTab === "settings") {
      window.history.pushState({ isSettings: true }, "", "#settings");
      
      const handlePopState = (event: PopStateEvent) => {
        if (!event.state || !event.state.isSettings) {
          setActiveTab(prevTabRef.current);
        }
      };
      
      window.addEventListener("popstate", handlePopState);
      return () => {
        window.removeEventListener("popstate", handlePopState);
      };
    } else {
      if (lastTabRef.current === "settings" && window.history.state && window.history.state.isSettings) {
        window.history.back();
      }
    }
    lastTabRef.current = activeTab;
  }, [activeTab]);

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

  // Handle manual login/signup
  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!authEmail.trim() || !authPassword.trim()) return;

    setAuthError(null);
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
    }
  }

  // Handle Google Sign-In
  async function handleGoogleSignIn() {
    setAuthError(null);
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
    if (!cachedBookIds.has(book.id)) {
      if (book.downloadUrl) {
        try {
          alert(`Downloading ${book.title}...`);
          const res = await fetch(book.downloadUrl);
          if (!res.ok) throw new Error("Download failed");
          const blob = await res.blob();
          await storeBookFile(book.id, blob, book.filename || `${book.title}.${book.extension}`, book.extension);
          setCachedBookIds(prev => {
            const next = new Set(prev);
            next.add(book.id);
            return next;
          });
          // Proceed to open
        } catch (err) {
          console.error("Failed to download from downloadUrl", err);
          alert("Failed to download book from its saved URL. Please try again or download manually.");
          return;
        }
      } else {
        alert("This book is currently syncing to this device or requires a manual download. Please wait a moment.");
        return;
      }
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
    <div id="app-root-container" className="min-h-screen flex flex-col font-sans selection:bg-kindle-accent/20 selection:text-kindle-text transition-colors duration-300">
      {/* 1. Global Navigation Header - Kora Style */}
      <header className="border-b border-kindle-border bg-kindle-bg relative md:sticky top-0 z-40 h-16">
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
              id="downloads-tab"
              onClick={() => setActiveTab("downloads")}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-bold font-sans transition-all flex items-center gap-1.5 ${
                activeTab === "downloads" 
                  ? "bg-kindle-card text-kindle-text shadow-xs border border-kindle-border" 
                  : "text-kindle-text-muted hover:text-kindle-text"
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Downloads</span>
            </button>
            <button
              id="settings-tab"
              onClick={() => setActiveTab("settings")}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-bold font-sans transition-all flex items-center gap-1.5 ${
                activeTab === "settings" 
                  ? "bg-kindle-card text-kindle-text shadow-xs border border-kindle-border" 
                  : "text-kindle-text-muted hover:text-kindle-text"
              }`}
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              <span>Settings</span>
            </button>
          </nav>

          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1">
              {loadingAuth ? (
                <div className="w-4 h-4 border-2 border-kindle-accent border-t-transparent rounded-full animate-spin"></div>
              ) : user && !user.isAnonymous ? (
                <button
                  onClick={handleSignOut}
                  className="p-2 text-kindle-text-muted hover:text-red-600 hover:bg-red-50 rounded-xl transition cursor-pointer relative z-40"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="p-2 text-kindle-text-muted hover:text-kindle-text hover:bg-neutral-100 rounded-xl transition cursor-pointer relative z-40"
                  title="Sign In"
                >
                  <UserIcon className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>
        </div>
      </header>

      {/* 2. Main Page View Content */}
      <main className="flex-1 w-full mx-auto pb-20 md:pb-8 max-w-6xl p-4 md:p-8">
        
        {/* Sync loading status indicator */}
        {loadingLibrary && (
          <div className="flex items-center gap-2 text-[10px] text-kindle-text-muted font-mono mb-6 px-2">
            <div className="w-3 h-3 border-2 border-kindle-accent border-t-transparent rounded-full animate-spin"></div>
            <span className="uppercase tracking-widest font-bold">Syncing Library...</span>
          </div>
        )}

        {/* Tab Displays */}
        {activeTab === "library" && (
          <LibraryManager
            userId={user?.uid || ""}
            books={books}
            onBookSelected={handleOpenBook}
            onRefreshLibrary={() => refreshLibrary()}
            cachedBookIds={cachedBookIds}
            onCachedIdsChanged={updateCachedBookIndex}
            grayscaleCovers={grayscaleCovers}
            onSearchTrigger={(query) => {
              setDiscoverInitialQuery(query);
              setActiveTab("discover");
            }}
          />
        )}

        {activeTab === "downloads" && (
          <DownloadsManager 
            userId={user?.uid || ""} 
            downloads={globalDownloads}
            onSetDownloads={(updated: any[]) => {
              setGlobalDownloads(updated);
              localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
            }}
            onRefreshLibrary={() => refreshLibrary()} 
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
              setBrowserInitialUrl(url);
              setActiveTab("downloads");
            }}
            onBookAdded={async (book) => {
              setBooks(prev => {
                const updated = [...prev];
                if (!updated.some(b => b.id === book.id)) {
                  updated.push(book);
                }
                return updated;
              });
              setActiveTab("library");
              
              // Enrich metadata in background after addition
              const enriched = await enrichBookMetadata(user?.uid || "", book);
              setBooks(prev => prev.map(b => b.id === enriched.id ? enriched : b));
            }}
            cachedBookIds={cachedBookIds}
            grayscaleCovers={grayscaleCovers}
            initialQuery={discoverInitialQuery}
            onClearInitialQuery={() => setDiscoverInitialQuery(null)}
          />
        )}


        {activeTab === "settings" && (
          <SettingsView 
            user={user}
            userId={user?.uid || ""}
            grayscaleCovers={grayscaleCovers}
            onToggleGrayscale={toggleGrayscale}
            displayTheme={displayTheme}
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
          />
        )}
      </main>

      {/* Floating Actions for Mobile */}
      <div className="md:hidden fixed bottom-24 right-6 flex flex-col gap-4 z-50">
        {lastReadBook && activeTab === "library" && (
          <button
            onClick={() => handleOpenBook(lastReadBook)}
            className="w-14 h-14 bg-kindle-text text-kindle-bg rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 ring-4 ring-kindle-bg"
            title={`Continue Reading: ${lastReadBook.title}`}
          >
            <Play className="w-6 h-6 ml-1 fill-current" />
          </button>
        )}
      </div>

      {/* 3. Full-Screen Reader Component Viewports */}
      {activeBook && (
        activeBook.extension?.toLowerCase() === "pdf" ? (
          <BookReaderPDF
            book={activeBook}
            userId={user?.uid || ""}
            onClose={() => {
              if (window.history.state && window.history.state.isReading) {
                window.history.back();
              }
              setActiveBook(null);
              refreshLibrary();
            }}
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
            onClose={() => {
              if (window.history.state && window.history.state.isReading) {
                window.history.back();
              }
              setActiveBook(null);
              refreshLibrary();
            }}
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
            onClose={() => {
              if (window.history.state && window.history.state.isReading) {
                window.history.back();
               }
               setActiveBook(null);
               refreshLibrary();
             }}
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
                    onClick={() => {
                      if (window.history.state && window.history.state.isReading) {
                        window.history.back();
                      }
                      setActiveBook(null);
                    }} 
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
          background: 'var(--kindle-card)',
          color: 'var(--kindle-text)',
          border: '1px solid var(--kindle-border)',
          fontSize: '11px',
          fontWeight: '700',
          borderRadius: '16px',
          fontFamily: 'var(--font-sans)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          padding: '12px 20px',
          boxShadow: '0 10px 40px -10px rgba(0,0,0,0.2)',
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
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-sm bg-kindle-card border border-kindle-border rounded-kindle p-6 shadow-2xl text-kindle-text">
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
          </div>
        </div>
      )}

      {/* 4. Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-sm bg-kindle-card border border-kindle-border rounded-kindle p-6 shadow-2xl text-kindle-text">
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
          </div>
        </div>
      )}

      {/* 5. Mobile Native Bottom Navigation Bar */}
      <footer className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-kindle-bg border-t border-kindle-border pb-safe shadow-lg">
        <div className="flex justify-around items-center h-16">
          <button
            onClick={() => setActiveTab("library")}
            className={`flex flex-col items-center justify-center w-20 h-full transition ${
              activeTab === "library" ? "text-kindle-text" : "text-kindle-text-muted"
            }`}
          >
            <BookOpen className={`w-5 h-5 transition-transform duration-150 ${activeTab === "library" ? "scale-110" : ""}`} />
            <span className="text-[9px] font-sans font-bold mt-1 uppercase tracking-widest">Library</span>
          </button>

          <button
            onClick={() => setActiveTab("discover")}
            className={`flex flex-col items-center justify-center w-20 h-full transition ${
              activeTab === "discover" ? "text-kindle-text" : "text-kindle-text-muted"
            }`}
          >
            <Compass className={`w-5 h-5 transition-transform duration-150 ${activeTab === "discover" ? "scale-110" : ""}`} />
            <span className="text-[9px] font-sans font-bold mt-1 uppercase tracking-widest">Discover</span>
          </button>

          <button
            onClick={() => setActiveTab("downloads")}
            className={`flex flex-col items-center justify-center w-20 h-full transition ${
              activeTab === "downloads" ? "text-kindle-text" : "text-kindle-text-muted"
            }`}
          >
            <Download className={`w-5 h-5 transition-transform duration-150 ${activeTab === "downloads" ? "scale-110" : ""}`} />
            <span className="text-[9px] font-sans font-bold mt-1 uppercase tracking-widest">Downloads</span>
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex flex-col items-center justify-center w-20 h-full transition ${
              activeTab === "settings" ? "text-kindle-text" : "text-kindle-text-muted"
            }`}
          >
            <SettingsIcon className={`w-5 h-5 transition-transform duration-150 ${activeTab === "settings" ? "scale-110" : ""}`} />
            <span className="text-[9px] font-sans font-bold mt-1 uppercase tracking-widest">Settings</span>
          </button>
        </div>
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
    </div>
  );
}
