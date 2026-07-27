import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen,
  LayoutGrid,
  List,
  Search,
  Cloud,
  RotateCw,
  CheckCircle2,
  Sliders,
  Sparkles,
  Layers,
  Heart,
  Bookmark,
  ExternalLink,
  Volume2,
  Columns2,
  Sun,
  Moon,
  Type,
  Maximize2,
  HardDrive,
  RefreshCw
} from "lucide-react";

// Sample book items for Library Demo
const DEMO_BOOKS = [
  { id: "1", title: "The Purple Land", author: "W. H. Hudson", format: "EPUB", tags: ["Classics", "Adventure"], bgGradient: "from-amber-900/60 to-stone-900", accentColor: "text-amber-400" },
  { id: "2", title: "Essays & Lectures", author: "R. W. Emerson", format: "TXT", tags: ["Philosophy"], bgGradient: "from-emerald-950/70 to-stone-900", accentColor: "text-emerald-400" },
  { id: "3", title: "D'Arblay Mystery", author: "R. A. Freeman", format: "PDF", tags: ["Mystery"], bgGradient: "from-indigo-950/70 to-stone-900", accentColor: "text-indigo-400" },
  { id: "4", title: "Castle Rackrent", author: "Maria Edgeworth", format: "MOBI", tags: ["Classics"], bgGradient: "from-rose-950/70 to-stone-900", accentColor: "text-rose-400" },
  { id: "5", title: "Voyage of Beagle", author: "Charles Darwin", format: "AZW3", tags: ["Science", "Adventure"], bgGradient: "from-cyan-950/70 to-stone-900", accentColor: "text-cyan-400" },
  { id: "6", title: "Education of Adams", author: "Henry Adams", format: "EPUB", tags: ["History"], bgGradient: "from-purple-950/70 to-stone-900", accentColor: "text-purple-400" }
];

export default function FeatureDemosGrid() {
  // Demo 1 State (Library)
  const [libraryView, setLibraryView] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("All");
  const [activeBookId, setActiveBookId] = useState("1");

  // Demo 2 State (Reader Engine)
  const [readerTheme, setReaderTheme] = useState<"paper" | "sepia" | "dark">("paper");
  const [readerColumns, setReaderColumns] = useState<1 | 2>(2);
  const [fontSize, setFontSize] = useState(15);
  const [currentPage, setCurrentPage] = useState(42);

  // Demo 3 State (Cloud Sync)
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeCloud, setActiveCloud] = useState("firestore");
  const [lastSyncedTime, setLastSyncedTime] = useState("Just now");
  const [syncProgress, setSyncProgress] = useState(100);

  // Demo 4 State (Interface & E-Ink)
  const [eInkMode, setEInkMode] = useState<"normal" | "high-contrast" | "e-paper">("e-paper");
  const [isRefreshingScreen, setIsRefreshingScreen] = useState(false);
  const [fontFamily, setFontFamily] = useState("serif");

  const handleSyncNow = () => {
    setIsSyncing(true);
    setSyncProgress(20);
    setTimeout(() => setSyncProgress(65), 400);
    setTimeout(() => setSyncProgress(90), 800);
    setTimeout(() => {
      setSyncProgress(100);
      setIsSyncing(false);
      setLastSyncedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, 1200);
  };

  const handleTriggerRefresh = () => {
    setIsRefreshingScreen(true);
    setTimeout(() => setIsRefreshingScreen(false), 300);
  };

  const filteredBooks = DEMO_BOOKS.filter(b => {
    const matchesSearch = b.title.toLowerCase().includes(searchQuery.toLowerCase()) || b.author.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = selectedTag === "All" || b.tags.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  return (
    <div className="space-y-10 pt-4">
      {/* Header Title */}
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-kindle-accent/10 border border-kindle-accent/20 text-kindle-accent text-[10px] font-bold uppercase tracking-widest">
          <Sparkles className="w-3.5 h-3.5" /> Interactive Feature Demos
        </div>
        <h2 className="text-2xl sm:text-3xl font-serif font-bold text-kindle-text">
          Experience Kora Reader Features Live
        </h2>
        <p className="text-xs sm:text-sm text-kindle-text-muted leading-relaxed">
          Try out key engine components directly inside these interactive app window frames. Click and toggle controls in real-time!
        </p>
      </div>

      {/* 2x2 App Window Mock Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* ==================== CARD 1: Interactive Library & Shelf Management ==================== */}
        <div className="bg-kindle-card border border-kindle-border rounded-3xl overflow-hidden shadow-xl flex flex-col justify-between group hover:border-kindle-accent/40 transition-all duration-300">
          <div className="p-6 space-y-3 border-b border-kindle-border/60">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-kindle-text flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-kindle-accent" /> Custom Library & Shelves
              </h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-kindle-bg text-kindle-accent border border-kindle-border">
                Live Interactive
              </span>
            </div>
            <p className="text-xs text-kindle-text-muted leading-relaxed">
              Organize your collection with instant search, format tags, custom shelves, and seamless Grid or List layout toggles.
            </p>
          </div>

          {/* App Frame Window */}
          <div className="m-4 bg-[#1e1e24] text-gray-200 rounded-2xl overflow-hidden border border-gray-700/80 shadow-2xl flex flex-col h-[380px]">
            {/* macOS Window Titlebar */}
            <div className="bg-[#141418] px-4 py-2.5 border-b border-gray-800 flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <span className="text-[11px] font-medium text-gray-400 ml-2 font-mono">Kora — Library Catalog</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLibraryView("grid")}
                  className={`p-1 rounded transition cursor-pointer ${libraryView === "grid" ? "bg-gray-700 text-white" : "hover:bg-gray-800 text-gray-400"}`}
                  title="Grid View"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryView("list")}
                  className={`p-1 rounded transition cursor-pointer ${libraryView === "list" ? "bg-gray-700 text-white" : "hover:bg-gray-800 text-gray-400"}`}
                  title="List View"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Inner App Canvas */}
            <div className="flex-1 flex overflow-hidden">
              {/* Mini Sidebar */}
              <div className="w-28 bg-[#18181c] border-r border-gray-800 p-3 hidden sm:flex flex-col justify-between text-[10px] text-gray-400">
                <div className="space-y-2">
                  <div className="px-2 py-1 rounded bg-amber-500/10 text-amber-400 font-bold flex items-center gap-1.5">
                    <BookOpen className="w-3 h-3" /> All Books
                  </div>
                  <div className="px-2 py-1 hover:bg-gray-800 rounded transition cursor-pointer flex items-center gap-1.5">
                    <Heart className="w-3 h-3" /> Favorites
                  </div>
                  <div className="px-2 py-1 hover:bg-gray-800 rounded transition cursor-pointer flex items-center gap-1.5">
                    <Bookmark className="w-3 h-3" /> Shelves
                  </div>
                </div>
                <span className="text-[9px] font-mono text-gray-500 text-center">12 Books Total</span>
              </div>

              {/* Main Content Area */}
              <div className="flex-1 p-3.5 flex flex-col space-y-3 overflow-y-auto">
                {/* Search & Filter Bar */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search title, author..."
                      className="w-full bg-[#121215] border border-gray-800 rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-gray-200 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <select
                    value={selectedTag}
                    onChange={(e) => setSelectedTag(e.target.value)}
                    className="bg-[#121215] border border-gray-800 text-gray-300 text-[10px] rounded-lg px-2 py-1.5 focus:outline-none cursor-pointer"
                  >
                    <option value="All">All Genres</option>
                    <option value="Classics">Classics</option>
                    <option value="Adventure">Adventure</option>
                    <option value="Philosophy">Philosophy</option>
                  </select>
                </div>

                {/* Book Grid or List */}
                {libraryView === "grid" ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 overflow-y-auto pr-1">
                    {filteredBooks.map((book) => (
                      <div
                        key={book.id}
                        onClick={() => setActiveBookId(book.id)}
                        className={`p-2 rounded-xl border transition cursor-pointer flex flex-col space-y-1.5 relative group ${
                          activeBookId === book.id
                            ? "bg-amber-500/10 border-amber-500/60 ring-1 ring-amber-500/30"
                            : "bg-[#16161a] border-gray-800 hover:border-gray-700"
                        }`}
                      >
                        <div className={`h-20 bg-gradient-to-br ${book.bgGradient} rounded-lg p-2 flex flex-col justify-between overflow-hidden relative border border-white/10 group-hover:scale-[1.02] transition duration-300`}>
                          <div className="flex items-start justify-between">
                            <BookOpen className={`w-3.5 h-3.5 ${book.accentColor}`} />
                            <span className="bg-black/70 text-[8px] font-mono text-amber-400 font-bold px-1 rounded">
                              {book.format}
                            </span>
                          </div>
                          <span className="text-[9px] font-serif font-bold text-gray-100 line-clamp-2 leading-tight">
                            {book.title}
                          </span>
                        </div>
                        <h4 className="text-[10px] font-bold text-gray-200 truncate">{book.title}</h4>
                        <p className="text-[9px] text-gray-400 truncate">{book.author}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1.5 overflow-y-auto pr-1">
                    {filteredBooks.map((book) => (
                      <div
                        key={book.id}
                        onClick={() => setActiveBookId(book.id)}
                        className={`p-2 rounded-xl border transition cursor-pointer flex items-center justify-between text-[11px] ${
                          activeBookId === book.id
                            ? "bg-amber-500/10 border-amber-500/60 text-white"
                            : "bg-[#16161a] border-gray-800 hover:border-gray-700 text-gray-300"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <BookOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <div className="truncate">
                            <span className="font-bold">{book.title}</span>
                            <span className="text-gray-500 text-[10px] ml-2">— {book.author}</span>
                          </div>
                        </div>
                        <span className="text-[9px] font-mono bg-black/50 text-amber-400 px-1.5 py-0.5 rounded shrink-0">
                          {book.format}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ==================== CARD 2: Extensive Formats & Dual-Column Reader ==================== */}
        <div className="bg-kindle-card border border-kindle-border rounded-3xl overflow-hidden shadow-xl flex flex-col justify-between group hover:border-kindle-accent/40 transition-all duration-300">
          <div className="p-6 space-y-3 border-b border-kindle-border/60">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-kindle-text flex items-center gap-2">
                <Columns2 className="w-4 h-4 text-kindle-accent" /> Multi-Format Reader Engine
              </h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-kindle-bg text-kindle-accent border border-kindle-border">
                EPUB • TXT • PDF • MOBI
              </span>
            </div>
            <p className="text-xs text-kindle-text-muted leading-relaxed">
              Read comfortably with responsive dual-column open book rendering, customizable typography, and theme switching.
            </p>
          </div>

          {/* App Frame Window */}
          <div className="m-4 bg-[#fbf9f4] text-gray-900 rounded-2xl overflow-hidden border border-amber-950/20 shadow-2xl flex flex-col h-[380px] transition-colors duration-300"
               style={{
                 backgroundColor: readerTheme === "sepia" ? "#f4ecd8" : readerTheme === "dark" ? "#18181c" : "#fbf9f4",
                 color: readerTheme === "dark" ? "#e2e2e8" : "#2d2926"
               }}>
            {/* macOS Window Titlebar */}
            <div className={`px-4 py-2.5 border-b flex items-center justify-between select-none ${readerTheme === "dark" ? "bg-[#121215] border-gray-800" : "bg-[#f2eddc] border-amber-900/10"}`}>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <span className={`text-[11px] font-serif font-bold ml-2 ${readerTheme === "dark" ? "text-gray-300" : "text-amber-950"}`}>
                  The Purple Land — Chapter IV
                </span>
              </div>

              {/* Reader Controls Bar */}
              <div className="flex items-center gap-2 text-xs">
                {/* Columns Toggle */}
                <button
                  type="button"
                  onClick={() => setReaderColumns(readerColumns === 1 ? 2 : 1)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition cursor-pointer border ${
                    readerColumns === 2 ? "bg-amber-800 text-white border-amber-800" : "bg-transparent text-amber-900 border-amber-900/30"
                  }`}
                  title="Toggle Columns"
                >
                  {readerColumns} Col
                </button>

                {/* Theme Toggle */}
                <button
                  type="button"
                  onClick={() => setReaderTheme(readerTheme === "paper" ? "sepia" : readerTheme === "sepia" ? "dark" : "paper")}
                  className="p-1 rounded hover:bg-amber-900/10 transition cursor-pointer"
                  title="Cycle Theme"
                >
                  {readerTheme === "dark" ? <Moon className="w-3.5 h-3.5 text-amber-400" /> : <Sun className="w-3.5 h-3.5 text-amber-800" />}
                </button>
              </div>
            </div>

            {/* Book Pages Canvas */}
            <div className="flex-1 p-5 flex flex-col justify-between overflow-hidden">
              <div className={`grid ${readerColumns === 2 ? "grid-cols-2 gap-6" : "grid-cols-1 max-w-lg mx-auto"} h-full text-[11px] leading-relaxed font-serif text-justify`}>
                <div className="space-y-2 overflow-hidden">
                  <p className="first-letter:text-2xl first-letter:font-bold first-letter:float-left first-letter:mr-1.5 first-letter:text-amber-700">
                    We were often told that an author never wholly loses his affection for a first book, and the feeling was true for Hudson's early romance. The Purple Land that England lost was first issued in 1885.
                  </p>
                  <p>
                    A purple land may be a country on a journey from which one has never returned, or a story in which one has spent years of vivid recollection.
                  </p>
                </div>

                {readerColumns === 2 && (
                  <div className="space-y-2 border-l pl-6 border-amber-900/10 overflow-hidden hidden sm:block">
                    <p>
                      Re-reading the book, one feels the intimate freshness of the South American pampas, the wild horses, and the endless horizons of Uruguay.
                    </p>
                    <p className="italic text-opacity-80">
                      "I had left my native shores with a high heart and a spirit ready for any adventure that might await me."
                    </p>
                  </div>
                )}
              </div>

              {/* Page Footer Navigation */}
              <div className={`pt-2 border-t flex items-center justify-between text-[10px] font-mono ${readerTheme === "dark" ? "border-gray-800 text-gray-400" : "border-amber-900/10 text-amber-900/70"}`}>
                <button
                  type="button"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  className="hover:underline cursor-pointer"
                >
                  ‹ Prev Page
                </button>
                <span>Page {currentPage} of 180 (23%)</span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(currentPage + 1)}
                  className="hover:underline cursor-pointer"
                >
                  Next Page ›
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== CARD 3: Cloud Sync & Backup Engine ==================== */}
        <div className="bg-kindle-card border border-kindle-border rounded-3xl overflow-hidden shadow-xl flex flex-col justify-between group hover:border-kindle-accent/40 transition-all duration-300">
          <div className="p-6 space-y-3 border-b border-kindle-border/60">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-kindle-text flex items-center gap-2">
                <Cloud className="w-4 h-4 text-kindle-accent" /> Cloud Sync & Multi-Device Backup
              </h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-kindle-bg text-emerald-600 border border-kindle-border flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live Sync
              </span>
            </div>
            <p className="text-xs text-kindle-text-muted leading-relaxed">
              Backup reading progress, annotations, highlights, and custom collections instantly across devices with Google Firestore or WebDAV.
            </p>
          </div>

          {/* App Frame Window */}
          <div className="m-4 bg-[#1a1b20] text-gray-200 rounded-2xl overflow-hidden border border-gray-800 shadow-2xl flex flex-col h-[380px]">
            {/* macOS Window Titlebar */}
            <div className="bg-[#131418] px-4 py-2.5 border-b border-gray-800 flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <span className="text-[11px] font-medium text-gray-400 ml-2 font-mono">Kora Cloud Engine</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncNow}
                  disabled={isSyncing}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 text-black font-bold text-[10px] uppercase tracking-wider hover:bg-amber-400 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isSyncing ? "animate-spin" : ""}`} />
                  {isSyncing ? "Syncing..." : "Sync Now"}
                </button>
              </div>
            </div>

            {/* Inner Dashboard Canvas */}
            <div className="p-4 space-y-4 flex-1 overflow-y-auto text-xs">
              {/* Storage Providers Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: "firestore", name: "Firestore", status: "Connected", icon: Cloud },
                  { id: "gdrive", name: "Google Drive", status: "Ready", icon: HardDrive },
                  { id: "webdav", name: "WebDAV", status: "Configured", icon: ExternalLink },
                  { id: "local", name: "IndexedDB", status: "Active (Local)", icon: HardDrive },
                ].map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setActiveCloud(p.id)}
                    className={`p-2.5 rounded-xl border cursor-pointer transition flex flex-col space-y-1 ${
                      activeCloud === p.id
                        ? "bg-amber-500/10 border-amber-500/60 ring-1 ring-amber-500/20"
                        : "bg-[#131418] border-gray-800 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p.icon className="w-3.5 h-3.5 text-amber-400" />
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    </div>
                    <span className="font-bold text-[11px] text-gray-200">{p.name}</span>
                    <span className="text-[9px] text-gray-400">{p.status}</span>
                  </div>
                ))}
              </div>

              {/* Progress & Log Console */}
              <div className="bg-[#121215] border border-gray-800 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-gray-400">Sync Status:</span>
                  <span className="text-emerald-400 font-bold">{isSyncing ? "Uploading sync delta..." : "Synced • " + lastSyncedTime}</span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                  <motion.div
                    className="bg-amber-500 h-full rounded-full"
                    animate={{ width: `${syncProgress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>

                {/* Logs Table */}
                <div className="space-y-1.5 text-[10px] font-mono text-gray-400 pt-1 border-t border-gray-800/80">
                  <div className="flex justify-between">
                    <span>✓ Reading progress synced</span>
                    <span className="text-gray-500">24 records</span>
                  </div>
                  <div className="flex justify-between">
                    <span>✓ Bookmarks & Notes payload</span>
                    <span className="text-gray-500">12 notes</span>
                  </div>
                  <div className="flex justify-between">
                    <span>✓ E-Ink custom settings</span>
                    <span className="text-gray-500">1.2 KB</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== CARD 4: Meticulously Designed Interface & E-Ink Canvas ==================== */}
        <div className="bg-kindle-card border border-kindle-border rounded-3xl overflow-hidden shadow-xl flex flex-col justify-between group hover:border-kindle-accent/40 transition-all duration-300">
          <div className="p-6 space-y-3 border-b border-kindle-border/60">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-kindle-text flex items-center gap-2">
                <Sliders className="w-4 h-4 text-kindle-accent" /> E-Ink Display & Contrast Engine
              </h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-kindle-bg text-kindle-accent border border-kindle-border">
                Zero Eye-Strain
              </span>
            </div>
            <p className="text-xs text-kindle-text-muted leading-relaxed">
              Designed specifically for standard screens, color tablets, and high-refresh E-Paper Android devices with custom e-ink refresh modes.
            </p>
          </div>

          {/* App Frame Window */}
          <div className="m-4 bg-white text-black rounded-2xl overflow-hidden border border-gray-300 shadow-2xl flex flex-col h-[380px] relative">
            {/* E-Ink Screen Flash Effect overlay */}
            <AnimatePresence>
              {isRefreshingScreen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 bg-black z-50 pointer-events-none"
                />
              )}
            </AnimatePresence>

            {/* macOS Window Titlebar */}
            <div className="bg-gray-100 px-4 py-2.5 border-b border-gray-300 flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gray-400" />
                <div className="w-3 h-3 rounded-full bg-gray-400" />
                <div className="w-3 h-3 rounded-full bg-gray-400" />
                <span className="text-[11px] font-mono font-bold text-gray-700 ml-2">E-Ink Display Control</span>
              </div>
              <button
                type="button"
                onClick={handleTriggerRefresh}
                className="px-2.5 py-1 bg-black text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-gray-800 transition cursor-pointer flex items-center gap-1"
              >
                <RotateCw className="w-3 h-3" /> E-Ink Flash Refresh
              </button>
            </div>

            {/* Main Interactive Controls + Preview */}
            <div className="p-4 space-y-4 flex-1 flex flex-col justify-between">
              {/* Preset Selector Buttons */}
              <div className="flex items-center justify-between gap-2 border-b pb-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Display Profile:</span>
                <div className="flex gap-1.5">
                  {[
                    { id: "e-paper", name: "E-Paper Soft" },
                    { id: "high-contrast", name: "High Contrast Ink" },
                    { id: "normal", name: "Regular Display" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setEInkMode(m.id as any);
                        handleTriggerRefresh();
                      }}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition cursor-pointer border ${
                        eInkMode === m.id
                          ? "bg-black text-white border-black"
                          : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
                      }`}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Sample Preview Canvas */}
              <div
                className={`p-4 rounded-xl border space-y-2 flex-1 flex flex-col justify-center transition-all ${
                  eInkMode === "high-contrast"
                    ? "bg-white text-black border-black font-serif contrast-200"
                    : eInkMode === "e-paper"
                    ? "bg-[#faf8f5] text-[#222] border-gray-300 font-serif"
                    : "bg-gray-50 text-gray-800 border-gray-200 font-sans"
                }`}
              >
                <div className="text-[9px] uppercase tracking-widest font-mono text-gray-500">Live Typography Sample</div>
                <h4 className="text-sm font-bold leading-tight">
                  "Reading is to the mind what exercise is to the body."
                </h4>
                <p className="text-[11px] leading-relaxed opacity-90">
                  Kora's optical engine dynamically eliminates blur, optimizes baseline padding, and reduces screen ghosting on E-Ink devices.
                </p>
              </div>

              {/* Font Selector Footer */}
              <div className="flex items-center justify-between text-[10px] font-mono text-gray-600 pt-2 border-t border-gray-200">
                <span>Font: <strong className="text-black uppercase">{fontFamily}</strong></span>
                <div className="flex items-center gap-1">
                  {["serif", "sans-serif", "monospace"].map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFontFamily(f)}
                      className={`px-2 py-0.5 rounded capitalize ${fontFamily === f ? "bg-black text-white font-bold" : "hover:bg-gray-200 text-gray-700"}`}
                    >
                      {f.replace("-serif", "")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
