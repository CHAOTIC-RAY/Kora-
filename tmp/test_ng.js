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
  
  // Find cover images, titles, books, audiobooks
  const imgRegex = /<img[^>]+>/g;
  let match;
  console.log("--- IMAGES ---");
  while ((match = imgRegex.exec(html)) !== null) {
    if (match[0].includes("cover") || match[0].includes("catalog") || stroke(match[0])) {
      console.log(match[0]);
    }
  }

  // Look for title links
  console.log("--- TITLE LINKS ---");
  const linkRegex = /href="(\/catalog\/(?:title|book|audiobook)\/[^"]+)"/g;
  while ((match = linkRegex.exec(html)) !== null) {
    console.log(match[1]);
  }
}

function stroke(str) {
  return str.includes(".jpg") || str.includes(".png") || str.includes(".jpeg") || str.includes("netgalley");
}

testNetgalley().catch(console.error);
