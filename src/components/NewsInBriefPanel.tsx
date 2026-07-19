import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { FeedItem } from "../lib/feedStorage";
import {
  BriefFeedItem,
  briefsForPeriod,
  buildBriefDateChips,
  toBriefFeedItems,
} from "../lib/feedBriefs";
import { getItemThumbnail } from "../lib/feedPreview";
import { textDirection } from "../lib/textDirection";

interface NewsInBriefPanelProps {
  items: FeedItem[];
  selectedSourceId?: string | null;
  onRead: (item: FeedItem) => void;
}

function BriefCard({
  item,
  onRead,
}: {
  item: BriefFeedItem;
  onRead: () => void;
}) {
  const cover = getItemThumbnail(item);
  const title = item.title.trim();
  const dir = textDirection(title);

  return (
    <article className="bg-kindle-card border border-kindle-border rounded-2xl overflow-hidden flex flex-col h-full">
      {cover ? (
        <div className="w-full aspect-[16/9] bg-kindle-bg overflow-hidden">
          <img src={cover} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        </div>
      ) : null}
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="space-y-1">
          <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">
            {item.subscriptionTitle}
          </p>
          <h3 className="text-sm font-lexend font-bold text-kindle-text leading-snug" dir={dir}>
            {title}
          </h3>
          {item.summary ? (
            <p className="text-xs text-kindle-text-muted leading-relaxed line-clamp-3" dir={textDirection(item.summary)}>
              {item.summary}
            </p>
          ) : null}
        </div>
        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={onRead}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Read
          </button>
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-3 py-2.5 rounded-xl border border-kindle-border text-kindle-text-muted hover:text-kindle-text transition"
            title="Open in browser"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

export default function NewsInBriefPanel({ items, selectedSourceId, onRead }: NewsInBriefPanelProps) {
  const briefs = useMemo(() => {
    const filtered = selectedSourceId
      ? items.filter((item) => item.subscriptionId === selectedSourceId)
      : items;
    return toBriefFeedItems(filtered);
  }, [items, selectedSourceId]);

  const dateChips = useMemo(() => buildBriefDateChips(briefs), [briefs]);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);

  useEffect(() => {
    if (!dateChips.length) {
      setSelectedPeriodKey(null);
      return;
    }
    if (!selectedPeriodKey || !dateChips.some((chip) => chip.key === selectedPeriodKey)) {
      setSelectedPeriodKey(dateChips[0].key);
    }
  }, [dateChips, selectedPeriodKey]);

  const selectedBriefs = useMemo(
    () => (selectedPeriodKey ? briefsForPeriod(briefs, selectedPeriodKey) : []),
    [briefs, selectedPeriodKey]
  );

  if (!briefs.length) {
    return (
      <div className="bg-kindle-card border border-kindle-border rounded-2xl p-10 text-center">
        <h3 className="text-lg font-lexend font-bold mb-2">No briefs yet</h3>
        <p className="text-sm text-kindle-text-muted max-w-md mx-auto">
          News-in-brief roundups from your subscribed sources will appear here after the next feed refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-lexend font-bold text-kindle-text mb-1">News in Brief</h2>
        <p className="text-[10px] text-kindle-text-muted uppercase tracking-wider font-mono">
          Daily roundups from all your sources
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none -mx-1 px-1">
        {dateChips.map((chip) => {
          const selected = chip.key === selectedPeriodKey;
          const hasBriefs = briefs.some((brief) => brief.briefPeriod.key === chip.key);
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setSelectedPeriodKey(chip.key)}
              className={`relative shrink-0 w-[4.5rem] h-[4.75rem] rounded-xl border flex flex-col items-center justify-center transition ${
                selected
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 shadow-sm"
                  : "border-kindle-border bg-kindle-card text-kindle-text hover:border-kindle-text"
              }`}
            >
              {hasBriefs && !selected ? (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-blue-400" />
              ) : null}
              {selected ? (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-blue-600" />
              ) : null}
              <span className="text-2xl font-lexend font-bold leading-none">{chip.dayLabel}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted mt-1">
                {chip.monthLabel}
              </span>
            </button>
          );
        })}
      </div>

      {selectedBriefs.length === 0 ? (
        <div className="bg-kindle-card border border-dashed border-kindle-border rounded-2xl p-8 text-center text-sm text-kindle-text-muted">
          No briefs for this date.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {selectedBriefs.map((item) => (
            <BriefCard key={item.id} item={item} onRead={() => onRead(item)} />
          ))}
        </div>
      )}
    </div>
  );
}
