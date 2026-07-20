import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ExternalLink, Newspaper, Settings2 } from "lucide-react";
import type { FeedItem } from "../lib/feedStorage";
import { collectTodayBriefArticles, buildTodayDailyBrief } from "../lib/dailyNewsBriefClient";
import { useAndroidBackLayer } from "../hooks/useAndroidBackLayer";
import { useNewsReaderPrefs } from "../hooks/useNewsReaderPrefs";
import { newsReaderThemeClasses } from "../lib/newsReaderPrefs";
import NewsReaderSettingsPanel from "./NewsReaderSettingsPanel";

interface TodayNewsBriefCardProps {
  items: FeedItem[];
  onReadArticle: (item: FeedItem) => void;
}

export default function TodayNewsBriefCard({ items, onReadArticle }: TodayNewsBriefCardProps) {
  const articles = useMemo(() => collectTodayBriefArticles(items), [items]);
  const brief = useMemo(() => buildTodayDailyBrief(articles), [articles]);
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const { prefs, updatePrefs } = useNewsReaderPrefs();
  const theme = useMemo(() => newsReaderThemeClasses(prefs.theme), [prefs.theme]);

  const dismiss = useAndroidBackLayer(open, "today-news-brief", () => {
    setShowSettings(false);
    setOpen(false);
  });

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) setShowSettings(false);
  }, [open]);

  if (!brief) return null;

  const storyCount = brief.sections.reduce((total, section) => total + section.items.length, 0);

  const openStory = (storyId: string, link: string) => {
    dismiss();
    const article = items.find((item) => item.id === storyId);
    if (article) {
      onReadArticle(article);
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
  };

  const textStyle: React.CSSProperties = {
    fontSize: `${prefs.fontSize}px`,
    lineHeight: prefs.lineSpacing,
  };
  const metaStyle: React.CSSProperties = {
    fontSize: `${Math.max(11, Math.round(prefs.fontSize * 0.72))}px`,
    lineHeight: prefs.lineSpacing,
  };
  const detailStyle: React.CSSProperties = {
    fontSize: `${Math.max(12, Math.round(prefs.fontSize * 0.85))}px`,
    lineHeight: prefs.lineSpacing,
    marginTop: `${prefs.paragraphSpacing * 0.35}em`,
  };

  const overlay =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className={`fixed inset-0 z-[9999] flex flex-col ${theme.shell} sm:bg-black/60 sm:items-center sm:justify-center sm:p-4 animate-in fade-in duration-200`}
            style={{
              width: "100vw",
              height: "100dvh",
              maxHeight: "100dvh",
              filter: prefs.brightness < 100 ? `brightness(${prefs.brightness}%)` : undefined,
            }}
            role="presentation"
          >
            <button
              type="button"
              aria-label="Close brief"
              className="hidden sm:block absolute inset-0 cursor-pointer"
              onClick={() => dismiss()}
            />

            <div
              role="dialog"
              aria-modal="true"
              aria-label="Today's News Brief"
              className={`relative flex flex-col w-full h-full min-h-0 overflow-hidden ${theme.shell} sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-2xl sm:border ${theme.border} sm:shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Floating chrome — no fixed top bar */}
              <div
                className={`absolute z-20 left-0 right-0 top-0 flex items-start justify-between gap-2 px-[max(0.5rem,var(--kora-safe-left))] pt-[max(0.5rem,var(--kora-safe-top))] pr-[max(0.5rem,var(--kora-safe-right))] pointer-events-none transition-opacity ${
                  chromeVisible || showSettings ? "opacity-100" : "opacity-0"
                }`}
              >
                <button
                  type="button"
                  onClick={() => dismiss()}
                  className={`pointer-events-auto p-2.5 rounded-full ${theme.header} border ${theme.border} shadow-lg backdrop-blur-md`}
                  aria-label="Back"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowSettings((v) => !v)}
                  className={`pointer-events-auto p-2.5 rounded-full ${theme.header} border ${theme.border} shadow-lg backdrop-blur-md`}
                  aria-label="Brief reader settings"
                  aria-pressed={showSettings}
                >
                  <Settings2 className="w-4 h-4" />
                </button>
              </div>

              <div
                className={`flex-1 overflow-y-auto overscroll-contain pt-[calc(var(--kora-safe-top)+3.25rem)] pb-[calc(var(--kora-safe-bottom)+1.5rem)] min-h-0 ${prefs.marginSize}`}
                onClick={() => {
                  if (showSettings) {
                    setShowSettings(false);
                    return;
                  }
                  setChromeVisible((v) => !v);
                }}
              >
                <div
                  className={`space-y-5 ${prefs.fontFamily} ${theme.content}`}
                  onClick={(e) => {
                    if (showSettings) {
                      setShowSettings(false);
                      e.stopPropagation();
                    } else {
                      e.stopPropagation();
                    }
                  }}
                >
                  <div className="space-y-1">
                    <p className={`text-[9px] font-bold uppercase tracking-widest ${theme.muted}`}>
                      Daily News Brief
                    </p>
                    <h2
                      className="font-lexend font-bold"
                      style={{ fontSize: `${Math.round(prefs.fontSize * 1.25)}px`, lineHeight: 1.25 }}
                    >
                      Today&apos;s News Brief
                    </h2>
                    <p className={`font-mono ${theme.muted}`} style={metaStyle}>
                      {storyCount} stories · {brief.sections.length} sources
                    </p>
                  </div>

                  <p className={theme.content} style={textStyle}>
                    {brief.lead}
                  </p>

                  {brief.sections.map((section) => (
                    <section
                      key={section.source}
                      className="space-y-2"
                      style={{ marginTop: `${prefs.paragraphSpacing * 0.6}em` }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className={`text-[10px] font-bold uppercase tracking-widest ${theme.muted}`}>
                          {section.source}
                        </h3>
                        <span className={`font-mono shrink-0 ${theme.muted}`} style={metaStyle}>
                          {section.items.length} stor{section.items.length === 1 ? "y" : "ies"}
                        </span>
                      </div>
                      {section.intro ? (
                        <p className={theme.muted} style={detailStyle}>
                          {section.intro}
                        </p>
                      ) : null}

                      <ul className="space-y-2.5">
                        {section.items.map((story) => (
                          <li
                            key={story.id}
                            className={`rounded-xl border ${theme.border} ${theme.header} p-3`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-lexend font-bold leading-snug" style={textStyle}>
                                  {story.headline}
                                </p>
                                <p className={theme.muted} style={detailStyle}>
                                  {story.detail}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => openStory(story.id, story.link)}
                                className={`shrink-0 p-1.5 rounded-lg border ${theme.border} ${theme.muted} hover:opacity-90 transition`}
                                title="Read full article"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </div>
              {showSettings ? <NewsReaderSettingsPanel prefs={prefs} onChange={updatePrefs} /> : null}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left bg-kindle-card border border-kindle-border rounded-2xl p-4 hover:border-kindle-text/35 transition"
      >
        <div className="flex items-center gap-2 mb-1">
          <Newspaper className="w-3.5 h-3.5 text-kindle-text-muted shrink-0" />
          <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">
            Daily News Brief
          </p>
        </div>
        <h3 className="text-sm font-lexend font-bold text-kindle-text mb-2">Today&apos;s News Brief</h3>
        <p className="text-xs text-kindle-text-muted leading-relaxed line-clamp-2">{brief.lead}</p>
        <p className="text-[10px] text-kindle-text-muted/80 mt-2 font-mono">
          {storyCount} stories · {brief.sections.length} sources · Tap for full brief
        </p>
      </button>
      {overlay}
    </>
  );
}
