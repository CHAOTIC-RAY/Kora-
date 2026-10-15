const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Replace "Proxy Browser" with "Downloads Manager"
content = content.replace(/<span>Proxy Browser<\/span>/g, '<span>Downloads Manager</span>');

// Remove Community tab in desktop
content = content.replace(/<button\s+id="community-tab"[\s\S]*?<span>Community<\/span>\s*<\/button>/, '');

// Remove Community from main view switch
content = content.replace(/\{activeTab === "community" && \([\s\S]*?\}\)/, '');

// Rename activeTab === "browser" to activeTab === "downloads"
content = content.replace(/"browser"/g, '"downloads"');
content = content.replace(/'browser'/g, "'downloads'");
content = content.replace(/Globe/g, 'Download'); // Globe icon to Download icon in top bar

// We need to make sure we replace InAppBrowser with DownloadsManager
content = content.replace(/import InAppBrowser from "\.\/components\/InAppBrowser";/, 'import DownloadsManager from "./components/DownloadsManager";');
content = content.replace(/<InAppBrowser[\s\S]*?\/>/, '<DownloadsManager />');

// Remove HardcoverCommunity import
content = content.replace(/import HardcoverCommunityTab from "\.\/components\/HardcoverCommunityTab";\n/, '');

fs.writeFileSync('src/App.tsx', content);
