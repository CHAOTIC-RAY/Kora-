import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ExternalLink, Newspaper, X } from "lucide-react";
import type { FeedItem } from "../lib/feedStorage";
import { collectTodayBriefArticles, buildTodayDailyBrief } from "../lib/dailyNewsBriefClient";
import { useAndroidBackLayer } from "../hooks/useAndroidBackLayer";

interface TodayNewsBriefCardProps {
  items: FeedItem[];
  onReadArticle: (item: FeedItem) => void;
}

export default function TodayNewsBriefCard({ items, onReadArticle }: TodayNewsBriefCardProps) {
  const articles = useMemo(() => collectTodayBriefArticles(items), [items]);
  const brief = useMemo(() => buildTodayDailyBrief(articles), [articles]);
  const [open, setOpen] = useState(false);

  const dismiss = useAndroidBackLayer(open, "today-news-brief", () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
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

  const overlay =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[9999] flex flex-col bg-kindle-bg text-kindle-text sm:bg-black/60 sm:items-center sm:justify-center sm:p-4 animate-in fade-in duration-200"
            style={{ width: "100vw", height: "100dvh", maxHeight: "100dvh" }}
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
              className="relative flex flex-col w-full h-full min-h-0 overflow-hidden bg-kindle-bg sm:h-auto sm:max-h-[88vh] sm:max-w-lg sm:rounded-2xl sm:border sm:border-kindle-border sm:bg-kindle-card sm:shadow-2xl sm:kora-safe-top sm:kora-safe-bottom animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Mobile: no top chrome — only a floating back control */}
              <button
                type="button"
                onClick={() => dismiss()}
                className="sm:hidden absolute z-20 left-[max(0.5rem,var(--kora-safe-left))] top-[max(0.5rem,var(--kora-safe-top))] p-2.5 rounded-full bg-kindle-card/90 border border-kindle-border text-kindle-text shadow-lg backdrop-blur-md"
                aria-label="Back"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              {/* Desktop / tablet header */}
              <header className="hidden sm:flex items-start gap-2 px-5 pt-4 pb-3 border-b border-kindle-border shrink-0">
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-sky-400 mb-1">
                    Daily News Brief
                  </p>
                  <h2 className="text-base font-lexend font-bold text-kindle-text">
                    Today&apos;s News Brief
                  </h2>
                  <p className="text-[10px] text-kindle-text-muted font-mono mt-1">
                    {storyCount} stories · {brief.sections.length} sources
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => dismiss()}
                  className="inline-flex p-2 rounded-xl border border-kindle-border text-kindle-text-muted hover:text-kindle-text shrink-0"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 pt-[calc(var(--kora-safe-top)+3.25rem)] sm:pt-4 pb-[calc(var(--kora-safe-bottom)+1.5rem)] sm:pb-6 space-y-5 min-h-0">
                <div className="sm:hidden space-y-1 mb-1">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-sky-400">
                    Daily News Brief
                  </p>
                  <h2 className="text-xl font-lexend font-bold text-kindle-text">
                    Today&apos;s News Brief
                  </h2>
                  <p className="text-[10px] text-kindle-text-muted font-mono">
                    {storyCount} stories · {brief.sections.length} sources
                  </p>
                </div>

                <p className="text-sm text-kindle-text leading-relaxed">{brief.lead}</p>

                {brief.sections.map((section) => (
                  <section key={section.source} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-sky-300">
                        {section.source}
                      </h3>
                      <span className="text-[9px] text-kindle-text-muted font-mono shrink-0">
                        {section.items.length} stor{section.items.length === 1 ? "y" : "ies"}
                      </span>
                    </div>
                    {section.intro ? (
                      <p className="text-[11px] text-kindle-text-muted leading-relaxed">{section.intro}</p>
                    ) : null}

                    <ul className="space-y-2.5">
                      {section.items.map((story) => (
                        <li
                          key={story.id}
                          className="rounded-xl border border-kindle-border/70 bg-kindle-card/60 sm:bg-kindle-bg/40 p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-lexend font-bold text-kindle-text leading-snug">
                                {story.headline}
                              </p>
                              <p className="text-[11px] text-kindle-text-muted leading-relaxed mt-1.5">
                                {story.detail}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => openStory(story.id, story.link)}
                              className="shrink-0 p-1.5 rounded-lg border border-kindle-border text-kindle-text-muted hover:text-kindle-text transition"
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
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left bg-gradient-to-br from-sky-950/40 to-kindle-card border border-sky-500/30 rounded-2xl p-4 hover:border-sky-400/50 transition"
      >
        <div className="flex items-center gap-2 mb-1">
          <Newspaper className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <p className="text-[9px] font-bold uppercase tracking-widest text-sky-400">Daily News Brief</p>
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
