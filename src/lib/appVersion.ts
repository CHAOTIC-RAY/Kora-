declare const __KORA_BUILD_ID__: string | undefined;
declare const __KORA_VERSION__: string | undefined;

/** Build id baked in at compile time (changes every production build). */
export const APP_BUILD_ID: string =
  typeof __KORA_BUILD_ID__ !== "undefined" && __KORA_BUILD_ID__
    ? __KORA_BUILD_ID__
    : "dev";

/** Semantic version baked in at compile time (from package.json). */
export const APP_VERSION: string =
  typeof __KORA_VERSION__ !== "undefined" && __KORA_VERSION__
    ? __KORA_VERSION__
    : "0.0.0";

export type RemoteVersion = {
  buildId: string;
  version?: string;
  builtAt?: string;
};

/** Fetch the deployed version.json (always bypasses HTTP/SW caches). */
export async function fetchRemoteVersion(timeoutMs = 8000): Promise<RemoteVersion | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.buildId) return null;
    return {
      buildId: String(data.buildId),
      version: data.version ? String(data.version) : undefined,
      builtAt: data.builtAt,
    };
  } catch {
    return null;
  }
}

/** Parse "1.2.3" → [1,2,3]; tolerant of "v1.2" etc. */
function parseVersion(v: string): number[] {
  return (v.match(/\d+/g) || []).map(Number).slice(0, 3);
}

/**
 * Decide whether the deployed build is newer. Compares semantic versions
 * (from package.json vs version.json) so a redeploy with identical code never
 * triggers a false "update available" prompt. Falls back to buildId only when
 * the version field is missing on one side (dev/old builds).
 */
export function isNewerBuild(remote: RemoteVersion | null): boolean {
  if (!remote?.buildId) return false;
  if (APP_BUILD_ID === "dev") return false;

  const localV = parseVersion(APP_VERSION);
  const remoteV = remote.version ? parseVersion(remote.version) : null;
  if (remoteV && localV.some((n) => !isNaN(n))) {
    for (let i = 0; i < 3; i++) {
      const l = localV[i] || 0;
      const r = remoteV[i] || 0;
      if (r > l) return true;
      if (r < l) return false;
    }
    return false; // versions equal → no prompt
  }
  // Fallback: only flag when remote buildId actually differs.
  return remote.buildId !== APP_BUILD_ID;
}
