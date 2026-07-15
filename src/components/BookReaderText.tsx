import React, { useEffect, useState, useRef } from "react";
import { ArrowLeft, RefreshCw, Database, FileText, Trash2, Settings, Type, Copy, Sparkles, Check, Globe } from "lucide-react";
import { getBookFile, deleteBookFile } from "../db/indexedDB";

interface BookReaderTextProps {
  book: any;
  onClose: () => void;
  readerPrefs?: {
    fontSize: number;
    lineSpacing: number;
    fontFamily: string;
    theme: string;
    marginSize: string;
    brightness: number;
    letterSpacing?: string;
  };
  onReaderPrefsChange?: (prefs: any) => void;
}

const themes: Record<string, { bg: string; text: string; border: string; card: string }> = {
  light: { bg: "bg-[#fcfcf9]", text: "text-[#111]", border: "border-[#e6e2da]", card: "bg-[#f5f1e8]" },
  dark: { bg: "bg-[#121212]", text: "text-[#e0e0e0]", border: "border-[#2a2a2a]", card: "bg-[#1c1c1c]" },
  sepia: { bg: "bg-[#f4ecd8]", text: "text-[#5c4033]", border: "border-[#e4d6be]", card: "bg-[#eae0cb]" },
  green: { bg: "bg-[#e2edd2]", text: "text-[#2e4c2e]", border: "border-[#d2dfbd]", card: "bg-[#d8e5c5]" }
};

export default function BookReaderText({ book, onClose, readerPrefs, onReaderPrefsChange }: BookReaderTextProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Reading mode state variables
  const [fontSize, setFontSize] = useState<number>(readerPrefs?.fontSize ?? 18);
  const [fontFamily, setFontFamily] = useState<string>(readerPrefs?.fontFamily ?? "font-serif");
  const [theme, setTheme] = useState<string>(readerPrefs?.theme ?? "light");
  const [marginSize, setMarginSize] = useState<string>(readerPrefs?.marginSize ?? "max-w-2xl");
  const [lineSpacing, setLineSpacing] = useState<number>(readerPrefs?.lineSpacing ?? 1.6);
  const [brightness, setBrightness] = useState<number>(readerPrefs?.brightness ?? 100);
  const [letterSpacing, setLetterSpacing] = useState<string>(readerPrefs?.letterSpacing ?? "tracking-normal");
  
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const fontFamilies = [
    { name: "Lora Serif", value: "font-serif" },
    { name: "Inter Sans", value: "font-sans" },
    { name: "JetBrains Mono", value: "font-mono" }
  ];

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const fileData = await getBookFile(book.id);
      if (fileData) {
        const text = await fileData.blob.text();
        setContent(text);
      } else {
        throw new Error("Text file is not cached locally.");
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to load text file.");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [book.id]);

  useEffect(() => {
    if (onReaderPrefsChange) {
      onReaderPrefsChange({
        fontSize,
        fontFamily,
        theme,
        marginSize,
        lineSpacing,
        brightness,
        letterSpacing
      });
    }
  }, [fontSize, fontFamily, theme, marginSize, lineSpacing, brightness, letterSpacing, onReaderPrefsChange]);

  const activeTheme = themes[theme] || themes.sepia;

  return (
    <div id="text-reader-container" className={`fixed inset-0 z-50 flex flex-col ${activeTheme.bg} ${activeTheme.text} transition-colors duration-200`}>
      {/* Brightness Overlay */}
      <div 
        className="fixed inset-0 pointer-events-none z-[60] bg-black" 
        style={{ opacity: `${(100 - brightness) * 0.7}%` }} 
      />

      {/* Header Toolbar */}
      <div className={`h-14 flex items-center justify-between px-4 border-b ${activeTheme.border} shrink-0 bg-opacity-95`}>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-neutral-500/10 transition text-current">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-xs font-bold uppercase tracking-widest opacity-80 truncate max-w-[200px]">{book.title}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              navigator.clipboard.writeText(content || "");
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="p-2 rounded-xl hover:bg-neutral-500/10 transition text-current"
            title="Copy all text"
          >
            {copied ? <Check className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-xl hover:bg-neutral-500/10 transition ${showSettings ? 'bg-neutral-500/20' : ''}`}
            title="Display Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Settings Sidebar */}
        {showSettings && (
          <aside className={`w-full md:w-80 h-[50vh] md:h-auto border-b md:border-b-0 md:border-r ${activeTheme.border} ${activeTheme.card} p-5 overflow-y-auto z-40 flex flex-col shrink-0 absolute md:relative bottom-0 left-0 right-0 md:bottom-auto md:top-auto`}>
            <div className={`pb-3 mb-4 border-b ${activeTheme.border} flex justify-between items-center`}>
              <span className="font-sans font-semibold text-sm flex items-center gap-2">
                <Type className="w-4 h-4" />
                Reader Settings
              </span>
              <button onClick={() => setShowSettings(false)} className="text-xs p-1 hover:bg-neutral-500/10 rounded">
                Close
              </button>
            </div>

            {/* Font Family */}
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-2">Font Style</label>
              <div className="grid grid-cols-3 gap-2">
                {fontFamilies.map((ff) => (
                  <button
                    key={ff.value}
                    onClick={() => setFontFamily(ff.value)}
                    className={`p-2 text-xs rounded-lg border text-center font-sans transition ${
                      fontFamily === ff.value
                        ? "border-[#5c5346] bg-[#5c5346]/10 font-semibold"
                        : "border-neutral-500/20 hover:border-neutral-500/50"
                    }`}
                  >
                    {ff.name.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size */}
            <div className="mb-5">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs opacity-75 font-sans">Font Size</label>
                <span className="text-xs font-mono">{fontSize}px</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setFontSize(Math.max(12, fontSize - 1))}
                  className="flex-1 p-2 border border-neutral-500/20 rounded-lg text-sm hover:bg-neutral-500/10 font-bold"
                >
                  A -
                </button>
                <button
                  onClick={() => setFontSize(Math.min(32, fontSize + 1))}
                  className="flex-1 p-2 border border-neutral-500/20 rounded-lg text-sm hover:bg-neutral-500/10 font-bold"
                >
                  A +
                </button>
              </div>
            </div>

            {/* Reading Themes */}
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-2">Reading Theme</label>
              <div className="grid grid-cols-4 gap-1.5">
                {Object.keys(themes).map((tKey) => {
                  const th = themes[tKey];
                  return (
                    <button
                      key={tKey}
                      onClick={() => setTheme(tKey)}
                      className={`h-10 rounded-lg border flex items-center justify-center text-xs font-semibold capitalize ${th.bg} ${th.text} ${
                        theme === tKey ? "ring-2 ring-[#5c5346] border-transparent" : "border-neutral-500/20"
                      }`}
                    >
                      {tKey}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Line Spacing */}
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-2">Line Spacing</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[1.2, 1.6, 2.0].map((spacing) => (
                  <button
                    key={spacing}
                    onClick={() => setLineSpacing(spacing)}
                    className={`p-2 text-xs rounded-lg border text-center font-sans transition ${
                      lineSpacing === spacing
                        ? "bg-[#5c5346] text-white border-transparent"
                        : "border-neutral-500/20 hover:border-neutral-500/50"
                    }`}
                  >
                    {spacing === 1.2 ? "Compact" : spacing === 1.6 ? "Regular" : "Wide"}
                  </button>
                ))}
              </div>
            </div>

            {/* Brightness */}
            <div className="mb-5">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs opacity-75 font-sans">Brightness</label>
                <span className="text-[10px] font-mono">{brightness}%</span>
              </div>
              <input
                type="range"
                min="20"
                max="100"
                value={brightness}
                onChange={(e) => setBrightness(parseInt(e.target.value))}
                className="w-full accent-neutral-500 h-1 bg-neutral-200 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Margins */}
            <div className="mb-5">
              <label className="text-xs opacity-75 font-sans block mb-2">Margins</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: "None", val: "max-w-full" },
                  { label: "Narrow", val: "max-w-2xl px-6" },
                  { label: "Wide", val: "max-w-xl px-12" }
                ].map((m) => (
                  <button
                    key={m.val}
                    onClick={() => setMarginSize(m.val)}
                    className={`p-2 text-xs rounded-lg border text-center font-sans transition ${
                      marginSize === m.val
                        ? "bg-[#5c5346] text-white border-transparent"
                        : "border-neutral-500/20 hover:border-neutral-500/50"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Export */}
            <div className="pt-4 border-t border-neutral-500/20 space-y-2">
              <button
                onClick={() => {
                  const exportContent = `Book: ${book.title}\n\n${content || ""}`;
                  const url = `https://github.com/CHAOTIC-RAY/Pensieve?content=${encodeURIComponent(exportContent)}`;
                  window.open(url, "_blank");
                }}
                className="w-full py-2.5 bg-[#1A1A1A] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-black transition shadow-sm"
              >
                Export to Pensieve
              </button>
            </div>
          </aside>
        )}

        {/* Content Viewer viewport */}
        <div className="flex-1 overflow-auto p-4 md:p-8 bg-transparent">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto bg-transparent">
              <div className="w-full bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-[2rem] p-8 md:p-10 shadow-xl flex flex-col items-center">
                <span className="text-red-500 text-xs font-mono">{error}</span>
                <button onClick={load} className="mt-4 px-6 py-2 border rounded-xl flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
                  <RefreshCw className="w-4 h-4" /> Retry
                </button>
              </div>
            </div>
          ) : book.extension === "html" || book.extension === "htm" ? (
            <div className={`${marginSize} mx-auto h-full`}>
              <iframe 
                className={`w-full h-full border-0 rounded-2xl shadow-sm`} 
                style={{ 
                  filter: theme === 'dark' ? 'invert(0.9) hue-rotate(180deg)' : 
                          theme === 'sepia' ? 'sepia(0.3) contrast(1.05)' :
                          theme === 'green' ? 'sepia(0.1) hue-rotate(60deg) saturate(1.2)' : 'none'
                }}
                srcDoc={content || ""} 
                sandbox="allow-same-origin allow-scripts" 
                title={book.title} 
              />
            </div>
          ) : (
            <div className={`${marginSize} mx-auto text-left leading-relaxed ${fontFamily} ${letterSpacing}`} style={{ fontSize: `${fontSize}px`, lineHeight: lineSpacing }}>
              <pre className="whitespace-pre-wrap font-inherit">{content}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
