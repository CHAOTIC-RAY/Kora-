import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAndroidBackLayer } from "../hooks/useAndroidBackLayer";
import {
  Bookmark,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Newspaper,
  RefreshCw,
  Rss,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { motion, useMotionValue, useTransform, animate } from "motion/react";
import type { BookMetadata } from "../lib/firebase";
import {
  addFeedSubscription,
  ensureDefaultSubscriptions,
  FeedItem,
  FeedSubscription,
  getFeedItems,
  isCuratedFeedUrl,
  isDefaultFeedUrl,
  isFeedItemSaved,
  isFeedSubscriptionEnabled,
  isInternationalFeedUrl,
  markFeedItemRead,
  markFeedItemSavedForLater,
  mergeFeedItems,
  removeFeedSubscription,
  saveFeedSubscriptions,
  setFeedSubscriptionEnabled,
} from "../lib/feedStorage";
import { discoverFeed, refreshAllSubscriptions } from "../lib/feedClient";
import { isFeedItemWithinRetention } from "../lib/feedNormalize";
import { getItemThumbnail, prefetchFeedPreviews } from "../lib/feedPreview";
import { textDirection } from "../lib/textDirection";
import FeedArticleReader from "./FeedArticleReader";
import NewsInBriefPanel from "./NewsInBriefPanel";
import TodayNewsBriefCard from "./TodayNewsBriefCard";

interface FeedViewProps {
  userId?: string;
  onRefreshLibrary?: () => void | Promise<void>;
  onOpenBook?: (book: BookMetadata) => void;
  initialUrl?: string | null;
  onClearInitialUrl?: () => void;
}

type FeedFilter = "all" | "unread" | "saved" | "briefs";
/** Only two card sizes: full-width hero + half-width tile. */
type BentoVariant = "featured" | "default";

function SourceToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
        on ? "bg-kindle-accent" : "bg-kindle-accent/25"
      }`}
      aria-pressed={on}
      aria-label={on ? "Turn source off" : "Turn source on"}
    >
      <div
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transition-transform ${
          on ? "translate-x-5 bg-kindle-bg" : "translate-x-0 bg-kindle-text/70"
        }`}
      />
    </button>
  );
}

function formatFeedDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function displayTitle(item: FeedItem): string {
  const title = item.title.trim();
  if (title && !/^(article url|comments url|link|untitled)$/i.test(title)) return title;
  try {
    const host = new URL(item.link).hostname.replace(/^www\./, "");
    return host || title;
  } catch {
    return title;
  }
}

function getBentoVariant(index: number): BentoVariant {
  // Hero every 5th card (starting at 0); everything else is a half-width tile.
  return index % 5 === 0 ? "featured" : "default";
}

const FeedArticleCard = React.memo(function FeedArticleCard({
  item,
  cover,
  title,
  variant,
  onRead,
  onToggleRead,
  onSaveLater,
}: {
  item: FeedItem;
  cover: string | null;
  title: string;
  variant: BentoVariant;
  onRead: () => void;
  onToggleRead: () => void;
  onSaveLater: () => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumb = cover && !thumbFailed;
  const dir = textDirection(title);
  const saved = isFeedItemSaved(item);

  const cardClass = variant === "featured" ? "sm:col-span-2" : "sm:col-span-1";
  const imageClass =
    variant === "featured" ? "w-full aspect-[16/9]" : "w-full aspect-[4/3]";

  const x = useMotionValue(0);
  const dragMovedRef = React.useRef(false);
  const pointerStartRef = React.useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  // Dynamic transforms for underlay action states
  const leftOpacity = useTransform(x, [0, 60], [0, 1]);
  const leftScale = useTransform(x, [0, 120], [0.85, 1.15]);

  const rightOpacity = useTransform(x, [-60, 0], [1, 0]);
  const rightScale = useTransform(x, [-120, 0], [1.15, 0.85]);

  const handleDragStart = () => {
    dragMovedRef.current = false;
  };

  const handleDrag = (_event: unknown, info: { offset: { x: number } }) => {
    if (Math.abs(info.offset.x) > 12) dragMovedRef.current = true;
  };

  const handleDragEnd = (_event: unknown, info: { offset: { x: number } }) => {
    const threshold = 100;
    if (info.offset.x > threshold) {
      animate(x, 0, { type: "spring", stiffness: 520, damping: 42 });
      onToggleRead();
      return;
    }
    if (info.offset.x < -threshold) {
      animate(x, 0, { type: "spring", stiffness: 520, damping: 42 });
      onSaveLater();
      return;
    }
    animate(x, 0, { type: "spring", stiffness: 420, damping: 36 });
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    pointerStartRef.current = { x: event.clientX, y: event.clientY, active: true };
    dragMovedRef.current = false;
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (!pointerStartRef.current.active) return;
    pointerStartRef.current.active = false;
    if (dragMovedRef.current) return;
    const dx = Math.abs(event.clientX - pointerStartRef.current.x);
    const dy = Math.abs(event.clientY - pointerStartRef.current.y);
    // Ignore scroll / swipe jitter — only treat as a tap when movement is tiny.
    if (dx > 12 || dy > 12) return;
    onRead();
  };

  return (
    <div className={`relative overflow-hidden rounded-2xl ${cardClass} h-full select-none`}>
      {/* Swipe Underlay — must stay under the card (z-0) or it paints over titles */}
      <div className="absolute inset-0 z-0 bg-kindle-bg border border-kindle-border rounded-2xl flex items-center justify-between px-6 pointer-events-none">
        {/* Left Action (swipe right) -> Mark as read */}
        <motion.div
          style={{ opacity: leftOpacity }}
          className="flex items-center gap-2 text-kindle-text font-bold text-xs"
        >
          <motion.div style={{ scale: leftScale }} className="p-1.5 rounded-full bg-kindle-card border border-kindle-border shadow-sm">
            <CheckCircle2 className="w-5 h-5 text-kindle-text" />
          </motion.div>
          <span>{item.read ? "Mark as unread" : "Mark as read"}</span>
        </motion.div>

        {/* Right Action (swipe left) -> Save */}
        <motion.div
          style={{ opacity: rightOpacity }}
          className="flex items-center gap-2 text-kindle-accent font-bold text-xs ml-auto"
        >
          <span>{saved ? "Saved" : "Save"}</span>
          <motion.div style={{ scale: rightScale }} className="p-1.5 rounded-full bg-kindle-card border border-kindle-border shadow-sm">
            <Bookmark className="w-5 h-5 text-kindle-accent" />
          </motion.div>
        </motion.div>
      </div>

      {/* Swipeable Foreground Card — z-10 keeps titles/summaries above the underlay */}
      <motion.article
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.12}
        dragMomentum={false}
        dragDirectionLock
        style={{ x, touchAction: "pan-y" }}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className={`feed-article-card relative z-10 bg-kindle-card border rounded-2xl overflow-hidden transition cursor-pointer hover:border-kindle-text/40 hover:shadow-md flex flex-col h-full touch-pan-y contain-layout ${
          item.read ? "border-kindle-border opacity-85" : "border-kindle-border shadow-sm"
        }`}
      >
        <div className="flex flex-col flex-1 min-h-0">
          <div
            className={`relative bg-kindle-bg border-b border-kindle-border overflow-hidden text-left ${imageClass}`}
          >
            {showThumb ? (
              <img
                src={cover}
                alt=""
                className="w-full h-full object-cover pointer-events-none"
                referrerPolicy="no-referrer"
                decoding="async"
                onError={() => setThumbFailed(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-kindle-bg">
                <Rss className="w-6 h-6 text-kindle-text-muted/40" />
              </div>
            )}
            {!item.read && (
              <span className="absolute top-2 left-2 w-2 h-2 rounded-full bg-kindle-text shadow-sm" />
            )}
          </div>

          <div className="flex flex-col flex-1 p-3 sm:p-4 pb-4 sm:pb-5 gap-2 sm:gap-3 min-w-0">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted truncate mb-1">
                {item.subscriptionTitle} · {formatFeedDate(item.publishedAt)}
              </p>
              <h3
                dir={dir}
                className={`font-lexend font-bold leading-snug text-kindle-text ${
                  dir === "rtl" ? "font-thaana" : ""
                } ${
                  variant === "featured" ? "text-base sm:text-lg line-clamp-3" : "text-sm line-clamp-3"
                }`}
              >
                {title}
              </h3>
              {item.summary && !/^(article url|comments url)/i.test(item.summary) && (
                <p
                  dir={textDirection(item.summary)}
                  className={`text-kindle-text-muted mt-1.5 leading-relaxed ${
                    variant === "featured" ? "text-xs line-clamp-2" : "text-[11px] line-clamp-2"
                  }`}
                >
                  {item.summary}
                </p>
              )}
            </div>

            <div
              className="flex items-center justify-center gap-1.5 mt-auto min-w-0"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={onSaveLater}
                className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border transition shrink-0 ${
                  saved
                    ? "border-kindle-text bg-kindle-text text-kindle-bg"
                    : "border-kindle-border text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-bg"
                }`}
                title={saved ? "Remove from saved" : "Save for later"}
                aria-label={saved ? "Remove from saved" : "Save for later"}
                aria-pressed={saved}
              >
                <Bookmark className="w-4 h-4 shrink-0" />
              </button>
              <button
                type="button"
                onClick={onToggleRead}
                className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-kindle-border text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-bg transition shrink-0"
                title={item.read ? "Mark as unread" : "Mark as read"}
                aria-label={item.read ? "Mark as unread" : "Mark as read"}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              </button>
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-kindle-border text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-bg transition shrink-0"
                title="Open in new tab"
                aria-label="Open in new tab"
              >
                <ExternalLink className="w-4 h-4 shrink-0" />
              </a>
            </div>

            {saved && (
              <p className="text-[9px] text-kindle-text-muted flex items-center gap-1">
                <Bookmark className="w-3 h-3" />
                Saved — find it under the Saved chip
              </p>
            )}
          </div>
        </div>
      </motion.article>
    </div>
  );
});


function FeedView({
  userId = "",
  onRefreshLibrary,
  onOpenBook,
  initialUrl,
  onClearInitialUrl,
}: FeedViewProps) {
  const [subscriptions, setSubscriptions] = useState<FeedSubscription[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showManageFeeds, setShowManageFeeds] = useState(false);
  const [addFeedUrl, setAddFeedUrl] = useState("");
  const [addFeedError, setAddFeedError] = useState<string | null>(null);
  const [addingFeed, setAddingFeed] = useState(false);
  const [readingArticle, setReadingArticle] = useState<FeedItem | null>(null);

  const dismissFeedArticle = useAndroidBackLayer(!!readingArticle, "feed-article", () => setReadingArticle(null));
  const dismissManageFeeds = useAndroidBackLayer(showManageFeeds, "feed-manage", () => setShowManageFeeds(false));

  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent).detail?.open === "feed-manage") {
        setShowManageFeeds(true);
      }
    };
    window.addEventListener("kora-guide:open", onOpen);
    return () => window.removeEventListener("kora-guide:open", onOpen);
  }, []);

  const loadLocalState = useCallback(() => {
    const subs = ensureDefaultSubscriptions();
    setSubscriptions(subs);
    setItems(getFeedItems());
  }, []);

  const enrichFeedItems = useCallback(async (merged: FeedItem[]) => {
    try {
      const withPreviews = await prefetchFeedPreviews(merged, 20);
      setItems(withPreviews);
    } catch {
      setItems(merged);
    }
  }, []);

  const refreshFeeds = useCallback(async () => {
    const subs = ensureDefaultSubscriptions();
    setSubscriptions(subs);
    const activeSubs = subs.filter(isFeedSubscriptionEnabled);
    setRefreshing(true);
    try {
      const incoming = await refreshAllSubscriptions(activeSubs);
      const merged = mergeFeedItems(incoming);
      setItems(merged);
      const fetchedIds = new Set(activeSubs.map((sub) => sub.id));
      saveFeedSubscriptions(
        subs.map((sub) =>
          fetchedIds.has(sub.id) ? { ...sub, lastFetchedAt: Date.now() } : sub
        )
      );
      void enrichFeedItems(merged);
    } catch (error) {
      console.error("Feed refresh failed:", error);
    } finally {
      setRefreshing(false);
    }
  }, [enrichFeedItems]);

  useEffect(() => {
    loadLocalState();
    const subs = ensureDefaultSubscriptions();
    const activeSubs = subs.filter(isFeedSubscriptionEnabled);
    const newestFetch = Math.max(0, ...activeSubs.map((sub) => sub.lastFetchedAt || 0));
    const hasNeverFetched = activeSubs.some((sub) => !sub.lastFetchedAt);
    // Skip network refresh when feeds were fetched recently (keeps first paint snappy),
    // but always refresh when a newly enabled source has never been fetched.
    if (!hasNeverFetched && newestFetch && Date.now() - newestFetch < 5 * 60 * 1000) {
      setItems(getFeedItems());
      return;
    }
    void refreshFeeds();
  }, [loadLocalState, refreshFeeds]);

  useEffect(() => {
    if (!initialUrl?.trim()) return;
    const url = initialUrl.trim();
    onClearInitialUrl?.();
    const syntheticItem: FeedItem = {
      id: `shared-${Date.now()}`,
      subscriptionId: "shared",
      subscriptionTitle: "Shared Link",
      title: "Shared Article",
      link: url,
      publishedAt: Date.now(),
      read: false,
    };
    setReadingArticle(syntheticItem);
  }, [initialUrl, onClearInitialUrl]);

  const enabledSubscriptions = useMemo(
    () => subscriptions.filter(isFeedSubscriptionEnabled),
    [subscriptions]
  );
  const enabledSubscriptionIds = useMemo(
    () => new Set(enabledSubscriptions.map((sub) => sub.id)),
    [enabledSubscriptions]
  );
  const unreadCount = useMemo(
    () => items.filter((item) => !item.read && enabledSubscriptionIds.has(item.subscriptionId)).length,
    [items, enabledSubscriptionIds]
  );

  const retainedItems = useMemo(
    () =>
      items.filter(
        (item) => isFeedItemWithinRetention(item) && enabledSubscriptionIds.has(item.subscriptionId)
      ),
    [items, enabledSubscriptionIds]
  );

  const visibleItems = useMemo(() => {
    return retainedItems
      .filter((item) => {
        if (filter === "briefs") return false;
        if (selectedSubscriptionId && item.subscriptionId !== selectedSubscriptionId) return false;
        if (filter === "unread" && item.read) return false;
        if (filter === "saved" && !isFeedItemSaved(item)) return false;
        return true;
      })
      .sort((a, b) => b.publishedAt - a.publishedAt);
  }, [retainedItems, filter, selectedSubscriptionId]);

  const maldivesSources = useMemo(
    () => subscriptions.filter((sub) => isDefaultFeedUrl(sub.feedUrl)),
    [subscriptions]
  );
  const internationalSources = useMemo(
    () => subscriptions.filter((sub) => isInternationalFeedUrl(sub.feedUrl)),
    [subscriptions]
  );
  const customSources = useMemo(
    () => subscriptions.filter((sub) => !isCuratedFeedUrl(sub.feedUrl)),
    [subscriptions]
  );

  const handleToggleSource = useCallback(
    async (sub: FeedSubscription) => {
      const nextEnabled = !isFeedSubscriptionEnabled(sub);
      const next = setFeedSubscriptionEnabled(sub.id, nextEnabled);
      setSubscriptions(next);
      if (selectedSubscriptionId === sub.id && !nextEnabled) {
        setSelectedSubscriptionId(null);
      }
      if (nextEnabled) {
        await refreshFeeds();
      }
    },
    [refreshFeeds, selectedSubscriptionId]
  );

  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addFeedUrl.trim()) return;
    setAddingFeed(true);
    setAddFeedError(null);
    try {
      const discovered = await discoverFeed(addFeedUrl.trim());
      addFeedSubscription({
        title: discovered.title,
        siteUrl: discovered.siteUrl,
        feedUrl: discovered.feedUrl,
      });
      setSubscriptions(ensureDefaultSubscriptions());
      setShowManageFeeds(false);
      setAddFeedUrl("");
      try {
        window.dispatchEvent(new CustomEvent("kora-guide:feed-added"));
      } catch {
        /* ignore */
      }
      await refreshFeeds();
    } catch (err) {
      setAddFeedError((err as Error).message || "Could not subscribe to this feed.");
    } finally {
      setAddingFeed(false);
    }
  };

  const handleReadArticle = (item: FeedItem) => {
    markFeedItemRead(item.id, true);
    setItems(getFeedItems());
    setReadingArticle(item);
  };

  const handleSaveLater = useCallback((item: FeedItem) => {
    const nextSaved = !isFeedItemSaved(item);
    markFeedItemSavedForLater(item.id, nextSaved);
    setItems(getFeedItems());
    if (nextSaved) {
      toast.success("Saved — find it under the Saved chip");
    } else {
      toast.success("Removed from Saved");
    }
  }, []);

  return (
    <div className="space-y-5 md:space-y-7 pb-8 md:pb-10 text-left">
      <header className="flex items-center justify-between pb-2 md:pb-3 border-b border-kindle-border font-sans gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Rss className="w-5 h-5 text-kindle-accent shrink-0" />
            <h1 className="text-3xl font-lexend font-bold tracking-tight text-kindle-text">Feed</h1>
            {unreadCount > 0 && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-kindle-text/10 text-kindle-text border border-kindle-border">
                {unreadCount} unread
              </span>
            )}
          </div>
          <p className="hidden md:block text-[10px] text-kindle-text-muted uppercase tracking-wider font-semibold font-mono mt-0.5">
            Maldives news and more — tap to read fullscreen.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            data-guide="feed-manage"
            onClick={() => setShowManageFeeds(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-kindle-border bg-kindle-card text-[10px] font-bold uppercase tracking-wider text-kindle-text hover:bg-kindle-bg transition"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Manage
          </button>
          <button
            onClick={() => void refreshFeeds()}
            disabled={refreshing}
            className="p-2 rounded-xl border border-kindle-border bg-kindle-card hover:bg-kindle-bg transition disabled:opacity-50 text-kindle-text"
            title="Refresh feeds"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {[
          { id: "all", label: "All" },
          { id: "briefs", label: "Briefs" },
          { id: "unread", label: "Unread" },
          { id: "saved", label: "Saved" },
        ].map((chip) => (
          <button
            key={chip.id}
            onClick={() => setFilter(chip.id as FeedFilter)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider border transition ${
              filter === chip.id
                ? "bg-kindle-text text-kindle-bg border-kindle-text shadow-sm"
                : "bg-kindle-bg text-kindle-text border-kindle-border hover:bg-kindle-card"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setSelectedSubscriptionId(null)}
          className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition ${
            !selectedSubscriptionId
              ? "bg-kindle-text text-kindle-bg border-kindle-text shadow-sm"
              : "bg-kindle-bg text-kindle-text border-kindle-border hover:bg-kindle-card"
          }`}
        >
          All Sources
        </button>
        {enabledSubscriptions.map((sub) => (
          <button
            key={sub.id}
            onClick={() => setSelectedSubscriptionId(sub.id)}
            className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition max-w-[10rem] truncate ${
              selectedSubscriptionId === sub.id
                ? "bg-kindle-text text-kindle-bg border-kindle-text shadow-sm"
                : "bg-kindle-bg text-kindle-text border-kindle-border hover:bg-kindle-card"
            }`}
            title={sub.title}
          >
            {sub.title}
          </button>
        ))}
      </div>

      {filter === "briefs" ? (
        <NewsInBriefPanel
          items={retainedItems}
          selectedSourceId={selectedSubscriptionId}
          onRead={handleReadArticle}
        />
      ) : refreshing && retainedItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-kindle-text-muted">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">Fetching your feeds…</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="bg-kindle-card border border-kindle-border rounded-2xl p-12 text-center">
          <Newspaper className="w-12 h-12 text-kindle-text-muted mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-lexend font-bold mb-2">
            {filter === "saved" ? "No saved articles" : "No articles here yet"}
          </h3>
          <p className="text-sm text-kindle-text-muted max-w-md mx-auto">
            {filter === "saved"
              ? "Tap Save on a story to keep it here for later. Saved stories stay in the news tab only."
              : "Add a feed source with Manage above, or share an article link to Kora from your browser."}
          </p>
        </div>
      ) : (
        <div className="space-y-4" data-guide="feed-list">
          {filter === "all" && !selectedSubscriptionId && (
            <TodayNewsBriefCard items={retainedItems} onReadArticle={handleReadArticle} />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 auto-rows-fr">
          {visibleItems.map((item, index) => {
            const cover = getItemThumbnail(item);
            const title = displayTitle(item);
            return (
              <FeedArticleCard
                key={item.id}
                item={item}
                cover={cover}
                title={title}
                variant={getBentoVariant(index)}
                onRead={() => void handleReadArticle(item)}
                onToggleRead={() => {
                  const nextRead = !item.read;
                  markFeedItemRead(item.id, nextRead);
                  setItems(getFeedItems());
                  if (nextRead) {
                    toast.success("Marked as read");
                  } else {
                    toast.success("Marked as unread");
                  }
                }}
                onSaveLater={() => handleSaveLater(item)}
              />
            );
          })}
          </div>
        </div>
      )}

      {showManageFeeds && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-lexend font-bold text-kindle-text">Manage Sources</h3>
                <p className="text-[10px] text-kindle-text-muted mt-0.5">
                  Toggle sources on or off — nothing is unsubscribed.
                </p>
              </div>
              <button onClick={() => dismissManageFeeds()} className="p-1.5 rounded-lg hover:bg-kindle-bg text-kindle-text">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {[
                { label: "Maldives", sources: maldivesSources },
                { label: "International", sources: internationalSources },
                { label: "Custom", sources: customSources },
              ].map((group) =>
                group.sources.length ? (
                  <div key={group.label} className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">
                      {group.label}
                    </h4>
                    {group.sources.map((sub) => {
                      const on = isFeedSubscriptionEnabled(sub);
                      return (
                        <div
                          key={sub.id}
                          className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-kindle-border ${
                            on ? "bg-kindle-bg/50" : "bg-kindle-bg/20 opacity-80"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-kindle-text truncate">{sub.title}</p>
                            <p className="text-[10px] text-kindle-text-muted truncate">
                              {sub.feedUrl.startsWith("kora://telegram/")
                                ? `Telegram · @${sub.feedUrl.replace(/^kora:\/\/telegram\//i, "")}`
                                : sub.siteUrl || sub.feedUrl}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {!isCuratedFeedUrl(sub.feedUrl) ? (
                              <button
                                onClick={() => {
                                  removeFeedSubscription(sub.id);
                                  loadLocalState();
                                }}
                                className="p-2 text-kindle-text-muted hover:text-red-500 transition"
                                title="Remove custom source"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : null}
                            <SourceToggle on={on} onClick={() => void handleToggleSource(sub)} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null
              )}
            </div>

            <div className="border-t border-kindle-border pt-4 space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">Add Custom Source</h4>
              <p className="text-[10px] text-kindle-text-muted">
                Paste a website or RSS link, or a public Telegram channel (@name or t.me/name).
              </p>
              <form onSubmit={handleAddSubscription} className="space-y-3" data-guide="feed-add-url">
                <input
                  type="text"
                  required
                  value={addFeedUrl}
                  onChange={(e) => setAddFeedUrl(e.target.value)}
                  placeholder="https://… · @channel · t.me/channel"
                  className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-2.5 text-xs text-kindle-text"
                />
                {addFeedError && (
                  <p className="text-[10px] text-red-500 bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">
                    {addFeedError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={addingFeed}
                  className="w-full py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {addingFeed ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bookmark className="w-4 h-4" />}
                  Add Source
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
      {readingArticle && (
        <FeedArticleReader
          item={readingArticle}
          queue={visibleItems}
          userId={userId}
          onClose={() => dismissFeedArticle()}
          onOpenItem={(next) => {
            markFeedItemRead(next.id, true);
            setItems(getFeedItems());
            setReadingArticle(next);
          }}
          onSaved={async () => {
            setItems(getFeedItems());
            await onRefreshLibrary?.();
          }}
        />
      )}
    </div>
  );
}

export default React.memo(FeedView);
