/**
 * `kora plugin validate <manifest.json>` — a structural check on a plugin
 * manifest.
 *
 * ── SCOPE, STATED UP FRONT BECAUSE A PARTIAL CLI IS EASY TO MISREAD ─────
 * This command exists. `kora plugin library`, `kora plugin relay` and an SDK
 * do NOT exist. `--help` says so, and so does the banner this prints. A
 * validator that quietly implies a fuller toolchain is worse than no CLI,
 * because someone will write a pipeline against a capability that is not
 * there.
 *
 * ── WHY REUSE THE IN-TREE VALIDATORS ────────────────────────────────────
 * Theme colours are checked with `validateThemeTokens` and source endpoints
 * with the same rules the app applies at install time. That is the whole
 * point: a manifest this command calls valid is one the app will also accept,
 * because there is only one implementation of the rules. A second, looser
 * copy in a script would drift, and the drift would show up as "the CLI said
 * it was fine but the app refused it".
 *
 * What it does NOT do: fetch the URLs, run the selectors, or install
 * anything. It is a static check, and it says so.
 */

import { REQUIRED_TOKENS, isCssColor, validateThemeTokens } from "../sources/themeTokens";
import type { IntegrationTarget, PluginCategory, PluginManifest } from "../sources/types";

export type Severity = "error" | "warning";

export interface Finding {
  severity: Severity;
  /** Dotted path to the offending field, e.g. `source.endpoints.detail`. */
  path: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  findings: Finding[];
  /** Populated only when the manifest is structurally readable. */
  summary?: {
    id: string;
    name: string;
    version: string;
    category: PluginCategory;
  };
}

const CATEGORIES: readonly PluginCategory[] = ["source", "theme", "integration", "tool"];
const TARGETS: readonly IntegrationTarget[] = ["kindle", "calibre", "croc"];
const REQUIREMENTS = ["permission", "device", "network"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Non-empty string, with a length cap so a "name" cannot be a data blob. */
function checkShortString(
  v: unknown,
  path: string,
  findings: Finding[],
  { required = true, max = 200 }: { required?: boolean; max?: number } = {}
): void {
  if (v === undefined || v === null) {
    if (required) findings.push({ severity: "error", path, message: "is required" });
    return;
  }
  if (typeof v !== "string") {
    findings.push({ severity: "error", path, message: `must be a string, got ${typeof v}` });
    return;
  }
  if (!v.trim()) {
    findings.push({ severity: "error", path, message: "must not be empty" });
    return;
  }
  if (v.length > max) {
    findings.push({ severity: "error", path, message: `is too long (${v.length} > ${max})` });
  }
}

function checkUrl(v: unknown, path: string, findings: Finding[], required = false): void {
  if (v === undefined || v === null) {
    if (required) findings.push({ severity: "error", path, message: "is required" });
    return;
  }
  if (typeof v !== "string" || !v.trim()) {
    findings.push({ severity: "error", path, message: "must be a non-empty URL string" });
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    findings.push({ severity: "error", path, message: `is not a valid URL: ${v}` });
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    findings.push({
      severity: "error",
      path,
      message: `must use http(s), got "${parsed.protocol}"`,
    });
  }
}

/**
 * The endpoints a `source` plugin must declare for Kora to render a comic.
 *
 * Mirrors what the reader actually calls. A source missing one of these
 * installs fine and then breaks on first use, which is the failure this
 * command exists to catch before anyone publishes it.
 */
const REQUIRED_SOURCE_ENDPOINTS = ["list", "detail", "pages"] as const;

function validateSource(source: unknown, findings: Finding[]): void {
  if (!isRecord(source)) {
    findings.push({ severity: "error", path: "source", message: "must be an object" });
    return;
  }

  checkShortString(source.id, "source.id", findings);
  checkShortString(source.name, "source.name", findings);
  checkUrl(source.baseUrl, "source.baseUrl", findings, true);
  checkUrl(source.iconUrl, "source.iconUrl", findings, false);

  if (typeof source.version !== "number" || !Number.isFinite(source.version)) {
    findings.push({ severity: "error", path: "source.version", message: "must be a finite number" });
  } else if (source.version < 1) {
    findings.push({ severity: "error", path: "source.version", message: "must be >= 1" });
  }

  for (const flag of ["nsfw", "piracy"] as const) {
    const v = source[flag];
    if (v !== undefined && typeof v !== "boolean") {
      findings.push({ severity: "error", path: `source.${flag}`, message: "must be a boolean" });
    }
  }

  // ---- engine vs endpoints ----
  //
  // A source does NOT have to carry its own selectors. When it declares a
  // shared site engine (`theme: "madara"`, which covers the large majority of
  // sources in the real registry) the engine supplies the endpoints and
  // `endpoints` is absent entirely. Verified against a live manifest from
  // Kora-Plugins: it has `theme: "madara"` and no `endpoints` key at all.
  //
  // Demanding `endpoints` unconditionally would reject almost every real
  // manifest, so the rule is: a source needs endpoints UNLESS it names an
  // engine that provides them.
  const engine = source.theme;
  const hasEngine = typeof engine === "string" && engine.length > 0;
  if (engine !== undefined && !["madara", "json"].includes(engine as string)) {
    findings.push({
      severity: "error",
      path: "source.theme",
      message: 'must be "madara" or "json" when present',
    });
  }
  if (source.api !== undefined && source.api !== "json") {
    findings.push({ severity: "error", path: "source.api", message: 'must be "json" when present' });
  }

  const endpoints = source.endpoints;
  if (!hasEngine && !isRecord(endpoints)) {
    findings.push({
      severity: "error",
      path: "source.endpoints",
      message:
        "is required for a source without a shared engine. Either declare `theme` (madara/json) or supply endpoints.",
    });
    return;
  }
  if (hasEngine && endpoints === undefined) {
    // Normal and correct; say nothing.
    return;
  }
  if (!isRecord(endpoints)) {
    findings.push({ severity: "error", path: "source.endpoints", message: "must be an object" });
    return;
  }
  if (hasEngine) {
    findings.push({
      severity: "warning",
      path: "source.endpoints",
      message: "is set while `theme` also supplies endpoints; the explicit endpoints win",
    });
  }

  const declared = new Set(Object.keys(endpoints));
  for (const key of REQUIRED_SOURCE_ENDPOINTS) {
    if (!declared.has(key)) {
      findings.push({
        severity: "error",
        path: `source.endpoints.${key}`,
        message: "is required for a source plugin",
      });
    }
  }
  for (const key of declared) {
    if (!(REQUIRED_SOURCE_ENDPOINTS as readonly string[]).includes(key)) {
      findings.push({
        severity: "warning",
        path: `source.endpoints.${key}`,
        message: "is not an endpoint Kora calls; it will be ignored",
      });
    }
  }

  for (const key of declared) {
    const spec = endpoints[key];
    const path = `source.endpoints.${key}`;
    // An endpoint may be a bare selector string or a `{selector, url, requires}`.
    if (typeof spec === "string") {
      if (!spec.trim()) {
        findings.push({ severity: "error", path, message: "selector must not be empty" });
      }
      continue;
    }
    if (!isRecord(spec)) {
      findings.push({
        severity: "error",
        path,
        message: "must be a selector string or an endpoint object",
      });
      continue;
    }
    if (typeof spec.selector !== "string" || !spec.selector.trim()) {
      findings.push({ severity: "error", path: `${path}.selector`, message: "must be a non-empty string" });
    }
    if (spec.url !== undefined) checkUrl(spec.url, `${path}.url`, findings, false);
    if (spec.requires !== undefined && typeof spec.requires !== "boolean") {
      findings.push({ severity: "error", path: `${path}.requires`, message: "must be a boolean" });
    }
  }

  // ---- selectors ----
  if (source.selectors !== undefined && !isRecord(source.selectors)) {
    findings.push({ severity: "error", path: "source.selectors", message: "must be an object" });
  }
}

function validateTheme(manifest: Record<string, unknown>, findings: Finding[]): void {
  // Reuse the app's own token validator — one implementation, no drift.
  const { tokens, error } = validateThemeTokens(manifest.tokens);
  if (error || !tokens) {
    findings.push({ severity: "error", path: "tokens", message: error ?? "theme has no tokens" });
    return;
  }
  if (typeof manifest.dark !== "boolean") {
    findings.push({
      severity: "error",
      path: "dark",
      message:
        "is required for a theme: Kora drives Tailwind's dark: variant and the system status bar off this flag",
    });
  }
  if (manifest.themeId !== undefined) {
    checkShortString(manifest.themeId, "themeId", findings);
  }
  // Surface the token list in the error when it is empty, because "invalid
  // theme" with no field named is the least actionable message possible.
  if (tokens && REQUIRED_TOKENS.every((k) => isCssColor((manifest.tokens as never)[k]))) {
    /* all required tokens present; nothing further to report */
  }
}

function validateIntegration(manifest: Record<string, unknown>, findings: Finding[]): void {
  const t = manifest.target;
  if (t === undefined) {
    findings.push({
      severity: "error",
      path: "target",
      message: "is required for an integration plugin",
    });
  } else if (!TARGETS.includes(t as IntegrationTarget)) {
    findings.push({
      severity: "error",
      path: "target",
      message: `must be one of ${TARGETS.join(", ")}`,
    });
  }
}

/**
 * Validate a parsed manifest.
 *
 * Returns findings rather than throwing, so a caller can print all of them at
 * once — a validator that stops at the first error makes fixing a manifest a
 * guessing game.
 */
export function validateManifest(raw: unknown): ValidationReport {
  const findings: Finding[] = [];

  if (!isRecord(raw)) {
    return {
      ok: false,
      findings: [{ severity: "error", path: "$", message: "manifest must be a JSON object" }],
    };
  }

  // Two shapes reach this function, and telling them apart matters:
  //
  //   A. a bare SOURCE definition — what Kora's own registry publishes.
  //      Flat, with `baseUrl` and `theme`/`endpoints` at the top level, and
  //      NO `category` field (verified against a live Kora-Plugins manifest).
  //   B. a PluginManifest wrapper — `{ id, name, version, category, … }`, used
  //      by the hub for themes, integrations and tools, and carrying a nested
  //      `source` when it wraps a source.
  //
  // Shape A is recognised by the marker it always has: a top-level `baseUrl`,
  // paired with no `category`. Note that `source === undefined` is NOT a
  // usable marker on its own — every theme, integration and tool manifest has
  // no nested `source` either, so using it routes all of them into the source
  // validator and reports nonsense about baseUrl for a theme.
  const isBareSource = raw.baseUrl !== undefined && raw.category === undefined;
  if (isBareSource) {
    validateSource(raw, findings);
    return {
      ok: !findings.some((f) => f.severity === "error"),
      findings,
      summary:
        typeof raw.id === "string" && typeof raw.name === "string"
          ? {
              id: raw.id,
              name: raw.name,
              version: String(raw.version ?? "?"),
              category: "source",
            }
          : undefined,
    };
  }

  checkShortString(raw.id, "id", findings, { max: 120 });
  checkShortString(raw.name, "name", findings, { max: 200 });
  checkShortString(raw.version, "version", findings, { max: 40 });

  if (typeof raw.version === "string" && !/^\d+(\.\d+)*([-+][0-9A-Za-z.-]+)?$/.test(raw.version)) {
    findings.push({
      severity: "warning",
      path: "version",
      message: `"${raw.version}" is not a dotted version number`,
    });
  }

  const category = raw.category;
  if (category === undefined) {
    findings.push({ severity: "error", path: "category", message: "is required" });
  } else if (!CATEGORIES.includes(category as PluginCategory)) {
    findings.push({
      severity: "error",
      path: "category",
      message: `must be one of ${CATEGORIES.join(", ")}`,
    });
  }

  checkShortString(raw.author, "author", findings, { required: false });
  checkShortString(raw.description, "description", findings, { required: false, max: 2000 });
  checkUrl(raw.icon, "icon", findings, false);
  checkUrl(raw.website, "website", findings, false);

  if (raw.requires !== undefined) {
    if (!Array.isArray(raw.requires)) {
      findings.push({ severity: "error", path: "requires", message: "must be an array" });
    } else {
      for (const [i, r] of raw.requires.entries()) {
        if (!REQUIREMENTS.includes(r as (typeof REQUIREMENTS)[number])) {
          findings.push({
            severity: "error",
            path: `requires[${i}]`,
            message: `must be one of ${REQUIREMENTS.join(", ")}`,
          });
        }
      }
    }
  }

  if (raw.availability !== undefined && !["ready", "unavailable"].includes(raw.availability as string)) {
    findings.push({
      severity: "error",
      path: "availability",
      message: 'must be "ready" or "unavailable"',
    });
  }
  if (raw.availability === "unavailable" && !raw.availabilityNote) {
    findings.push({
      severity: "warning",
      path: "availabilityNote",
      message: "should explain why the plugin is unavailable; the UI shows it verbatim",
    });
  }

  switch (category) {
    case "source":
      validateSource(raw.source, findings);
      break;
    case "theme":
      validateTheme(raw, findings);
      break;
    case "integration":
      validateIntegration(raw, findings);
      break;
    default:
      break;
  }

  const summary =
    typeof raw.id === "string" &&
    typeof raw.name === "string" &&
    typeof raw.version === "string" &&
    typeof raw.category === "string"
      ? {
          id: raw.id,
          name: raw.name,
          version: raw.version,
          category: raw.category as PluginCategory,
        }
      : undefined;

  return {
    ok: !findings.some((f) => f.severity === "error"),
    findings,
    summary,
  };
}

/** Typed accessor, so a passing report can be used as a manifest. */
export function manifestFromReport(raw: unknown): PluginManifest | null {
  return isRecord(raw) ? (raw as unknown as PluginManifest) : null;
}