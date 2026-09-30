/**
 * Theme plugin runtime.
 *
 * A theme plugin is data: a token set plus a `dark` flag. Applying it means
 * writing those tokens as CSS custom properties, which is exactly how Kora's
 * built-in themes work — `index.css` defines `--theme-bg`, `--theme-text`,
 * `--theme-text-muted`, `--theme-border`, `--theme-accent`, `--theme-card`
 * and `--toast-bg` on `:root` and on every `.theme-*` / bare-name class, and
 * the whole app reads them through the `kindle-*` Tailwind aliases.
 *
 * So a theme plugin is not a parallel theming system. It is another writer of
 * the same variables, which means it composes with everything that already
 * reads them (skins, safe-area insets, the reader) instead of reimplementing
 * any of it.
 *
 * Why inline style on BOTH <html> and <body>:
 *  - The built-in rules are declared as `:root, .theme-x, .x`. `App.tsx` puts
 *    the `theme-*` class on <body>, so a rule there sets the variables
 *    *directly on the body*, beating any value merely inherited from an inline
 *    style on <html>.
 *  - Writing only to <html> would therefore be silently overridden by the
 *    active built-in theme's body class. Inline style wins over any stylesheet
 *    rule for the same element, so writing both is what actually takes effect.
 *
 * Validation lives in `themeTokens.ts` to keep the dependency graph acyclic
 * (this module reads the store; the store validates installs).
 */

import type { PluginManifest } from "./types";
import { getInstalledExtensions } from "./store";
import {
  applyThemeTokens,
  clearThemeTokens,
  validateThemeTokens,
  type StyleTarget,
} from "./themeTokens";

export type { StyleTarget } from "./themeTokens";
export {
  applyThemeTokens,
  clearThemeTokens,
  validateThemeTokens,
} from "./themeTokens";

const LS_ACTIVE = "kora.activeThemePlugin.v1";

export interface ApplyResult {
  /** The theme id that ended up active, or null when nothing was applied. */
  applied: string | null;
  /** Human-readable reason, for the UI. Never throws for a bad theme. */
  error?: string;
}

/** A plugin manifest that declares itself a usable theme. */
export interface ThemePlugin extends PluginManifest {
  category: "theme";
  themeId: string;
  dark?: boolean;
}

export function isThemeManifest(m: PluginManifest): m is ThemePlugin {
  return m.category === "theme" && !!m.themeId;
}

/** Every installed theme plugin. Bad token sets are dropped, not thrown. */
export function getInstalledThemePlugins(): ThemePlugin[] {
  return getInstalledExtensions().flatMap((m) => {
    if (!isThemeManifest(m)) return [];
    const { tokens, error } = validateThemeTokens(m.tokens);
    if (error || !tokens) return [];
    return [{ ...m, tokens } as ThemePlugin];
  });
}

export function getActiveThemePluginId(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(LS_ACTIVE);
  } catch {
    return null;
  }
}

export function setActiveThemePluginId(id: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (id) localStorage.setItem(LS_ACTIVE, id);
    else localStorage.removeItem(LS_ACTIVE);
  } catch {
    /* storage unavailable — the theme still applies for this session */
  }
}

/**
 * The theme plugin that should be active right now, or null when the user is
 * on a built-in theme (or the stored plugin has since been uninstalled).
 */
export function resolveActiveThemePlugin(): ThemePlugin | null {
  const id = getActiveThemePluginId();
  if (!id) return null;
  return getInstalledThemePlugins().find((t) => t.themeId === id) ?? null;
}

/**
 * Resolve the active theme plugin and apply it to the live document.
 *
 * `html` and `body` are both required — see the note at the top of this file.
 * Calling this with no active plugin is the normal "back to a built-in theme"
 * path, and only clears variables.
 */
export function applyActiveThemePlugin(doc?: Document): ApplyResult {
  const d = doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!d?.documentElement) return { applied: null, error: "no document" };
  const targets = [d.documentElement, d.body].filter(Boolean) as StyleTarget[];

  const theme = resolveActiveThemePlugin();
  if (!theme) {
    clearThemeTokens(targets);
    return { applied: null };
  }
  const { tokens } = validateThemeTokens(theme.tokens);
  if (!tokens) {
    clearThemeTokens(targets);
    return { applied: null, error: "Active theme has invalid tokens" };
  }
  applyThemeTokens(tokens, targets);
  return { applied: theme.themeId };
}

/**
 * Mark the active theme plugin on the document, for CSS that wants to react.
 *
 * The argument order is `themeId` first on purpose: the other two functions in
 * this module take an optional trailing `doc`, and a required parameter cannot
 * follow an optional one.
 */
export function syncThemePluginMarker(
  themeId: string | null,
  doc?: Document
): void {
  const d = doc ?? (typeof document !== "undefined" ? document : undefined);
  const el = d?.documentElement;
  if (!el) return;
  if (themeId) el.setAttribute("data-kora-theme-plugin", themeId);
  else el.removeAttribute("data-kora-theme-plugin");
}
