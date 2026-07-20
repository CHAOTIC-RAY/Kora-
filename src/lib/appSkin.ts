/** App chrome skins — orthogonal to display themes (color palettes). */

export const APP_SKINS = [
  {
    id: "kora",
    label: "Kora",
    description: "Classic frosted chrome with a floating tab bar",
  },
  {
    id: "paper",
    label: "Paper",
    description: "Matte e-reader surfaces with warm, quiet borders",
  },
  {
    id: "studio",
    label: "Studio",
    description: "Sharp editorial layout with crisp lines and contrast",
  },
  {
    id: "soft",
    label: "Soft",
    description: "Rounded, elevated UI with gentle depth and shadows",
  },
] as const;

export type AppSkinId = (typeof APP_SKINS)[number]["id"];

export const DEFAULT_APP_SKIN: AppSkinId = "kora";
export const APP_SKIN_STORAGE_KEY = "kora_app_skin";

const LEGACY_SKIN_ALIASES: Record<string, AppSkinId> = {
  "kora-glass": "kora",
};

export function isAppSkinId(value: string | null | undefined): value is AppSkinId {
  return APP_SKINS.some((skin) => skin.id === value);
}

export function readStoredAppSkin(): AppSkinId {
  try {
    const stored = localStorage.getItem(APP_SKIN_STORAGE_KEY);
    if (stored && LEGACY_SKIN_ALIASES[stored]) return LEGACY_SKIN_ALIASES[stored];
    if (isAppSkinId(stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_APP_SKIN;
}

export function skinBodyClass(skin: AppSkinId): string {
  return `skin-${skin}`;
}
