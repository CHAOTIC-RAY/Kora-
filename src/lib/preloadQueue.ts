/**
 * A bounded LRU of preloaded page URLs, with failed URLs remembered so the
 * reader stops hammering a broken CDN.
 *
 * The leak this replaces. `ComicReader` held a
 * `useRef<Set<string>>(new Set())` and only ever called `.add(url)` on it.
 * Nothing evicted. Every page the reader ever passed over stayed in the
 * set forever, and the `Image` object created for each one stayed alive as
 * a decoded bitmap for as long as the reader was mounted — so a reader
 * open on a long series grew its decode cache until the tab died, and a
 * 661-chapter manga touched a third of them before anyone noticed.
 *
 * Two separate problems, so two mechanisms:
 *
 *   - The success set is an LRU with a hard cap. Once it is full, adding
 *     evicts the least recently used entry, which drops the only strong
 *     reference to that bitmap and lets it be collected. Reads refresh
 *     recency, so the pages you flip back and forth over stay warm.
 *   - The failed set is *not* evicted while the reader is open. A URL that
 *     404d once will 404 again, and retrying it on every turn is what turns
 *     a single dead page into a hundred doomed requests. `clearFailures`
 *     exists so a manual Retry can force exactly one re-attempt.
 *
 * Pure on purpose: no DOM, no `Image`, no React. The eviction order is the
 * whole point and it is far easier to prove with a test than in a browser.
 */

/** Neighbour pages kept decoded ahead of the current one. */
export const DEFAULT_PRELOAD_CAP = 8;

export interface PreloadQueueOptions {
  /** Max successfully-preloaded URLs retained. Default 8. */
  capacity?: number;
}

export class PreloadQueue {
  private readonly cap: number;
  /** Keyed by URL, ordered oldest-recency-first. Map preserves insertion order. */
  private readonly entries = new Map<string, true>();
  /** URLs that failed to load. Never retried until explicitly cleared. */
  private readonly failed = new Set<string>();

  constructor(opts: PreloadQueueOptions = {}) {
    const cap = opts.capacity ?? DEFAULT_PRELOAD_CAP;
    this.cap = Math.max(1, Math.floor(cap));
  }

  /** URLs currently held, least recently used first. */
  get size(): number {
    return this.entries.size;
  }

  /** URLs that have failed, for diagnostics. */
  get failedCount(): number {
    return this.failed.size;
  }

  /** Most-recently-used last. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  has(url: string): boolean {
    if (!this.entries.has(url)) return false;
    // Reading refreshes recency, which is what makes this an LRU rather
    // than FIFO: the pages you flip back and forth over stay warm, and the
    // ones you left long ago are the ones dropped.
    this.touch(url);
    return true;
  }

  /** Non-touching membership check, for internal bookkeeping. */
  private peek(url: string): boolean {
    return this.entries.has(url);
  }

  private touch(url: string) {
    this.entries.delete(url);
    this.entries.set(url, true);
  }

  hasFailed(url: string): boolean {
    return this.failed.has(url);
  }

  /**
   * Should the reader bother preloading this URL?
   *
   * False once it is cached and false once it has failed, which is what
   * stops the preload loop from re-requesting a dead page on every turn.
   */
  shouldPreload(url: string): boolean {
    return !!url && !this.peek(url) && !this.failed.has(url);
  }

  /**
   * Record a URL as preloaded and make it most-recently-used.
   *
   * Returns the URLs evicted to make room, so the caller can drop its own
   * references to them. Empty when nothing was evicted.
   */
  add(url: string): string[] {
    if (!url) return [];
    // Re-adding refreshes recency rather than duplicating: delete then set
    // moves the key to the end of the Map's insertion order.
    this.entries.delete(url);
    this.entries.set(url, true);
    const evicted: string[] = [];
    while (this.entries.size > this.cap) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      evicted.push(oldest.value);
    }
    return evicted;
  }

  /**
   * Mark a URL as failed.
   *
   * Also drops it from the success set — a URL can be marked failed by the
   * visible `<img>` after the preloader was optimistically credited with it.
   */
  markFailed(url: string): void {
    if (!url) return;
    this.failed.add(url);
    this.entries.delete(url);
  }

  /**
   * Forget a failure so one deliberate retry can re-attempt it.
   * The URL is not re-added to the success set; the retry decides that.
   */
  clearFailure(url: string): void {
    this.failed.delete(url);
  }

  /** Forget every recorded failure. Used when the user hits Retry. */
  clearFailures(): void {
    this.failed.clear();
  }

  /** Drop everything. Called when the reader unmounts. */
  clear(): void {
    this.entries.clear();
    this.failed.clear();
  }
}

export default PreloadQueue;
