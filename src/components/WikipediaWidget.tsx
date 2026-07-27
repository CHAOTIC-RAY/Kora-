import React, { useState, useEffect } from "react";
import {
  Globe,
  Search,
  BookOpen,
  Bookmark,
  Sparkles,
  Download,
  Share2,
  Volume2,
  VolumeX,
  X,
  ExternalLink,
  ChevronRight,
  RotateCw,
  Check,
  Plus,
  Trash2,
  List,
  Type,
  FileText,
  Clock,
  ArrowLeft,
  BookMarked
} from "lucide-react";
import { toast } from "react-hot-toast";
import { storeBookFile } from "../db/indexedDB";
import { syncBookToCloud, BookMetadata } from "../lib/firebase";

export interface WikiArticleSummary {
  pageid?: number;
  title: string;
  extract: string;
  description?: string;
  thumbnail?: {
    source: string;
    width: number;
    height: number;
  };
  content_urls?: {
    desktop: { page: string };
    mobile: { page: string };
  };
  lang?: string;
  timestamp?: string;
}

export interface SavedWikiArticle {
  id: string;
  title: string;
  extract: string;
  description?: string;
  thumbnailUrl?: string;
  wikiUrl: string;
  lang: string;
  savedAt: number;
}

interface WikipediaWidgetProps {
  onClose?: () => void;
  userId?: string;
  onRefreshLibrary?: () => void;
  initialArticle?: WikiArticleSummary | null;
}

const POPULAR_TOPICS = [
  { label: "Quantum Mechanics", query: "Quantum mechanics" },
  { label: "Renaissance Art", query: "Renaissance art" },
  { label: "James Webb Telescope", query: "James Webb Space Telescope" },
  { label: "Ancient Egypt", query: "Ancient Egypt" },
  { label: "Artificial Intelligence", query: "Artificial intelligence" },
  { label: "World Literature", query: "World literature" },
  { label: "Stoicism", query: "Stoicism" },
];

export default function WikipediaWidget({ onClose, userId, onRefreshLibrary, initialArticle }: WikipediaWidgetProps) {
  const [lang, setLang] = useState("en");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeArticle, setActiveArticle] = useState<WikiArticleSummary | null>(null);
  const [articleContentHtml, setArticleContentHtml] = useState<string | null>(null);
  const [isLoadingArticle, setIsLoadingArticle] = useState(false);
  const [activeTab, setActiveTab] = useState<"search" | "featured" | "saved">("featured");

  // Speech TTS state
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Saved Articles state
  const [savedArticles, setSavedArticles] = useState<SavedWikiArticle[]>(() => {
    try {
      const stored = localStorage.getItem("kora_wikipedia_saved_articles");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Featured / Random state
  const [featuredArticle, setFeaturedArticle] = useState<WikiArticleSummary | null>(null);
  const [isLoadingFeatured, setIsLoadingFeatured] = useState(false);

  // Reader typography settings
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">("medium");
  const [useSerifFont, setUseSerifFont] = useState(true);

  // Save state back to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("kora_wikipedia_saved_articles", JSON.stringify(savedArticles));
    } catch (e) {
      console.error("Failed to save wiki articles to localStorage", e);
    }
  }, [savedArticles]);

  // Load article on mount — either the one passed in (from the Lounge widget)
  // or a fresh random article.
  useEffect(() => {
    if (initialArticle?.title) {
      handleSelectArticle(initialArticle.title);
    } else {
      fetchRandomArticle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Speech Synthesis Stop on unmount
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const fetchRandomArticle = async () => {
    setIsLoadingFeatured(true);
    try {
      const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/random/summary`);
      if (res.ok) {
        const data = await res.json();
        setFeaturedArticle(data);
      }
    } catch (err) {
      console.error("Failed to fetch random Wikipedia article", err);
    } finally {
      setIsLoadingFeatured(false);
    }
  };

  // Perform search query using Wikipedia API
  const handleSearch = async (e?: React.FormEvent, searchQuery?: string) => {
    if (e) e.preventDefault();
    const searchTerm = searchQuery || query;
    if (!searchTerm.trim()) return;

    setIsSearching(true);
    setActiveTab("search");
    try {
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        searchTerm
      )}&utf8=&format=json&origin=*&srlimit=10`;
      const res = await fetch(url);
      const data = await res.json();
      if (data?.query?.search) {
        setSearchResults(data.query.search);
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      toast.error("Failed to search Wikipedia. Check network connection.");
      console.error(err);
    } fonting: {
      setIsSearching(false);
    }
  };

  // Load Full Summary & HTML for selected article
  const handleSelectArticle = async (title: string) => {
    setIsLoadingArticle(true);
    setArticleContentHtml(null);
    try {
      // 1. Fetch Summary
      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const sumRes = await fetch(summaryUrl);
      let summaryData: WikiArticleSummary | null = null;
      if (sumRes.ok) {
        summaryData = await sumRes.json();
        setActiveArticle(summaryData);
      }

      // 2. Fetch Article HTML / Parsed sections
      const parseUrl = `https://${lang}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
        title
      )}&prop=text&format=json&origin=*&disableeditsection=true`;
      const parseRes = await fetch(parseUrl);
      const parseData = await parseRes.json();

      if (parseData?.parse?.text?.["*"]) {
        let rawHtml = parseData.parse.text["*"];
        // Clean up internal edit links and inline styling for clean reading
        rawHtml = rawHtml.replace(/<a href="\/wiki\//g, '<a target="_blank" rel="noopener noreferrer" href="https://' + lang + '.wikipedia.org/wiki/');
        setArticleContentHtml(rawHtml);
      } else if (summaryData) {
        setArticleContentHtml(`<p>${summaryData.extract}</p>`);
      }
    } catch (err) {
      toast.error("Could not load article content.");
      console.error(err);
    } finally {
      setIsLoadingArticle(false);
    }
  };

  // Toggle Save Article
  const handleToggleSaveArticle = (article: WikiArticleSummary) => {
    const isSaved = savedArticles.some((a) => a.title === article.title);
    if (isSaved) {
      setSavedArticles((prev) => prev.filter((a) => a.title !== article.title));
      toast.success("Removed from saved Wikipedia articles");
    } else {
      const newSaved: SavedWikiArticle = {
        id: "wiki_" + Date.now(),
        title: article.title,
        extract: article.extract,
        description: article.description,
        thumbnailUrl: article.thumbnail?.source,
        wikiUrl: article.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(article.title)}`,
        lang,
        savedAt: Date.now(),
      };
      setSavedArticles((prev) => [newSaved, ...prev]);
      toast.success("Article saved to your Wikipedia Research Hub!");
    }
  };

  // Convert & Export Wikipedia Article to Kora Ebook Library (.txt)
  const handleExportToKoraLibrary = async (article: WikiArticleSummary) => {
    const toastId = toast.loading("Converting Wikipedia article to Kora Ebook...");
    try {
      const bookId = "wiki_book_" + Date.now();
      const contentText = `${article.title.toUpperCase()}\n${article.description ? "Subtitle: " + article.description + "\n" : ""}\nSource: Wikipedia (${lang})\nDate Added: ${new Date().toLocaleDateString()}\n\n---\nSUMMARY\n---\n${article.extract}\n\n---\nARTICLE CONTENT\n---\n${
        articleContentHtml ? articleContentHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") : article.extract
      }`;

      // Create Blob file
      const blob = new Blob([contentText], { type: "text/plain;charset=utf-8" });
      const file = new File([blob], `${article.title.replace(/[^a-zA-Z0-9_\-]/g, "_")}.txt`, { type: "text/plain" });

      // Save to IndexedDB (bookId, blob, fileName, extension)
      const fileName = `${article.title.replace(/[^a-zA-Z0-9_\-]/g, "_")}.txt`;
      await storeBookFile(bookId, blob, fileName, "txt");

      // Create Metadata matching BookMetadata interface
      const metadata: BookMetadata = {
        id: bookId,
        title: article.title,
        author: "Wikipedia",
        filename: fileName,
        extension: "txt",
        size: `${Math.round(blob.size / 1024)} KB`,
        dateAdded: Date.now(),
        coverUrl: article.thumbnail?.source || undefined,
        description: article.description || article.extract.slice(0, 150) + "...",
        tags: ["Wikipedia", "Reference", "Research"],
        status: "to-read",
        progress: {
          percent: 0,
          lastReadTime: Date.now(),
        },
      };

      if (userId) {
        await syncBookToCloud(userId, metadata);
      } else {
        const localLib = JSON.parse(localStorage.getItem("kora_local_library") || "[]");
        localStorage.setItem("kora_local_library", JSON.stringify([metadata, ...localLib]));
      }

      toast.success(`"${article.title}" saved to your Kora Library!`, { id: toastId });
      if (onRefreshLibrary) onRefreshLibrary();
    } catch (err) {
      toast.error("Failed to export article to library.", { id: toastId });
      console.error(err);
    }
  };

  // Read Aloud / Speech Synthesis
  const handleToggleSpeech = (text: string) => {
    if (!('speechSynthesis' in window)) {
      toast.error("Speech synthesis is not supported in this browser.");
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const cleanText = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const utterance = new SpeechSynthesisUtterance(cleanText.slice(0, 1500));
    utterance.lang = lang;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  const isCurrentArticleSaved = activeArticle ? savedArticles.some((a) => a.title === activeArticle.title) : false;

  return (
    <div className="bg-kindle-bg text-kindle-text border-0 rounded-none overflow-hidden shadow-none flex flex-col h-full w-full max-w-none transition-all">


      {/* Top Header Bar */}
      <div className="bg-kindle-card px-6 py-4 border-b border-kindle-border flex items-center justify-between gap-4 select-none shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-xl">
            <Globe className="w-5 h-5" />
          </div>
          <div>
                      <h2 className="text-sm sm:text-base font-serif font-bold text-kindle-text">
                        Wikipedia Research Hub
                      </h2>
                      <p className="text-[10px] text-kindle-text-muted">Explore, read, and save knowledge from the free encyclopedia</p>
                    </div>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-kindle-bg border border-transparent hover:border-kindle-border rounded-xl text-kindle-text-muted hover:text-kindle-text transition cursor-pointer"
              title="Close Wikipedia Hub"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Layout: Left Sidebar + Right Article Reader */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Control Column */}
        <div className={`w-full md:w-80 border-r border-kindle-border/80 flex flex-col bg-kindle-card/50 shrink-0 overflow-y-auto ${
          activeArticle ? "hidden md:flex" : "flex"
        }`}>
          {/* Search Form */}
          <div className="p-4 border-b border-kindle-border/60 space-y-3">
            <form onSubmit={handleSearch} className="relative">
              <Search className="w-4 h-4 text-kindle-text-muted absolute left-3 top-3" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Wikipedia..."
                className="w-full bg-kindle-bg border border-kindle-border rounded-xl pl-9 pr-8 py-2 text-xs text-kindle-text focus:outline-none focus:border-kindle-accent transition"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setSearchResults([]);
                  }}
                  className="absolute right-2.5 top-2.5 text-kindle-text-muted hover:text-kindle-text"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </form>

            {/* Quick Topic Chips */}
            <div className="flex flex-wrap gap-1">
              {POPULAR_TOPICS.map((topic) => (
                <button
                  key={topic.label}
                  type="button"
                  onClick={() => {
                    setQuery(topic.query);
                    handleSearch(undefined, topic.query);
                  }}
                  className="px-2 py-0.5 bg-kindle-bg border border-kindle-border/80 hover:border-kindle-accent/50 rounded-lg text-[9px] text-kindle-text-muted hover:text-kindle-text transition cursor-pointer"
                >
                  {topic.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Navigation Buttons */}
          <div className="grid grid-cols-3 border-b border-kindle-border/60 p-1 bg-kindle-bg/50">
            <button
              type="button"
              onClick={() => setActiveTab("featured")}
              className={`py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition cursor-pointer flex items-center justify-center gap-1 ${
                activeTab === "featured"
                  ? "bg-kindle-card text-kindle-accent shadow-xs border border-kindle-border"
                  : "text-kindle-text-muted hover:text-kindle-text"
              }`}
            >
              <Sparkles className="w-3 h-3" /> Explore
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("search")}
              className={`py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition cursor-pointer flex items-center justify-center gap-1 ${
                activeTab === "search"
                  ? "bg-kindle-card text-kindle-accent shadow-xs border border-kindle-border"
                  : "text-kindle-text-muted hover:text-kindle-text"
              }`}
            >
              <Search className="w-3 h-3" /> Results ({searchResults.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("saved")}
              className={`py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition cursor-pointer flex items-center justify-center gap-1 ${
                activeTab === "saved"
                  ? "bg-kindle-card text-kindle-accent shadow-xs border border-kindle-border"
                  : "text-kindle-text-muted hover:text-kindle-text"
              }`}
            >
              <Bookmark className="w-3 h-3" /> Saved ({savedArticles.length})
            </button>
          </div>

          {/* Left Column Content View */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {/* EXPLORE / FEATURED TAB */}
            {activeTab === "featured" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pt-1 px-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">Random Article</span>
                  <button
                    type="button"
                    onClick={fetchRandomArticle}
                    disabled={isLoadingFeatured}
                    className="text-[10px] font-bold text-kindle-accent hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCw className={`w-3 h-3 ${isLoadingFeatured ? "animate-spin" : ""}`} /> Shuffle
                  </button>
                </div>

                {isLoadingFeatured ? (
                  <div className="p-8 text-center space-y-2">
                    <div className="w-5 h-5 border-2 border-kindle-accent border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-[10px] text-kindle-text-muted font-mono">Fetching knowledge...</p>
                  </div>
                ) : featuredArticle ? (
                  <div
                    onClick={() => handleSelectArticle(featuredArticle.title)}
                    className="p-3.5 bg-kindle-card border border-kindle-border rounded-2xl hover:border-kindle-accent/60 transition cursor-pointer space-y-2 group"
                  >
                    {featuredArticle.thumbnail && (
                      <div className="h-28 rounded-xl overflow-hidden bg-black/5 relative">
                        <img
                          src={featuredArticle.thumbnail.source}
                          alt={featuredArticle.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                      </div>
                    )}
                    <h3 className="text-xs font-bold font-serif text-kindle-text group-hover:text-kindle-accent transition">
                      {featuredArticle.title}
                    </h3>
                    <p className="text-[10px] text-kindle-text-muted line-clamp-3 leading-relaxed">{featuredArticle.extract}</p>
                    <div className="text-[9px] font-bold text-kindle-accent uppercase tracking-wider flex items-center gap-1 pt-1">
                      Read Article <ChevronRight className="w-3 h-3" />
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* SEARCH RESULTS TAB */}
            {activeTab === "search" && (
              <div className="space-y-2">
                {isSearching ? (
                  <div className="p-8 text-center space-y-2">
                    <div className="w-5 h-5 border-2 border-kindle-accent border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-[10px] text-kindle-text-muted font-mono">Searching Wikipedia...</p>
                  </div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((item) => (
                    <div
                      key={item.pageid || item.title}
                      onClick={() => handleSelectArticle(item.title)}
                      className={`p-3 rounded-xl border transition cursor-pointer text-left space-y-1 ${
                        activeArticle?.title === item.title
                          ? "bg-kindle-accent/10 border-kindle-accent/60 ring-1 ring-kindle-accent/30"
                          : "bg-kindle-card border-kindle-border hover:border-kindle-accent/40"
                      }`}
                    >
                      <h4 className="text-xs font-bold text-kindle-text line-clamp-1">{item.title}</h4>
                      <div
                        className="text-[10px] text-kindle-text-muted line-clamp-2 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: item.snippet }}
                      />
                      <span className="text-[8px] font-mono text-kindle-text-muted/80 block pt-0.5">
                        {item.wordcount ? `${item.wordcount.toLocaleString()} words` : "Wikipedia page"}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-kindle-text-muted text-xs space-y-2">
                    <Search className="w-6 h-6 mx-auto opacity-40" />
                    <p>No search results yet.</p>
                    <p className="text-[10px]">Type a keyword above to query Wikipedia.</p>
                  </div>
                )}
              </div>
            )}

            {/* SAVED ARTICLES TAB */}
            {activeTab === "saved" && (
              <div className="space-y-2">
                {savedArticles.length > 0 ? (
                  savedArticles.map((saved) => (
                    <div
                      key={saved.id}
                      onClick={() => handleSelectArticle(saved.title)}
                      className={`p-3 rounded-xl border transition cursor-pointer text-left space-y-1 relative group ${
                        activeArticle?.title === saved.title
                          ? "bg-kindle-accent/10 border-kindle-accent/60 ring-1 ring-kindle-accent/30"
                          : "bg-kindle-card border-kindle-border hover:border-kindle-accent/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-bold text-kindle-text line-clamp-1">{saved.title}</h4>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSavedArticles((prev) => prev.filter((a) => a.id !== saved.id));
                            toast.success("Removed from saved articles");
                          }}
                          className="text-red-500 hover:text-red-700 p-1 opacity-0 group-hover:opacity-100 transition"
                          title="Remove saved article"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[10px] text-kindle-text-muted line-clamp-2 leading-relaxed">{saved.extract}</p>
                      <span className="text-[8px] font-mono text-kindle-text-muted block pt-1">
                        Saved {new Date(saved.savedAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-kindle-text-muted text-xs space-y-2">
                    <Bookmark className="w-6 h-6 mx-auto opacity-40" />
                    <p>No saved articles.</p>
                    <p className="text-[10px]">Bookmark any Wikipedia article to save it here for quick reference.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Article Reader Area */}
        <div className={`flex-1 flex flex-col bg-kindle-bg overflow-hidden relative ${
          activeArticle ? "flex" : "hidden md:flex"
        }`}>
          {isLoadingArticle ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-3 p-8">
              <div className="w-8 h-8 border-3 border-kindle-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-kindle-text-muted font-mono uppercase tracking-widest font-bold">
                Loading Wikipedia Article...
              </p>
            </div>
          ) : activeArticle ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Article Reader Action Bar */}
              <div className="p-3.5 px-6 bg-kindle-card/80 border-b border-kindle-border flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveArticle(null)}
                    className="md:hidden p-1.5 rounded-lg border border-kindle-border text-kindle-text hover:bg-kindle-card transition cursor-pointer"
                    title="Back to browse"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-kindle-accent">
                    Wikipedia Reader
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Speech TTS */}
                  <button
                    type="button"
                    onClick={() => handleToggleSpeech(activeArticle.extract)}
                    className={`p-2 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      isSpeaking
                        ? "bg-red-500/10 border-red-500 text-red-600"
                        : "bg-kindle-bg border-kindle-border text-kindle-text hover:bg-kindle-card"
                    }`}
                    title={isSpeaking ? "Stop Voice Reader" : "Listen to Summary"}
                  >
                    {isSpeaking ? <VolumeX className="w-3.5 h-3.5 animate-pulse" /> : <Volume2 className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{isSpeaking ? "Stop" : "Listen"}</span>
                  </button>

                  {/* Font Toggle */}
                  <button
                    type="button"
                    onClick={() => setUseSerifFont(!useSerifFont)}
                    className={`p-2 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                      useSerifFont ? "bg-kindle-bg border-kindle-border text-kindle-text" : "bg-kindle-card border-kindle-accent text-kindle-accent"
                    }`}
                    title="Toggle Serif/Sans Font"
                  >
                    <Type className="w-3.5 h-3.5" />
                  </button>

                  {/* Bookmark Button */}
                  <button
                    type="button"
                    onClick={() => handleToggleSaveArticle(activeArticle)}
                    className={`p-2 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      isCurrentArticleSaved
                        ? "bg-amber-500/15 border-amber-500/50 text-amber-600"
                        : "bg-kindle-bg border-kindle-border text-kindle-text hover:bg-kindle-card"
                    }`}
                    title={isCurrentArticleSaved ? "Saved in Hub" : "Save Article"}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${isCurrentArticleSaved ? "fill-amber-600 text-amber-600" : ""}`} />
                    <span className="hidden sm:inline">{isCurrentArticleSaved ? "Saved" : "Save"}</span>
                  </button>

                  {/* Convert to Kora Library Book */}
                  <button
                    type="button"
                    onClick={() => handleExportToKoraLibrary(activeArticle)}
                    className="p-2 px-3 rounded-xl bg-kindle-accent text-white font-bold text-xs hover:bg-kindle-accent/90 transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                    title="Save as Ebook in Kora Library"
                  >
                    <BookMarked className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Add to Library</span>
                  </button>

                  {/* External Link */}
                  {activeArticle.content_urls?.desktop?.page && (
                    <a
                      href={activeArticle.content_urls.desktop.page}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-xl border border-kindle-border text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-card transition"
                      title="Open in Wikipedia.org"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {/* Scrollable Reader Body */}
              <div className="flex-1 overflow-y-auto p-6 sm:p-10 space-y-6 max-w-3xl mx-auto w-full">
                {/* Cover & Title Header */}
                <div className="space-y-3 pb-6 border-b border-kindle-border">
                  {activeArticle.thumbnail && (
                    <div className="max-h-60 rounded-2xl overflow-hidden bg-black/5 border border-kindle-border shadow-xs max-w-md">
                      <img
                        src={activeArticle.thumbnail.source}
                        alt={activeArticle.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <h1 className={`text-2xl sm:text-3xl font-bold text-kindle-text ${useSerifFont ? "font-serif" : "font-sans"}`}>
                    {activeArticle.title}
                  </h1>

                  {activeArticle.description && (
                    <p className="text-xs sm:text-sm text-kindle-text-muted italic">{activeArticle.description}</p>
                  )}
                </div>

                {/* Article Extract Summary Box */}
                <div className="p-4 bg-kindle-card border border-kindle-border rounded-2xl space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-kindle-accent flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> Executive Summary
                  </div>
                  <p className={`text-xs sm:text-sm text-kindle-text leading-relaxed ${useSerifFont ? "font-serif" : "font-sans"}`}>
                    {activeArticle.extract}
                  </p>
                </div>

                {/* Parsed Article HTML Body */}
                {articleContentHtml && (
                  <div
                    className={`prose max-w-none text-xs sm:text-sm text-kindle-text leading-relaxed space-y-4 ${
                      useSerifFont ? "font-serif" : "font-sans"
                    }`}
                    dangerouslySetInnerHTML={{ __html: articleContentHtml }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4 max-w-md mx-auto">
              <div className="p-4 bg-kindle-card border border-kindle-border rounded-full text-kindle-accent shadow-xs">
                <Globe className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-serif font-bold text-kindle-text">Welcome to Wikipedia Hub</h3>
                <p className="text-xs text-kindle-text-muted leading-relaxed">
                  Search any article on Wikipedia, read with customizable typography, listen to audio summaries, or convert articles directly into Kora Ebooks!
                </p>
              </div>
              <button
                type="button"
                onClick={fetchRandomArticle}
                className="px-4 py-2 bg-kindle-card border border-kindle-border hover:border-kindle-accent/50 rounded-xl text-xs font-bold text-kindle-text transition cursor-pointer flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-kindle-accent" /> Discover Random Knowledge
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
