/**
 * The Discover plugin hub — the ONLY plugin hub in the app.
 *
 * This is a mount point, not an implementation. It renders the shared
 * `PluginBrowser` with `hubCategories()`, i.e. every category, because this is
 * where plugins are installed, enabled, disabled and removed. If the hub
 * filtered itself down to sources, an integration or a theme could never be
 * installed from anywhere.
 *
 * Once a non-source plugin IS installed, it stops being a hub entry and
 * becomes a tile: `PluginBentoTiles` in Workshop shows one bento card per
 * installed integration / theme / tool, and tapping the card opens that
 * plugin's own panel. The two never overlap — the hub lists what you can
 * install, Workshop lists what you have.
 *
 * That split is the placement rule in `lib/sources/store.ts` and it is asserted
 * in `__tests__/pluginPlacement.test.ts`. Themes and integrations were never
 * behind the piracy/adult opt-in, and they still are not: only sources are
 * gated, in either surface.
 */

import React from "react";
import PluginBrowser from "./PluginBrowser";
import { hubCategories } from "../lib/sources/store";

export default function SourcePluginsHub() {
  return (
    <PluginBrowser
      categories={hubCategories()}
      badge="Discover"
      intro="Plugins extend Kora. Source rules are how you read a site; integrations and themes are things you already own, wired in here. Install, pause or remove any of them."
    />
  );
}
