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

const LIBGEN_SIGNED_HOSTS = [
  "libgen.li",
  "libgen.vg",
  "libgen.la",
  "libgen.bz",
  "libgen.gl",
  "libgen.gs",
  "libgen.st",
  "libgen.is",
  "libgen.rs",
];

const LIBGEN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

export async function resolveLibgenSigned(
  md5: string,
  timeoutMs = 2800
): Promise<string> {
  const tryHost = async (host: string): Promise<string> => {
    for (const proto of ["https", "http"] as const) {
      try {
        const res = await fetch(`${proto}://${host}/get.php?md5=${md5}`, {
          headers: { "User-Agent": LIBGEN_UA },
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;
        const html = await res.text();
        const m = html.match(/get\.php\?md5=[a-f0-9]+&key=[A-Za-z0-9]+/i);
        if (!m) continue;
        return `${proto}://${host}/${m[0]}`;
      } catch {
        /* try next proto */
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
