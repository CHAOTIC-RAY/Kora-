const LOUNGE_ENABLED_KEY = "kora_lounge_enabled";
const LOUNGE_MODES_KEY = "kora_lounge_widget_modes_v1";

export type LoungeWidgetId = "continue" | "shelf" | "discover" | "paper";

export type LoungeWidgetModes = Record<LoungeWidgetId, string>;

const DEFAULT_MODES: LoungeWidgetModes = {
  continue: "book",
  shelf: "books",
  discover: "trending",
  paper: "latest",
};

export function isLoungeEnabled(): boolean {
  try {
    const raw = localStorage.getItem(LOUNGE_ENABLED_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

export function setLoungeEnabled(enabled: boolean): void {
  localStorage.setItem(LOUNGE_ENABLED_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("kora-lounge-prefs-changed"));
}

export function loadLoungeModes(): LoungeWidgetModes {
  try {
    const raw = localStorage.getItem(LOUNGE_MODES_KEY);
    if (!raw) return { ...DEFAULT_MODES };
    return { ...DEFAULT_MODES, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_MODES };
  }
}

export function saveLoungeMode(id: LoungeWidgetId, mode: string): void {
  const next = { ...loadLoungeModes(), [id]: mode };
  localStorage.setItem(LOUNGE_MODES_KEY, JSON.stringify(next));
}
