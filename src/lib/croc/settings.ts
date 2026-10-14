/**
 * croc receiver settings — the user's own relay, stored on their device.
 *
 * Same threat model and same trade-off as `integrationSettings.ts` for Calibre:
 * these are per-device values in localStorage, and the relay password never
 * leaves the device except as a `CROC_PASS` in a command the user copies and
 * runs themselves. Kora never dials a relay, so there is nowhere for it to send
 * the password.
 *
 * Kept in its own file rather than added to `integrationSettings.ts` because that
 * file is imported by a Settings view another change is editing.
 */

import {
  EMPTY_CROC_RELAY_SETTINGS,
  normaliseCrocWebUrl,
  validateCrocRelayHost,
  type CrocRelaySettings,
} from "./client";

const LS_CROC = "kora.integration.croc.v1";

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

export { EMPTY_CROC_RELAY_SETTINGS };

export function getCrocSettings(): CrocRelaySettings {
  const raw = readJSON<Partial<CrocRelaySettings>>(LS_CROC, {});
  return {
    webUrl:
      typeof raw.webUrl === "string" && raw.webUrl.trim()
        ? raw.webUrl
        : EMPTY_CROC_RELAY_SETTINGS.webUrl,
    relayHost: typeof raw.relayHost === "string" ? raw.relayHost : "",
    relayPassword: typeof raw.relayPassword === "string" ? raw.relayPassword : "",
  };
}

export function saveCrocSettings(next: CrocRelaySettings): void {
  writeJSON(LS_CROC, {
    webUrl: normaliseCrocWebUrl(next.webUrl) || EMPTY_CROC_RELAY_SETTINGS.webUrl,
    relayHost: next.relayHost.trim(),
    relayPassword: next.relayPassword,
  });
}

export function clearCrocSettings(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(LS_CROC);
  } catch {
    /* ignore */
  }
}

/**
 * Validate before saving, so a bad address is refused where it was typed rather
 * than surfacing later as a transfer that silently fails.
 */
export function validateCrocSettings(
  s: CrocRelaySettings
): { ok: true; value: CrocRelaySettings; error?: undefined } | { ok: false; value?: undefined; error: string } {
  const webUrl = normaliseCrocWebUrl(s.webUrl);
  if (!webUrl) {
    return {
      ok: false,
      error: "Enter a full address like https://getcroc.com, or http://192.168.1.5:9014 for your own server.",
    };
  }
  // An empty relay host is meaningful, not missing: it means "use the public
  // pool", which is the default and the right choice for most people.
  if (s.relayHost.trim()) {
    const host = validateCrocRelayHost(s.relayHost);
    if (!host.ok) return { ok: false, error: host.error };
    return { ok: true, value: { webUrl, relayHost: host.value, relayPassword: s.relayPassword } };
  }
  return { ok: true, value: { webUrl, relayHost: "", relayPassword: s.relayPassword } };
}
