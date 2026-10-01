/**
 * `kora plugin validate` — the manifest validator.
 *
 * The load-bearing fixture here is `real-source-s2read.json`: an UNMODIFIED
 * source definition fetched over HTTPS from Kora's own live registry
 * (https://raw.githubusercontent.com/CHAOTIC-RAY/Kora-Plugins/main/sources/manga/s2read.json).
 *
 * It is in this file because the validator was wrong about real manifests
 * until that file was read. It declares `theme: "madara"` and has NO
 * `endpoints` key at all — the shared site engine supplies them — so a
 * validator that demanded `endpoints` unconditionally rejected a working,
 * shipped source. It is also flat, with no `category` and no nested `source`.
 * Both assumptions are now encoded below.
 *
 * The theme checks deliberately call `validateThemeTokens`, the same function
 * the app uses at install time. A test that re-implemented colour validation
 * here would pass while the app rejected the theme, which is the failure mode
 * this file exists to prevent.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { validateManifest } from "../formats/pluginManifest";
import { validateThemeTokens } from "../sources/themeTokens";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`not ok - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}
const errorsOf = (r: ReturnType<typeof validateManifest>) =>
  r.findings.filter((f) => f.severity === "error").map((f) => `${f.path}: ${f.message}`);
const pathsOf = (r: ReturnType<typeof validateManifest>) => r.findings.map((f) => f.path);

/* ═════════════════════════════════════════ 1. a REAL shipped manifest ═════ */

{
  const real = JSON.parse(fs.readFileSync(path.join(FIX, "real-source-s2read.json"), "utf-8"));

  // Guard: if the fixture ever changes shape, the assertions below would start
  // testing nothing. Fail loudly instead.
  check("fixture is the madara-engine source it claims to be", real.theme === "madara");
  check("fixture really has no endpoints key", real.endpoints === undefined);

  const r = validateManifest(real);
  check("a real, shipped source manifest validates", r.ok, errorsOf(r).join(" | "));
  eq_summary(r, "real-source-s2read.json", "kora-manga-s2read", "S2Read", "source");

  // The specific lesson: no `endpoints` demand.
  check(
    "a madara source is not asked for endpoints",
    !pathsOf(r).includes("source.endpoints"),
    pathsOf(r).join(", ")
  );
}

{
  // The other real shape: an explicit-endpoints source with no engine.
  const explicit = {
    id: "kora-book-example",
    name: "Example Book Site",
    version: 1,
    lang: "en",
    baseUrl: "https://example.invalid",
    kind: "book",
    endpoints: {
      list: { selector: "div.book" },
      detail: { selector: "h1.title" },
      pages: "div.page img",
    },
  };
  const r = validateManifest(explicit);
  check("an explicit-endpoints source validates", r.ok, errorsOf(r).join(" | "));
}

/* ═══════════════════════════════════════ 2. bare source vs plugin wrapper ══ */

{
  // The nested PluginManifest shape.
  const wrapped = {
    id: "theme-copper",
    name: "Copper Night",
    version: "1.0.0",
    category: "theme",
    dark: true,
    tokens: {
      bg: "#12100e",
      text: "#e8e2d9",
      textMuted: "#a89f94",
      border: "#3a332c",
      accent: "#c98a4b",
      card: "#1c1917",
    },
  };
  const r = validateManifest(wrapped);
  check("a valid theme manifest passes", r.ok, errorsOf(r).join(" | "));

  // Integration needs a target.
  const badIntegration = { id: "i", name: "I", version: "1", category: "integration" };
  check("an integration without a target fails", !validateManifest(badIntegration).ok);
  check(
    "the integration target is named in the error",
    errorsOf(validateManifest(badIntegration)).some((e) => e.startsWith("target")),
    errorsOf(validateManifest(badIntegration)).join(" | ")
  );

  const goodIntegration = { ...badIntegration, target: "calibre" };
  check("an integration with a valid target passes", validateManifest(goodIntegration).ok);

  const badTarget = { ...badIntegration, target: "dropbox" };
  check(
    "an unknown integration target is rejected",
    !validateManifest(badTarget).ok,
    errorsOf(validateManifest(badTarget)).join(" | ")
  );
}

/* ═══════════════════════════════════ 3. themes reuse the app's validator ═══ */

{
  // A theme missing a required token must fail for the same reason the app
  // would fail, not because this file has its own idea of the rules.
  const missing = {
    id: "t",
    name: "T",
    version: "1",
    category: "theme",
    dark: false,
    tokens: { bg: "#000", text: "#fff" },
  };
  const viaManifest = validateManifest(missing);
  check("a theme missing tokens fails", !viaManifest.ok);
  check(
    "the failure matches validateThemeTokens' own message",
    errorsOf(viaManifest).some((e) => e.includes("not a valid colour")),
    errorsOf(viaManifest).join(" | ")
  );

  // A theme with no `dark` flag is a real bug: Kora drives Tailwind's dark:
  // variant and the system status bar from it.
  const noDark = {
    id: "t",
    name: "T",
    version: "1",
    category: "theme",
    tokens: {
      bg: "#000", text: "#fff", textMuted: "#888", border: "#333", accent: "#0af", card: "#111",
    },
  };
  check("a theme without `dark` fails", !validateManifest(noDark).ok);
  check(
    "the `dark` requirement explains itself",
    errorsOf(validateManifest(noDark)).some((e) => /dark: variant/.test(e)),
    errorsOf(validateManifest(noDark)).join(" | ")
  );

  // Token sanitisation must match the app exactly. An injection attempt is
  // rejected by validateThemeTokens, so it must be rejected here too.
  const injection = {
    id: "t",
    name: "T",
    version: "1",
    category: "theme",
    dark: false,
    tokens: {
      bg: "#fff; background: url(javascript:alert(1))",
      text: "#fff", textMuted: "#888", border: "#333", accent: "#0af", card: "#111",
    },
  };
  check("a CSS-injection token is rejected", !validateManifest(injection).ok);

  // And the underlying function agrees, which is the point.
  const direct = validateThemeTokens((injection as { tokens: unknown }).tokens);
  check("validateThemeTokens also rejects it", !direct.tokens, direct.error);
}

/* ══════════════════════════════════════════ 4. structural errors ══════════ */

{
  check("a non-object is rejected", !validateManifest(null).ok);
  check("an array is rejected", !validateManifest([]).ok);
  check("a string is rejected", !validateManifest("{}").ok);

  const bad = validateManifest({ category: "source", source: {} });
  check("an empty source fails", !bad.ok);
  const msgs = errorsOf(bad).join(" | ");
  check("missing id is named", /source\.id/.test(msgs), msgs);
  check("missing baseUrl is named", /baseUrl/.test(msgs), msgs);
  check(
    "a source with neither engine nor endpoints says both options",
    /theme/.test(msgs) && /endpoints/.test(msgs),
    msgs
  );

  const noVersion = validateManifest({ id: "x", name: "X", source: { version: "one" } });
  check("a non-numeric source version fails", !noVersion.ok);

  const badUrl = validateManifest({
    id: "x", name: "X",
    source: { version: 1, baseUrl: "javascript:alert(1)", theme: "madara" },
  });
  check("a javascript: baseUrl is rejected", !badUrl.ok);

  const badEngine = validateManifest({
    id: "x", name: "X",
    source: { version: 1, baseUrl: "https://a.invalid", theme: "wordpress" },
  });
  check("an unknown engine is rejected", !badEngine.ok);
}

/* ══════════════════════════════════════════════ 5. warnings vs errors ═════ */

{
  // An unavailable plugin without a note is a WARNING, not an error: it is
  // still installable, and the note is what the UI shows.
  const r = validateManifest({
    id: "x", name: "X", version: "1", category: "tool",
    availability: "unavailable",
  });
  check("an unavailable plugin without a note is still valid", r.ok);
  check(
    "the missing note is a warning",
    r.findings.some((f) => f.severity === "warning" && f.path === "availabilityNote"),
    JSON.stringify(r.findings)
  );

  // An unknown endpoint key is a warning: harmless, just ignored.
  //
  // Note the shape: `baseUrl` present and `category` absent is a BARE SOURCE
  // (what the registry publishes). Adding `category: "source"` would make it a
  // wrapper needing the nested `source` object instead — the two shapes are
  // genuinely different and mixing them up is what made this case fail first.
  const extra = validateManifest({
    id: "x", name: "X",
    baseUrl: "https://a.invalid",
    version: 1,
    endpoints: { list: "a", detail: "b", pages: "c", search: "d" },
  });
  check("an extra endpoint does not invalidate", extra.ok, errorsOf(extra).join(" | "));
  check(
    "an extra endpoint is flagged as a warning",
    extra.findings.some((f) => f.severity === "warning" && f.path.includes("search")),
    JSON.stringify(extra.findings)
  );
}

function eq_summary(
  r: ReturnType<typeof validateManifest>,
  _file: string,
  id: string,
  name: string,
  category: string
): void {
  check("summary carries the id", r.summary?.id === id, JSON.stringify(r.summary));
  check("summary carries the name", r.summary?.name === name, JSON.stringify(r.summary));
  check("summary carries the category", r.summary?.category === category, JSON.stringify(r.summary));
}

console.log(`${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);