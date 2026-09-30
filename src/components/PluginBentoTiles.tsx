/**
 * Installed-plugin bento tiles for the Workshop.
 *
 * The plugin HUB lives in Discover and nowhere else — that is where plugins are
 * installed, enabled, disabled and removed. This is the other half: once a
 * non-source plugin IS installed, it stops being a registry row and becomes a
 * tile in the Workshop grid, styled exactly like the built-in Game Score
 * Tracker / Crossword / Personal Dictionary cards beside it. Tapping the tile
 * opens that plugin's own panel.
 *
 * Why tiles and not a second list: the hub answers "what can I install?", and
 * this answers "what do I have?". Rendering the registry here as well would put
 * install/remove next to use, which is the confusion this split exists to
 * remove.
 *
 * Which plugins qualify comes from `surfaceForCategory` in
 * `lib/sources/store.ts` — the same rule the tests assert — rather than a
 * hand-written list, so this grid and the placement tests can never disagree.
 * Sources are excluded by that rule: a source joins the Discover feed, it has
 * no panel to open.
 *
 * A plugin with no dedicated panel yet opens its detail sheet instead of
 * nothing, so every tile is honest about what tapping it will do.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  Info,
  Palette,
  Plug,
  Puzzle,
  Wrench,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import FluidOverlay from "./FluidOverlay";
import CalibreSettingsPanel from "./CalibreSettingsPanel";
import KindleSettingsPanel from "./KindleSettingsPanel";
import {
  getInstalledExtensions,
  isExtensionInstalled,
  surfaceForCategory,
} from "../lib/sources/store";
import {
  applyActiveThemePlugin,
  getActiveThemePluginId,
  setActiveThemePluginId,
  syncThemePluginMarker,
} from "../lib/sources/themeRuntime";
import type { PluginManifest } from "../lib/sources/types";

/** A tile can only be opened by something. `calibre` / `kindle` get their real
 *  settings panels; a theme gets apply/stop; anything else falls back to the
 *  detail sheet below. `null` would mean "dead tile", so it does not exist. */
type PanelKind = "calibre" | "kindle" | "theme" | "detail";

function panelFor(manifest: PluginManifest): PanelKind {
  if (manifest.category === "integration") {
    if (manifest.target === "calibre") return "calibre";
    if (manifest.target === "kindle") return "kindle";
  }
  if (manifest.category === "theme") return "theme";
  return "detail";
}

/** The lucide glyph for a category, used when the manifest carries no icon. */
function glyphFor(manifest: PluginManifest) {
  switch (manifest.category) {
    case "theme":
      return Palette;
    case "integration":
      return Plug;
    case "tool":
      return Wrench;
    default:
      return Puzzle;
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  theme: "Theme plugin",
  integration: "Integration",
  tool: "Tool",
};

/**
 * The bento card. The class string is the same one the Game Score Tracker,
 * Crossword Grid and Personal Dictionary cards use, so an installed plugin is
 * visually indistinguishable from a built-in tool — which is the point: it is
 * now a tool.
 */
function PluginBentoCard({
  manifest,
  onOpen,
}: {
  manifest: PluginManifest;
  onOpen: () => void;
}) {
  const Icon = glyphFor(manifest);
  const image = manifest.icon;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="bg-kindle-card border border-kindle-border hover:border-kindle-accent/40 rounded-2xl p-6 text-left transition duration-300 flex flex-col gap-4 items-start group cursor-pointer shadow-xs hover:shadow-md"
    >
      <div className="p-3.5 bg-kindle-bg border border-kindle-border text-kindle-accent rounded-xl shrink-0 group-hover:scale-105 transition-transform duration-300">
        {image ? (
          <img src={image} alt="" className="w-6 h-6 object-cover rounded" loading="lazy" />
        ) : (
          <Icon className="w-6 h-6" />
        )}
      </div>
      <div className="space-y-2 min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-bold tracking-tight text-kindle-text group-hover:text-kindle-accent transition">
            {manifest.name}
          </h4>
        </div>
        <p className="text-[10px] text-kindle-text-muted leading-relaxed">
          {manifest.description ||
            `An installed ${CATEGORY_LABEL[manifest.category] ?? "plugin"}.`}
        </p>
        <div className="text-[9px] font-bold uppercase tracking-wider text-kindle-accent flex items-center gap-1 mt-1 opacity-80 group-hover:opacity-100 group-hover:translate-x-1 transition">
          {panelFor(manifest) === "detail" ? "View details →" : `Launch ${manifest.name} →`}
        </div>
      </div>
    </button>
  );
}

/**
 * The fallback sheet: a plugin with no dedicated panel of its own still says
 * everything its manifest knows — what it is, who wrote it, what it needs —
 * rather than opening an empty surface.
 */
function PluginDetailSheet({
  manifest,
  onClose,
}: {
  manifest: PluginManifest;
  onClose: () => void;
}) {
  const Icon = glyphFor(manifest);
  return (
    <FluidOverlay open onClose={onClose} variant="sheet" panelClassName="max-w-xl p-6">
      <div className="flex items-start justify-between gap-3 border-b border-kindle-border pb-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-kindle-bg border border-kindle-border text-kindle-accent rounded-xl shrink-0">
            {manifest.icon ? (
              <img src={manifest.icon} alt="" className="w-5 h-5 object-cover rounded" loading="lazy" />
            ) : (
              <Icon className="w-5 h-5" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-lexend font-bold text-sm uppercase tracking-wider truncate">
              {manifest.name}
            </h3>
            <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">
              {CATEGORY_LABEL[manifest.category] ?? "Plugin"} · v{manifest.version}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-kindle-bg rounded-lg shrink-0" aria-label="Close">
          <X className="w-5 h-5 text-kindle-text" />
        </button>
      </div>

      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
        {manifest.description && (
          <p className="text-[11px] text-kindle-text-muted leading-relaxed">{manifest.description}</p>
        )}

        {manifest.availability === "unavailable" && manifest.availabilityNote && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[10px] leading-relaxed text-kindle-text-muted">
            {manifest.availabilityNote}
          </p>
        )}

        {manifest.author && (
          <p className="text-[10px] text-kindle-text-muted">
            By <span className="text-kindle-text font-semibold">{manifest.author}</span>
          </p>
        )}

        {manifest.requires && manifest.requires.length > 0 && (
          <p className="text-[10px] text-kindle-text-muted">
            Needs: {manifest.requires.join(", ")}
          </p>
        )}

        <p className="flex items-start gap-2 rounded-lg border border-kindle-border bg-kindle-bg/50 px-3 py-2 text-[10px] leading-relaxed text-kindle-text-muted">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          This plugin has no settings panel of its own yet. Manage it — install, pause or
          remove — from the Plugins hub in Discover.
        </p>

        {manifest.website && (
          <a
            href={manifest.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-kindle-accent hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Plugin homepage
          </a>
        )}
      </div>
    </FluidOverlay>
  );
}

/** Apply / stop a theme plugin. Same runtime the hub uses, so there is one
 *  definition of what "active theme plugin" means. */
function ThemePluginPanel({
  manifest,
  onClose,
}: {
  manifest: PluginManifest;
  onClose: () => void;
}) {
  // Seeded from the store, and only ever written by the two buttons below —
  // which are the only two things in the app that change it. The store stays
  // the source of the initial answer, so a stale local read is impossible:
  // there is nothing else to drift it.
  const [active, setActive] = useState(
    () => getActiveThemePluginId() === manifest.themeId
  );
  const isActive = active;
  // Same key App.tsx writes, and the same read-through-a-ref trick
  // PluginBrowser uses, so applying a theme here tells App.tsx's theme effect
  // to re-run exactly as it does from the hub.
  const displayTheme = (() => {
    try {
      return localStorage.getItem("kora_display_theme") || "theme-light-white";
    } catch {
      return "theme-light-white";
    }
  })();

  const apply = () => {
    setActiveThemePluginId(manifest.themeId ?? null);
    const applied = applyActiveThemePlugin(document);
    syncThemePluginMarker(applied.applied);
    window.dispatchEvent(new CustomEvent("kora:display-theme-changed", { detail: displayTheme }));
    if (applied.error) toast.error(applied.error);
    else toast.success(`${manifest.name} applied`);
    setActive(applied.applied === manifest.themeId);
  };

  const stop = () => {
    setActiveThemePluginId(null);
    applyActiveThemePlugin(document);
    syncThemePluginMarker(null);
    window.dispatchEvent(new CustomEvent("kora:display-theme-changed", { detail: displayTheme }));
    setActive(false);
  };

  return (
    <FluidOverlay open onClose={onClose} variant="sheet" panelClassName="max-w-xl p-6">
      <div className="flex items-center justify-between gap-3 border-b border-kindle-border pb-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-kindle-bg border border-kindle-border text-kindle-accent rounded-xl shrink-0">
            <Palette className="w-5 h-5" />
          </div>
          <h3 className="font-lexend font-bold text-sm uppercase tracking-wider truncate">
            {manifest.name}
          </h3>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-kindle-bg rounded-lg shrink-0" aria-label="Close">
          <X className="w-5 h-5 text-kindle-text" />
        </button>
      </div>

      <div className="space-y-4">
        <p className="text-[11px] text-kindle-text-muted leading-relaxed">
          {manifest.description || "A theme plugin. Applying it repaints the app with this palette."}
        </p>
        {isActive && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-accent">
            Active now
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={apply}
            className="inline-flex items-center gap-1.5 rounded-lg bg-kindle-accent px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-kindle-bg hover:opacity-90 transition"
          >
            <Palette className="w-3.5 h-3.5" /> {isActive ? "Re-apply" : "Apply theme"}
          </button>
          {isActive && (
            <button
              type="button"
              onClick={stop}
              className="inline-flex items-center gap-1.5 rounded-lg border border-kindle-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text transition"
            >
              Stop using
            </button>
          )}
        </div>
        <p className="text-[10px] text-kindle-text-muted leading-relaxed">
          To install or remove theme plugins, use the Plugins hub in Discover.
        </p>
      </div>
    </FluidOverlay>
  );
}

/**
 * The installed plugins that belong on this grid.
 *
 * Read through one function so the rule lives in exactly one place: the filter
 * is the placement rule from `lib/sources/store.ts`, not a hand-written list,
 * so this grid and the placement tests cannot disagree. Sources are excluded
 * twice over — the category check, and `surfaceForCategory` never returns
 * "workshop" for a source — because a source joins the Discover feed and has no
 * panel to open, so a tile for one would be a dead tile.
 */
function readInstalled(): PluginManifest[] {
  return getInstalledExtensions().filter(
    (m) => m.category !== "source" && surfaceForCategory(m.category) === "workshop"
  );
}

/**
 * The grid itself.
 *
 * Reads installed non-source plugins straight from the store and re-reads on
 * `kora-sources-changed`, so a plugin installed in Discover appears here on the
 * next visit to Workshop without a reload. Renders nothing at all when there
 * are no installed plugins — an empty "your plugins" heading is noise.
 *
 * The list is held in state rather than read during render, because the tab is
 * kept alive when it is not the active one: without this, a plugin installed
 * while Workshop was hidden would not appear until something else re-rendered
 * the whole view.
 *
 * `onModalToggle` mirrors the `showCrossword` / `showWordSearch` pattern: the
 * parent hides the tab bar while a panel is open, and it cannot see state that
 * lives in here, so this reports its own.
 */
export default function PluginBentoTiles({
  onModalToggle,
}: {
  onModalToggle?: (isOpen: boolean) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [installed, setInstalled] = useState<PluginManifest[]>(() => readInstalled());

  const refresh = useCallback(() => {
    setInstalled(readInstalled());
    // A plugin removed while its panel was open must not leave the panel up.
    setOpenId((cur) => (cur && !isExtensionInstalled(cur) ? null : cur));
  }, []);

  useEffect(() => {
    window.addEventListener("kora-sources-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("kora-sources-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    onModalToggle?.(openId !== null);
  }, [openId, onModalToggle]);

  // Never render a panel for a plugin that is gone: the panel bodies are
  // resolved from the live list, not from the id that was tapped.
  const open = installed.find((m) => m.id === openId) ?? null;

  if (installed.length === 0) return null;

  return (
    <>
      <section className="space-y-3">
        <div className="flex flex-col gap-0.5 border-b border-kindle-border pb-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-kindle-text flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-kindle-accent animate-pulse" />
            Your Plugins
          </h3>
          <p className="text-[10px] text-kindle-text-muted">
            Plugins you have installed. Open one to use it; manage them in the Plugins hub in
            Discover.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {installed.map((manifest) => (
            <PluginBentoCard
              key={manifest.id}
              manifest={manifest}
              onOpen={() => setOpenId(manifest.id)}
            />
          ))}
        </div>
      </section>

      {open && panelFor(open) === "calibre" && (
        <FluidOverlay open onClose={() => setOpenId(null)} variant="sheet" panelClassName="max-w-2xl p-6">
          <div className="flex items-center justify-between border-b border-kindle-border pb-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-kindle-bg border border-kindle-border text-kindle-accent rounded-xl shrink-0">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="font-lexend font-bold text-sm uppercase tracking-wider truncate">
                {open.name}
              </h3>
            </div>
            <button onClick={() => setOpenId(null)} className="p-1.5 hover:bg-kindle-bg rounded-lg shrink-0" aria-label="Close">
              <X className="w-5 h-5 text-kindle-text" />
            </button>
          </div>
          <div className="max-h-[75vh] overflow-y-auto pr-1">
            <CalibreSettingsPanel />
          </div>
        </FluidOverlay>
      )}

      {open && panelFor(open) === "kindle" && (
        <FluidOverlay open onClose={() => setOpenId(null)} variant="sheet" panelClassName="max-w-2xl p-6">
          <div className="flex items-center justify-between border-b border-kindle-border pb-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-kindle-bg border border-kindle-border text-kindle-accent rounded-xl shrink-0">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="font-lexend font-bold text-sm uppercase tracking-wider truncate">
                {open.name}
              </h3>
            </div>
            <button onClick={() => setOpenId(null)} className="p-1.5 hover:bg-kindle-bg rounded-lg shrink-0" aria-label="Close">
              <X className="w-5 h-5 text-kindle-text" />
            </button>
          </div>
          <div className="max-h-[75vh] overflow-y-auto pr-1">
            <KindleSettingsPanel />
          </div>
        </FluidOverlay>
      )}

      {open && panelFor(open) === "theme" && (
        <ThemePluginPanel manifest={open} onClose={() => setOpenId(null)} />
      )}

      {open && panelFor(open) === "detail" && (
        <PluginDetailSheet manifest={open} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}
