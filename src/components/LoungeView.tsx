import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { buildLoungeGreeting } from "../lib/loungeGreeting";
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
  kind?: "ebook" | "audiobook";
};

const CONTINUE_AUTO_FLIP_MS = 22_000;
const DISCOVER_AUTO_FLIP_MS = 12_000;
const AUTO_FLIP_TICK_MS = 1000;
const MANUAL_PAUSE_MS = 28_000;

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

function cleanAuthor(author: unknown): string | undefined {
  if (typeof author !== "string") return undefined;
  const a = author.trim();
  if (!a) return undefined;
  // Filter scraper/CTA junk that sometimes lands in author fields
  if (/^(play|listen|unknown|n\/a|null|undefined|audiobook)$/i.test(a)) return undefined;
  return a;
}

function normalizeFeaturedBook(book: any, kind?: "ebook" | "audiobook"): FeaturedBook | null {
  if (!book?.title || typeof book.title !== "string") return null;
  return {
    title: book.title.trim(),
    author: cleanAuthor(book.author),
    coverUrl: book.coverUrl || book.book_image || book.image || undefined,
    rank: book.rank || book.bestsellerRank,
    kind,
  };
}

function dedupeFeatured(items: FeaturedBook[], limit = 12): FeaturedBook[] {
  const seen = new Set<string>();
  const out: FeaturedBook[] = [];
  for (const b of items) {
    const key = b.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
    if (out.length >= limit) break;
  }
  return out;
}

function isAudiobookCacheKey(key: string) {
  const k = key.toLowerCase();
  return k.startsWith("audiobooks-") || k.includes("audiobook");
}

function loadFeaturedFromCache(opts?: { audiobooksOnly?: boolean }): FeaturedBook[] {
  try {
    const raw = localStorage.getItem("kora_discover_featured_cache");
    if (!raw) return [];
    const data = JSON.parse(raw) as Record<string, any[]>;
    const pooled: FeaturedBook[] = [];
    const audioOnly = !!opts?.audiobooksOnly;

    for (const [key, list] of Object.entries(data || {})) {
      if (!Array.isArray(list)) continue;
      const audioKey = isAudiobookCacheKey(key);
      if (audioOnly && !audioKey) continue;
      if (!audioOnly && audioKey) continue;

      for (const book of list.slice(0, audioOnly ? 12 : 8)) {
        const normalized = normalizeFeaturedBook(book, audioKey ? "audiobook" : "ebook");
        if (normalized) pooled.push(normalized);
      }
    }

    return dedupeFeatured(pooled, audioOnly ? 16 : 12);
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
    <div
      className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-black/25 border border-white/10 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange(opt.id);
          }}
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
  onClick,
  role,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  onClick?: () => void;
  role?: string;
  label?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-3xl border border-kindle-border overflow-hidden min-h-0 ${
        onClick ? "cursor-pointer" : ""
      } ${className}`}
      onClick={onClick}
      role={role || (onClick ? "button" : undefined)}
      tabIndex={onClick ? 0 : undefined}
      aria-label={label}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
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
  const [featuredAudio, setFeaturedAudio] = useState<FeaturedBook[]>([]);
  const [feedTick, setFeedTick] = useState(0);
  const [greetingTick, setGreetingTick] = useState(0);
  const continuePauseUntil = useRef(0);
  const discoverPauseUntil = useRef(0);
  const continueLastFlipAt = useRef(Date.now());
  const discoverLastFlipAt = useRef(Date.now());

  useEffect(() => {
    setFeatured(loadFeaturedFromCache({ audiobooksOnly: false }));
    setFeaturedAudio(loadFeaturedFromCache({ audiobooksOnly: true }));
  }, []);

  useEffect(() => {
    const refresh = () => setFeedTick((n) => n + 1);
    window.addEventListener("storage", refresh);
    const id = window.setInterval(refresh, 60_000);
    const greetId = window.setInterval(() => setGreetingTick((n) => n + 1), 15 * 60_000);
    return () => {
      window.removeEventListener("storage", refresh);
      window.clearInterval(id);
      window.clearInterval(greetId);
    };
  }, []);

  const setMode = (id: LoungeWidgetId, mode: string, fromUser = false) => {
    if (fromUser) {
      if (id === "continue") {
        continuePauseUntil.current = Date.now() + MANUAL_PAUSE_MS;
        continueLastFlipAt.current = Date.now();
      }
      if (id === "discover") {
        discoverPauseUntil.current = Date.now() + MANUAL_PAUSE_MS;
        discoverLastFlipAt.current = Date.now();
      }
    }
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

  const hasContinueBook = recentBooks.length > 0 || (lastReadBook && !isAudiobook(lastReadBook));
  const hasContinueAudio =
    recentAudio.length > 0 || (lastReadBook != null && isAudiobook(lastReadBook));
  const hasDiscoverTrending = featured.length > 0;
  const hasDiscoverAudio = recentAudio.length > 0 || featuredAudio.length > 0;

  // Smooth auto flip — Continue stays longer on book/listen than Discover on trending/audio
  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      const now = Date.now();

      setModes((prev) => {
        let next = prev;
        if (
          now >= continuePauseUntil.current &&
          hasContinueBook &&
          hasContinueAudio &&
          now - continueLastFlipAt.current >= CONTINUE_AUTO_FLIP_MS
        ) {
          const flipped = prev.continue === "audio" ? "book" : "audio";
          next = { ...next, continue: flipped };
          saveLoungeMode("continue", flipped);
          continueLastFlipAt.current = now;
        }
        if (
          now >= discoverPauseUntil.current &&
          hasDiscoverTrending &&
          hasDiscoverAudio &&
          now - discoverLastFlipAt.current >= DISCOVER_AUTO_FLIP_MS
        ) {
          const flipped = prev.discover === "audiobooks" ? "trending" : "audiobooks";
          next = { ...next, discover: flipped };
          saveLoungeMode("discover", flipped);
          discoverLastFlipAt.current = now;
        }
        return next;
      });
    }, AUTO_FLIP_TICK_MS);
    return () => window.clearInterval(id);
  }, [hasContinueBook, hasContinueAudio, hasDiscoverTrending, hasDiscoverAudio]);

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
      const fromLibrary: FeaturedBook[] = recentAudio.map((b) => ({
        title: b.title,
        author: cleanAuthor(b.author),
        coverUrl: b.coverUrl,
        kind: "audiobook" as const,
      }));
      // Library first, then Discover audiobook cache (popular/fiction/etc.), fill from trending if thin
      const primary = dedupeFeatured([...fromLibrary, ...featuredAudio], 10);
      if (primary.length >= 6) return primary;
      return dedupeFeatured([...primary, ...featured.map((b) => ({ ...b, kind: "audiobook" as const }))], 10);
    }
    return featured.slice(0, 8);
  }, [modes.discover, featured, featuredAudio, recentAudio]);

  const greeting = useMemo(() => {
    void greetingTick;
    return buildLoungeGreeting({
      nickname: userNickname,
      lastReadBook,
      recentBooks: books,
    });
  }, [userNickname, lastReadBook, books, greetingTick]);

  const progress = Math.min(100, Math.round(continueBook?.progress?.percent || 0));
  const heroCover = continueBook?.coverUrl
    ? resolveCoverImageSrc(continueBook.coverUrl) || continueBook.coverUrl
    : null;
  const discoverHero = discoverItems[0];
  // Same strip length for Trending and Audio so the list UI stays consistent
  const discoverRest = discoverItems.slice(1, 7);
  const isDiscoverAudio = modes.discover === "audiobooks";
  const discoverHeroCover = discoverHero?.coverUrl
    ? resolveCoverImageSrc(discoverHero.coverUrl) || discoverHero.coverUrl
    : null;
  const continueAuthor = cleanAuthor(continueBook?.author);

  const openContinue = () => {
    if (continueBook) onOpenBook(continueBook);
    else onOpenTab("discover");
  };

  const openDiscover = () => {
    if (discoverHero && onSearchDiscover) onSearchDiscover(discoverHero.title);
    else onOpenTab("discover");
  };

  return (
    <div className="pb-6 md:pb-10 space-y-4 md:space-y-5">
      <header className="space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-kindle-accent">Lounge</p>
        <AnimatePresence mode="wait">
          <motion.h2
            key={greeting.title}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35 }}
            className="text-2xl md:text-3xl font-lexend font-bold tracking-tight text-kindle-text"
          >
            {greeting.title}
          </motion.h2>
        </AnimatePresence>
        <p className="text-sm text-kindle-text-muted max-w-xl leading-relaxed">{greeting.subtitle}</p>
      </header>

      <div className="grid gap-3 md:gap-4 grid-cols-1 md:grid-cols-2 md:grid-rows-[minmax(200px,1fr)_minmax(220px,1fr)_auto]">
        {/* Continue + shelf — left tall, whole hero opens book */}
        <TileShell
          delay={0.02}
          className="order-1 md:order-none md:col-start-1 md:row-start-1 md:row-span-2 relative bg-kindle-card"
          onClick={openContinue}
          label={continueBook ? `Continue ${continueBook.title}` : "Continue reading"}
        >
          <div className="absolute inset-0 pointer-events-none">
            {heroCover ? (
              <>
                <img
                  src={heroCover}
                  alt=""
                  className={`absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-30 ${
                    grayscaleCovers ? "grayscale" : ""
                  }`}
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-kindle-bg/50 via-kindle-bg/75 to-kindle-bg" />
              </>
            ) : (
              <div
                className="absolute inset-0 opacity-55"
                style={{
                  backgroundImage:
                    "radial-gradient(ellipse at 20% 10%, color-mix(in srgb, var(--kindle-accent) 20%, transparent), transparent 55%)",
                }}
              />
            )}
          </div>

          <div className="relative h-full flex flex-col">
            <div className="px-4 md:px-5 pt-4 flex items-center justify-between gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-kindle-accent" />
                <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text">
                  Continue
                </h3>
              </div>
              <ModeSwitch
                value={modes.continue}
                onChange={(m) => setMode("continue", m, true)}
                options={[
                  { id: "book", label: "Book" },
                  { id: "audio", label: "Listen" },
                ]}
              />
            </div>

            {/* Dense hero — large cover + tightly stacked meta */}
            <div className="flex-1 min-h-[12rem] w-full text-left px-4 md:px-5 py-3 pointer-events-none">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${modes.continue}-${continueBook?.id || "empty"}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.35 }}
                  className="h-full flex items-center gap-4 md:gap-5"
                >
                  {continueBook ? (
                    <>
                      <div className="relative shrink-0 w-[7.75rem] sm:w-[8.5rem] md:w-[9.5rem] aspect-[2/3] rounded-2xl overflow-hidden border border-white/15 shadow-[0_18px_40px_rgba(0,0,0,0.4)] bg-kindle-card ring-1 ring-white/5">
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
                        {isAudiobook(continueBook) && (
                          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-kindle-text text-kindle-bg text-[8px] font-bold uppercase tracking-wider leading-none">
                            Audio
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 flex flex-col justify-center gap-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                          {isAudiobook(continueBook) ? "Listening" : "Reading"} · {progress}%
                        </p>
                        <h4 className="text-lg md:text-2xl font-lexend font-bold text-kindle-text leading-tight line-clamp-3">
                          {continueBook.title}
                        </h4>
                        {continueAuthor && (
                          <p className="text-sm text-kindle-text-muted truncate">{continueAuthor}</p>
                        )}
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden w-full max-w-[16rem]">
                          <motion.div
                            className="h-full rounded-full bg-kindle-accent"
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                          />
                        </div>
                        <span className="mt-0.5 inline-flex w-fit items-center gap-2 px-3.5 py-2 rounded-xl bg-kindle-text text-kindle-bg text-[11px] font-bold uppercase tracking-widest shadow-lg">
                          {isAudiobook(continueBook) ? (
                            <>
                              <Play className="w-3.5 h-3.5 fill-current" /> Resume
                            </>
                          ) : (
                            <>
                              <BookOpen className="w-3.5 h-3.5" /> Resume
                            </>
                          )}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-kindle-text-muted">
                        Nothing in progress yet. Tap to find something on Discover.
                      </p>
                      <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-kindle-accent">
                        Browse Discover <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Shelf strip */}
            <div
              className="relative border-t border-white/10 bg-black/25 backdrop-blur-md px-4 md:px-5 pt-3 pb-3.5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 mb-2.5">
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
                <div className="flex gap-2.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {shelfItems.map((book, i) => {
                    const cover = book.coverUrl
                      ? resolveCoverImageSrc(book.coverUrl) || book.coverUrl
                      : null;
                    return (
                      <motion.button
                        key={book.id}
                        type="button"
                        onClick={() => onOpenBook(book)}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.03 * i, duration: 0.25 }}
                        className="group relative shrink-0 snap-start w-[3.85rem] focus:outline-none"
                        title={book.title}
                      >
                        <div className="w-full aspect-[2/3] rounded-xl overflow-hidden border border-white/10 bg-kindle-bg shadow-md transition duration-300 group-hover:-translate-y-1 group-hover:border-kindle-accent/40">
                          {cover ? (
                            <img
                              src={cover}
                              alt=""
                              className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`}
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center p-1">
                              <span className="text-[7px] font-bold uppercase text-kindle-text-muted text-center line-clamp-4">
                                {book.title}
                              </span>
                            </div>
                          )}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-kindle-text-muted py-1">Books you open will line up here.</p>
              )}
            </div>
          </div>
        </TileShell>

        {/* Paper */}
        <TileShell
          delay={0.06}
          className="order-2 md:order-none md:col-start-2 md:row-start-1 bg-kindle-card/55 flex flex-col"
          onClick={() => onOpenTab("feed")}
          label="Open news paper"
        >
          <div className="px-4 md:px-5 pt-4 pb-2 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Rss className="w-3.5 h-3.5 text-kindle-accent shrink-0" />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text truncate">
                The paper
              </h3>
            </div>
            <ModeSwitch
              value={modes.paper}
              onChange={(m) => setMode("paper", m, true)}
              options={[
                { id: "latest", label: "Latest" },
                { id: "unread", label: "Unread" },
                { id: "saved", label: "Saved" },
              ]}
            />
          </div>

          <div className="flex-1 divide-y divide-kindle-border/50 overflow-hidden">
            {newsItems.length ? (
              newsItems.map((item) => (
                <div key={item.id} className="px-4 md:px-5 py-2.5 flex gap-2.5 hover:bg-kindle-bg/40 transition">
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
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-sm text-kindle-text-muted">No headlines yet.</div>
            )}
          </div>
        </TileShell>

        {/* Discover — whole card clickable, denser featured + cover */}
        <TileShell
          delay={0.1}
          className="order-3 md:order-none md:col-start-2 md:row-start-2 relative bg-kindle-bg"
          onClick={openDiscover}
          label="Open Discover"
        >
          <div className="absolute inset-0 pointer-events-none">
            {discoverHeroCover ? (
              <>
                <img
                  src={discoverHeroCover}
                  alt=""
                  className={`absolute inset-0 w-full h-full object-cover opacity-35 ${
                    grayscaleCovers ? "grayscale" : ""
                  }`}
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-kindle-bg via-kindle-bg/80 to-kindle-bg/35" />
                <div className="absolute inset-0 bg-gradient-to-r from-kindle-bg/95 via-kindle-bg/55 to-kindle-bg/20" />
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

          <div className="relative h-full p-4 md:p-5 flex flex-col gap-3 min-h-[220px]">
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <Compass className="w-3.5 h-3.5 text-kindle-accent" />
                <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text">
                  Discover
                </h3>
              </div>
              <ModeSwitch
                value={modes.discover}
                onChange={(m) => setMode("discover", m, true)}
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
                transition={{ duration: 0.3 }}
                className="flex-1 flex flex-col gap-3 min-h-0"
              >
                {discoverHero ? (
                  <>
                    <div className="flex items-start gap-3.5 shrink-0">
                      <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-kindle-accent">
                          {isDiscoverAudio ? "Featured listen" : "Featured"}
                        </p>
                        <h4 className="text-lg md:text-xl font-lexend font-bold text-kindle-text leading-tight line-clamp-3">
                          {discoverHero.title}
                        </h4>
                        {discoverHero.author ? (
                          <p className="text-xs text-kindle-text-muted truncate">{discoverHero.author}</p>
                        ) : isDiscoverAudio ? (
                          <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                            Audiobook
                          </p>
                        ) : null}
                      </div>
                      {discoverHeroCover && (
                        <div className="relative shrink-0 w-[5.5rem] md:w-[6.25rem] aspect-[2/3] rounded-xl overflow-hidden border border-white/15 shadow-xl">
                          <img
                            src={discoverHeroCover}
                            alt=""
                            className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`}
                            referrerPolicy="no-referrer"
                          />
                          {isDiscoverAudio && (
                            <span className="absolute top-1.5 right-1.5 px-1 py-0.5 rounded bg-kindle-text text-kindle-bg text-[7px] font-bold uppercase tracking-wider leading-none">
                              Audio
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {discoverRest.length > 0 && (
                      <div
                        className="mt-auto flex gap-2.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
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
                              className="relative shrink-0 w-[3.35rem] aspect-[2/3] rounded-lg overflow-hidden border border-white/10 bg-kindle-card shadow-md hover:border-kindle-accent/50 hover:-translate-y-0.5 transition"
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
                  <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
                    <Compass className="w-7 h-7 text-kindle-text-muted opacity-30" />
                    <p className="text-xs text-kindle-text-muted">
                      {isDiscoverAudio
                        ? "Open Discover → Audio to fill listens here"
                        : "Tap to explore Discover"}
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
              {isDiscoverAudio ? "Explore audiobooks →" : "Explore discover →"}
            </p>
          </div>
        </TileShell>

        <TileShell
          delay={0.14}
          className="order-4 md:order-none md:col-span-2 bg-kindle-card/60 p-3 md:p-4"
        >
          <LoungeGuidesWidget onStartGuide={onStartGuide} variant="bento" />
        </TileShell>
      </div>
    </div>
  );
}
