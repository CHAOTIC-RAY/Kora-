/**
 * Comic/manga detail view — the Mihon manga screen, adapted for a source
 * that has no local library entry yet.
 *
 * This is the screen a manga result should open. The existing Discover
 * modal is an *ebook* sheet: it offers an EPUB download and Rave mirrors,
 * which is meaningless for a title that is read chapter by chapter from
 * the source site. This one shows the series first and the reader second.
 *
 * Section order follows Mihon's `MangaScreenItem`:
 *   INFO_BOX -> STATUS -> DESCRIPTION -> CHAPTER_HEADER -> CHAPTER rows
 *
 * Mihon has no volume concept (verified against its `chapter.sq`), so the
 * chapter list here is flat and ordered, with volume boundaries shown when
 * the source's chapter numbers imply them.
 */
import React, { useEffect, useMemo, useState } from "react";
import { X, BookOpen, Download, Check, AlertTriangle, Loader2, ExternalLink } from "lucide-react";
import { createSourceClient } from "../lib/sources/client";
import { getInstalledPlugins } from "../lib/sources/store";
import ComicReader from "./ComicReader";
import type { Chapter, Manga, MangaStatus, SourcePlugin } from "../lib/sources/types";

interface ComicDetailViewProps {
  book: any | null;
  onClose: () => void;
  /** Persist the series in the library so it can be resumed later. */
  onAddToLibrary?: (manga: Manga) => void;
  /** Progress keyed by `pluginId:url`, so resume survives a reload. */
  progress?: Record<string, { chapterIndex: number; pageNumber: number; totalPages: number }>;
}

/** A chapter open in the pager, or null when browsing the list. */
interface OpenChapter {
  chapter: Chapter;
  manga: Manga;
  pages: string[];
  index: number;
}

const STATUS_LABELS: Record<number, { label: string; tone: string }> = {
  0: { label: "Unknown", tone: "text-kindle-text-muted border-kindle-border" },
  1: { label: "Ongoing", tone: "text-emerald-600 border-emerald-500/40" },
  2: { label: "Completed", tone: "text-sky-600 border-sky-500/40" },
  3: { label: "Licensed", tone: "text-amber-600 border-amber-500/40" },
  4: { label: "Publishing", tone: "text-indigo-600 border-indigo-500/40" },
  5: { label: "Hiatus", tone: "text-amber-600 border-amber-500/40" },
  6: { label: "Cancelled", tone: "text-red-600 border-red-500/40" },
};

/**
 * Chapter numbers above this many count as a *volume* rather than a chapter.
 *
 * Real series number volumes this way ("Solo Leveling" running to 300+), so
 * the boundary is inferred from magnitude rather than declared. Wrong
 * inference is harmless here: it only changes a small label.
 */
const VOLUME_THRESHOLD = 100;

function chapterKey(pluginId: string, url: string) {
  return `${pluginId}:${url}`;
}

/** "Chapter 12.5" → "12.5", "Ch. 3" → "3", anything else → null. */
function chapterNumber(ch: Chapter): number | null {
  const m = (ch.name || "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

export default function ComicDetailView({
  book,
  onClose,
  onAddToLibrary,
  progress = {},
}: ComicDetailViewProps) {
  const [plugin, setPlugin] = useState<SourcePlugin | null>(null);
  const [manga, setManga] = useState<Manga | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [readChapters, setReadChapters] = useState<Set<string>>(new Set());
  const [busyChapter, setBusyChapter] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenChapter | null>(null);

  const pluginId = book?.pluginId as string | undefined;
  const seriesUrl = book?.sourceId as string | undefined;

  useEffect(() => {
    if (!pluginId) return;
    const found = getInstalledPlugins().find((p) => p.id === pluginId) || null;
    setPlugin(found);
  }, [pluginId]);

  useEffect(() => {
    let alive = true;
    if (!plugin || !book) {
      setManga(null);
      setChapters([]);
      return;
    }

    setLoading(true);
    setError("");
    const c = createSourceClient(plugin);

    (async () => {
      try {
        // Prefer the exact series the user tapped; fall back to a search so
        // a listing card that only carried a title still resolves.
        let found: Manga | null = null;
        if (seriesUrl) {
          const [slug] = String(seriesUrl).split("#")[1]?.split("?") ?? [];
          const hit = slug
            ? new URL(seriesUrl, plugin.baseUrl).pathname
            : seriesUrl;
          found = {
            url: hit,
            title: book.title,
            sourceId: plugin.id,
            thumbnailUrl: book.coverUrl,
            author: book.author,
            initialized: false,
          } as Manga;
        }
        if (!found) throw new Error("no series reference on this result");

        const detail = await c.details(found);
        if (!alive) return;
        setManga(detail);

        const chs = detail.initialized ? await c.chapters(detail) : [];
        if (!alive) return;
        setChapters(chs);
        if (chs.length === 0) {
          setError(
            "This site does not publish its chapter list in the page HTML — it builds it in the browser. A full reader needs to run in one."
          );
        }
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "Could not load this series");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [plugin, book, seriesUrl]);

  const status: MangaStatus = (manga?.status ?? 0) as MangaStatus;
  const statusInfo = STATUS_LABELS[status] ?? STATUS_LABELS[0];

  const ordered = useMemo(
    () =>
      [...chapters].sort((a, b) => {
        const na = a.chapterNumber;
        const nb = b.chapterNumber;
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return nb - na; // newest first
        return (b.dateUpload || 0) - (a.dateUpload || 0);
      }),
    [chapters]
  );

  /** Newest volume number present, when the numbers look volume-like. */
  const volumeLike = useMemo(() => {
    const nums = ordered.map(chapterNumber).filter((n): n is number => n !== null);
    if (nums.length && Math.max(...nums) >= VOLUME_THRESHOLD) {
      return Math.floor(Math.max(...nums));
    }
    return null;
  }, [ordered]);

  const totalChapters = ordered.length;
  const readCount = readChapters.size;

  const openChapter = async (ch: Chapter) => {
    if (!plugin || !manga) return;
    setBusyChapter(ch.url);
    try {
      const c = createSourceClient(plugin);
      const pages = await c.pages(ch, manga);
      if (pages.length === 0) {
        setError("That chapter returned no page images.");
        return;
      }
      setReadChapters((prev) => new Set(prev).add(chapterKey(plugin.id, ch.url)));
      setOpen({ chapter: ch, manga, pages: pages.map((p) => p.image), index: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that chapter");
    } finally {
      setBusyChapter(null);
    }
  };

  if (!book) return null;

  // Pager takes over the whole screen while a chapter is open.
  if (open) {
    return (
      <ComicReader
        pages={open.pages.map((url) => ({ url }))}
        chapter={{
          url: open.chapter.url,
          name: open.chapter.name,
          number: chapterNumber(open.chapter) ?? undefined,
        }}
        chapters={ordered.map((c) => ({
          url: c.url,
          name: c.name,
          number: chapterNumber(c) ?? undefined,
        }))}
        seriesTitle={book.title}
        rtl
        onClose={() => setOpen(null)}
        onChapterChange={(next) => {
          // The reader offers "next chapter" as a shortcut, so it has to
          // load for real. Wired to the same path as tapping a row;
          // without this the control was decorative.
          const match = ordered.find((c) => c.url === next.url);
          if (match) void openChapter(match);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl bg-kindle-card border border-kindle-border rounded-t-3xl sm:rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 my-auto">
        <button
          onClick={onClose}
          aria-label="Close series details"
          className="absolute top-4 right-4 p-2 bg-kindle-bg/80 hover:bg-kindle-bg border border-kindle-border rounded-full z-10 cursor-pointer"
        >
          <X className="w-4 h-4 text-kindle-text" />
        </button>

        <div className="p-6 md:p-8 space-y-5">
          {/* 1. INFO_BOX — cover, title, author, status, progress */}
          <div className="flex gap-4 pr-10">
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt=""
                className="w-24 sm:w-28 h-36 sm:h-44 object-cover rounded-xl border border-kindle-border shrink-0"
              />
            ) : (
              <div className="w-24 sm:w-28 h-36 sm:h-44 rounded-xl border border-kindle-border bg-kindle-bg shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <h3 className="text-xl sm:text-2xl font-lexend font-bold leading-tight text-kindle-text">
                {book.title}
              </h3>
              <p className="text-sm text-kindle-text-muted font-sans font-medium mt-1">
                {manga?.author || book.author || "Unknown"}
              </p>

              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                <span
                  className={`px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-widest ${statusInfo.tone}`}
                >
                  {loading ? "Checking…" : statusInfo.label}
                </span>
                <span className="px-2 py-0.5 rounded-full border border-kindle-border text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">
                  {book.source || plugin?.name || "Comic"}
                </span>
                {totalChapters > 0 && (
                  <span className="px-2 py-0.5 rounded-full border border-kindle-accent/40 text-[9px] font-bold uppercase tracking-widest text-kindle-accent">
                    {readCount}/{totalChapters} read
                  </span>
                )}
              </div>
            </div>
          </div>

          {book.description && (
            <p className="text-xs text-kindle-text-muted leading-relaxed line-clamp-4">
              {manga?.description || book.description}
            </p>
          )}

          {onAddToLibrary && manga && (
            <button
              onClick={() => onAddToLibrary(manga)}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:border-kindle-accent/50 transition"
            >
              <Download className="w-3.5 h-3.5" />
              Save to library
            </button>
          )}

          {/* 2. CHAPTER_HEADER */}
          {totalChapters > 0 && (
            <div className="flex items-center justify-between border-y border-kindle-border py-2">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                {volumeLike ? `${volumeLike} volumes · ${totalChapters} chapters` : `${totalChapters} chapters`}
              </h4>
              <span className="text-[9px] text-kindle-text-muted/70">newest first</span>
            </div>
          )}

          {/* 3. CHAPTER rows */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-kindle-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Loading chapters…</span>
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/40 bg-amber-500/5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 leading-relaxed">{error}</p>
            </div>
          ) : totalChapters === 0 ? (
            <p className="text-xs text-kindle-text-muted text-center py-8">
              No chapters available.
            </p>
          ) : (
            <ul className="max-h-[38vh] overflow-y-auto scrollbar-thin divide-y divide-kindle-border/60">
              {ordered.map((ch) => {
                const key = chapterKey(plugin?.id || "", ch.url);
                const read = readChapters.has(key);
                const num = chapterNumber(ch);
                const prog = progress[key];
                const busy = busyChapter === ch.url;
                return (
                  <li key={ch.url}>
                    <button
                      onClick={() => openChapter(ch)}
                      disabled={busy}
                      className="w-full flex items-center gap-3 px-1 py-2.5 text-left hover:bg-kindle-bg/60 transition disabled:opacity-50 cursor-pointer"
                    >
                      <span
                        className={`w-5 h-5 rounded-full grid place-items-center shrink-0 border ${
                          read
                            ? "bg-kindle-accent text-white border-kindle-accent"
                            : "border-kindle-border text-kindle-text-muted"
                        }`}
                      >
                        {read ? (
                          <Check className="w-3 h-3" />
                        ) : busy ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <BookOpen className="w-2.5 h-2.5" />
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-bold truncate">
                          {ch.name || (num !== null ? `Chapter ${num}` : "Chapter")}
                        </span>
                        <span className="block text-[10px] text-kindle-text-muted mt-0.5">
                          {prog
                            ? `page ${prog.pageNumber}/${prog.totalPages}`
                            : (ch as { scanlator?: string }).scanlator
                              ? ((ch as { scanlator?: string }).scanlator as string)
                              : "Unread"}
                        </span>
                      </span>
                      {num !== null && volumeLike && (
                        <span className="text-[9px] font-mono text-kindle-text-muted/70 shrink-0">
                          ch. {num}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {book.website && (
            <a
              href={book.website}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition"
            >
              <ExternalLink className="w-3 h-3" />
              Open on {book.source || "source site"}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
