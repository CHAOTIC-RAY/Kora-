import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, ChevronLeft, ExternalLink, Loader2, Settings2 } from "lucide-react";
import {
  peekFeedArticle,
  prepareFeedArticleHtml,
  prefetchFeedArticles,
  resolveFeedArticle,
} from "../lib/feedArticle";
import { clipUrlToLibrary } from "../lib/feedClipper";
import type { FeedItem } from "../lib/feedStorage";
import { markFeedItemSaved } from "../lib/feedStorage";
import { textDirection } from "../lib/textDirection";
import { newsReaderThemeClasses } from "../lib/newsReaderPrefs";
import { isTelegramArticleLink } from "../lib/telegramFeed";
import { useNewsReaderPrefs } from "../hooks/useNewsReaderPrefs";
import NewsReaderSettingsPanel from "./NewsReaderSettingsPanel";

interface FeedArticleReaderProps {
  item: FeedItem;
  queue?: FeedItem[];
  userId?: string;
  onClose: () => void;
  onOpenItem?: (item: FeedItem) => void;
  onSaved?: () => void | Promise<void>;
}

interface StackEntry {
  item: FeedItem;
  title: string;
  html: string;
  ready: boolean;
  error?: string;
}

function entryFromCache(feedItem: FeedItem): StackEntry | null {
  const cached = peekFeedArticle(feedItem);
  if (!cached) return null;
  return {
    item: feedItem,
    title: cached.title || feedItem.title,
    html: cached.htmlContent || "",
    ready: true,
  };
}

function placeholderEntry(feedItem: FeedItem): StackEntry {
  return {
    item: feedItem,
    title: feedItem.title,
    html: "",
    ready: false,
  };
}

export default function FeedArticleReader({
  item,
  queue = [],
  userId,
  onClose,
  onOpenItem,
  onSaved,
}: FeedArticleReaderProps) {
  const [stack, setStack] = useState<StackEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const { prefs, updatePrefs } = useNewsReaderPrefs();
  const [showSettings, setShowSettings] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const articleNodeRefs = useRef(new Map<string, HTMLElement>());
  const syncFromScrollRef = useRef(false);
  const hasUserScrolledRef = useRef(false);
  const sessionStartIdRef = useRef(item.id);
  const loadingIdsRef = useRef(new Set<string>());

  const theme = useMemo(() => newsReaderThemeClasses(prefs.theme), [prefs.theme]);

  const activeEntry = useMemo(
    () => stack.find((entry) => entry.item.id === item.id) || stack[0] || null,
    [stack, item.id]
  );

  const fillEntry = useCallback(async (feedItem: FeedItem) => {
    if (loadingIdsRef.current.has(feedItem.id)) return;
    loadingIdsRef.current.add(feedItem.id);
    try {
      const resolved = await resolveFeedArticle(feedItem);
      setStack((prev) => {
        if (!prev.some((entry) => entry.item.id === feedItem.id)) return prev;
        return prev.map((entry) =>
          entry.item.id === feedItem.id
            ? {
                item: feedItem,
                title: resolved.title || feedItem.title,
                html: resolved.htmlContent || "",
                ready: true,
              }
            : entry
        );
      });
    } catch (err) {
      setStack((prev) =>
        prev.map((entry) =>
          entry.item.id === feedItem.id
            ? {
                ...entry,
                ready: true,
                error: (err as Error).message || "Could not load this article.",
              }
            : entry
        )
      );
    } finally {
      loadingIdsRef.current.delete(feedItem.id);
    }
  }, []);

  // Fresh open / jump to an article that isn't already in the continuous stack.
  useEffect(() => {
    const alreadyStacked = stack.some((entry) => entry.item.id === item.id);
    if (alreadyStacked) return;

    sessionStartIdRef.current = item.id;
    hasUserScrolledRef.current = false;
    const cached = entryFromCache(item);
    setStack([cached || placeholderEntry(item)]);
    scrollRef.current?.scrollTo({ top: 0 });

    if (!cached) {
      void fillEntry(item);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to external item jumps
  }, [item.id, fillEntry]);

  // Grow the stack forward so the next stories are already rendered below.
  useEffect(() => {
    if (!queue.length) return;
    const last = stack[stack.length - 1];
    if (!last) return;

    const lastIdx = queue.findIndex((entry) => entry.id === last.item.id);
    if (lastIdx < 0) return;

    const upcoming = queue.slice(lastIdx + 1, lastIdx + 3);
    const missing = upcoming.filter((entry) => !stack.some((s) => s.item.id === entry.id));
    if (!missing.length) return;

    setStack((prev) => {
      const next = [...prev];
      for (const feedItem of missing) {
        if (next.some((entry) => entry.item.id === feedItem.id)) continue;
        next.push(entryFromCache(feedItem) || placeholderEntry(feedItem));
      }
      return next;
    });

    for (const feedItem of missing) {
      if (!peekFeedArticle(feedItem)) {
        void fillEntry(feedItem);
      }
    }
  }, [stack, queue, fillEntry]);

  // Prefetch a couple ahead in the background (cache warm even before stack append).
  useEffect(() => {
    const idx = queue.findIndex((entry) => entry.id === item.id);
    if (idx < 0) return;
    void prefetchFeedArticles(queue.slice(idx + 1, idx + 4), 3);
  }, [queue, item.id]);

  // As the user scrolls, the most visible article becomes the active one — no remount.
  useEffect(() => {
    if (!onOpenItem || stack.length < 2) return;
    const root = scrollRef.current;
    if (!root) return;

    const ratios = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.articleId;
          if (!id) continue;
          ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }

        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }

        if (!bestId || bestRatio < 0.35 || bestId === item.id) return;
        // Avoid jumping active story while the opening article is still settling.
        if (!hasUserScrolledRef.current && bestId !== sessionStartIdRef.current) return;
        const next = stack.find((entry) => entry.item.id === bestId);
        if (!next?.ready || next.error) return;

        syncFromScrollRef.current = true;
        onOpenItem(next.item);
      },
      {
        root,
        threshold: [0.15, 0.35, 0.55, 0.75],
        rootMargin: "-18% 0px -42% 0px",
      }
    );

    for (const entry of stack) {
      const node = articleNodeRefs.current.get(entry.item.id);
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [stack, item.id, onOpenItem]);

  // If parent changes active item without scroll (e.g. tap next card), ease to it.
  useEffect(() => {
    if (syncFromScrollRef.current) {
      syncFromScrollRef.current = false;
      return;
    }
    const node = articleNodeRefs.current.get(item.id);
    if (!node || !stack.some((entry) => entry.item.id === item.id)) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [item.id, stack]);

  const handleSave = async () => {
    const target = activeEntry?.item || item;
    setSaving(true);
    try {
      const book = await clipUrlToLibrary({
        url: target.link,
        userId,
        tags: [
          "Feed",
          target.subscriptionTitle,
          ...(isTelegramArticleLink(target.link) ? ["Telegram"] : []),
        ],
        sourceLabel: target.subscriptionTitle,
      });
      markFeedItemSaved(target.id, book.id);
      await onSaved?.();
    } catch (err) {
      alert((err as Error).message || "Could not save to library.");
    } finally {
      setSaving(false);
    }
  };

  const jumpToEntry = useCallback(
    (feedItem: FeedItem) => {
      if (!onOpenItem) return;
      const node = articleNodeRefs.current.get(feedItem.id);
      if (node) {
        syncFromScrollRef.current = true;
        onOpenItem(feedItem);
        node.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      onOpenItem(feedItem);
    },
    [onOpenItem]
  );

  const bootstrapping = stack.length === 0 || (stack.length === 1 && !stack[0].ready && !stack[0].error);
  const activeLink = activeEntry?.item.link || item.link;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col ${theme.shell}`}
      style={{
        width: "100vw",
        height: "100dvh",
        maxHeight: "100dvh",
        filter: prefs.brightness < 100 ? `brightness(${prefs.brightness}%)` : undefined,
      }}
    >
      <div
        className={`absolute z-20 left-0 right-0 top-0 flex items-start justify-between gap-2 px-[max(0.5rem,var(--kora-safe-left))] pt-[max(0.5rem,var(--kora-safe-top))] pr-[max(0.5rem,var(--kora-safe-right))] pointer-events-none transition-opacity duration-200 ${
          chromeVisible || showSettings ? "opacity-100" : "opacity-0"
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          className={`pointer-events-auto p-2.5 rounded-full ${theme.header} border ${theme.border} shadow-lg backdrop-blur-md`}
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className={`p-2.5 rounded-full ${theme.header} border ${theme.border} shadow-lg backdrop-blur-md`}
            aria-label="News reader settings"
            aria-pressed={showSettings}
          >
            <Settings2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !activeEntry?.ready || !!activeEntry?.error}
            className={`p-2.5 rounded-full ${theme.header} border ${theme.border} shadow-lg backdrop-blur-md disabled:opacity-50`}
            aria-label="Save to library"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bookmark className="w-4 h-4" />}
          </button>
          <a
            href={activeLink}
            target="_blank"
            rel="noopener noreferrer"
            className={`p-2.5 rounded-full ${theme.header} border ${theme.border} shadow-lg backdrop-blur-md`}
            aria-label="Open original"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {showSettings ? <NewsReaderSettingsPanel prefs={prefs} onChange={updatePrefs} /> : null}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-y-contain min-h-0 scroll-smooth"
        onScroll={() => {
          if ((scrollRef.current?.scrollTop || 0) > 48) {
            hasUserScrolledRef.current = true;
          }
        }}
        onClick={() => {
          if (showSettings) return;
          setChromeVisible((v) => !v);
        }}
      >
        {bootstrapping ? (
          <div className={`h-full flex flex-col items-center justify-center gap-3 ${theme.muted}`}>
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-xs font-sans">Loading article…</p>
          </div>
        ) : (
          <>
            {stack.map((entry, index) => {
              const isTelegram = isTelegramArticleLink(entry.item.link);
              const displayHtml = entry.ready
                ? prepareFeedArticleHtml(entry.html, entry.title || entry.item.title)
                : "";
              const titleDir = textDirection(entry.title || entry.item.title);

              return (
                <section
                  key={entry.item.id}
                  data-article-id={entry.item.id}
                  ref={(node) => {
                    if (node) articleNodeRefs.current.set(entry.item.id, node);
                    else articleNodeRefs.current.delete(entry.item.id);
                  }}
                  className={`mx-auto ${prefs.marginSize} ${
                    index === 0 ? "pt-[calc(var(--kora-safe-top)+3.5rem)]" : "pt-10"
                  } ${index < stack.length - 1 ? "pb-8 border-b border-kindle-border/40" : "pb-4"}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-5 space-y-1">
                    <p className={`text-[9px] font-bold uppercase tracking-widest ${theme.muted}`}>
                      {entry.item.subscriptionTitle}
                      {isTelegram ? " · Telegram" : ""}
                    </p>
                    <h1
                      dir={titleDir}
                      className={`text-xl md:text-2xl font-lexend font-bold leading-snug ${
                        titleDir === "rtl" ? "font-thaana" : ""
                      }`}
                    >
                      {entry.title || entry.item.title}
                    </h1>
                  </div>

                  {!entry.ready ? (
                    <div className={`flex items-center gap-2 py-10 ${theme.muted}`}>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <p className="text-xs font-sans">Loading…</p>
                    </div>
                  ) : entry.error ? (
                    <div className="space-y-3 py-6">
                      <p className="text-sm text-red-400">{entry.error}</p>
                      <a
                        href={entry.item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Open in browser
                      </a>
                    </div>
                  ) : (
                    <div
                      dir="auto"
                      className={`feed-article-content max-w-none ${prefs.fontFamily} ${theme.content} [&_*]:[unicode-bidi:plaintext] animate-in fade-in duration-200`}
                      style={{
                        fontSize: `${prefs.fontSize}px`,
                        lineHeight: prefs.lineSpacing,
                        ["--news-paragraph-gap" as string]: `${prefs.paragraphSpacing}em`,
                      }}
                      dangerouslySetInnerHTML={{ __html: displayHtml }}
                    />
                  )}
                </section>
              );
            })}

            <div
              className={`mx-auto px-6 pb-[calc(var(--kora-safe-bottom)+4rem)] pt-2 ${prefs.marginSize}`}
              onClick={(e) => e.stopPropagation()}
            >
              {(() => {
                const last = stack[stack.length - 1];
                const lastIdx = last ? queue.findIndex((entry) => entry.id === last.item.id) : -1;
                const nextQueued =
                  lastIdx >= 0 && lastIdx < queue.length - 1 ? queue[lastIdx + 1] : null;
                const nextInStack = nextQueued
                  ? stack.find((entry) => entry.item.id === nextQueued.id)
                  : null;

                if (nextInStack && !nextInStack.ready) {
                  return (
                    <div className={`flex items-center justify-center gap-2 py-6 ${theme.muted}`}>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <p className="text-[10px] font-bold uppercase tracking-widest">
                        Preparing next…
                      </p>
                    </div>
                  );
                }

                if (nextQueued) {
                  return (
                    <button
                      type="button"
                      onClick={() => jumpToEntry(nextQueued)}
                      className={`w-full text-left rounded-2xl border ${theme.border} ${theme.header} px-4 py-4 shadow-sm transition-transform active:scale-[0.99]`}
                    >
                      <p className={`text-[9px] font-bold uppercase tracking-[0.2em] ${theme.muted}`}>
                        Up next
                      </p>
                      <p
                        dir={textDirection(nextQueued.title)}
                        className={`mt-1 text-sm font-lexend font-bold leading-snug line-clamp-2 ${
                          textDirection(nextQueued.title) === "rtl" ? "font-thaana" : ""
                        }`}
                      >
                        {nextQueued.title}
                      </p>
                      <p className={`mt-1 text-[10px] ${theme.muted}`}>{nextQueued.subscriptionTitle}</p>
                    </button>
                  );
                }

                return (
                  <p className={`text-center text-[10px] font-bold uppercase tracking-widest ${theme.muted}`}>
                    End of feed
                  </p>
                );
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
