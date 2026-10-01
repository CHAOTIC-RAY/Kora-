/**
 * Comic reader settings.
 *
 * Deliberately LOCAL ONLY — these never sync.
 *
 * The distinction matters and is enforced by the module boundary: bookmarks
 * and reading position are the user's *data* and belong on every device they
 * own, while reader settings are a property of the screen in front of them.
 * A brightness of 0.25 set on a phone in the dark has no business arriving on
 * a tablet in daylight, and a sync that carried it there would be a bug, not
 * a feature. So `readerSettings` has no cloud path at all, and `comicState`
 * — which does sync — must never import from here.
 *
 * Storage is `localStorage` behind a probe-write, because private-mode Safari
 * and a locked-down WebView both expose the object and then throw on use.
 * Reading a setting must never be able to break the reader.
 */

/** How a page is fitted to the screen. */
export type FitMode = "width" | "height" | "contain" | "original";

/** What the brightness slider does on this device. */
export type BrightnessMode = "system" | "manual";

export interface ReaderSettings {
  /** How a page fills the viewport. */
  fitMode: FitMode;
  /**
   * Override the series' natural reading direction.
   *
   * `undefined` means "follow the source", which is right for the majority of
   * manga and wrong for the reader who prefers otherwise.
   */
  directionOverride?: "rtl" | "ltr";
  /** 0.2–1. Screen brightness when `brightnessMode` is manual. */
  brightness: number;
  brightnessMode: BrightnessMode;
  /** Hold the screen awake while a page is open. */
  keepAwake: boolean;
  /** Hide the bars after a period of inactivity. 0 disables auto-hide. */
  autoHideSeconds: number;
  /** Turn the page after this long. 0 disables the timer. */
  sleepTimerMinutes: number;
  /** Suppress page-turn animation. */
  reducedMotion: boolean;
  /** Two-page spread on wide screens. */
  doublePage: boolean;
  /** Prefetch this many pages ahead of the current one. */
  preloadAhead: number;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fitMode: "contain",
  brightness: 1,
  brightnessMode: "system",
  keepAwake: true,
  autoHideSeconds: 5,
  sleepTimerMinutes: 0,
  reducedMotion: false,
  doublePage: false,
  preloadAhead: 2,
};

const STORAGE_KEY = "kora_reader_settings";
/** Bumped when the shape changes; unknown versions fall back to defaults. */
const SCHEMA_VERSION = 1;

interface StoredSettings {
  version: number;
  settings: ReaderSettings;
}

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = `${STORAGE_KEY}__probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return store();
  } catch {
    return null;
  }
  function store(): Storage {
    return localStorage;
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Coerce anything into a valid settings object.
 *
 * Every field is validated independently so one corrupt value cannot discard
 * the whole record — a reader that silently reverts every preference because
 * a single number went out of range is worse than one setting resetting.
 */
export function sanitizeSettings(input: unknown): ReaderSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: ReaderSettings = { ...DEFAULT_SETTINGS };

  if (raw.fitMode === "width" || raw.fitMode === "height" ||
      raw.fitMode === "contain" || raw.fitMode === "original") {
    out.fitMode = raw.fitMode;
  }
  if (raw.directionOverride === "rtl" || raw.directionOverride === "ltr") {
    out.directionOverride = raw.directionOverride;
  }
  if (typeof raw.brightness === "number" && Number.isFinite(raw.brightness)) {
    out.brightness = clamp(raw.brightness, 0.2, 1);
  }
  if (raw.brightnessMode === "system" || raw.brightnessMode === "manual") {
    out.brightnessMode = raw.brightnessMode;
  }
  if (typeof raw.keepAwake === "boolean") out.keepAwake = raw.keepAwake;
  if (typeof raw.autoHideSeconds === "number" && Number.isFinite(raw.autoHideSeconds)) {
    // Capped at an hour: a longer "hide the bars" is indistinguishable from
    // broken, and the user has no way back once the controls are gone.
    out.autoHideSeconds = clamp(Math.round(raw.autoHideSeconds), 0, 3600);
  }
  if (typeof raw.sleepTimerMinutes === "number" && Number.isFinite(raw.sleepTimerMinutes)) {
    out.sleepTimerMinutes = clamp(Math.round(raw.sleepTimerMinutes), 0, 600);
  }
  if (typeof raw.reducedMotion === "boolean") out.reducedMotion = raw.reducedMotion;
  if (typeof raw.doublePage === "boolean") out.doublePage = raw.doublePage;
  if (typeof raw.preloadAhead === "number" && Number.isFinite(raw.preloadAhead)) {
    out.preloadAhead = clamp(Math.round(raw.preloadAhead), 0, 8);
  }
  return out;
}

/** Read settings, falling back to defaults for missing or unusable storage. */
export function loadSettings(): ReaderSettings {
  const store = safeStorage();
  if (!store) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    const record = parsed as Partial<StoredSettings>;
    // A future version may have renamed fields; the defaults are the safe read.
    if (record.version !== SCHEMA_VERSION) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(record.settings);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist settings. Never throws — a full quota must not break reading. */
export function saveSettings(settings: ReaderSettings): void {
  const store = safeStorage();
  if (!store) return;
  try {
    const record: StoredSettings = {
      version: SCHEMA_VERSION,
      settings: sanitizeSettings(settings),
    };
    store.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* quota or private mode — reading must not break because of it */
  }
}

/**
 * Merge a partial change into the stored settings and return the result.
 *
 * Keys explicitly set to `undefined` are SKIPPED rather than spread. The naive
 * `{ ...loadSettings(), ...patch }` lets an undefined override a real stored
 * value, and `sanitizeSettings` then rejects it back to the default — so a
 * component passing an optional or not-yet-loaded value silently reset the
 * user's preference. Verified: a stored `fitMode: "width"` plus
 * `{ fitMode: undefined }` came back as `"contain"`.
 */
export function updateSettings(patch: Partial<ReaderSettings>): ReaderSettings {
  const current = loadSettings();
  const defined: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) defined[k] = v;
  }
  const next = sanitizeSettings({ ...current, ...defined });
  saveSettings(next);
  return next;
}

/**
 * The direction to read in.
 *
 * A source-declared direction is the default; the user's override only wins
 * when it is explicitly set. An override that silently beat the source would
 * make a correctly-declared manga read backwards with no way to tell why.
 */
export function effectiveDirection(
  settings: ReaderSettings,
  sourceDirection?: "rtl" | "ltr"
): "rtl" | "ltr" {
  return settings.directionOverride ?? sourceDirection ?? "rtl";
}

export const FIT_MODES_FOR_TEST: readonly FitMode[] = ["width", "height", "contain", "original"];
export const SCHEMA_VERSION_FOR_TEST = SCHEMA_VERSION;
