declare const __KORA_BUILD_ID__: string | undefined;

/** Build id baked in at compile time (changes every production build). */
export const APP_BUILD_ID: string =
  typeof __KORA_BUILD_ID__ !== "undefined" && __KORA_BUILD_ID_
    ? __KORA_BUILD_ID_
    : "dev";

export type RemoteVersion = {
  buildId: string;
  builtAt?: string;
};

/** Fetch the deployed version.json (always bypasses HTTP/SW caches). */
export async function fetchRemoteVersion(timeoutMs = 8000): Promise<RemoteVersion | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.buildId) return null;
    return { buildId: String(data.buildId), builtAt: data.builtAt };
  } catch {
    return null;
  }
}

export function isNewerBuild(remote: RemoteVersion | null): boolean {
  if (!remote?.buildId) return false;
  if (APP_BUILD_ID === "dev") return false;
  return remote.buildId !== APP_BUILD_ID;
}
