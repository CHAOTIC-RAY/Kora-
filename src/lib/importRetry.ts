/**
 * Retry wrapper for dynamic imports of lazy-loaded chunks.
 * Catches network failures (stale CDN, offline, bad SW cache) and retries
 * a few times with backoff before giving up — instead of letting the
 * uncaught rejection crash the Suspense boundary.
 */
export async function importWithRetry<T>(
  importFn: () => Promise<T>,
  options?: { retries?: number; baseDelayMs?: number },
): Promise<T> {
  const retries = options?.retries ?? 3;
  const baseDelay = options?.baseDelayMs ?? 400;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await importFn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Returns true if the running app bundle appears stale vs the remote version.json.
 * Fetches version.json and compares build IDs / semantic versions.
 */
export async function isBundleStale(): Promise<boolean> {
  const { fetchRemoteVersion, isNewerBuild, APP_BUILD_ID } = await import("./appVersion");
  const remote = await fetchRemoteVersion();
  if (!remote) return false;
  if (APP_BUILD_ID === "dev") return false;
  return isNewerBuild(remote);
}
