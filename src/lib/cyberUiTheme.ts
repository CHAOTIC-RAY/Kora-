import type { PluginManifest } from "./sources/types";
import type { RepoEntry } from "./sources/store";

export const CYBERUI_PLUGIN_URL = "kora://builtin/cyberui-operator";

export const CYBERUI_THEME: PluginManifest = {
  id: "kora.theme.cyberui-operator",
  name: "CyberUI // Operator",
  version: "1.0.0",
  category: "theme",
  author: "Kora",
  description: "A compact Night City reader HUD with dark wine panels, cyan signal lines, coral actions, and terminal-style labels.",
  themeId: "cyberui-operator",
  dark: true,
  tokens: {
    bg: "#1B1115",
    text: "#B7E5E6",
    textMuted: "#81AEB1",
    border: "#57BFC4",
    accent: "#E85C51",
    card: "#281A1F",
    toastBg: "#281A1F",
  },
};

export function cyberUiRegistryEntry(installed: boolean): RepoEntry {
  const { id, name, description, version, category, tokens, themeId, dark, author } = CYBERUI_THEME;
  return {
    plugin: {
      id,
      name,
      lang: "en",
      version: 1,
      nsfw: false,
      piracy: false,
      baseUrl: "",
      endpoints: {},
      category,
    },
    installed,
    gated: false,
    readable: true,
    installUrl: CYBERUI_PLUGIN_URL,
    category,
    manifest: { id, name, description, version, category, tokens, themeId, dark, author },
  };
}
