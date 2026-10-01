/**
 * Reader-settings tests.
 *
 * The load-bearing claim: settings are LOCAL ONLY and every field is
 * independently validated. One corrupt value must not reset the whole
 * record, and no value may escape its range — a brightness of 0 or an
 * auto-hide of 10 hours is a reader the user cannot get out of.
 */
import {
  sanitizeSettings,
  loadSettings,
  saveSettings,
  updateSettings,
  effectiveDirection,
  DEFAULT_SETTINGS,
  FIT_MODES_FOR_TEST,
  SCHEMA_VERSION_FOR_TEST,
  type ReaderSettings,
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
const d = sanitizeSettings({});
check("empty object yields defaults", d.fitMode, DEFAULT_SETTINGS.fitMode);
check("defaults keepAwake", d.keepAwake, true);
check("defaults sleep timer off", d.sleepTimerMinutes, 0);

// ── Hostile input ──────────────────────────────────────────────────────────
check("null input", sanitizeSettings(null).fitMode, DEFAULT_SETTINGS.fitMode);
check("undefined input", sanitizeSettings(undefined).brightness, DEFAULT_SETTINGS.brightness);
check("string input", sanitizeSettings("nope").keepAwake, DEFAULT_SETTINGS.keepAwake);
check("array input", sanitizeSettings([]).autoHideSeconds, DEFAULT_SETTINGS.autoHideSeconds);
check("number input", sanitizeSettings(42).doublePage, false);

// ── Range clamping ─────────────────────────────────────────────────────────
check("brightness clamps high", sanitizeSettings({ brightness: 5 }).brightness, 1);
check("brightness clamps low", sanitizeSettings({ brightness: 0 }).brightness, 0.2);
check("brightness clamps negative", sanitizeSettings({ brightness: -3 }).brightness, 0.2);
check("autoHide clamps high", sanitizeSettings({ autoHideSeconds: 99999 }).autoHideSeconds, 3600);
check("autoHide clamps negative", sanitizeSettings({ autoHideSeconds: -5 }).autoHideSeconds, 0);
check("sleepTimer clamps high", sanitizeSettings({ sleepTimerMinutes: 5000 }).sleepTimerMinutes, 600);
check("preloadAhead clamps high", sanitizeSettings({ preloadAhead: 100 }).preloadAhead, 8);
check("preloadAhead clamps low", sanitizeSettings({ preloadAhead: -3 }).preloadAhead, 0);
check("preloadAhead rounds", sanitizeSettings({ preloadAhead: 2.6 }).preloadAhead, 3);
check("NaN brightness rejected", sanitizeSettings({ brightness: NaN }).brightness, DEFAULT_SETTINGS.brightness);
check("Infinity brightness rejected", sanitizeSettings({ brightness: Infinity }).brightness, DEFAULT_SETTINGS.brightness);

// ── Enum validation ────────────────────────────────────────────────────────
check("bogus fitMode rejected", sanitizeSettings({ fitMode: "stretch" }).fitMode, DEFAULT_SETTINGS.fitMode);
check("bogus brightnessMode rejected", sanitizeSettings({ brightnessMode: "auto" }).brightnessMode, "system");
check("bogus direction rejected", sanitizeSettings({ directionOverride: "sideways" }).directionOverride, undefined);
for (const mode of FIT_MODES_FOR_TEST) {
  check(`fit mode accepted: ${mode}`, sanitizeSettings({ fitMode: mode }).fitMode, mode);
}

// ── One corrupt field must not reset the others ────────────────────────────
const partial = sanitizeSettings({ brightness: 99, fitMode: "width", preloadAhead: "garbage" });
check("valid field kept alongside corrupt one (fitMode)", partial.fitMode, "width");
check("out-of-range field clamped (brightness)", partial.brightness, 1);
check("corrupt field falls back alone (preloadAhead)", partial.preloadAhead, DEFAULT_SETTINGS.preloadAhead);

// ── Round-trip through storage ─────────────────────────────────────────────
saveSettings({ ...DEFAULT_SETTINGS, fitMode: "height", brightness: 0.5, keepAwake: false });
const loaded = loadSettings();
check("round-trip fitMode", loaded.fitMode, "height");
check("round-trip brightness", loaded.brightness, 0.5);
check("round-trip keepAwake", loaded.keepAwake, false);

const merged = updateSettings({ sleepTimerMinutes: 30 });
check("update merges", merged.sleepTimerMinutes, 30);
check("update preserves others", merged.fitMode, "height");
check("update persisted", loadSettings().sleepTimerMinutes, 30);

// ── Corrupt storage falls back to defaults ─────────────────────────────────
mem.setItem("kora_reader_settings", "{not json");
check("corrupt JSON -> defaults", loadSettings().fitMode, DEFAULT_SETTINGS.fitMode);
mem.setItem("kora_reader_settings", JSON.stringify({ version: 999, settings: { fitMode: "width" } }));
check("unknown version -> defaults", loadSettings().fitMode, DEFAULT_SETTINGS.fitMode);
mem.setItem("kora_reader_settings", JSON.stringify({ version: SCHEMA_VERSION_FOR_TEST, settings: { fitMode: "nope", brightness: 0.5 } }));
check("bad enum in storage falls back", loadSettings().fitMode, DEFAULT_SETTINGS.fitMode);
check("good field in bad storage survives", loadSettings().brightness, 0.5);
mem.removeItem("kora_reader_settings");
check("absent storage -> defaults", loadSettings().brightness, DEFAULT_SETTINGS.brightness);

// ── Direction: source default, user override wins ──────────────────────────
const noOverride: ReaderSettings = { ...DEFAULT_SETTINGS };
check("falls back to source rtl", effectiveDirection(noOverride, "rtl"), "rtl");
check("falls back to source ltr", effectiveDirection(noOverride, "ltr"), "ltr");
check("falls back to rtl with no source", effectiveDirection(noOverride), "rtl");
check("override beats source", effectiveDirection({ ...noOverride, directionOverride: "ltr" }, "rtl"), "ltr");
check("override beats source ltr", effectiveDirection({ ...noOverride, directionOverride: "rtl" }, "ltr"), "rtl");

// ── The local-only guarantee ───────────────────────────────────────────────
// Settings must never carry a sync/user field, so a future refactor that adds
// one fails loudly here instead of quietly shipping preferences to the cloud.
const serialized = JSON.stringify(DEFAULT_SETTINGS);
check("no uid in settings", serialized.includes("uid"), false);
check("no userId in settings", serialized.includes("userId"), false);
check("no cloud field in settings", serialized.includes("cloud"), false);

console.log(`\nreaderSettings: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
