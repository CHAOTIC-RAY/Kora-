const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');

const replacement = `
// 7. API: Anna's Archive Download Mirrors (Replaced with Rave Search logic)
app.get("/api/annas-archive/download", async (req, res) => {
  try {
    const { md5 } = req.query;
    if (!md5) return res.status(400).json({ error: "md5 is required." });

    let downloadLinks = [];
    const cachedBook = bookCache.get(md5);

    if (cachedBook && cachedBook.downloadUrl) {
      downloadLinks.push({
        label: "Direct Download (Rave Book Search)",
        url: cachedBook.downloadUrl,
        isDirect: true
      });
    }

    if (downloadLinks.length === 0) {
      return res.status(404).json({ error: "No download links found." });
    }

    res.json({
      downloadLinks,
      options: downloadLinks
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
`;

// Replace from app.get("/api/annas-archive/download" up to the next route or end of function
let newContent = content.replace(/app\.get\("\/api\/annas-archive\/download"[\s\S]*?\/\/ 8\. API: Open Library/g, replacement + '\n// 8. API: Open Library');

fs.writeFileSync('server.ts', newContent);
