/**
 * JS bridge for the native KoraStorage Capacitor plugin (SAF tree picker).
 *
 * On Android (APK) the user picks a "Kora" folder once; we persist the tree
 * URI and write user data into sub-folders: audiobooks, books, news, data.
 * On web / when unavailable, callers should fall back to IndexedDB / localStorage.
 */

export type KoraSubfolder = "audiobooks" | "books" | "news" | "data";

interface KoraStoragePlugin {
  hasFolder(): Promise<{ hasFolder: boolean }>;
  pickFolder(): Promise<{ uri: string }>;
  listSubfolders(): Promise<{ folders: string[] }>;
  writeText(opts: { subfolder: KoraSubfolder; fileName: string; text: string }): Promise<{ ok: boolean }>;
}

function plugin(): KoraStoragePlugin | null {
  const c = (window as any).Capacitor;
  if (!c || !c.isNativePlatform || !c.Plugins || !c.Plugins.KoraStorage) return null;
  return c.Plugins.KoraStorage as KoraStoragePlugin;
}

let warned = false;
function unavailable(): boolean {
  if (!plugin()) {
    if (!warned) {
      console.warn("[Kora/Storage] native KoraStorage plugin not available (web or not initialized)");
      warned = true;
    }
    return true;
  }
  return false;
}

/** Whether the user has already chosen the Kora folder. */
export async function hasKoraFolder(): Promise<boolean> {
  if (unavailable()) return false;
  try {
    const r = await plugin()!.hasFolder();
    return !!r.hasFolder;
  } catch {
    return false;
  }
}

/**
 * Prompt the user to pick the Kora folder (SAF tree picker). Resolves true if
 * a folder was selected, false if cancelled.
 */
export async function pickKoraFolder(): Promise<boolean> {
  if (unavailable()) return false;
  try {
    await plugin()!.pickFolder();
    return true;
  } catch (err) {
    console.warn("[Kora/Storage] pickFolder cancelled/failed", err);
    return false;
  }
}

/** Write text into a Kora sub-folder (creates the folder if needed). */
export async function writeKoraText(
  subfolder: KoraSubfolder,
  fileName: string,
  text: string
): Promise<boolean> {
  if (unavailable()) return false;
  try {
    const r = await plugin()!.writeText({ subfolder, fileName, text });
    return !!r.ok;
  } catch (err) {
    console.warn("[Kora/Storage] writeText failed", err);
    return false;
  }
}

/** List existing Kora sub-folders. */
export async function listKoraSubfolders(): Promise<string[]> {
  if (unavailable()) return [];
  try {
    const r = await plugin()!.listSubfolders();
    return Array.isArray(r.folders) ? r.folders : [];
  } catch {
    return [];
  }
}

/** Open the system dialog to exempt Kora from battery optimization (optional). */
export async function requestBatteryExemption(): Promise<boolean> {
  const c = (window as any).Capacitor;
  const k = c?.Plugins?.KoraStorage;
  if (!k) return false;
  try {
    await k.requestBatteryExemption();
    return true;
  } catch (err) {
    console.warn("[Kora/Storage] battery exemption unavailable", err);
    return false;
  }
}
