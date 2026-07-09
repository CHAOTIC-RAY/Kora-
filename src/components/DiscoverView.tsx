import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import JSZip from "jszip";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { storeBookFile, checkBookFileCached } from "../db/indexedDB";
import { inferBookTags } from "../lib/tagsHelper";
import { Search, BookOpen, Download, Globe, CircleCheck as CheckCircle2, Loader as Loader2, TriangleAlert as AlertTriangle, Circle as HelpCircle, ArrowRight, Database, ExternalLink, Compass, TrendingUp, Sparkles, BookMarked, ChevronRight, ChevronLeft, RefreshCw, X, Layers, Library } from "lucide-react";
import KoraLoading from "./KoraLoading";

interface DiscoverViewProps {
  userId: string;
  onBookAdded: (book: BookMetadata) => void;
  cachedBookIds: Set<string>;
  selectedBook: any | null;
  onSelectedBookChange: (book: any | null) => void;
  grayscaleCovers?: boolean;
  connectors?: Record<string, boolean>;
  zlibConfig?: any;
  initialQuery?: string | null;
  onClearInitialQuery?: () => void;
  onOpenBrowser?: (url: string) => void;
}

// Define all possible categories tied to their connector IDs
const ALL_CATEGORIES = [
  { id: "hardcover-fiction",    title: "NYT: Hardcover Fiction",    query: "hardcover-fiction" },
  { id: "hardcover-nonfiction", title: "NYT: Hardcover Nonfiction", query: "hardcover-nonfiction" },
  { id: "paperback-nonfiction", title: "NYT: Paperback Nonfiction", query: "paperback-nonfiction" },
  { id: "e-book-fiction",       title: "NYT: E-Book Fiction",       query: "e-book-fiction" },
  { id: "e-book-nonfiction",    title: "NYT: E-Book Nonfiction",    query: "e-book-nonfiction" },
  { id: "advice-how-to",        title: "Advice & How-To",           query: "advice-how-to" },
  { id: "childrens-middle-grade-hardcover", title: "Middle Grade", query: "childrens-middle-grade-hardcover" },
  { id: "young-adult-hardcover", title: "Young Adult", query: "young-adult-hardcover" },
];

export default function DiscoverView({ 
  userId, 
  onBookAdded, 
  cachedBookIds, 
  selectedBook,
  onSelectedBookChange,
  grayscaleCovers = false, 
  connectors = {},
  zlibConfig,
  initialQuery = null,
  onClearInitialQuery,
  onOpenBrowser
}: DiscoverViewProps) {
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [results, setResults] = useState<any[]>([]);
  const [searchMode, setSearchMode] = useState<boolean>(false);
  const [featuredData, setFeaturedData] = useState<Record<string, any[]>>({});
  const [loadingFeatured, setLoadingFeatured] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalResults, setTotalResults] = useState<number>(0);
  const [searchMeta, setSearchMeta] = useState<any>({});
  const [availableSourcesFromResults, setAvailableSourcesFromResults] = useState<Set<string>>(new Set());
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string>("all");

  const [hasMore, setHasMore] = useState<boolean>(false);
  // Background prefetch cache: page number → results
  const prefetchCache = React.useRef(new Map<number, any[]>());
  const prefetchingPage = React.useRef<number | null>(null);

  // Download states
  const [downloadProgress, setDownloadProgress] = useState<{
    step: "idle" | "requesting" | "downloading" | "saving" | "completed";
    percent: number;
    error: string | null;
  }>({ step: "idle", percent: 0, error: null });
  const [fetchingMirrors, setFetchingMirrors] = useState<boolean>(false);
  const [mirrors, setMirrors] = useState<any[]>([]);
  const [mirrorError, setMirrorError] = useState<string | null>(null);

  useEffect(() => {
    loadFeaturedContent();
  }, []);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      setSearchMode(true);
      handleSearch(initialQuery);
      onClearInitialQuery?.();
    }
  }, [initialQuery]);

  useEffect(() => {
    if (searchMode && query) {
      handleSearch(query);
    }
  }, [activeSource, currentPage]);

  async function loadFeaturedContent() {
    setLoadingFeatured(true);
    setError(null);
    try {
      const res = await fetch("/api/nytimes/overview");
      if (!res.ok) throw new Error("Failed to fetch NYT overview");
      const json = await res.json();
      
      const data: Record<string, any[]> = {};
      const lists = json.results?.lists || [];
      
      ALL_CATEGORIES.forEach(cat => {
        const nytList = lists.find((l: any) => l.list_name_encoded === cat.query);
        if (nytList) {
          data[cat.id] = nytList.books.map((b: any) => ({
            title: b.title,
            author: b.author,
            coverUrl: b.book_image,
            searchQuery: `${b.title} ${b.author}`
          }));
        } else {
          data[cat.id] = [];
        }
      });

      setFeaturedData(data);
    } catch (err: any) {
      console.error("Failed to load featured content:", err);
      // More descriptive error handling
      const errorMessage = err.message || "Unknown error";
      if (errorMessage.includes("NYT API Key")) {
        setError(`Featured content requires NYT_BOOKS_API_KEY to be configured in secrets.`);
      } else {
        setError(`Featured Content: ${errorMessage}`);
      }
    } finally {
      setLoadingFeatured(false);
    }
  }

  async function fetchPage(term: string, source: string, page: number): Promise<{ books: any[]; totalCount: number; hasMore: boolean }> {
    const res = await fetch(`/api/annas-archive/search?q=${encodeURIComponent(term.trim())}&source=${source}&page=${page}`);
    if (!res.ok) throw new Error(`Search failed with status: ${res.status}`);
    const data = await res.json();
    const books = (data.books || data.results || []).map((b: any) => ({
      ...b,
      sourceId: b.sourceId || "rave",
      coverUrl: b.coverUrl || b.image?.url || null,
    }));
    return { books, totalCount: data.totalCount || 0, hasMore: !!data.hasMore };
  }

  async function prefetchPage(term: string, source: string, page: number) {
    if (prefetchCache.current.has(page) || prefetchingPage.current === page) return;
    prefetchingPage.current = page;
    try {
      const { books } = await fetchPage(term, source, page);
      prefetchCache.current.set(page, books);
    } catch {
      // silently ignore prefetch failures
    } finally {
      prefetchingPage.current = null;
    }
  }

  async function handleSearch(e: React.FormEvent | string | number, sourceOverride?: string) {
    if (typeof e !== "string" && typeof e !== "number") {
      if (e) e.preventDefault();
    }

    const term = typeof e === "string" ? e : query;
    if (!term.trim()) return;

    // Reset page if it's a new search term
    const isNewTerm = typeof e === "string" && e !== query;
    if (isNewTerm) {
      setCurrentPage(1);
      prefetchCache.current.clear();
    }

    setLoading(true);
    setError(null);
    setSearchMode(true);

    if (typeof e === "string") setQuery(e);

    try {
      const source = sourceOverride || activeSource;
      const page = isNewTerm ? 1 : currentPage;

      // Check prefetch cache first
      const cached = prefetchCache.current.get(page);
      let mappedBooks: any[];
      let totalCount: number;
      let more: boolean;

      if (cached) {
        prefetchCache.current.delete(page);
        mappedBooks = cached;
        // Approximate — we'll still show what we have
        totalCount = totalResults;
        more = true;
      } else {
        const result = await fetchPage(term, source, page);
        mappedBooks = result.books;
        totalCount = result.totalCount;
        more = result.hasMore;
      }

      setResults(mappedBooks);
      setHasMore(more);
      setTotalResults(totalCount);
      setSearchMeta({});

      // Update available topics
      const topics = new Set<string>();
      mappedBooks.forEach((b: any) => {
        if (b.topic && b.topic.trim()) topics.add(b.topic.trim());
      });
      setAvailableTopics(Array.from(topics).sort());

      // Update available sources from results
      if (activeSource === "all") {
        const sources = new Set<string>();
        mappedBooks.forEach((b: any) => {
          const src = b.source?.toLowerCase() || "";
          if (src.includes("anna")) sources.add("annas");
          if (src.includes("libgen") || src.includes("genesis")) sources.add("libgen");
          if (src.includes("z-lib") || src.includes("zlib") || src.includes("z-library")) sources.add("zlib");
          if (src.includes("archive") || src.includes("ia")) sources.add("ia");
          if (src.includes("gutenberg")) sources.add("gutenberg");
          if (src.includes("open library") || src.includes("openlibrary")) sources.add("openlibrary");
          if (src.includes("standard ebooks") || src.includes("standard")) sources.add("standard");
        });
        setAvailableSourcesFromResults(sources);
      }

      // Background prefetch next page
      if (more) {
        prefetchPage(term, source, page + 1);
      }
    } catch (err: any) {
      console.error("Search error:", err);
      setError(err.message || "Search failed. Mirrors may be temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }

  function clearSearch() {
    setSearchMode(false);
    setResults([]);
    setQuery("");
    setError(null);
    setCurrentPage(1);
    setHasMore(false);
    setTotalResults(0);
    setActiveSource("all");
    prefetchCache.current.clear();
  }

  async function handleGetDownloadLinks(book: any) {
    onSelectedBookChange(book);
    setFetchingMirrors(true);
    setMirrors([]);
    setMirrorError(null);
    setDownloadProgress({ step: "idle", percent: 0, error: null });

    try {
      if (book.sourceId === "zlib") {
        let userId = undefined;
        let userKey = undefined;

        if (zlibConfig?.email && zlibConfig?.password) {
          const loginRes = await fetch(`/api/zlib/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: zlibConfig.email,
              password: zlibConfig.password,
              baseUrl: zlibConfig.baseUrl,
            })
          });
          if (loginRes.ok) {
            const loginData = await loginRes.json();
            if (loginData.user) {
              userId = loginData.user.id;
              userKey = loginData.user.remix_userkey;
            }
          }
        }

        const zRes = await fetch(`/api/zlib/download-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            book_id: book.id,
            book_hash: book.hash,
            baseUrl: zlibConfig?.baseUrl,
            user_id: userId,
            user_key: userKey
          })
        });
        const data = await zRes.json();
        
        if (data.error) throw new Error(data.error.message || data.error);
        if (data.download_link) {
          setMirrors([{ url: data.download_link, label: "Z-Library Direct Download", isDirect: true, sourceId: "zlib", zlibUserId: userId, zlibUserKey: userKey }]);
        } else if (data.file && data.file.download_link) {
           setMirrors([{ url: data.file.download_link, label: "Z-Library Direct Download", isDirect: true, sourceId: "zlib", zlibUserId: userId, zlibUserKey: userKey }]);
        } else {
          setMirrorError("No download link found for this book.");
        }
      } else {
        const res = await fetch(`/api/annas-archive/download?md5=${book.md5}`);
        const data = await res.json(); console.log("DATA:", data);
        if (data.error) throw new Error(data.error);

        const links = data.downloadLinks || data.options || [];
        setMirrors(links);
        if (links.length === 0) {
          setMirrorError("No download mirrors found for this book. Try searching again.");
        }
      }
    } catch (err: any) {
      setMirrorError(err.message || "Failed to retrieve download mirrors.");
    } finally {
      setFetchingMirrors(false);
    }
  }

  async function handleAutoDownload() {
    if (!selectedBook) return;
    const directMirrors = mirrors.filter(m => m.isDirect);
    if (directMirrors.length === 0) {
      setDownloadProgress({ 
        step: "idle", 
        percent: 0, 
        error: "No direct download mirrors are available. Please use a manual link below." 
      });
      return;
    }

    setDownloadProgress({ step: "requesting", percent: 10, error: null });

    for (let index = 0; index < directMirrors.length; index++) {
      const mirror = directMirrors[index];
      try {
        console.log(`Auto-downloading from mirror ${index + 1}/${directMirrors.length}: ${mirror.url}`);
        setDownloadProgress({ 
          step: `downloading (Mirror ${index + 1}/${directMirrors.length})`, 
          percent: 30 + Math.floor((index / directMirrors.length) * 30), 
          error: null 
        });

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

        const contentType = response.headers.get("content-type") || "";
        setDownloadProgress({ 
          step: "processing", 
          percent: 75, 
          error: null 
        });

        let fileBlob = await response.blob();
        let fileExtension = selectedBook.extension || "epub";

        if (contentType.includes("zip")) {
          try {
            const zip = await JSZip.loadAsync(fileBlob);
            const bookFile = Object.values(zip.files).find(f => !f.dir && (f.name.endsWith(".epub") || f.name.endsWith(".pdf")));
            if (bookFile) {
              fileBlob = await bookFile.async("blob");
              fileExtension = bookFile.name.split('.').pop()?.toLowerCase() || "epub";
            }
          } catch (e) { /* ignore */ }
        }

        setDownloadProgress({ step: "saving", percent: 90, error: null });
        const id = selectedBook.md5 || Math.random().toString(36).substring(7);
        await storeBookFile(id, fileBlob, `${selectedBook.title}.${fileExtension}`, fileExtension);

        const newBook: BookMetadata = {
          id,
          title: selectedBook.title,
          author: selectedBook.author,
          extension: fileExtension,
          size: selectedBook.size || "Unknown",
          language: selectedBook.language || "English",
          coverUrl: selectedBook.coverUrl,
          md5: selectedBook.md5,
          source: "Kora Store",
          tags: inferBookTags(selectedBook.title, selectedBook.author, fileExtension),
          status: "to-read",
          progress: { percent: 0, lastReadTime: Date.now() },
          dateAdded: Date.now()
        };

        await syncBookToCloud(userId, newBook);
        onBookAdded(newBook);
        
        // Log to downloads manager
        const dlLog = JSON.parse(localStorage.getItem("kora_downloads_log") || "[]");
        dlLog.unshift({
          title: newBook.title,
          author: newBook.author,
          status: "completed",
          size: newBook.size,
          timestamp: Date.now()
        });
        localStorage.setItem("kora_downloads_log", JSON.stringify(dlLog.slice(0, 50)));

        setDownloadProgress({ step: "completed", percent: 100, error: null });
        setTimeout(() => onSelectedBookChange(null), 1500);
        return; // Success!

      } catch (err: any) {
        console.warn(`Mirror ${mirror.url} failed during auto-download:`, err);
        if (index === directMirrors.length - 1) {
          setDownloadProgress({ 
            step: "idle", 
            percent: 0, 
            error: "All direct mirrors failed. Please try a manual download link below or upload a file." 
          });
        }
      }
    }
  }

  const filteredResults = results.filter(b => {
    if (selectedTopic !== "all") {
      return b.topic === selectedTopic;
    }
    return true;
  });

  async function handleDownloadFromMirror(mirror: any) {
    if (!selectedBook) return;

    // Try direct proxy download first to store in app's local storage
    setDownloadProgress({ step: "requesting", percent: 10, error: null });

    try {
      let response: Response;

      if (mirror.sourceId === "zlib") {
        response = await fetch(`/api/zlib/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            download_url: mirror.url,
            user_id: mirror.zlibUserId,
            user_key: mirror.zlibUserKey
          })
        });
      } else {
        const mirrorUrl = typeof mirror === "string" ? mirror : mirror.url;
        const proxyUrl = `/api/proxy-file?url=${encodeURIComponent(mirrorUrl)}`;
        setDownloadProgress({ step: "downloading", percent: 30, error: null });
        response = await fetch(proxyUrl);
      }

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

      const contentType = response.headers.get("content-type") || "";
      setDownloadProgress({ step: "downloading", percent: 70, error: null });

      let fileBlob = await response.blob();
      let fileExtension = selectedBook.extension || "epub";

      if (contentType.includes("zip")) {
        try {
          const zip = await JSZip.loadAsync(fileBlob);
          const bookFile = Object.values(zip.files).find(f => !f.dir && (f.name.endsWith(".epub") || f.name.endsWith(".pdf")));
          if (bookFile) {
            fileBlob = await bookFile.async("blob");
            fileExtension = bookFile.name.split('.').pop()?.toLowerCase() || "epub";
          }
        } catch (e) { /* ignore ZIP parse error */ }
      }

      setDownloadProgress({ step: "saving", percent: 90, error: null });
      const id = selectedBook.md5 || Math.random().toString(36).substring(7);
      await storeBookFile(id, fileBlob, `${selectedBook.title}.${fileExtension}`, fileExtension);

      const newBook: BookMetadata = {
        id,
        title: selectedBook.title,
        author: selectedBook.author,
        extension: fileExtension,
        size: selectedBook.size || "Unknown",
        language: selectedBook.language || "English",
        coverUrl: selectedBook.coverUrl,
        md5: selectedBook.md5,
        source: "Kora Store",
        tags: inferBookTags(selectedBook.title, selectedBook.author, fileExtension),
        status: "to-read",
        progress: { percent: 0, lastReadTime: Date.now() },
        dateAdded: Date.now()
      };

      await syncBookToCloud(userId, newBook);
      onBookAdded(newBook);

      // Log to downloads manager
      const dlLog = JSON.parse(localStorage.getItem("kora_downloads_log") || "[]");
      dlLog.unshift({
        title: newBook.title,
        author: newBook.author,
        status: "completed",
        size: newBook.size,
        timestamp: Date.now()
      });
      localStorage.setItem("kora_downloads_log", JSON.stringify(dlLog.slice(0, 50)));

      setDownloadProgress({ step: "completed", percent: 100, error: null });
      setTimeout(() => onSelectedBookChange(null), 1200);
    } catch (err: any) {
      // If proxy download failed (CAPTCHA, Cloudflare, etc), open in in-app browser
      const errMsg = err.message || "Failed to download from this mirror.";
      if (errMsg.toLowerCase().includes("captcha") ||
          errMsg.toLowerCase().includes("cloudflare") ||
          errMsg.toLowerCase().includes("verification") ||
          errMsg.toLowerCase().includes("blocked")) {
        // Fall back to in-app browser for manual download
        if (onOpenBrowser) {
          onOpenBrowser(mirror.url);
          onSelectedBookChange(null);
          return;
        }
      }
      setDownloadProgress({ step: "idle", percent: 0, error: errMsg });
    }
  }

  function handleMirrorClick(m: any) {
    // Always try direct download first - it will store in app's IndexedDB
    // and fall back to in-app browser on CAPTCHA/Cloudflare errors
    if (m.isDirect || m.url.includes("libgen") || m.url.includes("library.lol")) {
      handleDownloadFromMirror(m);
    } else if (onOpenBrowser) {
      // Open non-direct links in the in-app browser for manual navigation
      onOpenBrowser(m.url);
      onSelectedBookChange(null);
    } else {
      window.open(m.url, '_blank');
    }
  }

  return (
    <>
      <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Header */}
        <header className="flex flex-col gap-6">
          <div className="space-y-1">
            <h2 className="text-3xl font-lexend font-bold tracking-tight text-kindle-text">Discover</h2>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[10px] text-kindle-text-muted font-bold uppercase tracking-[0.2em]">
                Powered by NYT Best Sellers & Rave Engine
              </p>
            </div>
          </div>

        {/* Search Bar */}
        <div className="space-y-4">
          <form onSubmit={handleSearch} className="relative group max-w-2xl">
            <Search className="w-5 h-5 text-kindle-text-muted absolute left-4 top-1/2 -translate-y-1/2 group-focus-within:text-kindle-accent transition" />
            <input
              type="text"
              placeholder="Search millions of books, authors, ISBNs..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-12 pr-32 py-4 bg-kindle-card border border-kindle-border rounded-2xl text-sm transition focus:ring-2 focus:ring-kindle-accent/20 outline-none shadow-sm placeholder:text-kindle-text-muted/60 group-hover:border-kindle-accent/40 font-sans"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchMode && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="p-2 rounded-xl hover:bg-kindle-bg text-kindle-text-muted transition"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                type="submit"
                className="px-5 py-2 bg-kindle-text text-kindle-bg rounded-xl font-bold text-[11px] uppercase tracking-widest hover:bg-kindle-accent transition"
              >
                Search
              </button>
            </div>
          </form>

          {/* Source & Topic Filters */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: "all", label: "All", icon: Globe },
                { id: "annas", label: "Anna's Archive", icon: Database },
                { id: "libgen", label: "LibGen", icon: Layers },
                { id: "zlib", label: "Z-Library", icon: Library },
                { id: "ia", label: "Archive.org", icon: BookOpen },
                { id: "gutenberg", label: "Gutenberg", icon: BookMarked },
                { id: "openlibrary", label: "Open Library", icon: ExternalLink },
                { id: "standard", label: "Standard Ebooks", icon: Library },
              ]
              .filter(src => src.id === "all" || !searchMode || availableSourcesFromResults.has(src.id))
              .map((src) => (
                <button
                  key={src.id}
                  onClick={() => {
                    setActiveSource(src.id);
                    setCurrentPage(1);
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border ${
                    activeSource === src.id
                      ? "bg-kindle-text text-kindle-bg border-kindle-text shadow-md"
                      : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-accent/50"
                  }`}
                >
                  <src.icon className="w-3.5 h-3.5" />
                  {src.label}
                </button>
              ))}
            </div>

            {availableTopics.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 max-h-24 overflow-y-auto pr-2 scrollbar-hide">
                <span className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted mr-1 sticky top-0 bg-kindle-bg py-1">Topics:</span>
                <button
                  onClick={() => setSelectedTopic("all")}
                  className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest transition border ${
                    selectedTopic === "all"
                      ? "bg-kindle-accent/10 text-kindle-accent border-kindle-accent/30"
                      : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-accent/30"
                  }`}
                >
                  All
                </button>
                {availableTopics.map((topic) => (
                  <button
                    key={topic}
                    onClick={() => setSelectedTopic(topic)}
                    className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest transition border truncate max-w-[150px] ${
                      selectedTopic === topic
                        ? "bg-kindle-accent/10 text-kindle-accent border-kindle-accent/30"
                        : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-accent/30"
                    }`}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Search Results */}
      {searchMode && (
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-lexend font-bold">
              {loading ? "Searching archives…" : `Results for "${query}"`}
            </h3>
            <button
              onClick={clearSearch}
              className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          </div>

          {loading ? (
            <div className="py-24 flex flex-col items-center justify-center gap-4">
              <KoraLoading />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted animate-pulse">
                Querying global archives…
              </p>
            </div>
          ) : error ? (
            <div className="py-16 flex flex-col items-center gap-4 text-center">
              <AlertTriangle className="w-10 h-10 text-amber-500" />
              <p className="text-sm font-bold text-kindle-text-muted max-w-sm">{error}</p>
              <button
                onClick={() => handleSearch(query)}
                className="flex items-center gap-2 px-4 py-2 border border-kindle-border rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-kindle-card transition"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
              {filteredResults.map((book) => (
                <div 
                  key={book.md5 || book.id || Math.random()} 
                  className={`group cursor-pointer space-y-2.5 p-2 rounded-3xl transition-all duration-300 border-2 ${
                    book.exactMatch 
                      ? "bg-kindle-accent/[0.03] border-kindle-accent/30 shadow-lg ring-1 ring-kindle-accent/10" 
                      : "border-transparent hover:bg-kindle-card/50"
                  }`}
                  onClick={() => handleGetDownloadLinks(book)}
                >
                  <div className={`aspect-[3/4] bg-kindle-card rounded-2xl border ${book.exactMatch ? "border-kindle-accent/40 shadow-inner" : "border-kindle-border"} overflow-hidden relative shadow-sm group-hover:shadow-xl transition-all duration-500`}>
                    {book.coverUrl ? (
                      <img
                        src={book.coverUrl}
                        alt={book.title}
                        className={`w-full h-full object-cover group-hover:scale-105 transition duration-500 ${grayscaleCovers ? "grayscale" : ""}`}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          const attempt = parseInt(target.dataset.attempt || "0");
                          target.dataset.attempt = String(attempt + 1);

                          // Attempt 1: if we have a real ISBN, try OpenLibrary by ISBN
                          if (attempt === 0 && book.isbn && /^\d{10,13}$/.test(book.isbn)) {
                            target.src = `https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg`;
                            return;
                          }
                          // Attempt 2: try cover redirect API (NYT + OpenLibrary title search)
                          if (attempt === 1) {
                            const encodedTitle = encodeURIComponent(book.title);
                            const encodedAuthor = encodeURIComponent(book.author || "");
                            target.src = `/api/cover-redirect?title=${encodedTitle}&author=${encodedAuthor}&md5=${book.md5}`;
                            return;
                          }
                          // All fallbacks exhausted: show typography placeholder
                          target.style.display = "none";
                          const parent = target.parentElement;
                          if (parent && !parent.querySelector(".kora-typo-cover")) {
                            const div = document.createElement("div");
                            div.className = "kora-typo-cover w-full h-full flex flex-col items-center justify-center p-4 text-center bg-kindle-card absolute inset-0";
                            div.innerHTML = `
                              <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;opacity:0.3;margin-bottom:6px;">${(book.author || "Author").substring(0, 30)}</div>
                              <div style="font-size:11px;font-weight:700;font-family:serif;line-height:1.3;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">${book.title}</div>
                              <div style="position:absolute;bottom:10px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;opacity:0.3;">${book.extension || "BOOK"}</div>
                            `;
                            parent.style.position = "relative";
                            parent.appendChild(div);
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-kindle-card">
                        <div className="text-[8px] font-bold uppercase tracking-[0.15em] opacity-30 mb-1.5">{(book.author || "Author").substring(0, 25)}</div>
                        <div className="text-[11px] font-serif font-bold leading-snug line-clamp-4 text-center">{book.title}</div>
                        <div className="absolute bottom-2.5 text-[8px] font-bold uppercase tracking-widest opacity-25">{book.extension || "BOOK"}</div>
                      </div>
                    )}
                    {/* Exact Match Indicator */}
                    {book.exactMatch && (
                      <div className="absolute top-2 right-2 bg-kindle-accent text-white px-2 py-0.5 rounded-full text-[7px] font-bold uppercase tracking-widest shadow-lg z-10">
                        MATCH
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-300">
                      <div className="bg-white text-kindle-text p-3.5 rounded-full shadow-2xl scale-75 group-hover:scale-100 transition duration-500">
                        <Download className="w-5 h-5" />
                      </div>
                    </div>
                    {/* Format badge */}
                    {book.extension && (
                      <div className="absolute bottom-2 left-2 bg-kindle-text text-kindle-bg text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
                        {book.extension}
                      </div>
                    )}
                  </div>
                  <div className="space-y-0.5 pr-1">
                    <h4 className="text-[11px] font-bold font-serif line-clamp-2 leading-tight group-hover:text-kindle-accent transition">{book.title}</h4>
                    {book.topic && (
                      <p className="text-[8px] text-kindle-accent font-bold uppercase tracking-wider mt-1 truncate">
                        {book.topic}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span className="text-[10px] text-kindle-text-muted font-sans font-medium">
                        {book.author}
                      </span>
                      {book.year && (
                        <span className="text-[10px] text-kindle-text-muted/60">
                          · {book.year}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[8px] font-bold uppercase tracking-widest text-kindle-accent/80 flex items-center gap-1">
                        <Globe className="w-2 h-2" />
                        {book.source === "Library Genesis" ? "LibGen" : book.source === "Anna's Archive" ? "Anna's" : book.source}
                      </span>
                      {book.pages && book.pages !== "0" && (
                        <span className="text-[8px] font-bold uppercase tracking-widest text-kindle-text-muted/60">
                          · {book.pages} pp
                        </span>
                      )}
                      {book.size && book.size !== "Unknown" && (
                        <span className="text-[8px] font-bold uppercase tracking-widest text-kindle-text-muted/60">
                          · {book.size}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination Controls */}
          {!loading && !error && results.length > 0 && (
            <div className="pt-10 flex flex-col items-center gap-4">
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="flex items-center gap-2 px-5 py-2.5 bg-kindle-card border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-kindle-bg disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </button>
                <div className="flex flex-col items-center px-6 py-2.5 bg-kindle-text/5 rounded-xl border border-kindle-text/10">
                  <span className="text-[10px] font-bold tracking-widest text-kindle-text">
                    PAGE {currentPage}
                  </span>
                  {totalResults > 0 ? (
                    <span className="text-[8px] font-bold uppercase tracking-widest text-kindle-text-muted mt-0.5">
                      {totalResults.toLocaleString()} results{hasMore ? "+" : ""}
                    </span>
                  ) : (
                    <span className="text-[8px] font-bold uppercase tracking-widest text-kindle-text-muted mt-0.5">
                      {results.length} results
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setCurrentPage(prev => prev + 1)}
                  disabled={!hasMore}
                  className="flex items-center gap-2 px-5 py-2.5 bg-kindle-card border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-kindle-bg disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              {prefetchCache.current.has(currentPage + 1) && (
                <p className="text-[8px] text-emerald-600 font-bold uppercase tracking-widest flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                  Next page ready
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {!searchMode && (
        <div className="space-y-14">
          {error && (
            <div className="p-8 bg-amber-500/5 border border-amber-500/20 rounded-3xl flex flex-col items-center gap-4 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-kindle-text">Trending Content Unavailable</p>
                <p className="text-xs text-kindle-text-muted max-w-sm">{error}</p>
              </div>
              <button 
                onClick={loadFeaturedContent}
                className="px-4 py-2 bg-kindle-card border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-kindle-bg transition"
              >
                Retry Loading
              </button>
            </div>
          )}
          {loadingFeatured ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-2.5 animate-pulse">
                  <div className="aspect-[3/4] bg-kindle-card rounded-2xl border border-kindle-border" />
                  <div className="h-3 bg-kindle-card rounded w-3/4" />
                  <div className="h-2 bg-kindle-card rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : (
            ALL_CATEGORIES.map((cat) => {
              const books = featuredData[cat.id] || [];
              if (books.length === 0) return null;
              return (
                <section key={cat.id} className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-kindle-card rounded-xl border border-kindle-border">
                        {cat.id.includes("fiction") ? <BookMarked className="w-4 h-4 text-kindle-accent" /> : <Sparkles className="w-4 h-4 text-kindle-accent" />}
                      </div>
                      <h3 className="text-lg font-lexend font-bold tracking-tight">{cat.title}</h3>
                    </div>
                    <button
                      onClick={() => handleSearch(cat.query)}
                      className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-kindle-card border border-transparent hover:border-kindle-border"
                    >
                      View More <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="flex gap-4 overflow-x-auto pb-4 scroll-smooth snap-x -mx-4 px-4">
                    {books.map((book, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSearch(book.searchQuery || book.title)}
                        className="flex-shrink-0 w-32 sm:w-40 space-y-2.5 cursor-pointer group snap-start"
                      >
                        <div className="aspect-[3/4] bg-kindle-card rounded-xl border border-kindle-border overflow-hidden relative shadow-sm group-hover:shadow-lg transition-all duration-500">
                          {book.coverUrl ? (
                            <img
                              src={book.coverUrl}
                              alt={book.title}
                              className={`w-full h-full object-cover group-hover:scale-105 transition duration-500 ${grayscaleCovers ? "grayscale" : ""}`}
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-kindle-card">
                              <BookOpen className="w-6 h-6 text-kindle-text-muted mb-1.5 opacity-20" />
                              <span className="text-[7px] font-bold text-kindle-text-muted uppercase text-center line-clamp-3">{book.title}</span>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition" />
                        </div>
                        <div className="space-y-0.5">
                          <h4 className="text-[10px] font-bold font-serif line-clamp-2 leading-snug group-hover:text-kindle-accent transition">{book.title}</h4>
                          <p className="text-[9px] text-kindle-text-muted font-sans truncate">{book.author}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })
          )}

          {/* Quick Categories & Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="md:col-span-2 bg-kindle-text text-kindle-bg rounded-3xl p-10 relative overflow-hidden group">
              <div className="relative z-10 space-y-5 max-w-md">
                <div className="inline-flex px-3 py-1 bg-kindle-bg/10 backdrop-blur-md rounded-full text-[8px] font-bold uppercase tracking-widest border border-white/10">
                  Global Search Active
                </div>
                <h3 className="text-3xl font-lexend font-bold leading-tight">Unified Access via Rave Engine.</h3>
                <p className="text-sm text-kindle-bg/70 leading-relaxed font-sans">
                  Instantly search across millions of titles with optimized direct download mirrors.
                </p>
                <div className="flex items-center gap-4 pt-2">
                  <div className="flex -space-x-2">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="w-8 h-8 rounded-full border-2 border-kindle-text bg-kindle-card flex items-center justify-center text-[10px] font-bold">
                        {String.fromCharCode(64 + i)}
                      </div>
                    ))}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">Millions of books indexed</span>
                </div>
              </div>
              <div className="absolute -right-10 -bottom-10 opacity-10 group-hover:opacity-20 transition-opacity duration-1000">
                <Globe className="w-64 h-64 rotate-12" />
              </div>
            </div>

            <div className="bg-kindle-card border border-kindle-border rounded-3xl p-8 flex flex-col justify-between group hover:border-kindle-accent transition-all duration-500">
              <div className="space-y-3">
                <div className="w-12 h-12 bg-kindle-bg rounded-2xl flex items-center justify-center border border-kindle-border shadow-sm group-hover:scale-110 transition duration-500">
                  <TrendingUp className="w-6 h-6 text-kindle-accent" />
                </div>
                <h3 className="text-lg font-lexend font-bold">NYT Best Sellers</h3>
                <p className="text-xs text-kindle-text-muted font-sans leading-relaxed">
                  Always up-to-date with the latest trending literature and expert recommendations.
                </p>
              </div>
              <div className="mt-8 grid grid-cols-2 gap-2">
                {ALL_CATEGORIES.slice(0, 4).map(cat => (
                  <button 
                    key={cat.id}
                    onClick={() => handleSearch(cat.query)}
                    className="p-2 text-[9px] font-bold uppercase tracking-widest border border-kindle-border rounded-xl hover:bg-kindle-text hover:text-kindle-bg transition-colors"
                  >
                    {cat.title.replace("NYT: ", "").split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Download Modal */}
      {selectedBook && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => onSelectedBookChange(null)} />
          <div className="relative w-full max-w-md bg-kindle-card border border-kindle-border rounded-3xl shadow-2xl p-8 animate-in zoom-in fade-in duration-200">
            <div className="flex justify-between items-start mb-6">
              <div className="space-y-1 overflow-hidden flex-1 pr-4">
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted font-sans">Direct Download</span>
                <h3 className="text-sm font-lexend font-bold truncate">{selectedBook.title}</h3>
                <p className="text-[10px] text-kindle-text-muted font-sans">{selectedBook.author}</p>
              </div>
              <button onClick={() => onSelectedBookChange(null)} className="p-2 hover:bg-kindle-bg rounded-xl transition shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {fetchingMirrors ? (
              <div className="py-12 text-center space-y-4">
                <Loader2 className="w-8 h-8 animate-spin text-kindle-accent mx-auto" />
                <p className="text-xs text-kindle-text-muted font-bold uppercase tracking-widest font-sans">Scanning mirrors…</p>
              </div>
            ) : mirrorError ? (
              <div className="py-8 text-center space-y-3">
                <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
                <p className="text-xs text-kindle-text-muted font-sans">{mirrorError}</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[20rem] overflow-y-auto pr-1">
                {/* Auto-download banner/button */}
                {mirrors.some(m => m.isDirect) && (
                  <button
                    onClick={handleAutoDownload}
                    className="w-full p-4 rounded-2xl border border-dashed border-emerald-500/40 hover:border-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/10 transition text-left flex items-center justify-between group shadow-sm cursor-pointer"
                  >
                    <div className="flex-1 pr-2">
                      <p className="text-xs font-bold text-emerald-600 font-sans flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                        Auto-Download (Recommended)
                      </p>
                      <p className="text-[10px] text-emerald-600/70 font-medium font-sans mt-0.5">
                        Scans and downloads from the fastest active mirror automatically.
                      </p>
                    </div>
                    <Download className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition shrink-0 ml-2 animate-bounce" />
                  </button>
                )}

                <div className="text-[10px] font-bold text-kindle-text-muted uppercase tracking-wider border-b border-kindle-border pb-1.5 mt-2 flex justify-between">
                  <span>All Mirror Options</span>
                  <span className="text-[8px] opacity-60">Opens in new tab if blocked</span>
                </div>

                <div className="space-y-2">
                  {mirrors.map((m, i) => (
                    <button
                      key={i}
                      onClick={() => handleMirrorClick(m)}
                      className={`w-full p-4 rounded-2xl border transition text-left group flex items-center justify-between cursor-pointer ${
                        m.isDirect 
                          ? "border-kindle-border hover:border-kindle-accent bg-kindle-bg hover:bg-kindle-card" 
                          : "border-kindle-border/60 hover:border-amber-500/60 bg-kindle-bg/40 hover:bg-kindle-card/60"
                      }`}
                      title={m.isDirect ? "Download via Server" : "Open Mirror in New Tab"}
                    >
                      <div className="overflow-hidden flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold font-sans truncate pr-2">{m.label}</p>
                          {m.isDirect ? (
                            <span className="px-1.5 py-0.5 text-[8px] font-bold text-emerald-600 bg-emerald-500/10 rounded uppercase tracking-wider shrink-0">Direct</span>
                          ) : (
                            <span className="px-1.5 py-0.5 text-[8px] font-bold text-amber-600 bg-amber-500/10 rounded uppercase tracking-wider shrink-0">Web Page</span>
                          )}
                        </div>
                        <p className="text-[9px] text-kindle-text-muted truncate font-mono mt-0.5">{m.url}</p>
                      </div>
                      {m.isDirect ? (
                        <Download className="w-4 h-4 text-kindle-text-muted group-hover:text-kindle-accent transition shrink-0 ml-2" />
                      ) : (
                        <ExternalLink className="w-4 h-4 text-kindle-text-muted group-hover:text-amber-500 transition shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {downloadProgress.step !== "idle" && (
              <div className="mt-5 p-4 bg-kindle-bg border border-kindle-border rounded-2xl space-y-3">
                {downloadProgress.step === "completed" ? (
                  <div className="flex items-center gap-2 text-emerald-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="text-xs font-bold uppercase tracking-widest font-sans">Added to Library!</span>
                  </div>
                ) : downloadProgress.error ? (
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-xs font-sans">{downloadProgress.error}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-kindle-accent" />
                      <span className="text-[10px] font-bold uppercase tracking-widest font-sans capitalize">{downloadProgress.step}…</span>
                    </div>
                    <div className="w-full h-1.5 bg-kindle-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-kindle-accent transition-all duration-500 rounded-full"
                        style={{ width: `${downloadProgress.percent}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
