import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Rss,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { BookMetadata } from "../lib/firebase";
import { clipUrlToLibrary } from "../lib/feedClipper";
import {
  addFeedSubscription,
  ensureDefaultSubscriptions,
  FeedItem,
  FeedSubscription,
  getFeedItems,
  markFeedItemRead,
  markFeedItemSaved,
  mergeFeedItems,
  removeFeedSubscription,
  saveFeedSubscriptions,
} from "../lib/feedStorage";
import { discoverFeed, refreshAllSubscriptions } from "../lib/feedClient";
import { resolveCoverImageSrc } from "../lib/coverImage";

interface FeedViewProps {
  userId?: string;
  onRefreshLibrary?: () => void;
  onOpenBook?: (book: BookMetadata) => void;
  initialUrl?: string | null;
  onClearInitialUrl?: () => void;
}

type FeedFilter = "all" | "unread" | "saved";

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
  const [clipperUrl, setClipperUrl] = useState("");
  const [clipStatus, setClipStatus] = useState<"idle" | "working" | "success" | "error">("idle");
  const [clipError, setClipError] = useState<string | null>(null);
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [addFeedUrl, setAddFeedUrl] = useState("");
  const [addFeedError, setAddFeedError] = useState<string | null>(null);
  const [addingFeed, setAddingFeed] = useState(false);
  const [workingItemId, setWorkingItemId] = useState<string | null>(null);

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);

  const loadLocalState = useCallback(() => {
    const subs = ensureDefaultSubscriptions();
    setSubscriptions(subs);
    setItems(getFeedItems());
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
    } catch (error) {
      console.error("Feed refresh failed:", error);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadLocalState();
    void refreshFeeds();
  }, [loadLocalState, refreshFeeds]);

  useEffect(() => {
    if (initialUrl) {
      setClipperUrl(initialUrl);
      onClearInitialUrl?.();
    }
  }, [initialUrl, onClearInitialUrl]);

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedSubscriptionId && item.subscriptionId !== selectedSubscriptionId) return false;
      if (filter === "unread" && item.read) return false;
      if (filter === "saved" && !item.savedBookId) return false;
      return true;
    });
  }, [items, filter, selectedSubscriptionId]);

  const handleClipUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clipperUrl.trim()) return;
    setClipStatus("working");
    setClipError(null);
    try {
      const book = await clipUrlToLibrary({
        url: clipperUrl.trim(),
        userId,
        tags: ["Feed", "Clipped"],
      });
      setClipStatus("success");
      setClipperUrl("");
      await onRefreshLibrary?.();
      onOpenBook?.(book);
      setTimeout(() => setClipStatus("idle"), 2500);
    } catch (err) {
      setClipError((err as Error).message || "Failed to clip article.");
      setClipStatus("error");
    }
  };

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
      setShowAddFeed(false);
      setAddFeedUrl("");
      await refreshFeeds();
    } catch (err) {
      setAddFeedError((err as Error).message || "Could not subscribe to this feed.");
    } finally {
      setAddingFeed(false);
    }
  };

  const handleReadArticle = async (item: FeedItem) => {
    setWorkingItemId(item.id);
    try {
      const book = await clipUrlToLibrary({
        url: item.link,
        userId,
        tags: ["Feed", item.subscriptionTitle],
        sourceLabel: item.subscriptionTitle,
      });
      markFeedItemSaved(item.id, book.id);
      markFeedItemRead(item.id, true);
      setItems(getFeedItems());
      await onRefreshLibrary?.();
      onOpenBook?.(book);
    } catch (err) {
      alert((err as Error).message || "Could not read this article.");
    } finally {
      setWorkingItemId(null);
    }
  };

  return (
    <div className="space-y-6 md:space-y-8 pb-4 md:pb-10 animate-in fade-in slide-in-from-bottom-4 duration-500 text-left">
      <header className="flex items-center justify-between pb-2 md:pb-4 border-b border-kindle-border font-sans gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Rss className="w-5 h-5 text-kindle-accent shrink-0" />
            <h1 className="text-3xl font-lexend font-bold tracking-tight text-kindle-text">Feed</h1>
            {unreadCount > 0 && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-kindle-accent/10 text-kindle-accent border border-kindle-accent/20">
                {unreadCount} unread
              </span>
            )}
          </div>
          <p className="hidden md:block text-[10px] text-kindle-text-muted uppercase tracking-wider font-semibold font-mono mt-0.5">
            Your reading queue from the web — subscribe, clip, and read offline.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowAddFeed(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-kindle-border bg-kindle-card text-[10px] font-bold uppercase tracking-wider hover:bg-kindle-bg transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
          <button
            onClick={() => void refreshFeeds()}
            disabled={refreshing}
            className="p-2 rounded-xl border border-kindle-border bg-kindle-card hover:bg-kindle-bg transition disabled:opacity-50"
            title="Refresh feeds"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-kindle-accent/[0.08] border border-kindle-accent/20 rounded-xl">
            <Globe className="w-5 h-5 text-kindle-accent" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-kindle-text font-lexend">Clip Article or Feed URL</h2>
            <p className="text-[10px] text-kindle-text-muted">
              Paste any article link to read offline, or paste a site URL when adding subscriptions.
            </p>
          </div>
        </div>
        <form onSubmit={handleClipUrl} className="flex gap-2">
          <input
            type="url"
            value={clipperUrl}
            onChange={(e) => setClipperUrl(e.target.value)}
            placeholder="https://example.com/article-or-feed"
            className="flex-1 bg-kindle-bg border border-kindle-border rounded-xl px-4 py-2.5 text-xs text-kindle-text placeholder:text-kindle-text-muted/60 focus:outline-none focus:ring-1 focus:ring-kindle-accent"
          />
          <button
            type="submit"
            disabled={clipStatus === "working"}
            className="px-5 py-2.5 bg-kindle-accent hover:bg-kindle-accent-hover disabled:opacity-50 text-white rounded-xl text-xs font-bold font-lexend transition-all shadow-sm flex items-center gap-2"
          >
            {clipStatus === "working" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Clip
          </button>
        </form>
        {clipStatus === "error" && clipError && (
          <p className="text-[10px] text-red-500 bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">{clipError}</p>
        )}
        {clipStatus === "success" && (
          <p className="text-[10px] text-emerald-600 bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-3 py-2">
            Article clipped and opened in the reader.
          </p>
        )}
      </div>

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
                ? "bg-white text-black border-white"
                : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:text-kindle-text"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setSelectedSubscriptionId(null)}
          className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition ${
            !selectedSubscriptionId
              ? "bg-kindle-accent text-white border-kindle-accent"
              : "bg-kindle-card text-kindle-text-muted border-kindle-border"
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
                ? "bg-kindle-accent text-white border-kindle-accent"
                : "bg-kindle-card text-kindle-text-muted border-kindle-border"
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
            Add a feed source or clip an article URL above. Your subscriptions will appear here as a reading queue.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visibleItems.map((item) => {
            const cover = item.imageUrl ? resolveCoverImageSrc(item.imageUrl) : null;
            const busy = workingItemId === item.id;
            return (
              <article
                key={item.id}
                className={`bg-kindle-card border rounded-2xl overflow-hidden transition hover:shadow-md ${
                  item.read ? "border-kindle-border opacity-80" : "border-kindle-border shadow-sm"
                }`}
              >
                <div className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    {cover ? (
                      <img
                        src={cover}
                        alt=""
                        className="w-14 h-14 rounded-lg object-cover border border-kindle-border shrink-0 bg-kindle-bg"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg border border-kindle-border bg-kindle-bg flex items-center justify-center shrink-0">
                        <Rss className="w-5 h-5 text-kindle-text-muted/50" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {!item.read && <span className="w-1.5 h-1.5 rounded-full bg-kindle-accent shrink-0" />}
                        <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted truncate">
                          {item.subscriptionTitle} · {formatRelativeTime(item.publishedAt)}
                        </p>
                      </div>
                      <h3 className="text-sm font-lexend font-bold leading-snug text-kindle-text line-clamp-2">
                        {item.title}
                      </h3>
                      {item.summary && (
                        <p className="text-[11px] text-kindle-text-muted mt-1 line-clamp-2 leading-relaxed">
                          {item.summary}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void handleReadArticle(item)}
                      disabled={busy}
                      className="flex-1 min-w-[7rem] flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-kindle-accent text-white text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Newspaper className="w-3.5 h-3.5" />}
                      Read
                    </button>
                    <button
                      onClick={() => {
                        markFeedItemRead(item.id, !item.read);
                        setItems(getFeedItems());
                      }}
                      className="px-3 py-2 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-text transition"
                    >
                      {item.read ? "Unread" : "Read"}
                    </button>
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 rounded-xl border border-kindle-border text-kindle-text-muted hover:text-kindle-text transition"
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
              </article>
            );
          })}
        </div>
      )}

      {subscriptions.length > 0 && (
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-3">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted font-lexend">
            Subscriptions
          </h3>
          <div className="space-y-2">
            {subscriptions.map((sub) => (
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
            ))}
          </div>
        </section>
      )}

      {showAddFeed && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-lexend font-bold">Add Feed Source</h3>
              <button onClick={() => setShowAddFeed(false)} className="p-1.5 rounded-lg hover:bg-kindle-bg">
                <X className="w-4 h-4" />
              </button>
            </div>
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
                className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-2.5 text-xs"
              />
              {addFeedError && (
                <p className="text-[10px] text-red-500 bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">
                  {addFeedError}
                </p>
              )}
              <button
                type="submit"
                disabled={addingFeed}
                className="w-full py-2.5 rounded-xl bg-kindle-accent text-white text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {addingFeed ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bookmark className="w-4 h-4" />}
                Subscribe
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
