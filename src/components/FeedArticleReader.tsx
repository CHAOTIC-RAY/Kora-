import React, { useEffect, useState } from "react";
import { Bookmark, ExternalLink, Loader2, X } from "lucide-react";
import { clipUrlToLibrary } from "../lib/feedClipper";
import type { FeedItem } from "../lib/feedStorage";
import { markFeedItemSaved } from "../lib/feedStorage";

interface FeedArticleReaderProps {
  item: FeedItem;
  userId?: string;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

export default function FeedArticleReader({
  item,
  userId,
  onClose,
  onSaved,
}: FeedArticleReaderProps) {
  const [html, setHtml] = useState("");
  const [articleTitle, setArticleTitle] = useState(item.title);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/convert-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: item.link }),
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP error ${response.status}`);
        }
        const data = await response.json();
        if (cancelled) return;
        setHtml(data.htmlContent || "");
        setArticleTitle(data.title || item.title);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Could not load this article.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.link, item.title]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const book = await clipUrlToLibrary({
        url: item.link,
        userId,
        tags: ["Feed", item.subscriptionTitle],
        sourceLabel: item.subscriptionTitle,
      });
      markFeedItemSaved(item.id, book.id);
      await onSaved?.();
    } catch (err) {
      alert((err as Error).message || "Could not save to library.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-kindle-bg text-kindle-text flex flex-col">
      <header className="shrink-0 border-b border-kindle-border bg-kindle-card/90 backdrop-blur-md px-3 sm:px-4 py-3 flex items-center gap-2">
        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-kindle-bg transition text-kindle-text-muted hover:text-kindle-text"
          aria-label="Close reader"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted truncate">
            {item.subscriptionTitle}
          </p>
          <h1 className="text-sm font-lexend font-bold truncate">{articleTitle}</h1>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => void handleSave()}
            disabled={saving || loading || !!error}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-kindle-border bg-kindle-bg hover:bg-kindle-card text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bookmark className="w-3.5 h-3.5" />}
            Save
          </button>
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-xl border border-kindle-border bg-kindle-bg hover:bg-kindle-card text-kindle-text-muted hover:text-kindle-text"
            aria-label="Open original"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-kindle-text-muted">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-xs font-sans">Loading article…</p>
          </div>
        ) : error ? (
          <div className="max-w-lg mx-auto p-8 text-center space-y-4">
            <p className="text-sm text-red-400">{error}</p>
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-kindle-text text-kindle-bg text-xs font-bold uppercase tracking-wider"
            >
              <ExternalLink className="w-4 h-4" />
              Open in browser
            </a>
          </div>
        ) : (
          <article className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
            <div
              className="feed-article-content prose prose-neutral dark:prose-invert max-w-none font-serif leading-relaxed"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>
        )}
      </div>
    </div>
  );
}
