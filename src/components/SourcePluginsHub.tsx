/**
 * Source Plugins — the Discover sub-tab that replaced Community.
 *
 * Lists sources from the configured registries, lets the user install,
 * remove and enable them, and add their own GitHub repo. Sources flagged
 * as piracy/adult are shown but stay switched off until the user turns
 * them on individually.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Puzzle, Download, Trash2, RefreshCw, Plus, ExternalLink, ShieldAlert, Loader2, Check } from "lucide-react";
import toast from "react-hot-toast";
import {
  DEFAULT_REPO,
  addRepo,
  fetchRegistry,
  getInstalledPlugins,
  getRepos,
  installPlugin,
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const all: RepoEntry[] = [];
    const seen = new Set<number>();
    for (const repo of getRepos()) {
      try {
        for (const e of await fetchRegistry(repo)) {
          // A user repo may list a source the default repo already has.
          if (seen.has(e.plugin.id)) continue;
          seen.add(e.plugin.id);
          all.push(e);
        }
      } catch (err) {
        // One unreachable repo must not blank out the whole list.
        console.warn("[sources] registry failed:", repo, err);
      }
    }
    setEntries(all);
    setRepos(getRepos());
    setInstalled(getInstalledPlugins());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("kora-sources-changed", onChange);
    return () => window.removeEventListener("kora-sources-changed", onChange);
  }, [load]);

  const handleInstall = (p: SourcePlugin) => {
    installPlugin(p);
    setInstalled(getInstalledPlugins());
    toast.success(`${p.name} installed`, { id: "src-install" });
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
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-kindle-border px-4 py-10 text-center text-xs text-kindle-text-muted">
          No sources found in the configured repositories.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {visible.map(({ plugin, installed: isInstalled }) => {
            const allowed = isSourceVisible(plugin);
            return (
              <div
                key={plugin.id}
                className="flex flex-col gap-2 rounded-2xl border border-kindle-border bg-kindle-card p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 shrink-0 rounded-xl border border-kindle-border bg-kindle-bg overflow-hidden flex items-center justify-center">
                    {plugin.icon ? (
                      <img src={plugin.icon} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Puzzle className="w-5 h-5 text-kindle-text-muted" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-kindle-text leading-tight line-clamp-2">
                      {plugin.name}
                    </p>
                    <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">
                      {plugin.lang}
                    </p>
                  </div>
                </div>

                {plugin.gen2?.homeUrl && (
                  <a
                    href={plugin.gen2.homeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono text-kindle-text-muted/70 hover:text-kindle-accent truncate"
                  >
                    {plugin.gen2.homeUrl.replace(/^https?:\/\//, "")}
                  </a>
                )}

                <div className="mt-auto flex items-center gap-1.5 pt-1">
                  {isInstalled ? (
                    <>
                      <button
                        onClick={() => handleUninstall(plugin)}
                        className="inline-flex items-center gap-1 rounded-lg border border-kindle-border px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-red-500 hover:border-red-500/40 transition"
                      >
                        <Trash2 className="w-3 h-3" /> Remove
                      </button>
                      {allowed ? (
                        <span className="ml-auto inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-emerald-600">
                          <Check className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <button
                          onClick={() => handleToggleAllow(plugin)}
                          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-amber-500/40 px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-amber-600 hover:bg-amber-500/10 transition"
                        >
                          <ShieldAlert className="w-3 h-3" /> Enable
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => handleInstall(plugin)}
                      className="inline-flex items-center gap-1 rounded-lg bg-kindle-text px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-bg hover:opacity-90 transition"
                    >
                      <Download className="w-3 h-3" /> Install
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Gated sources — visible but off until the user chooses. */}
      {gated.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
              {gated.length} restricted source{gated.length === 1 ? "" : "s"}
            </h3>
          </div>
          <p className="text-[11px] text-kindle-text-muted leading-relaxed">
            These point at shadow libraries or carry adult content. Nothing is fetched
            until you install and switch one on, and the choice is remembered per source.
          </p>
          <div className="flex flex-wrap gap-2">
            {gated.map(({ plugin }) => (
              <div
                key={plugin.id}
                className="inline-flex items-center gap-1.5 rounded-xl border border-kindle-border bg-kindle-card px-3 py-1.5"
              >
                <span className="text-[10px] font-bold text-kindle-text">{plugin.name}</span>
                <button
                  onClick={() => handleInstall(plugin)}
                  className="text-[9px] font-bold uppercase tracking-widest text-kindle-accent hover:opacity-70"
                >
                  Install
                </button>
              </div>
            ))}
          </div>
        </div>
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
