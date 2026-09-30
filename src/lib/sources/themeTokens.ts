/**
 * Theme token validation.
 *
 * Deliberately its own module with no imports from `store` or `themeRuntime`.
 * Both of those need `validateThemeTokens`, and the theme runtime needs
 * `getInstalledExtensions` from the store, so folding validation into the
 * runtime would make the two modules import each other. Keeping the pure part
 * separate keeps the dependency graph a tree.
 */

import type { ThemeTokens } from "./types";

/** The subset of a DOM element this module needs — lets tests pass a fake. */
export interface StyleTarget {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
}

/**
 * Token key -> CSS custom properties.
 *
 * Each token writes two variables: the `--theme-*` name that `index.css`
 * defines and the `--color-kindle-*` alias that the Tailwind `@theme` block
 * maps the `kindle-*` utilities to. Both are written so a theme plugin
 * restyles utilities (`bg-kindle-card`) and raw `var()` reads alike.
 */
export const TOKEN_VARS: Record<keyof ThemeTokens, string[]> = {
  bg: ["--theme-bg", "--color-kindle-bg"],
  text: ["--theme-text", "--color-kindle-text"],
  textMuted: ["--theme-text-muted", "--color-kindle-text-muted"],
  border: ["--theme-border", "--color-kindle-border"],
  accent: ["--theme-accent", "--color-kindle-accent"],
  card: ["--theme-card", "--color-kindle-card"],
  toastBg: ["--toast-bg"],
};

/** The tokens a theme must provide to be worth applying. */
export const REQUIRED_TOKENS: (keyof ThemeTokens)[] = [
  "bg",
  "text",
  "textMuted",
  "border",
  "accent",
  "card",
];

/** Reject a colour we could not actually render, rather than emitting broken CSS. */
export function isCssColor(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  // Hard length cap: a theme token is a colour, and anything long enough to
  // carry a `;` or a `url(...)` is an injection attempt, not a palette.
  if (v.length > 64) return false;
  if (/[;{}<>\\]/.test(v)) return false;
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)
    || /^(rgb|rgba|hsl|hsla|lab|lch|oklab|oklch|color)\(/i.test(v)
    || /^[a-z]+$/i.test(v)
    || /^(transparent|currentcolor|inherit|initial|unset)$/i.test(v);
}

/**
 * Validate a theme token set. Returns the sanitized tokens, or an error
 * string. Only the recognised keys are returned, so an extra field in a
 * registry JSON cannot smuggle arbitrary CSS into the `var()` sink.
 */
export function validateThemeTokens(raw: unknown): {
  tokens?: ThemeTokens;
  error?: string;
} {
  if (!raw || typeof raw !== "object") return { error: "Theme has no tokens" };
  const src = raw as Record<string, unknown>;

  for (const key of REQUIRED_TOKENS) {
    if (!isCssColor(src[key])) {
      return { error: `Theme token "${key}" is not a valid colour` };
    }
  }
  if (src.toastBg !== undefined && !isCssColor(src.toastBg)) {
    return { error: 'Theme token "toastBg" is not a valid colour' };
  }

  const out: ThemeTokens = {
    bg: (src.bg as string).trim(),
    text: (src.text as string).trim(),
    textMuted: (src.textMuted as string).trim(),
    border: (src.border as string).trim(),
    accent: (src.accent as string).trim(),
    card: (src.card as string).trim(),
  };
  if (src.toastBg !== undefined) out.toastBg = (src.toastBg as string).trim();
  return { tokens: out };
}

/** Write the token set onto the given targets. */
export function applyThemeTokens(tokens: ThemeTokens, targets: StyleTarget[]): void {
  for (const [key, vars] of Object.entries(TOKEN_VARS) as [
    keyof ThemeTokens,
    string[],
  ][]) {
    const value = tokens[key];
    if (typeof value !== "string" || !value) continue;
    for (const t of targets) {
      for (const v of vars) t.style.setProperty(v, value);
    }
  }
}

/** Remove every variable this module owns, so the built-in theme shows through. */
export function clearThemeTokens(targets: StyleTarget[]): void {
  for (const vars of Object.values(TOKEN_VARS)) {
    for (const t of targets) {
      for (const v of vars) t.style.removeProperty(v);
    }
  }
}
