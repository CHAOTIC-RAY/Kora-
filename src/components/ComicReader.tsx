/**
 * A webtoon/manga page reader built to match Tachiyomi and Mihon.
 *
 * What the old inline pager in ComicDetailView had: a Next button, a Prev
 * button, and two arrow keys. That works on a desktop with a mouse and is
 * close to useless on the device the app is actually read on.
 *
 * Behaviour taken from Tachiyomi's reader (viewer/`ReaderActivity` and the
 * `Pager`/`Continuity` view modes):
 *
 *   - Tap zones. A tap in the left third goes back, the right third goes
 *     forward, and the middle third toggles the control bars. Without this,
 *     a phone user has no way to advance a page at all.
 *   - Swipe to turn. Horizontal drag, with velocity deciding whether a
 *     short flick still turns. Pointer Events, so one handler covers mouse,
 *     touch and pen.
 *   - Right-to-left reading. Manga is read right to left in most of the
 *     world, and Tachiyomi's `direction` setting is per-source. In RTL,
 *     "forward" is a swipe to the left.
 *   - Continuous vertical scroll. Webtoons are one long strip rather than
 *     discrete pages; the Tachiyomi `Continuity` mode. Off by default,
 *     on when the source declares `webtoon: true`.
 *   - Preloading. Neighbouring pages are decoded ahead of the turn, because
 *     a comic page is a large image and a blank flash reads as a crash.
 *   - Tap-to-zoom, double-tap to zoom on the point that was tapped, pinch
 *     to zoom, and drag to pan while zoomed.
 *   - Page slider to jump within a chapter, and the volume/chapter label
 *     so the reader says where you are.
 *
 * Progress is reported upward so the detail view can mark a chapter read
 * and remember the page.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, List, Minus, Plus } from "lucide-react";
import {
  initialIndex as firstPage,
  stepForward as nextIndex,
  stepBack as prevIndex,
  displayedPage,
  indexForDisplayed,
  swipeDirection,
  tapAction as resolveTap,
  canAct,
} from "../lib/readingDirection";
import { PreloadQueue } from "../lib/preloadQueue";
import { useBackButton } from "../lib/useBackButton";
import ReaderPageImage from "./ReaderPageImage";

export interface ReaderPage {
  /** Absolute page image URL. */
  url: string;
  /** Page number as the source numbered it, if it did. */
  number?: number;
}

export interface ReaderChapter {
  url: string;
  name: string;
  /** Chapter index in the parent list, for "3 of 40". */
  number?: number;
  dateUpload?: number;
}

export interface ComicReaderProps {
  pages: ReaderPage[];
  chapter: ReaderChapter;
  /** Whole-series chapter list, so the reader can step between chapters. */
  chapters?: ReaderChapter[];
  /** Start here when reopening a partially read chapter. */
  initialIndex?: number;
  /** True for right-to-left series — the common manga default. */
  rtl?: boolean;
  /** True for webtoons: one tall image, scrolled rather than paged. */
  webtoon?: boolean;
  onIndexChange?: (index: number) => void;
  onChapterChange?: (chapter: ReaderChapter) => void;
  /** A page image failed to load. The reader stays open; this is a notice. */
  onPageError?: (url: string) => void;
  onClose: () => void;
  /** Shown top-left; the reader must not know about series state. */
  seriesTitle?: string;
}

/** Fraction of viewport width a drag must cross to count as a turn. */
const SWIPE_DISTANCE_RATIO = 0.22;
/** px/ms — a flick this fast turns even if it is short. */
const SWIPE_VELOCITY = 0.35;
/** Neighbours decoded ahead of the current page. */
const PRELOAD_AHEAD = 2;
const PRELOAD_BEHIND = 1;

export function ComicReader({
  pages,
  chapter,
  chapters = [],
  initialIndex = 0,
  rtl = true,
  webtoon = false,
  onIndexChange,
  onChapterChange,
  onPageError,
  onClose,
  seriesTitle,
}: ComicReaderProps) {
  // Where the chapter opens. A right-to-left manga opens on its *last* page
  // because reading runs backwards through the source array; the rule lives
  // in readingDirection.ts and is covered by tests.
  const [index, setIndex] = useState(() => {
    if (initialIndex > 0) return Math.min(initialIndex, Math.max(0, pages.length - 1));
    return firstPage({ rtl, total: pages.length });
  });
  const [chromeVisible, setChromeVisible] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showSlider, setShowSlider] = useState(false);

  // Preloaded image cache, keyed by URL. Kept outside state because it is
  // a side effect, and touching it must not re-render the reader.
  //
  // This is a bounded LRU, not a Set. The previous Set only ever grew:
  // nothing evicted, and the `Image` created for each page kept its decoded
  // bitmap alive for as long as the reader was mounted, so reading a long
  // series grew the cache without limit until the tab was killed. The queue
  // also remembers failures so a 404 is not re-requested on every turn.
  const preloaded = useRef<PreloadQueue>(new PreloadQueue({ capacity: 8 }));
  const containerRef = useRef<HTMLDivElement | null>(null);

  const total = pages.length;
  const clamped = Math.min(Math.max(0, index), Math.max(0, total - 1));

  const goTo = useCallback(
    (next: number) => {
      const target = Math.min(Math.max(0, next), Math.max(0, total - 1));
      setIndex(target);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      onIndexChange?.(target);
    },
    [total, onIndexChange]
  );

  /**
   * In RTL, "forward" is a step of -1. Every control routes through here so
   * the direction is defined exactly once.
   */
  const forward = useCallback(
    () => goTo(nextIndex({ rtl, total, index: clamped })),
    [goTo, clamped, rtl, total]
  );
  const back = useCallback(
    () => goTo(prevIndex({ rtl, total, index: clamped })),
    [goTo, clamped, rtl, total]
  );

  /**
   * The page as the reader experiences it.
   *
   * The page array is in source order, which for a right-to-left manga is
   * the reverse of reading order, so the raw index would count backwards
   * from the reader's point of view — showing "1 / 9" on the page you just
   * opened and climbing to "9 / 9" as you read. Everything the user sees
   * goes through this.
   */
  const shown = displayedPage({ rtl, total, index: clamped });

  /**
   * Called when a page definitively failed. Records the failure so the
   * preload loop stops re-requesting it on every turn, and reports upward
   * so the detail view can drop its stored resume point for a page that
   * cannot be shown.
   */
  const onPageFailure = useCallback(
    (url: string) => {
      preloaded.current.markFailed(url);
      onPageError?.(url);
    },
    [onPageError]
  );

  /**
   * The user asked to retry a failed page. Clearing the recorded failure
   * matters: it is what lets this page preload normally again, and what
   * stops a transient network blip from barring a page for the rest of the
   * session. The decode itself is re-run by the page component against a
   * cache-busted URL.
   */
  const onPageRetry = useCallback((url: string) => {
    preloaded.current.clearFailure(url);
  }, []);

  // Neighbour preloading. A comic page is a big image; decoding it on the
  // turn is what makes paging feel like it stutters.
  useEffect(() => {
    const ahead = rtl ? -1 : 1;
    for (let d = -PRELOAD_BEHIND; d <= PRELOAD_AHEAD; d++) {
      const i = clamped + d * ahead;
      if (i < 0 || i >= total) continue;
      const url = pages[i]?.url;
      // `shouldPreload` is false for a page already cached and for one that
      // has already failed, which is what stops a dead CDN being hammered.
      if (!url || !preloaded.current.shouldPreload(url)) continue;
      preloaded.current.add(url);
      const img = new Image();
      img.onerror = () => preloaded.current.markFailed(url);
      img.src = url;
    }
  }, [clamped, total, pages, rtl]);

  // Release every retained bitmap when the reader goes away. Without this
  // the decoded pages outlive the component and the next reader starts cold.
  useEffect(() => {
    const queue = preloaded.current;
    return () => queue.clear();
  }, []);

  // The phone's Back button must close the reader rather than navigating the
  // whole app away and losing your place mid-chapter. A synthetic history
  // entry is pushed while the reader is open and popped when it closes.
  useBackButton(onClose, true);

  // Keyboard. Arrows follow the reading direction, Escape closes, and the
  // Home/End keys jump to a chapter edge.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        rtl ? back() : forward();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        rtl ? forward() : back();
      } else if (e.key === "Escape") {
        onClose();
      } else if (e.key === " ") {
        e.preventDefault();
        forward();
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goTo(total - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [forward, back, goTo, total, onClose, rtl]);

  // ---- gestures ---------------------------------------------------------
  const drag = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startT: number;
    axis: "none" | "x" | "y";
  }>({ active: false, startX: 0, startY: 0, startT: 0, axis: "none" });

  // Pinch state, tracked as a two-pointer distance ratio.
  const pinch = useRef<{ active: boolean; startDist: number; startZoom: number }>({
    active: false,
    startDist: 0,
    startZoom: 1,
  });
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  /** Set after a swipe so the trailing synthesised click does not also turn a page. */
  const suppressClick = useRef(false);

  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const onPointerDown = (e: React.PointerEvent) => {
    // Capture only for a mouse. Capturing a *touch* pointer redirects the
    // rest of the stream to the capturing element, and Chrome then drops
    // the intermediate moves — the gesture arrives as a single jump with no
    // `pointerup`, so the swipe never completes. Touch already routes to
    // this element, so it needs no help.
    if (e.pointerType === "mouse") {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      pinch.current = {
        active: true,
        startDist: distance(pts[0], pts[1]),
        startZoom: zoom,
      };
      drag.current.active = false;
      return;
    }
    drag.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startT: Date.now(),
      axis: "none",
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Pinch to zoom, and keep the midpoint anchored so the page grows
    // around the fingers rather than drifting to the top-left.
    if (pinch.current.active) {
      const pts = [...pointers.current.values()];
      if (pts.length !== 2) return;
      const d = distance(pts[0], pts[1]);
      if (!pinch.current.startDist) return;
      const next = Math.min(4, Math.max(1, (pinch.current.startZoom * d) / pinch.current.startDist));
      setZoom(next);
      return;
    }

    if (!drag.current.active || zoom > 1.05) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    // Lock to one axis so a diagonal scroll does not turn a page.
    if (drag.current.axis === "none" && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      drag.current.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current.active = false;

    if (!drag.current.active) return;
    drag.current.active = false;

    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    const dt = Math.max(1, Date.now() - drag.current.startT);
    const vx = Math.abs(dx) / dt;

    // A vertical drag while zoomed pans the image rather than turning.
    if (zoom > 1.05) {
      if (drag.current.axis === "y") setPan((p) => ({ ...p, y: p.y - dy }));
      return;
    }

    if (drag.current.axis !== "x") return;
    const threshold = (containerRef.current?.clientWidth ?? window.innerWidth) * SWIPE_DISTANCE_RATIO;
    const flicked = vx > SWIPE_VELOCITY;

    if (Math.abs(dx) > threshold || flicked) {
      // A drag towards the start of the book moves forward. Reading order
      // decides which way that is: in a right-to-left manga you advance by
      // dragging the page leftwards, the way a physical book turns, while
      // left-to-right is the mirror of that.
      const { advancing } = swipeDirection(dx, rtl);
      if (advancing) forward();
      else back();
      // Suppress the click that a browser synthesises at the end of a drag,
      // otherwise every swipe also trips a tap zone and skips a page.
      suppressClick.current = true;
    }
  };

  /**
   * Abandon whatever gesture is in flight.
   *
   * Covers `pointercancel` (the browser or OS took the pointer — a system
   * edge-swipe, a notification, a scroll it decided to own) and
   * `lostpointercapture` (the element lost capture, which fires without a
   * preceding `pointerup` when a capture is released abnormally).
   *
   * Every piece of gesture state has to be dropped. Leaving `drag.active`
   * true means the *next* `pointerdown`-less `pointermove` is measured
   * against the interrupted drag's start point, so the page turns by some
   * random distance. Leaving the pinch latched means every subsequent
   * one-finger move is read as a two-finger zoom and the page grows without
   * the reader touching it. And `suppressClick` must be cleared too: a
   * cancelled gesture produces no click to suppress, so a stale `true` here
   * silently eats the reader's *next* deliberate tap.
   */
  const abortGesture = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current.active = false;
    drag.current.active = false;
    drag.current.axis = "none";
    suppressClick.current = false;
    lastTap.current = 0;
  };

  /**
   * Double-tap to zoom.
   *
   * React's `onDoubleClick` cannot be used here. Chrome only synthesises a
   * dblclick when both clicks land on the same element without the pointer
   * moving, and on a touch device the first tap's handler mutates state
   * before the second arrives — so the zoom never fired and the reader just
   * toggled its bars twice. Timing it by hand also lets a real double-tap
   * work with a touch, which the native event does not.
   */
  const lastTap = useRef(0);

  /**
   * Zoom in on a point, or back out if already zoomed. Centred on the tap
   * so the detail under the finger is what grows.
   */
  const toggleZoomAt = (clientX: number, clientY: number) => {
    if (zoom > 1.05) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = 2.5;
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    setZoom(next);
    setPan({ x: -cx * (next - 1) * 0.5, y: -cy * (next - 1) * 0.5 });
  };
  const onClickCapture = (e: React.MouseEvent) => {
    // A drag that ended a moment ago fires a click as well; acting on it
    // would turn two pages for one swipe.
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    // A second tap inside the double-tap window zooms instead of paging.
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      toggleZoomAt(e.clientX, e.clientY);
      return;
    }
    lastTap.current = now;
    if (zoom > 1.05) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    // The zones are laid out in reading order: the far side of the screen
    // is the far side of the book. In a right-to-left manga the next page
    // is to the left, matching a leftward swipe.
    const action = resolveTap(frac, rtl);
    if (action === "forward") forward();
    else if (action === "back") back();
    else setChromeVisible((v) => !v);
  };

  // Step to the adjacent chapter, for the arrows in the page label.
  const stepChapter = (dir: 1 | -1) => {
    if (!chapters.length) return;
    const pos = chapters.findIndex((c) => c.url === chapter.url);
    if (pos < 0) return;
    const next = chapters[pos + dir];
    if (!next) return;
    onChapterChange?.(next);
  };

  const label = chapter.number ? `Chapter ${chapter.number}` : chapter.name;
  const posInSeries = chapter.number
    ? `${chapter.number}${chapters.length ? ` / ${chapters.length}` : ""}`
    : "";

  if (!total) {
    return (
      <div className="fixed inset-0 z-[10000] bg-black flex flex-col items-center justify-center gap-3">
        <p className="text-[11px] uppercase tracking-widest text-white/60">
          This chapter has no pages
        </p>
        <button
          onClick={onClose}
          className="px-4 py-2 border border-white/25 rounded-lg text-[10px] font-bold uppercase tracking-widest text-white/80"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[10000] bg-black flex flex-col select-none">
      {/* top bar */}
      {chromeVisible && (
        <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-3 px-3 py-2 bg-gradient-to-b from-black/85 to-transparent pointer-events-none">
          <button
            onClick={onClose}
            aria-label="Close reader"
            className="pointer-events-auto inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="flex flex-col items-center min-w-0 px-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/90 truncate">
              {seriesTitle ? `${seriesTitle} · ` : ""}
              {label}
            </span>
            {posInSeries && (
              <span className="text-[9px] text-white/50 font-mono">{posInSeries}</span>
            )}
          </div>
          <button
            onClick={() => setShowSlider((v) => !v)}
            aria-label="Page slider"
            className="pointer-events-auto p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
          >
            <List className="w-4 h-4 text-white/80" />
          </button>
        </div>
      )}

      {/* page slider */}
      {showSlider && (
        <div className="absolute top-14 inset-x-0 z-20 px-5 py-2 bg-black/80 flex items-center gap-3">
          <span className="text-[9px] font-mono text-white/60">{shown}</span>
          <input
            type="range"
            min={1}
            max={total}
            value={shown}
            aria-label="Go to page"
            onChange={(e) => goTo(indexForDisplayed({ rtl, total, page: Number(e.target.value) }))}
            className="flex-1 accent-white"
          />
          <span className="text-[9px] font-mono text-white/60">{total}</span>
        </div>
      )}

      {/* the page itself */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        // A cancelled gesture is NOT a completed one. Reusing `onPointerUp`
        // here made an interrupted drag — a notification, a system edge
        // swipe, the browser taking over the scroll — evaluate its movement
        // and turn the page, then leave `drag.active` true and the pinch
        // state latched so the *next* drag started from a stale baseline.
        // Abort instead: drop every piece of gesture state.
        onPointerCancel={abortGesture}
        onLostPointerCapture={abortGesture}
        onClickCapture={onClickCapture}
        className={`flex-1 min-h-0 overflow-hidden ${
          webtoon ? "overflow-y-auto overscroll-contain" : "flex items-center justify-center"
        }`}
        // Without this the browser claims the horizontal drag for its own
        // panning, delivers a single pointermove and then stops — the swipe
        // silently never completes. `none` is required on the element that
        // owns the gesture, not just on the image inside it.
        style={{ touchAction: zoom > 1.05 ? "none" : webtoon ? "pan-y" : "none" }}
      >
        {webtoon ? (
          <ReaderPageImage
            url={pages[clamped]?.url || ""}
            alt={`${label} page ${shown}`}
            pageLabel={`${shown} / ${total}`}
            webtoon
            onFailure={onPageFailure}
            onRetry={onPageRetry}
            onSkip={forward}
            onClose={onClose}
          />
        ) : (
          <ReaderPageImage
            url={pages[clamped]?.url || ""}
            alt={`${label} page ${shown}`}
            pageLabel={`${shown} / ${total}`}
            // The zoom/pan transform rides on whichever surface is active,
            // so switching from `<img>` to a bounded canvas does not drop
            // the reader out of their zoom level.
            transform={{ x: pan.x, y: pan.y, scale: zoom }}
            onFailure={onPageFailure}
            onRetry={onPageRetry}
            onSkip={forward}
            onClose={onClose}
          />
        )}
      </div>

      {/* bottom bar */}
      {chromeVisible && (
        <div className="absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/85 to-transparent">
          <div className="h-1 bg-white/10">
            <div
              className="h-full bg-white/70 transition-[width] duration-150"
              style={{ width: `${(shown / total) * 100}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <button
              onClick={back}
              disabled={!canAct("back", { rtl, total, index: clamped }) && !chapters.length}
              aria-label="Previous page"
              className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-25 cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5 text-white/90" />
            </button>

            <button
              onClick={() => setChromeVisible(true)}
              className="text-[10px] font-mono text-white/75 px-3 py-1 rounded-lg hover:bg-white/10 cursor-pointer"
            >
              {shown} / {total}
            </button>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
                aria-label="Zoom out"
                className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-25 cursor-pointer"
                disabled={zoom <= 1}
              >
                <Minus className="w-4 h-4 text-white/80" />
              </button>
              <button
                onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
                aria-label="Zoom in"
                className="p-2 rounded-lg hover:bg-white/10 cursor-pointer"
              >
                <Plus className="w-4 h-4 text-white/80" />
              </button>
            </div>

            <button
              onClick={forward}
              disabled={!canAct("forward", { rtl, total, index: clamped })}
              aria-label="Next page"
              className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-25 cursor-pointer"
            >
              {/* Mirrored in RTL so both arrows always point "forward". */}
              <ChevronRight
                className={`w-5 h-5 text-white/90 ${rtl ? "-scale-x-100" : ""}`}
              />
            </button>
          </div>

          {/* step between chapters without leaving the reader */}
          {chapters.length > 1 && (
            <div className="flex items-center justify-between gap-2 px-3 pb-3">
              <button
                onClick={() => stepChapter(1)}
                className="text-[9px] font-bold uppercase tracking-widest text-white/50 hover:text-white/90 cursor-pointer"
              >
                ← Prev chapter
              </button>
              <button
                onClick={() => stepChapter(-1)}
                className="text-[9px] font-bold uppercase tracking-widest text-white/50 hover:text-white/90 cursor-pointer"
              >
                Next chapter →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ComicReader;
