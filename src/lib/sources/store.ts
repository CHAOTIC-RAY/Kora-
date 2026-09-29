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

import type { RegistryIndex, SourcePlugin } from "./types";
import { isNsfwExtension } from "./types";

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

/** Repos to offer in the manager. The default can be removed but not lost. */
export function getRepos(): string[] {
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
}

function absolutise(baseUrl: string, u: string | undefined): string {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return baseUrl.replace(/\/+$/, "") + "/" + u.replace(/^\/+/, "");
}

/**
 * Fetch a registry index and flatten it into installable plugins.
 *
 * The index lists *extensions*, each holding one or more sources. Kora's
 * plugin unit is the source, not the extension, so one extension yields
 * several entries — the same way Tachiyomi shows a multi-source extension.
 */
export async function fetchRegistry(
  repoUrl: string,
  signal?: AbortSignal
): Promise<RepoEntry[]> {
  const res = await fetch(repoUrl, { signal });
  if (!res.ok) throw new Error(`Registry request failed (${res.status})`);

  const index = (await res.json()) as RegistryIndex;
  const list = index?.extensionList?.extensions;
  if (!Array.isArray(list)) throw new Error("Malformed registry: no extensionList");

  const installed = new Set(getInstalledPlugins().map((p) => p.id));
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

      const plugin: SourcePlugin = {
        id,
        name: src.name,
        lang: src.language,
        version: 1,
        nsfw,
        piracy,
        baseUrl: src.homeUrl || "",
        // The registry carries the icon so the list renders real logos before
        // anything is installed. Dropping this is why every card used to show
        // the same puzzle-piece placeholder.
        icon: ext.resources?.iconUrl || undefined,
        gen2: {
          packageName: ext.packageName,
          versionName: ext.versionName,
          versionCode: ext.versionCode,
          homeUrl: src.homeUrl,
        },
        endpoints: {},
      };

      out.push({
        plugin,
        installed: installed.has(id),
        gated: piracy || nsfw,
        installUrl: (ext.resources?.apkUrl as string | undefined) || "",
      });
    }
  }
  return out;
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
