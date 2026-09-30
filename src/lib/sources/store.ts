/**
 * Installed source plugins — local registry + install/enable/disable.
 *
 * Plugins are data, so "installing" means fetching a JSON document and
 * storing it. That is the whole trust story: there is no code execution
 * surface, so a source cannot do anything a plain fetch could not.
 *
 * A plugin reaches the network only through the Worker relay, and only
 * for its own declared baseUrl — see client.ts.
 *
 * Registry discovery follows Tachiyomi Gen 2: a repo is a static
 * index.json listing extensions, each with one or more sources.
 */

import type {
  IntegrationTarget,
  PluginCategory,
  PluginManifest,
  RegistryIndex,
  SourcePlugin,
  ThemeTokens,
} from "./types";
import { isNsfwExtension } from "./types";
import { validateThemeTokens } from "./themeRuntime";

const LS_PLUGINS = "kora.sourcePlugins.v1";
const LS_REPOS = "kora.sourceRepos.v1";
const LS_OPTED_IN = "kora.sourceOptsIn.v1";

/** The registry Kora ships with. */
export const DEFAULT_REPO = "https://raw.githubusercontent.com/CHAOTIC-RAY/Kora-Sources/main/index.json";

function readJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
    // Same-tab listeners (the manager UI) need to hear about this.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kora-sources-changed"));
    }
  } catch {
    /* storage full or unavailable — the session still works in memory */
  }
}

/** Every plugin the user has installed, whether or not it is enabled. */
export function getInstalledPlugins(): SourcePlugin[] {
  return readJSON<SourcePlugin[]>(LS_PLUGINS, []);
}

// ── Plugins ───────────────────────────────────────────────────────────
// Sources stay in their own store so an existing install keeps working.
// Everything that is not a source (themes, integrations, tools) lives here
// as a manifest, so the hub can list every kind of plugin from one place.

const LS_EXT = "kora.plugins.v1";

/** Every non-source plugin the user has installed. */
export function getInstalledExtensions(): PluginManifest[] {
  return readJSON<PluginManifest[]>(LS_EXT, []);
}

export function getAllInstalled(): PluginManifest[] {
  // Sources are plugins too; a manifest without a payload is a source.
  return [
    ...getInstalledPlugins().map(
      (s): PluginManifest => ({
        id: s.id,
        name: s.name,
        version: String(s.version ?? "0"),
        category: "source",
        icon: s.icon,
        piracy: s.piracy,
        nsfw: s.nsfw,
        source: s,
      })
    ),
    ...getInstalledExtensions(),
  ];
}

export function isExtensionInstalled(id: string): boolean {
  return getInstalledExtensions().some((p) => p.id === id);
}

/**
 * Install a non-source plugin.
 *
 * Returns false when the id is already present, so a double click cannot
 * register the same manifest twice.
 *
 * The `category === "source"` rejection is deliberate, not a bug: sources have
 * their own store (`installPlugin`) and their own validation, which requires
 * endpoints. Letting a source through here would register a manifest with
 * nothing fetchable behind it.
 *
 * Non-source manifests are validated per category — a theme with unusable
 * tokens or an integration with no target is rejected here rather than
 * failing later, in a place the user cannot connect back to the install.
 */
export function installExtension(manifest: PluginManifest): boolean {
  if (!manifest?.id || manifest.category === "source") return false;
  if (isExtensionInstalled(manifest.id)) return false;

  if (manifest.category === "theme") {
    if (!manifest.themeId) return false;
    const { error } = validateThemeTokens(manifest.tokens);
    if (error) return false;
  }
  if (manifest.category === "integration" && !manifest.target) return false;

  writeJSON(LS_EXT, [...getInstalledExtensions(), manifest]);
  return true;
}

export function uninstallExtension(id: string): void {
  writeJSON(
    LS_EXT,
    getInstalledExtensions().filter((p) => p.id !== id)
  );
}

/**
 * Repository URLs that shipped in a build and must not survive it.
 *
 * A test registry was left in the configured list during development. The
 * file was deleted, but the entry lives in each device's localStorage, so
 * every install that ran that build kept requesting a path that no longer
 * exists. The server's SPA fallback answers with index.html, and the hub
 * reported it as a raw parser error:
 *
 *   /data/test-registry.json — Unexpected token '<', "<!doctype "... is not valid JSON
 *
 * Deleting the file cannot fix this — only the stored entry can. So it is
 * purged here, on read, which covers phones and browsers that will never
 * run a build where the file exists again.
 */
const RETIRED_REPOS = [/\/data\/test-registry\.json/i];

/** Drop retired entries from storage. Safe to call on every read. */
function purgeRetiredRepos(): void {
  let changed = false;
  const kept = readJSON<string[]>(LS_REPOS, []).filter((url) => {
    if (typeof url !== "string") return false;
    const dead = RETIRED_REPOS.some((re) => re.test(url));
    if (dead) changed = true;
    return !dead;
  });
  if (changed) writeJSON(LS_REPOS, kept);
}

/** Repos to offer in the manager. The default can be removed but not lost. */
export function getRepos(): string[] {
  purgeRetiredRepos();
  const custom = readJSON<string[]>(LS_REPOS, []);
  return Array.from(new Set([DEFAULT_REPO, ...custom]));
}

export function addRepo(url: string): boolean {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  const next = Array.from(new Set([...getRepos(), trimmed]));
  writeJSON(LS_REPOS, next);
  return true;
}

export function removeRepo(url: string): void {
  // The shipped registry is part of the app; it can be disabled but not
  // deleted, otherwise a user could end up with no way back.
  writeJSON(LS_REPOS, getRepos().filter((r) => r !== DEFAULT_REPO));
}

export function installPlugin(plugin: SourcePlugin): void {
  const all = getInstalledPlugins();
  const i = all.findIndex((p) => p.id === plugin.id);
  if (i >= 0) all[i] = plugin;
  else all.push(plugin);
  writeJSON(LS_PLUGINS, all);
}

export function uninstallPlugin(id: string): void {
  writeJSON(
    LS_PLUGINS,
    getInstalledPlugins().filter((p) => p.id !== id)
  );
}

export function isPluginEnabled(id: string): boolean {
  return getInstalledPlugins().some((p) => p.id === id);
}

/* ── Piracy / adult opt-in ────────────────────────────────────────────────
 * Kora already carries search tooling that reaches shadow libraries, so we
 * do not gate those behind a modal. Instead, any source flagged `piracy` or
 * NSFW is hidden until the user turns it on for that source specifically.
 * The choice stays theirs, per source, and is remembered.
 */

const optedIn = (): string[] => readJSON<string[]>(LS_OPTED_IN, []);

/**
 * Sources that should be offered as chips in Discover.
 *
 * Installing and the piracy opt-in are the only two gates: an installed
 * source the user has not accepted is not discoverable, and one they have
 * accepted is. There is no separate "enabled" flag to check.
 */
export function getDiscoverablePlugins(): SourcePlugin[] {
  return getInstalledPlugins().filter(isSourceVisible);
}

export function isSourceVisible(plugin: SourcePlugin): boolean {
  if (!plugin.piracy && !plugin.nsfw) return true;
  return optedIn().includes(plugin.id);
}

export function setSourceOptIn(id: string, allow: boolean): void {
  const set = new Set(optedIn());
  if (allow) set.add(id);
  else set.delete(id);
  writeJSON(LS_OPTED_IN, Array.from(set));
}

export function hasOptedInAnything(): boolean {
  return optedIn().length > 0;
}

/* ── Placement: which surface a plugin category belongs to ─────────────── */

/**
 * The three places a plugin can live, named after the app surfaces.
 *
 * A plugin of the wrong category showing up in the wrong tab is not a layout
 * nit — it is a trust problem. A theme that appears in Discover reads as a
 * place to install content, and an integration that appears next to sources
 * reads as one more place books come from, when it is really a bridge to an
 * app the user already trusts. So the mapping is data, not layout, and it
 * lives here where the tests can assert it without rendering anything.
 */
export type PluginSurface = "discover" | "workshop" | "settings";

/**
 * The ONE surface the plugin browser is mounted on.
 *
 * Installing, enabling, disabling and removing a plugin happens in exactly one
 * place, and that place is Discover. A second copy of the hub elsewhere is not
 * a convenience: it is two answers to "is this installed?", and they drift.
 */
export const HUB_SURFACE: PluginSurface = "discover";

/**
 * The category filter the hub renders.
 *
 * Every category, deliberately. The hub is where plugins are managed, so it has
 * to be able to manage all of them — filtering it down to sources would mean an
 * integration could never be installed from anywhere.
 */
export function hubCategories(): PluginCategory[] {
  return Object.keys(SURFACE_BY_CATEGORY) as PluginCategory[];
}

/**
 * Placement rule for an INSTALLED plugin — where its own surface lives, once it
 * is on the device:
 *   source      -> discover    (it joins the feed it feeds; no panel of its own)
 *   integration -> workshop    (a bento tile that opens the integration's panel)
 *   theme       -> settings    (a theme is a preference, not a utility)
 *   tool        -> workshop    (an in-app utility, same place as integrations)
 *
 * Themes used to be placed in Workshop on the argument that they are
 * "non-source plugins like integrations". That was wrong: choosing the
 * active theme is a Settings concern, and burying themes in the Workshop
 * grid made installed themes look like utilities you can launch. The
 * Workshop grid filters independently, so a theme can no longer appear
 * there even if a stale entry says otherwise.
 */
const SURFACE_BY_CATEGORY: Record<PluginCategory, PluginSurface> = {
  source: "discover",
  integration: "workshop",
  theme: "settings",
  tool: "workshop",
};

/** The surface an installed plugin of this category belongs to. Unknown
 *  categories fall back to Workshop, which is where every non-source plugin
 *  goes — the conservative choice, because a miscategorised plugin must not
 *  surface where content lives. */
export function surfaceForCategory(category: PluginCategory): PluginSurface {
  return SURFACE_BY_CATEGORY[category] ?? "workshop";
}

/** The categories whose installed tiles live on a surface. */
export function categoriesForSurface(surface: PluginSurface): PluginCategory[] {
  return (Object.keys(SURFACE_BY_CATEGORY) as PluginCategory[]).filter(
    (c) => SURFACE_BY_CATEGORY[c] === surface
  );
}

/**
 * Only sources are ever behind the piracy/adult opt-in.
 *
 * The opt-in is a statement about where books come from. A colour scheme or a
 * bridge to the user's own Calibre server has no bearing on that, so gating
 * them would be both wrong and, worse, a lever for pressuring the user into
 * opting in. Themes and integrations stay visible to everyone.
 */
export function isGatedCategory(category: PluginCategory): boolean {
  return category === "source";
}

/** Gating is per-source opt-in, and only sources ever consult it. */
export function isEntryGated(entry: RepoEntry): boolean {
  if (!isGatedCategory(entry.category)) return false;
  return entry.plugin.piracy === true || entry.plugin.nsfw === true;
}

/* ── Registry fetching ─────────────────────────────────────────────────── */

export interface RepoEntry {
  plugin: SourcePlugin;
  installed: boolean;
  /** True when this entry needs the user to opt in before it is shown. */
  gated: boolean;
  /**
   * Where the full definition lives.
   *
   * The registry index only carries *metadata* (id, name, language, home url)
   * — the selectors live in the source file, so installing means fetching
   * this. A missing installUrl means the registry entry is a bare listing
   * with nothing behind it, and the UI must say so rather than offer an
   * install that would install an empty plugin.
   */
  installUrl: string;
  /**
   * Which kind of plugin this is. The hub groups on this, and it decides both
   * which store the plugin lands in and whether the piracy opt-in applies.
   */
  category: PluginCategory;
  /**
   * Non-source payload straight from the index, so the hub can render a theme
   * swatch or an integration's status without downloading the plugin file.
   * Only the fields relevant to `category` are populated.
   */
  manifest?: PluginManifest;
}

function absolutise(baseUrl: string, u: string | undefined): string {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return baseUrl.replace(/\/+$/, "") + "/" + u.replace(/^\/+/, "");
}

/**
 * Fetch a registry index and flatten it into installable plugins.
 *
 * The index lists *extensions*, each holding one or more plugins. Kora's
 * plugin unit is the entry, not the extension, so one extension yields several
 * entries — the same way Tachiyomi shows a multi-source extension.
 *
 * Every entry carries its `category`, because the hub groups on it and the
 * piracy opt-in applies to sources only.
 */
export async function fetchRegistry(
  repoUrl: string,
  signal?: AbortSignal
): Promise<RepoEntry[]> {
  const res = await fetch(repoUrl, { signal });
  if (!res.ok) throw new Error(`Registry request failed (${res.status})`);

  let index: RegistryIndex | undefined;
  try {
    index = (await res.json()) as RegistryIndex;
  } catch (raw) {
    const responseText = (await res.clone().text()).slice(0, 4096);
    const looksLikeHtml = /^\s*<!doctype\s+html/i.test(responseText) || /^\s*<html[\s>]/i.test(responseText) || /^\s*<head[\s>]/i.test(responseText) || /^\s*<body[\s>]/i.test(responseText);
    if (looksLikeHtml || raw instanceof SyntaxError) {
      throw new Error(
        looksLikeHtml
          ? "That URL did not return plugin data — it returned a web page. The repository may be wrong or no longer exists."
          : `That URL did not return valid plugin data (${raw instanceof Error ? raw.message : raw}). The repository may be wrong or no longer exists.`
      );
    }
    throw raw instanceof Error ? raw : new Error(String(raw));
  }
  const list = index?.extensionList?.extensions;
  if (!Array.isArray(list)) throw new Error("Malformed registry: no extensionList");

  const installedSources = new Set(getInstalledPlugins().map((p) => p.id));
  const installedExtensions = new Set(getInstalledExtensions().map((p) => p.id));
  const out: RepoEntry[] = [];

  for (const ext of list) {
    const nsfw = isNsfwExtension(ext);
    for (const src of ext.sources ?? []) {
      const id = String(src.id);
      if (!id || !src.name) continue;

      // `piracy` is our own field, not part of the Gen 2 shape, so a registry
      // that omits it must not be read as "clean" by accident. Only an
      // explicit `piracy: false` is treated as declared-safe; everything else
      // is gated and the user decides.
      const piracy = (src as { piracy?: boolean }).piracy === true;

      // A registry that predates the category field describes sources, so
      // defaulting to "source" keeps every existing index working untouched.
      const rawCategory = (src as { category?: unknown }).category;
      const category: PluginCategory = isPluginCategory(rawCategory) ? rawCategory : "source";

      const icon = ext.resources?.iconUrl || undefined;
      const installUrl = (ext.resources?.apkUrl as string | undefined) || "";

      const plugin: SourcePlugin = {
        id,
        name: src.name,
        lang: src.language,
        version: 1,
        nsfw,
        piracy,
        // A theme or integration has no site to fetch from. Leaving baseUrl
        // empty is honest here; only a source ever needs it, and the install
        // path is the only thing that reads it.
        baseUrl: src.homeUrl || "",
        // The registry carries the icon so the list renders real logos before
        // anything is installed. Dropping this is why every card used to show
        // the same puzzle-piece placeholder.
        icon,
        gen2: {
          packageName: ext.packageName,
          versionName: ext.versionName,
          versionCode: ext.versionCode,
          homeUrl: src.homeUrl,
        },
        endpoints: {},
      };

      // Only sources are gated behind the piracy opt-in. A theme or a legal
      // library integration has nothing to do with that choice, and hiding it
      // behind a warning about shadow libraries would be both wrong and a
      // good way to make the user opt in unnecessarily.
      const gated = category === "source" && (piracy || nsfw);

      out.push({
        plugin,
        installed:
          category === "source" ? installedSources.has(id) : installedExtensions.has(id),
        gated,
        installUrl,
        category,
        manifest:
          category === "source"
            ? undefined
            : {
                id,
                name: src.name,
                version: ext.versionName || "1.0.0",
                category,
                author: (src as { author?: string }).author,
                description: (src as { description?: string }).description,
                icon,
                website: src.homeUrl,
                target: (src as { target?: IntegrationTarget }).target,
                themeId: (src as { themeId?: string }).themeId,
                tokens: (src as { tokens?: ThemeTokens }).tokens,
                dark: (src as { dark?: boolean }).dark,
                availability: (src as { availability?: PluginManifest["availability"] }).availability,
                availabilityNote: (src as { availabilityNote?: string }).availabilityNote,
                requires: (src as { requires?: PluginManifest["requires"] }).requires,
              },
      });
    }
  }
  return out;
}

/** Narrow an unknown value from a registry to a real category. */
export function isPluginCategory(value: unknown): value is PluginCategory {
  return (
    value === "source" || value === "theme" || value === "integration" || value === "tool"
  );
}

/**
 * Fetch and validate a NON-source plugin definition (a theme or an integration).
 *
 * Separate from `fetchPluginDefinition` because the validity rules are
 * genuinely different: a source is fetchable if it has endpoints or a theme
 * engine, whereas a theme needs usable tokens and an integration needs a
 * target. Validating one with the other's rules would be wrong in both
 * directions.
 */
export async function fetchExtensionDefinition(
  installUrl: string
): Promise<PluginManifest | null> {
  if (!installUrl) return null;
  const res = await fetch(installUrl);
  if (!res.ok) throw new Error(`Plugin download failed (${res.status})`);
  const manifest = (await res.json()) as PluginManifest;
  if (!manifest || typeof manifest !== "object") return null;
  if (!manifest.id || !manifest.name) {
    throw new Error("Malformed plugin: missing id or name");
  }
  const category: PluginCategory = isPluginCategory(manifest.category)
    ? manifest.category
    : "source";
  if (category === "source") {
    throw new Error("Use the source installer for a source plugin");
  }
  if (category === "theme") {
    if (!manifest.themeId) {
      throw new Error("Malformed theme: missing themeId");
    }
    const { error } = validateThemeTokens(manifest.tokens);
    if (error) throw new Error(`Malformed theme: ${error}`);
  }
  if (category === "integration" && !manifest.target) {
    throw new Error("Malformed integration: missing target");
  }
  // JSON gives us a number when the definition wrote `"version": 1`. The
  // manifest type says string, and a number here would compare unequal to a
  // stored "1" — so coerce rather than let the type lie.
  const version =
    manifest.version === undefined || manifest.version === null
      ? "1.0.0"
      : String(manifest.version);
  return { ...manifest, category, version };
}

/**
 * Fetch a source definition by its install url.
 *
 * Separate from `installPlugin` so the caller can validate before committing:
 * a registry is remote input, and a definition with no endpoints is a broken
 * install rather than a working one.
 */
export async function fetchPluginDefinition(
  installUrl: string
): Promise<SourcePlugin | null> {
  if (!installUrl) return null;
  const res = await fetch(installUrl);
  if (!res.ok) throw new Error(`Source download failed (${res.status})`);
  const plugin = (await res.json()) as SourcePlugin;
  if (!plugin || typeof plugin !== "object") return null;
  if (!plugin.id || !plugin.name || !plugin.baseUrl) {
    throw new Error("Malformed source: missing id, name or baseUrl");
  }
  // A source is fetchable if it declares endpoints itself OR names a theme
  // that supplies them. Madara sources carry no `endpoints` on purpose — the
  // shared engine provides every rule — so rejecting an empty `endpoints` here
  // made every themed source uninstallable.
  const themed = typeof plugin.theme === "string" && plugin.theme.length > 0;
  const hasEndpoints =
    !!plugin.endpoints && Object.keys(plugin.endpoints).length > 0;
  if (!themed && !hasEndpoints) {
    throw new Error(
      `"${plugin.name}" has no endpoints and no theme — nothing to fetch`
    );
  }
  if (themed && plugin.theme !== "madara") {
    throw new Error(`"${plugin.name}" uses unknown theme "${plugin.theme}"`);
  }
  return plugin;
}
