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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, BookOpen, Download, Check, AlertTriangle, Loader2, ExternalLink } from "lucide-react";
import { createSourceClient } from "../lib/sources/client";
import { getInstalledPlugins } from "../lib/sources/store";
import { loadProgress, saveProgress, resumePage, type ComicProgressMap } from "../lib/comicProgress";
import { resolveCoverImageSrc } from "../lib/coverImage";
import { indexForDisplayed, displayedPage } from "../lib/readingDirection";
import { detectFormat, type Detection } from "../lib/formats/detect";
import { openArchive, releaseArchive, describeArchive, type ArchiveHandle } from "../lib/formats/archive";
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
  /**
   * What the pages really are, from bytes.
   *
   * A Madara chapter is a list of CDN image URLs, which is a *known* shape and
   * not a guess, so it is labelled honestly as remote images. An archive
   * carries the real verdict from `detectFormat` instead, which is what puts
   * "CBZ" in the reader's top bar next to a comic that came out of a ZIP.
   */
  formatLabel?: string;
  /** Object URLs to revoke when this chapter closes. Undefined for CDN pages. */
  handle?: ArchiveHandle | null;
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

/** Reading direction, declared once so the reader and the resume maths agree. */
const READER_RTL = true;

/**
 * "Chapter 12.5" → "12.5", "Ch. 3" → "3", anything else → null. */
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
  /**
   * Stored read positions, keyed `pluginId:url`.
   *
   * The `progress` prop already had this shape, but nothing ever passed it,
   * so the resume path was dead: reopening a half-read chapter started on
   * page 1 every time. It is read from the same store on mount and updated
   * as the reader reports pages, so the resume survives a reload rather
   * than just a remount. A `progress` prop, when supplied, still wins —
   * a parent that tracks position itself is more authoritative than disk.
   */
  const [stored, setStored] = useState<ComicProgressMap>({});
  useEffect(() => {
    setStored(loadProgress());
  }, []);

  const effectiveProgress = useMemo<ComicProgressMap>(
    () => ({ ...stored, ...progress }),
    [stored, progress]
  );

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
      // Resume where the reader left off. The stored position is a
      // *displayed* page number, and the reader's initialIndex is a source
      // array index, which in a right-to-left book is the mirror — so the
      // conversion has to go through the direction rules, not through
      // arithmetic here, or the chapter reopens on the wrong side.
      const key = chapterKey(plugin.id, ch.url);
      const page = resumePage(effectiveProgress, key, pages.length);
      const startIndex =
        page > 0 ? indexForDisplayed({ rtl: READER_RTL, total: pages.length, page }) : 0;
      setOpen({
        chapter: ch,
        manga,
        pages: pages.map((p) => p.image),
        index: startIndex,
        // These are CDN image URLs: a known shape, not a guess, so it is
        // labelled as what it is instead of being left blank.
        formatLabel: `${pages.length} image pages`,
        handle: null,
      });
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
        formatLabel={open.formatLabel}
        rtl={READER_RTL}
        initialIndex={open.index}
        onIndexChange={(i) => {
          // Persist every page turn so closing the reader — by the close
          // button, the hardware Back, or a chapter change — leaves a
          // resumable position behind. The reader reports a source array
          // index; what gets stored is the displayed page, because that is
          // the only form `resumePage` and the chapter-list badge agree on.
          if (!plugin) return;
          const key = chapterKey(plugin.id, open.chapter.url);
          const entry = {
            chapterIndex: ordered.findIndex((c) => c.url === open.chapter.url),
            pageNumber: displayedPage({
              rtl: READER_RTL,
              total: open.pages.length,
              index: i,
            }),
            totalPages: open.pages.length,
          };
          saveProgress(key, entry);
          setStored((prev) => ({ ...prev, [key]: entry }));
        }}
        onClose={() => {
          // Revoking on close, not on unmount. Object URLs are held by the
          // document until explicitly revoked, so an archive opened ten times
          // leaks every page of all ten — on a phone that is the OOM, not the
          // slow read.
          releaseArchive(open.handle);
          setOpen(null);
        }}
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
            {(() => {
              // The listing card's `coverUrl` is whatever the search result
              // carried, which for a source that lazy-loads covers is often a
              // placeholder or missing. `details()` resolves the real image,
              // so prefer that and fall back to the card.
              const cover = manga?.thumbnailUrl || book.coverUrl;
              // Resolved, not used raw: a source cover is a plugin image and
              // hits the same hotlink wall and DNS filters as a page, so it
              // takes the Worker relay like everything else from a source.
              return cover ? (
                <img
                  src={resolveCoverImageSrc(cover) || ""}
                  alt=""
                  className="w-24 sm:w-28 h-36 sm:h-44 object-cover rounded-xl border border-kindle-border shrink-0"
                />
              ) : (
                <div className="w-24 sm:w-28 h-36 sm:h-44 rounded-xl border border-kindle-border bg-kindle-bg shrink-0" />
              );
            })()}
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

          {/* Guarded on the merged value, never on `book.description` alone.
              `book` is the search result the user tapped, and a search result
              carries no synopsis — the description arrives from `details()`
              onto `manga`. Testing `book` alone therefore hid the entire
              section for every source that parses one correctly, which is
              why the sheet showed no synopsis at all. */}
          {(manga?.description || book.description) && (
            <div>
              <h4 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                Synopsis
              </h4>
              <p className="comic-detail-synopsis text-xs text-kindle-text-muted leading-relaxed whitespace-pre-wrap">
                {manga?.description || book.description}
              </p>
            </div>
          )}

          {(manga?.genres?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {manga!.genres!.map((g) => (
                <span
                  key={g}
                  className="px-2 py-0.5 rounded-full border border-kindle-border text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Start/Resume. The chapter list is below, but it is capped at 38vh
              and sorted newest-first, so on a 700-chapter series the first
              chapter the user wants is far off-screen. This is the one action
              that has to work without scrolling. */}
          {(() => {
            // Resume target: the chapter furthest along that actually has a
            // stored position, else the oldest chapter (the natural entry
            // point). Scanned by chapter order rather than "first match" so a
            // user who read out of order still lands where they were.
            const target =
              [...ordered]
                .reverse()
                .find((c) => effectiveProgress[chapterKey(plugin?.id || "", c.url)]) || ordered[ordered.length - 1];
            if (!target) return null;
            const key = chapterKey(plugin?.id || "", target.url);
            const at = effectiveProgress[key];
            const resuming = Boolean(at);
            return (
              <button
                onClick={() => void openChapter(target)}
                disabled={busyChapter === target.url}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-kindle-accent text-white text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
              >
                {busyChapter === target.url ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <BookOpen className="w-3.5 h-3.5" />
                )}
                {resuming
                  ? `Continue · ${target.name || `Chapter ${chapterNumber(target) ?? ""}`} p${at.pageNumber}`
                  : "Start reading"}
              </button>
            );
          })()}

          {/* The format rules live on the Workshop upload card now; this
              screen no longer repeats them. */}

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
                const prog = effectiveProgress[key];
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
