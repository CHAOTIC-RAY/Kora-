import fs from 'fs';

const path = 'src/components/LibraryManager.tsx';
let content = fs.readFileSync(path, 'utf8');

const handler = [
'  const importFileRef = useRef<HTMLInputElement>(null);',
'  const [isImportingFile, setIsImportingFile] = useState<boolean>(false);',
'  const handleImportFromDevice = () => {',
'    importFileRef.current?.click();',
'  };',
'  const handleFileSelected = async (e) => {',
'    const file = e.target.files?.[0];',
'    if (!file) return;',
'    setIsImportingFile(true);',
'    try {',
'      const arrayBuffer = await file.arrayBuffer();',
'      const blob = new Blob([arrayBuffer], { type: file.type || "application/octet-stream" });',
'      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";',
'      const supported = new Set(["epub", "pdf", "mobi", "azw3", "cbr", "cbz", "txt"]);',
'      if (!supported.has(ext)) {',
'        alert(`Unsupported file type: .${ext}`);',
'        return;',
'      }',
'      const bookId = "imported_" + Date.now().toString(36);',
'      const fileName = file.name;',
'      await storeBookFile(bookId, blob, fileName, ext);',
'      const sizeKB = Math.round(blob.size / 1024);',
'      const title = file.name.replace(/\.[^/.]+$/, "");',
'      const newBook = {',
'        id: bookId,',
'        title,',
'        author: "",',
'        extension: ext,',
'        size: `${sizeKB} KB`,',
'        language: "English",',
'        tags: ["imported", ext],',
'        status: "to-read",',
'        progress: { percent: 0, lastReadTime: Date.now() },',
'        dateAdded: Date.now(),',
'      };',
'      await syncBookToCloud(userId, newBook);',
'      await onCachedIdsChanged();',
'      onRefreshLibrary();',
'      onBookSelected(newBook);',
'    } catch (err) {',
'      console.error("Import failed:", err);',
'      alert("Failed to import book file");',
'    } finally {',
'      setIsImportingFile(false);',
'      if (importFileRef.current) importFileRef.current.value = "";',
'    }',
'  };',
].join('\n');

const card = [
'          {/* Option 3: Import from Device */}',
'          <button',
'            type="button"',
'            onClick={handleImportFromDevice}',
'            className="w-full text-left p-4 rounded-2xl border border-kindle-border bg-kindle-bg/50 hover:bg-sky-500/10 hover:border-sky-500/40 group transition duration-200 flex items-start gap-4 cursor-pointer"',
'          >',
'            <div className="p-3 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400 border sky-500/30 group-hover:scale-105 transition shrink-0">',
'              <HardDrive className="w-6 h-6" />',
'            </div>',
'            <div className="flex-1 min-w-0">',
'              <div className="flex items-center justify-between">',
'                <h4 className="text-sm font-bold text-kindle-text group-hover:text-sky-600 dark:group-hover:text-sky-400 transition">',
'                  Import from Device',
'                </h4>',
'                <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border sky-500/20">',
'                  Upload',
'                </span>',
'              </div>',
'              <p className="text-xs text-kindle-text-muted mt-1 leading-relaxed">',
'                Load EPUB, PDF, MOBI, AZW3, CBR, CBZ, or TXT files directly from your device.',
'              </p>',
'            </div>',
'          </button>',
'          <input',
'            type="file"',
'            ref={importFileRef}',
'            style={{ display: "none" }}',
'            onChange={handleFileSelected}',
'            accept=".epub,.pdf,.mobi,.azw3,.cbr,.cbz,.txt"',
'          />',
].join('\n');

const marker1 = '  const [isCreatingFromTemplate, setIsCreatingFromTemplate] = useState<boolean>(false);';
const marker2 = '          <div className="pt-2 text-center text-[10px] text-kindle-text-muted font-mono uppercase tracking-widest">';

content = content.replace(marker1, handler + '\n' + marker1);
content = content.replace(marker2, card.join('\n') + '\n' + marker2);

fs.writeFileSync(path, content);
console.log('Done. Size:', content.length);
