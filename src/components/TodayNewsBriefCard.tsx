import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Newspaper } from "lucide-react";
import type { FeedItem } from "../lib/feedStorage";
import { collectTodayBriefArticles, buildTodayDailyBrief } from "../lib/dailyNewsBriefClient";

interface TodayNewsBriefCardProps {
  items: FeedItem[];
  onReadArticle: (item: FeedItem) => void;
}

export default function TodayNewsBriefCard({ items, onReadArticle }: TodayNewsBriefCardProps) {
  const articles = useMemo(() => collectTodayBriefArticles(items), [items]);
  const brief = useMemo(() => buildTodayDailyBrief(articles), [articles]);
  const [expanded, setExpanded] = useState(false);

  if (!brief) return null;

  const storyCount = brief.sections.reduce((total, section) => total + section.items.length, 0);

  const openStory = (storyId: string, link: string) => {
    const article = items.find((item) => item.id === storyId);
    if (article) {
      onReadArticle(article);
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
  };

  return (
    <article className="bg-gradient-to-br from-blue-950/40 to-kindle-card border border-blue-500/30 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full text-left p-4 hover:bg-blue-950/20 transition"
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Newspaper className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <p className="text-[9px] font-bold uppercase tracking-widest text-blue-400">
                Daily News Brief
              </p>
            </div>
            <h3 className="text-sm font-lexend font-bold text-kindle-text mb-2">
              Today&apos;s News Brief
            </h3>
            <p className={`text-xs text-kindle-text-muted leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
              {brief.lead}
            </p>
            {!expanded && (
              <p className="text-[10px] text-kindle-text-muted/80 mt-2 font-mono">
                {storyCount} stories · {brief.sections.length} sources
              </p>
            )}
          </div>
          <div className="shrink-0 p-1.5 rounded-lg border border-kindle-border/60 text-kindle-text-muted">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-blue-500/20">
          <p className="text-xs text-kindle-text leading-relaxed pt-3">{brief.lead}</p>

          {brief.sections.map((section) => (
            <section key={section.source} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-blue-300">
                  {section.source}
                </h4>
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

          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="w-full py-2 text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-text transition"
          >
            Collapse brief
          </button>
        </div>
      )}
    </article>
  );
}
