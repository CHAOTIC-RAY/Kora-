import React, { useState, useEffect } from "react";
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
  User 
} from "firebase/auth";
import { getBookFile } from "./db/indexedDB";
import LibraryManager from "./components/LibraryManager";
import DiscoverView from "./components/DiscoverView";
import SettingsView from "./components/SettingsView";
import BookReaderEPUB from "./components/BookReaderEPUB";
import BookReaderPDF from "./components/BookReaderPDF";
import { KoraIcon, KoraWordmark } from "./components/KoraLogo";
import KoraLoading from "./components/KoraLoading";
import Quote from "./components/Quote";
import DownloadsManager from "./components/DownloadsManager";
import { 
  BookOpen, Search, User as UserIcon, LogOut, Cloud, 
  CloudLightning, Key, Smartphone, Sparkles, LogIn, Mail,
  Settings as SettingsIcon, Moon, Sun, Monitor, Clock, Bookmark,
  Compass, Play, Download, MessageSquare, Globe
} from "lucide-react";

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
  const [connectors, setConnectors] = useState(() => {
    const saved = localStorage.getItem("kora_connectors");
    return saved ? JSON.parse(saved) : {
      annas: true,
      zlib: true,
      openslum: true,
      mangadex: true,
      comicvine: true
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
    localStorage.setItem("kora_connectors", JSON.stringify(connectors));
  }, [connectors]);

  useEffect(() => {
    localStorage.setItem("kora_zlib_config", JSON.stringify(zlibConfig));
  }, [zlibConfig]);

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

  // Handle book selection for reading
  function handleOpenBook(book: BookMetadata) {
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
      <header className="border-b border-kindle-border bg-kindle-bg sticky top-0 z-40 px-4 md:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <KoraIcon className="w-7 h-7 text-kindle-text" />
          <div className="hidden sm:block pr-4 border-r border-kindle-border">
            <KoraWordmark className="h-4 text-kindle-text" />
          </div>
          <Quote />
        </div>

        {/* Tab Controls & Cloud Auth Sync Info */}
        <div className="flex items-center gap-2">
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
        
        {activeTab === "discover" && (
          <DiscoverView
            userId={user?.uid || ""}
            books={books}
            connectors={connectors}
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
                <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 font-sans">
                  {authError}
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
      <footer className="hidden md:block border-t border-kindle-border py-8 px-4 text-center text-[10px] text-kindle-text-muted font-sans mt-auto bg-kindle-bg">
        <p>© 2026 Kora • Next-Gen Reader</p>
        <p className="mt-1 font-mono uppercase tracking-widest opacity-60">Secure Firestore Cloud Persistence</p>
      </footer>
    </div>
  );
}
