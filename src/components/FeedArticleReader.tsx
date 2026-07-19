import React, { useEffect, useMemo, useState } from "react";
import { Bookmark, ExternalLink, Loader2, Settings2, X } from "lucide-react";
import { clipUrlToLibrary } from "../lib/feedClipper";
import type { FeedItem } from "../lib/feedStorage";
import { markFeedItemSaved } from "../lib/feedStorage";
import { textDirection } from "../lib/textDirection";
import {
  loadNewsReaderPrefs,
  NEWS_READER_FONT_OPTIONS,
  NEWS_READER_MARGIN_OPTIONS,
  NEWS_READER_PREFS_EVENT,
  NEWS_READER_THEME_OPTIONS,
  newsReaderThemeClasses,
  patchNewsReaderPrefs,
  type NewsReaderPrefs,
} from "../lib/newsReaderPrefs";

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
  const [prefs, setPrefs] = useState<NewsReaderPrefs>(() => loadNewsReaderPrefs());
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const sync = () => setPrefs(loadNewsReaderPrefs());
    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<NewsReaderPrefs>).detail;
      if (detail) setPrefs(detail);
      else sync();
    };
    window.addEventListener(NEWS_READER_PREFS_EVENT, onCustom as EventListener);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(NEWS_READER_PREFS_EVENT, onCustom as EventListener);
      window.removeEventListener("storage", sync);
    };
  }, []);

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

  const theme = useMemo(() => newsReaderThemeClasses(prefs.theme), [prefs.theme]);

  const updatePrefs = (patch: Partial<NewsReaderPrefs>) => {
    setPrefs(patchNewsReaderPrefs(patch));
  };

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
    <div
      className={`fixed inset-0 z-[120] flex flex-col kora-safe-top kora-safe-bottom ${theme.shell}`}
      style={{ filter: prefs.brightness < 100 ? `brightness(${prefs.brightness}%)` : undefined }}
    >
      <header className={`shrink-0 border-b ${theme.border} ${theme.header} backdrop-blur-md px-3 sm:px-4 py-3 flex items-center gap-2`}>
        <button
          onClick={onClose}
          className={`p-2 rounded-xl hover:opacity-80 transition ${theme.muted}`}
          aria-label="Close reader"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className={`text-[9px] font-bold uppercase tracking-widest truncate ${theme.muted}`}>
            {item.subscriptionTitle}
          </p>
          <h1
            dir={textDirection(articleTitle)}
            className={`text-sm font-lexend font-bold truncate ${
              textDirection(articleTitle) === "rtl" ? "font-thaana" : ""
            }`}
          >
            {articleTitle}
          </h1>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className={`p-2 rounded-xl border ${theme.border} hover:opacity-90 ${theme.muted}`}
            aria-label="News reader settings"
            aria-pressed={showSettings}
          >
            <Settings2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || loading || !!error}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border ${theme.border} text-[10px] font-bold uppercase tracking-wider disabled:opacity-50`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bookmark className="w-3.5 h-3.5" />}
            Save
          </button>
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className={`p-2 rounded-xl border ${theme.border} ${theme.muted}`}
            aria-label="Open original"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </header>

      {showSettings && (
        <div className={`shrink-0 border-b ${theme.border} ${theme.header} px-4 py-4 space-y-4 max-h-[45vh] overflow-y-auto`}>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold">Font Size</h4>
              <span className={`text-[10px] font-mono ${theme.muted}`}>{prefs.fontSize}px</span>
            </div>
            <input
              type="range"
              min={12}
              max={36}
              step={1}
              value={prefs.fontSize}
              onChange={(e) => updatePrefs({ fontSize: Number(e.target.value) })}
              className="w-full accent-kindle-accent cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold">Line Spacing</h4>
              <span className={`text-[10px] font-mono ${theme.muted}`}>{prefs.lineSpacing.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={1.2}
              max={2.6}
              step={0.1}
              value={prefs.lineSpacing}
              onChange={(e) => updatePrefs({ lineSpacing: Number(e.target.value) })}
              className="w-full accent-kindle-accent cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold">Paragraph Spacing</h4>
              <span className={`text-[10px] font-mono ${theme.muted}`}>{prefs.paragraphSpacing.toFixed(1)}em</span>
            </div>
            <input
              type="range"
              min={0.6}
              max={2.2}
              step={0.1}
              value={prefs.paragraphSpacing}
              onChange={(e) => updatePrefs({ paragraphSpacing: Number(e.target.value) })}
              className="w-full accent-kindle-accent cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            <h4 className={`text-[9px] uppercase tracking-widest font-bold ${theme.muted}`}>Font Family</h4>
            <div className="flex flex-wrap gap-2">
              {NEWS_READER_FONT_OPTIONS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => updatePrefs({ fontFamily: f.id })}
                  className={`px-3 py-1.5 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition ${
                    prefs.fontFamily === f.id
                      ? "bg-kindle-text text-kindle-bg border-kindle-text"
                      : `${theme.border} ${theme.muted}`
                  }`}
                >
                  <span className={f.id}>{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h4 className={`text-[9px] uppercase tracking-widest font-bold ${theme.muted}`}>Page Width</h4>
            <div className="flex flex-wrap gap-2">
              {NEWS_READER_MARGIN_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => updatePrefs({ marginSize: m.id })}
                  className={`px-3 py-1.5 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition ${
                    prefs.marginSize === m.id
                      ? "bg-kindle-text text-kindle-bg border-kindle-text"
                      : `${theme.border} ${theme.muted}`
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h4 className={`text-[9px] uppercase tracking-widest font-bold ${theme.muted}`}>Theme</h4>
            <div className="grid grid-cols-4 gap-2">
              {NEWS_READER_THEME_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => updatePrefs({ theme: t.id })}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition ${
                    prefs.theme === t.id ? "border-kindle-accent ring-1 ring-kindle-accent/30" : theme.border
                  }`}
                >
                  <div className={`w-6 h-6 rounded-md ${t.bg} ring-1 ${t.ring}`} />
                  <span className="text-[8px] font-bold uppercase tracking-widest">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold">Brightness</h4>
              <span className={`text-[10px] font-mono ${theme.muted}`}>{prefs.brightness}%</span>
            </div>
            <input
              type="range"
              min={40}
              max={100}
              step={5}
              value={prefs.brightness}
              onChange={(e) => updatePrefs({ brightness: Number(e.target.value) })}
              className="w-full accent-kindle-accent cursor-pointer"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className={`h-full flex flex-col items-center justify-center gap-3 ${theme.muted}`}>
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
          <article className={`mx-auto py-8 ${prefs.marginSize}`}>
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
