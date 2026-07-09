const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/\{activeTab === "downloads" && \(\s*<InAppBrowser[\s\S]*?\/>\s*\)\}/, '{activeTab === "downloads" && <DownloadsManager />}');
content = content.replace(/\{activeTab === "browser" && \(\s*<InAppBrowser[\s\S]*?\/>\s*\)\}/, '{activeTab === "downloads" && <DownloadsManager />}');
content = content.replace(/"browser"/g, '"downloads"');
content = content.replace(/'browser'/g, "'downloads'");

fs.writeFileSync('src/App.tsx', content);
