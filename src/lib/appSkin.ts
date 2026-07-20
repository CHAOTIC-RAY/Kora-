/** App chrome skins — orthogonal to display themes (color palettes). */

export const APP_SKINS = [
  {
    id: "kora",
    label: "Kora",
    description: "Classic solid chrome",
  },
  {
    id: "kora-glass",
    label: "Kora Glass",
    description: "Liquid glass refraction, glare & Fresnel rim",
  },
] as const;

export type AppSkinId = (typeof APP_SKINS)[number]["id"];

export const DEFAULT_APP_SKIN: AppSkinId = "kora";
export const APP_SKIN_STORAGE_KEY = "kora_app_skin";

export function isAppSkinId(value: string | null | undefined): value is AppSkinId {
  return APP_SKINS.some((skin) => skin.id === value);
}

export function readStoredAppSkin(): AppSkinId {
  try {
    const stored = localStorage.getItem(APP_SKIN_STORAGE_KEY);
    if (isAppSkinId(stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_APP_SKIN;
}

export function skinBodyClass(skin: AppSkinId): string {
  return `skin-${skin}`;
}
