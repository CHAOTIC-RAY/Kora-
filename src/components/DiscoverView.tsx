import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import JSZip from "jszip";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
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
  // Community (Hardcover) data fetched alongside search results
  const [communityBook, setCommunityBook] = useState<any | null>(null);
  // Background prefetch cache: page number → results
  const prefetchCache = React.useRef(new Map<number, any[]>());
  const prefetchingPage = React.useRef<number | null>(null);
  const [feedNotice, setFeedNotice] = useState<string | null>(null);

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

  async function loadFeaturedContent() {
    setLoadingFeatured(true);
    setError(null);
    try {
      const todayString = new Date().toDateString();
      const cachedDate = localStorage.getItem("kora_nyt_featured_date");
      const cachedFeed = localStorage.getItem("kora_nyt_featured_feed");

      let json: any;
      if (cachedDate === todayString && cachedFeed) {
        console.log("[NYT Cache] Loaded daily discover feed from localStorage");
        json = JSON.parse(cachedFeed);
      } else {
        console.log("[NYT Cache] Daily cache expired or missing. Fetching fresh NYT overview...");
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

        // Save to cache for today
        localStorage.setItem("kora_nyt_featured_date", todayString);
        localStorage.setItem("kora_nyt_featured_feed", JSON.stringify(json));
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

  async function fetchNYTCategory(listName: string): Promise<any[]> {
    try {
      const res = await fetch(`/api/nytimes/list?list=${encodeURIComponent(listName)}`);
      if (!res.ok) throw new Error(`NYT list fetch failed with status: ${res.status}`);
      const data = await res.json();
      
      if (data?.status !== "OK" || !data?.results?.books) {
        return [];
      }

      return data.results.books.map((book: any) => {
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
    } catch (err) {
      console.error("Failed to fetch NYT category:", err);
      return [];
    }
  }

  async function handleCategoryClick(category: any) {
    setLoading(true);
    setError(null);
    setSearchMode(true);
    setQuery(category.title);

    try {
      // Fetch NYT books for this category
      const nytBooks = await fetchNYTCategory(category.query);
      
      if (nytBooks.length === 0) {
        // Fallback to regular search if NYT fetch fails
        handleSearch(category.query);
        return;
      }

      // Search for download links for each NYT book
      const booksWithLinks: any[] = [];
      
      for (const nytBook of nytBooks.slice(0, 15)) { // Limit to first 15 books
        try {
          const searchResult = await fetchPage(nytBook.searchQuery, "all", 1);
          const matchingBooks = searchResult.books.filter((b: any) => {
            const bTitle = (b.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const nytTitle = (nytBook.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            return bTitle.includes(nytTitle.substring(0, 10)) || nytTitle.includes(bTitle.substring(0, 10));
          });

          if (matchingBooks.length > 0) {
            booksWithLinks.push({
              ...nytBook,
              downloadLinks: matchingBooks,
              exactMatch: true
            });
          } else {
            booksWithLinks.push({
              ...nytBook,
              downloadLinks: [],
              exactMatch: false
            });
          }
        } catch (err) {
          console.error(`Failed to search for ${nytBook.title}:`, err);
          booksWithLinks.push({
            ...nytBook,
            downloadLinks: [],
            exactMatch: false
          });
        }
      }

      // Group and set results
      const groupedBooksMap = new Map<string, any>();
      
      booksWithLinks.forEach((b: any) => {
        const cleanTitle = (b.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        const cleanAuthor = (b.author || "Unknown").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        const groupingKey = `${cleanTitle}___${cleanAuthor}`;

        if (!groupedBooksMap.has(groupingKey)) {
          groupedBooksMap.set(groupingKey, {
            id: b.id || Math.random().toString(),
            title: b.title,
            author: b.author,
            coverUrl: b.coverUrl,
            description: b.description,
            publisher: b.publisher,
            rank: b.rank,
            weeks_on_list: b.weeks_on_list,
            source: 'nyt',
            exactMatch: b.exactMatch,
            downloadLinks: b.downloadLinks,
            variants: b.downloadLinks
          });
        }
      });

      setResults(Array.from(groupedBooksMap.values()));
      setTotalResults(booksWithLinks.length);
      setHasMore(false);
      setAvailableSourcesFromResults(new Set(["nyt", "rave"]));
    } catch (err: any) {
      console.error("Failed to load category:", err);
      setError(`Failed to load category: ${err.message}`);
    } finally {
      setLoading(false);
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
      setResults(uniqueGroupedBooks);
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
    setCommunityBook(null);
    prefetchCache.current.clear();
  }

  async function fetchVerifiedDetails(title: string, author: string) {
    setLoadingDetails(true);
    setVerifiedDetails(null);
    setReadMoreExpanded(false);
    try {
      // 1. Try NYT API
      const nytRes = await fetch(`/api/nyt/book-details?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`);
      if (nytRes.ok) {
        const data = await nytRes.json();
        setVerifiedDetails({
          description: data.description,
          subjects: data.subjects || [],
          pageCount: data.pageCount,
          publishYear: data.publishYear,
          publisher: data.publisher,
          isBestseller: data.isBestseller,
          bestsellerRank: data.bestsellerRank,
          weeksOnList: data.weeksOnList,
          bestsellerCategory: data.bestsellerCategory,
          nytReviewSnippet: data.nytReviewSnippet,
          source: "New York Times Bestsellers & Reviews"
        });
        return;
      }

      // 2. Fall back to Open Library
      const searchRes = await fetch(`/api/open-library/search?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`);
      if (searchRes.ok) {
        const data = await searchRes.json();
        const doc = data.docs?.[0];
        if (doc) {
          let description = "";
          let subjects = doc.subject?.slice(0, 5) || [];
          
          if (doc.key) {
            try {
              const workRes = await fetch(`https://openlibrary.org${doc.key}.json`);
              if (workRes.ok) {
                const workData = await workRes.json();
                if (workData.description) {
                  if (typeof workData.description === "string") {
                    description = workData.description;
                  } else if (workData.description.value) {
                    description = workData.description.value;
                  }
                }
              }
            } catch (workErr) {
              console.warn("Failed to fetch work details from OpenLibrary:", workErr);
            }
          }

          setVerifiedDetails({
            description: description || doc.first_sentence || "",
            subjects: subjects,
            pageCount: doc.number_of_pages_median || doc.number_of_pages || undefined,
            publishYear: doc.first_publish_year?.toString() || doc.publish_date?.[0] || undefined,
            publisher: doc.publisher?.[0] || undefined,
            source: "Open Library"
          });
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
        setDownloadProgress({ 
          step: "processing", 
          percent: 75, 
          error: null 
        });

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
                        src={`/api/proxy-image?url=${encodeURIComponent(book.coverUrl)}`}
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

      {searchMode && communityBook && (
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs">
          <HardcoverCommunity book={communityBook} />
        </section>
      )}

      {!searchMode && (
        <div className="space-y-14">
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
                  <div className="aspect-[3/4] bg-kindle-card rounded-2xl border border-kindle-border" />
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
                  <section key={cat.id} className="space-y-5">
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
                              src={`/api/proxy-image?url=${encodeURIComponent(book.coverUrl)}`}
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
                    { id: "fiction", label: "Fiction", query: "fiction", icon: BookMarked, color: "text-blue-500 bg-blue-500/5 hover:bg-blue-500/10 border-blue-500/10 hover:border-blue-500/30" },
                    { id: "nonfiction", label: "Non-Fiction", query: "nonfiction", icon: BookOpen, color: "text-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/10 hover:border-emerald-500/30" },
                    { id: "documentary", label: "Documentary", query: "documentary", icon: ExternalLink, color: "text-amber-500 bg-amber-500/5 hover:bg-amber-500/10 border-amber-500/10 hover:border-amber-500/30" },
                    { id: "textbook", label: "Textbooks & Academic", query: "textbook educational", icon: Layers, color: "text-purple-500 bg-purple-500/5 hover:bg-purple-500/10 border-purple-500/10 hover:border-purple-500/30" },
                  ]
                },
                {
                  section: "Popular Genres",
                  items: [
                    { id: "sci-fi", label: "Sci-Fi & Fantasy", query: "science fiction fantasy", icon: Sparkles, color: "text-indigo-500 bg-indigo-500/5 hover:bg-indigo-500/10 border-indigo-500/10 hover:border-indigo-500/30" },
                    { id: "mystery", label: "Mystery & Thriller", query: "mystery thriller suspense", icon: Compass, color: "text-red-500 bg-red-500/5 hover:bg-red-500/10 border-red-500/10 hover:border-red-500/30" },
                    { id: "biography", label: "Biography & Memoir", query: "biography memoir autobiography", icon: Library, color: "text-teal-500 bg-teal-500/5 hover:bg-teal-500/10 border-teal-500/10 hover:border-teal-500/30" },
                    { id: "history", label: "History & Politics", query: "history historical politics", icon: Database, color: "text-amber-700 bg-amber-700/5 hover:bg-amber-700/10 border-amber-700/10 hover:border-amber-700/30" },
                    { id: "tech", label: "Technology & Science", query: "technology computing science", icon: Globe, color: "text-cyan-500 bg-cyan-500/5 hover:bg-cyan-500/10 border-cyan-500/10 hover:border-cyan-500/30" },
                    { id: "self-dev", label: "Self-Improvement", query: "self-help personal growth productivity", icon: TrendingUp, color: "text-orange-500 bg-orange-500/5 hover:bg-orange-500/10 border-orange-500/10 hover:border-orange-500/30" },
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
                <div className="w-48 md:w-full max-w-[220px] aspect-[3/4] bg-kindle-bg rounded-2xl border-2 border-kindle-border shadow-2xl overflow-hidden relative group/cover">
                  {/* Spine simulated lighting */}
                  <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-black/25 via-white/5 to-transparent z-10" />
                  <div className="absolute left-3 top-0 bottom-0 w-[1px] bg-black/10 z-10" />
                  
                  {selectedBook.coverUrl ? (
                    <img
                      src={`/api/proxy-image?url=${encodeURIComponent(selectedBook.coverUrl)}`}
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

                  {/* Format overlay on cover */}
                  {((selectedVariant || selectedBook).extension) && (
                    <div className="absolute bottom-3 right-3 bg-kindle-text text-kindle-bg text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded shadow-md z-10">
                      {(selectedVariant || selectedBook).extension}
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
                    <p className="text-sm md:text-base text-kindle-text-muted font-sans font-medium">{selectedBook.author}</p>
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
    </>
  );
}
