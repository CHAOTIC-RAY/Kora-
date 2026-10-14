/**
 * Integration settings — the user's own server address and credentials.
 *
 * Everything here is per-device, in localStorage, and never leaves the device
 * except as an HTTP Basic header sent to the server the user typed in. There
 * is no shared backend for it and no analytics path for it.
 *
 * The password is stored in plain localStorage. That is a deliberate,
 * bounded trade-off rather than an oversight: a Calibre Content Server
 * password is a LAN-scoped secret, and the alternative (a real keystore) is
 * not available to a web/PWA build. The APK gets no extra protection here
 * either. The threat model this accepts is "someone with the unlocked device
 * and devtools", which is the same threat model the rest of Kora's local
 * settings (sync keys, reading history) already operate under.
 */

import { normaliseServerUrl, validateServerUrl, type CalibreConfig } from "./calibreClient";

const LS_CALIBRE = "kora.integration.calibre.v1";

export interface CalibreSettings extends CalibreConfig {
  /** Last library the user picked, so the UI can preselect it. */
  libraryId?: string;
  /** Whether the user has completed setup at least once. */
  configured?: boolean;
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the session still works in memory */
  }
}

export const EMPTY_CALIBRE: CalibreSettings = {
  serverUrl: "",
  username: "",
  password: "",
};

export function getCalibreSettings(): CalibreSettings {
  const raw = readJSON<Partial<CalibreSettings>>(LS_CALIBRE, {});
  return {
    serverUrl: typeof raw.serverUrl === "string" ? raw.serverUrl : "",
    username: typeof raw.username === "string" ? raw.username : "",
    password: typeof raw.password === "string" ? raw.password : "",
    libraryId: typeof raw.libraryId === "string" ? raw.libraryId : undefined,
    configured: raw.configured === true,
  };
}

export function saveCalibreSettings(next: CalibreSettings): void {
  writeJSON(LS_CALIBRE, {
    serverUrl: normaliseServerUrl(next.serverUrl),
    username: next.username,
    password: next.password,
    libraryId: next.libraryId,
    configured: next.configured === true,
  });
}

export function clearCalibreSettings(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(LS_CALIBRE);
  } catch {
    /* ignore */
  }
}

/** True once there is enough to attempt a connection. */
export function hasCalibreConfig(s: CalibreSettings): boolean {
  return !!normaliseServerUrl(s.serverUrl);
}

/** Validate before saving, so the UI can refuse a bad address immediately. */
export function validateCalibreSettings(
  s: CalibreSettings
): { ok: true; value: CalibreSettings; error?: undefined } | { ok: false; value?: undefined; error: string } {
  const check = validateServerUrl(s.serverUrl);
  if (!check.ok) return { ok: false, error: check.error };
  if (!s.username.trim()) {
    return { ok: false, error: "Enter the Calibre username." };
  }
  return {
    ok: true,
    value: { ...s, serverUrl: check.url, username: s.username.trim() },
  };
}
