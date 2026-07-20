import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen,
  Headphones,
  Compass,
  Rss,
  ChevronRight,
  Sparkles,
  Play,
  ArrowRight,
} from "lucide-react";
import { BookMetadata } from "../lib/firebase";
import { getFeedItems } from "../lib/feedStorage";
import { resolveCoverImageSrc } from "../lib/coverImage";
import {
  loadLoungeModes,
  saveLoungeMode,
  type LoungeWidgetId,
} from "../lib/loungePrefs";
import Quote from "./Quote";
import LoungeGuidesWidget from "./LoungeGuidesWidget";
import type { GuideId } from "../lib/guides";

interface LoungeViewProps {
  books: BookMetadata[];
  lastReadBook: BookMetadata | null;
  userNickname?: string;
  grayscaleCovers?: boolean;
  onOpenBook: (book: BookMetadata) => void;
  onOpenTab: (tab: "library" | "discover" | "feed") => void;
  onSearchDiscover?: (query: string) => void;
  onStartGuide?: (id: GuideId) => void;
}

type FeaturedBook = {
  title: string;
  author?: string;
  coverUrl?: string;
  rank?: number | string;
};

function isAudiobook(book: BookMetadata) {
  return book.extension?.toLowerCase() === "audiobook";
}

function sortByRecent(books: BookMetadata[]) {
  return [...books].sort((a, b) => {
    const ta = a.progress?.lastReadTime || a.dateModified || a.dateAdded || 0;
    const tb = b.progress?.lastReadTime || b.dateModified || b.dateAdded || 0;
    return tb - ta;
  });
}

function loadFeaturedFromCache(): FeaturedBook[] {
  try {
    const raw = localStorage.getItem("kora_discover_featured_cache");
    if (!raw) return [];
    const data = JSON.parse(raw) as Record<string, any[]>;
    const pooled: FeaturedBook[] = [];
    for (const list of Object.values(data || {})) {
      if (!Array.isArray(list)) continue;
      for (const book of list.slice(0, 8)) {
        if (!book?.title) continue;
        pooled.push({
          title: book.title,
          author: book.author,
          coverUrl: book.coverUrl || book.book_image || book.image,
          rank: book.rank || book.bestsellerRank,
        });
      }
    }
    // Dedupe by title
    const seen = new Set<string>();
    return pooled.filter((b) => {
      const key = b.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
  } catch {
    return [];
  }
}

function ModeSwitch({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-kindle-bg/80 border border-kindle-border/60">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider transition ${
            value === opt.id
              ? "bg-kindle-text text-kindle-bg"
              : "text-kindle-text-muted hover:text-kindle-text"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function CoverStack({
  books,
  grayscale,
}: {
  books: { title: string; coverUrl?: string }[];
  grayscale?: boolean;
}) {
  const shown = books.slice(0, 3);
  if (!shown.length) {
    return (
      <div className="w-20 h-28 rounded-xl bg-kindle-card border border-kindle-border flex items-center justify-center">
        <BookOpen className="w-6 h-6 text-kindle-text-muted opacity-40" />
      </div>
    );
  }
  return (
    <div className="relative w-28 h-32">
      {shown.map((book, i) => (
        <div
          key={`${book.title}-${i}`}
          className="absolute w-20 h-28 rounded-xl overflow-hidden border border-kindle-border shadow-md bg-kindle-card"
          style={{
            left: i * 14,
            top: (2 - i) * 4,
            zIndex: shown.length - i,
            transform: `rotate(${(i - 1) * 4}deg)`,
          }}
        >
          {book.coverUrl ? (
            <img
              src={resolveCoverImageSrc(book.coverUrl) || book.coverUrl}
              alt=""
              className={`w-full h-full object-cover ${grayscale ? "grayscale" : ""}`}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center p-2 text-center">
              <span className="text-[8px] font-bold uppercase tracking-wide text-kindle-text-muted line-clamp-4">
                {book.title}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function LoungeView({
  books,
  lastReadBook,
  userNickname,
  grayscaleCovers = false,
  onOpenBook,
  onOpenTab,
  onSearchDiscover,
  onStartGuide,
}: LoungeViewProps) {
  const [modes, setModes] = useState(loadLoungeModes);
  const [featured, setFeatured] = useState<FeaturedBook[]>([]);
  const [feedTick, setFeedTick] = useState(0);

  useEffect(() => {
    setFeatured(loadFeaturedFromCache());
  }, []);

  useEffect(() => {
    const refresh = () => setFeedTick((n) => n + 1);
    window.addEventListener("storage", refresh);
    const id = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("storage", refresh);
      window.clearInterval(id);
    };
  }, []);

  const setMode = (id: LoungeWidgetId, mode: string) => {
    saveLoungeMode(id, mode);
    setModes((prev) => ({ ...prev, [id]: mode }));
  };

  const recentBooks = useMemo(
    () => sortByRecent(books.filter((b) => !isAudiobook(b))).slice(0, 8),
    [books]
  );
  const recentAudio = useMemo(
    () => sortByRecent(books.filter(isAudiobook)).slice(0, 8),
    [books]
  );
  const continueBook = useMemo(() => {
    if (modes.continue === "audio") {
      return (
        recentAudio.find((b) => b.id === lastReadBook?.id) ||
        recentAudio[0] ||
        (lastReadBook && isAudiobook(lastReadBook) ? lastReadBook : null)
      );
    }
    return (
      recentBooks.find((b) => b.id === lastReadBook?.id) ||
      (lastReadBook && !isAudiobook(lastReadBook) ? lastReadBook : null) ||
      recentBooks[0] ||
      null
    );
  }, [modes.continue, recentBooks, recentAudio, lastReadBook]);

  const shelfItems = modes.shelf === "audio" ? recentAudio : recentBooks;

  const newsItems = useMemo(() => {
    void feedTick;
    const items = getFeedItems()
      .slice()
      .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    if (modes.paper === "unread") return items.filter((i) => !i.read).slice(0, 6);
    if (modes.paper === "saved") return items.filter((i) => i.saved).slice(0, 6);
    return items.slice(0, 6);
  }, [modes.paper, feedTick]);

  const discoverItems = useMemo(() => {
    if (modes.discover === "audiobooks") {
      return recentAudio.slice(0, 6).map((b) => ({
        title: b.title,
        author: b.author,
        coverUrl: b.coverUrl,
      }));
    }
    return featured.slice(0, 6);
  }, [modes.discover, featured, recentAudio]);

  const greeting = userNickname?.trim()
    ? `Welcome back, ${userNickname.trim()}`
    : "Your Lounge";

  return (
    <div className="space-y-6 md:space-y-8 pb-6 md:pb-10">
      <header className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-kindle-accent">
          Lounge
        </p>
        <h2 className="text-3xl md:text-4xl font-lexend font-bold tracking-tight text-kindle-text">
          {greeting}
        </h2>
        <p className="text-sm text-kindle-text-muted max-w-xl leading-relaxed">
          Pick up where you left off — books, listens, discoveries, and the paper.
        </p>
      </header>

      <LoungeGuidesWidget onStartGuide={onStartGuide} />

      {/* Continue — hero widget */}
      <section className="relative overflow-hidden rounded-3xl border border-kindle-border bg-gradient-to-br from-kindle-card via-kindle-bg to-kindle-card min-h-[220px]">
        <div className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 20% 0%, color-mix(in srgb, var(--kindle-accent) 18%, transparent), transparent 55%), radial-gradient(ellipse at 100% 100%, color-mix(in srgb, var(--kindle-accent) 10%, transparent), transparent 45%)",
          }}
        />
        <div className="relative p-5 md:p-7 flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-kindle-text">
              <Sparkles className="w-4 h-4 text-kindle-accent" />
              <h3 className="text-xs font-bold uppercase tracking-[0.2em]">Continue</h3>
            </div>
            <ModeSwitch
              value={modes.continue}
              onChange={(m) => setMode("continue", m)}
              options={[
                { id: "book", label: "Book" },
                { id: "audio", label: "Listen" },
              ]}
            />
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={`${modes.continue}-${continueBook?.id || "empty"}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28 }}
              className="flex items-center gap-5"
            >
              {continueBook ? (
                <>
                  <button
                    type="button"
                    onClick={() => onOpenBook(continueBook)}
                    className="shrink-0 w-24 h-36 rounded-2xl overflow-hidden border border-kindle-border shadow-lg bg-kindle-card"
                  >
                    {continueBook.coverUrl ? (
                      <img
                        src={resolveCoverImageSrc(continueBook.coverUrl) || continueBook.coverUrl}
                        alt=""
                        className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {isAudiobook(continueBook) ? (
                          <Headphones className="w-8 h-8 text-kindle-text-muted" />
                        ) : (
                          <BookOpen className="w-8 h-8 text-kindle-text-muted" />
                        )}
                      </div>
                    )}
                  </button>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted mb-1">
                        {isAudiobook(continueBook) ? "Audiobook" : "Reading"} ·{" "}
                        {Math.round(continueBook.progress?.percent || 0)}%
                      </p>
                      <h4 className="text-xl md:text-2xl font-lexend font-bold text-kindle-text leading-tight line-clamp-2">
                        {continueBook.title}
                      </h4>
                      <p className="text-sm text-kindle-text-muted mt-1 truncate">
                        {continueBook.author || "Unknown"}
                      </p>
                    </div>
                    <div className="h-1.5 rounded-full bg-kindle-border overflow-hidden max-w-xs">
                      <div
                        className="h-full bg-kindle-accent rounded-full transition-all"
                        style={{ width: `${Math.min(100, continueBook.progress?.percent || 0)}%` }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenBook(continueBook)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[11px] font-bold uppercase tracking-widest hover:bg-kindle-accent transition"
                    >
                      {isAudiobook(continueBook) ? (
                        <><Play className="w-3.5 h-3.5 fill-current" /> Resume listening</>
                      ) : (
                        <><BookOpen className="w-3.5 h-3.5" /> Resume reading</>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="py-4 space-y-3">
                  <p className="text-sm text-kindle-text-muted">
                    Nothing in progress yet. Find something on Discover.
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenTab("discover")}
                    className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-kindle-accent hover:underline"
                  >
                    Browse Discover <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {/* Shelf + Discover bento */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        {/* Shelf */}
        <section className="rounded-3xl border border-kindle-border bg-kindle-card/60 p-5 flex flex-col min-h-[240px]">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-kindle-accent" />
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-kindle-text">Shelf</h3>
            </div>
            <ModeSwitch
              value={modes.shelf}
              onChange={(m) => setMode("shelf", m)}
              options={[
                { id: "books", label: "Books" },
                { id: "audio", label: "Audio" },
              ]}
            />
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={modes.shelf}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.22 }}
              className="flex-1 flex flex-col"
            >
              {shelfItems.length ? (
                <>
                  <div className="flex items-end gap-4 mb-4">
                    <CoverStack
                      books={shelfItems}
                      grayscale={grayscaleCovers}
                    />
                    <div className="min-w-0 pb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                        Recent {modes.shelf === "audio" ? "listens" : "reads"}
                      </p>
                      <p className="text-sm font-bold text-kindle-text line-clamp-2 mt-1">
                        {shelfItems[0]?.title}
                      </p>
                    </div>
                  </div>
                  <ul className="space-y-2 flex-1">
                    {shelfItems.slice(0, 4).map((book) => (
                      <li key={book.id}>
                        <button
                          type="button"
                          onClick={() => onOpenBook(book)}
                          className="w-full text-left flex items-center gap-2 group"
                        >
                          <span className="text-xs text-kindle-text truncate group-hover:text-kindle-accent transition flex-1">
                            {book.title}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-kindle-text-muted opacity-0 group-hover:opacity-100 transition" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-kindle-text-muted py-6">
                  Your {modes.shelf === "audio" ? "audiobooks" : "books"} will appear here.
                </p>
              )}
              <button
                type="button"
                onClick={() => onOpenTab("library")}
                className="mt-4 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition self-start"
              >
                Open library →
              </button>
            </motion.div>
          </AnimatePresence>
        </section>

        {/* Discover */}
        <section className="rounded-3xl border border-kindle-border bg-gradient-to-b from-kindle-card to-kindle-bg p-5 flex flex-col min-h-[240px]">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-kindle-accent" />
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-kindle-text">Discover</h3>
            </div>
            <ModeSwitch
              value={modes.discover}
              onChange={(m) => setMode("discover", m)}
              options={[
                { id: "trending", label: "Trending" },
                { id: "audiobooks", label: "Audio" },
              ]}
            />
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={modes.discover}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.22 }}
              className="flex-1"
            >
              {discoverItems.length ? (
                <div className="grid grid-cols-3 gap-2.5">
                  {discoverItems.slice(0, 6).map((book, i) => (
                    <button
                      key={`${book.title}-${i}`}
                      type="button"
                      onClick={() => {
                        if (onSearchDiscover) onSearchDiscover(book.title);
                        else onOpenTab("discover");
                      }}
                      className="group text-left space-y-1.5"
                    >
                      <div className="aspect-[2/3] rounded-xl overflow-hidden border border-kindle-border bg-kindle-card shadow-sm group-hover:border-kindle-accent/40 transition">
                        {book.coverUrl ? (
                          <img
                            src={resolveCoverImageSrc(book.coverUrl) || book.coverUrl}
                            alt=""
                            className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center p-1">
                            <span className="text-[7px] font-bold uppercase text-kindle-text-muted text-center line-clamp-4">
                              {book.title}
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] font-bold text-kindle-text line-clamp-2 leading-snug">
                        {book.title}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center space-y-2">
                  <Compass className="w-8 h-8 mx-auto text-kindle-text-muted opacity-30" />
                  <p className="text-sm text-kindle-text-muted">
                    Open Discover once to fill trending picks.
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <button
            type="button"
            onClick={() => onOpenTab("discover")}
            className="mt-4 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition self-start"
          >
            Explore discover →
          </button>
        </section>
      </div>

      {/* Morning paper */}
      <section className="rounded-3xl border border-kindle-border overflow-hidden">
        <div className="px-5 pt-5 pb-3 flex items-center justify-between gap-3 bg-kindle-card/80">
          <div className="flex items-center gap-2">
            <Rss className="w-4 h-4 text-kindle-accent" />
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-kindle-text">
              The paper
            </h3>
          </div>
          <ModeSwitch
            value={modes.paper}
            onChange={(m) => setMode("paper", m)}
            options={[
              { id: "latest", label: "Latest" },
              { id: "unread", label: "Unread" },
              { id: "saved", label: "Saved" },
            ]}
          />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={modes.paper}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="divide-y divide-kindle-border/60 bg-kindle-bg/40"
          >
            {newsItems.length ? (
              newsItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenTab("feed")}
                  className="w-full text-left px-5 py-3.5 hover:bg-kindle-card/50 transition flex gap-3"
                >
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="w-14 h-14 rounded-lg object-cover border border-kindle-border shrink-0"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-kindle-card border border-kindle-border flex items-center justify-center shrink-0">
                      <Rss className="w-4 h-4 text-kindle-text-muted opacity-40" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted mb-0.5">
                      {item.subscriptionTitle}
                      {!item.read && (
                        <span className="ml-2 text-kindle-accent">New</span>
                      )}
                    </p>
                    <p className="text-sm font-bold text-kindle-text line-clamp-2 leading-snug">
                      {item.title}
                    </p>
                  </div>
                </button>
              ))
            ) : (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-kindle-text-muted mb-2">No headlines yet.</p>
                <button
                  type="button"
                  onClick={() => onOpenTab("feed")}
                  className="text-[10px] font-bold uppercase tracking-widest text-kindle-accent hover:underline"
                >
                  Open the paper →
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </section>

      {/* Quote */}
      <section className="rounded-3xl border border-kindle-border bg-kindle-card/40 px-4 py-2 overflow-hidden">
        <Quote />
      </section>
    </div>
  );
}
