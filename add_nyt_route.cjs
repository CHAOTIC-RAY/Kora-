const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const nytRoute = `
// NYT Best Sellers API
app.get("/api/nytimes/overview", async (req, res) => {
  try {
    const apiKey = process.env.NYT_BOOKS_API_KEY;
    const response = await fetch(\`https://api.nytimes.com/svc/books/v3/lists/overview.json?api-key=\${apiKey}\`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("NYT API failed:", err);
    res.status(500).json({ error: "Failed to fetch NYT data" });
  }
});
`;

// Insert after the existing API routes block, e.g., after the download options route
content = content.replace('app.get("/api/download-options", async (req, res) => {', nytRoute + '\napp.get("/api/download-options", async (req, res) => {');

fs.writeFileSync('server.ts', content);
