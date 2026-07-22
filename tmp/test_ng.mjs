import fs from 'fs';

async function testNetgalley() {
  const url = "https://www.netgalley.com/catalog/search?q=dune";
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0 Safari/537.36"
    }
  });
  const html = await res.text();
  console.log("Status:", res.status);
  fs.writeFileSync("/tmp/netgalley_page.html", html);
  console.log("Saved page HTML, length:", html.length);

  // Search for images
  const matches = html.match(/<img[^>]+>/g) || [];
  console.log("Total img tags:", matches.length);
  for (const img of matches) {
    if (img.includes("cover") || img.includes("catalog") || img.includes("netgalley") || img.includes("media")) {
      console.log("IMG:", img);
    }
  }

  // Search for links
  const links = html.match(/href="([^"]+)"/g) || [];
  const catalogLinks = links.filter(l => l.includes("catalog") || l.includes("title") || l.includes("book"));
  console.log("Catalog links found:", catalogLinks.slice(0, 15));
}

testNetgalley().catch(console.error);
