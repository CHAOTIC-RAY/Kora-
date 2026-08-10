import React, { useState, useEffect } from "react";
import {
  Feather,
  Heart,
  MessageSquare,
  Eye,
  Globe,
  Sparkles,
  Send,
  X,
  ChevronRight,
  BookOpen,
  Share2,
  Plus,
  ArrowLeft,
  Loader2,
  Bookmark,
  Check,
} from "lucide-react";
import {
  CommunityBook,
  CommunityComment,
  getCommunityBooks,
  getCommunityComments,
  addCommunityComment,
  likeCommunityBook,
  isCommunityBookLikedByUser,
  incrementCommunityBookReads,
  BookMetadata,
} from "../lib/firebase";
import { toast } from "react-hot-toast";

interface CommunityStoriesHubProps {
  userId: string;
  onOpenCreateView?: () => void;
  onImportToLibrary?: (book: BookMetadata) => void;
}

const GENRES = [
  "all",
  "Fantasy",
  "Romance",
  "Sci-Fi",
  "Mystery",
  "Young Adult",
  "Fanfiction",
  "General Fiction",
  "Poetry",
  "Adventure",
];

export default function CommunityStoriesHub({
  userId,
  onOpenCreateView,
  onImportToLibrary,
}: CommunityStoriesHubProps) {
  const [selectedGenre, setSelectedGenre] = useState<string>("all");
  const [books, setBooks] = useState<CommunityBook[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Active book detail modal
  const [activeBook, setActiveBook] = useState<CommunityBook | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [commentText, setCommentText] = useState<string>("");
  const [loadingComments, setLoadingComments] = useState<boolean>(false);
  const [submittingComment, setSubmittingComment] = useState<boolean>(false);

  // Active reader view
  const [readingBook, setReadingBook] = useState<CommunityBook | null>(null);
  const [activeChapterIndex, setActiveChapterIndex] = useState<number>(0);

  // User liked state tracking
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [likeCountMap, setLikeCountMap] = useState<Record<string, number>>({});
  const [isLiking, setIsLiking] = useState<boolean>(false);

  // Import to library success tracker
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const fetched = await getCommunityBooks(selectedGenre);
        setBooks(fetched);

        // Populate initial counts and likes
        const countMap: Record<string, number> = {};
        const lMap: Record<string, boolean> = {};

        for (const b of fetched) {
          countMap[b.id] = b.likesCount || 0;
          if (userId) {
            const userLiked = await isCommunityBookLikedByUser(b.id, userId);
            lMap[b.id] = userLiked;
          }
        }
        setLikeCountMap(countMap);
        setLikedMap(lMap);
      } catch (err) {
        console.warn("[CommunityStoriesHub] Error loading books:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [selectedGenre, userId]);

  // Load comments when active book opens
  useEffect(() => {
    if (activeBook) {
      async function loadBookComments() {
        setLoadingComments(true);
        try {
          const c = await getCommunityComments(activeBook!.id);
          setComments(c);
        } catch (err) {
          console.warn("[CommunityStoriesHub] Error loading comments:", err);
        } finally {
          setLoadingComments(false);
        }
      }
      loadBookComments();
    }
  }, [activeBook]);

  // Handle Like Action
  const handleLike = async (e: React.MouseEvent, book: CommunityBook) => {
    e.stopPropagation();
    if (isLiking) return;

    const currentLiked = likedMap[book.id] || false;
    const currentCount = likeCountMap[book.id] ?? (book.likesCount || 0);

    // Optimistic UI update
    setLikedMap((prev) => ({ ...prev, [book.id]: !currentLiked }));
    setLikeCountMap((prev) => ({
      ...prev,
      [book.id]: currentLiked ? Math.max(0, currentCount - 1) : currentCount + 1,
    }));

    try {
      setIsLiking(true);
      const res = await likeCommunityBook(book.id, userId || "user_anon");
      setLikedMap((prev) => ({ ...prev, [book.id]: res.liked }));
      setLikeCountMap((prev) => ({ ...prev, [book.id]: res.likesCount }));
    } catch (err) {
      console.error("[CommunityStoriesHub] Like error:", err);
      // Revert optimism on error
      setLikedMap((prev) => ({ ...prev, [book.id]: currentLiked }));
      setLikeCountMap((prev) => ({ ...prev, [book.id]: currentCount }));
    } finally {
      setIsLiking(false);
    }
  };

  // Submit comment
  const handleSubmitComment = async () => {
    if (!activeBook || !commentText.trim() || submittingComment) return;

    try {
      setSubmittingComment(true);
      const newC = await addCommunityComment(
        activeBook.id,
        { uid: userId || "user_anon", displayName: "Community Reader" },
        commentText.trim()
      );
      setComments((prev) => [newC, ...prev]);
      setCommentText("");
      // Update comment count on active book
      setActiveBook((prev) =>
        prev ? { ...prev, commentsCount: (prev.commentsCount || 0) + 1 } : null
      );
      setBooks((prev) =>
        prev.map((b) =>
          b.id === activeBook.id
            ? { ...b, commentsCount: (b.commentsCount || 0) + 1 }
            : b
        )
      );
    } catch (err) {
      console.error("[CommunityStoriesHub] Comment submission failed:", err);
    } finally {
      setSubmittingComment(false);
    }
  };

  // Open Reader
  const handleOpenReader = (book: CommunityBook) => {
    setReadingBook(book);
    setActiveChapterIndex(0);
    // Increment read count in background
    incrementCommunityBookReads(book.id).catch(() => {});
  };

  // Import to Library
  const handleImport = (e: React.MouseEvent, book: CommunityBook) => {
    e.stopPropagation();
    if (!onImportToLibrary) return;

    const importedBook: BookMetadata = {
      id: `comm_lib_${book.id}`,
      title: book.title,
      author: book.author,
      description: book.description,
      size: "1.2 MB",
      extension: "epub",
      tags: ["community", book.genre.toLowerCase()],
      coverUrl: book.coverUrl,
      status: "to-read",
      dateAdded: Date.now(),
      progress: { percent: 0, lastReadTime: Date.now() },
    };

    onImportToLibrary(importedBook);
    setImportedIds((prev) => new Set(prev).add(book.id));
  };

  return (
    <div className="space-y-6">
      {/* Kora Community Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-purple-500/15 border border-amber-500/20 p-6 md:p-8 shadow-xs">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              Kora Community Hub
            </div>
            <h2 className="text-2xl md:text-3xl font-lexend font-extrabold text-kindle-text tracking-tight">
              Community Web Stories & Novels
            </h2>
            <p className="text-xs md:text-sm text-kindle-text-muted leading-relaxed">
              Explore original web novels, fantasy epics, romance, fanfiction, and poetry published directly by readers & authors in our global community.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {onOpenCreateView && (
              <button
                type="button"
                onClick={onOpenCreateView}
                className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-xs shadow-lg hover:brightness-110 transition cursor-pointer flex items-center gap-2"
              >
                <Feather className="w-4 h-4" />
                Write & Publish Story
              </button>
            )}
          </div>
        </div>

        {/* Decorative background feather glow */}
        <div className="absolute -bottom-10 -right-10 opacity-10 pointer-events-none text-amber-500">
          <Feather className="w-64 h-64" />
        </div>
      </div>

      {/* Genre Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
        {GENRES.map((genre) => (
          <button
            key={genre}
            type="button"
            onClick={() => setSelectedGenre(genre)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold capitalize transition cursor-pointer whitespace-nowrap ${
              selectedGenre === genre
                ? "bg-amber-500 text-white shadow-xs"
                : "bg-kindle-card border border-kindle-border text-kindle-text-muted hover:text-kindle-text"
            }`}
          >
            {genre === "all" ? "✨ All Genres" : genre}
          </button>
        ))}
      </div>

      {/* Books Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse space-y-2.5">
              <div className="aspect-[2/3] bg-kindle-card rounded-2xl border border-kindle-border" />
              <div className="h-3 bg-kindle-card rounded w-3/4" />
              <div className="h-2 bg-kindle-card rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : books.length === 0 ? (
        <div className="py-16 text-center space-y-3 bg-kindle-card/50 border border-kindle-border/60 rounded-3xl p-8">
          <Feather className="w-10 h-10 text-amber-500/50 mx-auto" />
          <p className="text-sm font-bold text-kindle-text">
            No community stories in "{selectedGenre}" yet
          </p>
          <p className="text-xs text-kindle-text-muted max-w-sm mx-auto">
            Be the first author to publish a story in this genre! Click write & publish to share your original work.
          </p>
          {onOpenCreateView && (
            <button
              type="button"
              onClick={onOpenCreateView}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold"
            >
              <Plus className="w-4 h-4" /> Create First Story
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {books.map((book) => {
            const isLiked = likedMap[book.id] || false;
            const likesCount = likeCountMap[book.id] ?? (book.likesCount || 0);
            const isImported = importedIds.has(book.id);

            return (
              <div
                key={book.id}
                onClick={() => setActiveBook(book)}
                className="group relative bg-kindle-card border border-kindle-border/80 rounded-2xl overflow-hidden hover:border-amber-500/50 transition cursor-pointer flex flex-col shadow-xs hover:shadow-md"
              >
                {/* Cover preview */}
                <div
                  className="aspect-[2/3] w-full relative flex flex-col justify-between p-3 text-white overflow-hidden"
                  style={{
                    background: book.coverGradient || "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                  }}
                >
                  {book.coverUrl && (
                    <img
                      src={book.coverUrl}
                      alt={book.title}
                      className="absolute inset-0 w-full h-full object-cover z-0 opacity-80 group-hover:scale-105 transition duration-300"
                    />
                  )}
                  <div className="relative z-10 flex items-center justify-between gap-1">
                    <span className="px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-xs text-[9px] font-bold uppercase tracking-wider text-amber-300">
                      {book.genre}
                    </span>

                    {/* Quick Like Button */}
                    <button
                      type="button"
                      onClick={(e) => handleLike(e, book)}
                      className={`p-1.5 rounded-full backdrop-blur-md transition ${
                        isLiked
                          ? "bg-rose-500 text-white"
                          : "bg-black/40 text-white/80 hover:text-white hover:bg-black/60"
                      }`}
                      title={isLiked ? "Unlike" : "Like story"}
                    >
                      <Heart className={`w-3.5 h-3.5 ${isLiked ? "fill-white" : ""}`} />
                    </button>
                  </div>

                  {!book.coverUrl && (
                    <div className="relative z-10 my-auto text-center px-2">
                      <p className="font-serif font-bold text-xs sm:text-sm line-clamp-3 leading-tight drop-shadow-md">
                        {book.title}
                      </p>
                      <p className="text-[10px] text-amber-200/90 mt-1 italic drop-shadow-sm truncate">
                        by {book.author}
                      </p>
                    </div>
                  )}

                  {/* Read count & chapter metrics */}
                  <div className="relative z-10 flex items-center justify-between text-[10px] font-medium bg-black/50 backdrop-blur-xs px-2 py-1 rounded-lg">
                    <span className="flex items-center gap-1">
                      <Eye className="w-3 h-3 text-amber-400" />
                      {book.readsCount || 0}
                    </span>
                    <span className="flex items-center gap-1">
                      <Heart className="w-3 h-3 text-rose-400" />
                      {likesCount}
                    </span>
                    <span>
                      {book.chapters.length} Ch
                    </span>
                  </div>
                </div>

                {/* Info Footer */}
                <div className="p-3 space-y-1.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-xs text-kindle-text line-clamp-1 group-hover:text-amber-500 transition">
                      {book.title}
                    </h3>
                    <p className="text-[10px] text-kindle-text-muted line-clamp-1">
                      by {book.author}
                    </p>
                  </div>

                  <p className="text-[10px] text-kindle-text-muted/80 line-clamp-2 italic">
                    "{book.description}"
                  </p>

                  <div className="pt-2 flex items-center justify-between gap-2 border-t border-kindle-border/40 text-[10px]">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenReader(book);
                      }}
                      className="flex-1 py-1 px-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold hover:bg-amber-500/20 transition flex items-center justify-center gap-1"
                    >
                      <BookOpen className="w-3 h-3" />
                      Read
                    </button>

                    {onImportToLibrary && (
                      <button
                        type="button"
                        onClick={(e) => handleImport(e, book)}
                        disabled={isImported}
                        className={`p-1.5 rounded-lg border transition ${
                          isImported
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600"
                            : "border-kindle-border hover:bg-kindle-bg text-kindle-text-muted hover:text-kindle-text"
                        }`}
                        title={isImported ? "Added to Library" : "Save to Library"}
                      >
                        {isImported ? <Check className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Book Detail & Comments Modal */}
      {activeBook && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-kindle-card border border-kindle-border rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative space-y-5">
            <button
              type="button"
              onClick={() => setActiveBook(null)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-kindle-bg text-kindle-text-muted hover:text-kindle-text transition cursor-pointer z-10"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header info */}
            <div className="flex gap-4">
              <div
                className="w-24 h-36 rounded-xl shrink-0 p-2 flex flex-col justify-between text-white shadow-md relative overflow-hidden"
                style={{
                  background: activeBook.coverGradient || "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                }}
              >
                {activeBook.coverUrl && (
                  <img
                    src={activeBook.coverUrl}
                    alt={activeBook.title}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                <span className="relative z-10 text-[9px] font-bold bg-black/50 px-1.5 py-0.5 rounded text-amber-300 w-max">
                  {activeBook.genre}
                </span>
                {!activeBook.coverUrl && (
                  <p className="relative z-10 font-serif font-bold text-xs text-center line-clamp-3">
                    {activeBook.title}
                  </p>
                )}
              </div>

              <div className="space-y-2 flex-1">
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">
                  Community Web Novel
                </span>
                <h2 className="text-xl font-bold text-kindle-text leading-tight">
                  {activeBook.title}
                </h2>
                <p className="text-xs text-kindle-text-muted">
                  Written by <strong className="text-kindle-text">{activeBook.author}</strong>
                </p>

                <div className="flex items-center gap-3 text-xs text-kindle-text-muted font-medium pt-1">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-amber-400" /> {activeBook.readsCount || 0} reads
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="w-3.5 h-3.5 text-rose-400" /> {likeCountMap[activeBook.id] ?? (activeBook.likesCount || 0)} likes
                  </span>
                  <span>{activeBook.chapters.length} Chapters</span>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const b = activeBook;
                      setActiveBook(null);
                      handleOpenReader(b);
                    }}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-xs shadow-md hover:brightness-110 transition flex items-center gap-2 cursor-pointer"
                  >
                    <BookOpen className="w-4 h-4" /> Read Story Now
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleLike(e, activeBook)}
                    className={`p-2 rounded-xl border transition cursor-pointer ${
                      likedMap[activeBook.id]
                        ? "bg-rose-500 text-white border-rose-500"
                        : "border-kindle-border hover:bg-kindle-bg text-kindle-text"
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${likedMap[activeBook.id] ? "fill-white" : ""}`} />
                  </button>
                </div>
              </div>
            </div>

            {/* Synopsis */}
            <div className="p-3.5 bg-kindle-bg rounded-2xl border border-kindle-border/60 text-xs text-kindle-text leading-relaxed">
              <p className="font-bold text-[10px] text-kindle-text-muted uppercase tracking-wider mb-1">
                Synopsis
              </p>
              {activeBook.description}
            </div>

            {/* Chapters list */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-kindle-text uppercase tracking-wider">
                Table of Contents ({activeBook.chapters.length})
              </h4>
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
                {activeBook.chapters.map((chap, idx) => (
                  <button
                    key={chap.id || idx}
                    type="button"
                    onClick={() => {
                      const b = activeBook;
                      setActiveBook(null);
                      setReadingBook(b);
                      setActiveChapterIndex(idx);
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl bg-kindle-bg/80 hover:bg-kindle-bg border border-kindle-border/40 text-xs font-semibold text-kindle-text flex items-center justify-between transition cursor-pointer"
                  >
                    <span>{chap.title || `Chapter ${idx + 1}`}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-kindle-text-muted" />
                  </button>
                ))}
              </div>
            </div>

            {/* Comments Section */}
            <div className="space-y-3 pt-2 border-t border-kindle-border/50">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-kindle-text flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-amber-500" />
                  Reader Discussion ({comments.length})
                </h4>
              </div>

              {/* Add Comment input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmitComment()}
                  placeholder="Share your thoughts on this story..."
                  className="flex-1 px-3 py-2 rounded-xl bg-kindle-bg border border-kindle-border text-xs text-kindle-text focus:outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={handleSubmitComment}
                  disabled={submittingComment || !commentText.trim()}
                  className="px-4 py-2 rounded-xl bg-amber-500 text-white font-bold text-xs hover:brightness-110 transition disabled:opacity-50 cursor-pointer flex items-center gap-1"
                >
                  {submittingComment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Comments list */}
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {loadingComments ? (
                  <div className="text-center py-4 text-xs text-kindle-text-muted flex items-center justify-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" /> Loading thoughts...
                  </div>
                ) : comments.length === 0 ? (
                  <p className="text-xs text-kindle-text-muted italic text-center py-4">
                    No comments yet. Be the first reader to comment!
                  </p>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="p-2.5 rounded-xl bg-kindle-bg border border-kindle-border/40 text-xs space-y-1">
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="font-bold text-kindle-text">{c.userName}</span>
                        <span className="text-kindle-text-muted">{new Date(c.createdAt).toLocaleDateString()}</span>
                      </div>
                      <p className="text-kindle-text">{c.text}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Community Story Reader Modal */}
      {readingBook && (
        <div className="fixed inset-0 z-[160] bg-kindle-bg text-kindle-text flex flex-col font-serif">
          {/* Reader Bar */}
          <header className="h-14 px-4 border-b border-kindle-border bg-kindle-card flex items-center justify-between shrink-0 font-sans z-10">
            <button
              type="button"
              onClick={() => setReadingBook(null)}
              className="p-2 rounded-xl border border-kindle-border hover:bg-kindle-bg text-kindle-text-muted hover:text-kindle-text transition cursor-pointer flex items-center gap-1.5 text-xs font-bold"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Community
            </button>

            <div className="text-center min-w-0 px-2">
              <h3 className="text-xs font-bold text-kindle-text truncate max-w-xs sm:max-w-md">
                {readingBook.title}
              </h3>
              <p className="text-[10px] text-kindle-text-muted truncate">
                by {readingBook.author} • {readingBook.chapters[activeChapterIndex]?.title || `Chapter ${activeChapterIndex + 1}`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => handleLike(e, readingBook)}
                className={`p-2 rounded-xl border transition ${
                  likedMap[readingBook.id]
                    ? "bg-rose-500 text-white border-rose-500"
                    : "border-kindle-border hover:bg-kindle-bg text-kindle-text"
                }`}
              >
                <Heart className={`w-4 h-4 ${likedMap[readingBook.id] ? "fill-white" : ""}`} />
              </button>
            </div>
          </header>

          {/* Chapter Content Area */}
          <main className="flex-1 overflow-y-auto p-6 md:p-12 max-w-2xl mx-auto w-full leading-relaxed space-y-6 text-base sm:text-lg">
            <div className="font-sans border-b border-kindle-border/40 pb-4 mb-6">
              <span className="text-xs font-bold text-amber-500 uppercase tracking-widest block mb-1">
                Chapter {activeChapterIndex + 1} of {readingBook.chapters.length}
              </span>
              <h1 className="text-2xl font-extrabold text-kindle-text">
                {readingBook.chapters[activeChapterIndex]?.title || `Chapter ${activeChapterIndex + 1}`}
              </h1>
            </div>

            <div
              className="prose dark:prose-invert max-w-none text-kindle-text"
              dangerouslySetInnerHTML={{
                __html:
                  readingBook.chapters[activeChapterIndex]?.html ||
                  `<p>${readingBook.chapters[activeChapterIndex]?.text}</p>`,
              }}
            />

            {/* Chapter Navigation Footer */}
            <div className="font-sans pt-8 border-t border-kindle-border/40 flex items-center justify-between gap-4">
              <button
                type="button"
                disabled={activeChapterIndex === 0}
                onClick={() => setActiveChapterIndex((prev) => Math.max(0, prev - 1))}
                className="px-4 py-2 rounded-xl border border-kindle-border bg-kindle-card hover:bg-kindle-bg text-xs font-bold text-kindle-text disabled:opacity-40 transition cursor-pointer"
              >
                ← Previous Chapter
              </button>

              <span className="text-xs text-kindle-text-muted font-mono font-bold">
                {activeChapterIndex + 1} / {readingBook.chapters.length}
              </span>

              <button
                type="button"
                disabled={activeChapterIndex >= readingBook.chapters.length - 1}
                onClick={() => setActiveChapterIndex((prev) => Math.min(readingBook.chapters.length - 1, prev + 1))}
                className="px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:brightness-110 disabled:opacity-40 transition cursor-pointer"
              >
                Next Chapter →
              </button>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
