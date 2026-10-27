/** Retry transient same-origin API/network failures without letting a whole feed load fail. */
export async function fetchDiscoverApi(input: RequestInfo | URL, init: RequestInit = {}, attempts = 2): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(input, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(15000),
        credentials: "same-origin",
      });
      if (response.ok || response.status < 500 || attempt === attempts - 1) return response;
      lastError = new Error(`Discover API returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("Discover API request failed");
}

/** Keep optional feeds from opening a burst of requests that can fail on mobile networks. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
