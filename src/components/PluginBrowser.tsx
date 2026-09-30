/**
 * PluginBrowser — the one plugin list, rendered with a category filter.
 *
 * Plugins are data, and there are three kinds of them, and each kind belongs
 * in a different place in the app:
 *
 *  - a **source** is rules for scraping a site, and lives in Discover, next to
 *    the feed it feeds. It is the ONLY category gated behind the
 *    piracy/adult opt-in;
 *  - a **theme** is a CSS token set that repaints the app, and lives in
 *    Settings, next to the built-in theme swatches it overrides;
 *  - an **integration** bridges to another app (Calibre, Send to Kindle) and is
 *    configured in-app, so it lives in Workshop.
 *
 * All three share one install pipeline, one registry list, one Details sheet
 * and one set of cards, so they share one component. The placement rule lives
 * in `store.ts` (`surfaceForCategory` / `categoriesForSurface`) and is
 * asserted by `__tests__/pluginPlacement.test.ts` — this file only renders
 * whatever categories it is handed.
 *
 * SourcePluginsHub (Discover) delegates here with
 * `categoriesForSurface("discover")`; Workshop and Settings each render it with
 * their own filter, read from the same rule. Nothing is duplicated, and
 * nothing is reachable from two places at once.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Puzzle,
  Download,
  Trash2,
  RefreshCw,
  Plus,
  ExternalLink,
  ShieldAlert,
  Loader2,
  Check,
  Info,
  Palette,
  Plug,
  Sliders,
  AlertTriangle,
} from "lucide-react";
import { SourceDetail } from "./SourceDetailSheet";
import CalibreSettingsPanel from "./CalibreSettingsPanel";
import KindleSettingsPanel from "./KindleSettingsPanel";
import toast from "react-hot-toast";
import {
  DEFAULT_REPO,
  addRepo,
  fetchRegistry,
  fetchExtensionDefinition,
  getInstalledExtensions,
  getInstalledPlugins,
  getRepos,
  installExtension,
  installPlugin,
  fetchPluginDefinition,
  isSourceVisible,
  removeRepo,
  setSourceOptIn,
  uninstallExtension,
  uninstallPlugin,
  type RepoEntry,
} from "../lib/sources/store";
import {
  applyActiveThemePlugin,
  getActiveThemePluginId,
  setActiveThemePluginId,
  syncThemePluginMarker,
  validateThemeTokens,
} from "../lib/sources/themeRuntime";
import type {
  IntegrationTarget,
  PluginCategory,
  PluginManifest,
  SourcePlugin,
} from "../lib/sources/types";

export interface PluginBrowserProps {
  /**
   * Which plugin categories to list. The placement rule decides this — see
   * `surfaceForCategory` in `lib/sources/store.ts`.
   */
  categories: PluginCategory[];
  /** Small caption on the header pill. */
  badge?: string;
  /** Sentence under the header explaining what this surface is for. */
  intro?: string;
}

export default function PluginBrowser({
  categories,
  badge = "Plugins",
  intro,
}: PluginBrowserProps) {
  const [entries, setEntries] = useState<RepoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repoInput, setRepoInput] = useState("");
  const [repos, setRepos] = useState<string[]>([]);
  const [installed, setInstalled] = useState<SourcePlugin[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  /** Installed themes + integrations, held separately from sources. */
  const [extensions, setExtensions] = useState<PluginManifest[]>([]);
  const [activeThemeId, setActiveThemeId] = useState<string | null>(() => getActiveThemePluginId());
  /** Which settings panel is open, keyed by integration target. */
  const [settingsFor, setSettingsFor] = useState<IntegrationTarget | null>(null);

  // App.tsx owns `displayTheme`; the browser re-dispatches its change event when
  // a theme plugin is applied so that effect re-runs. Read through a ref so the
  // handlers stay stable and do not need `displayTheme` in their dep arrays.
  const displayThemeRef = useRef<string>(
    (() => {
      try {
        return localStorage.getItem("kora_display_theme") || "theme-light-white";
      } catch {
        return "theme-light-white";
      }
    })()
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const all: RepoEntry[] = [];
    const seen = new Set<string>();
    const failed: string[] = [];
    for (const repo of getRepos()) {
      try {
        for (const e of await fetchRegistry(repo)) {
          // A user repo may list a source the default repo already has.
          if (seen.has(e.plugin.id)) continue;
          seen.add(e.plugin.id);
          all.push(e);
        }
      } catch (err) {
        // One unreachable repo must not blank out the whole list, but it must
        // not vanish silently either: a failed fetch and an empty registry
        // look identical otherwise, and the user is left with no way to tell
        // a broken url from a genuinely empty one.
        console.warn("[sources] registry failed:", repo, err);
        failed.push(`${repo} — ${err instanceof Error ? err.message : "unreachable"}`);
      }
    }
    setEntries(all);
    setRepos(getRepos());
    setInstalled(getInstalledPlugins());
    setExtensions(getInstalledExtensions());
    setError(failed.length ? failed.join(" · ") : null);
    setLoading(false);
  }, []);

  // Escape closes the detail sheet, matching every other overlay in the app.
  useEffect(() => {
    if (!detailId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetailId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailId]);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("kora-sources-changed", onChange);
    return () => window.removeEventListener("kora-sources-changed", onChange);
  }, [load]);

  const [installingId, setInstallingId] = useState<string | null>(null);

  /**
   * Installing is two steps: the registry entry is only metadata, so the real
   * definition is fetched from its install url and validated before it is
   * stored. Storing the registry stub would install a source with no
   * selectors — it would show up in Discover and then return nothing.
   */
  const handleInstall = async (e: RepoEntry) => {
    if (!e.installUrl) {
      toast.error(`${e.plugin.name}: this registry lists the plugin but does not say where to download it`, {
        id: "src-install",
      });
      return;
    }
    setInstallingId(e.plugin.id);
    try {
      const def = await fetchPluginDefinition(e.installUrl);
      if (!def) throw new Error("empty response");
      installPlugin(def);
      // Installing is the opt-in. A separate Enable step meant a source
      // could sit installed but invisible, with no chip in Discover.
      if (def.piracy || def.nsfw) setSourceOptIn(def.id, true);
      setInstalled(getInstalledPlugins());
      toast.success(`${def.name} installed`, { id: "src-install" });
    } catch (err) {
      toast.error(
        `Could not install ${e.plugin.name}: ${err instanceof Error ? err.message : "unknown error"}`,
        { id: "src-install" }
      );
    } finally {
      setInstallingId(null);
    }
  };

  const handleUninstall = (p: SourcePlugin) => {
    uninstallPlugin(p.id);
    setSourceOptIn(p.id, false);
    setInstalled(getInstalledPlugins());
    toast(`${p.name} removed`, { id: "src-uninstall" });
  };

  /**
   * Installing a theme or an integration is a different path from a source:
   * the definition is validated with the non-source rules and stored in the
   * extension store, not the source store. A theme then becomes the active
   * theme immediately — installing it without applying it would be a no-op
   * the user cannot tell apart from a failure.
   */
  const handleInstallExtension = async (e: RepoEntry) => {
    if (!e.installUrl) {
      toast.error(`${e.plugin.name}: this registry lists the plugin but not where to download it`, {
        id: "src-install",
      });
      return;
    }
    setInstallingId(e.plugin.id);
    try {
      const manifest = await fetchExtensionDefinition(e.installUrl);
      if (!manifest) throw new Error("empty response");
      if (!installExtension(manifest)) {
        throw new Error("already installed, or it failed validation");
      }
      if (manifest.category === "theme" && manifest.themeId) {
        setActiveThemePluginId(manifest.themeId);
        const applied = applyActiveThemePlugin(document);
        syncThemePluginMarker(applied.applied);
        window.dispatchEvent(
          new CustomEvent("kora:display-theme-changed", { detail: displayThemeRef.current })
        );
        toast.success(`${manifest.name} installed and applied`, { id: "src-install" });
      } else {
        toast.success(`${manifest.name} installed`, { id: "src-install" });
      }
      setExtensions(getInstalledExtensions());
    } catch (err) {
      toast.error(
        `Could not install ${e.plugin.name}: ${err instanceof Error ? err.message : "unknown error"}`,
        { id: "src-install" }
      );
    } finally {
      setInstallingId(null);
    }
  };

  const handleUninstallExtension = (manifest: PluginManifest) => {
    // Removing the theme you are currently looking at has to also clear it,
    // otherwise the app stays painted in a theme with no plugin behind it.
    if (manifest.category === "theme" && getActiveThemePluginId() === manifest.themeId) {
      setActiveThemePluginId(null);
      applyActiveThemePlugin(document);
      syncThemePluginMarker(null);
      window.dispatchEvent(
        new CustomEvent("kora:display-theme-changed", { detail: displayThemeRef.current })
      );
    }
    uninstallExtension(manifest.id);
    setExtensions(getInstalledExtensions());
    toast(`${manifest.name} removed`, { id: "src-uninstall" });
  };

  /** Re-apply a theme plugin that is already installed. */
  const handleApplyTheme = (manifest: PluginManifest) => {
    if (!manifest.themeId) return;
    setActiveThemePluginId(manifest.themeId);
    const applied = applyActiveThemePlugin(document);
    syncThemePluginMarker(applied.applied);
    window.dispatchEvent(
      new CustomEvent("kora:display-theme-changed", { detail: displayThemeRef.current })
    );
    setActiveThemeId(getActiveThemePluginId());
    toast.success(`${manifest.name} applied`, { id: "src-apply" });
  };

  const handleClearTheme = () => {
    setActiveThemePluginId(null);
    applyActiveThemePlugin(document);
    syncThemePluginMarker(null);
    setActiveThemeId(null);
    window.dispatchEvent(
      new CustomEvent("kora:display-theme-changed", { detail: displayThemeRef.current })
    );
  };

  const handleAddRepo = () => {
    const url = repoInput.trim();
    if (!url) return;
    if (!addRepo(url)) {
      toast.error("That does not look like a repository URL", { id: "src-repo" });
      return;
    }
    setRepoInput("");
    toast.success("Repository added", { id: "src-repo" });
    load();
  };

  const handleToggleAllow = (p: SourcePlugin) => {
    const allow = !isSourceVisible(p);
    setSourceOptIn(p.id, allow);
    setInstalled(getInstalledPlugins());
    setEntries((prev) =>
      prev.map((e) => (e.plugin.id === p.id ? { ...e, plugin: { ...p } } : e))
    );
  };

  // ── Grouping ──────────────────────────────────────────────────────────
  // Everything is narrowed to the categories this surface owns first, so a
  // source can never leak into Workshop and a theme can never leak into
  // Discover. The placement rule is asserted in the tests, not here.
  const wanted = useMemo(() => new Set(categories), [categories]);
  const shown = useMemo(
    () => entries.filter((e) => wanted.has(e.category)),
    [entries, wanted]
  );

  // Sources keep the visible/gated split. Themes and integrations are never
  // gated: the piracy opt-in is a statement about where books come from, and a
  // colour scheme or a bridge to your own Calibre server has no bearing on
  // that. Gating them would be both wrong and, worse, a way to pressure the
  // user into opting in.
  const sourceEntries = useMemo(
    () => shown.filter((e) => e.category === "source"),
    [shown]
  );
  const visible = useMemo(
    () => sourceEntries.filter((e) => isSourceVisible(e.plugin) || e.installed),
    [sourceEntries]
  );
  const gated = useMemo(
    () => sourceEntries.filter((e) => e.gated && !e.installed && !isSourceVisible(e.plugin)),
    [sourceEntries]
  );
  const themeEntries = useMemo(
    () => shown.filter((e) => e.category === "theme"),
    [shown]
  );
  const integrationEntries = useMemo(
    () => shown.filter((e) => e.category === "integration"),
    [shown]
  );
  const otherEntries = useMemo(
    () => shown.filter((e) => e.category === "tool"),
    [shown]
  );

  // A registry entry is only as good as its manifest. A theme whose tokens
  // would not render is dropped here rather than shown as installable, because
  // installing it would fail validation with no way for the user to tell why.
  const renderableThemes = useMemo(
    () =>
      themeEntries.filter(
        (e) => !!e.manifest?.themeId && !validateThemeTokens(e.manifest?.tokens).error
      ),
    [themeEntries]
  );

  const detailEntry = detailId ? entries.find((e) => e.plugin.id === detailId) : undefined;
  const nothingAtAll = shown.length === 0;

  const installedThemes = extensions.filter((e) => e.category === "theme").length;
  const installedIntegrations = extensions.filter((e) => e.category === "integration").length;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-kindle-border bg-gradient-to-br from-kindle-card to-kindle-bg p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 max-w-xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-kindle-accent/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-kindle-accent">
              <Puzzle className="w-3.5 h-3.5" /> {badge}
            </span>
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-kindle-text">
              Bring your own <span className="italic text-kindle-accent">plugins</span>
            </h2>
            <p className="text-sm text-kindle-text-muted leading-relaxed">
              {intro ??
                "Every plugin is a set of data — nothing is compiled or executed."}
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-xl border border-kindle-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text hover:border-kindle-accent/50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Repositories */}
      <div className="rounded-2xl border border-kindle-border bg-kindle-card/40 p-4 sm:p-5 space-y-3">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
          Repositories
        </h3>
        <div className="space-y-1.5">
          {repos.map((r) => (
            <div key={r} className="flex items-center justify-between gap-3 text-[11px] font-mono text-kindle-text-muted">
              <a
                href={r}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate hover:text-kindle-accent inline-flex items-center gap-1"
              >
                {r} <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
              {r !== DEFAULT_REPO && (
                <button
                  onClick={() => {
                    removeRepo(r);
                    load();
                  }}
                  className="shrink-0 text-kindle-text-muted hover:text-red-500 transition"
                  title="Remove repository"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <input
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddRepo()}
            placeholder="https://github.com/you/kora-sources"
            className="min-w-0 flex-1 rounded-xl border border-kindle-border bg-kindle-bg px-3 py-2 text-[11px] font-mono text-kindle-text placeholder:text-kindle-text-muted/50 focus:border-kindle-accent/50 outline-none"
          />
          <button
            onClick={handleAddRepo}
            className="inline-flex items-center gap-1.5 rounded-xl bg-kindle-text px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-kindle-bg hover:opacity-90 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Add repo
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-xs text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs uppercase tracking-widest text-kindle-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading plugins
        </div>
      ) : nothingAtAll ? (
        <p className="rounded-2xl border border-dashed border-kindle-border px-4 py-10 text-center text-xs text-kindle-text-muted">
          No plugins found in the configured repositories.
        </p>
      ) : (
        <>
          {/* ── Sources ────────────────────────────────────────────────── */}
          {(visible.length > 0 || gated.length > 0) && (
            <PluginGroup
              icon={<Puzzle className="w-3.5 h-3.5" />}
              title="Sources"
              blurb="Rules for reading a website. Installed sources are searched alongside books, so their results appear in the same Discover feed."
            >
              {visible.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {visible.map((entry) => {
                    const { plugin, installed: isInstalled } = entry;
                    const allowed = isSourceVisible(plugin);
                    return (
                      <SourceCard
                        key={plugin.id}
                        entry={entry}
                        installed={isInstalled}
                        allowed={allowed}
                        busy={installingId === plugin.id}
                        onOpen={() => setDetailId(plugin.id)}
                        onInstall={() => handleInstall(entry)}
                        onUninstall={() => handleUninstall(plugin)}
                        onToggleAllow={() => handleToggleAllow(plugin)}
                      />
                    );
                  })}
                </div>
              )}

              {/* Restricted sources are full cards, not a footnote row. Burying
                  them as plain buttons made them look like ordinary sources while
                  hiding the one fact that matters about them. */}
              {gated.length > 0 && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                      {gated.length} restricted source{gated.length === 1 ? "" : "s"}
                    </h3>
                  </div>
                  <p className="text-[11px] text-kindle-text-muted leading-relaxed">
                    These point at shadow libraries or carry adult content. Nothing is
                    fetched until you install and switch one on, and the choice is
                    remembered per source.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {gated.map((entry) => (
                      <SourceCard
                        key={entry.plugin.id}
                        entry={entry}
                        installed={false}
                        allowed={false}
                        restricted
                        busy={installingId === entry.plugin.id}
                        onOpen={() => setDetailId(entry.plugin.id)}
                        onInstall={() => handleInstall(entry)}
                        onUninstall={() => handleUninstall(entry.plugin)}
                        onToggleAllow={() => handleToggleAllow(entry.plugin)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </PluginGroup>
          )}

          {/* ── Themes ─────────────────────────────────────────────────── */}
          {renderableThemes.length > 0 && (
            <PluginGroup
              icon={<Palette className="w-3.5 h-3.5" />}
              title="Themes"
              blurb="A theme is a set of colours. Applying one repaints the whole app; switching back to a built-in theme is always one tap away."
            >
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {renderableThemes.map((entry) => {
                  const manifest = entry.manifest!;
                  const isActive = activeThemeId === manifest.themeId;
                  return (
                    <ThemeCard
                      key={entry.plugin.id}
                      entry={entry}
                      manifest={manifest}
                      installed={entry.installed}
                      active={isActive}
                      busy={installingId === entry.plugin.id}
                      onInstall={() => handleInstallExtension(entry)}
                      onApply={() => handleApplyTheme(manifest)}
                      onClear={handleClearTheme}
                      onUninstall={() => handleUninstallExtension(manifest)}
                    />
                  );
                })}
              </div>
            </PluginGroup>
          )}

          {/* ── Integrations ───────────────────────────────────────────── */}
          {integrationEntries.length > 0 && (
            <PluginGroup
              icon={<Plug className="w-3.5 h-3.5" />}
              title="Integrations"
              blurb="Bridge to another app you already use. Credentials are entered by you, stored on this device, and sent only to the server you name."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {integrationEntries.map((entry) => {
                  const manifest = entry.manifest;
                  if (!manifest?.target) return null;
                  return (
                    <IntegrationCard
                      key={entry.plugin.id}
                      entry={entry}
                      manifest={manifest}
                      installed={entry.installed}
                      settingsOpen={settingsFor === manifest.target}
                      busy={installingId === entry.plugin.id}
                      onInstall={() => handleInstallExtension(entry)}
                      onUninstall={() => handleUninstallExtension(manifest)}
                      onToggleSettings={() =>
                        setSettingsFor((cur) => (cur === manifest.target ? null : manifest.target))
                      }
                    />
                  );
                })}
              </div>

              {settingsFor && (
                <div className="rounded-2xl border border-kindle-border bg-kindle-card/50 p-4 sm:p-5">
                  {settingsFor === "calibre" ? (
                    <CalibreSettingsPanel />
                  ) : (
                    <KindleSettingsPanel />
                  )}
                </div>
              )}
            </PluginGroup>
          )}

          {otherEntries.length > 0 && (
            <PluginGroup
              icon={<Sliders className="w-3.5 h-3.5" />}
              title="Tools"
              blurb="Miscellaneous plugins."
            >
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {otherEntries.map((entry) => (
                  <SourceCard
                    key={entry.plugin.id}
                    entry={entry}
                    installed={entry.installed}
                    allowed
                    busy={installingId === entry.plugin.id}
                    onOpen={() => setDetailId(entry.plugin.id)}
                    onInstall={() => handleInstallExtension(entry)}
                    onUninstall={() => {
                      if (entry.manifest) handleUninstallExtension(entry.manifest);
                    }}
                    onToggleAllow={() => {}}
                  />
                ))}
              </div>
            </PluginGroup>
          )}
        </>
      )}

      {detailEntry && detailEntry.category === "source" && (
        <SourceDetail
          plugin={detailEntry.plugin}
          installed={detailEntry.installed}
          active={isSourceVisible(detailEntry.plugin)}
          busy={installingId === detailEntry.plugin.id}
          onInstall={() => handleInstall(detailEntry)}
          onUninstall={() => handleUninstall(detailEntry.plugin)}
          onToggleAllow={() => handleToggleAllow(detailEntry.plugin)}
          onClose={() => setDetailId(null)}
        />
      )}

      {(installed.length > 0 || extensions.length > 0) && (
        <p className="text-[10px] text-kindle-text-muted/70 font-mono text-center pt-2">
          {installed.length} source{installed.length === 1 ? "" : "s"} ·{" "}
          {installedThemes} theme{installedThemes === 1 ? "" : "s"} ·{" "}
          {installedIntegrations} integration{installedIntegrations === 1 ? "" : "s"} installed
        </p>
      )}
    </div>
  );
}

/** A titled section, so the categories read as separate things. */
export function PluginGroup({
  icon,
  title,
  blurb,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
          <span className="text-kindle-accent">{icon}</span>
          {title}
        </h3>
        <p className="mt-1 text-[11px] text-kindle-text-muted/80 leading-relaxed">{blurb}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * A theme card.
 *
 * Shows a real preview built from the theme's own tokens, so what you see in
 * the grid is what applying it gives you — not a generic placeholder.
 */
export function ThemeCard({
  entry,
  manifest,
  installed,
  active,
  busy,
  onInstall,
  onApply,
  onClear,
  onUninstall,
}: {
  entry: RepoEntry;
  manifest: PluginManifest;
  installed: boolean;
  active: boolean;
  busy?: boolean;
  onInstall: () => void;
  onApply: () => void;
  onClear: () => void;
  onUninstall: () => void;
}) {
  const { tokens } = validateThemeTokens(manifest.tokens);
  const icon = entry.plugin.icon || manifest.icon;
  return (
    <div
      className={`flex flex-col gap-2 rounded-2xl border p-4 transition ${
        active ? "border-kindle-accent ring-2 ring-kindle-accent/30" : "border-kindle-border bg-kindle-card"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 shrink-0 rounded-xl border border-kindle-border overflow-hidden flex items-center justify-center">
          {icon ? (
            <img src={icon} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <Palette className="w-5 h-5 text-kindle-text-muted" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-kindle-text leading-tight line-clamp-2">
            {manifest.name}
          </p>
          <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">
            {manifest.dark ? "Dark" : "Light"} theme
          </p>
          {active && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-kindle-accent/50 bg-kindle-accent/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-kindle-accent">
              <Check className="w-2.5 h-2.5" /> Active
            </span>
          )}
        </div>
      </div>

      {/* Live preview, painted with the theme's own tokens. */}
      {tokens && (
        <div
          className="mt-1 rounded-lg border p-2.5"
          style={{
            backgroundColor: tokens.bg,
            borderColor: tokens.border,
          }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: tokens.accent }}
            />
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tokens.card }} />
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: tokens.textMuted }}
            />
          </div>
          <p className="mt-1.5 text-[10px] leading-tight" style={{ color: tokens.text }}>
            {manifest.description || "A theme plugin."}
          </p>
        </div>
      )}

      <div className="mt-auto flex items-center gap-1.5 pt-1">
        {!installed ? (
          <button
            onClick={onInstall}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-kindle-text px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-bg hover:opacity-90 transition disabled:opacity-50"
          >
            <Download className="w-3 h-3" /> {busy ? "Installing…" : "Install"}
          </button>
        ) : active ? (
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-lg border border-kindle-border px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text transition"
          >
            Stop using
          </button>
        ) : (
          <button
            onClick={onApply}
            className="inline-flex items-center gap-1 rounded-lg bg-kindle-accent px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-bg hover:opacity-90 transition"
          >
            <Palette className="w-3 h-3" /> Apply
          </button>
        )}

        {installed && (
          <button
            onClick={onUninstall}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-kindle-border px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-red-500 hover:border-red-500/40 transition"
          >
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * An integration card.
 *
 * When the plugin declares `availability: "unavailable"`, the card says so in
 * place of a working action. It still installs — the settings surface and the
 * honest explanation are the deliverable — but it never shows a control that
 * would imply an upload is possible.
 */
export function IntegrationCard({
  entry,
  manifest,
  installed,
  settingsOpen,
  busy,
  onInstall,
  onUninstall,
  onToggleSettings,
}: {
  entry: RepoEntry;
  manifest: PluginManifest;
  installed: boolean;
  settingsOpen: boolean;
  busy?: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onToggleSettings: () => void;
}) {
  const unavailable = manifest.availability === "unavailable";
  const icon = entry.plugin.icon || manifest.icon;
  return (
    <div
      className={`flex flex-col gap-2 rounded-2xl border p-4 transition ${
        unavailable
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-kindle-border bg-kindle-card"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 shrink-0 rounded-xl border border-kindle-border overflow-hidden flex items-center justify-center">
          {icon ? (
            <img src={icon} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <Plug className="w-5 h-5 text-kindle-text-muted" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-kindle-text leading-tight line-clamp-2">
            {manifest.name}
          </p>
          <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">
            {manifest.target === "calibre" ? "Calibre library" : "Amazon Kindle"}
          </p>
          {unavailable && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-amber-700">
              <AlertTriangle className="w-2.5 h-2.5" /> Not available
            </span>
          )}
        </div>
      </div>

      <p className="text-[11px] text-kindle-text-muted leading-relaxed">
        {manifest.description}
      </p>

      {unavailable && manifest.availabilityNote && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[10px] leading-relaxed text-kindle-text-muted">
          {manifest.availabilityNote}
        </p>
      )}

      <div className="mt-auto flex items-center gap-1.5 pt-1">
        {!installed ? (
          <button
            onClick={onInstall}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-kindle-text px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-bg hover:opacity-90 transition disabled:opacity-50"
          >
            <Download className="w-3 h-3" /> {busy ? "Installing…" : "Install"}
          </button>
        ) : (
          <button
            onClick={onToggleSettings}
            className="inline-flex items-center gap-1 rounded-lg bg-kindle-text px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-bg hover:opacity-90 transition"
          >
            <Sliders className="w-3 h-3" /> {settingsOpen ? "Hide settings" : "Settings"}
          </button>
        )}

        {installed && (
          <button
            onClick={onUninstall}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-kindle-border px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-red-500 hover:border-red-500/40 transition"
          >
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * One source card.
 *
 * A restricted source uses the same card as any other but carries a visible
 * label and an amber edge. Burying them in a separate strip of plain buttons
 * made a shadow library look exactly like Open Library.
 */
export function SourceCard({
  entry,
  installed,
  allowed,
  restricted,
  busy,
  onOpen,
  onInstall,
  onUninstall,
  onToggleAllow,
}: {
  entry: RepoEntry;
  installed: boolean;
  allowed: boolean;
  restricted?: boolean;
  busy?: boolean;
  onOpen: () => void;
  onInstall: () => void;
  onUninstall: () => void;
  onToggleAllow: () => void;
}) {
  const { plugin } = entry;
  const gated = restricted ?? (plugin.piracy || plugin.nsfw);
  const host = (plugin.gen2?.homeUrl || plugin.baseUrl || "").replace(
    /^https?:\/\//,
    ""
  );

  return (
    <div
      className={`flex flex-col gap-2 rounded-2xl border p-4 transition ${
        gated
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-kindle-border bg-kindle-card"
      }`}
    >
      <button
        onClick={onOpen}
        className="text-left w-full"
        aria-label={`${plugin.name} details`}
      >
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 shrink-0 rounded-xl border border-kindle-border bg-kindle-bg overflow-hidden flex items-center justify-center">
            {plugin.icon ? (
              <img
                src={plugin.icon}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  const img = e.currentTarget;
                  img.style.display = "none";
                  img.nextElementSibling?.classList.remove("hidden");
                }}
              />
            ) : null}
            <Puzzle
              className={`w-5 h-5 text-kindle-text-muted ${plugin.icon ? "hidden" : ""}`}
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-kindle-text leading-tight line-clamp-2">
              {plugin.name}
            </p>
            <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">
              {plugin.lang}
            </p>
            {gated && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-amber-700">
                <ShieldAlert className="w-2.5 h-2.5" />
                {plugin.piracy ? "Shadow library" : "Adult"}
              </span>
            )}
          </div>
        </div>

        {host && (
          <p className="mt-2 text-[10px] font-mono text-kindle-text-muted/70 truncate">
            {host}
          </p>
        )}
      </button>

      <div className="mt-auto flex items-center gap-1.5 pt-1">
        {installed ? (
          /* No enable/disable toggle: installing a source opts you in, and
             the only way to take it back out is Remove. A second control
             that could switch a source off without uninstalling was pure
             duplication. */
          <button
            onClick={onUninstall}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-kindle-border px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-red-500 hover:border-red-500/40 transition"
          >
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        ) : (
          <button
            onClick={onInstall}
            disabled={busy}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest transition disabled:opacity-50 ${
              gated
                ? "bg-amber-600 text-white hover:opacity-90"
                : "bg-kindle-text text-kindle-bg hover:opacity-90"
            }`}
          >
            <Download className="w-3 h-3" />
            {busy ? "Installing…" : "Install"}
          </button>
        )}

        <button
          onClick={onOpen}
          aria-label={`About ${plugin.name}`}
          title="Details"
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-kindle-border px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted hover:border-kindle-accent/50 hover:text-kindle-accent transition"
        >
          <Info className="w-3 h-3" /> Details
        </button>
      </div>
    </div>
  );
}
