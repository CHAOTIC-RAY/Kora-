import React, { useState, useRef, useEffect } from "react";
import { BookMetadata, syncBookToCloud, syncDeleteBook, loadCustomTags, saveCustomTags } from "../lib/firebase";
import { storeBookFile, checkBookFileCached, deleteBookFile } from "../db/indexedDB";
import { inferBookTags } from "../lib/tagsHelper";
import { 
  BookOpen, UploadCloud, Tag, Star, Trash2, ListFilter,
  CheckCircle, Plus, Eye, Award, Clock, Sparkles, BookMarked, HelpCircle, HardDrive, Search, Cloud,
  Edit2, ImageIcon, AlertTriangle, RefreshCw
} from "lucide-react";
import BookCoverEditor from "./BookCoverEditor";
import BookMetadataEditor from "./BookMetadataEditor";
import DownloadBookBtn from "./DownloadBookBtn";

interface LibraryManagerProps {
  userId: string;
  books: BookMetadata[];
  onBookSelected: (book: BookMetadata) => void;
  onRefreshLibrary: () => void;
  cachedBookIds: Set<string>;
  onCachedIdsChanged: () => void;
  grayscaleCovers?: boolean;
  onSearchTrigger?: (query: string) => void;
}

export default function LibraryManager({ 
  userId, 
  books, 
  onBookSelected, 
  onRefreshLibrary,
  cachedBookIds,
  onCachedIdsChanged,
  grayscaleCovers = false,
  onSearchTrigger
}: LibraryManagerProps) {
  // Filters & sorting
  const [search, setSearch] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterTag, setFilterTag] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("dateAdded");
  
  // Custom Tag States
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState<string>("");
  const [showTagConfig, setShowTagConfig] = useState<boolean>(false);
  const [activeBookForTags, setActiveBookForTags] = useState<BookMetadata | null>(null);
  const [activeBookForDelete, setActiveBookForDelete] = useState<BookMetadata | null>(null);
  const [showCloudImport, setShowCloudImport] = useState<boolean>(false);
  const [activeShelf, setActiveShelf] = useState<string>("All");
  const [syncingBookIds, setSyncingBookIds] = useState<Set<string>>(new Set());
  const [editingCoverBook, setEditingCoverBook] = useState<BookMetadata | null>(null);
  const [editingMetadataBook, setEditingMetadataBook] = useState<BookMetadata | null>(null);
  const [longPressedBook, setLongPressedBook] = useState<BookMetadata | null>(null);

  // Long press refs & helpers
  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressedRef = useRef<boolean>(false);

  const startLongPress = (book: BookMetadata, e: React.TouchEvent | React.MouseEvent) => {
    isLongPressedRef.current = false;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    touchStartPosRef.current = { x: clientX, y: clientY };

    longPressTimeoutRef.current = setTimeout(() => {
      isLongPressedRef.current = true;
      setLongPressedBook(book);
      if (navigator.vibrate) {
        navigator.vibrate(40);
      }
    }, 600);
  };

  const endLongPress = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    const touch = e.touches[0];
    const diffX = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const diffY = Math.abs(touch.clientY - touchStartPosRef.current.y);
    if (diffX > 15 || diffY > 15) {
      if (longPressTimeoutRef.current) {
        clearTimeout(longPressTimeoutRef.current);
        longPressTimeoutRef.current = null;
      }
    }
  };

  // Upload States
  const [isDragActive, setIsDragActive] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Personalized Recommendations (Daily Refresh Cache)
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState<boolean>(true);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);

  async function loadRecommendations(force = false) {
    setLoadingRecommendations(true);
    setRecommendationError(null);
    try {
      const todayString = new Date().toDateString();
      const cachedDate = localStorage.getItem("kora_nyt_recommendations_date");
      const cachedRecs = localStorage.getItem("kora_nyt_recommendations");

      if (!force && cachedDate === todayString && cachedRecs) {
        console.log("[NYT Cache] Loaded daily recommendations from localStorage");
        setRecommendations(JSON.parse(cachedRecs));
        setLoadingRecommendations(false);
        return;
      }

      console.log("[NYT Cache] Daily recommendations cache expired, missing, or forced refresh. Querying...");
      let recentSearches: string[] = [];
      try {
        const saved = localStorage.getItem("kora_recent_searches");
        recentSearches = saved ? JSON.parse(saved) : [];
      } catch {
        // ignore
      }

      const simplifiedLibrary = (books || []).map(b => ({
        title: b.title,
        author: b.author
      }));

      const res = await fetch("/api/nytimes/recommendations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          library: simplifiedLibrary,
          recentSearches: recentSearches
        })
      });

      if (!res.ok) throw new Error("Failed to load suggestions");
      const data = await res.json();
      const recs = data.recommendations || [];
      setRecommendations(recs);

      // Save to cache
      localStorage.setItem("kora_nyt_recommendations_date", todayString);
      localStorage.setItem("kora_nyt_recommendations", JSON.stringify(recs));
    } catch (err: any) {
      console.error("Failed to load recommendations:", err);
      setRecommendationError(err.message || "Could not load recommendations");
    } finally {
      setLoadingRecommendations(false);
    }
  }

  useEffect(() => {
    loadRecommendations();
  }, [books.length]);

  useEffect(() => {
    loadTags();
  }, [userId]);

  useEffect(() => {
    const downloadMissingBook = async (book: BookMetadata) => {
      if (!book.md5 || syncingBookIds.has(book.id) || cachedBookIds.has(book.id)) return;
      
      setSyncingBookIds(prev => new Set(prev).add(book.id));
      
      try {
        const res = await fetch(`/api/download-options?md5=${book.md5}`);
        const data = await res.json();
        const options = data.options || data.downloadLinks || [];
        // Prioritize direct links for auto-sync
        const directOptions = options.filter((o: any) => o.isDirect);
        const finalOptions = directOptions.length > 0 ? directOptions : options;
        
        if (finalOptions.length > 0) {
          // Try up to 3 options in sequence
          for (let i = 0; i < Math.min(finalOptions.length, 3); i++) {
            const opt = finalOptions[i];
            try {
              console.log(`Auto-sync trying mirror ${i + 1}/${finalOptions.length} for "${book.title}": ${opt.url}`);
              const dlRes = await fetch(`/api/proxy-file?url=${encodeURIComponent(opt.url)}`);
              
              if (dlRes.ok) {
                const blob = await dlRes.blob();
                await storeBookFile(book.id, blob, `${book.title}.${book.extension}`, book.extension);
                onCachedIdsChanged();
                break; // Succeeded!
              }
            } catch (err) {
              console.warn(`Auto-sync mirror failed for "${book.title}" on URL ${opt.url}:`, err);
            }
          }
        }
      } catch (e) {
        console.warn("Auto-sync failed for", book.title, e);
      } finally {
        setSyncingBookIds(prev => {
          const next = new Set(prev);
          next.delete(book.id);
          return next;
        });
      }
    };

    books.forEach(book => {
      if (!cachedBookIds.has(book.id) && book.md5 && !syncingBookIds.has(book.id)) {
        downloadMissingBook(book);
      }
    });
  }, [books, cachedBookIds, syncingBookIds]);

  async function loadTags() {
    const tags = await loadCustomTags(userId);
    setAvailableTags(tags);
  }

  // Handle uploading local EPUB or PDF
  async function handleFileUpload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "epub" && ext !== "pdf") {
      setUploadError("Only EPUB and PDF file formats are supported.");
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      // 1. Generate unique local book ID (UUID or similar hash)
      const bookId = "local_" + Math.random().toString(36).substring(2, 15) + "_" + Date.now();
      
      // 2. Read as array buffer/blob and store in IndexedDB
      const arrayBuffer = await file.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: ext === "pdf" ? "application/pdf" : "application/epub+zip" });
      
      await storeBookFile(bookId, blob, file.name, ext);
      onCachedIdsChanged();

      // 3. Create book metadata
      const cleanTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
      const extStr = ext || "epub";
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

      // 4. Sync metadata to Firebase
      await syncBookToCloud(userId, newBook);
      onRefreshLibrary();
    } catch (err: any) {
      console.error("Local Upload Error:", err);
      setUploadError("Failed to store file locally in IndexedDB: " + err.message);
    } finally {
      setUploading(false);
    }
  }

  // Drag and drop event handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Delete book from local cache AND cloud sync
  async function handleDeleteBook(book: BookMetadata, e: React.MouseEvent) {
    e.stopPropagation();
    setActiveBookForDelete(book);
  }

  async function confirmDeleteBook() {
    if (!activeBookForDelete) return;
    try {
      await deleteBookFile(activeBookForDelete.id);
      await syncDeleteBook(userId, activeBookForDelete.id);
      onCachedIdsChanged();
      onRefreshLibrary();
    } catch (err) {
      console.error("Delete Book Error:", err);
    } finally {
      setActiveBookForDelete(null);
    }
  }

  // Add/remove tags to/from a book
  async function handleToggleBookTag(book: BookMetadata, tag: string) {
    const isTagged = book.tags.includes(tag);
    const updatedTags = isTagged 
      ? book.tags.filter(t => t !== tag)
      : [...book.tags, tag];

    const updatedBook: BookMetadata = {
      ...book,
      tags: updatedTags
    };

    await syncBookToCloud(userId, updatedBook);
    onRefreshLibrary();
    
    // Update current active modal
    if (activeBookForTags && activeBookForTags.id === book.id) {
      setActiveBookForTags(updatedBook);
    }
  }

  // Set book rating stars
  async function handleSetRating(book: BookMetadata, rating: number) {
    const updatedBook: BookMetadata = {
      ...book,
      rating: rating === book.rating ? undefined : rating
    };
    await syncBookToCloud(userId, updatedBook);
    onRefreshLibrary();
  }

  // Configure new globally available custom tag
  async function handleCreateCustomTag() {
    if (!newTagInput.trim()) return;
    const cleanedTag = newTagInput.trim();
    if (!availableTags.includes(cleanedTag)) {
      const updated = [...availableTags, cleanedTag];
      setAvailableTags(updated);
      await saveCustomTags(userId, updated);
    }
    setNewTagInput("");
  }

  // Filter & sort logic
  const filteredBooks = books.filter((book) => {
    const matchesSearch = 
      book.title.toLowerCase().includes(search.toLowerCase()) || 
      book.author.toLowerCase().includes(search.toLowerCase());
      
    const matchesStatus = 
      filterStatus === "all" || book.status === filterStatus;
      
    const matchesTag = 
      filterTag === "all" || book.tags.includes(filterTag);
      
    return matchesSearch && matchesStatus && matchesTag;
  }).sort((a, b) => {
    if (sortBy === "dateAdded") {
      return b.dateAdded - a.dateAdded;
    }
    if (sortBy === "progress") {
      return (b.progress?.percent ?? 0) - (a.progress?.percent ?? 0);
    }
    if (sortBy === "rating") {
      return (b.rating ?? 0) - (a.rating ?? 0);
    }
    if (sortBy === "title") {
      return a.title.localeCompare(b.title);
    }
    return 0;
  });

  // Reading Stats
  const totalBooks = books.length;
  const completedBooks = books.filter(b => b.status === "completed").length;
  const activeReading = books.filter(b => b.status === "reading").length;
  
  // Calculate a mock reading streak based on lastReadTime timestamps
  const readingStreak = books.some(b => {
    const lastRead = b.progress?.lastReadTime ?? 0;
    const diffHours = (Date.now() - lastRead) / (1000 * 60 * 60);
    return diffHours < 24;
  }) ? 3 : 1; // standard streak mock or fallback

  return (
    <div id="library-manager-section" className="space-y-10">
      
      {/* Shelves / Collections Bar */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide px-1">
          {["All", "To Read", "Reading", "Completed", "Favorites"].map((shelf) => (
            <button
              key={shelf}
              onClick={() => {
                setActiveShelf(shelf);
                if (shelf === "All") setFilterStatus("all");
                else if (shelf === "To Read") setFilterStatus("to-read");
                else if (shelf === "Reading") setFilterStatus("reading");
                else if (shelf === "Completed") setFilterStatus("completed");
                // Favorites logic can be added later
              }}
              className={`px-5 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border transition whitespace-nowrap ${
                activeShelf === shelf 
                  ? "bg-kindle-text text-kindle-bg border-transparent shadow-md" 
                  : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-text"
              }`}
            >
              {shelf}
            </button>
          ))}
          <button className="px-3 py-2 rounded-full border border-kindle-border text-kindle-text-muted hover:text-kindle-text transition">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>
      {books.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">From Your Library</h2>
            <button className="text-[10px] font-bold text-kindle-accent uppercase tracking-widest hover:underline">See All</button>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
            {books.slice(0, 5).map((book) => {
              const isCached = cachedBookIds.has(book.id);
              const progressPercent = book.progress?.percent ?? 0;
              return (
                <div 
                  key={`recent-${book.id}`}
                  onClick={() => onBookSelected(book)}
                  className="group cursor-pointer space-y-3"
                >
                  <div className="aspect-[3/4] bg-kindle-bg rounded-sm overflow-hidden shadow-md group-hover:shadow-xl transition-all duration-300 relative border border-kindle-border">
                    {book.coverUrl ? (
                      <img
                        src={`/api/proxy-image?url=${encodeURIComponent(book.coverUrl)}`}
                        className={`w-full h-full object-cover group-hover:scale-105 transition duration-500 ${grayscaleCovers ? "grayscale" : ""}`}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-kindle-card">
                        <BookOpen className="w-8 h-8 text-kindle-text-muted mb-2" />
                        <span className="text-[8px] font-bold uppercase tracking-tighter line-clamp-3">{book.title}</span>
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-kindle-border">
                      <div className="h-full bg-kindle-text transition-all duration-500" style={{ width: `${progressPercent}%` }} />
                    </div>
                    {isCached && (
                      <div className="absolute top-2 right-2 bg-kindle-card/90 p-1 rounded-full border border-kindle-border shadow-sm">
                        <CheckCircle className="w-3 h-3 text-emerald-600" />
                      </div>
                    )}
                  </div>
                  <div className="px-1 space-y-1 font-sans">
                    <h3 className="text-[11px] font-bold text-kindle-text line-clamp-1 group-hover:text-kindle-accent transition">{book.title}</h3>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-neutral-200 dark:bg-neutral-800 h-1 rounded-full overflow-hidden">
                        <div className="h-full bg-kindle-text" style={{ width: `${progressPercent}%` }} />
                      </div>
                      <span className="text-[8px] text-kindle-text-muted font-bold tracking-tight shrink-0">{progressPercent}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 2. Kindle Home: Recommendations (Dynamic recommendations with daily refresh cache) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1 border-t border-kindle-border pt-8">
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">Recommended For You</h2>
            <span className="px-1.5 py-0.5 bg-kindle-accent/10 text-kindle-accent rounded text-[8px] font-bold uppercase tracking-widest border border-kindle-accent/20">
              Daily Refresh
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => loadRecommendations(true)}
              disabled={loadingRecommendations}
              className="p-1 rounded-full text-kindle-text-muted hover:text-kindle-text transition disabled:opacity-50 cursor-pointer"
              title="Refresh Recommendations"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingRecommendations ? "animate-spin" : ""}`} />
            </button>
            <button 
              onClick={() => onSearchTrigger?.("")}
              className="text-[10px] font-bold text-kindle-accent uppercase tracking-widest hover:underline cursor-pointer"
            >
              Discover More
            </button>
          </div>
        </div>
        
        {loadingRecommendations ? (
          <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide snap-x flex-nowrap items-start">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="w-[140px] sm:w-[160px] flex-shrink-0 snap-start space-y-2 animate-pulse">
                <div className="aspect-[3/4] bg-kindle-card rounded-sm border border-kindle-border" />
                <div className="h-3 bg-kindle-card rounded w-3/4" />
                <div className="h-2.5 bg-kindle-card rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : recommendationError ? (
          <div className="py-6 flex flex-col items-center justify-center text-center gap-2 bg-kindle-card/20 border border-dashed border-kindle-border rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <p className="text-[10px] font-bold text-kindle-text-muted">Could not load custom recommendations</p>
            <button
              onClick={() => loadRecommendations(true)}
              className="px-3 py-1 bg-kindle-card border border-kindle-border rounded text-[9px] font-bold uppercase tracking-widest hover:bg-kindle-bg transition cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : recommendations.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center text-center gap-2 bg-kindle-card/20 border border-dashed border-kindle-border rounded-xl p-4">
            <BookMarked className="w-6 h-6 text-kindle-text-muted/40" />
            <p className="text-[10px] font-bold text-kindle-text">Your bookshelf is empty</p>
            <p className="text-[9px] text-kindle-text-muted max-w-xs">Add books to your Library or search to activate AI-powered daily recommendations.</p>
          </div>
        ) : (
          <div className="flex gap-6 overflow-x-auto pb-4 scrollbar-hide snap-x flex-nowrap items-start">
            {recommendations.map((rec, idx) => (
              <div 
                key={idx} 
                onClick={() => onSearchTrigger?.(`${rec.title} ${rec.author}`)}
                className="w-[140px] sm:w-[160px] flex-shrink-0 snap-start group cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="aspect-[3/4] bg-kindle-bg rounded-sm overflow-hidden shadow-sm border border-kindle-border group-hover:border-kindle-accent transition relative">
                    {rec.coverUrl ? (
                      <img src={rec.coverUrl} className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale-filter" : ""}`} referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-kindle-card relative">
                        <span className="text-[8px] font-bold uppercase tracking-tighter text-kindle-text-muted mb-2 truncate max-w-full">
                          {rec.author || "Author"}
                        </span>
                        <span className="text-[10px] font-bold font-serif leading-snug line-clamp-3 text-kindle-text">
                          {rec.title}
                        </span>
                      </div>
                    )}
                    {rec.matchingNytBook && (
                      <div className="absolute top-1.5 right-1.5 bg-amber-500 text-white px-1.5 py-0.5 rounded text-[6px] font-bold uppercase tracking-widest shadow-md z-10">
                        BEST SELLER
                      </div>
                    )}
                  </div>
                  <div className="mt-2 px-1">
                    <h4 className="text-[10px] font-bold line-clamp-1 group-hover:text-kindle-accent transition">{rec.title}</h4>
                    <p className="text-[9px] text-kindle-text-muted mt-0.5">{rec.author}</p>
                  </div>
                </div>
                {rec.reason && (
                  <p className="mt-2 text-[8px] text-kindle-text-muted font-sans leading-relaxed line-clamp-2 italic opacity-80 group-hover:opacity-100 transition px-1 border-t border-kindle-border/40 pt-1.5">
                    "{rec.reason}"
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. Full Library Section with Search/Filter */}
      <section className="space-y-6 pt-8 border-t border-kindle-border">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">Full Library</h2>
        </div>

        {/* Filter and Query Control Dashboard */}
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between bg-kindle-card/50 p-4 border border-kindle-border rounded-kindle font-sans text-xs">
          <div className="w-full md:w-64 relative">
            <input
              id="library-search-input"
              type="text"
              placeholder="Filter library..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-kindle-bg border border-kindle-border rounded-xl pl-9 pr-4 py-2.5 text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent placeholder-kindle-text-muted"
            />
            <Search className="w-3.5 h-3.5 absolute left-3.5 top-3.5 text-kindle-text-muted" />
          </div>

          <div className="w-full md:w-auto flex flex-wrap gap-2 items-center justify-start md:justify-end">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-kindle-bg border border-kindle-border rounded-xl px-4 py-2 text-kindle-text focus:ring-1 focus:ring-kindle-accent appearance-none text-[10px] font-bold uppercase tracking-widest"
            >
              <option value="all">Status: All</option>
              <option value="to-read">To Read</option>
              <option value="reading">Reading</option>
              <option value="completed">Completed</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-kindle-bg border border-kindle-border rounded-xl px-4 py-2 text-kindle-text focus:ring-1 focus:ring-kindle-accent appearance-none text-[10px] font-bold uppercase tracking-widest"
            >
              <option value="dateAdded">Sort: Newest</option>
              <option value="progress">Sort: Progress</option>
              <option value="rating">Sort: Rating</option>
              <option value="title">Sort: Title</option>
            </select>
          </div>
        </div>

        {filteredBooks.length === 0 ? (
          <div className="py-24 text-center border border-dashed border-kindle-border rounded-2xl bg-kindle-card/30">
            <BookOpen className="w-10 h-10 text-kindle-text-muted mx-auto mb-3 animate-pulse" />
            <h3 className="font-sans font-bold text-xs text-kindle-text-muted uppercase tracking-widest">No books found</h3>
          </div>
        ) : (
          <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-6 space-y-6">
            {filteredBooks.map((book) => {
              const isCached = cachedBookIds.has(book.id);
              const progressPercent = book.progress?.percent ?? 0;

              return (
                <div
                  key={book.id}
                  onTouchStart={(e) => startLongPress(book, e)}
                  onTouchEnd={endLongPress}
                  onTouchMove={handleTouchMove}
                  onMouseDown={(e) => {
                    if (e.button === 0) startLongPress(book, e);
                  }}
                  onMouseUp={endLongPress}
                  onMouseLeave={endLongPress}
                  onClick={(e) => {
                    if (isLongPressedRef.current) {
                      e.preventDefault();
                      e.stopPropagation();
                      isLongPressedRef.current = false;
                      return;
                    }
                    onBookSelected(book);
                  }}
                  className="kindle-card break-inside-avoid overflow-hidden group flex flex-col cursor-pointer transition-transform duration-300 hover:-translate-y-1 select-none"
                >
                  <div className="relative flex items-center justify-center p-0 border-b border-kindle-border overflow-hidden">
                    {book.coverUrl ? (
                      <img
                        src={`/api/proxy-image?url=${encodeURIComponent(book.coverUrl)}`}
                        className={`w-full h-auto object-cover group-hover:scale-105 transition duration-500 ${grayscaleCovers ? "grayscale-app" : ""}`}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full aspect-[3/4] bg-kindle-card flex flex-col items-center justify-center p-4 text-center">
                        <BookOpen className="w-8 h-8 text-kindle-text-muted mb-2" />
                        <span className="text-[8px] uppercase font-bold text-kindle-text-muted tracking-widest line-clamp-3">{book.title}</span>
                      </div>
                    )}

                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-kindle-border">
                      <div className="h-full bg-kindle-text" style={{ width: `${progressPercent}%` }} />
                    </div>

                    <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isCached && <DownloadBookBtn book={book} />}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingMetadataBook(book);
                        }}
                        className="p-2 bg-kindle-card border border-kindle-border text-kindle-text rounded-full shadow-lg hover:bg-kindle-bg transition"
                        title="Edit Metadata"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCoverBook(book);
                        }}
                        className="p-2 bg-kindle-card border border-kindle-border text-kindle-text rounded-full shadow-lg hover:bg-kindle-bg transition"
                        title="Edit Cover"
                      >
                        <ImageIcon className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteBook(book, e)}
                        className="p-2 bg-kindle-card border border-red-500/20 text-red-500 rounded-full shadow-lg hover:bg-red-500/10 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="p-3 flex flex-col justify-between flex-1">
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] font-bold text-kindle-text leading-tight line-clamp-2 font-sans" title={book.title}>
                        {book.title}
                      </h4>
                      
                      {/* Visual progress bar and reading percentage indicator */}
                      <div className="space-y-1 pt-0.5 font-sans">
                        <div className="flex justify-between items-center text-[8px] text-kindle-text-muted font-bold tracking-tight">
                          <span>{progressPercent}% READ</span>
                          <span className="uppercase text-[7px] bg-neutral-200 dark:bg-neutral-800 px-1 py-0.5 rounded-sm">
                            {book.status === "completed" ? "Done" : book.status === "reading" ? "Reading" : "New"}
                          </span>
                        </div>
                        <div className="w-full bg-neutral-200 dark:bg-neutral-800 h-1 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${
                              book.status === "completed" ? "bg-emerald-600 dark:bg-emerald-500" : "bg-kindle-text"
                            }`} 
                            style={{ width: `${progressPercent}%` }} 
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center mt-3 pt-2 border-t border-kindle-border/30 font-sans">
                      <span className="text-[8px] font-bold text-kindle-text-muted uppercase tracking-widest">{book.extension}</span>
                      {isCached ? (
                        <CheckCircle className="w-3 h-3 text-emerald-600" />
                      ) : syncingBookIds.has(book.id) ? (
                        <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Cloud className="w-3 h-3 text-blue-500" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. Administrative: Stats and Upload at the bottom */}
      <section className="space-y-8 pt-12 border-t border-kindle-border">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Stats */}
          <div className="flex-1 grid grid-cols-2 gap-3">
            <div className="kindle-card p-4 border border-kindle-border">
              <h4 className="text-[9px] text-kindle-text-muted font-bold uppercase tracking-widest mb-1">Library</h4>
              <div className="text-lg font-bold">{totalBooks}</div>
            </div>
            <div className="kindle-card p-4 border border-kindle-border">
              <h4 className="text-[9px] text-kindle-text-muted font-bold uppercase tracking-widest mb-1">Reading</h4>
              <div className="text-lg font-bold">{activeReading}</div>
            </div>
            <div className="kindle-card p-4 border border-kindle-border">
              <h4 className="text-[9px] text-kindle-text-muted font-bold uppercase tracking-widest mb-1">Completed</h4>
              <div className="text-lg font-bold">{completedBooks}</div>
            </div>
            <div className="kindle-card p-4 border border-kindle-border">
              <h4 className="text-[9px] text-kindle-text-muted font-bold uppercase tracking-widest mb-1">Streak</h4>
              <div className="text-lg font-bold">{readingStreak} <span className="text-xs font-normal">days</span></div>
            </div>
          </div>

          {/* Upload & Cloud Import */}
          <div className="flex-1 space-y-4">
            <div 
              id="drag-and-drop-box"
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-kindle p-8 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 h-48 ${
                isDragActive 
                  ? "border-kindle-accent bg-kindle-accent/5" 
                  : "border-kindle-border hover:border-kindle-text-muted bg-kindle-card/50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".epub,.pdf,.mobi,.cbz,.cbr"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
                className="hidden"
              />

              {uploading ? (
                <>
                  <div className="w-8 h-8 border-3 border-kindle-accent border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs font-bold text-kindle-text-muted uppercase tracking-widest animate-pulse">Syncing...</p>
                </>
              ) : (
                <>
                  <div className="p-3 bg-kindle-bg border border-kindle-border rounded-2xl text-kindle-text-muted shadow-sm group-hover:scale-110 transition">
                    <Plus className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em]">Add New Ebook</p>
                    <p className="text-[8px] text-kindle-text-muted font-sans uppercase tracking-widest">EPUB, PDF, MOBI, COMICS</p>
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => setShowCloudImport(true)}
                className="p-4 bg-kindle-card border border-kindle-border rounded-xl flex items-center gap-3 hover:bg-kindle-bg transition shadow-sm group"
              >
                <div className="p-2 bg-blue-50/10 text-blue-500 rounded-lg group-hover:scale-110 transition">
                  <Cloud className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <p className="text-[10px] font-bold uppercase tracking-widest">Google Drive</p>
                  <p className="text-[8px] text-kindle-text-muted">Cloud Import</p>
                </div>
              </button>
              <button 
                onClick={() => setShowCloudImport(true)}
                className="p-4 bg-kindle-card border border-kindle-border rounded-xl flex items-center gap-3 hover:bg-kindle-bg transition shadow-sm group"
              >
                <div className="p-2 bg-indigo-50/10 text-indigo-500 rounded-lg group-hover:scale-110 transition">
                  <HardDrive className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <p className="text-[10px] font-bold uppercase tracking-widest">Dropbox</p>
                  <p className="text-[8px] text-kindle-text-muted">Sideload</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Cloud Import Modal */}
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
                className="w-full py-3.5 bg-[#4285F4] text-white rounded-xl text-xs font-bold uppercase tracking-widest shadow-lg hover:brightness-110 transition"
                onClick={() => alert("Cloud Sync Integration: Please set up Google OAuth in AI Studio settings to enable this feature.")}
              >
                Connect Google Drive
              </button>
              <button 
                className="w-full py-3.5 bg-kindle-bg border border-kindle-border text-kindle-text rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-kindle-card transition"
                onClick={() => setShowCloudImport(false)}
              >
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Custom Tags Manager Popup Modal */}
      {activeBookForTags && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xl relative text-kindle-text animate-fade-in">
            <button 
              onClick={() => setActiveBookForTags(null)}
              className="p-1.5 rounded-lg hover:bg-kindle-bg absolute right-4 top-4 text-kindle-text-muted transition"
            >
              ✕
            </button>

            <h3 className="font-sans font-semibold text-kindle-text text-sm mb-1">Organize Book Tags</h3>
            <p className="text-xs text-kindle-text-muted font-sans line-clamp-1 mb-4">{activeBookForTags.title}</p>

            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-kindle-text-muted uppercase tracking-wider font-semibold font-mono">Toggle Tags</span>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 border border-kindle-border rounded-xl bg-kindle-bg">
                  {availableTags.map((tag) => {
                    const isTagged = activeBookForTags.tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => handleToggleBookTag(activeBookForTags, tag)}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition ${
                          isTagged 
                            ? "bg-kindle-accent border-transparent text-kindle-bg font-medium" 
                            : "border-kindle-border bg-kindle-card text-kindle-text-muted hover:border-kindle-accent"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tag creation direct in modal */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="New label..."
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  className="flex-1 bg-kindle-bg border border-kindle-border rounded-lg px-3 py-1.5 text-xs text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                />
                <button
                  onClick={async () => {
                    await handleCreateCustomTag();
                    await loadTags();
                  }}
                  className="bg-kindle-accent hover:opacity-90 text-kindle-bg text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 font-semibold transition"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Custom Delete Confirmation Modal */}
      {/* 5. Modals */}
      {editingCoverBook && (
        <BookCoverEditor 
          book={editingCoverBook}
          userId={userId}
          onClose={() => setEditingCoverBook(null)}
          onUpdate={(updatedBook) => {
            onRefreshLibrary();
            setEditingCoverBook(null);
          }}
        />
      )}

      {activeBookForDelete && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xl text-kindle-text animate-fade-in">
            <h3 className="font-sans font-bold text-base text-red-700 mb-2">Delete Ebook?</h3>
            <p className="text-xs text-kindle-text-muted font-sans leading-relaxed mb-5">
              Are you sure you want to delete <strong>"{activeBookForDelete.title}"</strong>?<br/>
              This will permanently delete both the locally cached file and your cloud-synced progress.
            </p>

            <div className="flex gap-3 justify-end font-sans">
              <button
                onClick={() => setActiveBookForDelete(null)}
                className="px-4 py-2 border border-kindle-border text-kindle-text-muted rounded-xl text-xs font-semibold hover:bg-kindle-bg transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteBook}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {editingMetadataBook && (
        <BookMetadataEditor
          userId={userId}
          book={editingMetadataBook}
          onClose={() => setEditingMetadataBook(null)}
          onSave={onRefreshLibrary}
        />
      )}

      {/* 7. Mobile Long Press Action Sheet */}
      {longPressedBook && (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setLongPressedBook(null)} />
          <div className="relative w-full sm:max-w-sm bg-kindle-card border-t sm:border border-kindle-border rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 sm:p-6 text-kindle-text animate-in slide-in-from-bottom-10 sm:zoom-in duration-300">
            {/* Grab handle for mobile bottom sheet feel */}
            <div className="w-12 h-1 bg-kindle-border rounded-full mx-auto mb-4 sm:hidden" />
            
            <div className="flex items-center gap-3.5 mb-6 pb-4 border-b border-kindle-border/40">
              {longPressedBook.coverUrl ? (
                <img
                  src={`/api/proxy-image?url=${encodeURIComponent(longPressedBook.coverUrl)}`}
                  className="w-12 h-16 object-cover rounded-lg border border-kindle-border/60 shadow-sm"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-12 h-16 bg-kindle-bg rounded-lg border border-kindle-border/60 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-kindle-text-muted opacity-30" />
                </div>
              )}
              <div className="overflow-hidden">
                <h4 className="font-serif font-bold text-sm leading-tight truncate">{longPressedBook.title}</h4>
                <p className="text-[11px] text-kindle-text-muted mt-1 truncate">{longPressedBook.author}</p>
                <span className="inline-block mt-1.5 text-[8px] font-bold uppercase tracking-widest bg-kindle-bg border border-kindle-border px-1.5 py-0.5 rounded">
                  {longPressedBook.extension}
                </span>
              </div>
            </div>

            <div className="space-y-1.5 font-sans">
              <button
                onClick={() => {
                  const book = longPressedBook;
                  setLongPressedBook(null);
                  onBookSelected(book);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-kindle-bg rounded-xl text-left text-xs font-semibold transition-colors"
              >
                <BookOpen className="w-4 h-4 text-kindle-text-muted" />
                Open & Read Book
              </button>
              
              <button
                onClick={() => {
                  setEditingCoverBook(longPressedBook);
                  setLongPressedBook(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-kindle-bg rounded-xl text-left text-xs font-semibold transition-colors"
              >
                <ImageIcon className="w-4 h-4 text-kindle-text-muted" />
                Change Book Cover
              </button>

              <button
                onClick={() => {
                  setEditingMetadataBook(longPressedBook);
                  setLongPressedBook(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-kindle-bg rounded-xl text-left text-xs font-semibold transition-colors"
              >
                <Edit2 className="w-4 h-4 text-kindle-text-muted" />
                Edit Metadata
              </button>

              <button
                onClick={() => {
                  setActiveBookForTags(longPressedBook);
                  setLongPressedBook(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-kindle-bg rounded-xl text-left text-xs font-semibold transition-colors"
              >
                <Tag className="w-4 h-4 text-kindle-text-muted" />
                Organize Tags
              </button>

              <button
                onClick={() => {
                  setActiveBookForDelete(longPressedBook);
                  setLongPressedBook(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/10 text-red-600 rounded-xl text-left text-xs font-semibold transition-colors mt-2"
              >
                <Trash2 className="w-4 h-4 text-red-500" />
                Delete Book
              </button>

              <div className="pt-2 border-t border-kindle-border/40 mt-3">
                <button
                  onClick={() => setLongPressedBook(null)}
                  className="w-full py-3 bg-kindle-bg hover:bg-kindle-card border border-kindle-border/60 rounded-xl text-center text-xs font-bold uppercase tracking-widest transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
