/**
 * The routing decision for plugin images, tested on its own.
 *
 * Every image path in the app funnels through `shouldProxyImageUrl`, so these
 * cases are the contract between the reader, the preloader, and every cover.
 *
 * The regression they lock down is specific. On a network whose DNS filter
 * answers with a Fortinet "Fortiguard SDNS Blocked Page" certificate, a
 * direct browser fetch of a plugin image fails on *every* host — the TLS
 * handshake never completes. So "try direct, fall back to the proxy" was
 * never a fallback: it was a guaranteed first failure followed by the only
 * path that works, once per image, per page turn. The relay is now the
 * default, decided from the URL before any request is made.
 */
import { shouldProxyImageUrl, pluginImageSrc, resolvePluginImageSrc } from "../pluginImage";
import { resolveCoverImageSrc } from "../coverImage";

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

/* ---- a plugin image relays BY DEFAULT ---- */
{
  ok(
    "a remote manga page is relayed",
    shouldProxyImageUrl("https://cdn.manhuaplus.com/2026/09/30/RRpojm.jpg"),
  );
  ok(
    "a remote cover from any source CDN is relayed",
    shouldProxyImageUrl("https://cdn.mangafire.to/s/o/one-piece/1.jpg"),
  );
  ok("a plain http remote URL is relayed", shouldProxyImageUrl("http://example.org/p.jpg"));
  ok("a protocol-relative URL is relayed", shouldProxyImageUrl("//cdn.example.org/p.jpg"));
}

/* ---- non-remote URLs are left alone: the proxy is not free ---- */
{
  ok("a bundled asset is left alone", !shouldProxyImageUrl("/assets/page.webp"));
  ok("an inline data URL is left alone", !shouldProxyImageUrl("data:image/png;base64,iVBORw0KGgo="));
  ok("an object URL is left alone", !shouldProxyImageUrl("blob:https://kora.app/9f2b-1"));
  ok("a plain relative path is left alone", !shouldProxyImageUrl("covers/local.jpg"));
  ok("empty is left alone", !shouldProxyImageUrl(""));
  ok("whitespace is left alone", !shouldProxyImageUrl("   "));
  ok("null is left alone", !shouldProxyImageUrl(null));
  ok("undefined is left alone", !shouldProxyImageUrl(undefined));
}

/* ---- never re-relay the relay ---- */
{
  ok(
    "an already-proxied relative path is not re-proxied",
    !shouldProxyImageUrl("/api/proxy-image?url=https%3A%2F%2Fexample.org%2Fa.jpg"),
  );
  ok(
    "an already-proxied absolute Worker URL is not re-proxied",
    !shouldProxyImageUrl(
      "https://kora.chaoticstudio.workers.dev/api/proxy-image?url=https%3A%2F%2Fexample.org%2Fa.jpg",
    ),
  );
  const once = resolvePluginImageSrc("https://cdn.example.org/p.jpg");
  ok("resolving twice changes nothing", eq(resolvePluginImageSrc(once), once), once);
}

/* ---- what the relay URL actually looks like ---- */
{
  const src = resolvePluginImageSrc("https://cdn.manhuaplus.com/2026/09/30/RRpojm.jpg");
  ok("a plugin page resolves to the relay", String(src).includes("/api/proxy-image?url="), src);
  ok(
    "the original is preserved in the query string",
    String(src).includes(encodeURIComponent("https://cdn.manhuaplus.com/2026/09/30/RRpojm.jpg")),
  );
  ok(
    "a plain http URL is upgraded so the relay is not asked for http",
    String(resolvePluginImageSrc("http://cdn.example.org/p.jpg")).includes(
      encodeURIComponent("https://cdn.example.org/p.jpg"),
    ),
  );
  ok(
    "a protocol-relative URL is pinned to https",
    String(resolvePluginImageSrc("//cdn.example.org/p.jpg")).includes(
      encodeURIComponent("https://cdn.example.org/p.jpg"),
    ),
  );
  ok(
    "surrounding whitespace is trimmed before deciding",
    String(resolvePluginImageSrc("  https://cdn.example.org/p.jpg  ")).includes(
      encodeURIComponent("https://cdn.example.org/p.jpg"),
    ),
  );
  ok("empty resolves to null", resolvePluginImageSrc("") === null);
  ok("null resolves to null", resolvePluginImageSrc(null) === null);
  ok("a local URL is returned unchanged", eq(resolvePluginImageSrc("/assets/cover.webp"), "/assets/cover.webp"));
  ok(
    "a data URL is returned unchanged",
    eq(resolvePluginImageSrc("data:image/gif;base64,R0lGOD"), "data:image/gif;base64,R0lGOD"),
  );
  ok("pluginImageSrc is null for a URL that must not be relayed", pluginImageSrc("/assets/cover.webp") === null);
}

/* ---- covers and pages take the same route, by construction ---- */
{
  const cover = "https://cdn.manhuaplus.com/2026/09/30/cover.jpg";
  ok(
    "a cover routes exactly as a page of the same host does",
    eq(resolveCoverImageSrc(cover), resolvePluginImageSrc(cover)),
  );
  ok("a local cover is unproxied", eq(resolveCoverImageSrc("/local/cover.png"), "/local/cover.png"));
  const once = resolveCoverImageSrc("https://cdn.example.org/c.jpg");
  ok("a cover is not double-proxied", eq(resolveCoverImageSrc(once), once));
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
