const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');

const newRoute = `
// 6. API: Anna's Archive Search - Replaced with Rave Book Search
app.get("/api/annas-archive/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Query 'q' is required." });
    console.log(\`Executing Rave Book Search for query: "\${q}"\`);
    
    // Run Rave Search directly
    const raveResults = await fetchFromRaveBookSearch(q as string);
    
    // Populate global bookCache
    raveResults.forEach(b => bookCache.set(b.md5, b));

    res.json({
      books: raveResults,
      results: raveResults,
      mirror: "Rave Book Search API",
      parsedBy: "Rave Worker"
    });
  } catch (err: any) {
    console.error("Rave Book Search API failed:", err);
    res.status(500).json({ error: err.message });
  }
});

`;

const marker = 'app.get("/api/annas-archive/search_OLD", async (req, res) => {';
const newContent = content.replace(marker, newRoute + marker);
fs.writeFileSync('server.ts', newContent);
