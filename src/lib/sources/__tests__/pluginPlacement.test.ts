/**
 * Category-placement tests.
 *
 * The rule under test has two halves, and they are different rules:
 *
 *  1. THE HUB is one surface — Discover. Installing, enabling, disabling and
 *     removing a plugin happens there and nowhere else, and the hub can list
 *     every category so nothing is uninstallable.
 *  2. An INSTALLED non-source plugin surfaces as a tile on its own surface —
 *     Workshop for every non-source category, Discover for sources. A theme is
 *     a non-source plugin, so it is a Workshop tile, not a Settings list.
 *
 * Plus the invariant that outlived both: only sources are ever behind the
 * piracy/adult opt-in.
 *
 * Regression: integration and theme plugins used to render in the Discover
 * plugin hub alongside sources, and later the hub itself was duplicated into
 * Workshop and Settings. A theme in Discover read as somewhere to install
 * content; two hubs meant two answers to "is this installed?". These assertions
 * are what stop any of that coming back — the mapping is data in `store.ts`
 * precisely so it can be pinned down here without rendering a single component.
 */

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

import {
  HUB_SURFACE,
  categoriesForSurface,
  hubCategories,
  isEntryGated,
  isGatedCategory,
  surfaceForCategory,
  type PluginSurface,
  type RepoEntry,
} from "../store";
import type { PluginCategory } from "../types";

const ALL: PluginCategory[] = ["source", "theme", "integration", "tool"];
const SURFACES: PluginSurface[] = ["discover", "workshop", "settings"];

// ── The hub lives in Discover, and only in Discover ───────────────────────
check("the hub surface is Discover", HUB_SURFACE === "discover", HUB_SURFACE);

// The hub is where plugins are managed. If it could not list a category, that
// category could never be installed from anywhere in the app.
const hub = hubCategories();
for (const c of ALL) {
  check(`the hub can list ${c}`, hub.includes(c), hub);
}
check(
  "the hub lists every category",
  ALL.every((c) => hub.includes(c)) && hub.length === ALL.length,
  hub
);

// A hub on any other surface is the bug this file exists to prevent. Discover
// owns the hub; Workshop and Settings render no PluginBrowser at all.
check(
  "only Discover is a hub surface",
  SURFACES.filter((s) => s === HUB_SURFACE).length === 1 &&
    HUB_SURFACE === "discover",
  HUB_SURFACE
);
check("Workshop does not host a hub", HUB_SURFACE !== "workshop", HUB_SURFACE);
check("Settings does not host a hub", HUB_SURFACE !== "settings", HUB_SURFACE);

// ── Where each installed category lives ──────────────────────────────────
check(
  "installed sources surface in Discover",
  surfaceForCategory("source") === "discover",
  surfaceForCategory("source")
);
check(
  "installed integrations surface in Workshop",
  surfaceForCategory("integration") === "workshop",
  surfaceForCategory("integration")
);
// A theme plugin is a non-source plugin. The user asked for installed
// non-source plugins as bento tiles in Workshop, which includes themes.
check(
  "installed themes surface in Workshop",
  surfaceForCategory("theme") === "workshop",
  surfaceForCategory("theme")
);
check(
  "installed tools surface in Workshop",
  surfaceForCategory("tool") === "workshop",
  surfaceForCategory("tool")
);

// The user-visible ask, in the one form the test can check directly: Calibre
// sync and Send to Kindle are integrations, so they are Workshop tiles.
check(
  "Calibre sync is an installed Workshop tile",
  surfaceForCategory("integration") === "workshop"
);
check(
  "Send to Kindle is an installed Workshop tile",
  surfaceForCategory("integration") === "workshop"
);

// ── Each surface's own filter ────────────────────────────────────────────
const discover = categoriesForSurface("discover");
const workshop = categoriesForSurface("workshop");
const settings = categoriesForSurface("settings");

check("Discover lists sources", discover.includes("source"), discover);
check("Discover does not list themes", !discover.includes("theme"), discover);
check(
  "Discover does not list integrations",
  !discover.includes("integration"),
  discover
);

// Workshop owns every non-source category, and nothing else: the tile grid is
// for things you USE, and a source has no panel to open.
check(
  "Workshop lists integrations",
  workshop.includes("integration"),
  workshop
);
check("Workshop lists themes", workshop.includes("theme"), workshop);
check("Workshop lists tools", workshop.includes("tool"), workshop);
check("Workshop does not list sources", !workshop.includes("source"), workshop);

// Settings owns no plugin category at all now. The built-in theme swatches
// stay — choosing the active BUILT-IN theme is a setting — but the theme
// plugin list/hub is gone from here.
check("Settings lists no plugin category", settings.length === 0, settings);

// ── No category is orphaned, and none is double-listed ───────────────────
for (const c of ALL) {
  const places = SURFACES.filter((s) => categoriesForSurface(s).includes(c));
  check(
    `${c} appears in exactly one surface`,
    places.length === 1,
    places.join(",")
  );
}

// The three filters together must partition the category space, otherwise a
// category would exist that no surface can render and its plugins would be
// installed but permanently unreachable.
const union = new Set([...discover, ...workshop, ...settings]);
check(
  "every category is reachable from some surface",
  ALL.every((c) => union.has(c)),
  Array.from(union).join(",")
);
check(
  "no category is listed by two surfaces",
  new Set([...discover, ...workshop, ...settings]).size ===
    discover.length + workshop.length + settings.length
);

// The non-source categories are exactly the Workshop tiles. This is the
// invariant the bento grid in PluginBentoTiles filters on.
const NON_SOURCE: PluginCategory[] = ["theme", "integration", "tool"];
check(
  "Workshop tiles are exactly the non-source categories",
  NON_SOURCE.every((c) => workshop.includes(c)) &&
    !workshop.includes("source") &&
    workshop.length === NON_SOURCE.length,
  workshop
);

// ── Gating applies to sources and to nothing else ──────────────────────────
check("sources are a gated category", isGatedCategory("source") === true);
check("themes are NOT gated", isGatedCategory("theme") === false);
check("integrations are NOT gated", isGatedCategory("integration") === false);
check("tools are NOT gated", isGatedCategory("tool") === false);

// The same theme/integration manifest, carrying piracy + nsfw flags as a
// mislabelled or hostile registry might set them, must still never be gated.
const entry = (over: Partial<RepoEntry>): RepoEntry => ({
  plugin: {
    id: "x",
    name: "X",
    lang: "en",
    version: 1,
    nsfw: false,
    piracy: false,
    baseUrl: "https://x.example",
    endpoints: { json: {} },
  },
  installed: false,
  gated: false,
  installUrl: "https://example.test/x.json",
  category: "source",
  ...over,
});

check(
  "a clean source is not gated",
  isEntryGated(entry({})) === false,
  isEntryGated(entry({}))
);

check(
  "a piracy source is gated",
  isEntryGated(
    entry({ plugin: { ...entry({}).plugin, piracy: true } })
  ) === true
);

check(
  "an nsfw source is gated",
  isEntryGated(
    entry({ plugin: { ...entry({}).plugin, nsfw: true } })
  ) === true
);

check(
  "a theme with piracy:true is still not gated",
  isEntryGated(
    entry({ category: "theme", plugin: { ...entry({}).plugin, piracy: true } })
  ) === false,
  isEntryGated(
    entry({ category: "theme", plugin: { ...entry({}).plugin, piracy: true } })
  )
);

check(
  "an integration with nsfw:true is still not gated",
  isEntryGated(
    entry({ category: "integration", plugin: { ...entry({}).plugin, nsfw: true } })
  ) === false,
  isEntryGated(
    entry({ category: "integration", plugin: { ...entry({}).plugin, nsfw: true } })
  )
);

// A theme is ungated whether it lived in Settings (where it used to) or in the
// Workshop tile grid (where it lives now). Moving a surface must never be a
// way to launder a restricted manifest into view.
check(
  "an installed theme tile is still not gated",
  isEntryGated(
    entry({
      installed: true,
      category: "theme",
      plugin: { ...entry({}).plugin, piracy: true, nsfw: true },
    })
  ) === false,
  isEntryGated(
    entry({
      installed: true,
      category: "theme",
      plugin: { ...entry({}).plugin, piracy: true, nsfw: true },
    })
  )
);

// `isEntryGated` answers one narrow question — "does this manifest declare
// restricted content" — and only for sources. Whether an installed source is
// *shown* is a separate question, answered by the visibility filter in the
// browser, which keeps installed entries visible regardless. Asserting the
// split here keeps the two from being collapsed into one flag later.
check(
  "an installed piracy source is still flagged restricted by the manifest",
  isEntryGated(
    entry({ installed: true, plugin: { ...entry({}).plugin, piracy: true } })
  ) === true
);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
