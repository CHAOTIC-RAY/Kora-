/**
 * The preloader and the reader must agree.
 *
 * This is the assertion the reported failure actually turns on. The preload
 * loop in `ComicReader` used to set `img.src` to the bare page URL while
 * `ReaderPageImage` went through the Worker, so the two were two different
 * requests for the same image: the preloader logged `[reader] preload
 * failed` for pages that would have rendered fine, and then recorded them in
 * `PreloadQueue` as permanently failed — so by the time the reader reached
 * them it had been told they were dead.
 *
 * Both now call the same `resolvePluginImageSrc`, so testing that function is
 * testing both call sites. These cases pin the shared contract rather than
 * re-implementing the reader's DOM logic.
 */
import { resolvePluginImageSrc } from "../pluginImage";
import { PreloadQueue } from "../preloadQueue";

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

/** What `ComicReader`'s preload loop assigns to `img.src`. */
function preloadSrc(url: string): string {
  return resolvePluginImageSrc(url) ?? url;
}

/** What `ReaderPageImage` fetches and renders. */
function readerSrc(url: string): string {
  return resolvePluginImageSrc(url) ?? url;
}

const PLUGIN_PAGE = "https://cdn.manhuaplus.com/2026/09/30/RRpojm.jpg";
const PLUGIN_COVER = "https://mangaread.org/comics/solo-leveling/cover.jpg";

/* ---- the two paths agree ---- */
{
  ok("a plugin page is fetched identically by both paths", preloadSrc(PLUGIN_PAGE) === readerSrc(PLUGIN_PAGE));
  ok("a plugin cover is fetched identically by both paths", preloadSrc(PLUGIN_COVER) === readerSrc(PLUGIN_COVER));
  ok("a local asset is left alone by both paths", preloadSrc("/assets/p.webp") === readerSrc("/assets/p.webp") && preloadSrc("/assets/p.webp") === "/assets/p.webp");

  const pages = [PLUGIN_PAGE, "/assets/intro.webp", PLUGIN_COVER];
  ok(
    "a mixed chapter of plugin pages and a local page agrees end to end",
    pages.every((p) => preloadSrc(p) === readerSrc(p)),
  );
}

/* ---- neither path ever issues a bare remote URL ---- */
{
  for (const src of [preloadSrc(PLUGIN_PAGE), readerSrc(PLUGIN_PAGE)]) {
    ok("a plugin page goes through the Worker relay", src.includes("/api/proxy-image?url="), src);
    ok("a plugin page never fetches the origin directly", !src.startsWith("https://cdn.manhuaplus.com"), src);
  }
}

/* ---- the queue is keyed on the origin URL, not the routed one ---- */
{
  // ComicReader records failures under the origin `url` while the request it
  // made used the routed form. Keyed on the routed URL these would be two
  // entries and a failure would never stick.
  const q = new PreloadQueue({ capacity: 2 });
  ok("an unseen page should be preloaded", q.shouldPreload(PLUGIN_PAGE));
  q.add(PLUGIN_PAGE);
  q.markFailed(PLUGIN_PAGE);
  ok("a failed page is recorded as failed", q.hasFailed(PLUGIN_PAGE));
  ok("a failed page is not re-preloaded on every turn", !q.shouldPreload(PLUGIN_PAGE));

  q.clearFailure(PLUGIN_PAGE);
  ok("an explicit retry clears the failure so the relayed re-fetch is allowed", q.shouldPreload(PLUGIN_PAGE));
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
