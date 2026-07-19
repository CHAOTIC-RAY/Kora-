import React, { useEffect, useMemo, useState } from "react";
import { Bookmark, ChevronLeft, ExternalLink, Loader2, Settings2 } from "lucide-react";
import { clipUrlToLibrary } from "../lib/feedClipper";
import type { FeedItem } from "../lib/feedStorage";
import { markFeedItemSaved } from "../lib/feedStorage";
import { textDirection } from "../lib/textDirection";
import { newsReaderThemeClasses } from "../lib/newsReaderPrefs";
import { isTelegramArticleLink, telegramPostHtml } from "../lib/telegramFeed";
import { useNewsReaderPrefs } from "../hooks/useNewsReaderPrefs";
import NewsReaderSettingsPanel from "./NewsReaderSettingsPanel";

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
  const { prefs, updatePrefs } = useNewsReaderPrefs();
  const [showSettings, setShowSettings] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  const isTelegram = isTelegramArticleLink(item.link);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setArticleTitle(item.title);

      if (isTelegram) {
        setHtml(
          telegramPostHtml({
            title: item.title,
            summary: item.summary,
            imageUrl: item.imageUrl,
            link: item.link,
          })
        );
        if (!cancelled) setLoading(false);
        return;
      }

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
  }, [item.link, item.title, item.summary, item.imageUrl, isTelegram]);

  const theme = useMemo(() => newsReaderThemeClasses(prefs.theme), [prefs.theme]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const book = await clipUrlToLibrary({
        url: item.link,
        userId,
        tags: ["Feed", item.subscriptionTitle, ...(isTelegram ? ["Telegram"] : [])],
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
    <div
      className={`fixed inset-0 z-[9999] flex flex-col ${theme.shell}`}
      style={{
        width: "100vw",
        height: "100dvh",
        maxHeight: "100dvh",
        filter: prefs.brightness < 100 ? `brightness(${prefs.brightness}%)` : undefined,
      }}
    >
      {/* Floating chrome only — no fixed top bar */}
      <div
        className={`absolute z-20 left-0 right-0 top-0 flex items-start justify-between gap-2 px-[max(0.5rem,var(--kora-safe-left))] pt-[max(0.5rem,var(--kora-safe-top))] pr-[max(0.5rem,var(--kora-safe-right))] pointer-events-none transition-opacity ${
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
            disabled={saving || loading || !!error}
            className={`p-2.5 rounded-full ${theme.header} border ${theme.border} shadow-lg backdrop-blur-md disabled:opacity-50`}
            aria-label="Save to library"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bookmark className="w-4 h-4" />}
          </button>
          <a
            href={item.link}
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
        className="flex-1 overflow-y-auto overscroll-contain min-h-0"
        onClick={() => {
          if (showSettings) return;
          setChromeVisible((v) => !v);
        }}
      >
        {loading ? (
          <div className={`h-full flex flex-col items-center justify-center gap-3 ${theme.muted}`}>
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-xs font-sans">Loading article…</p>
          </div>
        ) : error ? (
          <div className="max-w-lg mx-auto p-8 text-center space-y-4 pt-24">
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
          <article
            className={`mx-auto pt-[calc(var(--kora-safe-top)+3.5rem)] pb-[calc(var(--kora-safe-bottom)+1.5rem)] ${prefs.marginSize}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 space-y-1">
              <p className={`text-[9px] font-bold uppercase tracking-widest ${theme.muted}`}>
                {item.subscriptionTitle}
                {isTelegram ? " · Telegram" : ""}
              </p>
              <h1
                dir={textDirection(articleTitle)}
                className={`text-xl md:text-2xl font-lexend font-bold leading-snug ${
                  textDirection(articleTitle) === "rtl" ? "font-thaana" : ""
                }`}
              >
                {articleTitle}
              </h1>
            </div>
            <div
              dir="auto"
              className={`feed-article-content max-w-none ${prefs.fontFamily} ${theme.content} [&_*]:[unicode-bidi:plaintext]`}
              style={{
                fontSize: `${prefs.fontSize}px`,
                lineHeight: prefs.lineSpacing,
                ["--news-paragraph-gap" as string]: `${prefs.paragraphSpacing}em`,
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>
        )}
      </div>
    </div>
  );
}
