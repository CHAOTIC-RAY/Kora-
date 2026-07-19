import React, { useMemo, useState } from "react";
import { ExternalLink, Newspaper, X } from "lucide-react";
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

  useAndroidBackLayer(open, "today-news-brief", () => setOpen(false));

  if (!brief) return null;

  const storyCount = brief.sections.reduce((total, section) => total + section.items.length, 0);

  const openStory = (storyId: string, link: string) => {
    const article = items.find((item) => item.id === storyId);
    setOpen(false);
    if (article) {
      onReadArticle(article);
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left bg-gradient-to-br from-blue-950/40 to-kindle-card border border-blue-500/30 rounded-2xl p-4 hover:border-blue-400/50 transition"
      >
        <div className="flex items-center gap-2 mb-1">
          <Newspaper className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <p className="text-[9px] font-bold uppercase tracking-widest text-blue-400">
            Daily News Brief
          </p>
        </div>
        <h3 className="text-sm font-lexend font-bold text-kindle-text mb-2">
          Today&apos;s News Brief
        </h3>
        <p className="text-xs text-kindle-text-muted leading-relaxed line-clamp-2">{brief.lead}</p>
        <p className="text-[10px] text-kindle-text-muted/80 mt-2 font-mono">
          {storyCount} stories · {brief.sections.length} sources · Tap for full brief
        </p>
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close brief"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full sm:max-w-lg max-h-[88vh] bg-kindle-card border border-kindle-border rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-8 sm:zoom-in duration-200">
            <div className="w-12 h-1 bg-kindle-border rounded-full mx-auto mt-3 sm:hidden shrink-0" />

            <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-kindle-border shrink-0">
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-blue-400 mb-1">
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
                onClick={() => setOpen(false)}
                className="p-2 rounded-xl border border-kindle-border text-kindle-text-muted hover:text-kindle-text shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <p className="text-sm text-kindle-text leading-relaxed">{brief.lead}</p>

              {brief.sections.map((section) => (
                <section key={section.source} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-blue-300">
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
                        className="rounded-xl border border-kindle-border/70 bg-kindle-bg/40 p-3"
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
        </div>
      )}
    </>
  );
}
