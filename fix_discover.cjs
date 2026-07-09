const fs = require('fs');
let content = fs.readFileSync('src/components/DiscoverView.tsx', 'utf8');

// Replace "Anna's Archive" in error handling string
content = content.replace(/Anna's:/g, 'Rave Search:');

// Remove Z-Library search logic in handleSearch
content = content.replace(/\/\/ 2\. Search Z-Library if enabled[\s\S]*?setResults\(combinedResults\);/, 'setResults(combinedResults);');

// Fix headers in DiscoverView render
content = content.replace(/LIVE · ANNA'S ARCHIVE · Z-LIBRARY · LIBRARY GENESIS · OPEN LIBRARY/, 'LIVE · RAVE BOOK SEARCH');

fs.writeFileSync('src/components/DiscoverView.tsx', content);
