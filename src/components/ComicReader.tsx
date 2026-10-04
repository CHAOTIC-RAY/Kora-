/**
 * A webtoon/manga page reader built to match the book's reader idioms.
 *
 * What the old inline pager in ComicDetailView had: a Next button, a Prev
 * button, and two arrow keys. That works on a desktop with a mouse and is
 * close to useless on the device the app is actually read on.
 *
 * Behaviour the reader/viewer conventions expect:
 *
 *   - Tap zones. A tap in the left third goes back, the right third goes
 *     forward, and the middle third toggles the control bars. Without this,
 *     a phone user has no way to advance a page at all.
 *   - Swipe to turn. Horizontal drag, with velocity deciding whether a
 *     short flick still turns. Pointer Events, so one handler covers mouse,
 *     touch and pen.
 *   - Right-to-left reading. Manga is read right to left in most of the
 *     world, and the `direction` setting is per-source. In RTL,
 *     "forward" is a swipe to the left.
 *   - Continuous vertical scroll. Webtoons are one long strip rather than
 *     discrete pages; the `Continuity` mode. Off by default,
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
import {
  ChevronLeft, ChevronRight, X, List, Minus, Plus,
  Bookmark, BookmarkCheck, Settings2, Sun, SunDim, Moon,
} from "lucide-react";
import { loadSettings, updateSettings, effectiveDirection, type ReaderSettings } from "../lib/readerSettings";
import { READER_THEMES, PRIMARY_READER_THEME_KEYS } from "../lib/readerThemes";
import {
  loadComicPrefs, updateComicPrefs, effectiveContinuous, pageFitClasses,
  COMIC_PAGE_FITS, CONTINUOUS_MODES, READING_BRIGHTNESS, nextBrightnessPreset,
  type ComicReaderPrefs,
} from "../lib/comicReaderSettings";
import {
  getChapterState, toggleBookmark, isBookmarked, setChapterState,
  type ChapterState,
} from "../lib/comicState";
import { schedulePush, pullAndMerge, pushChapter } from "../lib/comicCloudSync";
import { getCurrentUserId } from "../lib/firebase";
import {
  applyBrightness, clearBrightness, setKeepAwake, releaseKeepAwake,
  keepAwakeSupported, createSleepTimer,
} from "../lib/nativeScreen";
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
import { resolvePluginImageSrc } from "../lib/pluginImage";
import { logger } from "../lib/logger";

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
  /**
   * Stable identity for this chapter, used to key bookmarks and position.
   * Absent means the reader is showing something that cannot be persisted
   * (an archive with no plugin), so bookmark controls hide themselves.
   */
  stateKey?: string;
  /**
   * Whether position and bookmarks should also reach the cloud.
   *
   * Defaults to true, but only has an effect when a user is actually signed
   * in — the reader resolves that itself rather than taking a userId, so it
   * does not depend on every parent threading auth down to it.
   */
  syncEnabled?: boolean;
  /**
   * What the pages actually ARE, decided from bytes by `detectFormat`.
   *
   * A comic from a Madara CDN and the same comic unpacked from a CBZ are the
   * same array of URLs to this component — which is the point — but they are
   * *not* the same thing to a user, and "a comic" is not an answer when a
   * mirror offers four containers. Rendering the real format next to the page
   * counter is what turns "the reader shows a blank page" into "this mirror
   * sent me a PDF".
   *
   * A plain string rather than a `Detection` so the reader stays ignorant of
   * detection; the parent decides what to say.
     */
  formatLabel?: string;
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
  stateKey,
  syncEnabled = true,
  formatLabel,
}: ComicReaderProps) {
  // Where the chapter opens. A right-to-left manga opens on its *last* page
  // because reading runs backwards through the source array; the rule lives
  // in readingDirection.ts and is covered by tests.
  //
  // The direction override is re-read here rather than using `readingRtl`,
  // because this is a lazy initialiser that runs BEFORE the `settings` state
  // is declared below. It is a second `loadSettings()` call, which is a
  // localStorage hit at mount — cheaper than the alternative of opening a
  // right-to-left series on its first page because the user's override had
  // not been applied yet.
  const [index, setIndex] = useState(() => {
  if (initialIndex > 0) return Math.min(initialIndex, Math.max(0, pages.length - 1));
  const stored = loadSettings();
  const openRtl = effectiveDirection(stored, rtl ? "rtl" : "ltr") === "rtl";
  return firstPage({ rtl: openRtl, total: pages.length });
  });
  const [chromeVisible, setChromeVisible] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showSlider, setShowSlider] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Resolved here rather than passed in: the reader is opened from several
  // places, and a prop that every one of them has to supply is a prop that
  // will eventually be forgotten. Empty string means signed out, which turns
  // every sync call into a no-op rather than an error.
  const userId = syncEnabled ? getCurrentUserId() : "";

  // ── Reader settings (local only — never synced) ─────────────────────────
  // Read once on open rather than watched: settings changing mid-read is not
  // a case worth re-rendering the reader for, and this keeps the module
  // boundary obvious — nothing here writes anywhere but localStorage.
  const [settings, setSettings] = useState<ReaderSettings>(() => loadSettings());

  // ── Comic-specific settings (page fit, continuous scroll, filters) ──────
  // A separate record from `settings` on purpose: `saveSettings` rebuilds from
  // DEFAULT_SETTINGS and keeps only keys it knows, so a comic field living
  // there would be erased by the next write from the other reader. See the
  // module header in comicReaderSettings.
  const [prefs, setPrefs] = useState<ComicReaderPrefs>(() => loadComicPrefs());

  /**
   * The direction to READ in, as opposed to the direction the source
   * declared. Every consumer below resolves through this one value.
   *
   * The user override wins over the source, but only when explicitly set —
   * see `effectiveDirection`.
   */
  const readingRtl = effectiveDirection(settings, rtl ? "rtl" : "ltr") === "rtl";

  /**
   * Whether this chapter scrolls as one strip.
   *
   * This was previously the raw `webtoon` prop, read straight from the source
   * at six call sites. Resolving it once means the container, the touch-action
   * hint, the page-fit control and the preload loop can no longer disagree
   * about whether the reader is in scroll mode — and it is what gives the
   * user's "Auto / On / Off" override somewhere to apply.
   */
  const continuous = effectiveContinuous(prefs, webtoon);

  /**
   * Reading theme, resolved the same way the EPUB reader resolves it.
   *
   * `READER_THEMES` entries are Tailwind class strings, applied verbatim — that
   * is why the EPUB reader can be themed without inline styles. The comic reader
   * previously hardcoded `bg-kindle-bg` plus white-alpha chrome, so it ignored the
   * app theme entirely and read as a different app. Sharing the key space (via
   * `comicReaderPrefs.theme`) means one picker drives both readers.
   */
  const activeTheme = READER_THEMES[prefs.theme] || READER_THEMES.dark;
  const isDarkTheme =
    prefs.theme === "dark" ||
    prefs.theme === "night" ||
    prefs.theme === "oled";

  /** Apply a comic-prefs change and keep local state in step with storage. */
  const applyPrefs = useCallback((patch: Partial<ComicReaderPrefs>) => {
    setPrefs(updateComicPrefs(patch));
  }, []);

  /**
   * A polite announcement of where the reader is.
   *
   * A page turn is a gesture, not a navigation event: nothing in the
   * accessibility tree changes when the reader moves from page 3 to page 4, so
   * a screen reader is left silently on the old page with no way to know the
   * turn happened at all. `polite` rather than `assertive` because a reader
   * flicking through pages should not have every turn interrupt whatever they
   * were reading before it.
   */
  const [announcement, setAnnouncement] = useState("");

  const total = pages.length;
  const clamped = Math.min(Math.max(0, index), Math.max(0, total - 1));

  /**
   * The page as the reader experiences it.
   *
   * The page array is in source order, which for a right-to-left manga is
   * the reverse of reading order, so the raw index would count backwards
   * from the reader's point of view — showing "1 / 9" on the page you just
   * opened and climbing to "9 / 9" as you read. Everything the user sees
   * goes through this.
   */
  const shown = displayedPage({ rtl: readingRtl, total, index: clamped });

  // Declared up here rather than just above the render: the announcement
  // effect below needs `label`, and a `const` referenced before its
  // declaration is a runtime crash, not a type error.
  const label = chapter.number ? `Chapter ${chapter.number}` : chapter.name;
  const posInSeries = chapter.number
    ? `${chapter.number}${chapters.length ? ` / ${chapters.length}` : ""}`
    : "";

  // ── Bookmarks and position (this chapter's stored state) ────────────────
  const [chapterState, setChapterStateLocal] = useState<ChapterState | undefined>(() =>
    stateKey ? getChapterState(stateKey) : undefined
  );

  /** Persist the page turn locally and report it upward for cloud sync. */
  const recordPosition = useCallback(
    (displayed: number) => {
      if (!stateKey) return;
      const next = setChapterState(
        stateKey,
        { pageNumber: displayed, totalPages: total, chapterIndex: 0 },
        Date.now()
      );
      if (next) {
        setChapterStateLocal(next);
        // Debounced: a fast reader makes many of these and only the last one
        // is worth a network write.
        if (syncEnabled && userId) schedulePush(userId, stateKey);
      }
      onIndexChange?.(indexForDisplayed({ rtl: readingRtl, total, page: displayed }));
    },
    [stateKey, total, readingRtl, onIndexChange, syncEnabled, userId]
  );

  const toggleCurrentBookmark = useCallback(() => {
    if (!stateKey) return;
    const next = toggleBookmark(stateKey, shown, Date.now(), {
      pageNumber: shown,
      totalPages: total,
    });
    if (next) {
      setChapterStateLocal(next);
      // A bookmark is a deliberate, infrequent act — push it immediately
      // rather than making the user wait out a debounce to see it elsewhere.
      if (syncEnabled && userId) void pushChapter(userId, stateKey);
    }
  }, [stateKey, shown, total, syncEnabled, userId]);

  const currentBookmarked = isBookmarked(chapterState, shown);

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


  const goTo = useCallback(
  (next: number) => {
  const target = Math.min(Math.max(0, next), Math.max(0, total - 1));
  setIndex(target);
  setZoom(1);
  setPan({ x: 0, y: 0 });
  // Persist in READING order. The parent's `onIndexChange` takes a source
  // array index, which in a right-to-left series is the mirror of the page the
  // user is actually on, so this converts rather than forwarding the raw index.
  recordPosition(displayedPage({ rtl: readingRtl, total, index: target }));
  onIndexChange?.(target);
  },
  [total, onIndexChange, recordPosition, readingRtl]
  );

  /**
   * In RTL, "forward" is a step of -1. Every control routes through here so
   * the direction is defined exactly once.
   *
   * `readingRtl`, not the `rtl` prop. The override had already been computed
   * a few lines above and was used by the progress writes and the settings
   * sheet, but every actual page turn still asked the source — so choosing
   * "Left to right" on a right-to-left series moved the page the opposite way
   * from the number it then displayed. The resolved value is the only one
   * that reflects what the user asked for, and it is now the single source.
   */
  const forward = useCallback(
    () => goTo(nextIndex({ rtl: readingRtl, total, index: clamped })),
    [goTo, clamped, readingRtl, total]
  );
  const back = useCallback(
    () => goTo(prevIndex({ rtl: readingRtl, total, index: clamped })),
    [goTo, clamped, readingRtl, total]
  );


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

  // ── Pull cloud state once on open ────────────────────────────────────────
  // Merge, so a stale cloud copy cannot move the reader off the page they are
  // actually on. A no-op when signed out.
  useEffect(() => {
    if (!syncEnabled || !userId) return;
    let cancelled = false;
    void pullAndMerge(userId).then((applied) => {
      if (cancelled || !applied) return;
      // Re-read local: the merge just wrote into it.
      if (stateKey) setChapterStateLocal(getChapterState(stateKey));
    });
    return () => {
      cancelled = true;
    };
  }, [syncEnabled, userId, stateKey]);

  // Flush the final position on unmount, so closing the reader mid-debounce
  // does not leave the last few pages unwritten.
  useEffect(() => {
    if (!syncEnabled || !userId || !stateKey) return;
    return () => {
      void pushChapter(userId, stateKey);
    };
  }, [syncEnabled, userId, stateKey]);

  // ── Auto-hide the chrome after a period of inactivity ────────────────────
  // Without this the bars sit on top of every page forever, which is both an
  // immersion loss and a battery cost on a phone. The timer is reset by every
  // interaction that should count as "the reader is still here", and it is
  // torn down on unmount so a closed reader cannot keep firing.
  useEffect(() => {
    if (!settings.autoHideSeconds || !chromeVisible || showSettings || showSlider) return;
    const timer = window.setTimeout(() => setChromeVisible(false), settings.autoHideSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [settings.autoHideSeconds, chromeVisible, showSettings, showSlider, shown]);

  // ── Hold the screen awake while a page is open ───────────────────────────
  // Acquired on mount and released on unmount. The helper self-releases a lock
  // that resolves after teardown, so a reader closed mid-request cannot leave
  // the screen on with nothing to turn it off.
  useEffect(() => {
    if (!settings.keepAwake || !keepAwakeSupported()) return;
    void setKeepAwake(true);
    return () => {
      void releaseKeepAwake();
    };
  }, [settings.keepAwake]);

  // ── Sleep timer: hand the screen back when it runs out ───────────────────
  const [sleepExpired, setSleepExpired] = useState(false);
  useEffect(() => {
    setSleepExpired(false);
    if (!settings.sleepTimerMinutes) return;
    const timer = createSleepTimer(settings.sleepTimerMinutes);
    // Polled rather than scheduled so the deadline stays correct even if the
    // tab is throttled in the background — a setTimeout that fires late is
    // exactly the case where the user is asleep and the screen must go dark.
    const interval = window.setInterval(() => {
      if (timer.expired()) {
        setSleepExpired(true);
        onClose();
      }
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [settings.sleepTimerMinutes, onClose]);

  // ── Brightness ───────────────────────────────────────────────────────────
  // Applied to this reader's own root only. Never to document.documentElement:
  // a reader left open behind a route change would dim every screen after it.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (settings.brightnessMode === "manual") applyBrightness(el, settings.brightness);
    else clearBrightness(el);
    return () => clearBrightness(el);
  }, [settings.brightnessMode, settings.brightness]);

  // ── Page-fit classes for the current surface ─────────────────────────────
  // Resolved once and applied to the wrapper, because the fit has to reach the
  // `<img>`/`<canvas>` *inside* ReaderPageImage — that component ships its own
  // `object-contain` and owns the decode sizing, so the fit cannot be set by
  // styling this element alone.
  const fitClass = pageFitClasses({ pageFit: prefs.pageFit, continuous });

  // ── Announce the page for screen readers ────────────────────────────────
  // Chapter and page together: "page 4" is ambiguous across a long series, and
  // a reader who turns forward and hears nothing has no way to tell whether
  // the turn happened, was swallowed, or landed on a broken page.
  useEffect(() => {
    if (!total) return;
    setAnnouncement(`${label}, page ${shown} of ${total}`);
  }, [label, shown, total]);

  // ── Mouse wheel does not turn pages ─────────────────────────────────────
  // The book's reader has the same setting, and it exists for the same reason:
  // a trackpad or a wheel that keeps firing sends a reader flying through a
  // chapter, because a comic page turn is an instant, large jump with no
  // scrollbar to catch it. A non-passive listener is required — React's
  // `onWheel` is passive and cannot preventDefault, so the page would scroll
  // the reader regardless.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !prefs.disableMouseScroll) return;
    const onWheel = (e: WheelEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [prefs.disableMouseScroll]);

  // Neighbour preloading. A comic page is a big image; decoding it on the
  // turn is what makes paging feel like it stutters.
  useEffect(() => {
  // The reading direction, not the source's: prefetching the wrong side means
  // every page turn waits on a cold decode, which is the exact stutter this
  // loop exists to remove. Same reason the turn handlers resolve the override.
  const ahead = readingRtl ? -1 : 1;
  for (let d = -PRELOAD_BEHIND; d <= PRELOAD_AHEAD; d++) {
  const i = clamped + d * ahead;
  if (i < 0 || i >= total) continue;
  const url = pages[i]?.url;
  // `shouldPreload` is false for a page already cached and for one that
  // has already failed, which is what stops a dead CDN being hammered.
  if (!url || !preloaded.current.shouldPreload(url)) continue;
  preloaded.current.add(url);
  const img = new Image();
  img.onerror = () => {
  preloaded.current.markFailed(url);
  logger.warn("[reader] preload failed", { chapter: chapter.name, page: i + 1, total, url });
  };
  // Routed exactly the way the displayed page will be. This used to be
  // the bare `url`, which meant the preload burned a direct request that
  // the reader's own render then repeated — and on a network whose DNS
  // filter answers with a block-page certificate, that direct request
  // could only ever fail, so every page announced itself broken before
  // the reader had even shown it.
  img.src = resolvePluginImageSrc(url) ?? url;
  }
  }, [clamped, total, pages, readingRtl, chapter.name]);

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

  useEffect(() => {
  logger.info("[reader] chapter opened", { chapter: chapter.name, totalPages: total, index: clamped });
  }, [chapter.name, total, clamped]);

  // Keyboard. Arrows follow the reading direction, Escape closes, and the
  // Home/End keys jump to a chapter edge.
  useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
  if (e.key === "ArrowRight") {
  e.preventDefault();
  readingRtl ? back() : forward();
  } else if (e.key === "ArrowLeft") {
  e.preventDefault();
  readingRtl ? forward() : back();
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
  }, [forward, back, goTo, total, onClose, readingRtl]);

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
  const { advancing } = swipeDirection(dx, readingRtl);
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
  const action = resolveTap(frac, readingRtl);
  if (action === "forward") forward();
  else if (action === "back") back();
  else setChromeVisible((v) => !v);
  };

  /**
   * Step to the adjacent chapter, for the arrows in the page label.
   *
   * `dir` is in READING order, not array order. The `chapters` array arrives
   * newest-first (the `ordered` sort in ComicDetailView), so reading
   * "next" is a step of -1 and reading "previous" is +1. Folding that
   * inversion in here means the call sites can be labelled honestly —
   * `stepChapter("next")` really is the next chapter — instead of every
   * button having to remember which way the list happens to be sorted,
   * which is how the two labels came to be swapped in the first place.
   */
  const stepChapter = (dir: "next" | "prev") => {
  if (!chapters.length) return false;
  const pos = chapters.findIndex((c) => c.url === chapter.url);
  if (pos < 0) return false;
  const next = chapters[pos + (dir === "prev" ? 1 : -1)];
  if (!next) return false;
  onChapterChange?.(next);
  return true;
  };

  if (!total) {
  return (
  <div className="fixed inset-0 z-[10000] bg-kindle-bg flex flex-col items-center justify-center gap-3">
  <p className="text-[11px] uppercase tracking-widest text-kindle-text-muted">
  This chapter has no pages
  </p>
  <button
  onClick={onClose}
  className="px-4 py-2 border border-kindle-border rounded-lg text-[10px] font-bold uppercase tracking-widest text-kindle-text"
  >
  Close
  </button>
  </div>
  );
  }

  return (
  <div
  ref={rootRef}
  role="dialog"
  aria-modal="true"
  aria-label={seriesTitle ? `${seriesTitle} — ${label}` : "Reader"}
  className={`fixed inset-0 z-[10000] flex flex-col select-none touch-manipulation overscroll-none ${activeTheme.bg} ${activeTheme.text} transition-colors duration-200`}
  style={{
    // Match the EPUB reader's viewport handling (BookReaderEPUB.tsx:3108-3119).
    // Without these the chrome sits under a notch, a home indicator, or the
    // on-screen keyboard on a phone.
    paddingTop: "var(--kora-safe-top)",
    paddingBottom: "var(--kora-safe-bottom)",
    paddingLeft: "var(--kora-safe-left)",
    paddingRight: "var(--kora-safe-right)",
    height: "var(--kora-vvh, 100dvh)",
    maxHeight: "var(--kora-vvh, 100dvh)",
    boxSizing: "border-box",
    overflow: "hidden",
  }}
  >
  {/* top bar */}
  {chromeVisible && (
  <div className={`absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b shrink-0 ${activeTheme.border} ${isDarkTheme ? "bg-neutral-900/80" : "bg-white/80"} backdrop-blur-sm pointer-events-none`}>
  <button
  onClick={onClose}
  aria-label="Close reader"
  className="pointer-events-auto inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:text-kindle-text/80 cursor-pointer"
  >
  <X className="w-4 h-4" />
  <span className="hidden sm:inline">Back</span>
  </button>
  <div className="flex flex-col items-center min-w-0 px-2">
  <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-text truncate">
  {seriesTitle ? `${seriesTitle} · ` : ""}
  {label}
  </span>
  {/*
  The real container, on the same line as the page counter.

  It sits under the chapter title rather than inside it because the title is
  `truncate`d and the format is the one word a user must never lose.
  Deliberately not clickable: knowing you are reading a CBZ is useful, acting
  on it here would promise something this reader cannot do.
  */}
  <span className="flex items-center gap-1.5 text-[9px] text-kindle-text-muted font-mono">
  {posInSeries && <span>{posInSeries}</span>}
  {formatLabel && (
  <span
  className="px-1.5 rounded bg-kindle-text/10 text-kindle-text/80"
  title="Identified from the file's contents, not its name"
  >
  {formatLabel}
  </span>
  )}
  </span>
  </div>
  {/*
  Bookmark and settings live in the top bar rather than the bottom one:
  the bottom bar is hidden whenever the chrome auto-hides, and a control
  that disappears mid-chapter is a control the user cannot find.
  */}
  <div className="pointer-events-auto flex items-center gap-1">
  {stateKey && (
  <button
  onClick={toggleCurrentBookmark}
  aria-label={currentBookmarked ? "Remove bookmark for this page" : "Bookmark this page"}
  aria-pressed={currentBookmarked}
  className="p-1.5 rounded-lg hover:bg-kindle-text/10 cursor-pointer"
  >
  {currentBookmarked ? (
  <BookmarkCheck className="w-4 h-4 text-amber-300" />
  ) : (
  <Bookmark className="w-4 h-4 text-kindle-text" />
  )}
  </button>
  )}
  {/*
    Brightness cycle in the header, as the book's reader has it
    (BookReaderEPUB: `cycleReadingBrightness` on the sun icon).

    A header tap is a one-finger, no-menu dim — which is the gesture you want
    when the room has got dark mid-chapter, and which is exactly what a
    full-bleed comic reader needs most. Only offered while the reader is in
    manual mode; in system mode the icon would appear to do nothing.
  */}
  {settings.brightnessMode === "manual" && (
  <button
  onClick={() =>
  setSettings(
  updateSettings({ brightness: nextBrightnessPreset(settings.brightness * 100) / 100 })
  )
  }
  title={`Brightness ${Math.round(settings.brightness * 100)}% — tap to cycle`}
  aria-label={`Brightness ${Math.round(settings.brightness * 100)} percent, tap to cycle`}
  className="p-1.5 rounded-lg hover:bg-kindle-text/10 cursor-pointer"
  >
  {settings.brightness >= 0.9 ? (
  <Sun className="w-4 h-4 text-kindle-text" />
  ) : settings.brightness >= 0.6 ? (
  <SunDim className="w-4 h-4 text-kindle-text" />
  ) : (
  <Moon className="w-4 h-4 text-kindle-text" />
  )}
  </button>
  )}
  <button
  onClick={() => setShowSettings((v) => !v)}
  aria-label="Reader settings"
  aria-expanded={showSettings}
  className="p-1.5 rounded-lg hover:bg-kindle-text/10 cursor-pointer"
  >
  <Settings2 className="w-4 h-4 text-kindle-text" />
  </button>
  <button
  onClick={() => setShowSlider((v) => !v)}
  aria-label="Page slider"
  className="p-1.5 rounded-lg hover:bg-kindle-text/10 cursor-pointer"
  >
  <List className="w-4 h-4 text-kindle-text" />
  </button>
  </div>
  </div>
  )}

  {/* page slider */}
  {showSlider && (
  <div className="absolute top-14 inset-x-0 z-20 px-5 py-2 bg-kindle-card flex items-center gap-3">
  <span className="text-[9px] font-mono text-kindle-text-muted">{shown}</span>
  <input
  type="range"
  min={1}
  max={total}
  value={shown}
  aria-label="Go to page"
  onChange={(e) => goTo(indexForDisplayed({ rtl: readingRtl, total, page: Number(e.target.value) }))}
  className="flex-1 accent-kindle-accent"
  />
  <span className="text-[9px] font-mono text-kindle-text-muted">{total}</span>
  </div>
  )}

  {/*
  Settings sheet.

  Two records, deliberately. Display and behaviour that the book's reader also
  has — brightness, keep-awake, auto-hide, sleep timer, direction — go through
  `updateSettings`. What is comic-specific — page fit, continuous scroll, the
  display filters, the wheel lock — goes through `applyPrefs`, because
  `saveSettings` rebuilds its record from the shared defaults and would erase
  any field it does not recognise. Merging them into one sheet would have made
  the page-fit control silently disappear the next time the other reader
  saved.

  Neither is synced, and the sheet says so: a brightness chosen for a dark
  train has no business following the reader onto a tablet in daylight.
  Position and bookmarks are the things that sync, and they are not here.
  */}
  {showSettings && (
  <div
  role="dialog"
  aria-label="Reader settings"
  className="absolute inset-x-0 bottom-0 z-30 max-h-[70vh] overflow-y-auto rounded-t-2xl bg-kindle-card backdrop-blur border-t border-kindle-border px-4 py-4 pb-[max(1.25rem,var(--kora-safe-bottom))] space-y-4"
  >
  <div className="flex items-center justify-between">
  <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-text">
  Reader settings
  </span>
  <button
  onClick={() => setShowSettings(false)}
  aria-label="Close settings"
  className="p-1 rounded-lg hover:bg-kindle-text/10 cursor-pointer"
  >
  <X className="w-4 h-4 text-kindle-text/80" />
  </button>
  </div>

  {/* Reading theme — mirrors the EPUB reader's picker
      (BookReaderEPUB.tsx:3293-3378) so one control means the same thing in both
      readers. Previously the comic reader had no theme control at all and was
      hardcoded black, so this is what makes the two visually consistent. */}
  <div>
  <span className="block text-[9px] uppercase tracking-widest text-kindle-text-muted mb-1.5">
  Reading theme
  </span>
  <div className="grid grid-cols-4 gap-1.5">
  {PRIMARY_READER_THEME_KEYS.map((k) => {
  const th = READER_THEMES[k];
  const on = prefs.theme === k;
  return (
  <button
  key={k}
  onClick={() => applyPrefs({ theme: k })}
  aria-pressed={on}
  aria-label={th.label}
  className={`h-10 rounded-lg border flex items-center justify-center text-[10px] font-semibold transition ${
  on ? "ring-2 ring-kindle-accent border-transparent" : "border-kindle-border"
  }`}
  style={{ background: th.previewBg, color: th.previewText }}
  >
  {th.label}
  </button>
  );
  })}
  </div>
  <div className="grid grid-cols-3 gap-1.5 mt-1.5">
  {(["light", "green", "dark"] as const).map((k) => {
  const th = READER_THEMES[k];
  const on = prefs.theme === k;
  return (
  <button
  key={k}
  onClick={() => applyPrefs({ theme: k })}
  aria-pressed={on}
  aria-label={th.label}
  className={`h-8 rounded-lg border flex items-center justify-center text-[9px] font-semibold transition ${
  on ? "ring-2 ring-kindle-accent border-transparent" : "border-kindle-border"
  }`}
  style={{ background: th.previewBg, color: th.previewText }}
  >
  {th.label}
  </button>
  );
  })}
  </div>
  </div>

  {/* Reading direction */}
  <div>
  <span className="block text-[9px] uppercase tracking-widest text-kindle-text-muted mb-1.5">
  Reading direction
  </span>
  <div className="flex gap-2">
  {(["ltr", "rtl"] as const).map((d) => (
  <button
  key={d}
  onClick={() => setSettings(updateSettings({ directionOverride: d }))}
  aria-pressed={readingRtl === (d === "rtl")}
  className={`flex-1 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest cursor-pointer ${
  readingRtl === (d === "rtl")
  ? "bg-kindle-text text-kindle-bg shadow"
  : "border border-kindle-border text-kindle-text hover:bg-kindle-text/10"
  }`}
  >
  {d === "rtl" ? "Right to left" : "Left to right"}
  </button>
  ))}
  </div>
  <p className="mt-1.5 text-[9px] text-kindle-text-muted/70">
  Default follows the source. Override it here if you prefer the other.
  </p>
  </div>

  {/*
  Page fit.

  This block used to write `settings.fitMode` with the values
  "contain" | "width" | "height" | "original" and nothing ever read it back —
  the shared settings module rejects three of those four as unknown, so the
  control was inert and the page always letterboxed. Comics needed the choice
  for a real reason the book reader does not: a comic page's aspect ratio is
  whatever the scanline is, and panel pages, splash pages and double-page
  spreads all disagree, so one fixed fit is wrong for some page in most
  chapters.

  Three options rather than a "fill the screen" toggle, and styled as the
  book reader's segmented control so the two sheets read as one UI.
  */}
  {!continuous && (
  <div>
  <span className="block text-[9px] uppercase tracking-widest text-kindle-text-muted mb-1.5">
  Page fit
  </span>
  <div className="grid grid-cols-3 gap-1.5">
  {COMIC_PAGE_FITS.map((m) => (
  <button
  key={m.value}
  onClick={() => applyPrefs({ pageFit: m.value })}
  aria-pressed={prefs.pageFit === m.value}
  title={m.desc}
  className={`px-2 py-2 rounded-lg text-[9px] font-bold uppercase tracking-wider cursor-pointer ${
  prefs.pageFit === m.value
  ? "bg-kindle-text text-kindle-bg shadow"
  : "border border-kindle-border text-kindle-text hover:bg-kindle-text/10"
  }`}
  >
  {m.label}
  </button>
  ))}
  </div>
  <p className="mt-1.5 text-[9px] text-kindle-text-muted/70">
  {COMIC_PAGE_FITS.find((m) => m.value === prefs.pageFit)?.desc}
  </p>
  </div>
  )}

  {/*
  Continuous scroll, as Auto / On / Off rather than a plain toggle.

  The flag is a property of the SERIES, so a checkbox cannot express "Auto" —
  it would pin the mode forever after the first tap, and a reader who set
  "always scroll" on one webtoon would be stuck with it on every paged series
  too. Auto defers to the source; On and Off override it in either direction.
  */}
  <div>
  <span className="block text-[9px] uppercase tracking-widest text-kindle-text-muted mb-1.5">
  Continuous scroll
  </span>
  <div className="grid grid-cols-3 gap-1.5">
  {CONTINUOUS_MODES.map((m) => (
  <button
  key={m.value}
  onClick={() => applyPrefs({ continuous: m.value })}
  aria-pressed={prefs.continuous === m.value}
  title={m.desc}
  className={`px-2 py-2 rounded-lg text-[9px] font-bold uppercase tracking-wider cursor-pointer ${
  prefs.continuous === m.value
  ? "bg-kindle-text text-kindle-bg shadow"
  : "border border-kindle-border text-kindle-text hover:bg-kindle-text/10"
  }`}
  >
  {m.label}
  </button>
  ))}
  </div>
  <p className="mt-1.5 text-[9px] text-kindle-text-muted/70">
  {CONTINUOUS_MODES.find((m) => m.value === prefs.continuous)?.desc}
  {webtoon && prefs.continuous === "source" && " This series is a scrolling strip."}
  </p>
  </div>

  {/* Brightness */}
  <div>
  <span className="flex items-center justify-between text-[9px] uppercase tracking-widest text-kindle-text-muted mb-1.5">
  Brightness
  <button
  onClick={() =>
  setSettings(
  updateSettings({
  brightnessMode: settings.brightnessMode === "manual" ? "system" : "manual",
  brightness: settings.brightnessMode === "manual" ? 1 : 0.7,
  })
  )
  }
  aria-pressed={settings.brightnessMode === "manual"}
  className="pointer-events-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-kindle-border text-[8px] text-kindle-text/80 hover:bg-kindle-text/10 cursor-pointer"
  >
  {settings.brightnessMode === "manual" ? (
  <Moon className="w-3 h-3" />
  ) : (
  <Sun className="w-3 h-3" />
  )}
  {settings.brightnessMode === "manual" ? "manual" : "system"}
  </button>
  </span>
  {/*
    The book's reader offers five coarse presets above its fine slider
    (BookReaderEPUB: READING_BRIGHTNESS). Ported verbatim, because a comic page
    is mostly white paper and the useful moves are "much dimmer" and "back to
    normal" — five repeatable steps beat dragging a slider for that.
  */}
  {settings.brightnessMode === "manual" && (
  <div className="grid grid-cols-5 gap-1.5 mb-2">
  {READING_BRIGHTNESS.map((level) => (
  <button
  key={level}
  onClick={() => setSettings(updateSettings({ brightness: level / 100 }))}
  aria-pressed={Math.round(settings.brightness * 100) === level}
  aria-label={`Brightness ${level}%`}
  className={`py-1.5 rounded-lg border text-[9px] font-mono font-bold transition cursor-pointer ${
  Math.round(settings.brightness * 100) === level
  ? "border-kindle-accent bg-kindle-accent/15 text-kindle-accent"
  : "border-kindle-border hover:bg-kindle-text/10 text-kindle-text/80"
  }`}
  >
  {level}
  </button>
  ))}
  </div>
  )}
  <input
  type="range"
  min={20}
  max={100}
  value={Math.round(settings.brightness * 100)}
  disabled={settings.brightnessMode !== "manual"}
  aria-label="Screen brightness"
  onChange={(e) =>
  setSettings(updateSettings({ brightness: Number(e.target.value) / 100 }))
  }
  className="w-full accent-kindle-accent disabled:opacity-30"
  />
  <p className="mt-1 text-[9px] text-kindle-text-muted/70">
  Applies to the reader only, and only this device.
  </p>
  </div>

  {/* Display filters */}
  <div>
  <span className="block text-[9px] uppercase tracking-widest text-kindle-text-muted mb-1.5">
  Page appearance
  </span>
  <div className="space-y-1">
  {([
  {
  key: "grayscaleImages" as const,
  label: "Black and white",
  hint: "Desaturates the artwork. Halftone dots become pure line art.",
  },
  {
  key: "hideImages" as const,
  label: "Hide artwork",
  hint: "Text only. Useful when the art is distracting or the page is a splash.",
  },
  {
  key: "disableMouseScroll" as const,
  label: "Mouse wheel turns pages",
  hint: "Off: the wheel does nothing, so a trackpad cannot skip ahead.",
  },
  ] as const).map((row) => (
  <label
  key={row.key}
  className="flex items-center justify-between gap-3 py-1 cursor-pointer"
  >
  <span className="min-w-0">
  <span className="block text-[10px] text-kindle-text">{row.label}</span>
  <span className="block text-[9px] text-kindle-text-muted/70">{row.hint}</span>
  </span>
  {/*
    The book's reader styles these as a pill switch rather than a checkbox.
    Ported because the comic reader is full-bleed black and the sheet's other
    controls are already pills and segmented rows — a native checkbox in the
    middle of that reads as a different component entirely.
  */}
  <button
  type="button"
  role="switch"
  onClick={() => {
  const on = row.key === "disableMouseScroll" ? !prefs.disableMouseScroll : !prefs[row.key];
  if (row.key === "disableMouseScroll") applyPrefs({ disableMouseScroll: on });
  else applyPrefs({ [row.key]: on } as Partial<ComicReaderPrefs>);
  }}
  aria-checked={
  row.key === "disableMouseScroll" ? prefs.disableMouseScroll : prefs[row.key]
  }
  aria-label={row.label}
  className={`w-10 h-5 shrink-0 rounded-full transition-colors relative cursor-pointer ${
  (row.key === "disableMouseScroll" ? prefs.disableMouseScroll : prefs[row.key])
  ? "bg-kindle-accent"
  : "bg-kindle-text/25"
  }`}
  >
  <div
  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm transition-transform ${
  (row.key === "disableMouseScroll" ? prefs.disableMouseScroll : prefs[row.key])
  ? "translate-x-5 bg-kindle-bg"
  : "translate-x-0 bg-kindle-text/70"
  }`}
  />
  </button>
  </label>
  ))}
  </div>
  </div>

  {/* Keep awake */}
  <label className="flex items-center justify-between gap-3 cursor-pointer">
  <span className="text-[9px] uppercase tracking-widest text-kindle-text-muted">
  Keep screen awake
  </span>
  <input
  type="checkbox"
  checked={settings.keepAwake}
  disabled={!keepAwakeSupported()}
  onChange={(e) => setSettings(updateSettings({ keepAwake: e.target.checked }))}
  className="accent-kindle-accent disabled:opacity-30"
  />
  </label>
  {!keepAwakeSupported() && (
  <p className="text-[9px] text-kindle-text-muted/70">
  This browser will not let a page hold the screen awake.
  </p>
  )}

  {/* Auto-hide */}
  <div>
  <span className="block text-[9px] uppercase tracking-widest text-kindle-text-muted mb-1.5">
  Hide controls after
  </span>
  <div className="flex gap-1.5">
  {[0, 3, 5, 10].map((sec) => (
  <button
  key={sec}
  onClick={() => setSettings(updateSettings({ autoHideSeconds: sec }))}
  aria-pressed={settings.autoHideSeconds === sec}
  className={`flex-1 px-2 py-1.5 rounded-lg text-[9px] font-bold uppercase cursor-pointer ${
  settings.autoHideSeconds === sec
  ? "bg-kindle-text text-kindle-bg shadow"
  : "border border-kindle-border text-kindle-text hover:bg-kindle-text/10"
  }`}
  >
  {sec === 0 ? "never" : `${sec}s`}
  </button>
  ))}
  </div>
  </div>

  {/* Sleep timer */}
  <div>
  <span className="block text-[9px] uppercase tracking-widest text-kindle-text-muted mb-1.5">
  Sleep timer
  </span>
  <div className="flex gap-1.5">
  {[0, 5, 15, 30].map((min) => (
  <button
  key={min}
  onClick={() => setSettings(updateSettings({ sleepTimerMinutes: min }))}
  aria-pressed={settings.sleepTimerMinutes === min}
  className={`flex-1 px-2 py-1.5 rounded-lg text-[9px] font-bold uppercase cursor-pointer ${
  settings.sleepTimerMinutes === min
  ? "bg-kindle-text text-kindle-bg shadow"
  : "border border-kindle-border text-kindle-text hover:bg-kindle-text/10"
  }`}
  >
  {min === 0 ? "off" : `${min}m`}
  </button>
  ))}
  </div>
  {sleepExpired && (
  <p className="mt-1 text-[9px] text-kindle-text-muted">Sleep timer ran out — reader closed.</p>
  )}
  </div>

  {/* Bookmarks in this chapter */}
  {stateKey && !!chapterState?.bookmarks.length && (
  <div>
  <span className="block text-[9px] uppercase tracking-widest text-kindle-text-muted mb-1.5">
  Bookmarks in this chapter
  </span>
  <div className="flex flex-wrap gap-1.5">
  {chapterState.bookmarks.map((p) => (
  <button
  key={p}
  onClick={() => goTo(indexForDisplayed({ rtl: readingRtl, total, page: p }))}
  className="px-2 py-1 rounded-lg border border-amber-400/40 text-amber-200 text-[9px] font-mono hover:bg-amber-400/10 cursor-pointer"
  >
  p{p}
  </button>
  ))}
  </div>
  </div>
  )}

  <p className="text-[9px] text-kindle-text-muted/60 leading-relaxed">
  These settings stay on this device. Your bookmarks and reading position
  follow you to your other devices.
  </p>
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
  // The display filters ride on this wrapper as descendant variants, for the
  // same reason the fit does: the artwork is rendered by ReaderPageImage, and
  // a `filter` on this element would also dim the letterboxing around it.
  // `grayscale` on a comic page is not the accessibility nicety it is on a
  // text page — it is how a colour-dependent page reads as pure line art.
  className={`flex-1 min-h-0 overflow-hidden ${
  continuous ? "overflow-y-auto overscroll-contain" : "flex items-center justify-center"
  } ${fitClass} ${prefs.grayscaleImages ? "[&_img]:grayscale [&_canvas]:grayscale" : ""} ${
  // Text-only is a real mode rather than a nicety: on a comic, artwork can
  // carry the entire scene. Hiding it leaves the page counter and chapter
  // label as the only thing on screen, which is the point.
  prefs.hideImages ? "[&_img]:hidden [&_canvas]:hidden" : ""
  }`}
  // Without this the browser claims the horizontal drag for its own
  // panning, delivers a single pointermove and then stops — the swipe
  // silently never completes. `none` is required on the element that
  // owns the gesture, not just on the image inside it.
  style={{ touchAction: zoom > 1.05 ? "none" : continuous ? "pan-y" : "none" }}
  >
  {continuous ? (
  <ReaderPageImage
  url={pages[clamped]?.url || ""}
  alt={`${label} page ${shown}`}
  pageLabel={`${shown} / ${total}`}
  webtoon
  // The same transform the paged branch gets. It used to be omitted
  // here, so pinch-to-zoom and pan silently did nothing on a webtoon
  // — the zoom state changed, the pixels did not.
  transform={{ x: pan.x, y: pan.y, scale: zoom }}
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

  {/*
    Announced position. `sr-only` rather than `hidden`: a display:none node is
    removed from the accessibility tree, so the live region would never fire.
    `aria-live` without `aria-atomic` is deliberate — this string is replaced
    wholesale, and atomic would re-read the whole region each turn for no gain.
  */}
  <p aria-live="polite" role="status" className="sr-only">
  {announcement}
  </p>
  </div>

  {/* bottom bar */}
  {chromeVisible && (
  <div className="absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/85 to-transparent">
  <div className="h-1 bg-kindle-text/10">
  <div
  className="h-full bg-kindle-text/70 transition-[width] duration-150"
  style={{ width: `${(shown / total) * 100}%` }}
  />
  </div>
  <div className="flex items-center justify-between gap-2 px-3 py-2">
  <button
  onClick={back}
  disabled={!canAct("back", { rtl: readingRtl, total, index: clamped }) && !chapters.length}
  aria-label="Previous page"
  className="p-2 rounded-lg hover:bg-kindle-text/10 disabled:opacity-25 cursor-pointer"
  >
  <ChevronLeft className="w-5 h-5 text-kindle-text" />
  </button>

  <button
  onClick={() => setChromeVisible(true)}
  className="text-[10px] font-mono text-kindle-text px-3 py-1 rounded-lg hover:bg-kindle-text/10 cursor-pointer"
  >
  {shown} / {total}
  </button>

  <div className="flex items-center gap-1">
  <button
  onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
  aria-label="Zoom out"
  className="p-2 rounded-lg hover:bg-kindle-text/10 disabled:opacity-25 cursor-pointer"
  disabled={zoom <= 1}
  >
  <Minus className="w-4 h-4 text-kindle-text" />
  </button>
  <button
  onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
  aria-label="Zoom in"
  className="p-2 rounded-lg hover:bg-kindle-text/10 cursor-pointer"
  >
  <Plus className="w-4 h-4 text-kindle-text" />
  </button>
  </div>

  <button
  onClick={forward}
  disabled={!canAct("forward", { rtl: readingRtl, total, index: clamped })}
  aria-label="Next page"
  className="p-2 rounded-lg hover:bg-kindle-text/10 disabled:opacity-25 cursor-pointer"
  >
  {/* Mirrored in RTL so both arrows always point "forward". */}
  <ChevronRight
  className={`w-5 h-5 text-kindle-text ${readingRtl ? "-scale-x-100" : ""}`}
  />
  </button>
  </div>

  {/* step between chapters without leaving the reader */}
  {chapters.length > 1 && (
  <div className="flex items-center justify-between gap-2 px-3 pb-3">
  {/*
  The chapter list arrives newest-first (see the `ordered` sort in
  ComicDetailView), so a HIGHER index is the NEWER chapter — the
  reverse of what the array offsets suggest. `stepChapter` takes the
  direction in reading order so these labels stay honest; the
  inversion lives in one place instead of being re-guessed per button.
  */}
  <button
  onClick={() => stepChapter("prev")}
  className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text cursor-pointer"
  >
  ← Prev chapter
  </button>
  <button
  onClick={() => stepChapter("next")}
  className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text cursor-pointer"
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
