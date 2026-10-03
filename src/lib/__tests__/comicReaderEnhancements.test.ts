/**
 * Comic-reader enhancement tests.
 *
 * The load-bearing claims, one per section:
 *
 *   1. Comic settings survive the shared settings module. `readerSettings`
 *      and `comicReaderSettings` write to DIFFERENT keys on purpose, because
 *      the shared `saveSettings` rebuilds its record from the shared defaults
 *      and keeps only the keys it knows. A comic field added there would be
 *      erased by the next write from the other reader — a regression that is
 *      invisible until a user opens the epub reader and comes back.
 *   2. Every field is validated independently, including from the legacy key
 *      names this reader has been through, so one corrupt value cannot reset
 *      the record.
 *   3. Page fit and continuous scroll produce real, distinct classes, and a
 *      webtoon strip is never width- or cover-fitted.
 *   4. The brightness presets cycle the way the book's reader cycles them, and
 *      are reachable from any input value including one off the preset grid.
 */
import {
  sanitizeComicPrefs,
  loadComicPrefs,
  saveComicPrefs,
  updateComicPrefs,
  effectiveContinuous,
  pageFitClasses,
  nextBrightnessPreset,
  READING_BRIGHTNESS,
  COMIC_PAGE_FITS,
  CONTINUOUS_MODES,
  DEFAULT_COMIC_PREFS,
  COMIC_PAGE_FITS_FOR_TEST,
  CONTINUOUS_MODES_FOR_TEST,
  COMIC_SCHEMA_VERSION_FOR_TEST,
  type ComicPageFit,
} from "../comicReaderSettings";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  updateSettings,
} from "../readerSettings";

let passed = 0;
let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name}\n        expected ${expected}, got ${actual}`);
  }
}
function checkTrue(name: string, actual: unknown) {
  check(name, actual, true);
}

// A minimal in-memory localStorage so the module's probe-write path is
// exercised rather than stubbed away.
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const mem = new MemStorage();
(globalThis as any).localStorage = mem;

// ── Defaults ───────────────────────────────────────────────────────────────
const d = sanitizeComicPrefs({});
check("empty object -> default fit", d.pageFit, DEFAULT_COMIC_PREFS.pageFit);
check("empty object -> auto continuous", d.continuous, "source");
check("empty object -> colour", d.grayscaleImages, false);
check("empty object -> artwork shown", d.hideImages, false);
check("empty object -> wheel turns pages", d.disableMouseScroll, false);
// The default fit has to be the one that cannot lose artwork. A reader that
// opens cropped because of a missing preference has no way to get the page
// back without finding this setting.
check("default fit never crops", DEFAULT_COMIC_PREFS.pageFit, "contain");
check("default continuous defers to source", DEFAULT_COMIC_PREFS.continuous, "source");

// ── Hostile input ──────────────────────────────────────────────────────────
check("null input", sanitizeComicPrefs(null).pageFit, DEFAULT_COMIC_PREFS.pageFit);
check("undefined input", sanitizeComicPrefs(undefined).continuous, "source");
check("string input", sanitizeComicPrefs("nope").hideImages, false);
check("array input", sanitizeComicPrefs([]).grayscaleImages, false);
check("number input", sanitizeComicPrefs(42).disableMouseScroll, false);
check("boolean input", sanitizeComicPrefs(true).pageFit, "contain");
check("function input", sanitizeComicPrefs(() => {}).continuous, "source");

// ── Enum validation ────────────────────────────────────────────────────────
// "stretch" is NOT used as the unknown value here: it is a legacy alias for
// "cover", tested separately below. Using it here would assert the migration
// map was wrong.
check("bogus fit rejected", sanitizeComicPrefs({ pageFit: "shrink" }).pageFit, "contain");
check("bogus fit 'original' rejected", sanitizeComicPrefs({ pageFit: "original" }).pageFit, "contain");
check("bogus fit 'height' rejected", sanitizeComicPrefs({ pageFit: "height" }).pageFit, "contain");
check("bogus continuous rejected", sanitizeComicPrefs({ continuous: "maybe" }).continuous, "source");
for (const mode of COMIC_PAGE_FITS_FOR_TEST) {
  check(`fit accepted: ${mode}`, sanitizeComicPrefs({ pageFit: mode }).pageFit, mode);
}
for (const mode of CONTINUOUS_MODES_FOR_TEST) {
  check(`continuous accepted: ${mode}`, sanitizeComicPrefs({ continuous: mode }).continuous, mode);
}

// Wrong TYPES, not just wrong values — a string where a boolean belongs must
// not be coerced to `true` by a truthiness check somewhere downstream.
check("string for boolean rejected", sanitizeComicPrefs({ grayscaleImages: "yes" }).grayscaleImages, false);
check("number for boolean rejected", sanitizeComicPrefs({ hideImages: 1 }).hideImages, false);
check("object for boolean rejected", sanitizeComicPrefs({ disableMouseScroll: {} }).disableMouseScroll, false);
check("number for fit rejected", sanitizeComicPrefs({ pageFit: 2 }).pageFit, "contain");
check("NaN for continuous rejected", sanitizeComicPrefs({ continuous: NaN }).continuous, "source");

// ── Legacy key names ───────────────────────────────────────────────────────
// This reader shipped three naming passes. A user who set a filter under the
// old key and updated the app should not silently lose it.
const legacy = sanitizeComicPrefs({ greyImages: true, noImages: true, blockWheel: true });
check("legacy greyImages", legacy.grayscaleImages, true);
check("legacy noImages", legacy.hideImages, true);
check("legacy blockWheel", legacy.disableMouseScroll, true);
check("legacy grayscale", sanitizeComicPrefs({ grayscale: true }).grayscaleImages, true);
check("legacy hideArtwork", sanitizeComicPrefs({ hideArtwork: true }).hideImages, true);
check("legacy noMouseScroll", sanitizeComicPrefs({ noMouseScroll: true }).disableMouseScroll, true);
check("legacy fitMode key -> pageFit", sanitizeComicPrefs({ fitMode: "width" }).pageFit, "width");
check("legacy webtoon key -> continuous", sanitizeComicPrefs({ webtoon: true }).continuous, "on");
check("legacy isContinuous key -> continuous", sanitizeComicPrefs({ isContinuous: false }).continuous, "off");
// A current key must win over an alias aiming at the same field.
check("current key beats legacy alias", sanitizeComicPrefs({ grayscale: true, grayscaleImages: false }).grayscaleImages, false);

// Legacy VALUES, under a current key.
check("legacy fit value 'fit-page'", sanitizeComicPrefs({ pageFit: "fit-page" }).pageFit, "contain");
check("legacy fit value 'fit-width'", sanitizeComicPrefs({ pageFit: "fit-width" }).pageFit, "width");
check("legacy fit value 'page-cover'", sanitizeComicPrefs({ pageFit: "page-cover" }).pageFit, "cover");
check("legacy fit value 'fill'", sanitizeComicPrefs({ pageFit: "fill" }).pageFit, "cover");
check("legacy fit value 'stretch'", sanitizeComicPrefs({ pageFit: "stretch" }).pageFit, "cover");
check("legacy continuous 'webtoon'", sanitizeComicPrefs({ continuous: "webtoon" }).continuous, "on");
check("legacy continuous 'paged'", sanitizeComicPrefs({ continuous: "paged" }).continuous, "off");
// `continuous` used to be a boolean, and a real stored record still has one.
check("boolean true -> on", sanitizeComicPrefs({ continuous: true }).continuous, "on");
check("boolean false -> off", sanitizeComicPrefs({ continuous: false }).continuous, "off");

// ── One corrupt field must not reset the others ────────────────────────────
const partial = sanitizeComicPrefs({
  pageFit: "cover",
  grayscaleImages: true,
  continuous: "off",
  disableMouseScroll: "nope",
});
check("valid fit kept", partial.pageFit, "cover");
check("valid flag kept", partial.grayscaleImages, true);
check("valid continuous kept", partial.continuous, "off");
check("corrupt flag falls back alone", partial.disableMouseScroll, false);

// ── Round-trip through storage ─────────────────────────────────────────────
saveComicPrefs({ ...DEFAULT_COMIC_PREFS, pageFit: "width", grayscaleImages: true, continuous: "off" });
let loaded = loadComicPrefs();
check("round-trip fit", loaded.pageFit, "width");
check("round-trip grayscale", loaded.grayscaleImages, true);
check("round-trip continuous", loaded.continuous, "off");

const merged = updateComicPrefs({ hideImages: true });
check("update merges new field", merged.hideImages, true);
check("update preserves others", merged.pageFit, "width");
check("update persisted", loadComicPrefs().hideImages, true);

// An explicit `undefined` must not clobber a stored value — the naive
// `{ ...current, ...patch }` spread lets it, and the sanitizer then rejects it
// back to the default, so a component passing an optional field silently
// resets the user's preference.
const afterUndefined = updateComicPrefs({ pageFit: undefined });
check("undefined patch does not reset fit", afterUndefined.pageFit, "width");
check("undefined patch not persisted", loadComicPrefs().pageFit, "width");

// ── The two records must not clobber each other ────────────────────────────
// The regression this whole split exists to prevent.
saveSettings({ ...DEFAULT_SETTINGS, brightness: 0.4, fitMode: "width" });
saveComicPrefs({ ...DEFAULT_COMIC_PREFS, pageFit: "cover", grayscaleImages: true });
updateSettings({ sleepTimerMinutes: 20 });
check("shared write survives comic write", loadComicPrefs().pageFit, "cover");
check("comic flags survive shared write", loadComicPrefs().grayscaleImages, true);
updateComicPrefs({ hideImages: true });
check("shared write survived comic update", loadSettings().brightness, 0.4);
check("shared brightness mode untouched", loadSettings().brightnessMode, DEFAULT_SETTINGS.brightnessMode);

// ── Corrupt storage falls back to defaults ─────────────────────────────────
mem.setItem("kora_comic_reader_settings", "{not json");
check("corrupt JSON -> defaults", loadComicPrefs().pageFit, DEFAULT_COMIC_PREFS.pageFit);
mem.setItem("kora_comic_reader_settings", JSON.stringify({ version: 999, prefs: { pageFit: "cover" } }));
check("unknown version -> defaults", loadComicPrefs().pageFit, DEFAULT_COMIC_PREFS.pageFit);
mem.setItem("kora_comic_reader_settings", JSON.stringify("a string"));
check("non-object record -> defaults", loadComicPrefs().pageFit, DEFAULT_COMIC_PREFS.pageFit);
mem.setItem("kora_comic_reader_settings", "null");
check("null record -> defaults", loadComicPrefs().continuous, "source");
mem.setItem(
  "kora_comic_reader_settings",
  JSON.stringify({ version: COMIC_SCHEMA_VERSION_FOR_TEST, prefs: { pageFit: "nope", grayscaleImages: true } })
);
check("bad enum in storage -> default", loadComicPrefs().pageFit, DEFAULT_COMIC_PREFS.pageFit);
check("good field in bad storage survives", loadComicPrefs().grayscaleImages, true);
mem.removeItem("kora_comic_reader_settings");
check("absent storage -> defaults", loadComicPrefs().pageFit, DEFAULT_COMIC_PREFS.pageFit);

// A throwing storage must not take the reader down with it: private-mode
// Safari and a locked-down WebView both expose localStorage then throw.
const realStorage = (globalThis as any).localStorage;
(globalThis as any).localStorage = {
  get length() { throw new Error("SecurityError"); },
  key() { throw new Error("SecurityError"); },
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("SecurityError"); },
  removeItem() { throw new Error("SecurityError"); },
  clear() { throw new Error("SecurityError"); },
};
check("throwing storage -> defaults", loadComicPrefs().pageFit, DEFAULT_COMIC_PREFS.pageFit);
let saveSurvived = true;
try {
  saveComicPrefs({ ...DEFAULT_COMIC_PREFS, pageFit: "cover" });
  updateComicPrefs({ pageFit: "width" });
} catch {
  saveSurvived = false;
}
checkTrue("saving into throwing storage does not throw", saveSurvived);
(globalThis as any).localStorage = realStorage;

// ── Continuous: source default, user override wins ─────────────────────────
// `webtoon` is a property of the SERIES. An override that silently beat it
// would make a correctly-flagged strip unscrollable with nothing on screen to
// explain why — so "source" has to genuinely defer.
const auto = { ...DEFAULT_COMIC_PREFS };
check("auto follows source rtl-strip", effectiveContinuous(auto, true), true);
check("auto follows source paged", effectiveContinuous(auto, false), false);
check("auto with no source flag", effectiveContinuous(auto, undefined), false);
check("auto with false-y source", effectiveContinuous(auto, 0 as unknown as boolean), false);
const forcedOn = { ...DEFAULT_COMIC_PREFS, continuous: "on" as const };
const forcedOff = { ...DEFAULT_COMIC_PREFS, continuous: "off" as const };
check("override on beats source false", effectiveContinuous(forcedOn, false), true);
check("override off beats source true", effectiveContinuous(forcedOff, true), false);
check("override on with no source", effectiveContinuous(forcedOn, undefined), true);

// ── Page-fit classes ───────────────────────────────────────────────────────
// A comic page's aspect ratio is whatever the scanline is, so the three fits
// must produce three genuinely different surfaces — and "contain" must be the
// empty string, because the page component already letterboxes by default and
// a redundant class would be a second source of truth for the same rule.
check("contain adds nothing", pageFitClasses({ pageFit: "contain", continuous: false }), "");
const cover = pageFitClasses({ pageFit: "cover", continuous: false });
const width = pageFitClasses({ pageFit: "width", continuous: false });
checkTrue("cover is not empty", cover !== "");
checkTrue("width is not empty", width !== "");
checkTrue("cover differs from width", cover !== width);
checkTrue("cover crops", cover.includes("object-cover"));
checkTrue("width does not crop", !width.includes("object-cover"));
checkTrue("cover fills height", cover.includes("h-full"));
checkTrue("width lets height follow", !width.includes("h-full"));
checkTrue("width still constrains to object-contain", width.includes("object-contain"));
// Both must reach the canvas as well as the img: the page component draws to
// a canvas whenever the decode would be too big, which is most comic pages on
// a phone. A fit that only styled the img would silently do nothing there.
checkTrue("cover reaches canvas", cover.includes("canvas"));
checkTrue("width reaches canvas", width.includes("canvas"));

// A webtoon strip is one image thousands of pixels tall. Cover-fitted it
// becomes a viewport-shaped smear; contain-fitted, an unreadable sliver. The
// fit control is hidden in this mode, so the classes must agree.
const strip = pageFitClasses({ pageFit: "cover", continuous: true });
check("continuous ignores cover", strip, "w-full");
check("continuous ignores contain", pageFitClasses({ pageFit: "contain", continuous: true }), "w-full");
check("continuous ignores width", pageFitClasses({ pageFit: "width", continuous: true }), "w-full");

// Every fit the UI offers must produce a usable surface.
for (const fit of COMIC_PAGE_FITS_FOR_TEST) {
  checkTrue(
    `fit ${fit} yields a class`,
    pageFitClasses({ pageFit: fit as ComicPageFit, continuous: false }) !== "" ||
      fit === DEFAULT_COMIC_PREFS.pageFit
  );
}

// ── Continuous-scroll override must beat the fit control ──────────────────
// If "on" won without the fit being bypassed, the user would have a scroll
// strip that is also cover-cropped, and the sheet hides the fit control while
// continuous is on — so the only way to avoid that is for the classes to
// agree.
check(
  "continuous wins over every fit",
  COMIC_PAGE_FITS_FOR_TEST.every((f) => pageFitClasses({ pageFit: f, continuous: true }) === "w-full"),
  true
);

// ── Brightness presets ─────────────────────────────────────────────────────
// The same five steps the book's reader cycles through. The cycle has to be
// total: the value may have arrived from the slider, so it is not always on
// the preset grid.
check("presets count", READING_BRIGHTNESS.length, 5);
check("presets are descending", [...READING_BRIGHTNESS].every((v, i, a) => i === 0 || a[i - 1]! > v), true);
check("presets include full brightness", READING_BRIGHTNESS[0], 100);
check("presets include a dim step", READING_BRIGHTNESS.includes(40), true);
check("cycle 100 -> 85", nextBrightnessPreset(100), 85);
check("cycle 85 -> 70", nextBrightnessPreset(85), 70);
check("cycle 70 -> 55", nextBrightnessPreset(70), 55);
check("cycle 55 -> 40", nextBrightnessPreset(55), 40);
// The bottom step wraps: a reader who has dimmed as far as it goes needs one
// predictable way back to full brightness.
check("cycle 40 wraps to 100", nextBrightnessPreset(40), 100);
// Off-grid values snap DOWN to the nearest preset, never up — stepping up
// would make a dimmed screen flash brighter on a "dim it more" tap.
check("off-grid 90 snaps down", nextBrightnessPreset(90), 85);
check("off-grid 50 snaps down", nextBrightnessPreset(50), 40);
check("off-grid 1 snaps to full", nextBrightnessPreset(1), 100);
check("above range snaps down", nextBrightnessPreset(150), 100);
check("NaN does not crash", typeof nextBrightnessPreset(NaN), "number");
check("NaN cycles to a preset", READING_BRIGHTNESS.includes(nextBrightnessPreset(NaN)), true);
// Full cycle returns to the start from any preset — no preset can trap the
// reader outside the cycle.
check(
  "full cycle returns home",
  READING_BRIGHTNESS.every((p) => {
    let v = p;
    for (let i = 0; i < READING_BRIGHTNESS.length; i++) v = nextBrightnessPreset(v);
    return v === p;
  }),
  true
);

// ── The UI's option lists must cover every value the sanitizer accepts ─────
// A value the sanitizer allows but no control can reach is a value that can
// only ever come from a hand-edited record — i.e. a dead end.
check("every fit has a control", COMIC_PAGE_FITS_FOR_TEST.every((f) => COMIC_PAGE_FITS.some((c) => c.value === f)), true);
check("every continuous mode has a control", CONTINUOUS_MODES_FOR_TEST.every((m) => CONTINUOUS_MODES.some((c) => c.value === m)), true);
check("no control offers an unknown value", COMIC_PAGE_FITS.every((c) => COMIC_PAGE_FITS_FOR_TEST.includes(c.value as ComicPageFit)), true);
// Labels are the point of the option list — an enum rendered raw is not a label.
checkTrue("fit labels are non-empty", COMIC_PAGE_FITS.every((c) => c.label.length > 0 && c.desc.length > 0));
checkTrue("continuous labels are non-empty", CONTINUOUS_MODES.every((c) => c.label.length > 0 && c.desc.length > 0));
// "Auto" must be present and must be the first option: it is the default, and
// a reader looking for it should not have to read past two overrides first.
check("auto is listed first", CONTINUOUS_MODES[0]!.value, "source");

// ── The local-only guarantee ───────────────────────────────────────────────
// Settings must never carry a sync/user field, so a future refactor that adds
// one fails loudly here instead of quietly shipping preferences to the cloud.
const serialized = JSON.stringify(DEFAULT_COMIC_PREFS);
check("no uid in comic prefs", serialized.includes("uid"), false);
check("no userId in comic prefs", serialized.includes("userId"), false);
check("no cloud field in comic prefs", serialized.includes("cloud"), false);
check("no sync field in comic prefs", serialized.includes("sync"), false);

console.log(`\ncomicReaderEnhancements: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
