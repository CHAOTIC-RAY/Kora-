import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import type { BookMetadata } from "../lib/firebase";
import { prefetchFeedArticles } from "../lib/feedArticle";
import {
  addFeedSubscription,
  ensureDefaultSubscriptions,
  FeedItem,
  FeedSubscription,
  getFeedItems,
  markFeedItemRead,
  mergeFeedItems,
  removeFeedSubscription,
  saveFeedSubscriptions,
} from "../lib/feedStorage";
import { discoverFeed, refreshAllSubscriptions } from "../lib/feedClient";
import { getItemThumbnail, prefetchFeedPreviews } from "../lib/feedPreview";
import { textDirection } from "../lib/textDirection";
import FeedArticleReader from "./FeedArticleReader";

interface FeedViewProps {
  userId?: string;
  onRefreshLibrary?: () => void | Promise<void>;
  onOpenBook?: (book: BookMetadata) => void;
  initialUrl?: string | null;
  onClearInitialUrl?: () => void;
}

type FeedFilter = "all" | "unread" | "saved";
type BentoVariant = "featured" | "square" | "wide" | "default";

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
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
  if (index === 0) return "featured";
  if (index % 6 === 3) return "wide";
  if (index % 3 === 1) return "square";
  return "default";
}

function FeedArticleCard({
  item,
  cover,
  busy,
  title,
  variant,
  onRead,
  onToggleRead,
}: {
  item: FeedItem;
  cover: string | null;
  busy: boolean;
  title: string;
  variant: BentoVariant;
  onRead: () => void;
  onToggleRead: () => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumb = cover && !thumbFailed;
  const dir = textDirection(title);

  const cardClass =
    variant === "featured" || variant === "wide" ? "col-span-2" : "col-span-1";

  const layoutClass =
    variant === "wide"
      ? "flex flex-col sm:flex-row sm:items-stretch h-full"
      : "flex flex-col h-full";

  const imageClass =
    variant === "featured"
      ? "w-full aspect-[21/9]"
      : variant === "wide"
        ? "w-full sm:w-40 shrink-0 aspect-[16/10] sm:aspect-auto sm:h-full sm:min-h-[8.5rem]"
        : variant === "square"
          ? "w-full aspect-square"
          : "w-full aspect-[4/3]";

  return (
    <article
      className={`bg-kindle-card border rounded-2xl overflow-hidden transition ${cardClass} ${
        item.read ? "border-kindle-border opacity-85" : "border-kindle-border shadow-sm"
      }`}
    >
      <div className={layoutClass}>
        <button
          type="button"
          onClick={onRead}
          className={`relative bg-kindle-bg border-b sm:border-b-0 sm:border-r border-kindle-border overflow-hidden text-left ${imageClass}`}
        >
          {showThumb ? (
            <img
              src={cover}
              alt=""
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              loading="lazy"
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
        </button>

        <div className="flex flex-col flex-1 p-3 sm:p-4 gap-2 sm:gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted truncate mb-1">
              {item.subscriptionTitle} · {formatRelativeTime(item.publishedAt)}
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

          <div className="flex items-center gap-2 mt-auto">
            <button
              onClick={onRead}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Newspaper className="w-3.5 h-3.5" />}
              Read
            </button>
            <button
              onClick={onToggleRead}
              className="px-3 py-2 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-bg transition"
              title={item.read ? "Mark unread" : "Mark read"}
            >
              {item.read ? "Unread" : "Done"}
            </button>
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-xl border border-kindle-border text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-bg transition"
              title="Open original"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>

          {item.savedBookId && (
            <p className="text-[9px] text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Saved to library
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

export default function FeedView({
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

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);

  const loadLocalState = useCallback(() => {
    const subs = ensureDefaultSubscriptions();
    setSubscriptions(subs);
    setItems(getFeedItems());
  }, []);

  const enrichFeedItems = useCallback(async (merged: FeedItem[]) => {
    try {
      const withPreviews = await prefetchFeedPreviews(merged, 20);
      setItems(withPreviews);
      void prefetchFeedArticles(withPreviews.slice(0, 5), 5);
    } catch {
      setItems(merged);
    }
  }, []);

  const refreshFeeds = useCallback(async () => {
    const subs = ensureDefaultSubscriptions();
    setSubscriptions(subs);
    setRefreshing(true);
    try {
      const incoming = await refreshAllSubscriptions(subs);
      const merged = mergeFeedItems(incoming);
      setItems(merged);
      saveFeedSubscriptions(subs.map((sub) => ({ ...sub, lastFetchedAt: Date.now() })));
      void enrichFeedItems(merged);
    } catch (error) {
      console.error("Feed refresh failed:", error);
    } finally {
      setRefreshing(false);
    }
  }, [enrichFeedItems]);

  useEffect(() => {
    loadLocalState();
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

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedSubscriptionId && item.subscriptionId !== selectedSubscriptionId) return false;
      if (filter === "unread" && item.read) return false;
      if (filter === "saved" && !item.savedBookId) return false;
      return true;
    });
  }, [items, filter, selectedSubscriptionId]);

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

  return (
    <div className="space-y-5 md:space-y-7 pb-4 md:pb-10 animate-in fade-in slide-in-from-bottom-4 duration-500 text-left">
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
          { id: "unread", label: "Unread" },
          { id: "saved", label: "Saved" },
        ].map((chip) => (
          <button
            key={chip.id}
            onClick={() => setFilter(chip.id as FeedFilter)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider border transition ${
              filter === chip.id
                ? "bg-kindle-text text-kindle-bg border-kindle-text"
                : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:text-kindle-text"
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
              ? "bg-kindle-text text-kindle-bg border-kindle-text"
              : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:text-kindle-text"
          }`}
        >
          All Sources
        </button>
        {subscriptions.map((sub) => (
          <button
            key={sub.id}
            onClick={() => setSelectedSubscriptionId(sub.id)}
            className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition max-w-[10rem] truncate ${
              selectedSubscriptionId === sub.id
                ? "bg-kindle-text text-kindle-bg border-kindle-text"
                : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:text-kindle-text"
            }`}
            title={sub.title}
          >
            {sub.title}
          </button>
        ))}
      </div>

      {refreshing && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-kindle-text-muted">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">Fetching your feeds…</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="bg-kindle-card border border-kindle-border rounded-2xl p-12 text-center">
          <Newspaper className="w-12 h-12 text-kindle-text-muted mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-lexend font-bold mb-2">No articles here yet</h3>
          <p className="text-sm text-kindle-text-muted max-w-md mx-auto">
            Add a feed source with Manage above, or share an article link to Kora from your browser.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 auto-rows-fr">
          {visibleItems.map((item, index) => {
            const cover = getItemThumbnail(item);
            const title = displayTitle(item);
            return (
              <FeedArticleCard
                key={item.id}
                item={item}
                cover={cover}
                busy={false}
                title={title}
                variant={getBentoVariant(index)}
                onRead={() => void handleReadArticle(item)}
                onToggleRead={() => {
                  markFeedItemRead(item.id, !item.read);
                  setItems(getFeedItems());
                }}
              />
            );
          })}
        </div>
      )}

      {showManageFeeds && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-lexend font-bold text-kindle-text">Manage Subscriptions</h3>
              <button onClick={() => setShowManageFeeds(false)} className="p-1.5 rounded-lg hover:bg-kindle-bg text-kindle-text">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              {subscriptions.length === 0 ? (
                <p className="text-[10px] text-kindle-text-muted">No subscriptions yet.</p>
              ) : (
                subscriptions.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-kindle-border bg-kindle-bg/50"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-kindle-text truncate">{sub.title}</p>
                      <p className="text-[10px] text-kindle-text-muted truncate">{sub.feedUrl}</p>
                    </div>
                    <button
                      onClick={() => {
                        removeFeedSubscription(sub.id);
                        loadLocalState();
                      }}
                      className="p-2 text-kindle-text-muted hover:text-red-500 transition shrink-0"
                      title="Unsubscribe"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-kindle-border pt-4 space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">Add Feed Source</h4>
              <p className="text-[10px] text-kindle-text-muted">
                Paste a website URL or direct RSS/Atom feed link. Kora will discover the feed automatically.
              </p>
              <form onSubmit={handleAddSubscription} className="space-y-3">
                <input
                  type="url"
                  required
                  value={addFeedUrl}
                  onChange={(e) => setAddFeedUrl(e.target.value)}
                  placeholder="https://example.com or feed.xml"
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
                  Subscribe
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
      {readingArticle && (
        <FeedArticleReader
          item={readingArticle}
          userId={userId}
          onClose={() => setReadingArticle(null)}
          onSaved={async () => {
            setItems(getFeedItems());
            await onRefreshLibrary?.();
          }}
        />
      )}
    </div>
  );
}
