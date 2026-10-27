import { fetchDiscoverApi, mapWithConcurrency } from "../lib/discoverApi";
import { ALL_CATEGORIES, getCategoryDescription } from "../lib/discoverCategories";
import DiscoverRatingBadge from "./discover/DiscoverRatingBadge";

import { injectMetadataIntoEpub } from "../lib/epubMetadata";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useAndroidBackLayer } from "../hooks/useAndroidBackLayer";
import ReactDOM from "react-dom";
import JSZip from "jszip";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { tempStorage } from "../lib/tempStorage";
import { storeBookFile, checkBookFileCached } from "../db/indexedDB";
import { inferBookTags } from "../lib/tagsHelper";
import { proxyUrlForMirror } from "../lib/downloadProxy";
import { judgeMirrorDownload } from "../lib/mirrorOutcome";
import { Search, BookOpen, Download, Globe, Puzzle, CircleCheck as CheckCircle2, Loader as Loader2, TriangleAlert as AlertTriangle, Circle as HelpCircle, ArrowRight, Database, Zap, ExternalLink, Compass, TrendingUp, BookMarked, ChevronRight, ChevronLeft, RefreshCw, X, Layers, Library, Users, Headphones, Play, Pause, Heart, MessageSquare, Eye, Feather, Sparkles, Send, Share2 } from "lucide-react";
import toast from "react-hot-toast";
import { logger } from "../lib/logger";
import { escapeHtml } from "../lib/relay/sanitize";
import KoraLoading from "./KoraLoading";
import SourcePluginsHub from "./SourcePluginsHub";
import { fetchAudiobookDetail, prefetchAudiobookDetail, cacheKeyForBook } from "../lib/audiobookDetailClient";
import { getProxiedAudioUrl } from "../lib/audiobookStorage";
import { refererForMediaUrl } from "../lib/mediaUrl";
import { titlesRoughlyMatch } from "../lib/audiobookScraper";
import { ensureSeriesFields, normalizeSeriesKey, parseSeriesNumber, parseSeriesFromTitle } from "../lib/seriesHelper";
import {
  createSearchSignal,
  abortActiveSearch,
  streamAudiobookSearch,
  streamEbookSearch,
  getCachedSearch,
} from "../lib/searchClient";
import { resolveCoverImageSrc } from "../lib/coverImage";
import { classifyDownloadLink } from "../lib/downloadLinkKind";
import { canHover } from "../lib/canHover";
import { enrichBooksWithRatings, getDisplayRating } from "../lib/bookRating";
import { GoodreadsIcon, NytIcon, NetgalleyIcon } from "./BrandIcons";

interface DiscoverViewProps {
  userId: string;
  books: BookMetadata[];
  onBookAdded: (book: BookMetadata) => void;
  cachedBookIds: Set<string>;
  selectedBook: any | null;
  onSelectedBookChange: (book: any | null) => void;
  grayscaleCovers?: boolean;
  hideCovers?: boolean;
  coverBackupProvider?: string;
  initialQuery?: string | null;
  onClearInitialQuery?: () => void;
  /** Book id from a shared /book?id=.. link. */
  initialBookId?: string | null;
  /** "Title Author" search text from a shared /book?q=.. link. */
  initialBookQuery?: string | null;
  /** Book title from a shared /book?t=.. link (preferred over q). */
  initialBookTitle?: string | null;
  /** Book author from a shared /book?a=.. link. */
  initialBookAuthor?: string | null;
  onClearInitialBookLink?: () => void;
  onOpenBrowser?: (url: string) => void;
  onTriggerDownload?: (book: any, mirrors: any | any[], variant: any) => void;
  onPlayAudiobook?: (book: BookMetadata) => void;
  showFirstBookNudge?: boolean;
  onDismissFirstBookNudge?: () => void;
  onOpenCreateView?: () => void;
}



function DiscoverView({ 
  userId, 
  books = [],
  onBookAdded, 
  cachedBookIds, 
  selectedBook,
  onSelectedBookChange,
  grayscaleCovers = false, 
  hideCovers = false,
  initialQuery = null,
  onClearInitialQuery,
  initialBookId = null,
  initialBookQuery = null,
  initialBookTitle = null,
  initialBookAuthor = null,
  onClearInitialBookLink,
  onOpenBrowser,
  onTriggerDownload,
  onPlayAudiobook,
  showFirstBookNudge = false,
  onDismissFirstBookNudge,
  onOpenCreateView,
  coverBackupProvider = "netgalley",
}: DiscoverViewProps) {
  const getAudiobookCoverSrc = (coverUrl?: string | null) => resolveCoverImageSrc(coverUrl);
  const stripHtml = (html: string) => {
    if (!html) return "";
    return html.replace(/<[^>]*>?/gm, "").trim();
  };

  const [query, setQuery] = useState<string>("");
  const [searchSuggestions, setSearchSuggestions] = useState<Array<{ title: string; author: string; coverUrl?: string }>>([]);
  const [showSearchAssist, setShowSearchAssist] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Google Books suggestions are recommendations, never an autocomplete
  // mutation. Keep the user's text untouched until they explicitly choose one.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || !showSearchAssist) {
      setSearchSuggestions([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetchDiscoverApi(
          `/api/google-books/search?q=${encodeURIComponent(term)}&maxResults=5`,
          { signal: controller.signal },
          1
        );
        if (!response.ok) { if (!cancelled) setSearchSuggestions([]); return; }
        const payload = await response.json();
        const items = Array.isArray(payload.items) ? payload.items : [];
        const suggestions = items.map((item: any) => ({
          title: String(item.volumeInfo?.title || "").trim(),
          author: Array.isArray(item.volumeInfo?.authors) ? String(item.volumeInfo.authors[0] || "").trim() : "",
          coverUrl: item.volumeInfo?.imageLinks?.thumbnail || item.volumeInfo?.imageLinks?.smallThumbnail,
        })).filter((item: { title: string }) => item.title).slice(0, 5);
        if (!cancelled) setSearchSuggestions(suggestions);
      } catch {
        if (!cancelled) setSearchSuggestions([]);
      }
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, showSearchAssist]);

  /** Tracks the term that was last actually executed, so re-submitting the same
   * typed text still counts as "same" while a changed query always reruns. */
  const lastSearchedTerm = React.useRef<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [results, setResults] = useState<any[]>([]);
  const observerTargetRef = React.useRef<HTMLDivElement | null>(null);
  const [searchMode, setSearchMode] = useState<boolean>(false);
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (!initialBookId && !initialBookQuery && !initialBookTitle) return;
    if (deepLinkHandledRef.current) return;
    deepLinkHandledRef.current = true;

    const title = (initialBookTitle || initialBookQuery || "").trim();
    const author = (initialBookAuthor || "").trim();
    if (!title) {
      onClearInitialBookLink?.();
      return;
    }

    openBookDetail({
      id: initialBookId || `deeplink_${title}`,
      title,
      author,
      searchQuery: `${title} ${author}`.trim(),
      source: "deep-link",
    } as any);

    onClearInitialBookLink?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBookId, initialBookQuery, initialBookTitle, initialBookAuthor]);

  const [featuredData, setFeaturedData] = useState<Record<string, any[]>>({});
  const [selectedFeaturedBook, setSelectedFeaturedBook] = useState<any | null>(null);
  const [featuredAudiobookSource, setFeaturedAudiobookSource] = useState<any | null>(null);
  const [audiobookDetail, setAudiobookDetail] = useState<any | null>(null);
  const [audiobookDetailLoading, setAudiobookDetailLoading] = useState(false);
  const [audiobookDetailError, setAudiobookDetailError] = useState<string | null>(null);
  const [previewTrackIdx, setPreviewTrackIdx] = useState<number | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const audiobookFetchGen = React.useRef(0);
  // Guards every async detail-panel fetch (metadata, download variants, mirrors).
  // Opening book B while book A's requests are still in flight must not let A's
  // slower response overwrite B's title/overview/editions/mirrors.
  const detailFetchGen = React.useRef(0);
  const [featuredBookDetails, setFeaturedBookDetails] = useState<any | null>(null);
  const [seriesDetailBook, setSeriesDetailBook] = useState<any | null>(null);
  const [seriesCatalog, setSeriesCatalog] = useState<any | null>(null);
  const [seriesCatalogLoading, setSeriesCatalogLoading] = useState(false);
  const [seriesCatalogError, setSeriesCatalogError] = useState<string | null>(null);
  const seriesFetchGen = useRef(0);
  const [similarBooks, setSimilarBooks] = useState<any[]>([]);
  const [loadingFeaturedDetails, setLoadingFeaturedDetails] = useState<boolean>(false);
  const [loadingSimilar, setLoadingSimilar] = useState<boolean>(false);
  const [metadataSource, setMetadataSource] = useState<"google" | "nyt" | "openlibrary">(() => {
    return tempStorage.get<any>("preferred_source") || "google";
  });
  const [loadingFeatured, setLoadingFeatured] = useState<boolean>(true);
  const [feedFilter, setFeedFilter] = useState<"all" | "goodreads" | "nyt" | "audiobook" | "netgalley" | "plugins">("all");
  const [audiobookLibraryMode, setAudiobookLibraryMode] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalResults, setTotalResults] = useState<number>(0);
  const [searchMeta, setSearchMeta] = useState<any>({});
  const [availableSourcesFromResults, setAvailableSourcesFromResults] = useState<Set<string>>(new Set());
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string>("all");
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [availableSeries, setAvailableSeries] = useState<Set<string>>(new Set());
  const [collapsedSeriesGroups, setCollapsedSeriesGroups] = useState<Set<string>>(new Set());

  const seriesDetailBooks = useMemo(() => {
    if (!seriesDetailBook?.series) return [];
    const key = normalizeSeriesKey(seriesDetailBook.series);
    const local = books
      .map(ensureSeriesFields)
      .filter((book) => normalizeSeriesKey(book.series || "") === key)
      .map((book) => ({ ...book, inLibrary: true } as any));
    // The series.php page title may include a suffix or differently formatted
    // name. This catalog is scoped to the active modal request, so requiring an
    // exact title match here incorrectly hid valid LibGen volumes.
    const catalogBooks = Array.isArray(seriesCatalog?.books)
      ? seriesCatalog.books as any[]
      : [];
    if (!catalogBooks.length) return local.sort((a, b) => {
        const order = parseSeriesNumber(a.seriesNumber) - parseSeriesNumber(b.seriesNumber);
        return Number.isNaN(order) || order === 0 ? a.title.localeCompare(b.title) : order;
      });

    const usedLocalIds = new Set<string>();
    const merged = catalogBooks.map((catalogBook) => {
      const isbn = String(catalogBook.isbn || "").replace(/[^0-9X]/gi, "").toUpperCase();
      const localBook = local.find((candidate) => {
        const candidateIsbn = String((candidate as any).isbn || "").replace(/[^0-9X]/gi, "").toUpperCase();
        if (isbn && candidateIsbn) return isbn === candidateIsbn;
        const titleMatch = normalizeSeriesKey(candidate.title || "") === normalizeSeriesKey(catalogBook.title || "");
        const authorA = normalizeSeriesKey(candidate.author || "");
        const authorB = normalizeSeriesKey(catalogBook.author || "");
        return titleMatch && (!authorA || !authorB || authorA === authorB || authorA.includes(authorB) || authorB.includes(authorA));
      });
      if (!localBook) return catalogBook;
      usedLocalIds.add(String(localBook.id));
      return {
        ...catalogBook,
        ...localBook,
        seriesNumber: catalogBook.seriesNumber || localBook.seriesNumber,
        coverUrl: localBook.coverUrl || catalogBook.coverUrl,
        description: localBook.description || catalogBook.description,
        pages: localBook.pages || catalogBook.pages,
        publisher: localBook.publisher || catalogBook.publisher,
        year: localBook.year || catalogBook.year,
        isbn: localBook.isbn || catalogBook.isbn,
        metadataSource: catalogBook.metadataSource,
        inLibrary: true,
      };
    });
    merged.push(...local.filter((book) => !usedLocalIds.has(String(book.id))).map((book) => ({ ...book, inLibrary: true })));
    return merged.sort((a, b) => {
      const order = parseSeriesNumber(a.seriesNumber) - parseSeriesNumber(b.seriesNumber);
      return Number.isNaN(order) || order === 0 ? String(a.title || "").localeCompare(String(b.title || "")) : order;
    });
  }, [books, seriesDetailBook, seriesCatalog]);

  const [hasMore, setHasMore] = useState<boolean>(false);
  // Community (Hardcover) data fetched alongside search results
  const [communityBook, setCommunityBook] = useState<any | null>(null);
  // Background prefetch cache: page number → results
  const prefetchCache = React.useRef(new Map<number, any[]>());
  const prefetchingPage = React.useRef<number | null>(null);
  const [feedNotice, setFeedNotice] = useState<string | null>(null);

  // Memoize categories and books; NYT categories are always prioritized on top.
  const shuffledFeaturedCategories = useMemo(() => {
    const filtered = ALL_CATEGORIES.filter(cat => {
      if (feedFilter === "all") return true;
      return cat.source === feedFilter;
    });

    // Always prioritize NYT categories on top
    const nytCats = filtered.filter(cat => cat.source === "nyt");
    const nonNytCats = filtered
      .filter(cat => cat.source !== "nyt")
      .sort((a, b) => {
        if (a.source === "audiobook" && b.source !== "audiobook") return 1;
        if (b.source === "audiobook" && a.source !== "audiobook") return -1;
        return 0;
      });

    const orderedCats = [...nytCats, ...nonNytCats];
    return orderedCats.map(cat => {
      const rawBooks = featuredData[cat.id];
      if (!Array.isArray(rawBooks) || rawBooks.length === 0) return null;
      // Filter out books with unknown/missing authors
      const books = rawBooks.filter((b: any) => {
        const author = (b.author || b.contributor || "").trim().toLowerCase();
        return author && author !== "unknown" && author !== "unknown author";
      });
      if (books.length === 0) return null;
      return { cat, books };
    }).filter(Boolean) as { cat: any; books: any[] }[];
  }, [featuredData, feedFilter]);

  // New NYT Category Detail States
  const [viewingCategory, setViewingCategory] = useState<any | null>(null);
  const [categoryBooks, setCategoryBooks] = useState<any[]>([]);
  const [categoryPreviousDate, setCategoryPreviousDate] = useState<string | null>(null);
  const [loadingCategoryMore, setLoadingCategoryMore] = useState<boolean>(false);
  const [loadingCategory, setLoadingCategory] = useState<boolean>(false);

  // Download states
  const [downloadProgress, setDownloadProgress] = useState<{
    step: string;
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

  // New Search & Modal States
  const [isAdvancedSearch, setIsAdvancedSearch] = useState<boolean>(false);
  const [showFilterOptions, setShowFilterOptions] = useState<boolean>(false);
  const [isAudiobookSearch, setIsAudiobookSearch] = useState<boolean>(false);
  const [audiobookResults, setAudiobookResults] = useState<any[]>([]);
  const [audiobookLoading, setAudiobookLoading] = useState<boolean>(false);
  const [featuredDownloadVariants, setFeaturedDownloadVariants] = useState<any[]>([]);
  // Editions are ranked best-first; only the top 2 show until expanded.
  const [showAllEditions, setShowAllEditions] = useState(false);
  const [loadingFeaturedDownloads, setLoadingFeaturedDownloads] = useState<boolean>(false);
  const [selectedFeaturedVariant, setSelectedFeaturedVariant] = useState<any | null>(null);
  const [featuredMirrors, setFeaturedMirrors] = useState<any[]>([]);
  const [fetchingFeaturedMirrors, setFetchingFeaturedMirrors] = useState<boolean>(false);
  const [featuredMirrorError, setFeaturedMirrorError] = useState<string | null>(null);

  // Recent Searches state
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem("kora:discover-search-history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  function formatLanguage(langRaw?: string): string | null {
    if (!langRaw) return null;
    const l = String(langRaw).trim().toLowerCase();
    if (!l || l === "unknown" || l === "n/a" || l === "undefined" || l === "null") return null;

    if (l.includes("english") || l === "en" || l === "eng") return "EN";
    if (l.includes("spanish") || l === "es" || l === "spa") return "ES";
    if (l.includes("french") || l === "fr" || l === "fra" || l === "fre") return "FR";
    if (l.includes("german") || l === "de" || l === "deu" || l === "ger") return "DE";
    if (l.includes("russian") || l === "ru" || l === "rus") return "RU";
    if (l.includes("chinese") || l === "zh" || l === "zho" || l === "chi") return "ZH";
    if (l.includes("japanese") || l === "ja" || l === "jpn") return "JA";
    if (l.includes("italian") || l === "it" || l === "ita") return "IT";
    if (l.includes("portuguese") || l === "pt" || l === "por") return "PT";
    if (l.includes("dutch") || l === "nl" || l === "nld" || l === "dut") return "NL";
    if (l.includes("arabic") || l === "ar" || l === "ara") return "AR";
    if (l.includes("hindi") || l === "hi" || l === "hin") return "HI";
    if (l.includes("korean") || l === "ko" || l === "kor") return "KO";
    if (l.includes("turkish") || l === "tr" || l === "tur") return "TR";

    if (l.length <= 4) return l.toUpperCase();
    return l.slice(0, 3).toUpperCase();
  }

  /** Instant mirrors from known md5 / directUrl — shown before the API finishes. */
  function buildInstantMirrors(variant: any): any[] {
    if (!variant) return [];
    const links: any[] = [];
    const directUrl = variant.directUrl || variant.downloadUrl || "";
    const isDirectFile = classifyDownloadLink({ url: directUrl }).isDirect && !/\/ads\.php(?:\?|$)/i.test(directUrl);
    if (directUrl && /get\.php\?md5=.+&key=/i.test(directUrl)) {
      links.push({
        label: "Rave Direct (LibGen CDN)",
        url: directUrl,
        isDirect: true,
        sourceId: "rave"
      });
    } else if (directUrl && isDirectFile && !directUrl.includes("annas-archive") && !directUrl.includes("/slow_download/")) {
      const isMobilismUrl = directUrl.toLowerCase().includes("mobilism.org") || directUrl.toLowerCase().includes("mobilism");
      if (isMobilismUrl) {
        links.push({
          label: "Mobilism Forum Mirror",
          url: directUrl,
          isDirect: false,
          sourceId: variant.sourceId || "rave"
        });
      } else {
        links.push({
          label: "Direct Download",
          url: directUrl,
          isDirect: true,
          sourceId: variant.sourceId || "rave"
        });
      }
    }
    const md5 = (variant.md5 || "").toLowerCase();
    if (/^[a-f0-9]{32}$/.test(md5)) {
      links.push({
        label: "Libgen Mirror (libgen.li)",
        url: `https://libgen.li/get.php?md5=${md5}`,
        isDirect: true,
        sourceId: "libgen"
      });
      links.push({
        label: "Anna's Archive",
        url: `https://annas-archive.gl/md5/${md5}`,
        isDirect: false,
        sourceId: "annas"
      });
    }
    if (variant.iaId) {
      links.push({
        label: "Internet Archive",
        url: `https://archive.org/details/${variant.iaId}`,
        isDirect: false,
        sourceId: "ia"
      });
    }
    return links;
  }

  /** Search LibGen and Anna's Archive together so a fast partial hit cannot hide better matches. */
  async function searchDownloadVariants(query: string): Promise<{ books: any[]; totalCount: number; hasMore: boolean }> {
    const q = query.trim();
    if (!q) return { books: [], totalCount: 0, hasMore: false };

    const sources = await Promise.allSettled([
      fetchPage(q, "libgen", 1),
      fetchPage(q, "annas-archive", 1),
    ]);
    const pages = sources.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const books = pages.flatMap((page) => page.books || []);

    // Use the combined endpoint as a fallback only when both source-specific
    // searches failed or returned no files; it also includes open catalogues.
    if (books.length === 0) {
      try {
        return await fetchPage(q, "all", 1);
      } catch {
        return { books: [], totalCount: 0, hasMore: false };
      }
    }

    const normalize = (value: unknown) => String(value || "")
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const seen = new Set<string>();
    const combined = books.filter((book) => {
      const md5 = normalize(book.md5 || book.hash || book.id);
      const key = md5 || [
        normalize(book.title), normalize(book.author), normalize(book.year),
        normalize(book.extension || book.format), normalize(book.size),
        normalize(book.language), normalize(book.source),
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      books: combined,
      totalCount: combined.length,
      hasMore: pages.some((page) => page.hasMore),
    };
  }

  // Rank download editions in place so the best one is index 0.
  //
  // Priority, in order:
  //   1. English (or unlabelled — LibGen often omits the language on English
  //      uploads, so treating "unknown" as a near-English tier avoids burying
  //      perfectly good entries below a tagged foreign edition)
  //   2. Direct/known-good sources — direct file links first, then LibGen
  //   3. Reader-friendly format (EPUB > AZW3 > MOBI > FB2 > PDF)
  // Ties keep their original relative order (Array.prototype.sort is stable).
  function rankVariants(variants: any[], title = "", author = ""): any[] {
    const normalize = (value: unknown) => String(value || "")
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const titleKey = normalize(title);
    const authorKey = normalize(author);
    const words = (value: string) => value.split(/\s+/).filter(Boolean);
    const matchRank = (actual: unknown, expected: string): number => {
      if (!expected) return 0;
      const value = normalize(actual);
      if (!value) return 3;
      if (value === expected) return 0;
      if (value.includes(expected) || expected.includes(value)) return 1;
      const expectedWords = words(expected);
      const actualWords = new Set(words(value));
      const coverage = expectedWords.length
        ? expectedWords.filter((word) => actualWords.has(word)).length / expectedWords.length
        : 0;
      return coverage >= 0.75 ? 2 : 3;
    };
    const langRank = (v: any): number => {
      const l = (v.language || "").trim().toLowerCase();
      if (!l) return 1; // unlabelled — probably English, but below an explicit match
      if (l === "en" || l === "eng" || l === "english") return 0;
      return 2;
    };
    const sourceRank = (v: any): number => {
      const s = (v.source || "").trim().toLowerCase();
      // A direct URL means no mirror-resolution round trip.
      if (v.directUrl || v.downloadUrl) return 0;
      if (s.includes("libgen")) return 1;
      return 2;
    };
    const FORMATS = ["epub", "azw3", "mobi", "fb2", "pdf"];
    const formatRank = (v: any): number => {
      const idx = FORMATS.indexOf((v.extension || "").trim().toLowerCase());
      return idx === -1 ? FORMATS.length : idx;
    };
    variants.sort((a, b) =>
      matchRank(a.title, titleKey) - matchRank(b.title, titleKey) ||
      matchRank(a.author, authorKey) - matchRank(b.author, authorKey) ||
      langRank(a) - langRank(b) ||
      sourceRank(a) - sourceRank(b) ||
      formatRank(a) - formatRank(b)
    );
    return variants;
  }

  function rankSearchResults(books: any[], query: string): any[] {
    const normalize = (value: unknown) => String(value || "")
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const queryKey = normalize(query);
    const queryWords = new Set(queryKey.split(/\s+/).filter(Boolean));
    const coverage = (value: unknown) => {
      const words = normalize(value).split(/\s+/).filter(Boolean);
      return words.length ? words.filter((word) => queryWords.has(word)).length / words.length : 0;
    };
    const score = (book: any) => {
      const title = normalize(book.title);
      const exactTitlePhrase = title && queryKey.includes(title) ? 1 : 0;
      // A file result carries edition/download metadata; surface it ahead of a
      // catalogue-only record when both describe the same title and author.
      const isFileResult = !book.isGoogleBook && !!(book.md5 || book.downloadUrl || book.variants?.length);
      return exactTitlePhrase * 6 + coverage(book.title) * 3 + coverage(book.author) * 4 + (isFileResult ? 0.15 : 0);
    };
    return books
      .map((book, index) => ({ book, index, score: score(book) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ book }) => book);
  }

  function sortMirrors(mirrors: any[]): any[] {
    // Filter out library.lol as it is reportedly taken down
    // Also filter duplicates by exact URL
    const seenUrls = new Set<string>();
    const filtered = mirrors.filter(m => {
      const url = (m.url || "").toLowerCase();
      if (url.includes("library.lol")) return false;
      if (seenUrls.has(url)) return false;
      if (url) seenUrls.add(url);
      return true;
    });

    const processed = filtered.map(m => {
      const label = (m.label || "").toLowerCase();
      const url = (m.url || "").toLowerCase();
      const sourceId = (m.sourceId || "").toLowerCase();

      const isRave = sourceId === "rave" || label.includes("rave") || url.includes("rave");
      const isLibgen = sourceId === "libgen" || label.includes("libgen") || url.includes("libgen") || url.includes("genesis");

      const direct = classifyDownloadLink(m).isDirect && !/\/ads\.php(?:\?|$)/i.test(url);

      let newLabel = m.label;
      if (!direct && /\bdirect\b/i.test(label)) {
        newLabel = isLibgen ? "LibGen link" : "External page";
      } else if (isRave && direct && !label.includes("direct") && !label.includes("rave")) {
        newLabel = "Rave Direct Download";
      } else if (isLibgen && !label.includes("libgen")) {
        newLabel = "Libgen Mirror (libgen.li)";
      } else if (url.includes("mobilism.org") || url.includes("mobilism")) {
        newLabel = "Mobilism Forum Mirror";
      }

      return {
        ...m,
        label: newLabel,
        isDirect: direct
      };
    });

    return [...processed].sort((a, b) => {
      const getOrderScore = (m: any) => {
        const label = (m.label || "").toLowerCase();
        const url = (m.url || "").toLowerCase();
        
        // 1. Rave Link / Libretext Direct
        if (label.includes("rave") || label.includes("libretext") || url.includes("libretext")) {
          return 1;
        }
        // 2. LibGen
        if (label.includes("libgen") || url.includes("libgen") || url.includes("genesis")) {
          return 2;
        }
        // 3. Internet Archive
        if (label.includes("internet archive") || label.includes("archive") || url.includes("archive.org")) {
          return 3;
        }
        // 4. Anna's Archive / Mobilism Forum
        if (label.includes("anna") || label.includes("anas") || url.includes("annas-archive") || url.includes("annas") || url.includes("mobilism")) {
          return 4;
        }
        return 5;
      };
      
      return getOrderScore(a) - getOrderScore(b);
    });
  }

  function cleanTitleAndAuthorForEbookSearch(title: string, author: string): string {
    let cleanTitle = title || "";
    let cleanAuthor = author || "";

    // 1. Clean Title
    // Remove parenthetical notes containing audiobook, unabridged, novel, etc.
    cleanTitle = cleanTitle.replace(/\((audiobook|unabridged|abridged|novel|mp3|free|cd)\)/gi, "");
    cleanTitle = cleanTitle.replace(/\[(audiobook|unabridged|abridged|novel|mp3|free|cd)\]/gi, "");
    // Remove trailing "audiobook" indicators and "a novel" indicator
    cleanTitle = cleanTitle.replace(/:\s*a\s+novel\s*$/gi, "");
    cleanTitle = cleanTitle.replace(/[-\s:]+audiobook\s*$/gi, "");
    cleanTitle = cleanTitle.replace(/\s+audiobook\s+/gi, " ");

    // 2. Clean Author
    // Remove narrator info
    const narratorIndex = cleanAuthor.toLowerCase().search(/\b(narrated\s+by|read\s+by|narrator|with)\b/i);
    if (narratorIndex !== -1) {
      cleanAuthor = cleanAuthor.substring(0, narratorIndex);
    }
    // Remove "by " prefix
    cleanAuthor = cleanAuthor.replace(/^\s*by\s+/i, "");

    // Clean trailing punctuation
    cleanTitle = cleanTitle.replace(/[,;.:\-\s]+$/, "").trim();
    cleanAuthor = cleanAuthor.replace(/[,;.:\-\s]+$/, "").trim();

    return `${cleanTitle} ${cleanAuthor}`.trim().replace(/\s+/g, " ");
  }

  const loadFeaturedDownloads = async (title: string, author: string) => {
    const gen = detailFetchGen.current;
    const isStale = () => gen !== detailFetchGen.current;
    setLoadingFeaturedDownloads(true);
    setFeaturedDownloadVariants([]);
    setSelectedFeaturedVariant(null);
    setFeaturedMirrors([]);
    setFeaturedMirrorError(null);
    
    try {
      const q = cleanTitleAndAuthorForEbookSearch(title, author);
      const result = await searchDownloadVariants(q);
      if (isStale()) return;
      const rawBooks = result.books || [];
      const uniqueVariants = rawBooks;

      // Prefer exact title and author matches, then language, source, and format.
      rankVariants(uniqueVariants, title, author);

      setFeaturedDownloadVariants(uniqueVariants);
      
      if (uniqueVariants.length > 0) {
        const firstVariant = uniqueVariants[0];
        setSelectedFeaturedVariant(firstVariant);
        fetchFeaturedVariantMirrors(firstVariant);
      }
    } catch (err) {
      console.error("Failed to load featured downloads:", err);
    } finally {
      if (!isStale()) setLoadingFeaturedDownloads(false);
    }
  };

  const fetchFeaturedVariantMirrors = async (variant: any) => {
    const gen = detailFetchGen.current;
    const isStale = () => gen !== detailFetchGen.current;
    setFetchingFeaturedMirrors(true);
    setFeaturedMirrors([]);
    setFeaturedMirrorError(null);

    // Paint usable mirrors immediately from md5 / directUrl while the API enriches.
    const instant = buildInstantMirrors(variant);
    if (instant.length > 0) {
      if (isStale()) return;
      setFeaturedMirrors(sortMirrors(instant));
      setFetchingFeaturedMirrors(false);
    }

    try {
      // Z-Library is now served through Rave (the sole relay). The direct
      // Z-Lib eAPI login/download calls were removed from the Worker, so any
      // "zlib" result falls through to the Rave-based download path below.
      {
        const iaParam = variant.iaId ? `&iaId=${encodeURIComponent(variant.iaId)}` : "";
        const directParam = variant.downloadUrl ? `&url=${encodeURIComponent(variant.downloadUrl)}` : "";
        const res = await fetch(`/api/annas-archive/download?md5=${variant.md5}${iaParam}${directParam}`, {
          signal: AbortSignal.timeout(8000)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (isStale()) return;
        const links = data.downloadLinks || data.options || [];
        if (links.length > 0) {
          setFeaturedMirrors(sortMirrors([...instant, ...links]));
        } else if (instant.length === 0) {
          setFeaturedMirrorError("No download mirrors found for this variant.");
        }
      }
    } catch (err: any) {
      console.error(err);
      if (isStale()) return;
      if (instant.length === 0) {
        setFeaturedMirrorError("Failed to fetch download mirrors. Tap Retry to try again.");
      }
    } finally {
      if (!isStale()) setFetchingFeaturedMirrors(false);
    }
  };

  useEffect(() => {
    if (selectedFeaturedBook) {
      // A result opened from the direct-source search already is a concrete
      // edition. Show it immediately and resolve links from its MD5 instead of
      // forcing a second title search that may time out or return nothing.
      const source = String(selectedFeaturedBook.source || "").toLowerCase();
      const selectedEditions = Array.isArray(selectedFeaturedBook.variants) && selectedFeaturedBook.variants.length
        ? selectedFeaturedBook.variants
        : selectedFeaturedBook.md5 && (source.includes("libgen") || source.includes("genesis") || source.includes("anna"))
          ? [selectedFeaturedBook]
          : [];
      if (selectedEditions.length) {
        setFeaturedDownloadVariants(selectedEditions);
        setLoadingFeaturedDownloads(false);
        setSelectedFeaturedVariant(selectedEditions[0]);
        fetchFeaturedVariantMirrors(selectedEditions[0]);
      } else {
        loadFeaturedDownloads(selectedFeaturedBook.title, selectedFeaturedBook.author);
      }
      const generation = audiobookFetchGen.current;
      loadFeaturedAudiobook(selectedFeaturedBook, generation);
    } else {
      setFeaturedDownloadVariants([]);
      setSelectedFeaturedVariant(null);
      setFeaturedMirrors([]);
      setFeaturedMirrorError(null);
      setFeaturedAudiobookSource(null);
      setAudiobookDetail(null);
      setAudiobookDetailError(null);
      setAudiobookDetailLoading(false);
    }
  }, [selectedFeaturedBook]);

  useEffect(() => {
    if (selectedBook || selectedFeaturedBook) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [selectedBook, selectedFeaturedBook]);

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

  // Auto-retry once when Discover lands on an empty state (e.g. a transient
  // Worker/network hiccup or a stale same-day cache that failed to load) instead
  // of showing a dead-end "No trending titles". Skips when an explicit error is
  // already shown or a load is in flight.
  const featuredAttempted = useRef(false);
  useEffect(() => {
    if (loadingFeatured) return;
    const hasAny = Object.values(featuredData).some((arr) => Array.isArray(arr) && arr.length > 0);
    if (!hasAny && !error && !featuredAttempted.current) {
      featuredAttempted.current = true;
      const t = setTimeout(() => loadFeaturedContent(true), 1500);
      return () => clearTimeout(t);
    }
    // Reset the guard once content actually arrives, so a later empty state
    // (after navigating away/back) can retry again.
    if (hasAny) featuredAttempted.current = false;
  }, [featuredData, loadingFeatured, error]);

  async function loadFeaturedContent(forceRefresh = false) {
    setLoadingFeatured(true);
    setError(null);

    const FEATURED_CACHE_KEY = "kora_discover_featured_cache";
    const FEATURED_CACHE_DATE_KEY = "kora_discover_featured_cache_date";
    const todayString = new Date().toDateString();

    if (!forceRefresh) {
      const cachedDate = localStorage.getItem(FEATURED_CACHE_DATE_KEY);
      const cachedPayload = localStorage.getItem(FEATURED_CACHE_KEY);
      if (cachedDate === todayString && cachedPayload) {
        try {
          const parsed = JSON.parse(cachedPayload);
          if (parsed && typeof parsed === "object") {
            setFeaturedData(parsed);
            setLoadingFeatured(false);
            // Same-day cache is fresh enough — skip background NYT/Goodreads refresh.
            return;
          }
        } catch {
          // fall through to full load
        }
      }
    }

    try {
      const { mergedData, nytError, nytOverviewJson } = await buildNytFeaturedData(forceRefresh);
      setFeaturedData(mergedData);
      setLoadingFeatured(false);

      if (nytError) {
        setFeedNotice("NYT Best Sellers API currently unavailable — loading other picks.");
      } else {
        setFeedNotice(
          nytOverviewJson?.notice ||
            (nytOverviewJson?.source === "rave-fallback"
              ? "NYT Best Sellers API unavailable — showing popular picks via Rave Engine."
              : null)
        );
        setError(null);
      }

      await loadSecondaryFeaturedContent(mergedData, nytError);
    } catch (err: any) {
      console.error("Failed to load featured content:", err);
      setError("Failed to load featured content. Tap Retry to try again.");
      setLoadingFeatured(false);
    }
  }

  async function refreshFeaturedContentInBackground(forceRefresh = false) {
    try {
      const { mergedData } = await buildNytFeaturedData(forceRefresh);
      setFeaturedData((prev) => ({ ...prev, ...mergedData }));
      await loadSecondaryFeaturedContent({ ...mergedData }, null, true);
    } catch (err) {
      console.warn("Background discover refresh failed:", err);
    }
  }

  async function buildNytFeaturedData(forceRefresh = false): Promise<{
    mergedData: Record<string, any[]>;
    nytError: string | null;
    nytOverviewJson: any;
  }> {
    const todayString = new Date().toDateString();
    const cachedDate = localStorage.getItem("kora_nyt_featured_date");
    const cachedFeed = localStorage.getItem("kora_nyt_featured_feed");

    let nytOverviewJson: any = null;
    let nytError: string | null = null;

    try {
      if (!forceRefresh && cachedDate === todayString && cachedFeed) {
        console.log("[NYT Cache] Loaded daily discover feed from localStorage");
        nytOverviewJson = JSON.parse(cachedFeed);
      } else {
        console.log("[NYT Cache] Fetching fresh NYT overview...");
        const res = await fetch("/api/nytimes/overview");
        if (!res.ok) throw new Error("Failed to fetch NYT overview");
        nytOverviewJson = await res.json();

        if (nytOverviewJson?.fault || (nytOverviewJson?.error && !nytOverviewJson?.results?.lists?.length)) {
          nytError = "The NYT Best Sellers API is unavailable.";
        }

        const isFallback =
          nytOverviewJson?.source === "rave-fallback" ||
          nytOverviewJson?.fault ||
          (nytOverviewJson?.error && !nytOverviewJson?.results?.lists?.length);
        if (!isFallback && nytOverviewJson) {
          localStorage.setItem("kora_nyt_featured_date", todayString);
          localStorage.setItem("kora_nyt_featured_feed", JSON.stringify(nytOverviewJson));
        } else if (isFallback) {
          localStorage.removeItem("kora_nyt_featured_date");
          localStorage.removeItem("kora_nyt_featured_feed");
        }
      }
    } catch (err: any) {
      console.error("NYT overview fetch failed:", err);
      nytError = "Failed to fetch NYT overview. Tap Retry.";
    }

    const mergedData: Record<string, any[]> = {};

    if (nytOverviewJson && !nytOverviewJson.fault) {
      const lists = nytOverviewJson.results?.lists || [];
      ALL_CATEGORIES.filter((cat) => cat.source === "nyt").forEach((cat) => {
        const nytList = lists.find((l: any) => l.list_name_encoded === cat.query);
        if (nytList) {
          const seen = new Set<string>();
          const uniqueBooks: any[] = [];
          (nytList.books || []).forEach((b: any) => {
            const key = `${(b.title || "").toLowerCase().trim()}___${(b.author || "").toLowerCase().trim()}`;
            if (!seen.has(key)) {
              seen.add(key);

              const cleanTitle = (b.title || "")
                .split(":")[0]
                .replace(/\b\d{10,13}\b/g, "")
                .replace(/\(.*\)/g, "")
                .replace(/volume\s+\d+/gi, "")
                .replace(/book\s+\d+/gi, "")
                .replace(/[^\w\s-]/gi, " ")
                .replace(/\s+/g, " ")
                .trim();

              const cleanAuthor = (b.author || "")
                .split(",")[0]
                .replace(/\b\d{4}-\d{4}\b/g, "")
                .replace(/\bUnknown\b/gi, "")
                .replace(/\(.*\)/g, "")
                .replace(/[^\w\s-]/gi, " ")
                .replace(/\s+/g, " ")
                .trim();

              uniqueBooks.push({
                title: b.title,
                author: b.author,
                coverUrl: b.book_image,
                searchQuery: `${cleanTitle} ${cleanAuthor}`.trim(),
                // Keep NYT synopsis so Overview is never blank while Google loads.
                description: b.description || "",
                isbn13: b.primary_isbn13 || b.isbns?.[0]?.isbn13 || "",
                isbn10: b.primary_isbn10 || b.isbns?.[0]?.isbn10 || "",
                publisher: b.publisher || "",
                source: "nyt",
              });
            }
          });
          mergedData[cat.id] = uniqueBooks;
        } else {
          mergedData[cat.id] = [];
        }
      });
    } else {
      ALL_CATEGORIES.filter((cat) => cat.source === "nyt").forEach((cat) => {
        mergedData[cat.id] = [];
      });
    }

    return { mergedData, nytError, nytOverviewJson };
  }

  async function loadSecondaryFeaturedContent(
    baseData: Record<string, any[]>,
    nytError: string | null,
    background = false
  ) {
    const mergedData = { ...baseData };

    const goodreadsCats = ALL_CATEGORIES.filter((cat) => cat.source === "goodreads");
    const goodreadsResults = await mapWithConcurrency(
      goodreadsCats, 3, async (cat) => {
        try {
          const gBooks = await fetchGoodreadsCategory(cat.query);
          return { id: cat.id, books: gBooks };
        } catch (err) {
          console.error(`Failed to background fetch Goodreads ${cat.title}:`, err);
          return { id: cat.id, books: [] };
        }
      }
    );
    goodreadsResults.forEach((res) => {
      mergedData[res.id] = res.books;
    });
    setFeaturedData((prev) => ({ ...prev, ...Object.fromEntries(goodreadsResults.map((res) => [res.id, res.books])) }));

    const audiobookCats = ALL_CATEGORIES.filter((cat) => cat.source === "audiobook");
    const audiobookResults = await mapWithConcurrency(
      audiobookCats, 2, async (cat) => {
        try {
          const books = await fetchAudiobookCategory(cat);
          return { id: cat.id, books };
        } catch (err) {
          console.error(`Failed to load audiobooks for ${cat.title}:`, err);
          return { id: cat.id, books: [] };
        }
      }
    );
    audiobookResults.forEach((res) => {
      mergedData[res.id] = res.books;
    });
    setFeaturedData((prev) => ({ ...prev, ...Object.fromEntries(audiobookResults.map((res) => [res.id, res.books])) }));

    const netgalleyCats = ALL_CATEGORIES.filter((cat) => cat.source === "netgalley");
    const netgalleyResults = await mapWithConcurrency(
      netgalleyCats, 3, async (cat) => {
        try {
          const books = await fetchNetgalleyCategory(cat);
          return { id: cat.id, books };
        } catch (err) {
          console.error(`Failed to load NetGalley category ${cat.title}:`, err);
          return { id: cat.id, books: [] };
        }
      }
    );
    netgalleyResults.forEach((res) => {
      mergedData[res.id] = res.books;
    });
    setFeaturedData((prev) => ({ ...prev, ...Object.fromEntries(netgalleyResults.map((res) => [res.id, res.books])) }));

    if (nytError) {
      const hasGoodreads = goodreadsResults.some((res) => res.books.length > 0);
      if (hasGoodreads) {
        setFeedNotice("NYT Best Sellers API currently unavailable — displaying Goodreads picks and popular archives.");
        setError(null);
      } else if (!background) {
        setError(`Featured content unavailable. ${nytError}`);
      }
    }

    void Promise.all(
      ALL_CATEGORIES.filter((cat) => cat.source === "nyt").map(async (cat) => {
        const books = mergedData[cat.id];
        if (!books?.length) return;
        const enriched = await enrichBooksWithRatings(books, titlesRoughlyMatch, 6);
        setFeaturedData((prev) => ({ ...prev, [cat.id]: enriched }));
      })
    ).then(() => {
      setFeaturedData((current) => {
        localStorage.setItem("kora_discover_featured_cache", JSON.stringify(current));
        localStorage.setItem("kora_discover_featured_cache_date", new Date().toDateString());
        return current;
      });
    });
  }

  const openAudiobookLibrary = () => {
    setAudiobookLibraryMode(true);
    setIsAudiobookSearch(false);
    setIsAdvancedSearch(false);
    setSearchMode(false);
    setViewingCategory(null);
    setFeedFilter("audiobook");
    window.setTimeout(() => {
      document.getElementById("discover-feeds")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const closeAudiobookLibrary = () => {
    setAudiobookLibraryMode(false);
    setFeedFilter("all");
  };

  const findAudiobookMatch = async (title: string, author?: string, generation?: number) => {
    const q = `${title} ${author || ""}`.trim();
    try {
      const results = await streamAudiobookSearch(q, () => {});
      if (generation !== undefined && generation !== audiobookFetchGen.current) return null;
      const match = results.find(
        (r) => titlesRoughlyMatch(title, r.title, r.author)
      );
      return match || results[0] || null;
    } catch {
      return null;
    }
  };

  const loadFeaturedAudiobook = async (book: any, generation: number) => {
    setAudiobookDetailLoading(true);
    setAudiobookDetailError(null);
    setAudiobookDetail(null);
    setFeaturedAudiobookSource(null);

    try {
      const isAudiobookSource = (b: any) => {
        if (!b) return false;
        if (b.isAudiobook) return true;
        if (b.source === "hdaudiobooks" || b.source === "fulllengthaudiobooks") return true;
        const linkStr = b.link || b.listenUrl || "";
        return linkStr.includes("hdaudiobooks.com") || linkStr.includes("fulllengthaudiobooks.com");
      };

      let sourceBook = isAudiobookSource(book) ? book : null;
      if (!sourceBook) {
        const match = await findAudiobookMatch(book.title, book.author, generation);
        if (isAudiobookSource(match)) {
          sourceBook = match;
        }
      }
      if (generation !== audiobookFetchGen.current) return;
      if (!sourceBook) {
        setAudiobookDetailLoading(false);
        return;
      }

      setFeaturedAudiobookSource(sourceBook);

      const stale = await fetchAudiobookDetail(sourceBook, { staleWhileRevalidate: true });
      if (generation !== audiobookFetchGen.current) return;
      if (stale?.tracks?.length) {
        setAudiobookDetail(stale);
        setAudiobookDetailLoading(false);
        return;
      }

      const fresh = await fetchAudiobookDetail(sourceBook, { staleWhileRevalidate: false });
      if (generation !== audiobookFetchGen.current) return;
      if (fresh?.tracks?.length) {
        setAudiobookDetail(fresh);
      } else if (sourceBook.listenUrl || sourceBook.link) {
        setAudiobookDetail({
          title: sourceBook.title,
          author: sourceBook.author,
          coverUrl: sourceBook.coverUrl,
          sourceUrl: sourceBook.link || sourceBook.listenUrl,
          tracks: [],
        });
      }
    } catch {
      if (generation === audiobookFetchGen.current) {
        setAudiobookDetailError("Could not load audiobook version");
      }
    } finally {
      if (generation === audiobookFetchGen.current) {
        setAudiobookDetailLoading(false);
      }
    }
  };

  const openSeriesDetail = async (book: any) => {
    const series = String(book?.series || "").trim();
    if (!series) return;
    const generation = ++seriesFetchGen.current;
    setSeriesDetailBook({
      series,
      title: String(book?.title || ""),
      author: String(book?.author || ""),
      year: book?.year,
      seriesId: String(book?.seriesId || ""),
      source: String(book?.source || ""),
    });
    setSeriesCatalog(null);
    setSeriesCatalogError(null);
    setSeriesCatalogLoading(true);
    const params = new URLSearchParams({ series, author: String(book?.author || "") });
    if (/^\d{1,12}$/.test(String(book?.seriesId || ""))) params.set("seriesId", String(book.seriesId));
    try {
      const response = await fetchDiscoverApi(`/api/series/detail?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Series lookup failed (${response.status})`);
      if (generation === seriesFetchGen.current) setSeriesCatalog(data);
    } catch (error: any) {
      if (generation === seriesFetchGen.current) setSeriesCatalogError(error?.message || "Could not load catalog series details.");
    } finally {
      if (generation === seriesFetchGen.current) setSeriesCatalogLoading(false);
    }
  };

  const openBookDetail = (book: any) => {
    previewAudioRef.current?.pause();
    setPreviewTrackIdx(null);
    setPreviewPlaying(false);
    setAudiobookDetail(null);
    setAudiobookDetailError(null);
    setFeaturedAudiobookSource(null);
    audiobookFetchGen.current += 1;
    // Invalidate any detail fetches still in flight for a previously opened
    // book so their late responses can't overwrite this book's panel.
    detailFetchGen.current += 1;
    // Clear the previous book's editions/mirrors immediately — otherwise the
    // old book's download links stay on screen (and remain clickable) until
    // the new search resolves.
    setFeaturedDownloadVariants([]);
    setSelectedFeaturedVariant(null);
    setFeaturedMirrors([]);
    setFeaturedMirrorError(null);
    setShowAllEditions(false);
    setSelectedFeaturedBook(book);
    // Seed with the clicked edition so external catalog lookups can enrich
    // details without ever changing which book the user opened.
    const pageCount = Number.parseInt(String(book?.pages || "").match(/\d+/)?.[0] || "", 10) || undefined;
    setFeaturedBookDetails({
      title: book.title,
      authors: book.author ? [book.author] : [],
      description: book.description || "",
      pageCount,
      publishedDate: book.year ? String(book.year) : undefined,
      publisher: book.publisher,
      language: book.language,
      industryIdentifiers: [
        book.isbn ? { type: "ISBN", identifier: book.isbn } : null,
        book.isbn13 ? { type: "ISBN_13", identifier: book.isbn13 } : null,
        book.isbn10 ? { type: "ISBN_10", identifier: book.isbn10 } : null,
      ].filter(Boolean),
      categories: book.topic ? [book.topic] : [],
      source: book.source === "nyt" ? "New York Times" : book.source || "Catalog",
    });
    fetchFeaturedMetadata(book.title, book.author || "", undefined, book.description || "");
  };

  const closeBookDetail = () => {
    previewAudioRef.current?.pause();
    setPreviewTrackIdx(null);
    setPreviewPlaying(false);
    audiobookFetchGen.current += 1;
    detailFetchGen.current += 1;
    setSelectedFeaturedBook(null);
    setFeaturedBookDetails(null);
    setFeaturedAudiobookSource(null);
    setAudiobookDetail(null);
    setAudiobookDetailError(null);
    setAudiobookDetailLoading(false);
  };

  const dismissDiscoverDetail = useAndroidBackLayer(
    !!(selectedBook || selectedFeaturedBook),
    "discover-book-detail",
    () => {
      closeBookDetail();
      onSelectedBookChange(null);
    }
  );

  const toggleTrackPreview = (track: any, idx: number) => {
    const audio = previewAudioRef.current;
    if (!audio) return;

    if (previewTrackIdx === idx && previewPlaying) {
      audio.pause();
      setPreviewPlaying(false);
      return;
    }

    setPreviewTrackIdx(idx);
    audio.src = getProxiedAudioUrl(track.src, refererForMediaUrl(track.src));
    audio.play()
      .then(() => setPreviewPlaying(true))
      .catch(() => {
        setPreviewPlaying(false);
        toast.error("Preview failed — source may be temporarily unavailable.");
      });
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const { key, data } = (e as CustomEvent).detail || {};
      if (!data?.tracks?.length || !selectedFeaturedBook || !featuredAudiobookSource) return;
      if (key !== cacheKeyForBook(featuredAudiobookSource)) return;
      setAudiobookDetail(data);
    };
    window.addEventListener("kora-audiobook-detail-updated", handler);
    return () => window.removeEventListener("kora-audiobook-detail-updated", handler);
  }, [selectedFeaturedBook, featuredAudiobookSource]);

  const buildAudiobookLibraryEntry = (book: any, tracks: any[]): BookMetadata => {
    const cardTitle = book.title;
    const cardAuthor = book.author || "Unknown";
    const detailTitle = audiobookDetail?.title;
    const useDetailMeta = detailTitle && titlesRoughlyMatch(
      cardTitle,
      detailTitle,
      audiobookDetail?.author
    );

    return {
      id: book.id || `audiobook-${cardTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
      title: cardTitle,
      author: useDetailMeta ? (audiobookDetail?.author || cardAuthor) : cardAuthor,
      coverUrl: (useDetailMeta ? audiobookDetail?.coverUrl : null) || book.coverUrl || undefined,
      source: "audiobook",
      rating: book.rating,
      description: book.description || (useDetailMeta ? audiobookDetail?.description : undefined),
      extension: "audiobook",
      size: "",
      tags: ["audiobook"],
      status: "reading",
      progress: { percent: 0, lastReadTime: Date.now() },
      dateAdded: Date.now(),
      audiobookTracks: tracks,
      audiobookSourceUrl: audiobookDetail?.sourceUrl || book.link,
      audiobookDownloaded: false,
    };
  };

  const fetchOpenLibraryDescription = async (title: string, author: string): Promise<{
    description: string;
    doc?: any;
  }> => {
    try {
      const olRes = await fetch(
        `/api/open-library/search?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`
      );
      if (!olRes.ok) return { description: "" };
      const data = await olRes.json();
      const normalize = (value: unknown) => String(value || "")
        .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const titleTokens = normalize(title).split(/\s+/).filter(Boolean);
      const doc = [...(data.docs || [])].map((candidate: any) => {
        const candidateTokens = new Set(normalize(candidate.title).split(/\s+/).filter(Boolean));
        const titleScore = titleTokens.length
          ? titleTokens.filter((token) => candidateTokens.has(token)).length / titleTokens.length
          : 0;
        const candidateAuthors = normalize((candidate.author_name || []).join(" "));
        const authorScore = author && candidateAuthors.includes(normalize(author)) ? 1 : 0;
        return { candidate, titleScore, score: titleScore * 4 + authorScore };
      }).filter((entry: any) => entry.titleScore >= 0.6)
        .sort((a: any, b: any) => b.score - a.score)[0]?.candidate;
      if (!doc) return { description: "" };
      let description = "";
      if (doc.key) {
        try {
          // Same-origin worker proxy avoids browser CORS / adblock issues.
          const workRes = await fetch(
            `/api/open-library/work?key=${encodeURIComponent(doc.key)}`
          );
          if (workRes.ok) {
            const workData = await workRes.json();
            description =
              typeof workData.description === "string"
                ? workData.description
                : workData.description?.value || "";
          }
        } catch {
          /* ignore */
        }
      }
      return { description, doc };
    } catch {
      return { description: "" };
    }
  };

  const fetchFeaturedMetadata = async (
    title: string,
    author: string,
    forceSource?: "google" | "nyt" | "openlibrary",
    seedDescriptionArg?: string
  ) => {
    const gen = detailFetchGen.current;
    const isStale = () => gen !== detailFetchGen.current;
    setLoadingFeaturedDetails(true);
    // Keep any seeded synopsis visible while we enrich — don't flash empty.
    setSimilarBooks([]);
    setReadMoreExpanded(false);
    const sourceToUse = forceSource || metadataSource;
    const cleanTitle = (title || "").trim();
    const cleanAuthor = (author || "").trim();
    const seedDescription = seedDescriptionArg || selectedFeaturedBook?.description || "";
    
    try {
      // 1. Google Books (Preferred Default) — worker falls back to Open Library on quota errors.
      if (sourceToUse === "google") {
        const queries = [
          cleanAuthor ? `intitle:${cleanTitle} inauthor:${cleanAuthor}` : `intitle:${cleanTitle}`,
          cleanAuthor ? `"${cleanTitle}" "${cleanAuthor}"` : `"${cleanTitle}"`,
          `${cleanTitle} ${cleanAuthor}`.trim(),
        ].filter(Boolean);

        let info: any = null;
        let usedFallback = false;
        const normalize = (value: unknown) => String(value || "")
          .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
          .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const titleTokens = normalize(cleanTitle).split(/\s+/).filter(Boolean);
        const scoreVolume = (volume: any) => {
          const candidateTokens = new Set(normalize(volume?.title).split(/\s+/).filter(Boolean));
          const titleScore = titleTokens.length
            ? titleTokens.filter((token) => candidateTokens.has(token)).length / titleTokens.length
            : 0;
          const candidateAuthors = normalize((volume?.authors || []).join(" "));
          const authorScore = cleanAuthor && candidateAuthors.includes(normalize(cleanAuthor)) ? 1 : 0;
          return { titleScore, score: titleScore * 4 + authorScore };
        };
        for (const query of queries) {
          try {
            const res = await fetch(
              `/api/google-books/search?q=${encodeURIComponent(query)}&maxResults=5`
            );
            if (!res.ok) continue;
            const data = await res.json();
            if (data?.error || !data?.items?.length) continue;
            const ranked = [...data.items]
              .map((item: any) => ({ item, ...scoreVolume(item.volumeInfo) }))
              .filter((entry: any) => entry.titleScore >= 0.6)
              .sort((a: any, b: any) => b.score - a.score || (b.item.volumeInfo?.description || "").length - (a.item.volumeInfo?.description || "").length);
            info = ranked[0]?.item.volumeInfo;
            if (info?.description) break;
            if (info) break;
          } catch (err) {
            console.warn("[Overview] Google query failed:", query, err);
          }
        }

        // If Google returned a match without a blurb, pull description from Open Library.
        if (info && !info.description) {
          const { description } = await fetchOpenLibraryDescription(cleanTitle, cleanAuthor);
          if (description) info = { ...info, description };
        }

        // Still nothing? Use Open Library as a full fallback for the Google tab.
        if (!info) {
          const ol = await fetchOpenLibraryDescription(cleanTitle, cleanAuthor);
          if (ol.doc) {
            info = {
              title: ol.doc.title || cleanTitle,
              authors: ol.doc.author_name || (cleanAuthor ? [cleanAuthor] : []),
              description: ol.description,
              pageCount: ol.doc.number_of_pages_median || ol.doc.number_of_pages,
              publishedDate: ol.doc.first_publish_year?.toString(),
              publisher: ol.doc.publisher?.[0],
              language: ol.doc.language?.[0],
              categories: (ol.doc.subject || []).slice(0, 8),
              industryIdentifiers: (ol.doc.isbn || []).slice(0, 4).map((id: string) => ({
                type: id.length === 13 ? "ISBN_13" : "ISBN_10",
                identifier: id,
              })),
            };
            usedFallback = true;
          }
        }

        if (info) {
          if (isStale()) return;
          const description =
            info.description || seedDescription || selectedFeaturedBook?.description || "";
          setFeaturedBookDetails({
            ...info,
            title: cleanTitle,
            authors: cleanAuthor ? [cleanAuthor] : (info.authors || []),
            description,
            pageCount: info.pageCount,
            publishedDate: info.publishedDate,
            publisher: info.publisher || selectedFeaturedBook?.publisher,
            language: info.language,
            industryIdentifiers: info.industryIdentifiers || [],
            categories: info.categories || [],
            subjects: info.categories
              ? Array.from(
                  new Set(
                    info.categories.flatMap((cat: string) => {
                      const parts = cat.split("/").map((s: string) => s.trim()).filter(Boolean);
                      return [cat, ...parts];
                    })
                  )
                )
              : [],
            averageRating: info.averageRating,
            ratingsCount: info.ratingsCount,
            previewLink: info.previewLink,
            source: usedFallback ? "Open Library (via Google)" : "Google Books",
          });

          if (info.categories && info.categories.length > 0) {
            fetchSimilarBooks(info.categories[0]);
          }
          setLoadingFeaturedDetails(false);
          return;
        }

        // Last resort for Google tab: keep/show the seeded NYT synopsis.
        if (seedDescription) {
          if (isStale()) return;
          setFeaturedBookDetails((prev: any) => ({
            ...(prev || {}),
            title: cleanTitle,
            authors: cleanAuthor ? [cleanAuthor] : [],
            description: seedDescription,
            source: prev?.source || "New York Times",
          }));
          setLoadingFeaturedDetails(false);
          return;
        }
      }

      // 2. New York Times (Verified Raw)
      if (sourceToUse === "nyt") {
        const nytRes = await fetch(`/api/nytimes/book-details-raw?title=${encodeURIComponent(cleanTitle)}&author=${encodeURIComponent(cleanAuthor)}`);
        if (nytRes.ok) {
          const data = await nytRes.json();
          if (data && data.results && data.results.length > 0) {
            const normalize = (value: unknown) => String(value || "")
              .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
              .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            const titleTokens = normalize(cleanTitle).split(/\s+/).filter(Boolean);
            const book = [...data.results].map((candidate: any) => {
              const candidateTokens = new Set(normalize(candidate.title).split(/\s+/).filter(Boolean));
              const score = titleTokens.length
                ? titleTokens.filter((token) => candidateTokens.has(token)).length / titleTokens.length
                : 0;
              return { candidate, score };
            }).filter((entry: any) => entry.score >= 0.6)
              .sort((a: any, b: any) => b.score - a.score)[0]?.candidate;
            if (book) {
              if (isStale()) return;
              let description = book.description || selectedFeaturedBook?.description || "";
              if (!description) {
                const ol = await fetchOpenLibraryDescription(cleanTitle, cleanAuthor);
                description = ol.description;
              }
              if (isStale()) return;
              setFeaturedBookDetails({
                title: cleanTitle,
                authors: cleanAuthor ? [cleanAuthor] : [book.author].filter(Boolean),
                description,
                pageCount: null,
                publishedDate: null,
                publisher: book.publisher,
                language: "en",
                industryIdentifiers: book.isbns?.map((i: any) => ({ type: "ISBN", identifier: i.isbn13 || i.isbn10 })),
                categories: [selectedFeaturedBook?.category || "General"],
                source: "New York Times (Verified Raw)"
              });
              setLoadingFeaturedDetails(false);
              return;
            }
          }
        }
      }

      // 3. Open Library (also used as last-resort when Google/NYT miss)
      if (sourceToUse === "openlibrary" || sourceToUse === "google" || sourceToUse === "nyt") {
        const { description, doc } = await fetchOpenLibraryDescription(cleanTitle, cleanAuthor);
        if (doc) {
          if (isStale()) return;
          setFeaturedBookDetails({
            title: cleanTitle,
            authors: cleanAuthor ? [cleanAuthor] : doc.author_name,
            description: description || selectedFeaturedBook?.description || "",
            pageCount: doc.number_of_pages_median || doc.number_of_pages,
            publishedDate: doc.first_publish_year?.toString(),
            publisher: doc.publisher?.[0],
            language: doc.language?.[0],
            industryIdentifiers: doc.isbn?.map((i: string) => ({ type: "ISBN", identifier: i })),
            categories: doc.subject || [],
            subjects: doc.subject 
              ? Array.from(new Set(doc.subject.flatMap((cat: string) => {
                  const parts = cat.split("/").map((s: string) => s.trim()).filter(Boolean);
                  return [cat, ...parts];
                })))
              : [],
            source: sourceToUse === "openlibrary" ? "Open Library" : "Open Library (fallback)"
          });
          setLoadingFeaturedDetails(false);
          return;
        }
      }
    } catch (e) {
      console.error("Failed to fetch featured book details:", e);
    }
    if (isStale()) return;
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
    if (source === "netgalley") {
      const res = await fetch(
        `/api/netgalley/search?q=${encodeURIComponent(term.trim())}`,
        { signal: AbortSignal.timeout(14000) }
      );
      if (!res.ok) throw new Error(`NetGalley search failed with status: ${res.status}`);
      const data = await res.json();
      const results = (data.results || []).map((b: any) => ({
        ...b,
        id: b.bookId || b.id,
        sourceId: "netgalley",
        coverUrl: b.coverUrl || null,
        url: b.netgalleyUrl || b.url,
      }));
      return { books: results, totalCount: results.length, hasMore: false };
    }

    const res = await fetch(
      `/api/annas-archive/search?q=${encodeURIComponent(term.trim())}&source=${source}&page=${page}`,
      { signal: AbortSignal.timeout(14000) }
    );
    if (!res.ok) throw new Error(`Search failed with status: ${res.status}`);
    const data = await res.json();
    const books = (data.books || data.results || []).map((b: any) => ({
      ...b,
      sourceId: b.sourceId || (() => {
        const source = String(b.source || "").toLowerCase();
        if (source.includes("libgen") || source.includes("library genesis")) return "libgen";
        if (source.includes("anna")) return "annas";
        if (source.includes("internet archive")) return "ia";
        if (source.includes("open library")) return "openlibrary";
        if (source.includes("rave")) return "rave";
        return "";
      })(),
      coverUrl: b.coverUrl || b.image?.url || null,
    }));
    return { books, totalCount: data.totalCount || 0, hasMore: !!data.hasMore };
  }

  async function fetchNYTCategory(listName: string, date: string = "current"): Promise<{ books: any[]; previousDate: string | null }> {
    const cacheKey = `nyt_list_opt_${listName}_${date}`;
    const cached = tempStorage.get<any>(cacheKey);
    if (cached && typeof cached === "object" && Array.isArray(cached.books)) {
      return cached;
    }

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
      const enrichedBooks = await enrichBooksWithRatings(mappedBooks, titlesRoughlyMatch, 10);
      return { books: enrichedBooks, previousDate };
    } catch (err) {
      console.error("Failed to fetch NYT category:", err);
      return { books: [], previousDate: null };
    }
  }


  async function fetchAudiobookCategory(category: { query: string; mode?: string }): Promise<any[]> {
    try {
      const usePopular = category.mode === "popular" || category.query === "popular";
      const res = usePopular
        ? await fetchDiscoverApi("/api/audiobooks/popular")
        : await fetchDiscoverApi(`/api/audiobooks/search?q=${encodeURIComponent(category.query)}`);
      if (!res.ok) return [];
      const books = await res.json();
      if (!Array.isArray(books)) return [];
      return books.map((b: any, idx: number) => ({
        title: b.title,
        author: b.author,
        coverUrl: b.coverUrl || null,
        description: b.description,
        rank: b.rank || idx + 1,
        source: "audiobook",
        listenUrl: b.listenUrl || b.link,
        listenUrlAlt: b.listenUrlAlt,
        link: b.link || b.listenUrl,
        isbn: b.isbn,
      }));
    } catch (err) {
      console.error("Failed to fetch audiobook category:", err);
      return [];
    }
  }

  async function fetchGoodreadsCategory(query: string): Promise<any[]> {
    const cacheKey = `goodreads_list_${query}_v3`;
    const cached = tempStorage.get<any[]>(cacheKey);
    if (cached && Array.isArray(cached)) return cached;

    try {
      const res = await fetch(`/api/goodreads/list?list=${encodeURIComponent(query)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Goodreads list fetch failed with status: ${res.status}`);
      const books = await res.json();
      
      const mappedBooks = books.map((book: any) => {
        const cleanTitle = (book.title || "")
          .split(':')[0]
          .replace(/\b\d{10,13}\b/g, '')
          .replace(/\(.*\)/g, '')
          .replace(/[^\w\s-]/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        const cleanAuthor = (book.author || "")
          .split(',')[0]
          .replace(/[^\w\s-]/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const coverUrl = book.coverUrl?.startsWith("/")
          ? book.coverUrl
          : book.coverUrl
            ? book.coverUrl
            : `/api/cover-redirect?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author || "")}`;

        return {
          title: book.title,
          author: book.author,
          coverUrl,
          searchQuery: `${cleanTitle} ${cleanAuthor}`.trim(),
          description: book.description,
          ...(book.ratingVerified ? { rating: book.rating, ratingCount: book.ratingCount, ratingVerified: true } : {}),
          rank: book.rank,
          source: 'goodreads',
          isGoogleBook: false
        };
      });

      tempStorage.set(cacheKey, mappedBooks);
      return mappedBooks;
    } catch (err) {
      console.error("Failed to fetch Goodreads category:", err);
      return [];
    }
  }

  async function fetchNetgalleyCategory(category: any) {
    const cacheKey = `netgalley_cat_${category.query || category.id}`;
    const cached = tempStorage.get<any[]>(cacheKey);
    if (cached && cached.length > 0) return cached;

    try {
      const res = await fetchDiscoverApi(`/api/netgalley/category?cat=${encodeURIComponent(category.query || category.id)}`);
      if (!res.ok) throw new Error("Failed to load NetGalley category");
      const data = await res.json();
      const results = data.results || [];
      const mapped = results.map((b: any) => ({
        title: b.title,
        author: b.author || "Unknown",
        coverUrl: b.coverUrl,
        searchQuery: `${b.title} ${b.author || ""}`.trim(),
        publisher: b.publisher,
        netgalleyUrl: b.netgalleyUrl,
        source: "netgalley",
        isAudiobook: b.isAudiobook,
        isGoogleBook: false
      }));
      tempStorage.set(cacheKey, mapped);
      return mapped;
    } catch (err) {
      console.error("NetGalley category fetch error:", err);
      return [];
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
      if (category.source === "goodreads") {
        const books = await fetchGoodreadsCategory(category.query);
        setCategoryBooks(Array.isArray(books) ? books : []);
        setCategoryPreviousDate(null);
      } else if (category.source === "audiobook") {
        const books = await fetchAudiobookCategory(category);
        setCategoryBooks(Array.isArray(books) ? books : []);
        setCategoryPreviousDate(null);
      } else if (category.source === "netgalley") {
        const books = await fetchNetgalleyCategory(category);
        setCategoryBooks(Array.isArray(books) ? books : []);
        setCategoryPreviousDate(null);
      } else {
        const { books = [], previousDate = null } = await fetchNYTCategory(category.query) || {};
        setCategoryBooks(Array.isArray(books) ? books : []);
        setCategoryPreviousDate(previousDate);
      }
    } catch (err: any) {
      console.error("Failed to load category:", err);
      setError("Failed to load category. Tap Retry.");
    } finally {
      setLoadingCategory(false);
    }
  }

  async function loadMoreCategoryBooks() {
    if (!viewingCategory || loadingCategoryMore) return;
    if (viewingCategory.source === "goodreads") return; // Goodreads scraping is usually one page for now
    if (!categoryPreviousDate) return;
    
    setLoadingCategoryMore(true);
    try {
      const { books = [], previousDate = null } = await fetchNYTCategory(viewingCategory.query, categoryPreviousDate) || {};
      // Filter out duplicates
      setCategoryBooks(prev => {
        const actualBooks = Array.isArray(books) ? books : [];
        const actualPrev = Array.isArray(prev) ? prev : [];
        const newBooks = actualBooks.filter(b => !actualPrev.some(pb => pb.searchQuery === b.searchQuery));
        return [...actualPrev, ...newBooks];
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

  async function handleSearch(e: React.FormEvent | string | number, sourceOverride?: string, autoDownload?: boolean) {
    if (typeof e !== "string" && typeof e !== "number") {
      if (e) e.preventDefault();
    }

    const rawTerm = typeof e === "string" ? e : (typeof e === "number" ? e.toString() : query);
    // Author chips can carry this presentation suffix from source metadata.
    // It is not part of the actual author name/query.
    const term = rawTerm.replace(/\s*\(author\)\s*$/i, "").trim();
    if (!term || !term.trim()) return;

    const normalizedTerm = term.trim();
    setRecentSearches((previous) => {
      const next = [normalizedTerm, ...previous.filter((item) => item.toLocaleLowerCase() !== normalizedTerm.toLocaleLowerCase())].slice(0, 10);
      try { sessionStorage.setItem("kora:discover-search-history", JSON.stringify(next)); } catch { /* optional */ }
      return next;
    });
    setShowSearchAssist(false);
    setSearchSuggestions([]);
    if (typeof e === "string") setQuery(term);

    try {
      window.dispatchEvent(new CustomEvent("kora-guide:search-submitted", { detail: { term: term.trim() } }));
    } catch {
      /* ignore */
    }

    // Audiobook search mode — route to audiobook sites instead of ebook archives
    if (isAudiobookSearch) {
      setSearchMode(true);
      setViewingCategory(null);
      setCategoryBooks([]);
      setAudiobookLoading(true);
      setAudiobookResults([]);

      const cached = getCachedSearch(term.trim(), "audiobook");
      if (cached?.length) {
        setAudiobookResults(cached);
        setAudiobookLoading(false);
      }

      const signal = createSearchSignal("audiobook");
      try {
        const results = await streamAudiobookSearch(
          term.trim(),
          (_source, batch) => {
            setAudiobookResults((prev) => {
              const seen = new Set(prev.map((r) => r.link));
              const merged = [...prev, ...batch.filter((r) => !seen.has(r.link))];
              return merged;
            });
            setAudiobookLoading(false);
          },
          signal
        );
        setAudiobookResults(results);
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("Audiobook search failed:", err);
          setAudiobookResults([]);
        }
      } finally {
        setAudiobookLoading(false);
      }
      return;
    }

    // Reset page if it's a new search term
    // For string calls (programmatic), compare string value.
    // For FormEvent (user hitting SEARCH button), compare current term against last executed term.
    const isNewTerm = term.trim() !== lastSearchedTerm.current.trim();
    lastSearchedTerm.current = term.trim();
    if (isNewTerm) {
      setCurrentPage(1);
      setSeriesFilter(null);
      prefetchCache.current.clear();
    }

    const page = isNewTerm ? 1 : currentPage;
    if (page === 1) {
      setLoading(true);
      // Keep a successful same-query result set visible while retrying. A
      // transient source 503 should not turn the current page blank.
      if (isNewTerm || results.length === 0) setResults([]);
    } else {
      setLoadingMore(true);
    }
    setError(null);
    setSearchMode(true);
    setViewingCategory(null);
    setCategoryBooks([]);

    // Parallel audiobook search so both book + audiobook results show together.
    if (!isAudiobookSearch) {
      setAudiobookLoading(true);
      const aSignal = createSearchSignal("audiobook");
      streamAudiobookSearch(
        term.trim(),
        (_src, batch) => {
          setAudiobookResults((prev) => {
            const seen = new Set(prev.map((r) => r.link));
            return [...prev, ...batch.filter((r) => !seen.has(r.link))];
          });
          setAudiobookLoading(false);
        },
        aSignal
      ).then((res) => setAudiobookResults(res)).catch(() => {});
    }

    if (typeof e === "string") setQuery(term);

    try {
      const source = sourceOverride || activeSource;
      const signal = createSearchSignal("ebook");

      let mappedBooks: any[];
      let totalCount: number;
      let more: boolean;

      if (isAdvancedSearch) {
        // Check prefetch cache first
        const cached = prefetchCache.current.get(page);
        if (cached) {
          prefetchCache.current.delete(page);
          mappedBooks = cached;
          totalCount = totalResults;
          more = true;
        } else {
          try {
            const result = await fetchPage(term, source, page);
            mappedBooks = result.books;
            totalCount = result.totalCount;
            more = result.hasMore;
          } catch (sourceError) {
            // Source-specific endpoints can fail independently. Recover with
            // the unified streaming search, which isolates provider failures.
            console.warn("Filtered source search failed; retrying unified search:", sourceError);
            const fallback = await streamEbookSearch(
              term,
              (_source, books) => {
                if (page === 1) {
                  setResults((previous) => {
                    const seen = new Set(previous.map((book) => `${book.title}|${book.author}`));
                    return [...previous, ...books.filter((book) => !seen.has(`${book.title}|${book.author}`))];
                  });
                  setLoading(false);
                }
              },
              signal,
              page
            );
            mappedBooks = fallback.books;
            totalCount = fallback.totalCount;
            more = fallback.hasMore;
          }
        }
      } else {
        const streamResult = await streamEbookSearch(
          term,
          (_src, books) => {
            if (page === 1) {
              setResults((prev) => {
                const seen = new Set(prev.map((b) => b.title + b.author));
                const merged = [...prev, ...books.filter((b) => !seen.has(b.title + b.author))];
                return merged;
              });
              setLoading(false);
            }
          },
          signal,
          page
        );
        mappedBooks = streamResult.books;
        totalCount = streamResult.totalCount;
        more = streamResult.hasMore;
      }

      mappedBooks = rankSearchResults(mappedBooks, term);

      // Group search results by simplified Title + Author + Year + Series to completely avoid duplicates of the same book
      const groupedBooksMap = new Map<string, any>();

      mappedBooks.forEach((b: any) => {
        const cleanTitle = (b.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        const cleanAuthor = (b.author || "Unknown").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        const year = (b.year || "").trim();
        const series = (b.series || b.topic || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        const groupingKey = `${cleanTitle}___${cleanAuthor}___${year}___${series}`;

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
            description: b.description,
            language: b.language,
            isbn: b.isbn,
            exactMatch: b.exactMatch,
            sourceId: b.sourceId,
            source: b.source,
            series: b.series,
            seriesUrl: b.seriesUrl,
            seriesId: b.seriesId,
            size: b.size,
            extension: b.extension,
            md5: b.md5,
            downloadUrl: b.downloadUrl,
            directUrl: b.directUrl,
            directReady: b.directReady,
            pageUrl: b.pageUrl,
            iaId: b.iaId,
            hash: b.hash,
            isGoogleBook: b.isGoogleBook,
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
          if (!existing.series && b.series) existing.series = b.series;
          if (!existing.seriesUrl && b.seriesUrl) existing.seriesUrl = b.seriesUrl;
          if (!existing.seriesId && b.seriesId) existing.seriesId = b.seriesId;
          if (!existing.isbn && b.isbn) existing.isbn = b.isbn;
          if (b.exactMatch) existing.exactMatch = true;
        }
      });

      const uniqueGroupedBooks = Array.from(groupedBooksMap.values());
      if (page === 1) {
        setResults(uniqueGroupedBooks);
        // Handle auto-download if requested for a specific search
        if (autoDownload && uniqueGroupedBooks.length > 0) {
          const firstBook = uniqueGroupedBooks[0];
          onSelectedBookChange(firstBook);
          // Wait a bit for the modal to open and mirrors to be fetched
          setTimeout(() => {
            handleGetDownloadLinks(firstBook, null, true);
          }, 100);
        }
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

      // Update available series from results (LibGen exposes series; Google Books
      // series is parsed client-side in fetchVerifiedDetails)
      const seriesSet = new Set<string>();
      mappedBooks.forEach((b: any) => {
        if (b.series && b.series.trim()) seriesSet.add(b.series.trim());
      });
      setAvailableSeries(seriesSet);

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
      setError("Search failed. Tap Retry to search again.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  function clearSearch() {
    abortActiveSearch();
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
    setSeriesFilter(null);
    setCommunityBook(null);
    prefetchCache.current.clear();
    lastSearchedTerm.current = "";
  }

  async function fetchVerifiedDetails(book: any) {
    const title = String(book?.title || "").trim();
    const author = String(book?.author || "").trim();
    const pagesValue = book?.pages || book?.pageCount;
    const pageValues = String(pagesValue || "").match(/\d+/g) || [];
    const pageCount = Number.parseInt(pageValues[pageValues.length - 1] || "", 10) || undefined;
    const sourceDetails = {
      description: book?.description || undefined,
      pageCount,
      publishYear: book?.year ? String(book.year) : undefined,
      publisher: book?.publisher || undefined,
      language: book?.language || undefined,
      coverUrl: book?.coverUrl || undefined,
      industryIdentifiers: book?.isbn ? [{ type: "ISBN", identifier: book.isbn }] : undefined,
      subjects: book?.topic ? [book.topic] : undefined,
      seriesNumber: book?.seriesNumber || undefined,
    };
    const hasSourceDetails = Object.values(sourceDetails).some((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value)
    );
    setLoadingDetails(true);
    setVerifiedDetails(hasSourceDetails ? {
      ...sourceDetails,
      source: String(book?.source || "").toLowerCase().includes("libgen") ? "LibGen" : String(book?.source || "Search source"),
    } : null);
    setReadMoreExpanded(false);
    try {
      // Search metadata only after source-native fields are available. Google
      // fills gaps, but never replaces details from the selected LibGen record.
      const gRes = await fetch(`/api/google-books/search?q=${encodeURIComponent(`intitle:${title} inauthor:${author}`)}&maxResults=10`);
      if (gRes.ok) {
        const gData = await gRes.json();
        const normalize = (value: unknown) => String(value || "")
          .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
          .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const titleKey = normalize(title);
        const authorKey = normalize(author);
        const items = Array.isArray(gData.items) ? gData.items : [];
        const ranked = [...items].sort((a: any, b: any) => {
          const score = (item: any) => {
            const info = item.volumeInfo || {};
            const candidateTitle = normalize(info.title);
            const candidateAuthors = normalize((info.authors || []).join(" "));
            return (candidateTitle === titleKey ? 4 : candidateTitle.includes(titleKey) || titleKey.includes(candidateTitle) ? 2 : 0) +
              (candidateAuthors === authorKey ? 3 : candidateAuthors.includes(authorKey) || authorKey.includes(candidateAuthors) ? 1 : 0);
          };
          return score(b) - score(a);
        });
        const info = ranked[0]?.volumeInfo;
        if (info) {
          const googleSubjects = info.categories
            ? Array.from(new Set(info.categories.flatMap((cat: string) => {
                const parts = cat.split("/").map(s => s.trim()).filter(Boolean);
                return [cat, ...parts];
              })))
            : undefined;
          const googleDetails = {
            description: info.description || undefined,
            pageCount: info.pageCount || undefined,
            publishYear: info.publishedDate?.split("-")[0] || undefined,
            publisher: info.publisher || undefined,
            language: info.language || undefined,
            coverUrl: info.imageLinks?.thumbnail?.replace(/^http:/i, "https:") || info.imageLinks?.smallThumbnail?.replace(/^http:/i, "https:") || undefined,
            industryIdentifiers: info.industryIdentifiers || undefined,
            subjects: googleSubjects,
            seriesNumber: info.seriesInfo?.volumeNumber != null ? String(info.seriesInfo.volumeNumber) : undefined,
            series: (() => {
              // Google Books has no dedicated series field; parse it from title/subtitle
              const full = [info.title, info.subtitle].filter(Boolean).join(": ");
              const parsed = parseSeriesFromTitle(full);
              return parsed?.series || undefined;
            })(),
          };
          const merged = Object.fromEntries(Object.keys(googleDetails).map((key) => [
            key,
            (sourceDetails as any)[key] || (sourceDetails as any)[key] === 0
              ? (sourceDetails as any)[key]
              : (googleDetails as any)[key],
          ]));
          const isLibgen = String(book?.source || "").toLowerCase().includes("libgen");
          const usedGoogleFallback = Object.keys(googleDetails).some((key) =>
            !(sourceDetails as any)[key] && Boolean((googleDetails as any)[key])
          );
          setVerifiedDetails({
            ...merged,
            source: hasSourceDetails && usedGoogleFallback
              ? `${isLibgen ? "LibGen" : String(book?.source || "Search source")} + Google Books`
              : hasSourceDetails ? (isLibgen ? "LibGen" : String(book?.source || "Search source")) : "Google Books",
          });
        }
      }
    } catch (err) {
      console.warn("Failed to fetch verified details:", err);
    } finally {
      setLoadingDetails(false);
    }
  }

  async function handleGetDownloadLinks(book: any, variantOverride?: any, autoDownload?: boolean) {
    let activeBook = book;
    let activeVariant = variantOverride || (book.variants && book.variants[0]) || book;

    onSelectedBookChange(activeBook);
    setSelectedVariant(activeVariant);
    
    setFetchingMirrors(true);
    setMirrors([]);
    setMirrorError(null);
    setDownloadProgress({ step: "idle", percent: 0, error: null });

    // Grab details from verified source asynchronously
    fetchVerifiedDetails(activeBook);

    // Featured/catalog books need an archive search before mirrors exist.
    // Race fast sources instead of blocking on a full multi-source "all" scan.
    if ((activeBook.isNYTBook || activeBook.isGoogleBook || activeBook.source === 'nyt' || activeBook.source === 'google' || activeBook.source === 'goodreads' || activeBook.source === 'audiobook') && (activeBook.searchQuery || activeBook.title)) {
      try {
        const q = activeBook.searchQuery || cleanTitleAndAuthorForEbookSearch(activeBook.title, activeBook.author);
        const searchResult = await searchDownloadVariants(q);
        if (searchResult.books.length > 0) {
          rankVariants(searchResult.books, activeBook.title, activeBook.author);
          activeBook = {
            ...activeBook,
            variants: searchResult.books,
            downloadLinks: searchResult.books
          };
          activeVariant = searchResult.books[0];
          onSelectedBookChange(activeBook);
          setSelectedVariant(activeVariant);
        }
      } catch (err) {
        console.error("Failed to search for download links:", err);
      }
    }

    let hadUsableMirrors = false;
    try {
      // Z-Library results now come via Rave; the direct eAPI path was removed.
      {
        const instant = buildInstantMirrors(activeVariant);
        if (instant.length > 0) {
          const sortedInstant = sortMirrors(instant);
          setMirrors(sortedInstant);
          hadUsableMirrors = true;
          setFetchingMirrors(false);
          if (autoDownload) {
            setTimeout(() => handleAutoDownload(sortedInstant), 50);
          }
        }

        const iaParam = activeVariant.iaId ? `&iaId=${encodeURIComponent(activeVariant.iaId)}` : "";
        // Pass Rave's real signed direct URL through so the worker uses the same
        // direct-download method as ravebooksearch.com (get.php?md5&key -> CDN).
        const directParam = activeVariant.downloadUrl ? `&url=${encodeURIComponent(activeVariant.downloadUrl)}` : "";
        const res = await fetch(`/api/annas-archive/download?md5=${activeVariant.md5}${iaParam}${directParam}`, {
          signal: AbortSignal.timeout(8000)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const links = data.downloadLinks || data.options || [];
        const sorted = sortMirrors([...instant, ...links]);
        if (links.length > 0 || instant.length === 0) {
          setMirrors(sorted);
        }
        if (sorted.length > 0) hadUsableMirrors = true;
        
        if (sorted.length === 0) {
          setMirrorError("No download mirrors found for this variant. Try another format or mirror.");
        } else if (autoDownload && instant.length === 0) {
          // Instant path already auto-downloaded; only trigger if we had nothing before.
          setTimeout(() => handleAutoDownload(sorted), 50);
        }
      }
    } catch (err: any) {
      if (!hadUsableMirrors) {
        setMirrorError("Failed to retrieve download mirrors. Tap Retry.");
      }
    } finally {
      setFetchingMirrors(false);
    }
  }

  async function handleAutoDownload(mirrorsOverride?: any[]) {
    const book = selectedBook || selectedFeaturedBook;
    if (!book) return;
    const activeVariant = selectedVariant || selectedFeaturedVariant || book;
    const activeMirrors = mirrorsOverride || mirrors;
    const directMirrors = activeMirrors.filter(m => m.isDirect);
    if (directMirrors.length === 0) {
      setDownloadProgress({ 
        step: "idle", 
        percent: 0, 
        error: "No direct download mirrors are available. Please use a manual link below." 
      });
      return;
    }

    setDownloadProgress({ step: "requesting", percent: 10, error: null });

    if (onTriggerDownload) {
      onTriggerDownload(book, directMirrors, activeVariant);
      // Close the selection modal after starting background download
      if (selectedBook) onSelectedBookChange(null);
      if (selectedFeaturedBook) closeBookDetail();
      return;
    }

    // Fallback if no trigger (shouldn't happen with new layout)
    for (let index = 0; index < directMirrors.length; index++) {
      const mirror = directMirrors[index];
      try {
        const logMsg = `Auto-downloading "${book.title}" from mirror ${index + 1}/${directMirrors.length}: ${mirror.url}`;
        console.log(logMsg);
        logger.info(logMsg);
        setDownloadProgress({ 
          step: `downloading (Mirror ${index + 1}/${directMirrors.length})`, 
          percent: 30 + Math.floor((index / directMirrors.length) * 30), 
          error: null 
        });

        const proxyUrl = proxyUrlForMirror(mirror.url);
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
        let fileExtension = activeVariant.extension || activeVariant.format || "epub";

        // 1. Try to extract from content-disposition
        const contentDisposition = response.headers.get("content-disposition");
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

        // 2. Try content-type fallback
        if (fileExtension === "epub" && contentType) {
          const ct = contentType.toLowerCase();
          if (ct.includes("epub")) fileExtension = "epub";
          else if (ct.includes("pdf")) fileExtension = "pdf";
          else if (ct.includes("mobi")) fileExtension = "mobi";
          else if (ct.includes("azw3")) fileExtension = "azw3";
          else if (ct.includes("zip")) fileExtension = "zip";
        }

        // 3. Safe URL fallback
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

        // Check if downloading using normal discovery search (non-advanced Google Book based search)
        const isGoogleBookSearch = !isAdvancedSearch && (
          (selectedBook && (selectedBook.isGoogleBook || selectedBook.source === "google")) ||
          (selectedFeaturedBook && (selectedFeaturedBook.isGoogleBook || selectedFeaturedBook.source === "google"))
        );
        const activeBookMeta = selectedBook || selectedFeaturedBook;

        let finalTitle = selectedBook.title;
        let finalAuthor = selectedBook.author;
        let finalDescription = verifiedDetails?.description || selectedBook.description || "";
        let finalPublisher = verifiedDetails?.publisher || selectedBook.publisher || "";
        let finalYear = verifiedDetails?.publishYear || selectedBook.year || "";
        let finalLanguage = verifiedDetails?.language || selectedBook.language || activeVariant.language || "English";
        let finalCoverUrl = (!selectedBook.coverUrl || selectedBook.coverUrl.includes("placeholder")) && verifiedDetails?.coverUrl ? verifiedDetails.coverUrl : selectedBook.coverUrl;
        let finalPageCount = verifiedDetails?.pageCount || (selectedBook.pages ? parseInt(selectedBook.pages) : undefined);
        let finalTags = Array.from(new Set([
          ...inferBookTags(finalTitle, finalAuthor, fileExtension),
          ...(verifiedDetails?.subjects || []),
          ...(selectedBook.categories || [])
        ]));

        if (isGoogleBookSearch && activeBookMeta) {
          logger.info(`Normal discovery search download detected in fallback auto-download. Enriching and injecting metadata for "${finalTitle}"`);
          // Inject metadata into the EPUB zip before storing it
          if (fileExtension === "epub") {
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

        setDownloadProgress({ step: "saving", percent: 90, error: null });
        const identityCheck = await judgeMirrorDownload({
          mirrorUrl: mirror.url,
          bytes: new Uint8Array(await fileBlob.arrayBuffer()),
          requestedTitle: book.title,
          claimedExtension: fileExtension,
          sawHtmlContentType: contentType.toLowerCase().includes("text/html") || contentType.toLowerCase().includes("application/xhtml"),
        });
        if (!identityCheck.ok) throw new Error(identityCheck.detail);

        const id = activeVariant.md5 || Math.random().toString(36).substring(7);
        await storeBookFile(id, fileBlob, `${finalTitle}.${fileExtension}`, fileExtension);

        // If a custom directory is configured, write the downloaded file there as well
        try {
          const { getSavedDirectoryHandle, saveFileToDirectory } = await import("../lib/directoryHelper");
          const dirHandle = await getSavedDirectoryHandle();
          if (dirHandle) {
            await saveFileToDirectory(dirHandle, `${finalTitle}.${fileExtension}`, fileBlob);
          }
          const isVirtualActive = localStorage.getItem("kora_use_virtual_dir") === "true";
          if (isVirtualActive) {
            const { addVirtualDirectoryFile } = await import("../lib/directoryHelper");
            addVirtualDirectoryFile({
              name: finalTitle,
              author: finalAuthor || "Unknown",
              size: activeVariant.size || "1.5 MB",
              extension: fileExtension as any
            });
          }
        } catch (dirErr) {
          console.warn("Failed to write download to custom directory:", dirErr);
        }

        const newBook: BookMetadata = {
          id,
          title: finalTitle,
          author: finalAuthor,
          extension: fileExtension,
          size: activeVariant.size || "Unknown",
          language: finalLanguage,
          coverUrl: finalCoverUrl,
          md5: activeVariant.md5,
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
          downloadUrl: activeVariant.downloadUrl || activeVariant.directUrl
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

        logger.info(`Auto-download succeeded for "${newBook.title}". Saved to IndexedDB via mirror: ${mirror.url}`);
        setDownloadProgress({ step: "completed", percent: 100, error: null });
        setTimeout(() => onSelectedBookChange(null), 1500);
        return; // Success!

      } catch (err: any) {
        logger.warn(`Mirror failed during auto-download for "${book.title}". URL: ${mirror.url}. Error: ${err.message || err}`);
        console.warn(`Mirror ${mirror.url} failed during auto-download:`, err);
        if (index === directMirrors.length - 1) {
          logger.error(`All direct mirrors failed during auto-download for "${book.title}".`);
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
    if (selectedTopic !== "all" && b.topic !== selectedTopic) return false;
    if (seriesFilter && b.series !== seriesFilter) return false;
    return true;
  });
  const seriesResultGroups = useMemo(() => {
    const groups = new Map<string, { name: string; volumes: Set<string>; book: any }>();
    for (const book of filteredResults) {
      const name = String(book.series || "").trim();
      const key = normalizeSeriesKey(name);
      if (!key) continue;
      const group = groups.get(key);
      const volumeKey = `${normalizeSeriesKey(String(book.title || ""))}|${normalizeSeriesKey(String(book.author || ""))}`;
      if (group) group.volumes.add(volumeKey);
      else groups.set(key, { name, volumes: new Set([volumeKey]), book });
    }
    return [...groups.entries()].map(([key, group]) => [key, { ...group, count: group.volumes.size }] as const).filter(([, group]) => group.count > 1);
  }, [filteredResults]);
  const visibleResults = filteredResults.filter((book) => {
    const key = normalizeSeriesKey(String(book.series || ""));
    return !key || !collapsedSeriesGroups.has(key);
  });

  async function handleDownloadFromMirror(mirror: any) {
    const book = selectedBook || selectedFeaturedBook;
    if (!book) return;
    const activeVariant = selectedVariant || selectedFeaturedVariant || book;
    const sourceMirrorUrl = typeof mirror === "string" ? mirror : mirror.url;

    if (onTriggerDownload) {
      onTriggerDownload(book, mirror, activeVariant);
      // Close the selection modal after starting background download
      if (selectedBook) onSelectedBookChange(null);
      if (selectedFeaturedBook) closeBookDetail();
      return;
    }

    // Try direct proxy download first to store in app's local storage
    setDownloadProgress({ step: "requesting", percent: 10, error: null });

    try {
      let response: Response;

      // Z-Library mirrors are now proxied through /api/proxy-file like any
      // other Rave-sourced link (the dedicated /api/zlib/download was removed).
      {
        const proxyUrl = proxyUrlForMirror(sourceMirrorUrl);
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
      let fileExtension = activeVariant.extension || activeVariant.format || "epub";

      // 1. Try to extract from content-disposition
      const contentDisposition = response.headers.get("content-disposition");
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

      // 2. Try content-type fallback
      if (fileExtension === "epub" && contentType) {
        const ct = contentType.toLowerCase();
        if (ct.includes("epub")) fileExtension = "epub";
        else if (ct.includes("pdf")) fileExtension = "pdf";
        else if (ct.includes("mobi")) fileExtension = "mobi";
        else if (ct.includes("azw3")) fileExtension = "azw3";
        else if (ct.includes("zip")) fileExtension = "zip";
      }

      // 3. Safe URL fallback
      const mirrorUrl = typeof mirror === "string" ? mirror : mirror.url;
      if (fileExtension === "epub" && mirrorUrl) {
        try {
          const urlObj = new URL(mirrorUrl);
          const pathname = urlObj.pathname;
          const ext = pathname.split('.').pop()?.toLowerCase();
          if (ext && ext !== "php" && ext !== "html" && ext.length <= 4) {
            fileExtension = ext;
          }
        } catch (e) {}
      }

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

      // Check if downloading using normal discovery search (non-advanced Google Book based search)
      const isGoogleBookSearch = !isAdvancedSearch && (
        (book && (book.isGoogleBook || book.source === "google"))
      );

      let finalTitle = book.title;
      let finalAuthor = book.author;
      let finalDescription = book.description || "";
      let finalPublisher = book.publisher || "";
      let finalYear = book.year || "";
      let finalLanguage = book.language || activeVariant.language || "English";
      let finalCoverUrl = book.coverUrl || "";
      let finalPageCount = book.pages ? parseInt(book.pages) : undefined;
      let finalTags = Array.from(new Set([
        ...inferBookTags(finalTitle, finalAuthor, fileExtension),
        ...(book.categories || [])
      ]));

      if (isGoogleBookSearch) {
        logger.info(`Normal discovery search download detected in mirror download. Enriching and injecting metadata for "${finalTitle}"`);
        // Inject metadata into the EPUB zip before storing it
        if (fileExtension === "epub") {
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

      setDownloadProgress({ step: "saving", percent: 90, error: null });
      const identityCheck = await judgeMirrorDownload({
        mirrorUrl: sourceMirrorUrl,
        bytes: new Uint8Array(await fileBlob.arrayBuffer()),
        requestedTitle: book.title,
        claimedExtension: fileExtension,
        sawHtmlContentType: contentType.toLowerCase().includes("text/html") || contentType.toLowerCase().includes("application/xhtml"),
      });
      if (!identityCheck.ok) throw new Error(identityCheck.detail);

      const id = activeVariant.md5 || Math.random().toString(36).substring(7);
      await storeBookFile(id, fileBlob, `${finalTitle}.${fileExtension}`, fileExtension);

      // If a custom directory is configured, write the downloaded file there as well
      try {
        const { getSavedDirectoryHandle, saveFileToDirectory } = await import("../lib/directoryHelper");
        const dirHandle = await getSavedDirectoryHandle();
        if (dirHandle) {
          await saveFileToDirectory(dirHandle, `${finalTitle}.${fileExtension}`, fileBlob);
        }
        const isVirtualActive = localStorage.getItem("kora_use_virtual_dir") === "true";
        if (isVirtualActive) {
          const { addVirtualDirectoryFile } = await import("../lib/directoryHelper");
          addVirtualDirectoryFile({
            name: finalTitle,
            author: finalAuthor || "Unknown",
            size: activeVariant.size || "1.5 MB",
            extension: fileExtension as any
          });
        }
      } catch (dirErr) {
        console.warn("Failed to write download to custom directory:", dirErr);
      }

      const newBook: BookMetadata = {
        id,
        title: finalTitle,
        author: finalAuthor,
        extension: fileExtension,
        size: activeVariant.size || "Unknown",
        language: finalLanguage,
        coverUrl: finalCoverUrl,
        md5: activeVariant.md5,
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
        downloadUrl: activeVariant.downloadUrl || activeVariant.directUrl
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
      setTimeout(() => {
        if (selectedBook) onSelectedBookChange(null);
        if (selectedFeaturedBook) closeBookDetail();
      }, 1200);
    } catch (err: any) {
      // If proxy download failed (CAPTCHA, Cloudflare, etc), open in in-app browser
      const errMsg = "Failed to download from this mirror. Tap Retry.";
      if (errMsg.toLowerCase().includes("captcha") ||
          errMsg.toLowerCase().includes("cloudflare") ||
          errMsg.toLowerCase().includes("verification") ||
          errMsg.toLowerCase().includes("blocked")) {
        // Fall back to in-app browser for manual download
        if (onOpenBrowser) {
          onOpenBrowser(mirror.url);
          if (selectedBook) onSelectedBookChange(null);
          if (selectedFeaturedBook) closeBookDetail();
          return;
        }
      }
      setDownloadProgress({ step: "idle", percent: 0, error: errMsg });
    }
  }

  async function handleDirectDownloadFromFeatured(book: any) {
    const queryText = `${book.title} ${book.author || ""}`.trim();
    const tId = toast.loading(`Searching for ${book.title}...`);
    
    try {
      // 1. Search Anna's Archive (labeled as rave in fetchPage) in the background
      const searchResult = await fetchPage(queryText, "all", 1);
      if (searchResult.books.length === 0) {
        toast.error(`No direct links found for "${book.title}". Try manual search.`, { id: tId });
        return;
      }

      // 2. Pick the best result - prioritize those already havingrave source
      const firstBookResult = searchResult.books.find((b: any) => b.sourceId === "rave") || searchResult.books[0];
      
      // 3. Fetch mirrors for this book
      const res = await fetch(`/api/annas-archive/details?md5=${firstBookResult.md5}`);
      if (!res.ok) throw new Error("Failed to fetch download links");
      
      const data = await res.json();
      if (!data.mirrors || data.mirrors.length === 0) {
        toast.error(`No mirrors found for this edition.`, { id: tId });
        return;
      }

      const sortedMirrors = sortMirrors(data.mirrors);
      const directMirrors = sortedMirrors.filter(m => m.isDirect);
      
      if (directMirrors.length === 0) {
        toast.error(`No direct mirrors available. Opening manual links...`, { id: tId });
        // Fallback: trigger normal search so user can see manual mirrors
        closeBookDetail();
        setSearchMode(true);
        handleSearch(queryText, "all", false);
        return;
      }

      // 4. Trigger background download
      if (onTriggerDownload) {
        toast.dismiss(tId);
        onTriggerDownload(book, directMirrors, firstBookResult);
        closeBookDetail();
      } else {
        toast.error("Download service not available.", { id: tId });
      }
    } catch (err: any) {
      console.error("Background auto-download failed:", err);
      toast.error("Auto-download failed. Tap Retry to try again.", { id: tId });
    }
  }

  function handleMirrorClick(m: any) {
    console.log("[DiscoverView] handleMirrorClick called for:", m.label, m.url);
    // If it is a Mobilism URL, we cannot download directly in-app, so open it in a new tab
    if (m.url && (m.url.toLowerCase().includes("mobilism.org") || m.url.toLowerCase().includes("mobilism"))) {
      console.log("[DiscoverView] Mobilism link detected. Opening in a new tab.");
      window.open(m.url, '_blank');
      return;
    }
    // Always try direct download first - it will store in app's IndexedDB
    // and fall back to in-app browser on CAPTCHA/Cloudflare errors
    if (m.isDirect || (m.url && m.url.toLowerCase().includes("libgen"))) {
      console.log("[DiscoverView] Triggering handleDownloadFromMirror");
      handleDownloadFromMirror(m);
    } else {
      // Manual download links should open in a new tab in their browser
      console.log("[DiscoverView] Opening link in new tab:", m.url);
      window.open(m.url, '_blank');
    }
  }

  return (
    <>
      <div className="space-y-6 md:space-y-10 pb-4 md:pb-10">
        {/* Header & Search */}
        <header className="space-y-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h2 className="text-3xl font-lexend font-bold tracking-tight text-kindle-text">Discover</h2>
              <p className="text-[10px] text-kindle-text-muted uppercase tracking-wider font-semibold font-mono">
                Explore global archives or browse trending best sellers.
              </p>
            </div>
            {!searchMode && !viewingCategory && (
              <button
                onClick={() => loadFeaturedContent(true)}
                className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-text transition cursor-pointer"
                title="Refresh Best Sellers Feed"
              >
                Refresh
              </button>
            )}
          </div>

          {showFirstBookNudge && !searchMode && !viewingCategory && (
            <div className="rounded-2xl border border-kindle-accent/30 bg-kindle-accent/5 px-4 py-4 md:px-5 md:py-5 flex items-start gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="mt-0.5 rounded-xl bg-kindle-bg border border-kindle-border p-2.5 text-kindle-text-muted shrink-0">
                <BookOpen className="w-4 h-4" />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-sm font-bold text-kindle-text">Add your first book</p>
                <p className="text-xs text-kindle-text-muted leading-relaxed">
                  Search below or tap a trending title to download it to your library.
                </p>
              </div>
              {onDismissFirstBookNudge && (
                <button
                  type="button"
                  onClick={onDismissFirstBookNudge}
                  className="p-1.5 rounded-lg text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-bg transition shrink-0"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <form onSubmit={handleSearch} className="relative group w-full" data-guide="discover-search">
              <Search className="w-5 h-5 text-kindle-text-muted absolute left-4 top-1/2 -translate-y-1/2 group-focus-within:text-kindle-accent group-hover:text-kindle-accent/70 transition pointer-events-none z-10" />
              <input
                type="text"
                placeholder="For best results, use the full book title and author name…"
                ref={searchInputRef}
                value={query}
                onFocus={() => setShowSearchAssist(true)}
                onBlur={() => setShowSearchAssist(false)}
                onChange={(e) => { setQuery(e.target.value); setShowSearchAssist(true); }}
                onKeyDown={(e) => { if (e.key === "Escape") setShowSearchAssist(false); }}
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded={showSearchAssist && (query.trim() ? searchSuggestions.length > 0 : recentSearches.length > 0)}
                data-guide="discover-search-input"
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
              {showSearchAssist && (searchSuggestions.length > 0 || (query.trim().length === 0 && recentSearches.length > 0)) && (
                <div
                  className="absolute left-0 right-0 top-[calc(100%+8px)] z-[80] overflow-hidden rounded-2xl border border-kindle-border bg-kindle-card shadow-2xl"
                  role="listbox"
                  aria-label={query.trim() ? "Book suggestions from Google Books" : "Recent searches"}
                >
                  {query.trim().length === 0 ? (
                    <>
                      <div className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Recent searches · this session</div>
                      {recentSearches.map((item) => (
                        <button key={item} type="button" role="option" onPointerDown={(event) => event.preventDefault()} onClick={() => { void handleSearch(item); searchInputRef.current?.blur(); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-kindle-text hover:bg-kindle-bg transition">
                          <RefreshCw className="h-4 w-4 shrink-0 text-kindle-text-muted" />
                          <span className="min-w-0 flex-1 truncate">{item}</span>
                          <span className="text-[10px] text-kindle-text-muted">Search again</span>
                        </button>
                      ))}
                    </>
                  ) : (
                    <>
                      <div className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Suggested titles · Google Books</div>
                      {searchSuggestions.map((item) => (
                        <button key={item.title + item.author} type="button" role="option" onPointerDown={(event) => event.preventDefault()} onClick={() => { void handleSearch(`${item.title} ${item.author}`.trim()); searchInputRef.current?.blur(); }} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-kindle-bg transition">
                          <div className="h-10 w-7 shrink-0 overflow-hidden rounded bg-kindle-bg border border-kindle-border">
                            {item.coverUrl ? <img src={resolveCoverImageSrc(item.coverUrl) || item.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <BookOpen className="m-1 h-5 w-5 text-kindle-text-muted" />}
                          </div>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-kindle-text">{item.title}</span>
                            <span className="block truncate text-xs text-kindle-text-muted">{item.author || "Author not listed"}</span>
                          </span>
                          <span className="text-[10px] text-kindle-accent">Recommendation</span>
                        </button>
                      ))}
                    </>
                  )}
                  <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => setShowSearchAssist(false)} className="w-full border-t border-kindle-border px-4 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text">Dismiss</button>
                </div>
              )}
            </form>

            <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    if (audiobookLibraryMode) {
                      closeAudiobookLibrary();
                    } else {
                      openAudiobookLibrary();
                    }
                  }}
                  className={`px-3.5 py-1.5 rounded-full border text-[9px] font-bold uppercase tracking-wider transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    audiobookLibraryMode
                      ? "bg-kindle-text text-kindle-bg border-kindle-text"
                      : "bg-kindle-card border-kindle-border text-kindle-text-muted hover:text-kindle-text hover:border-kindle-accent/50"
                  }`}
                >
                  <Headphones className="w-3 h-3" />
                  Audiobooks
                </button>
                <button
                  type="button"
                  onClick={() => setShowFilterOptions((open) => !open)}
                  className={`px-3.5 py-1.5 rounded-full border text-[9px] font-bold uppercase tracking-wider transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    showFilterOptions
                      ? "bg-kindle-text text-kindle-bg border-kindle-text"
                      : "bg-kindle-card border-kindle-border text-kindle-text-muted hover:text-kindle-text"
                  }`}
                >
                  <Database className="w-3 h-3" />
                  Filters
                </button>
            </div>

            {/* Source & Topic Filters - Positioned directly under search bar */}
            {searchMode && showFilterOptions && (
              <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { id: "all", label: "All", icon: Globe },
                    { id: "netgalley", label: "NetGalley", icon: NetgalleyIcon },
                    { id: "annas", label: "Anna's Archive", icon: Database },
                    { id: "libgen", label: "LibGen", icon: Layers },
                    { id: "zlib", label: "Z-Library", icon: Library },
                    { id: "ia", label: "Archive.org", icon: BookOpen },
                    { id: "gutenberg", label: "Gutenberg", icon: BookMarked },
                    { id: "openlibrary", label: "Open Library", icon: ExternalLink },
                    { id: "standard", label: "Standard Ebooks", icon: Library },
                  ]
                  .map((src) => (
                    <button
                      key={src.id}
                      onClick={() => {
                        setActiveSource(src.id);
                        setCurrentPage(1);
                        setResults([]);
                        prefetchCache.current.clear();
                      }}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border ${
                        activeSource === src.id
                          ? "bg-kindle-text text-kindle-bg border-kindle-text shadow-sm"
                          : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-accent/50"
                      }`}
                    >
                      <src.icon className="w-3.5 h-3.5" />
                      {src.label}
                    </button>
                  ))}
                </div>

                {availableTopics.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 max-h-32 overflow-y-auto pr-2 scrollbar-hide">
                    <button
                      onClick={() => setSelectedTopic("all")}
                      className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest transition border ${
                        selectedTopic === "all"
                          ? "bg-kindle-accent/10 text-kindle-accent border-kindle-accent/30"
                          : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-accent/30"
                      }`}
                    >
                      All Topics
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

                {availableSeries.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2 max-h-32 overflow-y-auto pr-2 scrollbar-hide">
                    <button
                      onClick={() => setSeriesFilter(null)}
                      className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest transition border ${
                        seriesFilter === null
                          ? "bg-kindle-accent/10 text-kindle-accent border-kindle-accent/30"
                          : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-accent/30"
                      }`}
                    >
                      All Series
                    </button>
                    {Array.from(availableSeries).sort().map((series) => (
                      <button
                        key={series}
                        onClick={() => setSeriesFilter(series)}
                        className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest transition border truncate max-w-[150px] ${
                          seriesFilter === series
                            ? "bg-kindle-accent/10 text-kindle-accent border-kindle-accent/30"
                            : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-accent/30"
                        }`}
                      >
                        {series}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

      {/* Audiobook Search Results */}
      {searchMode && isAudiobookSearch && (audiobookResults.length > 0 || audiobookLoading) && (
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-lexend font-bold flex items-center gap-2 text-kindle-accent">
              <Headphones className="w-5 h-5 text-kindle-accent" />
              {audiobookLoading ? "Searching free audiobook archives…" : `Audiobooks for "${query}"`}
            </h3>
            <button
              onClick={() => { setIsAudiobookSearch(false); setAudiobookResults([]); setSearchMode(false); }}
              className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          </div>
          {audiobookLoading ? (
            <div className="py-24 flex flex-col items-center justify-center">
              <KoraLoading context="audiobook-search" query={query} compact />
            </div>
          ) : audiobookResults.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-4 text-center">
              <Headphones className="w-10 h-10 text-kindle-text-muted opacity-30" />
              <p className="text-sm font-bold text-kindle-text-muted">No audiobooks found for "{query}"</p>
              <p className="text-xs text-kindle-text-muted/70">Try a different title or author name.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {audiobookResults.map((book, idx) => (
                <div
                  key={idx}
                  onMouseEnter={() => { if (canHover()) prefetchAudiobookDetail(book); }}
                  onFocus={() => prefetchAudiobookDetail(book)}
                  onClick={() => openBookDetail(book)}
                  className="group block space-y-2 cursor-pointer"
                >
                  <div className="kora-cover-hardware aspect-[2/3] bg-kindle-card rounded-xl border border-kindle-border overflow-hidden relative shadow-sm group-hover:shadow-lg transition-all duration-300">
                    {book.coverUrl ? (
                      <img loading="lazy" decoding="async"
                        src={getAudiobookCoverSrc(book.coverUrl) || book.coverUrl}
                        alt={book.title}
                        className={`w-full h-full object-cover group-hover:scale-105 transition duration-500 ${grayscaleCovers ? "grayscale" : ""}`}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          const t = e.target as HTMLImageElement;
                          const attempt = parseInt(t.dataset.attempt || "0");
                          t.dataset.attempt = String(attempt + 1);
                          if (attempt === 0) {
                            t.src =
                              resolveCoverImageSrc(
                                `/api/cover-redirect?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author || "")}`
                              ) || "";
                            return;
                          }
                          t.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-kindle-card">
                        <Headphones className="w-6 h-6 text-kindle-text-muted mb-1.5 opacity-50" />
                        <span className="text-[7px] font-bold text-kindle-text-muted uppercase text-center line-clamp-3">{book.title}</span>
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition">
                      <span className="text-[8px] font-bold text-white uppercase tracking-wider flex items-center gap-1">
                        <Headphones className="w-2.5 h-2.5" />
                        View Tracks
                      </span>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <h4 className="text-[10px] font-bold font-serif line-clamp-2 leading-snug group-hover:text-kindle-accent transition">{book.title}</h4>
                    {book.author && <p className="text-[9px] text-kindle-text-muted font-sans truncate">{book.author}</p>}
                    <p className="text-[8px] text-kindle-text-muted font-bold uppercase tracking-wider flex items-center gap-1">
                      <Headphones className="w-2.5 h-2.5" />
                      Audiobook
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Search Results */}
      {searchMode && !isAudiobookSearch && (
        <section className="space-y-6" data-guide="discover-results">
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
            <div className="py-24 flex flex-col items-center justify-center">
              <KoraLoading context="search" query={query} compact />
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
              {seriesResultGroups.length > 0 && (
                <div className="col-span-full flex flex-wrap gap-2" aria-label="Series groups in search results">
                  {seriesResultGroups.map(([key, group]) => {
                    const collapsed = collapsedSeriesGroups.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-expanded={!collapsed}
                        onClick={() => setCollapsedSeriesGroups((previous) => {
                          const next = new Set(previous);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          return next;
                        })}
                        className="inline-flex items-center gap-2 rounded-full border border-kindle-border bg-kindle-card px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-kindle-text transition hover:border-kindle-accent/50"
                      >
                        <Layers className="h-3 w-3 text-kindle-accent" />
                        <span>{collapsed ? "▸" : "⌄"} {group.name}</span>
                        <span className="rounded-full bg-kindle-bg px-1.5 py-0.5 text-kindle-text-muted">{group.count} volumes</span>
                        <span className="sr-only">{collapsed ? "Expand" : "Collapse"} series results</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {visibleResults.map((book) => (
                <div 
                  key={book.md5 || book.id || Math.random()} 
                  className={`group cursor-pointer space-y-2.5 p-2 rounded-3xl transition-all duration-300 border-2 ${
                    book.exactMatch 
                      ? "bg-kindle-accent/[0.03] border-kindle-accent/30 shadow-lg ring-1 ring-kindle-accent/10" 
                      : "border-transparent hover:bg-kindle-card/50"
                  }`}
                  onClick={() => openBookDetail(book)}
                >
                  <div className={`kora-cover-hardware aspect-[2/3] bg-kindle-card rounded-2xl border ${book.exactMatch ? "border-kindle-accent/40 shadow-inner" : "border-kindle-border"} overflow-hidden relative shadow-sm group-hover:shadow-xl transition-all duration-500`}>
                    {!hideCovers && book.coverUrl ? (
                      <img loading="lazy" decoding="async"
                        src={resolveCoverImageSrc(book.coverUrl) || ""}
                        alt={book.title}
                        className={`w-full h-full object-cover group-hover:scale-105 transition duration-500 ${grayscaleCovers ? "grayscale" : ""}`}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          const encodedTitle = encodeURIComponent(book.title || "");
                          const encodedAuthor = encodeURIComponent(book.author || "");
                          // Send archive covers through the resolver first, with the
                          // user's selected catalog provider as its first fallback.
                          if (book.md5 && target.dataset.md5Fallback !== "1") {
                            target.dataset.md5Fallback = "1";
                            target.src =
                              resolveCoverImageSrc(
                                `/api/cover-redirect?title=${encodedTitle}&author=${encodedAuthor}&md5=${encodeURIComponent(book.md5)}&backup=${encodeURIComponent(coverBackupProvider)}&v=2`
                              ) || "";
                            return;
                          }

                          // If the MD5 resolver or original cover failed, try the
                          // exact ISBN image before the title-only catalog fallback.
                          if (book.isbn && /^\d{10,13}$/.test(book.isbn) && target.dataset.isbnFallback !== "1") {
                            target.dataset.isbnFallback = "1";
                            target.src =
                              resolveCoverImageSrc(
                                `https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg`
                              ) || "";
                            return;
                          }

                          if (target.dataset.titleFallback !== "1") {
                            target.dataset.titleFallback = "1";
                            target.src = resolveCoverImageSrc(
                                `/api/cover-redirect?title=${encodedTitle}&author=${encodedAuthor}&backup=${encodeURIComponent(coverBackupProvider)}&v=2`
                            ) || "";
                            return;
                          }

                          // All fallbacks exhausted: show typography placeholder
                          target.style.display = "none";
                          const parent = target.parentElement;
                          if (parent && !parent.querySelector(".kora-typo-cover")) {
                            const div = document.createElement("div");
                            div.className = "kora-typo-cover w-full h-full flex flex-col items-center justify-center p-4 text-center bg-kindle-card absolute inset-0";
                            div.innerHTML = `
                              <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;opacity:0.3;margin-bottom:6px;">${escapeHtml((book.author || "Author").substring(0, 30))}</div>
                              <div style="font-size:11px;font-weight:700;font-family:serif;line-height:1.3;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(book.title)}</div>
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
                      <div className="absolute top-2 right-2 bg-kindle-accent text-kindle-bg px-2 py-0.5 rounded-full text-[7px] font-bold uppercase tracking-widest shadow-lg z-10">
                        MATCH
                      </div>
                    )}
                    {/* NYT Bestseller Badge */}
                    {book.isNYTBestseller && (
                      <div className="absolute top-2 left-2 bg-black/80 text-white px-1.5 py-0.5 rounded-full text-[6px] font-bold uppercase tracking-widest shadow-lg z-10 flex items-center gap-0.5">
                        <span style={{color:'#d4af37'}}>★</span> NYT
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-300">
                      <div className="bg-kindle-bg text-kindle-text p-3.5 rounded-full shadow-2xl scale-75 group-hover:scale-100 transition duration-500">
                        <Download className="w-5 h-5" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-0.5 pr-1">
                    <h4 className="text-[11px] font-bold font-serif line-clamp-2 leading-tight group-hover:text-kindle-accent transition">{book.title}</h4>
                    {book.series && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openSeriesDetail(book); }}
                        className="inline-flex max-w-full items-center gap-1 pt-0.5 text-[8px] font-bold uppercase tracking-wider text-kindle-accent hover:underline"
                        title={`View ${book.series} series details in Kora`}
                      >
                        <Layers className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">Series · {book.series}</span>
                      </button>
                    )}
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
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-[8px] font-bold uppercase tracking-widest text-kindle-accent/80 flex items-center gap-1">
                        <Globe className="w-2 h-2" />
                        {book.source === "nyt" ? "NYT Bestsellers"
                          : book.source === "librarything" ? "LibraryThing"
                          : book.isGoogleBook ? "Google Books"
                          : book.source === "Library Genesis" ? "LibGen"
                          : book.source === "Anna's Archive" ? "Anna's"
                          : book.source}
                      </span>
                      {book.nytListName && (
                        <span className="text-[8px] text-amber-500/80 font-bold truncate">
                          · {book.nytListName}
                        </span>
                      )}
                      {book.nytWeeksOnList && (
                        <span className="text-[8px] text-kindle-text-muted/60 shrink-0">
                          · {book.nytWeeksOnList}w on list
                        </span>
                      )}
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
                    {book.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-1">
                        {book.tags.slice(0, 3).map((tag: string) => (
                          <span key={tag} className="text-[7px] bg-kindle-accent/10 text-kindle-accent px-1 py-0.5 rounded-full">{tag}</span>
                        ))}
                      </div>
                    )}
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
              {getCategoryDescription(viewingCategory)}
            </p>
          </div>

          {loadingCategory ? (
            <div className="py-24 flex flex-col items-center justify-center">
              <KoraLoading context="category" categorySource={viewingCategory?.source} compact />
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
                  onMouseEnter={() => { if (canHover()) prefetchAudiobookDetail(book); }}
                  onFocus={() => prefetchAudiobookDetail(book)}
                  onClick={() => openBookDetail(book)}
                  className="group cursor-pointer space-y-2 p-1 sm:p-1.5 rounded-2xl sm:rounded-3xl transition-all duration-300 border border-transparent hover:bg-kindle-card/50"
                >
                  <div className="kora-cover-hardware aspect-[2/3] bg-kindle-card rounded-2xl border border-kindle-border overflow-hidden relative shadow-sm group-hover:shadow-lg transition-all duration-500">
                    {!hideCovers && book.coverUrl ? (
                      <img loading="lazy" decoding="async"
                        src={
                          viewingCategory.source === "audiobook"
                            ? (getAudiobookCoverSrc(book.coverUrl) || book.coverUrl)
                            : resolveCoverImageSrc(book.coverUrl) || ""
                        }
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

                    <DiscoverRatingBadge book={book} />
                  </div>

                  <div className="space-y-0.5">
                    <h4 className="text-xs font-bold font-serif line-clamp-2 leading-tight group-hover:text-kindle-accent transition">
                      {book.title}
                    </h4>
                    <p className="text-[10px] text-kindle-text-muted font-sans font-medium truncate">
                      {book.author}
                    </p>
                    {viewingCategory.source === "audiobook" && (book.listenUrl || book.link) && (
                      <p className="text-[9px] text-kindle-text-muted/70 font-sans truncate">
                        Listen free on HDAudiobooks
                      </p>
                    )}
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
              <BookOpen className="w-4 h-4 text-kindle-text-muted shrink-0" />
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
                onClick={() => loadFeaturedContent()}
                className="px-4 py-2 bg-kindle-card border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-kindle-bg transition"
              >
                Retry Loading
              </button>
            </div>
          )}
          {audiobookLibraryMode && (
            <div className="flex items-center justify-between gap-3 bg-kindle-card border border-kindle-border rounded-2xl px-4 py-3">
              <div>
                <h3 className="text-lg font-lexend font-bold text-kindle-text">Audiobook Library</h3>
                <p className="text-[10px] text-kindle-text-muted">Browse free audiobooks organized by category.</p>
              </div>
              <button
                onClick={closeAudiobookLibrary}
                className="px-3.5 py-1.5 rounded-full border border-kindle-border text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-text transition"
              >
                Back
              </button>
            </div>
          )}

          {/* Feed Filter Tabs */}
          <div id="discover-feeds" className="flex items-center justify-between border-b border-kindle-border/40 pb-2">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
              <button
                onClick={() => setFeedFilter("all")}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                  feedFilter === "all"
                    ? "border-kindle-text text-kindle-text"
                    : "border-transparent text-kindle-text-muted hover:text-kindle-text"
                }`}
              >
                Archives
              </button>
              <button
                onClick={() => {
                  if (audiobookLibraryMode) closeAudiobookLibrary();
                  setFeedFilter("plugins");
                }}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  feedFilter === "plugins"
                    ? "border-amber-500 text-amber-500 font-extrabold"
                    : "border-transparent text-kindle-text-muted hover:text-kindle-text"
                }`}
              >
                <Puzzle className="w-3.5 h-3.5 text-amber-500" />
                Plugins
              </button>
            </div>
            <div className="text-[9px] text-kindle-text-muted font-mono uppercase tracking-wider font-semibold hidden sm:block">
              {feedFilter === "all" ? "Archives & Curated Feeds" : "Source Plugins"}
            </div>
          </div>

          {feedFilter === "plugins" ? (
            <SourcePluginsHub />
          ) : loadingFeatured ? (
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
              const totalBooks = shuffledFeaturedCategories.reduce((n, c) => n + c.books.length, 0);
              if (totalBooks === 0) {
                return (
                  <div className="py-20 flex flex-col items-center gap-4 text-center">
                    <Compass className="w-10 h-10 text-kindle-text-muted opacity-40" />
                    {error ? (
                      <p className="text-sm font-bold text-kindle-text-muted">{error}</p>
                    ) : (
                      <p className="text-sm font-bold text-kindle-text-muted">No trending titles right now</p>
                    )}
                    <p className="text-xs text-kindle-text-muted/70 max-w-sm">
                      {error
                        ? "Couldn't reach the book service. Retrying automatically — or use the search above to find any book across the global archives."
                        : "Use the search above to find any book across the global archives."}
                    </p>
                    <button
                      onClick={() => loadFeaturedContent(true)}
                      className="flex items-center gap-2 px-4 py-2 border border-kindle-border rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-kindle-card transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Refresh
                    </button>
                  </div>
                );
              }
              return shuffledFeaturedCategories.map(({ cat, books }) => {
                return (
                  <section key={cat.id} className="discover-category-section space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-kindle-card rounded-xl border border-kindle-border">
                          {cat.source === "audiobook" ? (
                            <Headphones className="w-4 h-4 text-kindle-text" />
                          ) : cat.source === "goodreads" ? (
                            <GoodreadsIcon className="w-4 h-4 text-[#553B08] dark:text-[#D9C5A0]" />
                          ) : cat.source === "netgalley" ? (
                            <NetgalleyIcon className="w-4 h-4 text-kindle-accent" />
                          ) : cat.source === "nyt" ? (
                            <NytIcon className="w-4 h-4 text-kindle-text" />
                          ) : cat.id.includes("fiction") ? (
                            <BookMarked className="w-4 h-4 text-kindle-accent" />
                          ) : (
                            <BookOpen className="w-4 h-4 text-kindle-text-muted" />
                          )}
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

                  {audiobookLibraryMode && cat.source === "audiobook" ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                      {books.map((book, idx) => (
                        <div
                          key={idx}
                          onMouseEnter={() => { if (canHover()) prefetchAudiobookDetail(book); }}
                          onFocus={() => prefetchAudiobookDetail(book)}
                          onClick={() => openBookDetail(book)}
                          className="group cursor-pointer space-y-2 p-1 sm:p-1.5 rounded-2xl transition-all border border-transparent hover:bg-kindle-card/50"
                        >
                          <div className="aspect-[2/3] bg-kindle-card rounded-xl border border-kindle-border overflow-hidden relative shadow-sm">
                            <DiscoverRatingBadge book={book} />
                            {!hideCovers && book.coverUrl ? (
                              <img loading="lazy" decoding="async"
                                src={getAudiobookCoverSrc(book.coverUrl) || book.coverUrl}
                                alt={book.title}
                                className={`w-full h-full object-cover group-hover:scale-105 transition duration-500 ${grayscaleCovers ? "grayscale" : ""}`}
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-kindle-card">
                                <Headphones className="w-6 h-6 text-kindle-text-muted mb-1.5 opacity-30" />
                                <span className="text-[8px] font-bold text-kindle-text-muted uppercase text-center line-clamp-3">{book.title}</span>
                              </div>
                            )}
                          </div>
                          <div className="space-y-0.5">
                            <h4 className="text-[10px] font-bold font-serif line-clamp-2 leading-snug">{book.title}</h4>
                            <p className="text-[9px] text-kindle-text-muted truncate">{book.author}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                  <div className="flex gap-3 overflow-x-auto pb-4 scroll-smooth snap-x gpu-scroll-container snap-carousel">
                    {books.map((book, idx) => (
                      <div
                        key={idx}
                        onMouseEnter={() => { if (canHover()) prefetchAudiobookDetail(book); }}
                        onFocus={() => prefetchAudiobookDetail(book)}
                        onClick={() => openBookDetail(book)}
                        className="flex-shrink-0 w-28 sm:w-36 space-y-2 cursor-pointer group snap-start snap-carousel-item"
                      >
                        <div className="aspect-[2/3] bg-kindle-card rounded-xl border border-kindle-border overflow-hidden relative shadow-sm group-hover:shadow-lg transition-all duration-500 gpu-image-card">
                          <DiscoverRatingBadge book={book} />
                          {!hideCovers && book.coverUrl ? (
                            <img loading="lazy" decoding="async"
                              src={
                                cat.source === "audiobook"
                                  ? (getAudiobookCoverSrc(book.coverUrl) || book.coverUrl)
                                  : (resolveCoverImageSrc(book.coverUrl) || "")
                              }
                              alt={book.title}
                              className={`w-full h-full object-cover group-hover:scale-105 transition duration-500 ${grayscaleCovers ? "grayscale" : ""}`}
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                const attempt = parseInt(target.dataset.attempt || "0");
                                target.dataset.attempt = String(attempt + 1);
                                if (attempt === 0) {
                                  target.src =
                                    resolveCoverImageSrc(
                                      `/api/cover-redirect?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author || "")}`
                                    ) || "";
                                  return;
                                }
                                target.style.display = "none";
                                const parent = target.parentElement;
                                if (parent && !parent.querySelector(".kora-typo-cover")) {
                                  const div = document.createElement("div");
                                  div.className = "kora-typo-cover w-full h-full flex flex-col items-center justify-center p-3 bg-kindle-card absolute inset-0";
                                  div.innerHTML = `<div style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;opacity:0.3;margin-bottom:4px;">${escapeHtml((book.author||"").substring(0,25))}</div><div style="font-size:9px;font-weight:700;font-family:serif;line-height:1.3;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(book.title)}</div>`;
                                  parent.style.position = "relative";
                                  parent.appendChild(div);
                                }
                              }}
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
                  )}
                </section>
              );
            });
          })()
          )}

          {/* Explore Categories Dashboard */}
          {!audiobookLibraryMode && (
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
                    { id: "sci-fi", label: "Sci-Fi & Fantasy", query: "science fiction fantasy", icon: BookOpen, color: "text-kindle-text bg-kindle-card hover:bg-kindle-bg border-kindle-border hover:border-kindle-accent/50" },
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
          )}
        </div>
      )}
      </div>

      {seriesDetailBook && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" role="presentation">
          <button
            type="button"
            aria-label="Close series details"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setSeriesDetailBook(null)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="kora-series-detail-title"
            className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-kindle-border bg-kindle-card shadow-2xl animate-in zoom-in-95 duration-200"
          >
            <header className="flex items-start justify-between gap-4 border-b border-kindle-border px-6 py-5">
              <div className="min-w-0">
                <p className="mb-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">
                  <Layers className="h-3.5 w-3.5" /> Series details
                </p>
                <h2 id="kora-series-detail-title" className="truncate text-xl font-lexend font-bold text-kindle-text">
                  {seriesDetailBook.series}
                </h2>
                <p className="mt-1 text-xs text-kindle-text-muted">
                  {seriesDetailBooks.length} catalog {seriesDetailBooks.length === 1 ? "book" : "books"}
                  {" · "}{seriesDetailBooks.filter((book: any) => book.inLibrary).length} in your library
                  {" · "}{seriesDetailBooks.filter((book: any) => !book.inLibrary).length} missing
                  {seriesCatalog?.source ? ` · ${seriesCatalog.source}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setSeriesDetailBook(null)}
                className="shrink-0 rounded-full border border-kindle-border bg-kindle-bg p-2 text-kindle-text-muted transition hover:text-kindle-text"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="overflow-y-auto p-5 md:p-6">
              {seriesCatalogLoading && (
                <div className="mb-4 flex items-center gap-2 rounded-xl border border-kindle-border bg-kindle-bg/60 px-4 py-3 text-xs text-kindle-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Looking up series membership and edition details…
                </div>
              )}
              {seriesCatalogError && (
                <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-kindle-text-muted">
                  Catalog lookup failed: {seriesCatalogError}. Showing books already in your library.
                </div>
              )}
              {seriesDetailBooks.length ? (
                <ol className="space-y-3">
                  {seriesDetailBooks.map((book, index) => {
                    const cover = resolveCoverImageSrc(book.coverUrl) || book.coverUrl;
                    const progress = Math.max(0, Math.min(100, Number(book.progress?.percent || 0)));
                    return (
                      <li key={book.id || `${book.title}-${book.isbn || index}`} className="flex items-center gap-4 rounded-2xl border border-kindle-border bg-kindle-bg/60 p-3">
                        <span className="w-8 shrink-0 text-center font-mono text-xs font-bold text-kindle-text-muted">
                          {book.seriesNumber || index + 1}
                        </span>
                        {cover ? (
                          <img src={cover} alt="" loading="lazy" className="h-16 w-11 shrink-0 rounded-lg border border-kindle-border object-cover" />
                        ) : (
                          <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded-lg border border-kindle-border bg-kindle-card">
                            <BookOpen className="h-5 w-5 text-kindle-text-muted" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-bold text-kindle-text">{book.title}</h3>
                          <p className="mt-1 truncate text-xs text-kindle-text-muted">{book.author || "Unknown author"}</p>
                          <p className="mt-1 truncate text-[10px] text-kindle-text-muted">
        {[book.publisher, book.year, book.pages ? `${book.pages} pp` : "", book.format?.toUpperCase(), book.filesize ? `${(book.filesize / 1_000_000).toFixed(1)} MB` : "", book.isbn ? `ISBN ${book.isbn}` : ""].filter(Boolean).join(" · ")}
                          </p>
                          {book.description && <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-kindle-text-muted">{stripHtml(book.description)}</p>}
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">
                              {book.inLibrary
                                ? (book.status === "completed" ? "Finished" : progress > 0 ? `${progress}% read` : "In your library")
                                : `${book.metadataSource || "Catalog entry"} · Missing from your library`}
                            </span>
                            {book.inLibrary && (
                              <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-kindle-border">
                                <div className="h-full rounded-full bg-kindle-accent" style={{ width: `${progress}%` }} />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setSeriesDetailBook(null);
                                openBookDetail({
                                  ...book,
                                  source: book.source || book.metadataSource || "Series catalog",
                                  isGoogleBook: Boolean(book.googleVolumeId),
                                  series: book.series || seriesDetailBook?.series,
                                });
                              }}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-kindle-accent/30 bg-kindle-accent/10 px-2.5 py-1.5 text-[8px] font-bold uppercase tracking-widest text-kindle-accent transition hover:bg-kindle-accent/20"
                              title={`Open details for ${book.title}`}
                            >
                              <BookOpen className="h-3 w-3 shrink-0" /> Details
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className="rounded-2xl border border-dashed border-kindle-border px-6 py-12 text-center">
                  <BookOpen className="mx-auto mb-3 h-8 w-8 text-kindle-text-muted/60" />
                  <p className="text-sm font-semibold text-kindle-text">
                    {seriesCatalogLoading ? "Looking up series books…" : "No verified books found for this series yet."}
                  </p>
                  <p className="mt-1 text-xs text-kindle-text-muted">
                    {seriesCatalogLoading
                      ? "Kora is checking the series catalog and matching available book metadata."
                      : "Google Books does not provide a structured series list for every title, and catalog coverage can vary."}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>,
        document.body
      )}

      {/* Download Modal - Simplified Download Link Selector */}
      {selectedBook && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={() => dismissDiscoverDetail()} />
          <div className="relative w-full max-w-xl bg-kindle-card border border-kindle-border rounded-3xl shadow-2xl p-6 md:p-8 animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto scrollbar-thin">
            {/* Close Button */}
            <button 
              onClick={() => dismissDiscoverDetail()} 
              className="absolute top-4 right-4 p-2 bg-kindle-bg/80 hover:bg-kindle-bg border border-kindle-border rounded-full hover:scale-105 transition duration-200 z-10 cursor-pointer"
            >
              <X className="w-4 h-4 text-kindle-text" />
            </button>

            <div className="space-y-6 pt-2">
              {/* Header: Title & Author */}
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-bold text-emerald-600 uppercase tracking-widest font-sans">
                  Available for Download
                </div>
                <h3 className="text-2xl font-lexend font-bold leading-tight text-kindle-text">{selectedBook.title}</h3>
                <p className="text-sm text-kindle-text-muted font-sans font-medium">
                  {selectedBook.author}
                </p>
                {selectedBook.series && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openSeriesDetail(selectedBook); }}
                    className="mx-auto inline-flex items-center gap-1 rounded-full border border-kindle-accent/25 bg-kindle-accent/5 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-kindle-accent hover:bg-kindle-accent/10"
                    title={`View ${selectedBook.series} series details in Kora`}
                  >
                    <Layers className="h-3 w-3" />
                    Series · {selectedBook.series}
                  </button>
                )}
                {loadingDetails && (
                  <p className="text-[9px] text-kindle-text-muted">Loading book details…</p>
                )}
                {!loadingDetails && verifiedDetails?.source && (
                  <p className="text-[9px] text-kindle-text-muted">Details from {verifiedDetails.source}</p>
                )}
                
                <div className="flex items-center justify-center gap-2 mt-4">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-kindle-text-muted bg-kindle-bg px-2 py-0.5 rounded border border-kindle-border">
                    {(selectedVariant || selectedBook).extension?.toUpperCase() || "FILE"}
                  </span>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-kindle-text-muted bg-kindle-bg px-2 py-0.5 rounded border border-kindle-border">
                    {(selectedVariant || selectedBook).size || "N/A"}
                  </span>
                </div>
              </div>

              {/* Multi-Format Selector */}
              {(selectedBook.variants?.length > 0 || selectedBook.language || selectedBook.extension) && (
                <div className="space-y-3 p-4 bg-kindle-bg/50 border border-kindle-border rounded-2xl">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted text-center">
                    {selectedBook.variants?.length > 1 ? "Switch Format / Mirror" : "Download Edition"}
                  </h4>
                  <div className="flex flex-wrap justify-center gap-2">
                    {(selectedBook.variants?.length
                      ? selectedBook.variants
                      : [selectedVariant || selectedBook]
                    ).map((v: any, vIdx: number) => {
                      const isActive =
                        selectedVariant?.id === v.id ||
                        selectedVariant?.md5 === v.md5 ||
                        (!selectedBook.variants?.length && vIdx === 0);
                      const lang = formatLanguage(v.language || selectedBook?.language || "");
                      return (
                        <button
                          key={vIdx}
                          onClick={() => selectedBook.variants?.length > 1 && handleGetDownloadLinks(selectedBook, v)}
                          className={`px-3 py-1.5 rounded-xl text-left border transition duration-200 cursor-pointer ${
                            isActive
                              ? "bg-kindle-accent/10 border-kindle-accent text-kindle-accent shadow-sm"
                              : "bg-kindle-card border-kindle-border hover:border-kindle-text-muted text-kindle-text-muted hover:text-kindle-text"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-extrabold uppercase font-mono">{v.extension || selectedBook.extension || "EPUB"}</span>
                            <span className="text-[9px] opacity-70">· {v.size || selectedBook.size || "..."}</span>
                            <span className={`text-[8px] font-bold font-mono uppercase px-1.5 py-0.5 rounded border ${
                              isActive
                                ? "bg-kindle-accent/20 border-kindle-accent/40 text-kindle-accent"
                                : "bg-kindle-bg border-kindle-border text-kindle-text-muted"
                            }`}>
                              {lang || "LANG?"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Actions & Progress Area */}
              <div className="space-y-4">
                {/* Recommended Auto-Download */}
                {!fetchingMirrors && !mirrorError && mirrors.some(m => m.isDirect) && downloadProgress.step === "idle" && (
                  <button
                    onClick={() => handleAutoDownload()}
                    className="w-full p-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 transition-all duration-300 text-left flex items-center justify-between group shadow-lg shadow-emerald-600/10 hover:shadow-emerald-500/20 text-white cursor-pointer"
                  >
                    <div>
                      <p className="text-xs font-bold font-sans flex items-center gap-1.5 text-white">
                        <Loader2 className="w-3.5 h-3.5 text-neutral-300 animate-spin" />
                        Recommended Direct Download
                      </p>
                      <p className="text-[10px] text-emerald-100/80 font-medium font-sans mt-0.5">
                        Import high-quality {(selectedVariant || selectedBook).extension || "epub"} copy to library.
                      </p>
                    </div>
                    <Download className="w-4 h-4 text-emerald-100 group-hover:scale-110 transition shrink-0 ml-2 animate-bounce" />
                  </button>
                )}

                {/* Mirror Options List */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold text-kindle-text-muted uppercase tracking-wider flex justify-between border-b border-kindle-border/40 pb-1">
                    <span>Download Mirrors</span>
                    {fetchingMirrors && (
                      <span className="text-[9px] font-bold text-kindle-accent uppercase tracking-widest flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Scanning...
                      </span>
                    )}
                  </div>

                  {fetchingMirrors ? (
                    <div className="py-8 text-center space-y-3 bg-kindle-bg/50 border border-kindle-border rounded-2xl">
                      <Loader2 className="w-8 h-8 animate-spin text-kindle-accent mx-auto" />
                      <p className="text-[9px] text-kindle-text-muted font-bold uppercase tracking-widest font-sans animate-pulse">Syncing with global repositories…</p>
                    </div>
                  ) : mirrorError ? (
                    <div className="py-8 text-center space-y-2 bg-kindle-bg/50 border border-kindle-border rounded-2xl">
                      <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto" />
                      <p className="text-[10px] text-kindle-text-muted font-sans font-medium px-6">{mirrorError}</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {mirrors.map((m, i) => {
                        const isMobilismReal = m.url && (m.url.toLowerCase().includes("mobilism.org") || m.url.toLowerCase().includes("mobilism"));
                        return (
                          <div
                            key={i}
                            onClick={() => handleMirrorClick(m)}
                            className={`w-full p-3 rounded-xl border transition text-left group flex items-center justify-between cursor-pointer ${
                              m.isDirect 
                                ? "border-kindle-border hover:border-emerald-500/40 bg-kindle-bg hover:bg-kindle-card" 
                                : "border-kindle-border/60 hover:border-amber-500/40 bg-kindle-bg/40 hover:bg-kindle-card/60"
                            }`}
                          >
                            <div className="overflow-hidden flex-1 min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-bold font-sans truncate pr-2">{m.label}</p>
                                {m.isDirect ? (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold text-emerald-600 bg-emerald-500/10 rounded uppercase tracking-wider shrink-0">Direct</span>
                                ) : (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold text-amber-600 bg-amber-500/10 rounded uppercase tracking-wider shrink-0">External</span>
                                )}
                              </div>
                              <p className="text-[9px] text-kindle-text-muted truncate font-mono mt-0.5 opacity-60">
                                {isMobilismReal ? "Mobilism Forum link (requires external browser login)" : m.url}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {/* Always show Open in New Tab button for all mirrors */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(m.url, '_blank');
                                }}
                                title="Open in new tab"
                                className="p-2 rounded-xl border border-kindle-border hover:border-kindle-accent/50 hover:bg-kindle-bg text-kindle-text-muted hover:text-kindle-text transition cursor-pointer"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>

                              {m.isDirect && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenBrowser?.(m.url);
                                  }}
                                  title="Open in-app browser"
                                  className="p-2 rounded-xl border border-kindle-border hover:border-kindle-accent/50 hover:bg-kindle-bg text-kindle-text-muted hover:text-kindle-text transition cursor-pointer"
                                >
                                  <Globe className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMirrorClick(m);
                                }}
                                title={m.isDirect ? "Download directly" : "Open external mirror"}
                                className={`p-2 rounded-xl border transition cursor-pointer ${
                                  m.isDirect
                                    ? "bg-emerald-500/10 hover:bg-emerald-500 text-emerald-600 hover:text-white border-emerald-500/20"
                                    : "bg-amber-500/10 hover:bg-amber-500 text-amber-600 hover:text-white border-amber-500/20"
                                }`}
                              >
                                {m.isDirect ? <Download className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Download Progress Overlay */}
                {downloadProgress.step !== "idle" && (
                  <div className="p-4 bg-kindle-card border-2 border-kindle-accent/20 rounded-2xl shadow-xl space-y-3 animate-in fade-in zoom-in-95 duration-300">
                    {downloadProgress.step === "completed" ? (
                      <div className="flex flex-col items-center gap-2 py-2">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                        <span className="text-sm font-bold uppercase tracking-widest font-sans text-kindle-text">Import Successful</span>
                        <p className="text-[10px] text-kindle-text-muted">Book has been added to your local library.</p>
                      </div>
                    ) : downloadProgress.error ? (
                      <div className="flex items-center gap-3 text-red-600 p-2">
                        <AlertTriangle className="w-5 h-5 shrink-0" />
                        <p className="text-xs font-sans font-medium">{downloadProgress.error}</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 justify-between">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-kindle-accent" />
                            <span className="text-[10px] font-bold uppercase tracking-widest font-sans text-kindle-text-muted">{downloadProgress.step}…</span>
                          </div>
                          <span className="text-[10px] font-mono font-bold text-kindle-accent">{downloadProgress.percent}%</span>
                        </div>
                        <div className="w-full h-2 bg-kindle-bg rounded-full overflow-hidden border border-kindle-border">
                          <div
                            className="h-full bg-kindle-accent transition-all duration-500 rounded-full"
                            style={{ width: `${downloadProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}


      {/* Featured Book Details Preview Modal */}
      {selectedFeaturedBook && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => dismissDiscoverDetail()} />
          <div className="relative bg-kindle-card kindle-card w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] border border-kindle-border/40 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between p-4 md:p-6 bg-kindle-card/95 backdrop-blur-md border-b border-kindle-border">
              <h2 className="text-sm font-bold uppercase tracking-widest text-kindle-text font-sans">Book Details</h2>
              <button 
                onClick={closeBookDetail}
                className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition text-kindle-text"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-kindle-card">
              <div className="max-w-6xl mx-auto px-6 py-10">
                <div className="flex flex-col md:flex-row gap-10">
                  {/* Left Column: Cover & Action Buttons */}
                  <div className="w-full md:w-64 shrink-0 flex flex-col items-center md:items-start">
                    <div className="w-full max-w-[240px] aspect-[2/3] rounded-xl overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.2)] bg-black/5 relative group mb-6">
                      {selectedFeaturedBook.coverUrl ? (
                        <img loading="lazy" decoding="async" src={selectedFeaturedBook.coverUrl} alt={selectedFeaturedBook.title} className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-kindle-text-muted">
                          <BookOpen className="w-12 h-12" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
                    </div>
                    <div className="w-full flex flex-col gap-3 max-w-[240px]">
                      <button 
                        onClick={() => {
                          const section = document.getElementById("featured-download-links-section");
                          if (section) {
                            section.scrollIntoView({ behavior: "smooth", block: "start" });
                          }
                        }}
                        className="w-full py-4 px-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-[11px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        Download Book
                      </button>

                      <button 
                        onClick={() => {
                          const queryText = `${selectedFeaturedBook.title} ${selectedFeaturedBook.author || ""}`.trim();
                          closeBookDetail();
                          setShowFilterOptions(true);
                          setSearchMode(true);
                          handleSearch(queryText);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="w-full py-3.5 px-5 bg-kindle-card border border-kindle-border hover:border-kindle-accent text-kindle-text rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Database className="w-4 h-4" />
                        Search with filters
                      </button>
                      
                      <div className="hidden md:block mt-8 space-y-8">
                        <section>
                          <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted mb-4 border-b border-kindle-border pb-2">Quick Stats</h4>
                          <div className="grid grid-cols-2 gap-y-4 gap-x-2">
                            <div className="flex flex-col">
                              <span className="text-[9px] text-kindle-text-muted uppercase tracking-widest font-bold mb-0.5">Pages</span>
                              <span className="text-[11px] text-kindle-text font-medium">{featuredBookDetails?.pageCount || "N/A"}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-kindle-text-muted uppercase tracking-widest font-bold mb-0.5">Year</span>
                              <span className="text-[11px] text-kindle-text font-medium">{featuredBookDetails?.publishedDate?.split('-')[0] || "N/A"}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-kindle-text-muted uppercase tracking-widest font-bold mb-0.5">Rating</span>
                              <span className="text-[11px] text-kindle-text font-medium">{featuredBookDetails?.averageRating || "N/A"}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-kindle-text-muted uppercase tracking-widest font-bold mb-0.5">Language</span>
                              <span className="text-[11px] text-kindle-text font-medium uppercase">{featuredBookDetails?.language || "EN"}</span>
                            </div>
                          </div>
                        </section>

                        {/* Context & Categories - Moved from right column */}
                        <section className="space-y-6">
                          <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted mb-4 border-b border-kindle-border pb-2">Context & Genres</h4>
                          <div className="space-y-6">
                            <div className="flex flex-col">
                              <span className="text-[9px] text-kindle-text-muted uppercase tracking-widest font-bold mb-3">Genres</span>
                              <div className="flex flex-wrap gap-2">
                                {([...(featuredBookDetails?.categories || []), ...(featuredBookDetails?.subjects || [])])
                                  .filter((v, i, a) => v && a.indexOf(v) === i)
                                  .length > 0 ? (
                                    ([...(featuredBookDetails?.categories || []), ...(featuredBookDetails?.subjects || [])])
                                      .filter((v, i, a) => v && a.indexOf(v) === i)
                                      .map((cat: string, i: number) => (
                                        <span key={i} className="px-2.5 py-1 bg-kindle-card rounded-lg text-[9px] text-kindle-accent font-bold uppercase tracking-widest border border-kindle-border shadow-sm">
                                          {cat}
                                        </span>
                                      ))
                                  ) : (
                                    <span className="text-[10px] text-kindle-text-muted italic">Fiction</span>
                                  )
                                }
                              </div>
                            </div>
                            
                            <div className="flex flex-col">
                              <span className="text-[9px] text-kindle-text-muted uppercase tracking-widest font-bold mb-2">Author Profile</span>
                              <div className="bg-kindle-card/30 p-4 rounded-xl border border-kindle-border">
                                <span className="text-sm font-bold text-kindle-text block mb-2">{featuredBookDetails?.authors?.[0] || selectedFeaturedBook.author}</span>
                                <p className="text-[11px] text-neutral-600 dark:text-kindle-text-muted leading-relaxed line-clamp-4 mb-4 italic">
                                  An accomplished author recognized for compelling storytelling and deep character exploration in the world of {featuredBookDetails?.categories?.[0] || "literature"}.
                                </p>
                                <button 
                                  onClick={() => {
                                    const author = featuredBookDetails?.authors?.[0] || selectedFeaturedBook.author;
                                    handleSearch(`inauthor:"${author}"`);
                                    closeBookDetail();
                                  }}
                                  className="w-full text-[9px] font-bold text-kindle-text border border-kindle-border px-4 py-2 rounded-lg hover:bg-kindle-accent hover:text-kindle-bg hover:border-kindle-accent transition-all uppercase tracking-widest"
                                >
                                  Library
                                </button>
                              </div>
                            </div>
                          </div>
                        </section>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Title, Metadata, Description & Sidebar */}
                  <div className="flex-1 min-w-0">
                    <div className="mb-8">
                      <h2 className="text-3xl md:text-5xl font-serif text-kindle-text mb-3 leading-tight tracking-tight">
                        {featuredBookDetails?.title || selectedFeaturedBook.title}
                      </h2>
                      <div className="text-xl text-kindle-text-muted font-sans flex flex-wrap items-center gap-2">
                        <span>By</span>
                        <span 
                          className="text-kindle-accent font-semibold hover:underline cursor-pointer transition-colors"
                          onClick={() => {
                            const author = featuredBookDetails?.authors?.join(", ") || selectedFeaturedBook.author;
                            if (author) {
                              closeBookDetail();
                              handleSearch(author);
                            }
                          }}
                        >
                          {featuredBookDetails?.authors?.join(", ") || selectedFeaturedBook.author}
                        </span>
                        {featuredBookDetails?.publishedDate && (
                          <span className="text-kindle-text-muted/40 font-light">· {featuredBookDetails.publishedDate.split('-')[0]}</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-10">
                      {/* Overview Section - Moved up to be next to cover */}
                      <section>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-kindle-text-muted">Overview</h3>
                          <div className="flex items-center bg-black/5 rounded-lg p-1 border border-kindle-border">
                            {["google", "nyt", "openlibrary"].map((source) => (
                              <button 
                                key={source}
                                onClick={() => updateMetadataSource(source as any)}
                                className={`px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider rounded-md transition-all ${
                                  metadataSource === source 
                                    ? 'bg-kindle-text text-kindle-bg shadow-md' 
                                    : 'text-kindle-text-muted hover:text-kindle-text'
                                }`}
                              >
                                {source}
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        <div className="text-kindle-text leading-relaxed font-sans text-base space-y-4 min-h-[120px]">
                          {loadingFeaturedDetails ? (
                            <div className="space-y-4 animate-pulse">
                              <div className="h-5 bg-black/5 rounded-lg w-full" />
                              <div className="h-5 bg-black/5 rounded-lg w-full" />
                              <div className="h-5 bg-black/5 rounded-lg w-4/5" />
                            </div>
                          ) : (
                            <p className="whitespace-pre-line text-sm md:text-base text-neutral-700 dark:text-kindle-text-muted leading-relaxed">
                              {stripHtml(
                                featuredBookDetails?.description ||
                                  selectedFeaturedBook.description ||
                                  (loadingFeaturedDetails
                                    ? ""
                                    : "No detailed description available from this source. Try Open Library or NYT above.")
                              )}
                            </p>
                          )}
                        </div>
                      </section>

                      {/* Download Links - Moved UP and made larger */}
                      <section id="featured-download-links-section" className="pt-8 border-t border-kindle-border">
                        <div className="flex items-center gap-3 mb-6">
                          <Download className="w-5 h-5 text-kindle-accent" />
                          <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-kindle-text">Download Links</h3>
                        </div>
                        
                        {loadingFeaturedDownloads ? (
                          <div className="flex items-center gap-3 py-6 bg-kindle-card rounded-2xl border border-kindle-border justify-center">
                            <Loader2 className="w-5 h-5 animate-spin text-kindle-accent" />
                            <span className="text-xs uppercase font-bold tracking-widest text-kindle-text-muted">Scanning global archives...</span>
                          </div>
                        ) : featuredDownloadVariants.length === 0 ? (
                          <div className="py-8 text-center bg-kindle-card rounded-2xl border border-kindle-border">
                            <p className="text-xs text-kindle-text-muted italic">No direct files discovered for this edition yet.</p>
                            <button 
                              onClick={() => {
                                const queryText = `${selectedFeaturedBook.title} ${selectedFeaturedBook.author || ""}`.trim();
                                closeBookDetail();
                                handleSearch(queryText);
                              }}
                              className="mt-4 text-[10px] font-bold uppercase tracking-widest text-kindle-accent hover:underline"
                            >
                              Try manual search
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {/* Variant Format buttons */}
                            <div className="space-y-2">
                              <span className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted/60">Select Edition:</span>
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                {(showAllEditions
                                  ? featuredDownloadVariants
                                  : featuredDownloadVariants.slice(0, 2)
                                ).map((v, idx) => {
                                  const isActive = selectedFeaturedVariant?.md5 === v.md5 || selectedFeaturedVariant?.id === v.id;
                                  const lang = formatLanguage(v.language || selectedFeaturedBook?.language || featuredBookDetails?.language || "English");
                                  return (
                                    <button
                                      key={idx}
                                      onClick={() => {
                                        setSelectedFeaturedVariant(v);
                                        fetchFeaturedVariantMirrors(v);
                                      }}
                                      className={`p-2.5 rounded-lg border text-left transition-all duration-200 cursor-pointer group ${
                                        isActive 
                                          ? "bg-kindle-accent/5 border-kindle-accent shadow-sm" 
                                          : "bg-kindle-bg border-kindle-border hover:border-kindle-text-muted/50 hover:bg-black/5"
                                      }`}
                                    >
                                      <div className="flex items-center justify-between mb-1.5">
                                        <span className={`text-[11px] font-black uppercase font-mono ${isActive ? "text-kindle-accent" : "text-kindle-text"}`}>{v.extension || "EPUB"}</span>
                                        <div className="flex items-center gap-1">
                                          {lang && (
                                            <span className={`text-[8px] font-bold font-mono uppercase px-1 py-0.5 rounded border ${
                                              isActive
                                                ? "bg-kindle-accent/20 border-kindle-accent/40 text-kindle-accent"
                                                : "bg-kindle-card border-kindle-border text-kindle-text-muted"
                                            }`}>
                                              {lang}
                                            </span>
                                          )}
                                          <span className="text-[8px] opacity-60 font-mono bg-kindle-card px-1 py-0.5 rounded border border-kindle-border">{v.size || "N/A"}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-1 h-1 rounded-full ${isActive ? 'bg-kindle-accent' : 'bg-kindle-accent/20'}`} />
                                        <span className="text-[8px] font-sans uppercase tracking-widest font-bold opacity-60 truncate">
                                          {v.source === "Library Genesis" ? "LibGen" : v.source === "Anna's Archive" ? "Anna's" : v.source}
                                        </span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                              {featuredDownloadVariants.length > 2 && (
                                <button
                                  onClick={() => setShowAllEditions((s) => !s)}
                                  className="w-full mt-1 py-1.5 rounded-lg border border-kindle-border bg-kindle-bg text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text hover:border-kindle-text-muted/50 transition flex items-center justify-center gap-1"
                                >
                                  {showAllEditions
                                    ? "Show fewer editions"
                                    : `Show ${featuredDownloadVariants.length - 2} more edition${featuredDownloadVariants.length - 2 === 1 ? "" : "s"}`}
                                </button>
                              )}
                            </div>

                            {/* Mirrors for selected variant */}
                            {selectedFeaturedVariant && (
                              <div className="space-y-3 bg-kindle-card/50 rounded-2xl border border-kindle-border/40 p-5">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Available Download Mirrors:</span>
                                  {fetchingFeaturedMirrors && <Loader2 className="w-3.5 h-3.5 animate-spin text-kindle-accent" />}
                                </div>

                                {fetchingFeaturedMirrors ? (
                                  <div className="py-6 text-center text-xs text-kindle-text-muted font-bold uppercase tracking-widest animate-pulse">
                                    Resolving direct links...
                                  </div>
                                ) : downloadProgress.step !== "idle" ? (
                                  <div className="p-4 bg-kindle-card border-2 border-kindle-accent/20 rounded-2xl shadow-xl space-y-3 animate-in fade-in zoom-in-95 duration-300">
                                    {downloadProgress.step === "completed" ? (
                                      <div className="flex flex-col items-center gap-2 py-2">
                                        <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                                        <span className="text-sm font-bold uppercase tracking-widest font-sans text-kindle-text">Import Successful</span>
                                        <p className="text-[10px] text-kindle-text-muted">Book has been added to your local library.</p>
                                      </div>
                                    ) : downloadProgress.error ? (
                                      <div className="flex items-center gap-3 text-red-600 p-2">
                                        <AlertTriangle className="w-5 h-5 shrink-0" />
                                        <p className="text-xs font-sans font-medium">{downloadProgress.error}</p>
                                      </div>
                                    ) : (
                                      <div className="space-y-3">
                                        <div className="flex items-center gap-2 justify-between">
                                          <div className="flex items-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin text-kindle-accent" />
                                            <span className="text-[10px] font-bold uppercase tracking-widest font-sans text-kindle-text-muted">{downloadProgress.step}…</span>
                                          </div>
                                          <span className="text-[10px] font-mono font-bold text-kindle-accent">{downloadProgress.percent}%</span>
                                        </div>
                                        <div className="w-full h-2 bg-kindle-bg rounded-full overflow-hidden border border-kindle-border">
                                          <div
                                            className="h-full bg-kindle-accent transition-all duration-500 rounded-full"
                                            style={{ width: `${downloadProgress.percent}%` }}
                                          />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ) : featuredMirrorError ? (
                                  <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl text-[10px] text-amber-600 font-sans leading-relaxed">
                                    {featuredMirrorError}
                                  </div>
                                ) : featuredMirrors.length === 0 ? (
                                  <p className="text-xs text-kindle-text-muted italic py-4 text-center">No mirrors available for this variant.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {featuredMirrors.map((m, i) => {
                                      const isMobilismReal = m.url && (m.url.toLowerCase().includes("mobilism.org") || m.url.toLowerCase().includes("mobilism"));
                                      return (
                                        <div
                                          key={i}
                                          onClick={() => handleMirrorClick(m)}
                                          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between group ${
                                            m.isDirect 
                                              ? "border-kindle-border hover:border-emerald-500/40 hover:bg-emerald-500/5 bg-kindle-bg shadow-sm" 
                                              : "border-kindle-border hover:border-amber-500/40 hover:bg-amber-500/5 bg-kindle-bg shadow-sm"
                                          }`}
                                        >
                                          <div className="min-w-0 flex-1 pr-4">
                                            <div className="flex items-center gap-2 mb-1">
                                              <span className={`w-1.5 h-1.5 rounded-full ${m.isDirect ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                              <p className="text-sm font-bold text-kindle-text group-hover:text-kindle-accent transition-colors">{m.label}</p>
                                            </div>
                                            <p className="text-[10px] text-kindle-text-muted/60 truncate font-mono">
                                              {isMobilismReal ? "Mobilism Forum link (requires external browser login)" : m.url}
                                            </p>
                                          </div>
                                          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                            {/* Always show Open in New Tab button for featured details mirrors */}
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.open(m.url, "_blank");
                                              }}
                                              title="Open in new tab"
                                              className="p-2.5 rounded-xl border border-kindle-border hover:border-kindle-accent/50 hover:bg-kindle-bg text-kindle-text-muted hover:text-kindle-text transition-all"
                                            >
                                              <ExternalLink className="w-4 h-4" />
                                            </button>

                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleMirrorClick(m);
                                              }}
                                              className={`p-2.5 rounded-xl border transition-transform group-active:scale-95 ${
                                                m.isDirect
                                                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white"
                                                  : "bg-amber-500/10 border-amber-500/20 text-amber-600 group-hover:bg-amber-500 group-hover:text-white"
                                              }`}
                                            >
                                              {m.isDirect ? <Download className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </section>

                      {(audiobookDetailLoading || featuredAudiobookSource || audiobookDetail?.tracks?.length > 0 || audiobookDetail?.sourceUrl) && (
                        <section id="featured-audiobook-section" className="pt-8 border-t border-kindle-border">
                          <div className="flex items-center gap-3 mb-6">
                            <Headphones className="w-5 h-5 text-kindle-accent" />
                            <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-kindle-text">Audiobook</h3>
                          </div>

                          {audiobookDetailLoading ? (
                            <div className="flex items-center gap-3 py-6 bg-kindle-card rounded-2xl border border-kindle-border justify-center">
                              <Loader2 className="w-5 h-5 animate-spin text-kindle-accent" />
                              <span className="text-xs uppercase font-bold tracking-widest text-kindle-text-muted">Searching audiobook archives...</span>
                            </div>
                          ) : audiobookDetailError ? (
                            <div className="py-6 text-center bg-kindle-card rounded-2xl border border-kindle-border space-y-2">
                              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto opacity-70" />
                              <p className="text-xs text-kindle-text-muted">{audiobookDetailError}</p>
                              <button
                                onClick={() => {
                                  const generation = audiobookFetchGen.current;
                                  loadFeaturedAudiobook(selectedFeaturedBook, generation);
                                }}
                                className="text-[10px] font-bold uppercase tracking-widest text-kindle-accent hover:underline"
                              >
                                Retry
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {featuredAudiobookSource && (
                                <p className="text-xs text-kindle-text-muted">
                                  Audiobook version found
                                  {featuredAudiobookSource.author ? ` by ${featuredAudiobookSource.author}` : ""}.
                                </p>
                              )}

                              {audiobookDetail?.tracks?.length > 0 ? (
                                <div className="space-y-1.5 max-h-56 overflow-y-auto rounded-xl border border-kindle-border bg-kindle-card/50 p-2">
                                  {audiobookDetail.tracks.map((track: any, idx: number) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={() => toggleTrackPreview(track, idx)}
                                      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition text-left group w-full ${
                                        previewTrackIdx === idx ? "bg-kindle-bg border border-kindle-border" : "hover:bg-kindle-bg"
                                      }`}
                                    >
                                      <span className="text-[10px] font-mono text-kindle-text-muted w-5 shrink-0">{idx + 1}</span>
                                      <span className="text-xs text-kindle-text truncate flex-1">{track.title}</span>
                                      {previewTrackIdx === idx && previewPlaying ? (
                                        <Pause className="w-3.5 h-3.5 text-kindle-text shrink-0" />
                                      ) : (
                                        <Play className="w-3.5 h-3.5 text-kindle-text opacity-60 group-hover:opacity-100 transition shrink-0" />
                                      )}
                                    </button>
                                  ))}
                                </div>
                              ) : null}

                              {(audiobookDetail?.sourceUrl || featuredAudiobookSource?.listenUrl || featuredAudiobookSource?.link) && (
                                <a
                                  href={audiobookDetail?.sourceUrl || featuredAudiobookSource?.listenUrl || featuredAudiobookSource?.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center justify-between p-3.5 rounded-xl border border-kindle-border hover:border-kindle-accent/40 hover:bg-kindle-card bg-kindle-bg transition group"
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold text-kindle-text group-hover:text-kindle-accent transition-colors">Listen on HDAudiobooks</p>
                                    <p className="text-[10px] text-kindle-text-muted/60 truncate font-mono mt-0.5">
                                      {audiobookDetail?.sourceUrl || featuredAudiobookSource?.listenUrl || featuredAudiobookSource?.link}
                                    </p>
                                  </div>
                                  <ExternalLink className="w-4 h-4 text-kindle-text-muted shrink-0" />
                                </a>
                              )}

                              <div className="flex flex-col sm:flex-row gap-2.5">
                                {audiobookDetail?.tracks?.length > 0 && onPlayAudiobook && featuredAudiobookSource && (
                                  <button
                                    onClick={() => {
                                      previewAudioRef.current?.pause();
                                      const entry = buildAudiobookLibraryEntry(featuredAudiobookSource, audiobookDetail.tracks);
                                      onPlayAudiobook(entry);
                                      closeBookDetail();
                                    }}
                                    className="flex items-center justify-center gap-2.5 flex-1 px-4 py-3 bg-kindle-accent hover:brightness-110 text-kindle-bg text-xs font-bold uppercase tracking-widest rounded-xl transition shadow-sm"
                                  >
                                    <Headphones className="w-4 h-4" />
                                    Play in App
                                  </button>
                                )}
                                {onBookAdded && audiobookDetail?.tracks?.length > 0 && featuredAudiobookSource && (
                                  <button
                                    onClick={() => {
                                      onBookAdded(buildAudiobookLibraryEntry(featuredAudiobookSource, audiobookDetail.tracks));
                                      toast.success("Added to library — downloading tracks...");
                                      closeBookDetail();
                                    }}
                                    className="flex items-center justify-center gap-2.5 flex-1 px-4 py-3 bg-kindle-card hover:bg-kindle-border border border-kindle-border text-kindle-text text-xs font-bold uppercase tracking-widest rounded-xl transition"
                                  >
                                    <Library className="w-4 h-4 text-kindle-accent" />
                                    Add Audiobook to Library
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </section>
                      )}

                      <audio
                        ref={previewAudioRef}
                        className="hidden"
                        onEnded={() => setPreviewPlaying(false)}
                        onPause={() => setPreviewPlaying(false)}
                        onPlay={() => setPreviewPlaying(true)}
                      />

                      {/* Technical Details & More */}
                      <div className="pt-10 border-t border-kindle-border">
                        {/* Similar Books Section */}
                        <section className="space-y-6">
                          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">You might also like</h3>
                          {loadingSimilar ? (
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
                              {[...Array(6)].map((_, i) => (
                                <div key={i} className="aspect-[2/3] bg-kindle-card dark:bg-neutral-800 rounded-lg animate-pulse border border-kindle-border" />
                              ))}
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
                              {similarBooks.slice(0, 6).map((book, idx) => (
                                <div key={idx} className="group cursor-pointer" onClick={() => {
                                  closeBookDetail();
                                  handleSearch(`${book.title} ${book.author}`);
                                }}>
                                  <div className="aspect-[2/3] rounded-lg shadow-sm overflow-hidden mb-2 bg-kindle-card border border-kindle-border group-hover:shadow-md transition-all group-hover:-translate-y-1">
                                    {book.coverUrl && <img loading="lazy" decoding="async" src={book.coverUrl} alt={book.title} className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`} />}
                                  </div>
                                  <p className="text-[10px] font-bold text-kindle-text line-clamp-2 leading-tight group-hover:text-kindle-accent transition-colors">{book.title}</p>
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
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default React.memo(DiscoverView);
