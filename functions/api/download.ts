export const onRequest = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const md5 = url.searchParams.get("md5");

  if (!md5) {
    return new Response(JSON.stringify({ error: "MD5 is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Simplified download logic for Cloudflare
  // In a real deployment, you'd replicate the cache check or mirror logic
  const downloadLinks = [
    {
      label: "Anna's Archive Mirror",
      url: `https://annas-archive.gl/md5/${md5}`,
      isDirect: false
    },
    {
      label: "Libgen Mirror",
      url: `http://libgen.rs/get.php?md5=${md5}`,
      isDirect: true
    }
  ];

  return new Response(JSON.stringify({ 
    downloadLinks, 
    options: downloadLinks,
    mirror: "Cloudflare Edge Mirror"
  }), {
    headers: { "Content-Type": "application/json" }
  });
};
