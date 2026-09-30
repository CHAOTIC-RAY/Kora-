/**
 * Proves the hub's category filter admits theme/integration/tool entries.
 *
 * The live registry lists only sources, so the hub's Themes / Integrations /
 * Tools groups are empty in a real browser. This runs `fetchRegistry` against a
 * fixture over every category and then applies the same narrowing the browser
 * applies (`categories` prop -> `wanted` set), to show the groups would render
 * when the registry does list them.
 */

import { fetchRegistry, hubCategories, categoriesForSurface } from "../store";
import type { PluginCategory } from "../types";

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

// Stub fetch so the fixture is served without a network.
const FIXTURE = {
  name: "Test Reg",
  extensionList: {
    extensions: [
      {
        name: "Test Theme Ext",
        packageName: "t.theme",
        resources: { apkUrl: "http://x/theme.json", iconUrl: "" },
        extensionLib: "1.6",
        versionCode: "106001",
        versionName: "1.0",
        sources: [
          {
            id: "tt-1",
            name: "Sandbox Theme",
            language: "en",
            category: "theme",
            themeId: "sandbox-theme",
            dark: true,
            description: "A test theme.",
            tokens: {
              bg: "#101010",
              text: "#eeeeee",
              textMuted: "#999999",
              border: "#333333",
              accent: "#ff7a45",
              card: "#1a1a1a",
            },
          },
        ],
      },
      {
        name: "Test Calibre Ext",
        packageName: "t.calibre",
        resources: { apkUrl: "http://x/calibre.json", iconUrl: "" },
        extensionLib: "1.6",
        versionCode: "106001",
        versionName: "1.0",
        sources: [
          {
            id: "tt-2",
            name: "Sandbox Calibre",
            language: "en",
            category: "integration",
            target: "calibre",
            description: "A test Calibre integration.",
            availability: "ready",
            author: "Sandbox",
          },
        ],
      },
      {
        name: "Test Tool Ext",
        packageName: "t.tool",
        resources: { apkUrl: "http://x/tool.json", iconUrl: "" },
        extensionLib: "1.6",
        versionCode: "106001",
        versionName: "1.0",
        sources: [
          {
            id: "tt-3",
            name: "Sandbox Tool",
            language: "en",
            category: "tool",
            description: "A test tool.",
          },
        ],
      },
    ],
  },
};

(globalThis as unknown as { fetch: unknown }).fetch = async () =>
  new Response(JSON.stringify(FIXTURE), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const entries = await fetchRegistry("http://test.invalid/index.json");

// This is exactly the narrowing PluginBrowser does with its `categories` prop.
const wanted = new Set<PluginCategory>(hubCategories());
const shown = entries.filter((e) => wanted.has(e.category));

const byCat = (c: PluginCategory) => shown.filter((e) => e.category === c).length;

check("the fixture produced 3 entries", entries.length === 3, entries.length);
check("the hub admits a theme entry", byCat("theme") === 1, byCat("theme"));
check("the hub admits an integration entry", byCat("integration") === 1, byCat("integration"));
check("the hub admits a tool entry", byCat("tool") === 1, byCat("tool"));

// The theme manifest must survive with the fields ThemeCard renders from, or
// the group would render an empty card.
const theme = shown.find((e) => e.category === "theme");
check("the theme keeps its themeId", theme?.manifest?.themeId === "sandbox-theme");
check("the theme keeps its tokens", !!theme?.manifest?.tokens?.accent);
check("the theme is not gated", theme?.gated === false, theme?.gated);

// The integration manifest must keep `target`, or IntegrationCard returns null
// and the group renders nothing.
const integration = shown.find((e) => e.category === "integration");
check("the integration keeps its target", integration?.manifest?.target === "calibre");
check("the integration is not gated", integration?.gated === false, integration?.gated);

// And the complementary invariant: the Workshop tile filter, which is
// categoriesForSurface("workshop"), is exactly the non-source set the bento
// grid renders.
const workshop = categoriesForSurface("workshop");
check(
  "the Workshop tile filter covers every category the hub admits as non-source",
  ["theme", "integration", "tool"].every((c) => workshop.includes(c as PluginCategory)),
  workshop
);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
