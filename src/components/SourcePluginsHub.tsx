/**
 * The Discover plugin hub.
 *
 * This is a mount point, not an implementation. It renders the shared
 * `PluginBrowser` filtered to the `source` category, which is the only
 * category that belongs in Discover:
 *
 *  - Discover is where content comes from, so it shows sources;
 *  - integrations (Calibre sync, Send to Kindle) live in Workshop;
 *  - themes live in Settings.
 *
 * That mapping is `surfaceForCategory` in `lib/sources/store.ts` and it is
 * asserted in `__tests__/pluginPlacement.test.ts`. This file stays a named
 * component because Discover imports it by name, and because a sub-tab whose
 * label is "Plugins" should not silently read as "every kind of plugin".
 *
 * All behaviour — install, remove, the Details sheet, custom GitHub
 * registries, the error banner, icons, and the piracy/adult gating for
 * restricted sources — now lives in PluginBrowser and is shared by all three
 * surfaces rather than forked per tab. Themes and integrations were never
 * behind the opt-in, and they still are not: only sources are gated.
 */

import React from "react";
import PluginBrowser from "./PluginBrowser";
import { categoriesForSurface } from "../lib/sources/store";

export default function SourcePluginsHub() {
  return (
    <PluginBrowser
      categories={categoriesForSurface("discover")}
      badge="Discover"
      intro="Source plugins are rules for reading a site. Install one and it joins your Discover feed alongside your books."
    />
  );
}
