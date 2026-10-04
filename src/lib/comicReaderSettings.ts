import { READER_THEMES } from "./readerThemes";

/**
 * Comic-reader settings that the book reader's settings module does not own.
 *
 * Why this is a separate module rather than more fields on `readerSettings`:
 * that module is shared — the book reader's persistence effect and the comic
 * reader's sheet both write through it — and its `saveSettings` rebuilds the
 * record from `DEFAULT_SETTINGS`, keeping only keys it knows about. A comic
 * field added there would therefore be silently *erased* by the next write
 * from the other reader. Two independent records with two independent
 * sanitizers is the version where neither can clobber the other.
 *
 * The shared, genuinely common preferences stay in `readerSettings`: fit-free
 * brightness, keep-awake, auto-hide, sleep timer and the direction override.
 * What lives here is the spatial half of a comic reader — how a page is
 * fitted, whether the strip scrolls — plus the two display filters and the
 * wheel lock ported from the book reader's Display Settings panel.
 *
 * LOCAL ONLY, for the same reason as `readerSettings`: a grayscale setting
 * chosen for a colour-blind-friendly read is a property of the screen in
 * front of the user, not of their account. Nothing here may grow a cloud path.
 */

/** How a comic page is fitted to the viewport. */
export type ComicPageFit = "contain" | "cover" | "width";

/**
 * Continuous vertical scroll: the webtoon strip, as one long image rather
 * than discrete pages.
 *
 * Tri-state rather than a boolean. `webtoon` is a *property of the series*,
 * and a boolean override has no way to say "I know this one is a strip, but
 * page it anyway" — the reader would have no choice but to flip a setting that
 * was correct. `"source"` is the default and defers to the series; the other
 * two are the user overriding the series in either direction.
 */
export type ContinuousMode = "source" | "on" | "off";

export interface ComicReaderPrefs {
  /** Spatial fit for the page surface. */
  pageFit: ComicPageFit;
  /** Whether the chapter is one scrolling strip instead of paged. */
  continuous: ContinuousMode;
  /** Render pages as black and white. Line art reads better this way. */
  grayscaleImages: boolean;
  /** Drop the artwork and show the chapter/page text card instead. */
  hideImages: boolean;
  /** Stop the mouse wheel from turning pages. */
  disableMouseScroll: boolean;
  /**
   * Reading theme key, matching `READER_THEMES` in `readerThemes.ts`.
   *
   * The comic reader previously hardcoded `bg-black` with white-alpha chrome, so
   * it ignored the selected theme entirely and looked like a different app from
   * the EPUB reader. Sharing the same key space means one theme picker drives
   * both readers and they stay visually consistent.
   */
  theme: string;
}

export const DEFAULT_COMIC_PREFS: ComicReaderPrefs = {
  pageFit: "contain",
  continuous: "source",
  grayscaleImages: false,
  hideImages: false,
  disableMouseScroll: false,
  theme: "dark",
};

const STORAGE_KEY = "kora_comic_reader_settings";
/** Bumped when the shape changes; an unknown version falls back to defaults. */
const SCHEMA_VERSION = 1;

interface StoredComicPrefs {
  version: number;
  prefs: ComicReaderPrefs;
}

/**
 * Old key names, mapped to current ones.
 *
 * This reader has had three naming passes and localStorage is not versioned
 * per field — the version check only catches a whole-record change. A user who
 * set grayscale under the old key and then updates the app should not silently
 * lose it, so the aliases are resolved on read instead. Only the *values* are
 * migrated; nothing is ever written back in an old shape.
 */
const LEGACY_ALIASES: Record<string, string> = {
  greyImages: "grayscaleImages",
  grayscale: "grayscaleImages",
  noImages: "hideImages",
  hideArtwork: "hideImages",
  blockWheel: "disableMouseScroll",
  noMouseScroll: "disableMouseScroll",
  fitMode: "pageFit",
  webtoon: "continuous",
  isContinuous: "continuous",
};

/** Legacy `pageFit` values that mean a current one. */
const LEGACY_FIT_VALUES: Record<string, ComicPageFit> = {
  "fit-page": "contain",
  "fit-width": "width",
  "page-cover": "cover",
  fill: "cover",
  stretch: "cover",
  original: "contain",
};

/** Legacy `continuous` values, including the booleans it used to be. */
function coerceContinuous(value: unknown): ContinuousMode | undefined {
  if (value === "on" || value === "off" || value === "source") return value;
  if (value === true) return "on";
  if (value === false) return "off";
  if (value === "webtoon" || value === "vertical" || value === "continuous") return "on";
  if (value === "paged" || value === "paged-scroll") return "off";
  return undefined;
}

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // Probe-write, not a bare read: private-mode Safari and a locked-down
    // WebView both expose `localStorage` and then throw on use. Reading a
    // setting must never be able to break the reader.
    const probe = `${STORAGE_KEY}__probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Coerce anything into a valid comic-prefs object.
 *
 * Every field is validated independently, for the reason `readerSettings`
 * does the same: a reader that reverts every preference because one number
 * went out of range is worse than one setting resetting. Alias resolution runs
 * first, so a legacy key is treated exactly like the current one and a
 * current key always wins over an alias pointing at the same field.
 */
export function sanitizeComicPrefs(input: unknown): ComicReaderPrefs {
  const base = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const raw: Record<string, unknown> = { ...base };
  for (const [legacy, current] of Object.entries(LEGACY_ALIASES)) {
    if (raw[legacy] !== undefined && raw[current] === undefined) raw[current] = raw[legacy];
  }
  const out: ComicReaderPrefs = { ...DEFAULT_COMIC_PREFS };

  if (raw.pageFit === "contain" || raw.pageFit === "cover" || raw.pageFit === "width") {
    out.pageFit = raw.pageFit;
  } else if (typeof raw.pageFit === "string" && LEGACY_FIT_VALUES[raw.pageFit]) {
    out.pageFit = LEGACY_FIT_VALUES[raw.pageFit]!;
  }

  const continuous = coerceContinuous(raw.continuous);
  if (continuous) out.continuous = continuous;

  if (typeof raw.grayscaleImages === "boolean") out.grayscaleImages = raw.grayscaleImages;
  if (typeof raw.hideImages === "boolean") out.hideImages = raw.hideImages;
  if (typeof raw.disableMouseScroll === "boolean") out.disableMouseScroll = raw.disableMouseScroll;
  // Only accept a key that actually exists in READER_THEMES — an unknown string
  // would resolve to an undefined theme and paint the reader unstyled.
  if (typeof raw.theme === "string" && raw.theme in READER_THEMES) {
    out.theme = raw.theme;
  }
  return out;
}

/** Read comic prefs, falling back to defaults for missing or unusable storage. */
export function loadComicPrefs(): ComicReaderPrefs {
  const store = safeStorage();
  if (!store) return { ...DEFAULT_COMIC_PREFS };
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_COMIC_PREFS };
    const record = parsed as Partial<StoredComicPrefs>;
    // A future version may have renamed fields; the defaults are the safe read.
    if (record.version !== SCHEMA_VERSION) return { ...DEFAULT_COMIC_PREFS };
    return sanitizeComicPrefs(record.prefs);
  } catch {
    return { ...DEFAULT_COMIC_PREFS };
  }
}

/** Persist comic prefs. Never throws — a full quota must not break reading. */
export function saveComicPrefs(prefs: ComicReaderPrefs): void {
  const store = safeStorage();
  if (!store) return;
  try {
    const record: StoredComicPrefs = {
      version: SCHEMA_VERSION,
      prefs: sanitizeComicPrefs(prefs),
    };
    store.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* quota or private mode — reading must not break because of it */
  }
}

/**
 * Merge a partial change into the stored prefs and return the result.
 *
 * Keys explicitly set to `undefined` are SKIPPED rather than spread, for the
 * same reason `readerSettings.updateSettings` does it: the naive
 * `{ ...load(), ...patch }` lets an undefined override a real stored value and
 * the sanitizer then rejects it back to the default, so a component passing an
 * optional field silently reset the user's preference.
 */
export function updateComicPrefs(patch: Partial<ComicReaderPrefs>): ComicReaderPrefs {
  const current = loadComicPrefs();
  const defined: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) defined[k] = v;
  }
  const next = sanitizeComicPrefs({ ...current, ...defined });
  saveComicPrefs(next);
  return next;
}

/**
 * Is this chapter a scrolling strip?
 *
 * The series' own `webtoon` flag is the default; the user's setting only wins
 * when it says something. An override that silently beat the series would
 * make a correctly-flagged webtoon unscrollable with nothing on screen to
 * explain why.
 */
export function effectiveContinuous(
  prefs: ComicReaderPrefs,
  sourceWebtoon?: boolean
): boolean {
  if (prefs.continuous === "on") return true;
  if (prefs.continuous === "off") return false;
  return sourceWebtoon === true;
}

/**
 * The classes that put the page surface into the chosen fit.
 *
 * A pure function so the fit rules are testable without a DOM — which matters
 * because a comic page's aspect ratio is whatever the artist's scanline is, and
 * the failure mode ("cover stretches the art", "width ignores the viewport")
 * is a sizing bug that a screenshot of a single well-proportioned page will not
 * reproduce.
 *
 * The child surface ships `max-w-full max-h-full object-contain`, so "contain"
 * needs no class at all — the default already letterboxes. The other two have
 * to reach *through* the wrapper to the `<img>`/`<canvas>`, which is why they
 * are descendant variants rather than styles on this element. A descendant
 * variant also outranks the child's own single class on specificity, so no
 * `!important` is needed to replace its `object-contain`.
 */
export function pageFitClasses(opts: {
  pageFit: ComicPageFit;
  continuous: boolean;
}): string {
  // A webtoon strip is width-fit by definition: it is one image thousands of
  // pixels tall, and "cover" would stretch it to a viewport-shaped smear while
  // "contain" would shrink it to an unreadable sliver. The fit control is
  // hidden in this mode for the same reason.
  if (opts.continuous) return "w-full";
  switch (opts.pageFit) {
    case "cover":
      return "[&_img]:w-full [&_img]:h-full [&_img]:object-cover [&_canvas]:w-full [&_canvas]:h-full [&_canvas]:object-cover";
    case "width":
      return "[&_img]:w-full [&_img]:h-auto [&_img]:object-contain [&_canvas]:w-full [&_canvas]:h-auto";
    case "contain":
    default:
      return "";
  }
}

export const COMIC_PAGE_FITS_FOR_TEST: readonly ComicPageFit[] = ["contain", "cover", "width"];
export const CONTINUOUS_MODES_FOR_TEST: readonly ContinuousMode[] = ["source", "on", "off"];
export const COMIC_SCHEMA_VERSION_FOR_TEST = SCHEMA_VERSION;

/**
 * The page-fit control's options, with the wording a user needs.
 *
 * A bare enum is not a label: "cover" means nothing until you know it crops
 * the page, and "contain" means nothing until you know it letterboxes. The
 * description is the whole reason the control is usable on a comic, where the
 * page's aspect ratio changes from panel to panel.
 */
export const COMIC_PAGE_FITS: readonly { value: ComicPageFit; label: string; desc: string }[] = [
  { value: "contain", label: "Fit page", desc: "Whole page visible, letterboxed." },
  { value: "width", label: "Fit width", desc: "Full width; a tall page scrolls." },
  { value: "cover", label: "Fill screen", desc: "Fills the screen and crops the edges." },
];

/** The continuous-scroll control's options, as a tri-state. */
export const CONTINUOUS_MODES: readonly {
  value: ContinuousMode;
  label: string;
  desc: string;
}[] = [
  { value: "source", label: "Auto", desc: "Follow whatever the series declares." },
  { value: "on", label: "On", desc: "One long scrolling strip." },
  { value: "off", label: "Off", desc: "Discrete pages, one turn at a time." },
];

/**
 * Reading-brightness presets, in percent.
 *
 * The same five steps the book reader cycles through from its header sun
 * icon. Presets rather than a free slider alone, because a comic page is
 * mostly white paper: the useful adjustments are "dim it a lot" and "put it
 * back", and a fine-grained slider is a worse way to get there than four
 * coarse, repeatable steps.
 */
export const READING_BRIGHTNESS: readonly number[] = [100, 85, 70, 55, 40];

/**
 * Step to the next brightness preset at or below `current`.
 *
 * Snap-to-preset rather than +/-: the value may have arrived from a slider or
 * from a legacy record, so "next" has to be defined for any input. A value
 * that is not a preset steps down to the nearest one below it, and the
 * bottom step wraps back to full brightness — a reader who has dimmed the
 * screen as far as it goes needs one predictable way back out.
 */
export function nextBrightnessPreset(current: number): number {
  const exact = READING_BRIGHTNESS.indexOf(current);
  if (exact >= 0) return READING_BRIGHTNESS[(exact + 1) % READING_BRIGHTNESS.length]!;
  const nextLower = READING_BRIGHTNESS.find((v) => v < current);
  return nextLower ?? READING_BRIGHTNESS[0]!;
}

