export const onRequest = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const md5 = url.searchParams.get("md5");
  const iaId = url.searchParams.get("iaId") || "";
  const raveDirect = url.searchParams.get("url"); // Rave's signed direct URL from search results

  if (!md5 && !raveDirect) {
    return new Response(JSON.stringify({ error: "MD5 or direct URL is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const isRealMd5 = !!md5 && /^[a-f0-9]{32}$/i.test(md5);

  let downloadLinks: any[] = [];

  // Resolve a keyless LibGen landing page to its signed CDN link (get.php?md5&key).
  async function resolveLibgenSigned(m: string): Promise<string> {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
    for (const host of ["libgen.li", "libgen.is", "libgen.rs"]) {
      try {
        const res = await fetch(`https://${host}/get.php?md5=${m}`, {
          headers: { "User-Agent": ua },
          redirect: "follow"
        });
        if (!res.ok) continue;
        const html = await res.text();
        const mm = html.match(/get\.php\?md5=[a-f0-9]+&key=[A-Za-z0-9]+/i);
        if (mm) return `https://${host}/${mm[0]}`;
      } catch (_) { /* try next host */ }
    }
    return "";
  }

  // PRIMARY: use Rave Book Search's real direct-download link (same method as ravebooksearch.com).
  // LibGen -> signed get.php?md5=<hash>&key=<token> that 307-redirects to the booksdl.lc CDN.
  // Internet Archive -> /details/ page (resolved to the actual file by /api/proxy-file).
  if (raveDirect) {
    try {
      const parsed = new URL(raveDirect);
      const isDirectLink =
        /get\.php\?md5=.+&key=/.test(parsed.pathname + parsed.search) ||
        parsed.hostname.includes("archive.org");
      if (isDirectLink) {
        downloadLinks.push({
          label: "Rave Direct (LibGen CDN)",
          url: parsed.toString(),
          isDirect: true,
          sourceId: "rave"
        });
      }
    } catch (_) { /* ignore malformed url */ }
  }

  if (isRealMd5) {
    // Prefer the signed LibGen CDN link resolved server-side so downloads work
    // even when the frontend has no Rave directUrl.
    let signed = "";
    if (raveDirect && /get\.php\?md5=.+&key=/.test(raveDirect)) {
      signed = raveDirect;
    } else {
      signed = await resolveLibgenSigned(md5);
    }
    if (signed) {
      downloadLinks.push({
        label: "Direct Mirror (LibGen CDN)",
        url: signed,
        isDirect: true,
        sourceId: "libgen"
      });
    }
    // Reliable fallbacks (kept last; library.lol is often unreachable).
    downloadLinks.push(
      {
        label: "Libgen Mirror (libgen.li)",
        url: `https://libgen.li/get.php?md5=${md5.toLowerCase()}`,
        isDirect: true
      },
      {
        label: "Anna's Archive",
        url: `https://annas-archive.gl/md5/${md5}`,
        isDirect: false
      }
    );
  } else if (iaId && downloadLinks.length === 0) {
    // Internet Archive item with known iaId — proxy through /api/proxy-file
    downloadLinks.push(
      {
        label: "Internet Archive (Direct Download)",
        url: `/api/proxy-file?url=${encodeURIComponent(`https://archive.org/details/${iaId}`)}`,
        isDirect: true
      },
      {
        label: "Internet Archive (Browse Page)",
        url: `https://archive.org/details/${iaId}`,
        isDirect: false
      }
    );
  } else if (downloadLinks.length === 0) {
    // Generic fallback
    downloadLinks.push({
      label: "Search Anna's Archive",
      url: `https://annas-archive.gl/search`,
      isDirect: false
    });
  }

  return new Response(JSON.stringify({
    downloadLinks,
    options: downloadLinks,
    mirror: "Cloudflare Edge Resolver",
    parsedBy: "Rave Direct Integration"
  }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
};
