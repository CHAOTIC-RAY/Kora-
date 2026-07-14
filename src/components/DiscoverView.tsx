import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import JSZip from "jszip";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { tempStorage } from "../lib/tempStorage";
import { storeBookFile, checkBookFileCached } from "../db/indexedDB";
import { inferBookTags } from "../lib/tagsHelper";
import { Search, BookOpen, Download, Globe, CircleCheck as CheckCircle2, Loader as Loader2, TriangleAlert as AlertTriangle, Circle as HelpCircle, ArrowRight, Database, ExternalLink, Compass, TrendingUp, Sparkles, BookMarked, ChevronRight, ChevronLeft, RefreshCw, X, Layers, Library } from "lucide-react";
import KoraLoading from "./KoraLoading";
import HardcoverCommunity from "./HardcoverCommunity";

interface DiscoverViewProps {
  userId: string;
  books: BookMetadata[];
  onBookAdded: (book: BookMetadata) => void;
  cachedBookIds: Set<string>;
  selectedBook: any | null;
  onSelectedBookChange: (book: any | null) => void;
  grayscaleCovers?: boolean;
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
  books = [],
  onBookAdded, 
  cachedBookIds, 
  selectedBook,
  onSelectedBookChange,
  grayscaleCovers = false, 
  zlibConfig,
  initialQuery = null,
  onClearInitialQuery,
  onOpenBrowser
}: DiscoverViewProps) {
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [results, setResults] = useState<any[]>([]);
  const observerTargetRef = React.useRef<HTMLDivElement | null>(null);
  const [searchMode, setSearchMode] = useState<boolean>(false);
  const [featuredData, setFeaturedData] = useState<Record<string, any[]>>({});
  const [selectedFeaturedBook, setSelectedFeaturedBook] = useState<any | null>(null);
  const [featuredBookDetails, setFeaturedBookDetails] = useState<any | null>(null);
  const [similarBooks, setSimilarBooks] = useState<any[]>([]);
  const [loadingFeaturedDetails, setLoadingFeaturedDetails] = useState<boolean>(false);
  const [loadingSimilar, setLoadingSimilar] = useState<boolean>(false);
  const [metadataSource, setMetadataSource] = useState<"google" | "nyt" | "openlibrary">(() => {
    return tempStorage.get<any>("preferred_source") || "google";
  });
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
  // Community (Hardcover) data fetched alongside search results
  const [communityBook, setCommunityBook] = useState<any | null>(null);
  // Background prefetch cache: page number → results
  const prefetchCache = React.useRef(new Map<number, any[]>());
  const prefetchingPage = React.useRef<number | null>(null);
  const [feedNotice, setFeedNotice] = useState<string | null>(null);

  // New NYT Category Detail States
  const [viewingCategory, setViewingCategory] = useState<any | null>(null);
  const [categoryBooks, setCategoryBooks] = useState<any[]>([]);
  const [categoryPreviousDate, setCategoryPreviousDate] = useState<string | null>(null);
  const [loadingCategoryMore, setLoadingCategoryMore] = useState<boolean>(false);
  const [loadingCategory, setLoadingCategory] = useState<boolean>(false);

  // Download states
  const [downloadProgress, setDownloadProgress] = useState<{
    step: "idle" | "requesting" | "downloading" | "saving" | "completed";
    percent: number;
    error: string | null;
  }>({ step: "idle", percent: 0, error: null });
  const [fetchingMirrors, setFetchingMirrors] = useState<boolean>(false);
  const [mirrors, setMirrors] = useState<any[]>([]);
  const [mirrorError, setMirrorError] = useState<string | null>(null);

  // Detailed book explorer popup states
  const [selectedVariant, setSelectedVariant] = useState<any | null>(null);
  const [verifiedDetails, setVerifiedDetails] = useState<{
    description?: string;
    subjects?: string[];
    ratings?: number;
    pageCount?: number;
    publishYear?: string;
    publisher?: string;
    isBestseller?: boolean;
    bestsellerRank?: string;
    weeksOnList?: number;
    bestsellerCategory?: string;
    nytReviewSnippet?: string;
    language?: string;
    coverUrl?: string;
    industryIdentifiers?: any[];
    source: string;
  } | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<boolean>(false);
  const [readMoreExpanded, setReadMoreExpanded] = useState<boolean>(false);

  // Recent Searches state
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("kora_recent_searches");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

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

  useEffect(() => {
    if (!hasMore || loading || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTargetRef.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, loading, loadingMore]);

  async function loadFeaturedContent(forceRefresh = false) {
    setLoadingFeatured(true);
    setError(null);
    try {
      const todayString = new Date().toDateString();
      const cachedDate = localStorage.getItem("kora_nyt_featured_date");
      const cachedFeed = localStorage.getItem("kora_nyt_featured_feed");

      let json: any;
      if (!forceRefresh && cachedDate === todayString && cachedFeed) {
        console.log("[NYT Cache] Loaded daily discover feed from localStorage");
        json = JSON.parse(cachedFeed);
      } else {
        console.log("[NYT Cache] Fetching fresh NYT overview...");
        const res = await fetch("/api/nytimes/overview");
        if (!res.ok) throw new Error("Failed to fetch NYT overview");
        json = await res.json();

        // Detect an upstream NYT fault (bad key, quota, outage) and tell the user.
        if (json?.fault || (json?.error && !json?.results?.lists?.length)) {
          setError(`The NYT Best Sellers API rejected the configured key (${json?.fault?.faultstring || "invalid"}). Discover is showing popular picks via the Rave Engine instead. Check NYT_BOOKS_API_KEY in Cloudflare.`);
        } else {
          setError(null);
        }
        setFeedNotice(json?.notice || (json?.source === "rave-fallback" ? "NYT Best Sellers API unavailable — showing popular picks via Rave Engine." : null));

        // Save to cache for today only if it's NOT a fallback/error
        const isFallback = json?.source === "rave-fallback" || json?.fault || (json?.error && !json?.results?.lists?.length);
        if (!isFallback) {
          localStorage.setItem("kora_nyt_featured_date", todayString);
          localStorage.setItem("kora_nyt_featured_feed", JSON.stringify(json));
        } else {
          // If it is a fallback, clean any stale cache so we don't lock onto it
          localStorage.removeItem("kora_nyt_featured_date");
          localStorage.removeItem("kora_nyt_featured_feed");
        }
      }

      const data: Record<string, any[]> = {};
      const lists = json.results?.lists || [];

      ALL_CATEGORIES.forEach(cat => {
        const nytList = lists.find((l: any) => l.list_name_encoded === cat.query);
        if (nytList) {
          const seen = new Set<string>();
          const uniqueBooks: any[] = [];
          (nytList.books || []).forEach((b: any) => {
            const key = `${(b.title || "").toLowerCase().trim()}___${(b.author || "").toLowerCase().trim()}`;
            if (!seen.has(key)) {
              seen.add(key);
              
              const cleanTitle = (b.title || "")
                .split(':')[0]
                .replace(/\b\d{10,13}\b/g, '') // Remove ISBNs
                .replace(/\(.*\)/g, '')
                .replace(/volume\s+\d+/gi, '')
                .replace(/book\s+\d+/gi, '')
                .replace(/[^\w\s-]/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
                
              const cleanAuthor = (b.author || "")
                .split(',')[0]
                .replace(/\b\d{4}-\d{4}\b/g, '') // 1922-2012
                .replace(/\bUnknown\b/gi, '')
                .replace(/\(.*\)/g, '')
                .replace(/[^\w\s-]/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();

              uniqueBooks.push({
                title: b.title,
                author: b.author,
                coverUrl: b.book_image,
                searchQuery: `${cleanTitle} ${cleanAuthor}`.trim()
              });
            }
          });
          data[cat.id] = uniqueBooks;
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

  const fetchFeaturedMetadata = async (title: string, author: string, forceSource?: "google" | "nyt" | "openlibrary") => {
    setLoadingFeaturedDetails(true);
    setFeaturedBookDetails(null);
    setSimilarBooks([]);
    setReadMoreExpanded(false);
    const sourceToUse = forceSource || metadataSource;
    
    try {
      // 1. Google Books (Preferred Default)
      if (sourceToUse === "google") {
        const q = encodeURIComponent(`intitle:${title} inauthor:${author}`);
        const res = await fetch(`/api/google-books/search?q=${q}`);
        if (res.ok) {
          const data = await res.json();
          if (data.items && data.items.length > 0) {
            const info = data.items[0].volumeInfo;
            setFeaturedBookDetails({
              ...info,
              title: info.title,
              authors: info.authors,
              description: info.description || selectedFeaturedBook.description,
              pageCount: info.pageCount,
              publishedDate: info.publishedDate,
              publisher: info.publisher,
              language: info.language,
              industryIdentifiers: info.industryIdentifiers || [],
              categories: info.categories || [],
              averageRating: info.averageRating,
              ratingsCount: info.ratingsCount,
              previewLink: info.previewLink,
              source: "Google Books"
            });

            // Fetch similar books based on categories
            if (info.categories && info.categories.length > 0) {
              fetchSimilarBooks(info.categories[0]);
            }
            setLoadingFeaturedDetails(false);
            return;
          }
        }
      }

      // 2. New York Times (Verified Raw)
      if (sourceToUse === "nyt") {
        const nytRes = await fetch(`/api/nytimes/book-details-raw?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`);
        if (nytRes.ok) {
          const data = await nytRes.json();
          if (data && data.results && data.results.length > 0) {
            const book = data.results[0];
            setFeaturedBookDetails({
              title: book.title,
              authors: [book.author],
              description: book.description || selectedFeaturedBook.description,
              pageCount: null, 
              publishedDate: null,
              publisher: book.publisher,
              language: "en",
              industryIdentifiers: book.isbns?.map((i: any) => ({ type: "ISBN", identifier: i.isbn13 || i.isbn10 })),
              categories: [selectedFeaturedBook.category || "General"],
              source: "New York Times (Verified Raw)"
            });
            setLoadingFeaturedDetails(false);
            return;
          }
        }
      }

      // 3. Open Library
      if (sourceToUse === "openlibrary") {
        const olRes = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=1`);
        if (olRes.ok) {
          const data = await olRes.json();
          const doc = data.docs?.[0];
          if (doc) {
            let description = "";
            if (doc.key) {
              try {
                const workRes = await fetch(`https://openlibrary.org${doc.key}.json`);
                if (workRes.ok) {
                  const workData = await workRes.json();
                  description = typeof workData.description === "string" ? workData.description : (workData.description?.value || "");
                }
              } catch (err) {}
            }
            setFeaturedBookDetails({
              title: doc.title,
              authors: doc.author_name,
              description: description || selectedFeaturedBook.description,
              pageCount: doc.number_of_pages_median || doc.number_of_pages,
              publishedDate: doc.first_publish_year?.toString(),
              publisher: doc.publisher?.[0],
              language: doc.language?.[0],
              industryIdentifiers: doc.isbn?.map((i: string) => ({ type: "ISBN", identifier: i })),
              categories: doc.subject?.slice(0, 5) || [],
              source: "Open Library"
            });
            setLoadingFeaturedDetails(false);
            return;
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch featured book details:", e);
    }
    setLoadingFeaturedDetails(false);
  };

  const fetchSimilarBooks = async (category: string) => {
    setLoadingSimilar(true);
    try {
      const q = encodeURIComponent(`subject:${category}`);
      const res = await fetch(`/api/google-books/search?q=${q}&maxResults=6`);
      if (res.ok) {
        const data = await res.json();
        if (data.items) {
          setSimilarBooks(data.items.map((item: any) => ({
            title: item.volumeInfo.title,
            author: item.volumeInfo.authors?.[0] || "Unknown",
            coverUrl: item.volumeInfo.imageLinks?.thumbnail?.replace('http:', 'https:')
          })));
        }
      }
    } catch (err) {
      console.warn("Failed to fetch similar books:", err);
    } finally {
      setLoadingSimilar(false);
    }
  };
  const updateMetadataSource = (newSource: "google" | "nyt" | "openlibrary") => {
    setMetadataSource(newSource);
    tempStorage.set("preferred_source", newSource, 168); // 1 week TTL but helper handles daily reset if desired, though user said "resets daily" for source? Wait, "saved in a temporary local storage which resets daily"
    // Actually the tempStorage helper I wrote has 24h default.
    if (selectedFeaturedBook) {
      fetchFeaturedMetadata(selectedFeaturedBook.title, selectedFeaturedBook.author || "", newSource);
    }
  };

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

  async function fetchNYTCategory(listName: string, date: string = "current"): Promise<{ books: any[]; previousDate: string | null }> {
    const cacheKey = `nyt_list_opt_${listName}_${date}`;
    const cached = tempStorage.get<any>(cacheKey);
    if (cached) return cached;

    try {
      // Fetch current week
      const res = await fetch(`/api/nytimes/list?list=${encodeURIComponent(listName)}&date=${encodeURIComponent(date)}`);
      if (!res.ok) throw new Error(`NYT list fetch failed with status: ${res.status}`);
      const data = await res.json();
      
      if (data?.status !== "OK" || !data?.results?.books) {
        return { books: [], previousDate: null };
      }

      let books = data.results.books;
      const previousDate = data.results.previous_published_date || null;

      // Optimize: Fetch previous week as well to get more books
      if (previousDate) {
        try {
          const resPrev = await fetch(`/api/nytimes/list?list=${encodeURIComponent(listName)}&date=${encodeURIComponent(previousDate)}`);
          if (resPrev.ok) {
            const dataPrev = await resPrev.json();
            if (dataPrev?.results?.books) {
              const prevBooks = dataPrev.results.books;
              // Combine and deduplicate by title
              const existingTitles = new Set(books.map((b: any) => b.title.toLowerCase()));
              const newBooks = prevBooks.filter((b: any) => !existingTitles.has(b.title.toLowerCase()));
              books = [...books, ...newBooks];
            }
          }
        } catch (err) {
          console.warn("Failed to fetch previous NYT week for optimization:", err);
        }
      }
      
      const mappedBooks = books.map((book: any) => {
        const cleanTitle = (book.title || "")
          .split(':')[0]
          .replace(/\b\d{10,13}\b/g, '')
          .replace(/\(.*\)/g, '')
          .replace(/volume\s+\d+/gi, '')
          .replace(/book\s+\d+/gi, '')
          .replace(/[^\w\s-]/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        const cleanAuthor = (book.author || "")
          .split(',')[0]
          .replace(/\b\d{4}-\d{4}\b/g, '')
          .replace(/\bUnknown\b/gi, '')
          .replace(/\(.*\)/g, '')
          .replace(/[^\w\s-]/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        return {
          title: book.title,
          author: book.author,
          coverUrl: book.book_image,
          searchQuery: `${cleanTitle} ${cleanAuthor}`.trim(),
          description: book.description,
          publisher: book.publisher,
          rank: book.rank,
          weeks_on_list: book.weeks_on_list,
          source: 'nyt'
        };
      });

      const result = { books: mappedBooks, previousDate };
      tempStorage.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error("Failed to fetch NYT category:", err);
      return { books: [], previousDate: null };
    }
  }

  async function handleCategoryClick(category: any) {
    setLoadingCategory(true);
    setViewingCategory(category);
    setSearchMode(false);
    setCategoryPreviousDate(null);
    setCategoryBooks([]);
    setError(null);

    try {
      // Fetch NYT books for this category
      const { books, previousDate } = await fetchNYTCategory(category.query);
      setCategoryBooks(books);
      setCategoryPreviousDate(previousDate);
    } catch (err: any) {
      console.error("Failed to load category:", err);
      setError(`Failed to load category: ${err.message}`);
    } finally {
      setLoadingCategory(false);
    }
  }

  async function loadMoreCategoryBooks() {
    if (!viewingCategory || !categoryPreviousDate || loadingCategoryMore) return;
    setLoadingCategoryMore(true);
    try {
      const { books, previousDate } = await fetchNYTCategory(viewingCategory.query, categoryPreviousDate);
      // Filter out duplicates
      setCategoryBooks(prev => {
        const newBooks = books.filter(b => !prev.some(pb => pb.searchQuery === b.searchQuery));
        return [...prev, ...newBooks];
      });
      setCategoryPreviousDate(previousDate);
    } catch (err) {
      console.error("Failed to load more category books:", err);
    } finally {
      setLoadingCategoryMore(false);
    }
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

    // Save to search history
    setRecentSearches(prev => {
      const filtered = prev.filter(q => q.toLowerCase() !== term.toLowerCase().trim());
      const updated = [term.trim(), ...filtered].slice(0, 10);
      localStorage.setItem("kora_recent_searches", JSON.stringify(updated));
      return updated;
    });

    // Reset page if it's a new search term
    const isNewTerm = typeof e === "string" && e !== query;
    if (isNewTerm) {
      setCurrentPage(1);
      prefetchCache.current.clear();
    }

    const page = isNewTerm ? 1 : currentPage;
    if (page === 1) {
      setLoading(true);
      setResults([]);
    } else {
      setLoadingMore(true);
    }
    setError(null);
    setSearchMode(true);
    setViewingCategory(null);
    setCategoryBooks([]);

    if (typeof e === "string") setQuery(e);

    try {
      const source = sourceOverride || activeSource;

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

      // Group search results by simplified Title + Author to completely avoid duplicates of the same book
      const groupedBooksMap = new Map<string, any>();

      mappedBooks.forEach((b: any) => {
        const cleanTitle = (b.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        const cleanAuthor = (b.author || "Unknown").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        const groupingKey = `${cleanTitle}___${cleanAuthor}`;

        if (!groupedBooksMap.has(groupingKey)) {
          groupedBooksMap.set(groupingKey, {
            id: b.id || b.md5 || Math.random().toString(),
            title: b.title,
            author: b.author || "Unknown Author",
            coverUrl: b.coverUrl,
            year: b.year,
            publisher: b.publisher,
            pages: b.pages,
            topic: b.topic,
            language: b.language,
            isbn: b.isbn,
            exactMatch: b.exactMatch,
            sourceId: b.sourceId,
            source: b.source,
            size: b.size,
            extension: b.extension,
            md5: b.md5,
            downloadUrl: b.downloadUrl,
            iaId: b.iaId,
            hash: b.hash,
            variants: [b]
          });
        } else {
          const existing = groupedBooksMap.get(groupingKey)!;
          existing.variants.push(b);
          // If the new variant has coverUrl and existing doesn't, use it
          if (!existing.coverUrl && b.coverUrl) {
            existing.coverUrl = b.coverUrl;
          }
          // Merge metadata
          if (!existing.year && b.year) existing.year = b.year;
          if (!existing.publisher && b.publisher) existing.publisher = b.publisher;
          if (!existing.pages && b.pages) existing.pages = b.pages;
          if (!existing.topic && b.topic) existing.topic = b.topic;
          if (!existing.isbn && b.isbn) existing.isbn = b.isbn;
          if (b.exactMatch) existing.exactMatch = true;
        }
      });

      const uniqueGroupedBooks = Array.from(groupedBooksMap.values());
      if (page === 1) {
        setResults(uniqueGroupedBooks);
      } else {
        setResults((prev) => {
          const existingIds = new Set(prev.map(b => b.id || b.md5));
          const filteredNew = uniqueGroupedBooks.filter(b => !existingIds.has(b.id || b.md5));
          return [...prev, ...filteredNew];
        });
      }
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

        // Surface community (Hardcover) reviews for the top match alongside results
        setCommunityBook(uniqueGroupedBooks[0] ? {
          title: uniqueGroupedBooks[0].title,
          author: uniqueGroupedBooks[0].author
        } : null);

        // Background prefetch next page
      if (more) {
        prefetchPage(term, source, page + 1);
      }
    } catch (err: any) {
      console.error("Search error:", err);
      setError(err.message || "Search failed. Mirrors may be temporarily unavailable.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  function clearSearch() {
    setSearchMode(false);
    setViewingCategory(null);
    setCategoryBooks([]);
    setResults([]);
    setQuery("");
    setError(null);
    setCurrentPage(1);
    setHasMore(false);
    setTotalResults(0);
    setActiveSource("all");
    setCommunityBook(null);
    prefetchCache.current.clear();
  }

  async function fetchVerifiedDetails(title: string, author: string) {
    setLoadingDetails(true);
    setVerifiedDetails(null);
    setReadMoreExpanded(false);
    try {
      // 1. Try Google Books first
      const gRes = await fetch(`/api/google-books/search?q=${encodeURIComponent(`intitle:${title} inauthor:${author}`)}`);
      if (gRes.ok) {
        const gData = await gRes.json();
        if (gData.items && gData.items[0]) {
          const info = gData.items[0].volumeInfo;
          setVerifiedDetails({
            description: info.description,
            pageCount: info.pageCount,
            publishYear: info.publishedDate?.split("-")[0],
            publisher: info.publisher,
            language: info.language,
            coverUrl: info.imageLinks?.thumbnail?.replace("http:", "https:"),
            industryIdentifiers: info.industryIdentifiers || [],
            subjects: info.categories,
            source: "Google Books"
          });
          setLoadingDetails(false);
          return;
        }
      }

      // 2. Try Open Library
      const olRes = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=1`);
      if (olRes.ok) {
        const olData = await olRes.json();
        const doc = olData.docs?.[0];
        if (doc) {
          let description = "";
          if (doc.key) {
            try {
              const workRes = await fetch(`https://openlibrary.org${doc.key}.json`);
              if (workRes.ok) {
                const workData = await workRes.json();
                description = typeof workData.description === "string" ? workData.description : (workData.description?.value || "");
              }
            } catch (e) {}
          }
          setVerifiedDetails({
            description: description || doc.first_sentence || "No description available.",
            pageCount: doc.number_of_pages_median || doc.number_of_pages,
            publishYear: doc.first_publish_year?.toString(),
            publisher: doc.publisher?.[0],
            language: doc.language?.[0],
            coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined,
            industryIdentifiers: doc.isbn?.map((i: string) => ({ type: "ISBN", identifier: i })),
            subjects: doc.subject?.slice(0, 5) || [],
            source: "Open Library"
          });
          setLoadingDetails(false);
          return;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch verified details:", err);
    } finally {
      setLoadingDetails(false);
    }
  }

  async function handleGetDownloadLinks(book: any, variantOverride?: any) {
    const activeBook = book;
    const activeVariant = variantOverride || (book.variants && book.variants[0]) || book;

    onSelectedBookChange(activeBook);
    setSelectedVariant(activeVariant);
    
    setFetchingMirrors(true);
    setMirrors([]);
    setMirrorError(null);
    setDownloadProgress({ step: "idle", percent: 0, error: null });

    // Grab details from verified source asynchronously
    fetchVerifiedDetails(activeBook.title, activeBook.author);

    // If this is a NYT book, search all sources for download links first
    if (activeBook.isNYTBook && activeBook.searchQuery) {
      try {
        const searchResult = await fetchPage(activeBook.searchQuery, "all", 1);
        if (searchResult.books.length > 0) {
          // Update the book with download links from all sources
          const updatedBook = {
            ...activeBook,
            variants: searchResult.books,
            downloadLinks: searchResult.books
          };
          onSelectedBookChange(updatedBook);
          setSelectedVariant(searchResult.books[0]);
        }
      } catch (err) {
        console.error("Failed to search for download links:", err);
      }
    }

    try {
      if (activeVariant.sourceId === "zlib") {
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
            book_id: activeVariant.id,
            book_hash: activeVariant.hash,
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
        const iaParam = activeVariant.iaId ? `&iaId=${encodeURIComponent(activeVariant.iaId)}` : "";
        // Pass Rave's real signed direct URL through so the worker uses the same
        // direct-download method as ravebooksearch.com (get.php?md5&key -> CDN).
        const directParam = activeVariant.downloadUrl ? `&url=${encodeURIComponent(activeVariant.downloadUrl)}` : "";
        const res = await fetch(`/api/annas-archive/download?md5=${activeVariant.md5}${iaParam}${directParam}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const links = data.downloadLinks || data.options || [];
        setMirrors(links);
        if (links.length === 0) {
          setMirrorError("No download mirrors found for this variant. Try another format or mirror.");
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
    const activeVariant = selectedVariant || selectedBook;
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
        if (contentType.includes("text/html")) {
          throw new Error("The server returned a webpage instead of the book file. Please try another mirror.");
        }

        const contentLength = response.headers.get('Content-Length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        let loaded = 0;

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Failed to get reader from response.");
        }

        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          
          if (total) {
            const percent = Math.floor((loaded / total) * 100);
            setDownloadProgress({
              step: `downloading (Mirror ${index + 1}/${directMirrors.length})`,
              percent: Math.min(percent, 95),
              error: null
            });
          }
        }

        setDownloadProgress({ 
          step: "processing", 
          percent: 98, 
          error: null 
        });

        let fileBlob = new Blob(chunks, { type: contentType });
        let fileExtension = activeVariant.extension || "epub";

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
        const id = activeVariant.md5 || Math.random().toString(36).substring(7);
        await storeBookFile(id, fileBlob, `${selectedBook.title}.${fileExtension}`, fileExtension);

        // If a custom directory is configured, write the downloaded file there as well
        try {
          const { getSavedDirectoryHandle, saveFileToDirectory } = await import("../lib/directoryHelper");
          const dirHandle = await getSavedDirectoryHandle();
          if (dirHandle) {
            await saveFileToDirectory(dirHandle, `${selectedBook.title}.${fileExtension}`, fileBlob);
          }
          const isVirtualActive = localStorage.getItem("kora_use_virtual_dir") === "true";
          if (isVirtualActive) {
            const { addVirtualDirectoryFile } = await import("../lib/directoryHelper");
            addVirtualDirectoryFile({
              name: selectedBook.title,
              author: selectedBook.author || "Unknown",
              size: activeVariant.size || "1.5 MB",
              extension: fileExtension as any
            });
          }
        } catch (dirErr) {
          console.warn("Failed to write download to custom directory:", dirErr);
        }

        const newBook: BookMetadata = {
          id,
          title: selectedBook.title,
          author: selectedBook.author,
          extension: fileExtension,
          size: activeVariant.size || "Unknown",
          language: verifiedDetails?.language || activeVariant.language || "English",
          coverUrl: (!selectedBook.coverUrl || selectedBook.coverUrl.includes("placeholder")) && verifiedDetails?.coverUrl ? verifiedDetails.coverUrl : selectedBook.coverUrl,
          md5: activeVariant.md5,
          source: "Kora Store",
          tags: Array.from(new Set([...inferBookTags(selectedBook.title, selectedBook.author, fileExtension), ...(verifiedDetails?.subjects || [])])),
          status: "to-read",
          progress: { 
            percent: 0, 
            lastReadTime: Date.now(),
            totalPages: verifiedDetails?.pageCount
          },
          dateAdded: Date.now(),
          description: verifiedDetails?.description,
          publisher: verifiedDetails?.publisher,
          year: verifiedDetails?.publishYear
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
    const activeVariant = selectedVariant || selectedBook;

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
      let fileExtension = activeVariant.extension || "epub";

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
      const id = activeVariant.md5 || Math.random().toString(36).substring(7);
      await storeBookFile(id, fileBlob, `${selectedBook.title}.${fileExtension}`, fileExtension);

      // If a custom directory is configured, write the downloaded file there as well
      try {
        const { getSavedDirectoryHandle, saveFileToDirectory } = await import("../lib/directoryHelper");
        const dirHandle = await getSavedDirectoryHandle();
        if (dirHandle) {
          await saveFileToDirectory(dirHandle, `${selectedBook.title}.${fileExtension}`, fileBlob);
        }
        const isVirtualActive = localStorage.getItem("kora_use_virtual_dir") === "true";
        if (isVirtualActive) {
          const { addVirtualDirectoryFile } = await import("../lib/directoryHelper");
          addVirtualDirectoryFile({
            name: selectedBook.title,
            author: selectedBook.author || "Unknown",
            size: activeVariant.size || "1.5 MB",
            extension: fileExtension as any
          });
        }
      } catch (dirErr) {
        console.warn("Failed to write download to custom directory:", dirErr);
      }

      const newBook: BookMetadata = {
        id,
        title: selectedBook.title,
        author: selectedBook.author,
        extension: fileExtension,
        size: activeVariant.size || "Unknown",
        language: activeVariant.language || "English",
        coverUrl: selectedBook.coverUrl,
        md5: activeVariant.md5,
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
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Header */}
        <header className="flex flex-col gap-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h2 className="text-3xl font-lexend font-bold tracking-tight text-kindle-text">Discover</h2>
            </div>
            {!searchMode && !viewingCategory && (
              <button
                onClick={() => loadFeaturedContent(true)}
                className="p-2.5 border border-kindle-border rounded-full text-kindle-text-muted hover:bg-kindle-card hover:text-kindle-accent transition shadow-sm"
                title="Refresh Best Sellers Feed"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
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
          {searchMode && (
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
                .filter(src => src.id === "all" || availableSourcesFromResults.has(src.id))
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
          )}
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
                  <div className={`aspect-[2/3] bg-kindle-card rounded-2xl border ${book.exactMatch ? "border-kindle-accent/40 shadow-inner" : "border-kindle-border"} overflow-hidden relative shadow-sm group-hover:shadow-xl transition-all duration-500`}>
                    {book.coverUrl ? (
                      <img
                        src={book.coverUrl.startsWith('/') ? book.coverUrl : `/api/proxy-image?url=${encodeURIComponent(book.coverUrl)}`}
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
                  </div>
                  <div className="space-y-0.5 pr-1">
                    <h4 className="text-[11px] font-bold font-serif line-clamp-2 leading-tight group-hover:text-kindle-accent transition">{book.title}</h4>
                    {book.topic && (
                      <p className="text-[8px] text-kindle-accent font-bold uppercase tracking-wider mt-1 truncate">
                        {book.topic}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span 
                        className="text-[10px] text-kindle-text-muted font-sans font-medium hover:text-kindle-accent hover:underline cursor-pointer transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (book.author) handleSearch(book.author);
                        }}
                      >
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
                        <span className="text-[8px] font-bold uppercase tracking-widest text-kindle-text-muted/60 shrink-0">
                          · {book.pages} pp
                        </span>
                      )}
                      {book.extension && (
                        <span className="text-[8px] font-bold uppercase tracking-widest text-kindle-text-muted/60 shrink-0">
                          · {book.extension}
                        </span>
                      )}
                      {book.size && book.size !== "Unknown" && (
                        <span className="text-[8px] font-bold uppercase tracking-widest text-kindle-text-muted/60 shrink-0">
                          · {book.size}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Infinite Scroll Sentinel & Loader */}
          {!loading && !error && results.length > 0 && (
            <div className="pt-8 flex flex-col items-center justify-center gap-4">
              {loadingMore ? (
                <div className="flex flex-col items-center justify-center gap-2 py-4">
                  <Loader2 className="w-6 h-6 text-kindle-accent animate-spin" />
                  <p className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted animate-pulse">
                    Loading more results...
                  </p>
                </div>
              ) : hasMore ? (
                <div ref={observerTargetRef} className="h-10 w-full flex items-center justify-center">
                  <p className="text-[9px] text-kindle-text-muted/50 font-semibold uppercase tracking-wider">
                    Scroll down for more
                  </p>
                </div>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-[10px] text-kindle-text-muted font-semibold uppercase tracking-widest">
                    No more results in this archive
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

      )}

      {searchMode && communityBook && (
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs">
          <HardcoverCommunity book={communityBook} />
        </section>
      )}

      {!searchMode && viewingCategory && (
        <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setViewingCategory(null);
                setCategoryBooks([]);
              }}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition"
            >
              <ChevronLeft className="w-4 h-4" /> Back to Discover
            </button>
            <div className="text-[10px] text-kindle-text-muted font-bold uppercase tracking-wider">
              {viewingCategory.title}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-2xl font-lexend font-bold tracking-tight text-kindle-text">
              {viewingCategory.title}
            </h3>
            <p className="text-xs text-kindle-text-muted font-sans">
              Top trending books currently featured on the New York Times Best Sellers list. Click any book to search and download.
            </p>
          </div>

          {loadingCategory ? (
            <div className="py-24 flex flex-col items-center justify-center gap-4">
              <KoraLoading />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted animate-pulse">
                Loading Best Sellers...
              </p>
            </div>
          ) : categoryBooks.length === 0 ? (
            <div className="py-16 text-center border border-dashed border-kindle-border rounded-2xl bg-kindle-card/30">
              <p className="text-xs text-kindle-text-muted italic">No books found in this category.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                {categoryBooks.map((book, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    setSelectedFeaturedBook(book);
                    fetchFeaturedMetadata(book.title, book.author || "");
                  }}
                  className="group cursor-pointer space-y-2 p-1 sm:p-1.5 rounded-2xl sm:rounded-3xl transition-all duration-300 border border-transparent hover:bg-kindle-card/50"
                >
                  <div className="aspect-[2/3] bg-kindle-card rounded-2xl border border-kindle-border overflow-hidden relative shadow-sm group-hover:shadow-lg transition-all duration-500">
                    {book.coverUrl ? (
                      <img
                        src={book.coverUrl.startsWith('/') ? book.coverUrl : `/api/proxy-image?url=${encodeURIComponent(book.coverUrl)}`}
                        alt={book.title}
                        className={`w-full h-full object-cover group-hover:scale-105 transition duration-500 ${grayscaleCovers ? "grayscale" : ""}`}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-kindle-card">
                        <BookOpen className="w-8 h-8 text-kindle-text-muted mb-2 opacity-20" />
                        <span className="text-[10px] font-bold text-kindle-text-muted uppercase text-center line-clamp-3">{book.title}</span>
                      </div>
                    )}
                    
                    {/* Rank Badge */}
                    {book.rank && (
                      <div className="absolute top-2 left-2 bg-emerald-500 text-white font-bold text-[10px] w-6 h-6 rounded-full flex items-center justify-center shadow-md">
                        #{book.rank}
                      </div>
                    )}

                    {/* Weeks on List Badge */}
                    {book.weeks_on_list && book.weeks_on_list > 1 && (
                      <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-xs text-white px-1.5 py-0.5 rounded text-[8px] font-sans font-bold">
                        {book.weeks_on_list} wks
                      </div>
                    )}
                  </div>

                  <div className="space-y-0.5">
                    <h4 className="text-xs font-bold font-serif line-clamp-2 leading-tight group-hover:text-kindle-accent transition">
                      {book.title}
                    </h4>
                    <p className="text-[10px] text-kindle-text-muted font-sans font-medium truncate">
                      {book.author}
                    </p>
                    {book.description && (
                      <p className="text-[10px] text-kindle-text-muted/60 font-sans line-clamp-2 leading-relaxed pt-1 border-t border-kindle-border/20 mt-1">
                        {book.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            {/* Category Infinite Scroll Observer */}
            {categoryPreviousDate && (
              <div 
                ref={(node) => {
                  if (node) {
                    const observer = new IntersectionObserver((entries) => {
                      if (entries[0].isIntersecting) {
                        loadMoreCategoryBooks();
                      }
                    }, { rootMargin: "200px" });
                    observer.observe(node);
                    return () => observer.disconnect();
                  }
                }}
                className="py-12 flex justify-center"
              >
                {loadingCategoryMore ? (
                  <div className="flex items-center gap-3 bg-kindle-card/50 px-6 py-3 rounded-full border border-kindle-border">
                    <Loader2 className="w-4 h-4 animate-spin text-kindle-accent" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Loading Past Weeks...</span>
                  </div>
                ) : (
                  <button 
                    onClick={loadMoreCategoryBooks}
                    className="px-6 py-3 bg-kindle-card hover:bg-kindle-border/50 transition border border-kindle-border rounded-full text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted flex items-center gap-2"
                  >
                    Load Older Books
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
    )}

      {!searchMode && !viewingCategory && (
        <div className="space-y-8">
          {feedNotice && !error && (
            <div className="flex items-center gap-3 p-3.5 bg-kindle-accent/[0.06] border border-kindle-accent/20 rounded-2xl">
              <Sparkles className="w-4 h-4 text-kindle-accent shrink-0" />
              <p className="text-[11px] font-medium text-kindle-text-muted leading-snug">{feedNotice}</p>
            </div>
          )}
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
                  <div className="aspect-[2/3] bg-kindle-card rounded-2xl border border-kindle-border" />
                  <div className="h-3 bg-kindle-card rounded w-3/4" />
                  <div className="h-2 bg-kindle-card rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : (
            (() => {
              const totalBooks = ALL_CATEGORIES.reduce((n, c) => n + (featuredData[c.id]?.length || 0), 0);
              if (totalBooks === 0) {
                return (
                  <div className="py-20 flex flex-col items-center gap-4 text-center">
                    <Compass className="w-10 h-10 text-kindle-text-muted opacity-40" />
                    <p className="text-sm font-bold text-kindle-text-muted">No trending titles right now</p>
                    <p className="text-xs text-kindle-text-muted/70 max-w-sm">Use the search above to find any book across the global archives.</p>
                    <button
                      onClick={loadFeaturedContent}
                      className="flex items-center gap-2 px-4 py-2 border border-kindle-border rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-kindle-card transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Refresh
                    </button>
                  </div>
                );
              }
              return ALL_CATEGORIES.map((cat) => {
                const books = featuredData[cat.id] || [];
                if (books.length === 0) return null;
                return (
                  <section key={cat.id} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-kindle-card rounded-xl border border-kindle-border">
                          {cat.id.includes("fiction") ? <BookMarked className="w-4 h-4 text-kindle-accent" /> : <Sparkles className="w-4 h-4 text-kindle-accent" />}
                        </div>
                        <h3 className="text-lg font-lexend font-bold tracking-tight">{cat.title}</h3>
                      </div>
                    <button
                      onClick={() => handleCategoryClick(cat)}
                      className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-kindle-card border border-transparent hover:border-kindle-border"
                    >
                      View More <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="flex gap-3 overflow-x-auto pb-4 scroll-smooth snap-x">
                    {books.map((book, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          setSelectedFeaturedBook(book);
                          fetchFeaturedMetadata(book.title, book.author || "");
                        }}
                        className="flex-shrink-0 w-28 sm:w-36 space-y-2 cursor-pointer group snap-start"
                      >
                        <div className="aspect-[2/3] bg-kindle-card rounded-xl border border-kindle-border overflow-hidden relative shadow-sm group-hover:shadow-lg transition-all duration-500">
                          {book.coverUrl ? (
                            <img
                              src={book.coverUrl.startsWith('/') ? book.coverUrl : `/api/proxy-image?url=${encodeURIComponent(book.coverUrl)}`}
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
            });
            })()
          )}

          {/* Explore Categories Dashboard */}
          <div className="space-y-8 pt-4">
            <div className="space-y-1">
              <h3 className="text-xl font-lexend font-bold tracking-tight text-kindle-text">Explore Archives</h3>
              <p className="text-xs text-kindle-text-muted font-sans">
                Browse popular literature types, subjects, and specialized genres across global repositories.
              </p>
            </div>

            <div className="space-y-8">
              {[
                {
                  section: "Book Types",
                  items: [
                    { id: "fiction", label: "Fiction", query: "fiction", icon: BookMarked, color: "text-kindle-text bg-kindle-card hover:bg-kindle-bg border-kindle-border hover:border-kindle-accent/50" },
                    { id: "nonfiction", label: "Non-Fiction", query: "nonfiction", icon: BookOpen, color: "text-kindle-text bg-kindle-card hover:bg-kindle-bg border-kindle-border hover:border-kindle-accent/50" },
                    { id: "documentary", label: "Documentary", query: "documentary", icon: ExternalLink, color: "text-kindle-text bg-kindle-card hover:bg-kindle-bg border-kindle-border hover:border-kindle-accent/50" },
                    { id: "textbook", label: "Textbooks & Academic", query: "textbook educational", icon: Layers, color: "text-kindle-text bg-kindle-card hover:bg-kindle-bg border-kindle-border hover:border-kindle-accent/50" },
                  ]
                },
                {
                  section: "Popular Genres",
                  items: [
                    { id: "sci-fi", label: "Sci-Fi & Fantasy", query: "science fiction fantasy", icon: Sparkles, color: "text-kindle-text bg-kindle-card hover:bg-kindle-bg border-kindle-border hover:border-kindle-accent/50" },
                    { id: "mystery", label: "Mystery & Thriller", query: "mystery thriller suspense", icon: Compass, color: "text-kindle-text bg-kindle-card hover:bg-kindle-bg border-kindle-border hover:border-kindle-accent/50" },
                    { id: "biography", label: "Biography & Memoir", query: "biography memoir autobiography", icon: Library, color: "text-kindle-text bg-kindle-card hover:bg-kindle-bg border-kindle-border hover:border-kindle-accent/50" },
                    { id: "history", label: "History & Politics", query: "history historical politics", icon: Database, color: "text-kindle-text bg-kindle-card hover:bg-kindle-bg border-kindle-border hover:border-kindle-accent/50" },
                    { id: "tech", label: "Technology & Science", query: "technology computing science", icon: Globe, color: "text-kindle-text bg-kindle-card hover:bg-kindle-bg border-kindle-border hover:border-kindle-accent/50" },
                    { id: "self-dev", label: "Self-Improvement", query: "self-help personal growth productivity", icon: TrendingUp, color: "text-kindle-text bg-kindle-card hover:bg-kindle-bg border-kindle-border hover:border-kindle-accent/50" },
                  ]
                }
              ].map((sect, sIdx) => (
                <div key={sIdx} className="space-y-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">{sect.section}</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {sect.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleSearch(item.query)}
                        className={`p-4 rounded-2xl border transition-all duration-300 text-left flex flex-col justify-between h-28 group relative overflow-hidden shadow-sm cursor-pointer ${item.color}`}
                      >
                        <div className="p-2 bg-kindle-card rounded-xl border border-kindle-border shadow-sm group-hover:scale-110 transition duration-300 w-10 h-10 flex items-center justify-center">
                          <item.icon className="w-5 h-5" />
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold text-kindle-text block truncate">{item.label}</span>
                          <span className="text-[8px] text-kindle-text-muted font-sans font-medium uppercase tracking-wider block">Search Topic</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Download Modal - Redesigned Book Explorer Profile */}
      {selectedBook && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={() => onSelectedBookChange(null)} />
          <div className="relative w-full max-w-3xl bg-kindle-card border border-kindle-border rounded-3xl shadow-2xl p-6 md:p-8 animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto scrollbar-thin">
            {/* Close Button */}
            <button 
              onClick={() => onSelectedBookChange(null)} 
              className="absolute top-4 right-4 p-2 bg-kindle-bg/80 hover:bg-kindle-bg border border-kindle-border rounded-full hover:scale-105 transition duration-200 z-10 cursor-pointer"
            >
              <X className="w-4 h-4 text-kindle-text" />
            </button>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pt-2">
              {/* Left Column: Physical Book Cover Artwork */}
              <div className="md:col-span-5 flex flex-col items-center">
                <div className="w-48 md:w-full max-w-[220px] aspect-[2/3] bg-kindle-bg rounded-2xl border-2 border-kindle-border shadow-2xl overflow-hidden relative group/cover">
                  {/* Spine simulated lighting */}
                  <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-black/25 via-white/5 to-transparent z-10" />
                  <div className="absolute left-3 top-0 bottom-0 w-[1px] bg-black/10 z-10" />
                  
                  {selectedBook.coverUrl ? (
                    <img
                      src={selectedBook.coverUrl.startsWith('/') ? selectedBook.coverUrl : `/api/proxy-image?url=${encodeURIComponent(selectedBook.coverUrl)}`}
                      alt={selectedBook.title}
                      className={`w-full h-full object-cover transition duration-500 ${grayscaleCovers ? "grayscale" : ""}`}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        const attempt = parseInt(target.dataset.attempt || "0");
                        target.dataset.attempt = String(attempt + 1);

                        if (attempt === 0 && selectedBook.isbn && /^\d{10,13}$/.test(selectedBook.isbn)) {
                          target.src = `https://covers.openlibrary.org/b/isbn/${selectedBook.isbn}-M.jpg`;
                          return;
                        }
                        if (attempt === 1) {
                          const encodedTitle = encodeURIComponent(selectedBook.title);
                          const encodedAuthor = encodeURIComponent(selectedBook.author || "");
                          target.src = `/api/cover-redirect?title=${encodedTitle}&author=${encodedAuthor}&md5=${selectedBook.md5 || (selectedBook.variants && selectedBook.variants[0]?.md5)}`;
                          return;
                        }
                        target.style.display = "none";
                        const parent = target.parentElement;
                        if (parent && !parent.querySelector(".kora-typo-cover")) {
                          const div = document.createElement("div");
                          div.className = "kora-typo-cover w-full h-full flex flex-col items-center justify-center p-4 text-center bg-kindle-card absolute inset-0";
                          div.innerHTML = `
                            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;opacity:0.3;margin-bottom:6px;">${(selectedBook.author || "Author").substring(0, 30)}</div>
                            <div style="font-size:12px;font-weight:700;font-family:serif;line-height:1.3;">${selectedBook.title}</div>
                          `;
                          parent.style.position = "relative";
                          parent.appendChild(div);
                        }
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-kindle-card">
                      <div className="text-[9px] font-bold uppercase tracking-[0.15em] opacity-30 mb-2">{(selectedBook.author || "Author").substring(0, 25)}</div>
                      <div className="text-[12px] font-serif font-bold leading-snug text-center">{selectedBook.title}</div>
                    </div>
                  )}
                </div>

                {/* File size & format metadata block */}
                <div className="mt-4 flex flex-col items-center text-center space-y-1">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-kindle-text-muted">
                    {(selectedVariant || selectedBook).extension?.toUpperCase()} FILE · {(selectedVariant || selectedBook).size || "Unknown Size"}
                  </span>
                  <span className="text-[9px] font-bold text-kindle-accent uppercase tracking-wider bg-kindle-accent/5 px-2.5 py-0.5 rounded-full border border-kindle-accent/10">
                    Source: {(selectedVariant || selectedBook).source || "Verified Archives"}
                  </span>
                </div>
              </div>

              {/* Right Column: Detailed Book Metadata, Synopsis & Actions */}
              <div className="md:col-span-7 flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  {/* Book Title & Author */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-widest font-sans">
                        Verified Library Copy
                      </span>
                      <h3 className="text-2xl md:text-3xl font-lexend font-bold leading-tight text-kindle-text pt-1.5">{selectedBook.title}</h3>
                      <p 
                        className="text-sm md:text-base text-kindle-text-muted font-sans font-medium hover:text-kindle-accent hover:underline cursor-pointer inline-block transition-colors"
                        onClick={() => {
                          if (selectedBook.author) {
                            onSelectedBookChange(null);
                            handleSearch(selectedBook.author);
                          }
                        }}
                      >
                        {selectedBook.author}
                      </p>
                    </div>

                  {/* NYT Bestseller Information Badge */}
                  {verifiedDetails?.isBestseller && (
                    <div className="bg-amber-500/5 border border-amber-500/20 p-3 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-1">
                      <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-0.5 text-left">
                        <span className="text-[9px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest block font-sans">New York Times Best Seller</span>
                        <p className="text-xs font-semibold text-kindle-text leading-tight font-sans">
                          {verifiedDetails.bestsellerRank || "Featured NYT Bestseller"}
                          {verifiedDetails.weeksOnList ? ` · ${verifiedDetails.weeksOnList} weeks on list` : ""}
                        </p>
                        {verifiedDetails.bestsellerCategory && (
                          <span className="text-[10px] text-kindle-text-muted font-medium block font-sans">Category: {verifiedDetails.bestsellerCategory}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* NYT Review Snip Quote */}
                  {verifiedDetails?.nytReviewSnippet && (
                    <div className="border-l-2 border-amber-500/30 pl-3 py-1.5 bg-amber-500/[0.02] rounded-r-xl text-left">
                      <p className="text-xs md:text-sm italic leading-relaxed text-kindle-text-muted font-serif">
                        "{verifiedDetails.nytReviewSnippet}"
                      </p>
                    </div>
                  )}

                  {/* Horizontal Stats Row */}
                  <div className="grid grid-cols-3 gap-3 p-3 bg-kindle-bg border border-kindle-border rounded-2xl text-center">
                    <div>
                      <span className="text-[9px] font-bold text-kindle-text-muted uppercase tracking-wider block font-sans">Published</span>
                      <span className="text-xs md:text-sm font-semibold text-kindle-text mt-0.5 block font-sans">
                        {verifiedDetails?.publishYear || (selectedVariant || selectedBook).year || "N/A"}
                      </span>
                    </div>
                    <div className="border-x border-kindle-border">
                      <span className="text-[9px] font-bold text-kindle-text-muted uppercase tracking-wider block font-sans">Length</span>
                      <span className="text-xs md:text-sm font-semibold text-kindle-text mt-0.5 block font-sans">
                        {verifiedDetails?.pageCount ? `${verifiedDetails.pageCount} pp` : (selectedVariant || selectedBook).pages && (selectedVariant || selectedBook).pages !== "0" ? `${(selectedVariant || selectedBook).pages} pp` : "N/A"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-kindle-text-muted uppercase tracking-wider block font-sans">Language</span>
                      <span className="text-xs md:text-sm font-semibold text-kindle-text mt-0.5 block truncate font-sans font-sans">
                        {(selectedVariant || selectedBook).language || "English"}
                      </span>
                    </div>
                  </div>

                  {/* Synopsis / Description from Verified Source */}
                  <div className="space-y-1.5">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted font-sans">Synopsis & Book Summary</h4>
                    {loadingDetails ? (
                      <div className="space-y-2 animate-pulse py-1">
                        <div className="h-3 bg-kindle-bg border border-kindle-border rounded w-full" />
                        <div className="h-3 bg-kindle-bg border border-kindle-border rounded w-5/6" />
                        <div className="h-3 bg-kindle-bg border border-kindle-border rounded w-4/5" />
                      </div>
                    ) : verifiedDetails?.description ? (
                      <div className="text-xs md:text-sm text-kindle-text-muted leading-relaxed font-sans text-left">
                        <p className="inline">
                          {readMoreExpanded 
                            ? verifiedDetails.description 
                            : verifiedDetails.description.length > 250 
                              ? `${verifiedDetails.description.substring(0, 250)}...` 
                              : verifiedDetails.description
                          }
                        </p>
                        {verifiedDetails.description.length > 250 && (
                          <button
                            onClick={() => setReadMoreExpanded(!readMoreExpanded)}
                            className="text-[10px] font-bold text-kindle-accent uppercase tracking-widest hover:underline ml-1.5 focus:outline-none cursor-pointer"
                          >
                            {readMoreExpanded ? "Read Less" : "Read More"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs md:text-sm text-kindle-text-muted/60 leading-relaxed font-sans italic text-left">
                        No official synopsis available in digital archives. This is a verified {(selectedVariant || selectedBook).extension || "epub"} copy provided by the {(selectedVariant || selectedBook).source || "global storage libraries"}.
                      </p>
                    )}
                  </div>

                  {/* Extended Metadata Grid for Download Modal */}
                  {verifiedDetails && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4 border-y border-kindle-border/40">
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-kindle-text-muted font-bold uppercase tracking-wider">ISBN</span>
                          <span className="font-medium text-kindle-text">
                            {verifiedDetails.industryIdentifiers?.map((id: any) => id.identifier).slice(0, 1).join(", ") || "N/A"}
                          </span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-kindle-text-muted font-bold uppercase tracking-wider">Publisher</span>
                          <span className="font-medium text-kindle-text truncate max-w-[120px]">{verifiedDetails.publisher || "N/A"}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-kindle-text-muted font-bold uppercase tracking-wider">Language</span>
                          <span className="font-medium text-kindle-text uppercase">{verifiedDetails.language || "EN"}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-kindle-text-muted font-bold uppercase tracking-wider">Format</span>
                          <span className="font-medium text-kindle-text uppercase">{(selectedVariant || selectedBook).extension || "N/A"}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Category/Genre Badges */}
                  {(verifiedDetails?.subjects?.length || (selectedVariant || selectedBook).topic) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted mr-1">Genres:</span>
                      {verifiedDetails?.subjects ? (
                        verifiedDetails.subjects.map((sub, sIdx) => (
                          <span key={sIdx} className="px-2 py-0.5 bg-kindle-bg border border-kindle-border rounded text-[9px] text-kindle-text-muted truncate max-w-[120px]" title={sub}>
                            {sub}
                          </span>
                        ))
                      ) : (
                        <span className="px-2 py-0.5 bg-kindle-bg border border-kindle-border rounded text-[9px] text-kindle-accent uppercase font-bold tracking-wider">
                          {(selectedVariant || selectedBook).topic}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Multi-Format Selector: Render if this book has multiple variants collapsed */}
                  {selectedBook.variants && selectedBook.variants.length > 1 && (
                    <div className="space-y-2 pt-2 border-t border-kindle-border/40">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Available Formats & Quality</h4>
                      <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto pr-1">
                        {selectedBook.variants.map((v: any, vIdx: number) => {
                          const isActive = selectedVariant?.id === v.id || selectedVariant?.md5 === v.md5;
                          return (
                            <button
                              key={vIdx}
                              onClick={() => {
                                handleGetDownloadLinks(selectedBook, v);
                              }}
                              className={`px-3 py-2 rounded-xl text-left border transition duration-200 cursor-pointer ${
                                isActive
                                  ? "bg-kindle-accent/10 border-kindle-accent text-kindle-accent"
                                  : "bg-kindle-bg border-kindle-border hover:border-kindle-text-muted text-kindle-text-muted hover:text-kindle-text"
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-extrabold uppercase font-mono">{v.extension || "EPUB"}</span>
                                <span className="text-[9px] opacity-70">· {v.size || "Unknown"}</span>
                              </div>
                              <span className="text-[8px] opacity-65 block truncate max-w-[150px] mt-0.5">
                                {v.source === "Library Genesis" ? "LibGen" : v.source === "Anna's Archive" ? "Anna's" : v.source}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions & Progress Area */}
                <div className="space-y-4 pt-4 border-t border-kindle-border">
                  {/* Recommended Auto-Download */}
                  {!fetchingMirrors && !mirrorError && mirrors.some(m => m.isDirect) && downloadProgress.step === "idle" && (
                    <button
                      onClick={handleAutoDownload}
                      className="w-full p-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 transition-all duration-300 text-left flex items-center justify-between group shadow-lg shadow-emerald-600/10 hover:shadow-emerald-500/20 text-white cursor-pointer"
                    >
                      <div>
                        <p className="text-xs font-bold font-sans flex items-center gap-1.5 text-white">
                          <Sparkles className="w-3.5 h-3.5 text-emerald-200 animate-pulse" />
                          Recommended Auto-Download
                        </p>
                        <p className="text-[10px] text-emerald-100/80 font-medium font-sans mt-0.5">
                          Acquires the highest quality {(selectedVariant || selectedBook).extension || "epub"} copy instantly via the server.
                        </p>
                      </div>
                      <Download className="w-4 h-4 text-emerald-100 group-hover:scale-110 transition shrink-0 ml-2 animate-bounce" />
                    </button>
                  )}

                  {/* Manual / All Mirror Options section */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-kindle-text-muted uppercase tracking-wider flex justify-between border-b border-kindle-border/40 pb-1">
                      <span>Download Mirrors</span>
                      {fetchingMirrors ? (
                        <span className="text-[9px] font-bold text-kindle-accent uppercase tracking-widest flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Scanning...
                        </span>
                      ) : (
                        <span className="text-[8px] opacity-60">Opens in browser tab if blocked</span>
                      )}
                    </div>

                    {fetchingMirrors ? (
                      <div className="py-6 text-center space-y-2 bg-kindle-bg/50 border border-kindle-border rounded-2xl">
                        <Loader2 className="w-6 h-6 animate-spin text-kindle-accent mx-auto" />
                        <p className="text-[9px] text-kindle-text-muted font-bold uppercase tracking-widest font-sans">Scanning global book repositories…</p>
                      </div>
                    ) : mirrorError ? (
                      <div className="py-6 text-center space-y-2 bg-kindle-bg/50 border border-kindle-border rounded-2xl">
                        <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto" />
                        <p className="text-[10px] text-kindle-text-muted font-sans font-medium">{mirrorError}</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-[10rem] overflow-y-auto pr-1">
                        {mirrors.map((m, i) => (
                          <div
                            key={i}
                            onClick={() => handleMirrorClick(m)}
                            className={`w-full p-3 rounded-xl border transition text-left group flex items-center justify-between cursor-pointer ${
                              m.isDirect 
                                ? "border-kindle-border hover:border-emerald-500/40 bg-kindle-bg hover:bg-kindle-card" 
                                : "border-kindle-border/60 hover:border-amber-500/40 bg-kindle-bg/40 hover:bg-kindle-card/60"
                            }`}
                            title={m.isDirect ? "Download and Import via App Server" : "Open Mirror"}
                          >
                            <div className="overflow-hidden flex-1 min-w-0 pr-2">
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

                            <div className="flex items-center gap-1.5 shrink-0">
                              {/* Primary action */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMirrorClick(m);
                                }}
                                className={`p-2 rounded-xl border transition cursor-pointer ${
                                  m.isDirect
                                    ? "bg-emerald-500/10 hover:bg-emerald-500 text-emerald-600 hover:text-white border-emerald-500/20"
                                    : "bg-amber-500/10 hover:bg-amber-500 text-amber-600 hover:text-white border-amber-500/20"
                                }`}
                                title={m.isDirect ? "Download via Server Proxy" : "Open in App Browser"}
                              >
                                {m.isDirect ? (
                                  <Download className="w-3.5 h-3.5" />
                                ) : (
                                  <BookOpen className="w-3.5 h-3.5" />
                                )}
                              </button>

                              {/* Open in New Tab */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(m.url, '_blank');
                                }}
                                className="p-2 rounded-xl border border-kindle-border bg-kindle-bg hover:bg-kindle-accent/15 text-kindle-text-muted hover:text-kindle-accent transition cursor-pointer"
                                title="Open Link in New Tab"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Active Download Progress Log Overlay */}
                  {downloadProgress.step !== "idle" && (
                    <div className="p-4 bg-kindle-bg border border-kindle-border rounded-2xl space-y-3">
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
                          <div className="flex items-center gap-2 justify-between">
                            <div className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-kindle-accent" />
                              <span className="text-[10px] font-bold uppercase tracking-widest font-sans capitalize">{downloadProgress.step}…</span>
                            </div>
                            <span className="text-[10px] font-mono font-bold text-kindle-accent">{downloadProgress.percent}%</span>
                          </div>
                          <div className="w-full h-2 bg-kindle-border rounded-full overflow-hidden">
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
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Featured Book Details Preview Modal */}
      {selectedFeaturedBook && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setSelectedFeaturedBook(null)} />
          <div className="relative bg-kindle-bg w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] border border-kindle-border/40 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between p-4 md:p-6 bg-kindle-bg/95 backdrop-blur-md border-b border-kindle-border">
              <h2 className="text-sm font-bold uppercase tracking-widest text-kindle-text font-sans">Book Details</h2>
              <button 
                onClick={() => setSelectedFeaturedBook(null)}
                className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition text-kindle-text"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-kindle-bg">
              <div className="max-w-6xl mx-auto px-6 py-10">
                <div className="flex flex-col md:flex-row gap-10">
                  {/* Left Column: Cover & Action Buttons */}
                  <div className="w-full md:w-56 shrink-0 flex flex-col items-center md:items-start">
                    <div className="w-full max-w-[220px] aspect-[2/3] rounded-lg overflow-hidden shadow-[0_12px_24px_rgba(0,0,0,0.15)] bg-black/5 relative group mb-6">
                      {selectedFeaturedBook.coverUrl ? (
                        <img src={selectedFeaturedBook.coverUrl} alt={selectedFeaturedBook.title} className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-kindle-text-muted">
                          <BookOpen className="w-12 h-12" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
                    </div>
                    <div className="w-full flex flex-col gap-2.5 max-w-[220px]">
                      <button 
                        onClick={() => handleSearch(`${selectedFeaturedBook.title} ${selectedFeaturedBook.author || ""}`)}
                        className="w-full py-3.5 px-4 bg-kindle-accent hover:bg-kindle-accent/90 text-kindle-bg rounded-lg font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg"
                      >
                        <Search className="w-4 h-4" />
                        Search Download
                      </button>
                    </div>
                  </div>

                  {/* Right Column: Title, Metadata, Description & Sidebar */}
                  <div className="flex-1 min-w-0">
                    <div className="mb-8">
                      <h2 className="text-3xl md:text-4xl font-serif text-kindle-text mb-2 leading-tight">
                        {featuredBookDetails?.title || selectedFeaturedBook.title}
                      </h2>
                      <div className="text-lg text-kindle-text-muted font-sans">
                        By <span 
                          className="text-kindle-accent font-medium hover:underline cursor-pointer transition-colors"
                          onClick={() => {
                            const author = featuredBookDetails?.authors?.join(", ") || selectedFeaturedBook.author;
                            if (author) {
                              setSelectedFeaturedBook(null);
                              handleSearch(author);
                            }
                          }}
                        >
                          {featuredBookDetails?.authors?.join(", ") || selectedFeaturedBook.author}
                        </span>
                        {featuredBookDetails?.publishedDate && ` · ${featuredBookDetails.publishedDate.split('-')[0]}`}
                      </div>
                    </div>

                    {/* Tabs navigation simulation */}
                    <div className="flex items-center gap-8 border-b border-kindle-border mb-8 overflow-x-auto no-scrollbar">
                      {['Overview'].map((tab, idx) => (
                        <button key={tab} className={`pb-4 text-xs font-bold uppercase tracking-widest whitespace-nowrap border-b-2 transition-colors ${idx === 0 ? 'text-kindle-accent border-kindle-accent' : 'text-kindle-text-muted border-transparent hover:text-kindle-text'}`}>
                          {tab}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-12">
                      <section>
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-kindle-text-muted">About this edition</h3>
                          <div className="flex items-center bg-black/5 rounded p-1 border border-kindle-border">
                            {["google", "nyt", "openlibrary"].map((source) => (
                              <button 
                                key={source}
                                onClick={() => updateMetadataSource(source as any)}
                                className={`px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded transition-all ${
                                  metadataSource === source 
                                    ? 'bg-kindle-text text-kindle-bg shadow-sm' 
                                    : 'text-kindle-text-muted hover:text-kindle-text'
                                }`}
                              >
                                {source}
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        <div className="text-kindle-text leading-relaxed font-sans text-sm space-y-4 min-h-[150px]">
                          {loadingFeaturedDetails ? (
                            <div className="space-y-4 animate-pulse">
                              <div className="h-4 bg-black/5 rounded w-full" />
                              <div className="h-4 bg-black/5 rounded w-full" />
                              <div className="h-4 bg-black/5 rounded w-3/4" />
                            </div>
                          ) : (
                            <div className="prose prose-sm dark:prose-invert max-w-none prose-neutral leading-relaxed [&_a]:text-kindle-accent" dangerouslySetInnerHTML={{ __html: featuredBookDetails?.description || "No detailed description available." }} />
                          )}
                        </div>
                      </section>

                      {/* Integrated Technical Details and Author profile */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 pt-10 border-t border-neutral-100 dark:border-neutral-800">
                        {/* 1. Metadata */}
                        <div className="space-y-5">
                          <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Details</h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col">
                              <span className="text-[9px] text-neutral-400 uppercase tracking-widest font-bold mb-1">ISBN</span>
                              <span className="text-[11px] text-neutral-800 dark:text-neutral-200 font-medium truncate">{featuredBookDetails?.industryIdentifiers?.map((id: any) => id.identifier).join(", ") || "N/A"}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-neutral-400 uppercase tracking-widest font-bold mb-1">Pages</span>
                              <span className="text-[11px] text-neutral-800 dark:text-neutral-200 font-medium">{featuredBookDetails?.pageCount || "N/A"}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-neutral-400 uppercase tracking-widest font-bold mb-1">Published</span>
                              <span className="text-[11px] text-neutral-800 dark:text-neutral-200 font-medium">{featuredBookDetails?.publishedDate || "N/A"}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-neutral-400 uppercase tracking-widest font-bold mb-1">Language</span>
                              <span className="text-[11px] text-neutral-800 dark:text-neutral-200 font-medium uppercase">{featuredBookDetails?.language || "EN"}</span>
                            </div>
                          </div>
                        </div>

                        {/* 2. Context */}
                        <div className="space-y-5">
                          <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Context</h4>
                          <div className="space-y-4">
                            <div className="flex flex-col">
                              <span className="text-[9px] text-neutral-400 uppercase tracking-widest font-bold mb-2">Genres</span>
                              <div className="flex flex-wrap gap-1.5">
                                {(featuredBookDetails?.categories || ["Fiction"]).map((cat: string, i: number) => (
                                  <span key={i} className="px-2 py-0.5 bg-neutral-50 dark:bg-neutral-800/50 rounded text-[10px] text-kindle-accent font-bold uppercase tracking-wider border border-neutral-100 dark:border-neutral-800">
                                    {cat}
                                  </span>
                                ))}
                              </div>
                            </div>
                            {featuredBookDetails?.averageRating && (
                              <div className="flex flex-col">
                                <span className="text-[9px] text-neutral-400 uppercase tracking-widest font-bold mb-1">Rating</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-neutral-900 dark:text-white">{featuredBookDetails.averageRating}</span>
                                  <div className="flex text-kindle-accent">
                                    {[...Array(5)].map((_, i) => (
                                      <Sparkles key={i} className={`w-3 h-3 ${i < Math.floor(featuredBookDetails.averageRating) ? 'fill-current' : 'text-neutral-200 dark:text-neutral-700'}`} />
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 3. Author */}
                        <div className="space-y-5">
                          <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Author</h4>
                          <div className="space-y-3">
                            <span className="text-xs font-bold text-neutral-900 dark:text-white">{featuredBookDetails?.authors?.[0] || selectedFeaturedBook.author}</span>
                            <p className="text-[11px] text-neutral-600 dark:text-neutral-400 leading-relaxed line-clamp-3">
                              An accomplished author recognized for compelling storytelling and deep character exploration in the world of {featuredBookDetails?.categories?.[0] || "literature"}.
                            </p>
                            <button 
                              onClick={() => {
                                const author = featuredBookDetails?.authors?.[0] || selectedFeaturedBook.author;
                                handleSearch(`inauthor:"${author}"`);
                                setSelectedFeaturedBook(null);
                              }}
                              className="mt-2 text-[10px] font-bold text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 px-3 py-1.5 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors uppercase tracking-widest"
                            >
                              Search Author
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Similar Books Section */}
                      <section className="pt-10 border-t border-neutral-100 dark:border-neutral-800">
                        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 mb-6">Similar books</h3>
                        {loadingSimilar ? (
                          <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                            {[...Array(4)].map((_, i) => (
                              <div key={i} className="w-24 shrink-0 space-y-2 animate-pulse">
                                <div className="aspect-[2/3] bg-neutral-100 dark:bg-neutral-800 rounded shadow-sm" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex gap-6 overflow-x-auto pb-4 no-scrollbar custom-scrollbar">
                            {similarBooks.map((book, idx) => (
                              <div key={idx} className="w-24 shrink-0 group cursor-pointer" onClick={() => {
                                setSelectedFeaturedBook(null);
                                handleSearch(`${book.title} ${book.author}`);
                              }}>
                                <div className="aspect-[2/3] rounded shadow-sm overflow-hidden mb-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                                  {book.coverUrl && <img src={book.coverUrl} alt={book.title} className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`} />}
                                </div>
                                <p className="text-[10px] font-bold text-neutral-800 dark:text-neutral-200 line-clamp-2 leading-tight">{book.title}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
