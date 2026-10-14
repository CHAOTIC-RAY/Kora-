/**
 * The bounded preload LRU.
 *
 * The bug being locked down is a leak that only shows up on a long series:
 * the old `Set<string>` only ever grew, so a reader open across a
 * 661-chapter manga retained every decoded bitmap it had ever paged past.
 * These assert eviction, recency, and that a failed URL is never retried.
 */
import { PreloadQueue, DEFAULT_PRELOAD_CAP } from "../preloadQueue";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL ", name, detail === undefined ? "" : JSON.stringify(detail));
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ---- the cap is real: this is the leak ---- */
{
  const q = new PreloadQueue();
  for (let i = 0; i < 500; i++) q.add(`page-${i}.jpg`);
  ok("queue never exceeds the cap", q.size === DEFAULT_PRELOAD_CAP, q.size);
  ok("the oldest entries are the ones dropped", !q.has("page-0.jpg") && !q.has("page-100.jpg"));
  ok("the newest entries are retained", q.has("page-499.jpg") && q.has("page-492.jpg"), q.size);
}
{
  // A reader open on a whole 661-chapter manga's worth of pages.
  const q = new PreloadQueue();
  for (let i = 0; i < 661; i++) q.add(`https://cdn/ch-${i}/001.jpg`);
  ok("661 chapters of preloads stay bounded", q.size === DEFAULT_PRELOAD_CAP, q.size);
}

/* ---- eviction order is least-recently-USED, not insertion order ---- */
{
  const q = new PreloadQueue({ capacity: 3 });
  q.add("a");
  q.add("b");
  q.add("c");
  // Re-touch "a" so "b" becomes the least recently used.
  q.has("a");
  q.add("d");
  ok("touched entry survives", q.has("a"), q.keys());
  ok("least recently used is evicted", !q.has("b"), q.keys());
  ok("untouched entries survive", q.has("c") && q.has("d"), q.keys());
  ok("order is oldest first", eq(q.keys(), ["a", "c", "d"]), q.keys());
}
{
  // Re-adding refreshes recency rather than duplicating.
  const q = new PreloadQueue({ capacity: 2 });
  q.add("a");
  q.add("b");
  q.add("a");
  q.add("c");
  ok("re-add refreshes instead of duplicating", q.size === 2, q.keys());
  ok("re-added entry evicted the truly old one", !q.has("b") && q.has("a"), q.keys());
}

/* ---- eviction is reported so the caller can drop its own references ---- */
{
  const q = new PreloadQueue({ capacity: 2 });
  ok("first add evicts nothing", eq(q.add("a"), []));
  ok("second add evicts nothing", eq(q.add("b"), []));
  ok("third add evicts the oldest", eq(q.add("c"), ["a"]));
  ok("overfilling by two evicts two", eq(new PreloadQueue({ capacity: 2 }).add("z"), []));
  const q2 = new PreloadQueue({ capacity: 2 });
  q2.add("z");
  q2.add("y");
  q2.add("x");
  q2.add("w");
  ok("second eviction reported", eq(q2.keys(), ["x", "w"]), q2.keys());
}

/* ---- shouldPreload: the loop guard ---- */
{
  const q = new PreloadQueue();
  ok("an unseen url should preload", q.shouldPreload("a.jpg"));
  q.add("a.jpg");
  ok("a cached url should not preload again", !q.shouldPreload("a.jpg"));
  q.markFailed("dead.jpg");
  ok("a failed url never preloads again", !q.shouldPreload("dead.jpg"));
  ok("empty url never preloads", !q.shouldPreload(""));
}

/* ---- failures are sticky, and Retry clears exactly one ---- */
{
  const q = new PreloadQueue();
  q.markFailed("dead.jpg");
  ok("failure is remembered", q.hasFailed("dead.jpg"));
  ok("a failed url is not held as a success", !q.has("dead.jpg"));

  // A url can be credited to the preloader and then fail in the visible
  // img; the failure has to win.
  q.add("flaky.jpg");
  q.markFailed("flaky.jpg");
  ok("a late failure evicts the preload credit", !q.has("flaky.jpg"));
  ok("a late failure is remembered", q.hasFailed("flaky.jpg"));

  q.clearFailure("flaky.jpg");
  ok("Retry re-arms exactly that url", q.shouldPreload("flaky.jpg"));
  ok("Retry leaves other failures alone", !q.shouldPreload("dead.jpg"));

  q.clearFailures();
  ok("clearFailures re-arms everything", q.shouldPreload("dead.jpg") && q.shouldPreload("flaky.jpg"));
  ok("clearFailures does not credit the success set", !q.has("dead.jpg"));
}

/* ---- failures are never evicted by churn (that would retry a dead CDN) ---- */
{
  const q = new PreloadQueue({ capacity: 2 });
  for (let i = 0; i < 50; i++) {
    q.markFailed(`dead-${i}.jpg`);
    q.add(`live-${i}.jpg`);
  }
  ok("failures survive 50 pages of churn", q.failedCount === 50, q.failedCount);
  ok("success set still bounded", q.size === 2, q.size);
}

/* ---- clear releases everything on unmount ---- */
{
  const q = new PreloadQueue({ capacity: 4 });
  q.add("a");
  q.add("b");
  q.markFailed("c");
  q.clear();
  ok("clear empties the success set", q.size === 0, q.size);
  ok("clear empties the failure set", q.failedCount === 0, q.failedCount);
  ok("a cleared queue preloads again", q.shouldPreload("a"));
}

/* ---- a nonsense capacity must not produce a zero-cap queue that drops everything ---- */
{
  const q = new PreloadQueue({ capacity: 0 });
  q.add("a");
  ok("capacity 0 is floored to 1", q.size === 1, q.size);
  const neg = new PreloadQueue({ capacity: -5 });
  neg.add("a");
  ok("negative capacity is floored to 1", neg.size === 1, neg.size);
  const frac = new PreloadQueue({ capacity: 2.9 });
  frac.add("a");
  frac.add("b");
  frac.add("c");
  ok("fractional capacity is floored", frac.size === 2, frac.size);
}

/* ---- empty urls are ignored rather than stored ---- */
{
  const q = new PreloadQueue();
  q.add("");
  ok("empty add stores nothing", q.size === 0);
  ok("empty add evicts nothing", eq(q.add(""), []));
  q.markFailed("");
  ok("empty failure is not recorded", q.failedCount === 0);
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
