/**
 * Theme plugin runtime tests.
 *
 * The fake StyleTarget is the point: `applyActiveThemePlugin` writes to
 * documentElement AND body, and that two-target behaviour is the whole
 * reason a theme plugin can actually override a built-in `theme-*` class.
 * Asserting on a fake catches the regression where someone "optimises" it
 * down to one target and the theme silently stops applying.
 */

// Minimal localStorage so the store is exercised the way the app uses it.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

/** A fake element that records every custom property written to it. */
function fakeElement() {
  const props = new Map<string, string>();
  return {
    props,
    style: {
      setProperty: (name: string, value: string) => void props.set(name, value),
      removeProperty: (name: string) => void props.delete(name),
    },
  };
}

function fakeDoc() {
  const documentElement = fakeElement();
  const body = fakeElement();
  return { documentElement, body };
}

const { installExtension, getInstalledExtensions, uninstallExtension } = await import("../store");
const {
  applyActiveThemePlugin,
  applyThemeTokens,
  clearThemeTokens,
  getActiveThemePluginId,
  getInstalledThemePlugins,
  isThemeManifest,
  resolveActiveThemePlugin,
  setActiveThemePluginId,
  syncThemePluginMarker,
  validateThemeTokens,
} = await import("../themeRuntime");

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

const TOKENS = {
  bg: "#12100E",
  text: "#F2EDE4",
  textMuted: "#A79C8C",
  border: "#3A342C",
  accent: "#C8853A",
  card: "#1C1916",
};

const THEME = {
  id: "kora-theme-copper",
  name: "Copper Night",
  version: "1",
  category: "theme" as const,
  themeId: "copper-night",
  dark: true,
  tokens: TOKENS,
};

// ── Token validation ─────────────────────────────────────────────────────
{
  const ok = validateThemeTokens(TOKENS);
  check("valid tokens accepted", !!ok.tokens, ok.error);
  check("tokens round-trip", ok.tokens?.bg === "#12100E", ok.tokens?.bg);
}
check("missing tokens rejected", !!validateThemeTokens(undefined).error);
check("non-object rejected", !!validateThemeTokens("red").error);
check(
  "missing required token rejected",
  !!validateThemeTokens({ ...TOKENS, bg: undefined }).error
);
{
  const { error } = validateThemeTokens({ ...TOKENS, textMuted: "not a colour!" });
  check("invalid colour rejected", !!error, error);
}
{
  // A token is a colour, never a place to inject other CSS.
  const { error } = validateThemeTokens({ ...TOKENS, bg: "#fff; background: url(evil)" });
  check("css injection rejected", !!error, error);
}
{
  const { error } = validateThemeTokens({
    ...TOKENS,
    card: "red; } body { display: none",
  });
  check("brace injection rejected", !!error, error);
}
{
  const ok = validateThemeTokens({ ...TOKENS, toastBg: "rgba(0,0,0,0.8)" });
  check("toastBg optional but valid when present", !!ok.tokens?.toastBg, ok.error);
}
{
  const ok = validateThemeTokens(TOKENS);
  check("toastBg omitted stays undefined", ok.tokens?.toastBg === undefined, ok.tokens?.toastBg);
}
{
  // Extra fields must not survive: only known keys reach the CSS sink.
  const ok = validateThemeTokens({ ...TOKENS, evil: "expression(alert(1))" });
  check("unknown token keys dropped", !("evil" in (ok.tokens || {})), Object.keys(ok.tokens || {}));
}

// ── Install validation ───────────────────────────────────────────────────
check("valid theme installs", installExtension(THEME) === true);
check("duplicate rejected", installExtension(THEME) === false);
check("theme listed as installed", getInstalledExtensions().length === 1);
check("manifest recognised as theme", isThemeManifest(THEME) === true);
check("source manifest is not a theme", isThemeManifest({ id: "s", name: "s", version: "1", category: "source" }) === false);
check(
  "installExtension still refuses sources",
  installExtension({ id: "kora-x", name: "X", version: "1", category: "source", baseUrl: "https://x", endpoints: { a: {} } } as any) === false
);
check(
  "theme with no themeId rejected",
  installExtension({ id: "t2", name: "T", version: "1", category: "theme", tokens: TOKENS } as any) === false
);
check(
  "theme with bad tokens rejected",
  installExtension({ id: "t3", name: "T", version: "1", category: "theme", themeId: "x", tokens: { bg: "nope" } } as any) === false
);
check(
  "integration with no target rejected",
  installExtension({ id: "i1", name: "I", version: "1", category: "integration" } as any) === false
);
check(
  "integration with target accepted",
  installExtension({ id: "i1", name: "I", version: "1", category: "integration", target: "calibre" } as any) === true
);

// ── Listing ──────────────────────────────────────────────────────────────
{
  const themes = getInstalledThemePlugins();
  check("only the theme is listed", themes.length === 1, themes.length);
  check("theme id preserved", themes[0]?.themeId === "copper-night", themes[0]?.themeId);
  check("dark flag preserved", themes[0]?.dark === true, themes[0]?.dark);
  check("integration not listed as a theme", !themes.some((t) => t.id === "i1"));
}
{
  // A theme installed with a broken token set must not appear.
  installExtension({ id: "t4", name: "Broken", version: "1", category: "theme", themeId: "broken", tokens: { bg: "!!" } } as any);
  check("broken theme silently dropped from list", !getInstalledThemePlugins().some((t) => t.themeId === "broken"));
}

// ── Active-theme resolution ──────────────────────────────────────────────
check("no active theme by default", getActiveThemePluginId() === null);
check("resolve returns null when none active", resolveActiveThemePlugin() === null);
{
  setActiveThemePluginId("copper-night");
  check("active id stored", getActiveThemePluginId() === "copper-night", getActiveThemePluginId());
  check("resolves to the installed theme", resolveActiveThemePlugin()?.themeId === "copper-night");
}
{
  setActiveThemePluginId("does-not-exist");
  check("unknown active theme -> null", resolveActiveThemePlugin() === null);
}
{
  setActiveThemePluginId("copper-night");
  uninstallExtension(THEME.id);
  check("uninstalled active theme -> null", resolveActiveThemePlugin() === null);
  installExtension(THEME); // restore for the apply tests
}

// ── Applying tokens to a document ────────────────────────────────────────
{
  setActiveThemePluginId("copper-night");
  const doc = fakeDoc();
  const res = applyActiveThemePlugin(doc as any);
  check("apply reports the theme", res.applied === "copper-night", res.applied);
  check("no error", !res.error, res.error);

  const html = doc.documentElement.props;
  const body = doc.body.props;
  check("bg var on html", html.get("--theme-bg") === "#12100E", html.get("--theme-bg"));
  check("bg var on body", body.get("--theme-bg") === "#12100E", body.get("--theme-bg"));
  check("accent var written", html.get("--theme-accent") === "#C8853A", html.get("--theme-accent"));
  check("card var written", html.get("--theme-card") === "#1C1916", html.get("--theme-card"));
  check("textMuted var written", html.get("--theme-text-muted") === "#A79C8C", html.get("--theme-text-muted"));
  check("border var written", html.get("--theme-border") === "#3A342C", html.get("--theme-border"));
  // The Tailwind kindle-* aliases read the --color-* vars, so both must move.
  check("kindle alias bg written", html.get("--color-kindle-bg") === "#12100E", html.get("--color-kindle-bg"));
  check("kindle alias card written", body.get("--color-kindle-card") === "#1C1916", body.get("--color-kindle-card"));
  // toastBg was omitted, so nothing should be written for it.
  check("omitted toastBg not written", !html.has("--toast-bg"), html.get("--toast-bg"));
}

// ── Clearing returns the app to a built-in theme ─────────────────────────
{
  const doc = fakeDoc();
  doc.documentElement.props.set("--theme-bg", "#12100E");
  doc.body.props.set("--color-kindle-bg", "#12100E");
  setActiveThemePluginId(null);
  const res = applyActiveThemePlugin(doc as any);
  check("clear reports null", res.applied === null, res.applied);
  check("html vars removed", !doc.documentElement.props.has("--theme-bg"), [...doc.documentElement.props.keys()]);
  check("body alias vars removed", !doc.body.props.has("--color-kindle-bg"), [...doc.body.props.keys()]);
}

// ── applyThemeTokens / clearThemeTokens on bare targets ──────────────────
{
  const a = fakeElement();
  const b = fakeElement();
  applyThemeTokens(TOKENS, [a, b]);
  check("writes to every target", a.props.get("--theme-text") === "#F2EDE4" && b.props.get("--theme-text") === "#F2EDE4");
  clearThemeTokens([a, b]);
  check("clears every target", a.props.size === 0 && b.props.size === 0, [a.props.size, b.props.size]);
}

// ── Marker attribute ─────────────────────────────────────────────────────
{
  const doc = fakeDoc();
  const el: any = doc.documentElement;
  el.setAttribute = (k: string, v: string) => void el.props.set(`@${k}`, v);
  el.removeAttribute = (k: string) => void el.props.delete(`@${k}`);
  syncThemePluginMarker("copper-night", doc as any);
  check("marker set", el.props.get("@data-kora-theme-plugin") === "copper-night", [...el.props.keys()]);
  syncThemePluginMarker(null, doc as any);
  check("marker cleared", !el.props.has("@data-kora-theme-plugin"));
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
