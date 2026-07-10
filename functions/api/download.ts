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
    // Real MD5 — libgen/library.lol links work (fallbacks after the Rave direct link)
    downloadLinks.push(
      {
        label: "Direct Mirror (library.lol)",
        url: `https://library.lol/main/${md5}`,
        isDirect: true
      },
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
