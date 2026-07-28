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
  pickFolder(): Promise<{ uri: string; partial?: boolean }>;
  listSubfolders(): Promise<{ folders: string[] }>;
  writeText(opts: { subfolder: KoraSubfolder; fileName: string; text: string }): Promise<{ ok: boolean }>;
  setStorageMode(opts: { mode: "saf" | "virtual" }): Promise<{ mode: string }>;
  getStorageMode(): Promise<{ mode: string }>;
}

export type KoraStorageMode = "saf" | "virtual";

/** The persisted storage mode (new SAF folder vs old virtual directory). */
export async function getKoraStorageMode(): Promise<KoraStorageMode> {
  if (unavailable()) return "virtual";
  try {
    const r = await plugin()!.getStorageMode();
    return r.mode === "virtual" ? "virtual" : "saf";
  } catch {
    return "saf";
  }
}

/** Persist the chosen storage mode. Selecting "virtual" clears the SAF folder. */
export async function setKoraStorageMode(mode: KoraStorageMode): Promise<void> {
  if (unavailable()) {
    // Web / non-native: mirror the flag the rest of the app reads.
    localStorage.setItem("kora_use_virtual_dir", String(mode === "virtual"));
    return;
  }
  try {
    await plugin()!.setStorageMode({ mode });
    localStorage.setItem("kora_use_virtual_dir", String(mode === "virtual"));
  } catch (err) {
    console.warn("[Kora/Storage] setStorageMode failed", err);
  }
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
 * a folder was selected, false if cancelled. On a successful pick we soft-reload
 * the WebView so the new tree URI is picked up cleanly — this turns Android's
 * usual "app gets killed by the SAF picker and relaunches looking crashed"
 * behaviour into a deliberate, graceful restart.
 */
export async function pickKoraFolder(): Promise<boolean> {
  if (unavailable()) return false;
  try {
    const r = await plugin()!.pickFolder();
    try {
      if (typeof window !== "undefined" && r && !r.partial) {
        sessionStorage.setItem("kora_saf_picked_reload", "1");
        window.location.reload();
      }
    } catch { /* ignore reload failure */ }
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
