import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
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
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-kindle-bg/70 border border-kindle-border/50">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition ${
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
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-3xl border border-kindle-border overflow-hidden min-h-0 ${className}`}
    >
      {children}
    </motion.section>
  );
}

function TileHeader({
  icon: Icon,
  title,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-3.5 h-3.5 text-kindle-accent shrink-0" />
        <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text truncate">
          {title}
        </h3>
      </div>
      {action}
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
    if (modes.paper === "unread") return items.filter((i) => !i.read).slice(0, 4);
    if (modes.paper === "saved") return items.filter((i) => i.saved).slice(0, 4);
    return items.slice(0, 4);
  }, [modes.paper, feedTick]);

  const discoverItems = useMemo(() => {
    if (modes.discover === "audiobooks") {
      return recentAudio.slice(0, 4).map((b) => ({
        title: b.title,
        author: b.author,
        coverUrl: b.coverUrl,
      }));
    }
    return featured.slice(0, 4);
  }, [modes.discover, featured, recentAudio]);

  const greeting = userNickname?.trim()
    ? `Welcome back, ${userNickname.trim()}`
    : "Your Lounge";

  const progress = Math.min(100, Math.round(continueBook?.progress?.percent || 0));

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
        Bento (md+):
          Shelf    | Continue (tall)
          Paper    | Continue
          Discover | Guide
        Mobile: Continue → Shelf → Paper → Discover → Guide
      */}
      <div
        className="
          grid gap-3 md:gap-4
          grid-cols-1
          md:grid-cols-2 md:grid-rows-[minmax(200px,1fr)_minmax(200px,1fr)_minmax(180px,auto)]
          md:auto-rows-fr
        "
      >
        {/* Continue — tall right column on desktop, first on mobile */}
        <TileShell
          delay={0.02}
          className="
            order-1 md:order-none
            md:col-start-2 md:row-start-1 md:row-span-2
            relative bg-gradient-to-br from-kindle-card via-kindle-bg to-kindle-card
            min-h-[280px] md:min-h-0
          "
        >
          <div
            className="absolute inset-0 opacity-50 pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 15% 0%, color-mix(in srgb, var(--kindle-accent) 22%, transparent), transparent 55%), radial-gradient(ellipse at 100% 100%, color-mix(in srgb, var(--kindle-accent) 12%, transparent), transparent 50%)",
            }}
          />
          <div className="relative h-full p-4 md:p-5 flex flex-col gap-4">
            <TileHeader
              icon={Sparkles}
              title="Continue"
              action={
                <ModeSwitch
                  value={modes.continue}
                  onChange={(m) => setMode("continue", m)}
                  options={[
                    { id: "book", label: "Book" },
                    { id: "audio", label: "Listen" },
                  ]}
                />
              }
            />

            <AnimatePresence mode="wait">
              <motion.div
                key={`${modes.continue}-${continueBook?.id || "empty"}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className="flex-1 flex flex-col md:justify-center gap-4 min-h-0"
              >
                {continueBook ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpenBook(continueBook)}
                      className="mx-auto md:mx-0 shrink-0 w-[7.5rem] h-[11rem] md:w-36 md:h-[13.5rem] rounded-2xl overflow-hidden border border-kindle-border shadow-xl bg-kindle-card self-center md:self-start"
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
                            <Headphones className="w-9 h-9 text-kindle-text-muted" />
                          ) : (
                            <BookOpen className="w-9 h-9 text-kindle-text-muted" />
                          )}
                        </div>
                      )}
                    </button>

                    <div className="min-w-0 space-y-3 text-center md:text-left">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted mb-1">
                          {isAudiobook(continueBook) ? "Audiobook" : "Reading"} · {progress}%
                        </p>
                        <h4 className="text-lg md:text-xl font-lexend font-bold text-kindle-text leading-tight line-clamp-3">
                          {continueBook.title}
                        </h4>
                        <p className="text-sm text-kindle-text-muted mt-1 truncate">
                          {continueBook.author || "Unknown"}
                        </p>
                      </div>
                      <div className="h-1.5 rounded-full bg-kindle-border/80 overflow-hidden mx-auto md:mx-0 max-w-[14rem]">
                        <div
                          className="h-full bg-kindle-accent rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenBook(continueBook)}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[11px] font-bold uppercase tracking-widest hover:bg-kindle-accent transition"
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
                  <div className="py-6 space-y-3 text-center md:text-left">
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
        </TileShell>

        {/* Shelf — top left */}
        <TileShell
          delay={0.06}
          className="order-2 md:order-none md:col-start-1 md:row-start-1 bg-kindle-card/70 p-4 md:p-5 flex flex-col gap-3"
        >
          <TileHeader
            icon={BookOpen}
            title="Shelf"
            action={
              <ModeSwitch
                value={modes.shelf}
                onChange={(m) => setMode("shelf", m)}
                options={[
                  { id: "books", label: "Books" },
                  { id: "audio", label: "Audio" },
                ]}
              />
            }
          />

          <AnimatePresence mode="wait">
            <motion.div
              key={modes.shelf}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col min-h-0"
            >
              {shelfItems.length ? (
                <>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 scrollbar-none">
                    {shelfItems.slice(0, 5).map((book) => (
                      <button
                        key={book.id}
                        type="button"
                        onClick={() => onOpenBook(book)}
                        className="shrink-0 w-14 h-[5.25rem] rounded-xl overflow-hidden border border-kindle-border bg-kindle-bg shadow-sm hover:border-kindle-accent/40 transition"
                        title={book.title}
                      >
                        {book.coverUrl ? (
                          <img
                            src={resolveCoverImageSrc(book.coverUrl) || book.coverUrl}
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
                      </button>
                    ))}
                  </div>
                  <ul className="mt-3 space-y-1.5 flex-1 min-h-0 overflow-hidden">
                    {shelfItems.slice(0, 3).map((book) => (
                      <li key={`row-${book.id}`}>
                        <button
                          type="button"
                          onClick={() => onOpenBook(book)}
                          className="w-full text-left flex items-center gap-2 group py-0.5"
                        >
                          <span className="text-xs text-kindle-text truncate group-hover:text-kindle-accent transition flex-1">
                            {book.title}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-kindle-text-muted opacity-0 group-hover:opacity-100 transition shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-kindle-text-muted py-4">
                  Your {modes.shelf === "audio" ? "audiobooks" : "books"} will appear here.
                </p>
              )}
              <button
                type="button"
                onClick={() => onOpenTab("library")}
                className="mt-auto pt-2 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition self-start"
              >
                Open library →
              </button>
            </motion.div>
          </AnimatePresence>
        </TileShell>

        {/* The Paper — bottom left of top block */}
        <TileShell
          delay={0.1}
          className="order-3 md:order-none md:col-start-1 md:row-start-2 bg-kindle-card/50 flex flex-col min-h-[220px]"
        >
          <div className="px-4 md:px-5 pt-4 md:pt-5 pb-2 flex items-center justify-between gap-2 shrink-0">
            <TileHeader
              icon={Rss}
              title="The paper"
              action={
                <ModeSwitch
                  value={modes.paper}
                  onChange={(m) => setMode("paper", m)}
                  options={[
                    { id: "latest", label: "Latest" },
                    { id: "unread", label: "Unread" },
                    { id: "saved", label: "Saved" },
                  ]}
                />
              }
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
                    className="w-full text-left px-4 md:px-5 py-2.5 hover:bg-kindle-bg/60 transition flex gap-2.5"
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

        {/* Discover — bottom left */}
        <TileShell
          delay={0.14}
          className="order-4 md:order-none md:col-start-1 md:row-start-3 bg-gradient-to-b from-kindle-card to-kindle-bg p-4 md:p-5 flex flex-col gap-3"
        >
          <TileHeader
            icon={Compass}
            title="Discover"
            action={
              <ModeSwitch
                value={modes.discover}
                onChange={(m) => setMode("discover", m)}
                options={[
                  { id: "trending", label: "Trending" },
                  { id: "audiobooks", label: "Audio" },
                ]}
              />
            }
          />

          <AnimatePresence mode="wait">
            <motion.div
              key={modes.discover}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 6 }}
              transition={{ duration: 0.2 }}
              className="flex-1"
            >
              {discoverItems.length ? (
                <div className="grid grid-cols-4 gap-2">
                  {discoverItems.map((book, i) => (
                    <button
                      key={`${book.title}-${i}`}
                      type="button"
                      onClick={() => {
                        if (onSearchDiscover) onSearchDiscover(book.title);
                        else onOpenTab("discover");
                      }}
                      className="group text-left space-y-1"
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
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center space-y-2">
                  <Compass className="w-7 h-7 mx-auto text-kindle-text-muted opacity-30" />
                  <p className="text-xs text-kindle-text-muted">Open Discover to fill trending picks.</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <button
            type="button"
            onClick={() => onOpenTab("discover")}
            className="mt-auto text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition self-start"
          >
            Explore →
          </button>
        </TileShell>

        {/* Guide — bottom right under Continue */}
        <TileShell
          delay={0.18}
          className="order-5 md:order-none md:col-start-2 md:row-start-3 bg-kindle-card/60 p-3 md:p-4 flex flex-col min-h-[160px]"
        >
          <LoungeGuidesWidget onStartGuide={onStartGuide} variant="bento" />
        </TileShell>
      </div>
    </div>
  );
}
