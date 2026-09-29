/**
 * Series detail view — Mihon's manga screen, with volume grouping.
 *
 * Section order is Mihon's `MangaScreenItem` enum exactly:
 *   INFO_BOX → ACTION_ROW → DESCRIPTION_WITH_TAG → CHAPTER_HEADER → rows
 * Mihon renders a flat chapter list because it has no volume concept;
 * here the last section is a volume list, which is the one deliberate
 * difference.
 *
 * Progress is chapter-count based (`completed / total`) to match Mihon's
 * unread badge, not page-based — a resume page is shown on the row itself.
 */
import React from "react";
import { BookOpen, Check, Play, X, Layers, Clock } from "lucide-react";
import FluidOverlay from "./FluidOverlay";
import type { BookMetadata } from "../lib/firebase";
import type { LibraryGroup } from "../lib/seriesHelper";
import { parseSeriesNumber } from "../lib/seriesHelper";

interface SeriesDetailViewProps {
  group: LibraryGroup | null;
  onClose: () => void;
  onOpenVolume: (book: BookMetadata) => void;
  cachedIds?: Set<string>;
}

/** "3 of 12" / "Vol. 3" / the bare title when there is no number. */
function volumeLabel(book: BookMetadata, hasVolumes: boolean): string {
  const n = parseSeriesNumber(book.seriesNumber);
  if (!Number.isFinite(n)) return book.title;
  if (!hasVolumes) return `Vol. ${n}`;
  // Inside a series, the number is enough — the title repeats the name.
  return String(n);
}

function statusLabel(book: BookMetadata): string {
  const s = (book.status || "").toLowerCase();
  if (s === "completed") return "Completed";
  if (s === "reading") return "Reading";
  return "Not started";
}

export default function SeriesDetailView({
  group,
  onClose,
  onOpenVolume,
  cachedIds,
}: SeriesDetailViewProps) {
  if (!group) return null;

  const { representative: info, volumes } = group;
  const hasVolumes = volumes.length > 1;
  const kindLabel = info.kind === "comic" ? "Comic" : info.kind === "manga" ? "Manga" : "Series";

  /** Resume target: the current volume, else the first unread, else vol 1. */
  const nextUp =
    volumes.find((v) => v.status === "reading") ??
    volumes.find((v) => (v.progress?.percent || 0) > 0) ??
    volumes.find((v) => v.status !== "completed") ??
    volumes[0]!;

  return (
    <FluidOverlay
      open={!!group}
      onClose={onClose}
      variant="sheet"
      panelClassName="max-w-2xl p-0 overflow-hidden"
    >
      <div className="max-h-[88vh] overflow-y-auto">
        {/* 1. INFO_BOX — cover, title, author, status */}
        <div className="relative">
          {info.coverUrl && (
            <div className="absolute inset-0 overflow-hidden">
              <img
                src={info.coverUrl}
                alt=""
                className="w-full h-full object-cover opacity-20 blur-2xl scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-kindle-bg via-kindle-bg/90 to-kindle-bg/50" />
            </div>
          )}
          <div className="relative flex gap-4 p-5">
            {info.coverUrl && (
              <img
                src={info.coverUrl}
                alt=""
                className="w-24 h-32 object-cover rounded-lg shadow-lg shrink-0 border border-kindle-border"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-lexend font-bold text-xl leading-tight">{group.title}</h2>
                <button
                  onClick={onClose}
                  aria-label="Close series details"
                  className="p-1.5 hover:bg-kindle-card rounded-lg shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs text-kindle-text-muted mt-1">
                {info.author || "Unknown author"}
              </p>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span className="px-2 py-0.5 rounded-full border border-kindle-border text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">
                  {kindLabel}
                </span>
                <span className="px-2 py-0.5 rounded-full border border-kindle-border text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">
                  {statusLabel(nextUp)}
                </span>
                <span className="px-2 py-0.5 rounded-full border border-kindle-accent/40 text-[9px] font-bold uppercase tracking-widest text-kindle-accent">
                  {group.completed}/{group.total} read
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. ACTION_ROW — continue is the primary action */}
        <div className="px-5 pb-4">
          <button
            onClick={() => onOpenVolume(nextUp)}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-kindle-text text-kindle-bg font-bold text-[10px] uppercase tracking-widest transition hover:opacity-90"
          >
            <Play className="w-3.5 h-3.5" />
            {group.reading > 0 || group.completed > 0
              ? `Continue — ${volumeLabel(nextUp, hasVolumes)}`
              : `Start reading — ${volumeLabel(nextUp, hasVolumes)}`}
          </button>
        </div>

        {/* 3. DESCRIPTION_WITH_TAG — description, then tags */}
        {(info.description || info.tags?.length > 0) && (
          <div className="px-5 pb-4">
            {info.description && (
              <p className="text-xs text-kindle-text-muted leading-relaxed line-clamp-4">
                {info.description}
              </p>
            )}
            {info.tags && info.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {info.tags.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded-full bg-kindle-card border border-kindle-border text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 4. CHAPTER_HEADER — count, plus what is left */}
        <div className="flex items-center justify-between px-5 py-2.5 border-y border-kindle-border bg-kindle-card/50">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted inline-flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            {hasVolumes ? `${group.total} volumes` : "Files"}
          </h3>
          {group.toRead > 0 && (
            <span className="text-[9px] font-bold uppercase tracking-widest text-kindle-accent">
              {group.toRead} unread
            </span>
          )}
        </div>

        {/* 5. Volume rows */}
        <ul>
          {volumes.map((v) => {
            const n = parseSeriesNumber(v.seriesNumber);
            const done = v.status === "completed";
            const started = !done && (v.progress?.percent || 0) > 0;
            const cached = cachedIds?.has(v.id);
            return (
              <li key={v.id}>
                <button
                  onClick={() => onOpenVolume(v)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-kindle-card transition text-left border-b border-kindle-border/60 last:border-0"
                >
                  <span
                    className={`w-6 h-6 rounded-full grid place-items-center shrink-0 border ${
                      done
                        ? "bg-kindle-accent text-white border-kindle-accent"
                        : started
                          ? "border-kindle-accent text-kindle-accent"
                          : "border-kindle-border text-kindle-text-muted"
                    }`}
                  >
                    {done ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : started ? (
                      <BookOpen className="w-3 h-3" />
                    ) : (
                      <span className="text-[9px] font-bold">{Number.isFinite(n) ? n : ""}</span>
                    )}
                  </span>

                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-bold truncate">
                      {hasVolumes ? `Volume ${volumeLabel(v, hasVolumes)}` : v.title}
                    </span>
                    <span className="block text-[10px] text-kindle-text-muted mt-0.5 inline-flex items-center gap-1.5">
                      {done && "Completed"}
                      {started && (
                        <>
                          {Math.round(v.progress?.percent || 0)}% read
                          {v.progress?.pageNumber && v.progress?.totalPages
                            ? ` · page ${v.progress.pageNumber}/${v.progress.totalPages}`
                            : ""}
                        </>
                      )}
                      {!done && !started && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {v.year || "Not started"}
                        </span>
                      )}
                    </span>
                  </span>

                  {!cached && v.extension && v.extension !== "audiobook" && (
                    <span className="text-[8px] font-bold uppercase tracking-widest text-kindle-text-muted/60 shrink-0">
                      Remote
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </FluidOverlay>
  );
}
