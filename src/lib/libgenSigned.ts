// Resolves a fresh LibGen signed CDN download link (get.php?md5=<h>&key=<t>).
// LibGen 307-redirects the keyless landing page to an ads page that embeds the
// signed link in an <a href>. Returns "" if it cannot be resolved within timeoutMs.
// Hosts are raced in parallel (Promise.any) so a single slow/blocked mirror
// cannot stall resolution.
//
// This lives in its own module so both the Worker (proxy-file route) and the
// shared libgenProxy helper can re-resolve an *expired* signed key. RAVE is the
// sole search relay and returns signed links whose `key` expires; when it does,
// we must mint a fresh one instead of blindly retrying the dead URL.

// Only mirrors that were observed serving a signed key on 2026-10-03.
//
// Four of the original nine (`.is`, `.rs`, `.st`, `.gs`) no longer answer: each
// hung for the full request budget and returned nothing, and `libgen.bz` returns
// HTTP 500. That matters more than dead weight — every host is raced at once, so
// each hanging one consumed budget and made the whole race intermittently fail.
// With them present the caller fell back to a bare "search Rave" link roughly one
// call in six. The remaining four all answered with a valid signed key, in
// 1.7s-5.2s.
const LIBGEN_SIGNED_HOSTS = [
  "libgen.li",
  "libgen.vg",
  "libgen.la",
  "libgen.gl",
];

const LIBGEN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

/**
 * Is this LibGen URL a landing/ad page rather than a file endpoint?
 *
 * Rave returns `https://libgen.la/ads.php?md5=<32-hex>` as a search result's
 * `downloadUrl`. That page renders an ad and only *links* onward to a signed
 * `get.php`; fetched directly it answers 200 with ~20KB of `text/html`
 * (verified 2026-10-03), which reads as a successful download and then fails as
 * a book.
 *
 * The one exception is a signed link: `get.php?md5=…&key=…` 307s to the CDN and
 * genuinely serves the file, so it must not be treated as a landing page.
 */
export function isLibgenLandingPage(url: string | null | undefined): boolean {
  if (!url) return false;
  let decoded = url;
  try {
    // The URL is usually nested inside a /api/proxy-file?url=... wrapper.
    decoded = decodeURIComponent(url);
  } catch {
    /* keep the raw value */
  }
  const lower = decoded.toLowerCase();
  if (!/libgen|booksdl/.test(lower)) return false;
  // Signed => a real file endpoint.
  if (/[?&]key=/i.test(decoded)) return false;
  // ads.php is always a landing page.
  if (lower.includes("ads.php")) return true;
  // A bare get.php?md5= (no key) lands on the ad page too.
  if (/get\.php\?[^#]*\bmd5=/i.test(decoded)) return true;
  return false;
}

export async function resolveLibgenSigned(
  md5: string,
  // Was 2800ms, which is borderline rather than generous: measured from this
  // machine, libgen.vg — a mirror that reliably returns a valid signed link —
  // took 1.3s, 1.8s and 3.8s across three calls. At 2.8s the winner was
  // frequently aborted and the caller fell back to a bare "search Rave" link,
  // which is the same dead end this function exists to prevent.
  //
  // All hosts are raced at once, so a longer budget costs nothing on the happy
  // path: Promise.any returns as soon as the FIRST one succeeds. This only
  // lengthens the wait when every mirror is slow or dead.
  timeoutMs = 7000
): Promise<string> {
  const tryHost = async (host: string): Promise<string> => {
    for (const proto of ["https", "http"] as const) {
      // `ads.php` is the page that still embeds a live signed link. A bare
      // `get.php?md5=` (no key) now answers 307 with an EMPTY body — verified
      // 2026-10-03 — so scraping it yields nothing and the caller is handed a
      // dead link. Try ads.php first, then get.php as a fallback.
      for (const page of ["ads.php", "get.php"] as const) {
        try {
          const res = await fetch(`${proto}://${host}/${page}?md5=${md5}`, {
            headers: { "User-Agent": LIBGEN_UA },
            redirect: "follow",
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!res.ok) continue;

          const html = await res.text();
          // An empty body means we followed a redirect to nothing useful.
          if (!html) continue;

          const m = html.match(/get\.php\?md5=[a-f0-9]+&key=[A-Za-z0-9]+/i);
          if (!m) continue;
          return `${proto}://${host}/${m[0]}`;
        } catch {
          /* try next page / proto / host */
        }
      }
    }
    throw new Error(`libgen ${host} no signed key`);
    };

  try {
    return await Promise.any(LIBGEN_SIGNED_HOSTS.map(tryHost));
  } catch (_) {
    return "";
  }
}
