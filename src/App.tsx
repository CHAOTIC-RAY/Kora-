import React, { useState, useEffect, useRef } from "react";
import { 
  auth, 
  isRealFirebase, 
  loadLibrary, 
  BookMetadata, 
  syncBookToCloud 
} from "./lib/firebase";
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
import { getBookFile, clearAllCachedBooks } from "./db/indexedDB";
import LibraryManager from "./components/LibraryManager";
import DiscoverView from "./components/DiscoverView";
import SettingsView from "./components/SettingsView";
import BookReaderEPUB from "./components/BookReaderEPUB";
import BookReaderPDF from "./components/BookReaderPDF";
import { KoraIcon, KoraWordmark } from "./components/KoraLogo";
import KoraLoading from "./components/KoraLoading";
import Quote from "./components/Quote";
import DownloadsManager from "./components/DownloadsManager";
import NotesView from "./components/NotesView";
import HardcoverCommunityTab from "./components/HardcoverCommunityTab";
import { 
  BookOpen, Search, User as UserIcon, LogOut, Cloud, 
  CloudLightning, Key, Smartphone, Sparkles, LogIn, Mail,
  Settings as SettingsIcon, Moon, Sun, Monitor, Clock, Bookmark,
  Compass, Play, Download, MessageSquare, Globe
} from "lucide-react";

export default function App() {
  // Navigation & view states
  const [activeTab, setActiveTab] = useState<"library" | "discover" | "downloads" | "settings" | "notes" | "community">("library");
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
    return saved ? JSON.parse(saved) : {
      fontSize: 18,
      lineSpacing: 1.6,
      fontFamily: "font-serif",
      theme: "light",
      marginSize: "max-w-2xl px-6",
      isContinuous: false,
      brightness: 100,
    };
  });

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

  // 1. Authenticate user anonymously on mount if not logged in
  useEffect(() => {
    // Apply theme to body
    document.body.className = displayTheme;
    if (grayscaleCovers) {
      document.body.classList.add("grayscale-app");
    } else {
      document.body.classList.remove("grayscale-app");
    }
  }, [displayTheme, grayscaleCovers]);

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
  function handleOpenBook(book: BookMetadata) {
    if (book.id === "global-notes") {
      setActiveTab("notes");
      return;
    }
    if (!cachedBookIds.has(book.id)) {
      alert("This book is currently syncing to this device or requires a manual download. Please wait a moment.");
      return;
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
      <header className="border-b border-kindle-border bg-kindle-bg sticky top-0 z-40 h-16">
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
          <div className="flex flex-1 min-w-0 max-w-[130px] xs:max-w-[200px] sm:max-w-xs md:max-w-md lg:max-w-lg">
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
              id="community-tab"
              onClick={() => setActiveTab("community")}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-bold font-sans transition-all flex items-center gap-1.5 ${
                activeTab === "community" 
                  ? "bg-kindle-card text-kindle-text shadow-xs border border-kindle-border" 
                  : "text-kindle-text-muted hover:text-kindle-text"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Community</span>
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
      <main className={`flex-1 w-full mx-auto pb-32 md:pb-8 ${activeTab === 'downloads' ? 'max-w-none p-0' : 'max-w-6xl p-4 md:p-8'}`}>
        
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

        {activeTab === "downloads" && <DownloadsManager />}
        {activeTab === "notes" && <NotesView books={books} userId={user?.uid || ""} onBack={() => setActiveTab("library")} />}
        {activeTab === "community" && <HardcoverCommunityTab />}
        
        {activeTab === "discover" && (
          <DiscoverView
            userId={user?.uid || ""}
            books={books}
            zlibConfig={zlibConfig}
            selectedBook={selectedBookForDownload}
            onSelectedBookChange={setSelectedBookForDownload}
            onOpenBrowser={(url) => {
              setBrowserInitialUrl(url);
              setActiveTab("downloads");
            }}
            onBookAdded={(book) => {
              setBooks(prev => {
                const updated = [...prev];
                if (!updated.some(b => b.id === book.id)) {
                  updated.push(book);
                }
                return updated;
              });
              setActiveTab("library");
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
        activeBook.extension === "pdf" ? (
          <BookReaderPDF
            book={activeBook}
            userId={user?.uid || ""}
            onClose={() => {
              setActiveBook(null);
              refreshLibrary();
            }}
            onProgressUpdate={(updatedBook) => {
              setBooks(prev => prev.map(b => b.id === updatedBook.id ? updatedBook : b));
              setLastReadBook(updatedBook);
              localStorage.setItem("kindle_last_read", JSON.stringify(updatedBook));
            }}
          />
        ) : (
          <BookReaderEPUB
            book={activeBook}
            userId={user?.uid || ""}
            readerPrefs={readerPrefs}
            onClose={() => {
              setActiveBook(null);
              refreshLibrary();
            }}
            onProgressUpdate={(updatedBook) => {
              setBooks(prev => prev.map(b => b.id === updatedBook.id ? updatedBook : b));
              setLastReadBook(updatedBook);
              localStorage.setItem("kindle_last_read", JSON.stringify(updatedBook));
            }}
          />
        )
      )}

      {/* Auth Modal */}
      {showAuthModal && (
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
            onClick={() => setActiveTab("community")}
            className={`flex flex-col items-center justify-center w-20 h-full transition ${
              activeTab === "community" ? "text-kindle-text" : "text-kindle-text-muted"
            }`}
          >
            <MessageSquare className={`w-5 h-5 transition-transform duration-150 ${activeTab === "community" ? "scale-110" : ""}`} />
            <span className="text-[9px] font-sans font-bold mt-1 uppercase tracking-widest">Community</span>
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
      <footer className="hidden md:block border-t border-kindle-border py-8 px-4 text-center text-[10px] text-kindle-text-muted font-sans mt-auto bg-kindle-bg">
        <p>© 2026 Kora • Next-Gen Reader</p>
        <p className="mt-1 font-mono uppercase tracking-widest opacity-60">Secure Firestore Cloud Persistence</p>
      </footer>
    </div>
  );
}
