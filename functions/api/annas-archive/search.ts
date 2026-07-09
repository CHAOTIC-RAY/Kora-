import puppeteer from "@cloudflare/puppeteer";

export const onRequest = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const mode = url.searchParams.get("mode") || "ebooks";
  const source = url.searchParams.get("source") || "all";
  const page = url.searchParams.get("page") || "1";

  if (!query) {
    return new Response(JSON.stringify({ error: "Query 'q' is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const searchUrl = `https://ravebooksearch.com/?q=${encodeURIComponent(query)}&mode=${mode}&source=${source}&page=${page}`;
    
    // Use Cloudflare Browser Rendering
    const browser = await puppeteer.launch(env.BROWSER);
    const pageObj = await browser.newPage();
    await pageObj.goto(searchUrl, { waitUntil: "networkidle2" });
    
    // Scrape results
    const results = await pageObj.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      return links.map(a => {
        const text = (a.innerText || "").trim();
        const href = a.href || "";
        if (!href.includes("download") && !href.includes("md5") && !href.includes("get.php")) return null;
        
        const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length < 2) return null;

        const title = lines[0];
        let author = lines[1] || "Unknown Author";
        let sourceName = lines[lines.length - 1] || "Rave";
        
        let md5 = href.match(/[a-f0-9]{32}/i)?.[0] || btoa(href).substring(0, 32);

        return {
          id: md5,
          md5,
          title,
          author: author.split("·")[0].trim(),
          source: sourceName,
          downloadUrl: href,
          coverUrl: `https://annas-archive.gl/covers/${md5}.jpg`
        };
      }).filter(b => b !== null);
    });

    await browser.close();

    return new Response(JSON.stringify({ books: results, results }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
