/**
 * Source Plugins — the Discover sub-tab that replaced Community.
 *
 * Lists sources from the configured registries, lets the user install,
 * remove and enable them, and add their own GitHub repo. Sources flagged
 * as piracy/adult are shown but stay switched off until the user turns
 * them on individually.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Puzzle, Download, Trash2, RefreshCw, Plus, ExternalLink, ShieldAlert, Loader2, Check, Info } from "lucide-react";
import { SourceDetail } from "./SourceDetailSheet";
import toast from "react-hot-toast";
import {
  DEFAULT_REPO,
  addRepo,
  fetchRegistry,
  getInstalledPlugins,
  getRepos,
  installPlugin,
  fetchPluginDefinition,
  isSourceVisible,
  removeRepo,
  setSourceOptIn,
  uninstallPlugin,
  type RepoEntry,
} from "../lib/sources/store";
import type { SourcePlugin } from "../lib/sources/types";

export default function SourcePluginsHub() {
  const [entries, setEntries] = useState<RepoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repoInput, setRepoInput] = useState("");
  const [repos, setRepos] = useState<string[]>([]);
  const [installed, setInstalled] = useState<SourcePlugin[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);

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
      toast.error(`${e.plugin.name}: this registry lists the source but does not say where to download it`, {
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

  const visible = entries.filter((e) => isSourceVisible(e.plugin) || e.installed);
  const gated = entries.filter((e) => e.gated && !e.installed && !isSourceVisible(e.plugin));
  const detailEntry = detailId ? entries.find((e) => e.plugin.id === detailId) : undefined;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-kindle-border bg-gradient-to-br from-kindle-card to-kindle-bg p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 max-w-xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-kindle-accent/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-kindle-accent">
              <Puzzle className="w-3.5 h-3.5" /> Source Plugins
            </span>
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-kindle-text">
              Bring your own <span className="italic text-kindle-accent">sources</span>
            </h2>
            <p className="text-sm text-kindle-text-muted leading-relaxed">
              Installed sources are searched alongside books, so their results appear
              in the same Discover feed. Each source is just a set of rules for reading
              a website — nothing is compiled or executed.
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
          <Loader2 className="w-4 h-4 animate-spin" /> Loading sources
        </div>
      ) : visible.length === 0 && gated.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-kindle-border px-4 py-10 text-center text-xs text-kindle-text-muted">
          No sources found in the configured repositories.
        </p>
      ) : (
        <>
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
        </>
      )}

      {detailEntry && (
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

      {installed.length > 0 && (
        <p className="text-[10px] text-kindle-text-muted/70 font-mono text-center pt-2">
          {installed.length} source{installed.length === 1 ? "" : "s"} installed ·{" "}
          {installed.filter((p) => isSourceVisible(p)).length} active
        </p>
      )}
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
function SourceCard({
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
