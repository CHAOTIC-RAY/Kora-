/**
 * Guards the staleness reload so at most ONE reload is ever attempted for a
 * chunk failure. Without this, a genuinely offline user (or a build that is not
 * actually stale but whose version.json cannot be fetched) would sit in a
 * reload/retry cycle instead of reaching the error boundary.
 */
let reloading = false;

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
      // A chunk load that fails every retry is almost never transient. The page
      // is running a bundle from before a deploy, so the hashed filename it asked
      // for no longer exists and retrying the SAME url can never succeed — which
      // is why this produced random crashes: any tab open across a deploy died
      // the first time it lazily loaded a tab, with no way out but Reload.
      //
      // `isBundleStale()` existed and was only ever consulted once at app boot,
      // so it could never help here. Check it on the failure path instead and
      // reload once, bounded so a genuinely offline user is not stuck in a loop.
      if (attempt === 0 && !reloading) {
        const stale = await isBundleStale().catch(() => false);
        if (stale) {
          reloading = true;
          try {
            window.location.reload();
          } catch {
            reloading = false;
          }
          // Reloading tears this module down; park the promise so nothing else
          // keeps retrying the dead URL in the meantime.
          await new Promise(() => {});
        }
      }
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
