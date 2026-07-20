import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  BookOpen,
  Headphones,
  Compass,
  Rss,
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
    const seen = new Set<string>();
    return pooled
      .filter((b) => {
        const key = b.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12);
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
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-black/20 border border-white/10 backdrop-blur-sm">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider transition ${
            value === opt.id
              ? "bg-kindle-text text-kindle-bg shadow-sm"
              : "text-kindle-text-muted hover:text-kindle-text"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function TileShell({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-3xl border border-kindle-border overflow-hidden min-h-0 ${className}`}
    >
      {children}
    </motion.section>
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
    () => sortByRecent(books.filter((b) => !isAudiobook(b))).slice(0, 10),
    [books]
  );
  const recentAudio = useMemo(
    () => sortByRecent(books.filter(isAudiobook)).slice(0, 10),
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

  /** Shelf strip follows continue mode (books vs audio), excluding the active continue title when possible */
  const shelfItems = useMemo(() => {
    const pool = modes.continue === "audio" ? recentAudio : recentBooks;
    const rest = continueBook ? pool.filter((b) => b.id !== continueBook.id) : pool;
    return (rest.length ? rest : pool).slice(0, 7);
  }, [modes.continue, recentBooks, recentAudio, continueBook]);

  const newsItems = useMemo(() => {
    void feedTick;
    const items = getFeedItems()
      .slice()
      .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    if (modes.paper === "unread") return items.filter((i) => !i.read).slice(0, 4);
    if (modes.paper === "saved") return items.filter((i) => i.saved).slice(0, 4);
    return items.slice(0, 4);
  }, [modes.paper, feedTick]);

  const discoverItems = useMemo(() => {
    if (modes.discover === "audiobooks") {
      return recentAudio.slice(0, 5).map((b) => ({
        title: b.title,
        author: b.author,
        coverUrl: b.coverUrl,
      }));
    }
    return featured.slice(0, 5);
  }, [modes.discover, featured, recentAudio]);

  const greeting = userNickname?.trim()
    ? `Welcome back, ${userNickname.trim()}`
    : "Your Lounge";

  const progress = Math.min(100, Math.round(continueBook?.progress?.percent || 0));
  const heroCover = continueBook?.coverUrl
    ? resolveCoverImageSrc(continueBook.coverUrl) || continueBook.coverUrl
    : null;
  const discoverHero = discoverItems[0];
  const discoverRest = discoverItems.slice(1, 5);

  return (
    <div className="pb-6 md:pb-10 space-y-5 md:space-y-6">
      <header className="space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-kindle-accent">Lounge</p>
        <h2 className="text-2xl md:text-3xl font-lexend font-bold tracking-tight text-kindle-text">
          {greeting}
        </h2>
        <p className="text-sm text-kindle-text-muted max-w-xl leading-relaxed">
          Pick up where you left off — shelf, paper, and what&apos;s next.
        </p>
      </header>

      {/*
        Bento:
          Continue+Shelf (tall left) | Paper
          Continue+Shelf             | Discover
          Guide (full width)
      */}
      <div className="grid gap-3 md:gap-4 grid-cols-1 md:grid-cols-2 md:grid-rows-[minmax(220px,1.05fr)_minmax(240px,1fr)_auto]">
        {/* Continue + integrated Shelf — LEFT, tall */}
        <TileShell
          delay={0.02}
          className="order-1 md:order-none md:col-start-1 md:row-start-1 md:row-span-2 relative min-h-[420px] md:min-h-0 bg-kindle-card"
        >
          {/* Atmosphere from cover */}
          <div className="absolute inset-0 pointer-events-none">
            {heroCover ? (
              <>
                <img
                  src={heroCover}
                  alt=""
                  className={`absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-35 ${
                    grayscaleCovers ? "grayscale" : ""
                  }`}
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-kindle-bg/55 via-kindle-bg/80 to-kindle-bg" />
              </>
            ) : (
              <div
                className="absolute inset-0 opacity-60"
                style={{
                  backgroundImage:
                    "radial-gradient(ellipse at 20% 10%, color-mix(in srgb, var(--kindle-accent) 20%, transparent), transparent 55%), radial-gradient(ellipse at 90% 90%, color-mix(in srgb, var(--kindle-accent) 10%, transparent), transparent 50%)",
                }}
              />
            )}
          </div>

          <div className="relative h-full flex flex-col">
            {/* Continue hero */}
            <div className="p-4 md:p-5 flex flex-col gap-4 flex-1 min-h-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-kindle-accent" />
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text">
                    Continue
                  </h3>
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
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.28 }}
                  className="flex-1 flex flex-col sm:flex-row items-center sm:items-end gap-4 md:gap-5 min-h-0"
                >
                  {continueBook ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpenBook(continueBook)}
                        className="shrink-0 w-[7.25rem] h-[10.75rem] md:w-32 md:h-48 rounded-2xl overflow-hidden border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.45)] bg-kindle-card ring-1 ring-white/5"
                      >
                        {heroCover ? (
                          <img
                            src={heroCover}
                            alt=""
                            className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-kindle-bg">
                            {isAudiobook(continueBook) ? (
                              <Headphones className="w-9 h-9 text-kindle-text-muted" />
                            ) : (
                              <BookOpen className="w-9 h-9 text-kindle-text-muted" />
                            )}
                          </div>
                        )}
                      </button>

                      <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left pb-1">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted mb-1">
                            {isAudiobook(continueBook) ? "Listening" : "Reading"} · {progress}%
                          </p>
                          <h4 className="text-xl md:text-2xl font-lexend font-bold text-kindle-text leading-tight line-clamp-3">
                            {continueBook.title}
                          </h4>
                          <p className="text-sm text-kindle-text-muted mt-1 truncate">
                            {continueBook.author || "Unknown"}
                          </p>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden max-w-[16rem] mx-auto sm:mx-0">
                          <motion.div
                            className="h-full rounded-full bg-kindle-accent"
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenBook(continueBook)}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[11px] font-bold uppercase tracking-widest hover:bg-kindle-accent transition shadow-lg"
                        >
                          {isAudiobook(continueBook) ? (
                            <>
                              <Play className="w-3.5 h-3.5 fill-current" /> Resume
                            </>
                          ) : (
                            <>
                              <BookOpen className="w-3.5 h-3.5" /> Resume
                            </>
                          )}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="py-8 space-y-3 text-center sm:text-left w-full">
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

            {/* Integrated shelf strip */}
            <div className="relative border-t border-white/10 bg-black/25 backdrop-blur-md px-4 md:px-5 pt-3.5 pb-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-3.5 h-3.5 text-kindle-accent" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text">
                    On your shelf
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenTab("library")}
                  className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition"
                >
                  Library →
                </button>
              </div>

              {shelfItems.length ? (
                <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {shelfItems.map((book, i) => {
                    const cover = book.coverUrl
                      ? resolveCoverImageSrc(book.coverUrl) || book.coverUrl
                      : null;
                    return (
                      <motion.button
                        key={book.id}
                        type="button"
                        onClick={() => onOpenBook(book)}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.04 * i, duration: 0.3 }}
                        className="group relative shrink-0 snap-start w-[4.25rem] focus:outline-none"
                        title={book.title}
                      >
                        <div
                          className="w-full aspect-[2/3] rounded-xl overflow-hidden border border-white/10 bg-kindle-bg shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition duration-300 group-hover:-translate-y-1 group-hover:border-kindle-accent/40 group-hover:shadow-[0_14px_28px_rgba(0,0,0,0.45)]"
                        >
                          {cover ? (
                            <img
                              src={cover}
                              alt=""
                              className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`}
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center p-1.5">
                              <span className="text-[7px] font-bold uppercase text-kindle-text-muted text-center line-clamp-5">
                                {book.title}
                              </span>
                            </div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition" />
                        </div>
                        <p className="mt-1.5 text-[9px] font-semibold text-kindle-text-muted line-clamp-2 leading-tight group-hover:text-kindle-text transition">
                          {book.title}
                        </p>
                      </motion.button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-kindle-text-muted py-2">
                  Books you open will line up here.
                </p>
              )}
            </div>
          </div>
        </TileShell>

        {/* Paper — top right */}
        <TileShell
          delay={0.08}
          className="order-2 md:order-none md:col-start-2 md:row-start-1 bg-kindle-card/55 flex flex-col min-h-[220px]"
        >
          <div className="px-4 md:px-5 pt-4 md:pt-5 pb-2 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Rss className="w-3.5 h-3.5 text-kindle-accent shrink-0" />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text truncate">
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
              className="flex-1 divide-y divide-kindle-border/50 overflow-hidden"
            >
              {newsItems.length ? (
                newsItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenTab("feed")}
                    className="w-full text-left px-4 md:px-5 py-2.5 hover:bg-kindle-bg/55 transition flex gap-2.5"
                  >
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="w-11 h-11 rounded-lg object-cover border border-kindle-border shrink-0"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-lg bg-kindle-bg border border-kindle-border flex items-center justify-center shrink-0">
                        <Rss className="w-3.5 h-3.5 text-kindle-text-muted opacity-40" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted mb-0.5 truncate">
                        {item.subscriptionTitle}
                        {!item.read && <span className="ml-1.5 text-kindle-accent">New</span>}
                      </p>
                      <p className="text-[13px] font-bold text-kindle-text line-clamp-2 leading-snug">
                        {item.title}
                      </p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-5 py-8 text-center">
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
        </TileShell>

        {/* Discover — aesthetic feature tile, bottom right */}
        <TileShell
          delay={0.12}
          className="order-3 md:order-none md:col-start-2 md:row-start-2 relative min-h-[260px] bg-kindle-bg"
        >
          <div className="absolute inset-0 pointer-events-none">
            {discoverHero?.coverUrl ? (
              <>
                <img
                  src={resolveCoverImageSrc(discoverHero.coverUrl) || discoverHero.coverUrl}
                  alt=""
                  className={`absolute inset-0 w-full h-full object-cover opacity-40 ${
                    grayscaleCovers ? "grayscale" : ""
                  }`}
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-kindle-bg via-kindle-bg/85 to-kindle-bg/40" />
                <div className="absolute inset-0 bg-gradient-to-r from-kindle-bg/90 via-kindle-bg/50 to-transparent" />
              </>
            ) : (
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "radial-gradient(ellipse at 80% 20%, color-mix(in srgb, var(--kindle-accent) 16%, transparent), transparent 50%)",
                }}
              />
            )}
          </div>

          <div className="relative h-full p-4 md:p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Compass className="w-3.5 h-3.5 text-kindle-accent" />
                <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text">
                  Discover
                </h3>
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
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex-1 flex flex-col min-h-0"
              >
                {discoverHero ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        if (onSearchDiscover) onSearchDiscover(discoverHero.title);
                        else onOpenTab("discover");
                      }}
                      className="text-left group mb-3"
                    >
                      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-kindle-accent mb-1">
                        Featured
                      </p>
                      <h4 className="text-lg md:text-xl font-lexend font-bold text-kindle-text leading-tight line-clamp-2 group-hover:text-kindle-accent transition">
                        {discoverHero.title}
                      </h4>
                      {discoverHero.author && (
                        <p className="text-xs text-kindle-text-muted mt-1 truncate">
                          {discoverHero.author}
                        </p>
                      )}
                    </button>

                    {discoverRest.length > 0 && (
                      <div className="mt-auto flex gap-2.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {discoverRest.map((book, i) => {
                          const cover = book.coverUrl
                            ? resolveCoverImageSrc(book.coverUrl) || book.coverUrl
                            : null;
                          return (
                            <button
                              key={`${book.title}-${i}`}
                              type="button"
                              onClick={() => {
                                if (onSearchDiscover) onSearchDiscover(book.title);
                                else onOpenTab("discover");
                              }}
                              className="shrink-0 w-[3.35rem] aspect-[2/3] rounded-lg overflow-hidden border border-white/10 bg-kindle-card shadow-md hover:border-kindle-accent/50 hover:-translate-y-0.5 transition"
                              title={book.title}
                            >
                              {cover ? (
                                <img
                                  src={cover}
                                  alt=""
                                  className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`}
                                  referrerPolicy="no-referrer"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center p-1">
                                  <span className="text-[6px] font-bold uppercase text-kindle-text-muted text-center line-clamp-4">
                                    {book.title}
                                  </span>
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-6">
                    <Compass className="w-8 h-8 text-kindle-text-muted opacity-30" />
                    <p className="text-xs text-kindle-text-muted max-w-[16rem]">
                      Open Discover once to fill trending picks here.
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <button
              type="button"
              onClick={() => onOpenTab("discover")}
              className="self-start text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition"
            >
              Explore discover →
            </button>
          </div>
        </TileShell>

        {/* Guide — full width bottom */}
        <TileShell
          delay={0.16}
          className="order-4 md:order-none md:col-span-2 bg-kindle-card/60 p-3 md:p-4 min-h-[140px]"
        >
          <LoungeGuidesWidget onStartGuide={onStartGuide} variant="bento" />
        </TileShell>
      </div>
    </div>
  );
}
