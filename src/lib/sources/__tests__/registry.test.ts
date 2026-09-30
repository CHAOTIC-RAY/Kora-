/**
 * Registry parsing for the non-source categories.
 *
 * The index fixture is the real shape produced by Kora-Sources'
 * `scripts/build-index.mjs`, including one entry per category.
 */

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

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

const INDEX = {
  name: "Kora Sources",
  badgeLabel: "KORA",
  extensionList: {
    extensions: [
      {
        name: "S2Read",
        packageName: "kora.source.s2read",
        resources: {
          apkUrl: "https://kora.test/s2read.json",
          iconUrl: "https://kora.test/s2read.png",
        },
        versionCode: "1000",
        versionName: "1.0.0",
        sources: [{ id: "kora-manga-s2read", name: "S2Read", language: "en", piracy: true, nsfw: false, homeUrl: "https://s2read.com" }],
      },
      {
        name: "Gutenberg",
        packageName: "kora.source.project-gutenberg",
        resources: { apkUrl: "https://kora.test/gutenberg.json", iconUrl: "" },
        versionName: "1.0.0",
        // No `category` field — the pre-category index shape.
        sources: [{ id: "kora-legal-gutenberg", name: "Project Gutenberg", language: "en", piracy: false, nsfw: false }],
      },
      {
        name: "Copper Night",
        packageName: "kora.theme.copper-night",
        resources: { apkUrl: "https://kora.test/copper-night.json", iconUrl: "https://kora.test/copper.png" },
        versionName: "1.0.0",
        sources: [{
          id: "kora-theme-copper-night",
          name: "Copper Night",
          language: "en",
          piracy: false,
          nsfw: false,
          category: "theme",
          themeId: "copper-night",
          dark: true,
          description: "A warm dark theme.",
          author: "Kora",
          tokens: { bg: "#12100E", text: "#F2EDE4", textMuted: "#A79C8C", border: "#3A342C", accent: "#C8853A", card: "#1C1916" },
        }],
      },
      {
        name: "Calibre",
        packageName: "kora.integration.calibre",
        resources: { apkUrl: "https://kora.test/calibre.json", iconUrl: "https://kora.test/calibre.png" },
        versionName: "1.0.0",
        sources: [{
          id: "kora-integration-calibre",
          name: "Calibre",
          language: "en",
          piracy: false,
          nsfw: false,
          category: "integration",
          target: "calibre",
          availability: "ready",
          requires: ["network"],
        }],
      },
      {
        name: "Send to Kindle",
        packageName: "kora.integration.send-to-kindle",
        resources: { apkUrl: "https://kora.test/kindle.json", iconUrl: "https://kora.test/kindle.png" },
        versionName: "1.0.0",
        sources: [{
          id: "kora-integration-kindle",
          name: "Send to Kindle",
          language: "en",
          piracy: false,
          nsfw: false,
          category: "integration",
          target: "kindle",
          availability: "unavailable",
          availabilityNote: "Requires an Amazon-approved developer account.",
        }],
      },
    ],
  },
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  const path = String(url);
  if (path === "https://kora.test/index.json") {
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(INDEX)) } as any;
  }
  if (path === "https://kora.test/copper-night.json") {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "kora-theme-copper-night",
        name: "Copper Night",
        version: 1,
        category: "theme",
        themeId: "copper-night",
        dark: true,
        tokens: { bg: "#12100E", text: "#F2EDE4", textMuted: "#A79C8C", border: "#3A342C", accent: "#C8853A", card: "#1C1916" },
      }),
    } as any;
  }
  if (path === "https://kora.test/calibre.json") {
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "kora-integration-calibre", name: "Calibre", version: 1, category: "integration", target: "calibre" }),
    } as any;
  }
  if (path === "https://kora.test/broken-theme.json") {
    return { ok: true, status: 200, json: async () => ({ id: "t", name: "T", version: 1, category: "theme", themeId: "t", tokens: { bg: "!!" } }) } as any;
  }
  if (path === "https://kora.test/no-target.json") {
    return { ok: true, status: 200, json: async () => ({ id: "i", name: "I", version: 1, category: "integration" }) } as any;
  }
  if (path === "https://kora.test/s2read.json") {
    // A real source definition — it must be rejected on category grounds,
    // not because the fixture was missing.
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "kora-manga-s2read", name: "S2Read", version: 1, category: "source", baseUrl: "https://s2read.com", endpoints: { a: { search: { url: "/x" } } } }),
    } as any;
  }
  return { ok: false, status: 404 } as any;
}) as any;

const { fetchRegistry, fetchExtensionDefinition, installExtension, isPluginCategory } = await import("../store");

const entries = await fetchRegistry("https://kora.test/index.json");
check("five entries", entries.length === 5, entries.length);

const byId = new Map(entries.map((e) => [e.plugin.id, e]));
const src = byId.get("kora-manga-s2read")!;
const theme = byId.get("kora-theme-copper-night")!;
const calibre = byId.get("kora-integration-calibre")!;
const kindle = byId.get("kora-integration-kindle")!;
const gutenberg = byId.get("kora-legal-gutenberg")!;

// ── Categories ───────────────────────────────────────────────────────────
check("piracy source is category source", src.category === "source", src.category);
check("theme categorised", theme.category === "theme", theme.category);
check("calibre categorised", calibre.category === "integration", calibre.category);
check("missing category defaults to source", gutenberg.category === "source", gutenberg.category);
check("isPluginCategory accepts known", isPluginCategory("theme") && isPluginCategory("integration"));
check("isPluginCategory rejects junk", isPluginCategory("nope") === false);

// ── Gating applies to SOURCES ONLY ───────────────────────────────────────
check("piracy source is gated", src.gated === true, src.gated);
check("clean source not gated", gutenberg.gated === false, gutenberg.gated);
check("theme is NOT gated", theme.gated === false, theme.gated);
check("calibre integration is NOT gated", calibre.gated === false, calibre.gated);
check("kindle integration is NOT gated", kindle.gated === false, kindle.gated);

// ── Manifest payload for non-sources ─────────────────────────────────────
check("theme manifest present", !!theme.manifest, theme.manifest);
check("theme manifest themeId", theme.manifest?.themeId === "copper-night", theme.manifest?.themeId);
check("theme manifest dark", theme.manifest?.dark === true, theme.manifest?.dark);
check("theme manifest tokens", theme.manifest?.tokens?.bg === "#12100E", theme.manifest?.tokens?.bg);
check("theme manifest description", theme.manifest?.description === "A warm dark theme.", theme.manifest?.description);
check("theme manifest icon", theme.manifest?.icon === "https://kora.test/copper.png", theme.manifest?.icon);
check("calibre manifest target", calibre.manifest?.target === "calibre", calibre.manifest?.target);
check("calibre manifest requires", calibre.manifest?.requires?.join() === "network", calibre.manifest?.requires);
check("calibre availability ready", calibre.manifest?.availability === "ready", calibre.manifest?.availability);
check("kindle availability unavailable", kindle.manifest?.availability === "unavailable", kindle.manifest?.availability);
check("kindle note carried", !!kindle.manifest?.availabilityNote, kindle.manifest?.availabilityNote);
check("source entry has no manifest", src.manifest === undefined, src.manifest);
check("theme plugin baseUrl empty", theme.plugin.baseUrl === "", theme.plugin.baseUrl);

// ── installUrl ───────────────────────────────────────────────────────────
check("theme installUrl from apkUrl", theme.installUrl === "https://kora.test/copper-night.json", theme.installUrl);
check("calibre installUrl", calibre.installUrl === "https://kora.test/calibre.json", calibre.installUrl);

// ── fetchExtensionDefinition ─────────────────────────────────────────────
{
  const t = await fetchExtensionDefinition("https://kora.test/copper-night.json");
  check("theme definition fetched", t?.themeId === "copper-night", t?.themeId);
  check("theme version defaulted to string", typeof t?.version === "string", typeof t?.version);
  check("theme installs", t ? installExtension(t) : false);
}
{
  const c = await fetchExtensionDefinition("https://kora.test/calibre.json");
  check("integration definition fetched", c?.target === "calibre", c?.target);
  check("integration installs", c ? installExtension(c) : false);
}
{
  let msg = "";
  try {
    await fetchExtensionDefinition("https://kora.test/broken-theme.json");
  } catch (e: any) {
    msg = e.message;
  }
  check("theme with bad tokens rejected", /not a valid colour/i.test(msg), msg);
}
{
  let msg = "";
  try {
    await fetchExtensionDefinition("https://kora.test/no-target.json");
  } catch (e: any) {
    msg = e.message;
  }
  check("integration with no target rejected", /missing target/i.test(msg), msg);
}
{
  let msg = "";
  try {
    await fetchExtensionDefinition("https://kora.test/s2read.json");
  } catch (e: any) {
    msg = e.message;
  }
  check("source rejected by the non-source installer", /source installer/i.test(msg), msg);
}
check("empty url -> null", (await fetchExtensionDefinition("")) === null);

// Installed state is read back from the extension store for non-sources.
{
  const again = await fetchRegistry("https://kora.test/index.json");
  const t2 = again.find((e) => e.plugin.id === "kora-theme-copper-night")!;
  check("installed theme reads back as installed", t2.installed === true, t2.installed);
  const s2 = again.find((e) => e.plugin.id === "kora-manga-s2read")!;
  check("uninstalled source reads as not installed", s2.installed === false, s2.installed);
}

globalThis.fetch = realFetch;

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
