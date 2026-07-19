import React, { useState, useRef, useEffect } from "react";
import { BookMetadata, syncBookToCloud, syncDeleteBook, loadCustomTags, saveCustomTags } from "../lib/firebase";
import { storeBookFile, checkBookFileCached, deleteBookFile } from "../db/indexedDB";
import { inferBookTags } from "../lib/tagsHelper";
import { BookOpen, CloudUpload as UploadCloud, Tag, Star, Trash2, ListFilter, CircleCheck as CheckCircle, Plus, Eye, Award, Clock, Sparkles, BookMarked, Circle as HelpCircle, HardDrive, Search, Cloud, CreditCard as Edit2, Image as ImageIcon, TriangleAlert as AlertTriangle, RefreshCw, MoveVertical as MoreVertical, Flame, TrendingUp, Calendar, Check, CheckSquare, Headphones } from "lucide-react";
import BookCoverEditor from "./BookCoverEditor";
import BookMetadataEditor from "./BookMetadataEditor";
import DownloadBookBtn from "./DownloadBookBtn";
import AudiobookCassetteCard from "./AudiobookCassetteCard";

interface LibraryManagerProps {
  userId: string;
  books: BookMetadata[];
  onBookSelected: (book: BookMetadata) => void;
  onRefreshLibrary: () => void;
  cachedBookIds: Set<string>;
  onCachedIdsChanged: () => void;
  grayscaleCovers?: boolean;
  hideCovers?: boolean;
  downloads?: any[];
  onSearchTrigger?: (query: string) => void;
}

function calculateStreak(stats: Record<string, { minutes: number }>): number {
  let streak = 0;
  let checkDate = new Date();
  
  const getCleanDateString = (d: Date) => d.toDateString();
  
  const todayStr = getCleanDateString(checkDate);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getCleanDateString(yesterday);
  
  const hasReadToday = stats[todayStr] && stats[todayStr].minutes > 0;
  const hasReadYesterday = stats[yesterdayStr] && stats[yesterdayStr].minutes > 0;
  
  if (!hasReadToday && !hasReadYesterday) {
    return 0;
  }
  
  if (!hasReadToday) {
    checkDate = yesterday;
  }
  
  while (true) {
    const dateStr = getCleanDateString(checkDate);
    if (stats[dateStr] && stats[dateStr].minutes > 0) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  return streak;
}

export default function LibraryManager({ 
  userId, 
  books, 
  onBookSelected, 
  onRefreshLibrary,
  cachedBookIds,
  onCachedIdsChanged,
  grayscaleCovers = false,
  hideCovers = false,
  downloads = [],
  onSearchTrigger
}: LibraryManagerProps) {
  // Filters & sorting
  const [search, setSearch] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterTag, setFilterTag] = useState<string>("all");
  const [filterType, setFilterType] = useState<"all" | "book" | "audiobook">("all");
  const [sortBy, setSortBy] = useState<string>("dateAdded");
  
  // Custom Tag States
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState<string>("");
  const [showTagConfig, setShowTagConfig] = useState<boolean>(false);
  const [activeBookForTags, setActiveBookForTags] = useState<BookMetadata | null>(null);
  const [activeBookForDelete, setActiveBookForDelete] = useState<BookMetadata | null>(null);
  const [activeShelf, setActiveShelf] = useState<string>("All");
  const [syncingBookIds, setSyncingBookIds] = useState<Set<string>>(new Set());
  const [deletingBookIds, setDeletingBookIds] = useState<Set<string>>(new Set());
  const [editingCoverBook, setEditingCoverBook] = useState<BookMetadata | null>(null);
  const [editingMetadataBook, setEditingMetadataBook] = useState<BookMetadata | null>(null);
  const [longPressedBook, setLongPressedBook] = useState<BookMetadata | null>(null);

  // Multi-select library management states
  const [isManageMode, setIsManageMode] = useState<boolean>(false);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [bulkTagModalOpen, setBulkTagModalOpen] = useState<boolean>(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState<boolean>(false);

  // Reading Goals & Stats States
  const [dailyMinutesTarget, setDailyMinutesTarget] = useState<number>(() => {
    const saved = localStorage.getItem("kora_daily_minutes_target");
    return saved ? parseInt(saved) : 20; // default 20 mins
  });
  const [annualBooksTarget, setAnnualBooksTarget] = useState<number>(() => {
    const saved = localStorage.getItem("kora_annual_books_target");
    return saved ? parseInt(saved) : 12; // default 12 books
  });
  const [todayMinutes, setTodayMinutes] = useState<number>(0);
  const [weeklyStats, setWeeklyStats] = useState<{ day: string; minutes: number }[]>([]);
  const [calculatedStreak, setCalculatedStreak] = useState<number>(0);
  const [showGoalEditor, setShowGoalEditor] = useState<boolean>(false);
  const [showLogModal, setShowLogModal] = useState<boolean>(false);
  const [manualLogMinutes, setManualLogMinutes] = useState<string>("15");

  useEffect(() => {
    const loadStats = () => {
      const todayStr = new Date().toDateString();
      const savedStats = localStorage.getItem("kora_reading_stats");
      const stats = savedStats ? JSON.parse(savedStats) : {};
      
      // Calculate today's minutes
      setTodayMinutes(stats[todayStr]?.minutes || 0);
      
      // Calculate last 7 days for the activity bar chart
      const days = [];
      const getCleanDateString = (d: Date) => d.toDateString();
      const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = getCleanDateString(d);
        const mins = stats[dateStr]?.minutes || 0;
        days.push({
          day: `${weekdays[d.getDay()]} ${d.getDate()}`,
          minutes: mins
        });
      }
      setWeeklyStats(days);
      
      // Calculate streak
      const streak = calculateStreak(stats);
      setCalculatedStreak(streak);
    };

    loadStats();
    
    // Add event listener for localstorage changes so if they read and close, stats are in sync
    window.addEventListener("storage", loadStats);
    return () => window.removeEventListener("storage", loadStats);
  }, [books]);

  const handleLogReadingMinutes = (mins: number) => {
    const todayStr = new Date().toDateString();
    const savedStats = localStorage.getItem("kora_reading_stats");
    let stats = savedStats ? JSON.parse(savedStats) : {};
    
    if (!stats[todayStr]) {
      stats[todayStr] = { minutes: 0, date: todayStr };
    }
    stats[todayStr].minutes = (stats[todayStr].minutes || 0) + mins;
    
    localStorage.setItem("kora_reading_stats", JSON.stringify(stats));
    
    // Refresh stats
    setTodayMinutes(stats[todayStr].minutes);
    
    // Recalculate weekly stats and streak
    const days = [];
    const getCleanDateString = (d: Date) => d.toDateString();
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = getCleanDateString(d);
      const m = stats[dateStr]?.minutes || 0;
      days.push({
        day: `${weekdays[d.getDay()]} ${d.getDate()}`,
        minutes: m
      });
    }
    setWeeklyStats(days);
    setCalculatedStreak(calculateStreak(stats));
    setShowLogModal(false);
  };

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

  // Compact Stats Drawer state
  const [showGoalsDrawer, setShowGoalsDrawer] = useState<boolean>(false);

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
      if (!cachedBookIds.has(book.id) && book.md5 && !syncingBookIds.has(book.id) && !deletingBookIds.has(book.id)) {
        downloadMissingBook(book);
      }
    });
  }, [books, cachedBookIds, syncingBookIds, deletingBookIds]);

  async function loadTags() {
    const tags = await loadCustomTags(userId);
    setAvailableTags(tags);
  }

  // Delete book from local cache AND cloud sync
  async function handleDeleteBook(book: BookMetadata, e: React.MouseEvent) {
    e.stopPropagation();
    setActiveBookForDelete(book);
  }

  async function confirmDeleteBook() {
    if (!activeBookForDelete) return;
    const bookId = activeBookForDelete.id;
    setDeletingBookIds(prev => new Set(prev).add(bookId));
    try {
      await deleteBookFile(bookId);
      await syncDeleteBook(userId, bookId);
      onCachedIdsChanged();
      onRefreshLibrary();
    } catch (err) {
      console.error("Delete Book Error:", err);
    } finally {
      setActiveBookForDelete(null);
    }
  }

  // Bulk Status Update for Selected Books
  async function handleBulkStatusUpdate(status: string) {
    const ids = Array.from(selectedBookIds) as string[];
    try {
      const promises = books
        .filter(book => ids.includes(book.id))
        .map(book => {
          const updated = {
            ...book,
            status: status as any,
            progress: {
              ...book.progress,
              percent: status === "completed" ? 100 : (book.progress?.percent ?? 0),
              lastReadTime: Date.now()
            }
          };
          return syncBookToCloud(userId, updated);
        });

      await Promise.all(promises);
      onRefreshLibrary();
    } catch (err) {
      console.error("[Bulk Status Update Error]:", err);
    } finally {
      setSelectedBookIds(new Set());
      setIsManageMode(false);
    }
  }

  // Bulk Delete Selected Books
  async function confirmBulkDelete() {
    const ids = Array.from(selectedBookIds) as string[];
    setDeletingBookIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
    try {
      for (const id of ids) {
        await deleteBookFile(id);
        await syncDeleteBook(userId, id);
      }
      onCachedIdsChanged();
      onRefreshLibrary();
    } catch (err) {
      console.error("[Bulk Delete Error]:", err);
    } finally {
      setSelectedBookIds(new Set());
      setIsManageMode(false);
      setShowBulkDeleteConfirm(false);
    }
  }

  // Bulk Add Tag/Collection to Selected Books
  async function handleBulkAddTag(tag: string) {
    if (!tag) return;
    const ids = Array.from(selectedBookIds) as string[];
    try {
      const promises = books
        .filter(book => ids.includes(book.id))
        .map(book => {
          const currentTags = book.tags || [];
          const nextTags = currentTags.includes(tag) ? currentTags : [...currentTags, tag];
          const updated = {
            ...book,
            tags: nextTags
          };
          return syncBookToCloud(userId, updated);
        });

      await Promise.all(promises);
      onRefreshLibrary();
    } catch (err) {
      console.error("[Bulk Tag Error]:", err);
    } finally {
      setSelectedBookIds(new Set());
      setIsManageMode(false);
      setBulkTagModalOpen(false);
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

  const isAudiobookEntry = (book: BookMetadata) =>
    book.extension?.toLowerCase() === "audiobook" || book.tags?.includes("audiobook");

  // Filter & sort logic
  const filteredBooks = books.filter((book) => {
    const matchesSearch = 
      book.title.toLowerCase().includes(search.toLowerCase()) || 
      book.author.toLowerCase().includes(search.toLowerCase());
      
    const matchesStatus = 
      filterStatus === "all" || book.status === filterStatus;
      
    const matchesTag = 
      filterTag === "all" || book.tags.includes(filterTag);

    const matchesType =
      filterType === "all" ||
      (filterType === "audiobook" && isAudiobookEntry(book)) ||
      (filterType === "book" && !isAudiobookEntry(book));
      
    return matchesSearch && matchesStatus && matchesTag && matchesType;
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

  const finalRenderedBooks = filteredBooks;

  // Render active downloads as cards too (so the light-grayscale thumbnail +
  // download animation shows in the library while the file is still incoming).
  // The existing downloading overlay keys off book.id/md5 matching a download,
  // so we synthesize cards with id = download id/md5.
  const downloadingBooks: any[] = (downloads || [])
    .filter((d) => d.status === "downloading" || d.status === "error")
    .map((d) => {
      let coverUrl = "";
      try {
        const mirror = JSON.parse(localStorage.getItem("kora_sw_payloads") || "{}")[d.id];
        coverUrl = mirror?.book?.coverUrl || "";
      } catch (e) {}
      return {
        id: d.md5 || d.id,
        md5: d.md5,
        title: d.title,
        author: d.author,
        coverUrl,
        isDownloadingCard: true,
        downloadStatus: d.status,
      };
    });
  const renderedWithDownloads = downloadingBooks.length
    ? [...downloadingBooks, ...finalRenderedBooks]
    : finalRenderedBooks;

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
    <div id="library-manager-section" className="space-y-6 md:space-y-10 pb-4 md:pb-10">
      
      {/* 1. Interactive Header & Collapsible Stats/Streak Summary */}
      <header className="flex items-center justify-between pb-2 md:pb-4 border-b border-kindle-border font-sans">
        <div>
          <h1 className="text-3xl font-lexend font-bold tracking-tight text-kindle-text">Library</h1>
          <p className="hidden md:block text-[10px] text-kindle-text-muted uppercase tracking-wider font-semibold font-mono mt-0.5">Focus &amp; Collections</p>
        </div>

        {/* Manage Library Button (Mobile) */}
        <button
          onClick={() => {
            setIsManageMode(!isManageMode);
            setSelectedBookIds(new Set());
          }}
          className={`sm:hidden text-[10px] font-bold uppercase tracking-wider transition cursor-pointer ${
            isManageMode 
              ? "text-red-600 dark:text-red-400" 
              : "text-kindle-text-muted hover:text-kindle-text"
          }`}
          title={isManageMode ? "Cancel" : "Manage Library"}
        >
          {isManageMode ? "Cancel" : "Manage Library"}
        </button>
      </header>

      {/* 3. Full Library Section with Search/Filter */}
      <section className="space-y-5">
        <div className="space-y-4">
          {/* Search Bar - styled identically to Discover view */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center w-full font-sans">
            <div className="relative group flex-1">
              <Search className="w-5 h-5 text-kindle-text-muted absolute left-4 top-1/2 -translate-y-1/2 group-focus-within:text-kindle-accent transition" />
              <input
                id="library-search-input"
                type="text"
                placeholder="Filter library by title, author..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-kindle-card border border-kindle-border rounded-2xl text-sm transition focus:ring-2 focus:ring-kindle-accent/20 outline-none shadow-sm placeholder:text-kindle-text-muted/60 group-hover:border-kindle-accent/40 font-sans"
              />
            </div>

            <button
              onClick={() => {
                setIsManageMode(!isManageMode);
                setSelectedBookIds(new Set());
              }}
              className={`hidden sm:flex px-5 py-3.5 rounded-2xl text-[10px] font-bold uppercase tracking-wider transition border items-center justify-center gap-2 shrink-0 cursor-pointer ${
                isManageMode 
                  ? "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/30 hover:bg-red-100/50" 
                  : "bg-kindle-card text-kindle-text border-kindle-border hover:border-kindle-text"
              }`}
            >
              {isManageMode ? "Cancel" : "Manage Library"}
            </button>
          </div>

          {/* Shelves / Collections Chips (Bellow the search bar, smaller and compact) */}
          <div className="flex flex-col gap-3 font-sans">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
              {["All", "To Read", "Reading", "Completed", "Favorites", ...availableTags].map((shelf) => (
                <button
                  key={shelf}
                  onClick={() => {
                    setActiveShelf(shelf);
                    if (shelf === "All") { setFilterStatus("all"); setFilterTag("all"); }
                    else if (shelf === "To Read") { setFilterStatus("to-read"); setFilterTag("all"); }
                    else if (shelf === "Reading") { setFilterStatus("reading"); setFilterTag("all"); }
                    else if (shelf === "Completed") { setFilterStatus("completed"); setFilterTag("all"); }
                    else if (shelf === "Favorites") { setFilterStatus("all"); setFilterTag("all"); /* handle fav */ }
                    else { setFilterStatus("all"); setFilterTag(shelf); }
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-wider border transition whitespace-nowrap cursor-pointer ${
                    activeShelf === shelf 
                      ? "bg-kindle-text text-kindle-bg border-transparent shadow-sm" 
                      : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-text"
                  }`}
                >
                  {shelf}
                </button>
              ))}
              <button onClick={() => setShowTagConfig(true)} className="px-2.5 py-1.5 rounded-full border border-kindle-border text-kindle-text-muted hover:text-kindle-text transition cursor-pointer flex items-center justify-center shrink-0" title="Manage Collections">
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {/* Dropdowns */}
            <div className="flex flex-wrap gap-1.5 items-center justify-start">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-kindle-card border border-kindle-border rounded-full px-2.5 py-1 text-kindle-text focus:ring-1 focus:ring-kindle-accent appearance-none text-[9px] font-bold uppercase tracking-wider cursor-pointer shadow-xs"
              >
                <option value="all">Status: All</option>
                <option value="to-read">To Read</option>
                <option value="reading">Reading</option>
                <option value="completed">Completed</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-kindle-card border border-kindle-border rounded-full px-2.5 py-1 text-kindle-text focus:ring-1 focus:ring-kindle-accent appearance-none text-[9px] font-bold uppercase tracking-wider cursor-pointer shadow-xs"
              >
                <option value="dateAdded">Sort: Newest</option>
                <option value="progress">Sort: Progress</option>
                <option value="rating">Sort: Rating</option>
                <option value="title">Sort: Title</option>
              </select>

              <button
                type="button"
                onClick={() => setFilterType((prev) => (prev === "book" ? "all" : "book"))}
                className={`px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-wider transition cursor-pointer flex items-center gap-1 ${
                  filterType === "book"
                    ? "bg-kindle-text text-kindle-bg border-transparent shadow-sm"
                    : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-text hover:text-kindle-text"
                }`}
              >
                <BookOpen className="w-3 h-3" />
                Book
              </button>

              <button
                type="button"
                onClick={() => setFilterType((prev) => (prev === "audiobook" ? "all" : "audiobook"))}
                className={`px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-wider transition cursor-pointer flex items-center gap-1 ${
                  filterType === "audiobook"
                    ? "bg-kindle-text text-kindle-bg border-transparent shadow-sm"
                    : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-text hover:text-kindle-text"
                }`}
              >
                <Headphones className="w-3 h-3" />
                Audiobook
              </button>
            </div>
          </div>
        </div>

        {finalRenderedBooks.length === 0 ? (
          <div className="py-24 text-center border border-dashed border-kindle-border rounded-2xl bg-kindle-card/30">
            <BookOpen className="w-10 h-10 text-kindle-text-muted mx-auto mb-3 animate-pulse" />
            <h3 className="font-sans font-bold text-xs text-kindle-text-muted uppercase tracking-widest">No books found</h3>
          </div>
        ) : (
          <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-3 md:gap-6 space-y-3 md:space-y-6">
            {renderedWithDownloads.map((book) => {
              const isCached = cachedBookIds.has(book.id);
              const progressPercent = book.progress?.percent ?? 0;
              const isDownloadingCard = !!book.isDownloadingCard;
              return (
                <div
                  key={book.id}
                  onTouchStart={(e) => !isManageMode && startLongPress(book, e)}
                  onTouchEnd={isManageMode ? undefined : endLongPress}
                  onTouchMove={isManageMode ? undefined : handleTouchMove}
                  onMouseDown={(e) => {
                    if (!isManageMode && e.button === 0) startLongPress(book, e);
                  }}
                  onMouseUp={isManageMode ? undefined : endLongPress}
                  onMouseLeave={isManageMode ? undefined : endLongPress}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={(e) => {
                    if (isManageMode) {
                      setSelectedBookIds(prev => {
                        const next = new Set(prev);
                        if (next.has(book.id)) {
                          next.delete(book.id);
                        } else {
                          next.add(book.id);
                        }
                        return next;
                      });
                      return;
                    }
                    if (isLongPressedRef.current) {
                      e.preventDefault();
                      e.stopPropagation();
                      isLongPressedRef.current = false;
                      return;
                    }
                    if (isDownloadingCard) return; // don't open a half-downloaded book
                    onBookSelected(book);
                  }}
                  className={`kindle-card break-inside-avoid overflow-hidden group flex flex-col cursor-pointer transition duration-300 select-none relative ${
                    isManageMode && selectedBookIds.has(book.id)
                      ? "ring-4 ring-kindle-accent border-transparent bg-kindle-accent/[0.03] scale-[0.98] -translate-y-0"
                      : "hover:-translate-y-1"
                  }`}
                >
                  <div className="relative flex items-center justify-center p-0 border-b border-kindle-border overflow-hidden">
                    {/* Visual Checkbox Selector in Manage Mode */}
                    {isManageMode && (
                      <div className="absolute top-3 left-3 z-30 flex items-center justify-center">
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all shadow-md ${
                          selectedBookIds.has(book.id)
                            ? "bg-kindle-accent border-kindle-accent text-kindle-bg"
                            : "bg-black/40 border-white text-transparent"
                        }`}>
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    )}
                    {book.extension?.toLowerCase() === "audiobook" ? (
                      <div className="w-full p-3 bg-gradient-to-b from-neutral-900/20 to-neutral-950/30 border-b border-kindle-border/30">
                        <AudiobookCassetteCard
                          title={book.title}
                          coverUrl={book.coverUrl}
                          grayscaleCovers={grayscaleCovers}
                          hideCovers={hideCovers}
                        />
                      </div>
                    ) : !hideCovers && book.coverUrl ? (
                      <>
                        <img
                          src={book.coverUrl.startsWith('http') ? `/api/proxy-image?url=${encodeURIComponent(book.coverUrl)}` : book.coverUrl}
                          className={`w-full aspect-[2/3] object-cover group-hover:scale-105 transition duration-500 ${grayscaleCovers ? "grayscale-app" : ""}`}
                          referrerPolicy="no-referrer"
                          onContextMenu={(e) => e.preventDefault()}
                          onError={(e) => {
                            const img = e.currentTarget;
                            img.style.display = 'none';
                            const fallback = img.nextElementSibling as HTMLElement | null;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                        <div className="w-full aspect-[2/3] bg-kindle-card flex flex-col items-center justify-center p-4 text-center hidden">
                          <BookOpen className="w-8 h-8 text-kindle-text-muted mb-2" />
                          <span className="text-[8px] uppercase font-bold text-kindle-text-muted tracking-widest line-clamp-3">{book.title}</span>
                        </div>
                      </>
                    ) : (
                      <div className="w-full aspect-[2/3] bg-kindle-card flex flex-col items-center justify-center p-4 text-center">
                        <BookOpen className="w-8 h-8 text-kindle-text-muted mb-2" />
                        <span className="text-[8px] uppercase font-bold text-kindle-text-muted tracking-widest line-clamp-3">{book.title}</span>
                      </div>
                    )}

                    {/* Downloading overlay: light grayscale thumbnail + progress animation */}
                    {(() => {
                      const dl = downloads.find(
                        (d) => d.status === "downloading" && (d.md5 === book.md5 || d.md5 === book.id || d.id === book.id || d.id === book.md5)
                      );
                      if (!dl) return null;
                      const pct = typeof dl.percent === "number" ? dl.percent : 0;
                      return (
                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-kindle-card/70 backdrop-blur-[1px]">
                          {/* Light grayscale book thumbnail */}
                          {!hideCovers && book.coverUrl ? (
                            <img
                              src={book.coverUrl.startsWith("http") ? `/api/proxy-image?url=${encodeURIComponent(book.coverUrl)}` : book.coverUrl}
                              className="absolute inset-0 w-full h-full object-cover opacity-30 grayscale"
                              referrerPolicy="no-referrer"
                              alt=""
                            />
                          ) : null}
                          {/* Shimmer sweep */}
                          <div className="absolute inset-0 overflow-hidden">
                            <div className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_1.4s_infinite]" />
                          </div>
                          {/* Progress ring */}
                          <div className="relative w-14 h-14 rounded-full flex items-center justify-center bg-kindle-bg/80 border border-kindle-border shadow">
                            <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                              <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" className="text-kindle-border" />
                              <circle
                                cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                                className="text-kindle-accent transition-all duration-300"
                                strokeDasharray={97.4}
                                strokeDashoffset={97.4 - (97.4 * Math.max(0, Math.min(100, pct))) / 100}
                              />
                            </svg>
                            <span className="absolute text-[10px] font-bold font-mono text-kindle-text">{pct}%</span>
                          </div>
                          <span className="relative mt-2 text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">Downloading…</span>
                        </div>
                      );
                    })()}


                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-kindle-border">
                      <div className="h-full bg-kindle-text" style={{ width: `${progressPercent}%` }} />
                    </div>

                    {/* Mobile-only Three-Dot Button (always visible on mobile, hidden on desktop via md:hidden) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setLongPressedBook(book);
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className="absolute top-2 right-2 p-1.5 bg-kindle-card/95 border border-kindle-border text-kindle-text rounded-full shadow-md z-20 md:hidden flex items-center justify-center hover:bg-kindle-bg active:scale-90 transition"
                      title="Options"
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>

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

                  <div className="p-1.5 flex flex-col gap-0.5 flex-1 font-sans">
                    <h4 className="text-[10px] font-bold text-kindle-text leading-tight line-clamp-1" title={book.title}>
                      {book.title}
                    </h4>
                    
                    <div className="flex items-center justify-between text-[8px] text-kindle-text-muted font-bold tracking-tight mt-0.5">
                      <div className="flex items-center gap-1">
                        <span>{progressPercent}%</span>
                        <span>•</span>
                        <span className="uppercase">{book.extension?.toLowerCase() === "audiobook" ? "tape" : book.extension}</span>
                        <span>•</span>
                        <span className="uppercase">
                          {book.status === "completed" ? "Done" : book.status === "reading" ? "Reading" : "New"}
                        </span>
                      </div>
                      
                      <div className="shrink-0">
                        {isCached ? (
                          <CheckCircle className="w-2.5 h-2.5 text-emerald-600" />
                        ) : syncingBookIds.has(book.id) ? (
                          <div className="w-2.5 h-2.5 border border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Cloud className="w-2.5 h-2.5 text-blue-500 opacity-60" />
                        )}
                      </div>
                    </div>

                    {/* Compact elegant progress line */}
                    <div className="w-full bg-neutral-200 dark:bg-neutral-800 h-0.5 rounded-full overflow-hidden mt-1">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${
                          book.status === "completed" ? "bg-emerald-600 dark:bg-emerald-500" : "bg-kindle-text"
                        }`} 
                        style={{ width: `${progressPercent}%` }} 
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. Reading Stats at the bottom */}
      <section className="space-y-8 pt-12 border-t border-kindle-border">
        <div>
          <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted mb-4 font-mono">Reading Statistics</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="kindle-card p-4 border border-kindle-border">
              <h4 className="text-[9px] text-kindle-text-muted font-bold uppercase tracking-widest mb-1">Library</h4>
              <div className="text-xl font-bold">{totalBooks} <span className="text-xs font-normal text-kindle-text-muted">books</span></div>
            </div>
            <div className="kindle-card p-4 border border-kindle-border">
              <h4 className="text-[9px] text-kindle-text-muted font-bold uppercase tracking-widest mb-1">Reading</h4>
              <div className="text-xl font-bold">{activeReading} <span className="text-xs font-normal text-kindle-text-muted">books</span></div>
            </div>
            <div className="kindle-card p-4 border border-kindle-border">
              <h4 className="text-[9px] text-kindle-text-muted font-bold uppercase tracking-widest mb-1">Completed</h4>
              <div className="text-xl font-bold">{completedBooks} <span className="text-xs font-normal text-kindle-text-muted">books</span></div>
            </div>
            <div className="kindle-card p-4 border border-kindle-border">
              <h4 className="text-[9px] text-kindle-text-muted font-bold uppercase tracking-widest mb-1">Streak</h4>
              <div className="text-xl font-bold">{readingStreak} <span className="text-xs font-normal">days</span></div>
            </div>
          </div>
        </div>
      </section>

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
      {showTagConfig && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xl text-kindle-text animate-fade-in space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="font-sans font-bold text-base flex items-center gap-2"><Tag className="w-4 h-4 text-kindle-accent" /> Manage Collections</h3>
              <button onClick={() => setShowTagConfig(false)} className="text-kindle-text-muted hover:text-kindle-text transition">
                <Trash2 className="w-4 h-4 opacity-0" /> {/* Spacer */}
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <input 
                  type="text" 
                  value={newTagInput} 
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCustomTag(); }}
                  placeholder="New collection name..." 
                  className="flex-1 bg-kindle-bg border border-kindle-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-kindle-accent font-sans"
                />
                <button 
                  onClick={handleCreateCustomTag}
                  className="bg-kindle-text text-kindle-bg px-4 py-2 rounded-xl text-xs font-bold transition hover:bg-kindle-accent"
                >
                  Add
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2">
                {availableTags.length === 0 && <p className="text-xs text-kindle-text-muted text-center italic py-4">No custom collections yet.</p>}
                {availableTags.map(tag => (
                  <div key={tag} className="flex justify-between items-center p-3 bg-kindle-bg border border-kindle-border rounded-xl">
                    <span className="text-sm font-semibold">{tag}</span>
                    <button 
                      onClick={() => {
                        const updated = availableTags.filter(t => t !== tag);
                        setAvailableTags(updated);
                        saveCustomTags(userId, updated);
                      }}
                      className="text-red-400 hover:text-red-500 hover:bg-red-500/10 p-1.5 rounded-lg transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button 
                onClick={() => setShowTagConfig(false)}
                className="px-6 py-2 bg-kindle-border hover:bg-kindle-border/80 text-kindle-text rounded-xl text-xs font-bold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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

      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xl text-kindle-text animate-fade-in">
            <h3 className="font-sans font-bold text-base text-red-700 mb-2">Delete {selectedBookIds.size} Ebooks?</h3>
            <p className="text-xs text-kindle-text-muted font-sans leading-relaxed mb-5">
              Are you sure you want to permanently delete the {selectedBookIds.size} selected books?<br/>
              This will permanently delete both the locally cached files and your cloud-synced progress.
            </p>

            <div className="flex gap-3 justify-end font-sans">
              <button
                onClick={() => setShowBulkDeleteConfirm(false)}
                className="px-4 py-2 border border-kindle-border text-kindle-text-muted rounded-xl text-xs font-semibold hover:bg-kindle-bg transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmBulkDelete}
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

      {/* Goal Editor Modal */}
      {showGoalEditor && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xl text-kindle-text font-sans">
            <h3 className="font-bold text-sm uppercase tracking-wider mb-4">Set Reading Goals</h3>
            
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-kindle-text-muted uppercase tracking-wider block">Daily Focus Goal (Minutes)</label>
                <input
                  type="number"
                  min="1"
                  max="480"
                  value={dailyMinutesTarget}
                  onChange={(e) => {
                    const val = Math.max(1, parseInt(e.target.value) || 1);
                    setDailyMinutesTarget(val);
                    localStorage.setItem("kora_daily_minutes_target", val.toString());
                  }}
                  className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-3 py-2 text-xs text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-kindle-text-muted uppercase tracking-wider block">Yearly Book Challenge (Books)</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={annualBooksTarget}
                  onChange={(e) => {
                    const val = Math.max(1, parseInt(e.target.value) || 1);
                    setAnnualBooksTarget(val);
                    localStorage.setItem("kora_annual_books_target", val.toString());
                  }}
                  className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-3 py-2 text-xs text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setShowGoalEditor(false)}
                className="px-4 py-2 bg-kindle-text text-kindle-bg rounded-xl text-xs font-semibold hover:opacity-90 transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Reading Session Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xl text-kindle-text font-sans">
            <h3 className="font-bold text-sm uppercase tracking-wider mb-2">Log Reading Session</h3>
            <p className="text-[10px] text-kindle-text-muted mb-4">Did you read physical books, or read on another device? Log your minutes below to keep your streak alive!</p>
            
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-kindle-text-muted uppercase tracking-wider block">Minutes Read</label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={manualLogMinutes}
                  onChange={(e) => setManualLogMinutes(e.target.value)}
                  placeholder="e.g. 15"
                  className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-3 py-2 text-xs text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                />
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {["5", "15", "30", "45", "60"].map((mins) => (
                  <button
                    key={mins}
                    onClick={() => setManualLogMinutes(mins)}
                    className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition ${
                      manualLogMinutes === mins
                        ? "bg-kindle-text border-transparent text-kindle-bg"
                        : "border-kindle-border text-kindle-text hover:bg-kindle-bg"
                    }`}
                  >
                    +{mins}m
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setShowLogModal(false)}
                className="px-4 py-2 border border-kindle-border text-kindle-text-muted rounded-xl text-xs font-semibold hover:bg-kindle-bg transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleLogReadingMinutes(parseInt(manualLogMinutes) || 0)}
                className="px-4 py-2 bg-kindle-text text-kindle-bg hover:opacity-90 rounded-xl text-xs font-semibold transition"
              >
                Save Progress
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Mobile Long Press Action Sheet */}
      {longPressedBook && (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setLongPressedBook(null)} />
          <div className="relative w-full sm:max-w-sm bg-kindle-card border-t sm:border border-kindle-border rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 sm:p-6 text-kindle-text animate-in slide-in-from-bottom-10 sm:zoom-in duration-300">
            {/* Grab handle for mobile bottom sheet feel */}
            <div className="w-12 h-1 bg-kindle-border rounded-full mx-auto mb-4 sm:hidden" />
            
            <div className="flex items-center gap-3.5 mb-6 pb-4 border-b border-kindle-border/40">
              {longPressedBook.extension?.toLowerCase() === "audiobook" ? (
                <AudiobookCassetteCard
                  title={longPressedBook.title}
                  coverUrl={longPressedBook.coverUrl}
                  grayscaleCovers={grayscaleCovers}
                  size="thumb"
                />
              ) : longPressedBook.coverUrl ? (
                <>
                  <img
                    src={longPressedBook.coverUrl.startsWith('http') ? `/api/proxy-image?url=${encodeURIComponent(longPressedBook.coverUrl)}` : longPressedBook.coverUrl}
                    className={`w-12 aspect-[2/3] object-cover rounded-lg border border-kindle-border/60 shadow-sm ${grayscaleCovers ? "grayscale-app" : ""}`}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const img = e.currentTarget;
                      img.style.display = 'none';
                      const fallback = img.nextElementSibling as HTMLElement | null;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  <div className="w-12 h-16 bg-kindle-bg rounded-lg border border-kindle-border/60 items-center justify-center hidden">
                    <BookOpen className="w-6 h-6 text-kindle-text-muted opacity-30" />
                  </div>
                </>
              ) : (
                <div className="w-12 h-16 bg-kindle-bg rounded-lg border border-kindle-border/60 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-kindle-text-muted opacity-30" />
                </div>
              )}
              <div className="overflow-hidden">
                <h4 className="font-serif font-bold text-sm leading-tight truncate">{longPressedBook.title}</h4>
                <p className="text-[11px] text-kindle-text-muted mt-1 truncate">{longPressedBook.author}</p>
                <span className="inline-block mt-1.5 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                  Format: {longPressedBook.extension || 'UNKNOWN'}
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

      {/* Bulk Tag Selection Modal */}
      {bulkTagModalOpen && (
        <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-2xl text-kindle-text font-sans">
            <h3 className="font-bold text-sm uppercase tracking-wider mb-2 flex items-center gap-2">
              <Tag className="w-4 h-4 text-kindle-accent" />
              Add Collection Tag ({selectedBookIds.size})
            </h3>
            <p className="text-[10px] text-kindle-text-muted mb-4">
              Select which tag/collection to apply to all selected ebooks:
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                {availableTags.length === 0 ? (
                  <p className="col-span-2 text-center py-4 text-[10px] text-kindle-text-muted italic">
                    No custom collections yet. Go back and add one!
                  </p>
                ) : (
                  availableTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => handleBulkAddTag(tag)}
                      className="text-[10px] font-semibold p-2.5 rounded-xl border border-kindle-border text-center hover:bg-kindle-bg hover:border-kindle-text transition truncate uppercase tracking-wider"
                    >
                      {tag}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-6 pt-4 border-t border-kindle-border/40">
              <button
                onClick={() => setBulkTagModalOpen(false)}
                className="px-4 py-2 border border-kindle-border text-kindle-text-muted rounded-xl text-xs font-semibold hover:bg-kindle-bg transition uppercase tracking-wider"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Bar for Manage Mode */}
      {isManageMode && selectedBookIds.size > 0 && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] max-w-lg w-[calc(100%-2rem)] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-kindle-card border border-kindle-border/80 rounded-2xl shadow-2xl p-3 flex items-center justify-between gap-3 text-sans">
            <div className="flex items-center gap-1.5 pl-2">
              <span className="text-[10px] font-extrabold text-kindle-bg bg-kindle-accent px-2 py-0.5 rounded-md uppercase tracking-wider">
                {selectedBookIds.size}
              </span>
              <span className="text-[10px] text-kindle-text font-bold uppercase tracking-widest hidden sm:inline">selected</span>
            </div>

            <div className="flex items-center gap-2">
              {/* Mark Status Group */}
              <select
                onChange={async (e) => {
                  const status = e.target.value;
                  if (!status) return;
                  await handleBulkStatusUpdate(status);
                  e.target.value = "";
                }}
                className="bg-kindle-bg border border-kindle-border rounded-xl px-2.5 py-1.5 text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent text-[9px] font-bold uppercase tracking-wider cursor-pointer"
              >
                <option value="">Mark As...</option>
                <option value="to-read">To Read</option>
                <option value="reading">Reading</option>
                <option value="completed">Completed</option>
              </select>

              {/* Add Collection */}
              <button
                onClick={() => setBulkTagModalOpen(true)}
                className="px-2.5 py-1.5 border border-kindle-border hover:border-kindle-text rounded-xl text-kindle-text-muted hover:text-kindle-text bg-kindle-bg transition cursor-pointer flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider"
                title="Add to Collection"
              >
                <Tag className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Tag</span>
              </button>

              {/* Bulk Delete */}
              <button
                onClick={() => setShowBulkDeleteConfirm(true)}
                className="px-2.5 py-1.5 bg-red-500/10 dark:bg-red-950/20 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/30 rounded-xl text-red-600 dark:text-red-400 transition cursor-pointer flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider"
                title="Delete Selected"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
