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
 * THEMES ARE NOT HERE, by product decision. They used to render in this grid
 * and were removed: a theme is chosen once in the plugin hub and then just *is*
 * the app's look, so a second copy of it in Workshop read as a duplicate rather
 * than an action. `WORKSHOP_TILE_CATEGORIES` below is the explicit filter, and
 * it is deliberately narrower than "every non-source category" — do not
 * "restore consistency" by making this equal `surfaceForCategory` again. Themes
 * stay visible in the plugin hub (Discover), where they are installed, applied
 * and removed; that surface still lists every category on purpose.
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
import CrocPanel from "./CrocPanel";
import KindleSettingsPanel from "./KindleSettingsPanel";
import {
  getInstalledExtensions,
  isExtensionInstalled,
} from "../lib/sources/store";
import { pluginDisplayName } from "../lib/sources/koboKindleSender";
import type { PluginCategory, PluginManifest } from "../lib/sources/types";

/**
 * Which categories get a tile in the Workshop grid.
 *
 * Integrations and tools only. Themes are managed in the plugin hub (Discover)
 * — see the header for why they are not repeated here. This is deliberately a
 * narrower list than `categoriesForSurface("workshop")`; `surfaceForCategory`
 * still maps `theme -> workshop` because that mapping is the placement
 * contract asserted in `__tests__/pluginPlacement.test.ts`, and that file is
 * owned by another change. The grid filter is local and does not move that
 * mapping.
 */
export const WORKSHOP_TILE_CATEGORIES: readonly PluginCategory[] = ["integration", "tool"];

/** Whether this manifest gets a Workshop tile. Pure, so it is directly testable. */
export function isWorkshopTile(manifest: Pick<PluginManifest, "category">): boolean {
  return WORKSHOP_TILE_CATEGORIES.includes(manifest.category);
}

/** A tile can only be opened by something. `calibre` / `kindle` / `croc` get their
 *  real settings panels; anything else falls back to the detail sheet below.
 *  `null` would mean "dead tile", so it does not exist. No `theme` kind: theme
 *  tiles no longer render here at all (see `WORKSHOP_TILE_CATEGORIES`). */
type PanelKind = "calibre" | "kindle" | "croc" | "detail";

function panelFor(manifest: PluginManifest): PanelKind {
  if (manifest.category === "integration") {
    if (manifest.target === "calibre") return "calibre";
    if (manifest.target === "kindle") return "kindle";
    if (manifest.target === "croc") return "croc";
  }
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
            {pluginDisplayName(manifest)}
          </h4>
        </div>
        <p className="text-[10px] text-kindle-text-muted leading-relaxed">
          {manifest.description ||
            `An installed ${CATEGORY_LABEL[manifest.category] ?? "plugin"}.`}
        </p>
        <div className="text-[9px] font-bold uppercase tracking-wider text-kindle-accent flex items-center gap-1 mt-1 opacity-80 group-hover:opacity-100 group-hover:translate-x-1 transition">
          {panelFor(manifest) === "detail" ? "View details →" : `Launch ${pluginDisplayName(manifest)} →`}
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
              {pluginDisplayName(manifest)}
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

/**
 * The installed plugins that belong on this grid.
 *
 * Read through one function so the rule lives in exactly one place.
 * `surfaceForCategory` alone is NOT the rule any more: it still maps
 * `theme -> workshop`, which is the placement contract asserted in
 * `__tests__/pluginPlacement.test.ts` (another change owns that file), so this
 * grid narrows it with `WORKSHOP_TILE_CATEGORIES` instead of moving it. Themes
 * live in the plugin hub; integrations and tools live here.
 */
function readInstalled(): PluginManifest[] {
  return getInstalledExtensions().filter(isWorkshopTile);
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
                {pluginDisplayName(open)}
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
                {pluginDisplayName(open)}
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

      {open && panelFor(open) === "croc" && (
        <FluidOverlay open onClose={() => setOpenId(null)} variant="sheet" panelClassName="max-w-2xl p-6">
          <div className="flex items-center justify-between border-b border-kindle-border pb-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-kindle-bg border border-kindle-border text-kindle-accent rounded-xl shrink-0">
                <Plug className="w-5 h-5" />
              </div>
              <h3 className="font-lexend font-bold text-sm uppercase tracking-wider truncate">
                {pluginDisplayName(open)}
              </h3>
            </div>
            <button onClick={() => setOpenId(null)} className="p-1.5 hover:bg-kindle-bg rounded-lg shrink-0" aria-label="Close">
              <X className="w-5 h-5 text-kindle-text" />
            </button>
          </div>
          <div className="max-h-[75vh] overflow-y-auto pr-1">
            <CrocPanel />
          </div>
        </FluidOverlay>
      )}

      {open && panelFor(open) === "detail" && (
        <PluginDetailSheet manifest={open} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}
