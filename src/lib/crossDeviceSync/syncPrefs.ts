/** Cross-device sync preferences (local + optional WebDAV). */

export interface WebDavConfig {
  enabled: boolean;
  baseUrl: string;
  username: string;
  password: string;
  /** Folder path under the WebDAV root, e.g. /kora-books */
  remotePath: string;
}

export interface CrossDeviceSyncPrefs {
  /** Auto-download missing ebooks when library loads */
  autoHydrateLibrary: boolean;
  /** After caching a file, also PUT to WebDAV if configured */
  pushToWebDav: boolean;
  /** Prefer WebDAV before public mirrors when hydrating */
  preferWebDav: boolean;
  /** Advertise this device for P2P file sharing */
  peerSharingEnabled: boolean;
  webdav: WebDavConfig;
}

const PREFS_KEY = "kora_cross_device_sync_prefs_v1";

export const DEFAULT_SYNC_PREFS: CrossDeviceSyncPrefs = {
  autoHydrateLibrary: true,
  pushToWebDav: true,
  preferWebDav: true,
  peerSharingEnabled: true,
  webdav: {
    enabled: false,
    baseUrl: "",
    username: "",
    password: "",
    remotePath: "/kora-books",
  },
};

export function loadSyncPrefs(): CrossDeviceSyncPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_SYNC_PREFS };
    const parsed = JSON.parse(raw) as Partial<CrossDeviceSyncPrefs>;
    return {
      ...DEFAULT_SYNC_PREFS,
      ...parsed,
      webdav: { ...DEFAULT_SYNC_PREFS.webdav, ...(parsed.webdav || {}) },
    };
  } catch {
    return { ...DEFAULT_SYNC_PREFS };
  }
}

export const SYNC_PREFS_CHANGED_EVENT = "kora-sync-prefs-changed";

export function saveSyncPrefs(prefs: CrossDeviceSyncPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  try {
    window.dispatchEvent(new CustomEvent(SYNC_PREFS_CHANGED_EVENT));
  } catch {
    /* ignore (SSR / tests) */
  }
}

export function updateSyncPrefs(patch: Partial<CrossDeviceSyncPrefs>): CrossDeviceSyncPrefs {
  const next = {
    ...loadSyncPrefs(),
    ...patch,
    webdav: patch.webdav
      ? { ...loadSyncPrefs().webdav, ...patch.webdav }
      : loadSyncPrefs().webdav,
  };
  saveSyncPrefs(next);
  return next;
}
