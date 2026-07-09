const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Fix the community tab render
content = content.replace(/\{activeTab === "community" && \(\s*<HardcoverCommunityTab \/>\s*\)\}/, '');

// Fix duplicate 'Download' import. 
// Find: import { ..., Download, ..., Download } from "lucide-react";
// We can just use a regex to replace `Download,` safely. Actually, let's just make it unique.
content = content.replace(/Download,(\s*)Download/g, 'Download$1');

fs.writeFileSync('src/App.tsx', content);
