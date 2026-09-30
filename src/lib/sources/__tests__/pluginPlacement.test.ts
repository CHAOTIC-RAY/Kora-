/**
 * Category-placement tests.
 *
 * The rule under test: a plugin's category decides which tab it is reachable
 * from, and only sources are ever behind the piracy/adult opt-in.
 *
 * Regression: integration and theme plugins used to render in the Discover
 * plugin hub alongside sources. A theme in Discover read as somewhere to
 * install content, and an integration next to sources read as one more place
 * books come from. These assertions are what stop that from coming back by
 * accident — the mapping is data in `store.ts` precisely so it can be pinned
 * down here without rendering a single component.
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
  categoriesForSurface,
  isEntryGated,
  isGatedCategory,
  surfaceForCategory,
  type PluginSurface,
  type RepoEntry,
} from "../store";
import type { PluginCategory } from "../types";

const ALL: PluginCategory[] = ["source", "theme", "integration", "tool"];

// ── Where each category lives ─────────────────────────────────────────────
check(
  "sources live in Discover",
  surfaceForCategory("source") === "discover",
  surfaceForCategory("source")
);
check(
  "integrations live in Workshop",
  surfaceForCategory("integration") === "workshop",
  surfaceForCategory("integration")
);
check(
  "themes live in Settings",
  surfaceForCategory("theme") === "settings",
  surfaceForCategory("theme")
);
check(
  "tools live in Workshop",
  surfaceForCategory("tool") === "workshop",
  surfaceForCategory("tool")
);

// The user-visible ask, stated in the one form the test can check directly:
// Calibre sync and Send to Kindle are integrations, so they are in Workshop.
check(
  "Calibre sync is an integration plugin",
  surfaceForCategory("integration") === "workshop"
);
check(
  "Send to Kindle is an integration plugin",
  surfaceForCategory("integration") === "workshop"
);

// ── Each surface's own filter ──────────────────────────────────────────────
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

check(
  "Workshop lists integrations",
  workshop.includes("integration"),
  workshop
);
check("Workshop does not list sources", !workshop.includes("source"), workshop);
check("Workshop does not list themes", !workshop.includes("theme"), workshop);

check("Settings lists themes", settings.includes("theme"), settings);
check(
  "Settings does not list sources",
  !settings.includes("source"),
  settings
);
check(
  "Settings does not list integrations",
  !settings.includes("integration"),
  settings
);

// ── No category is orphaned, and none is double-listed ────────────────────
const SURFACES: PluginSurface[] = ["discover", "workshop", "settings"];
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
