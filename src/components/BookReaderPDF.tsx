import React, { useState, useEffect } from "react";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { getBookFile, deleteBookFile } from "../db/indexedDB";
import { 
  X, AlertCircle, AlertTriangle, RefreshCw, Database, Zap, FileText, Bookmark, Trash2,
  ChevronLeft, ChevronRight, Edit3, CheckCircle
} from "lucide-react";

interface BookReaderPDFProps {
  book: BookMetadata;
  userId: string;
  onClose: () => void;
  onProgressUpdate: (updatedBook: BookMetadata) => void;
}

export default function BookReaderPDF({ book, userId, onClose, onProgressUpdate }: BookReaderPDFProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // Manual Page Logging & Progress States
  const [currentPage, setCurrentPage] = useState<number>(book.progress?.pageNumber ?? 1);
  const [totalPages, setTotalPages] = useState<number>(book.progress?.totalPages ?? 100);
  const [notes, setNotes] = useState<string>(book.notes ?? "");
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [brightness, setBrightness] = useState<number>(100);
  const [theme, setTheme] = useState<string>("light"); // light, dark, sepia, green

  useEffect(() => {
    loadPdfBlob();
    return () => {
      // Cleanup blob url to prevent memory leaks
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [book.id]);

  // Auto-track reading focus session time (Reading Goals)
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const todayStr = new Date().toDateString();
        const savedStats = localStorage.getItem("kora_reading_stats");
        let stats = savedStats ? JSON.parse(savedStats) : {};
        
        if (!stats[todayStr]) {
          stats[todayStr] = { minutes: 0, date: todayStr };
        }
        stats[todayStr].minutes = (stats[todayStr].minutes || 0) + 1;
        
        localStorage.setItem("kora_reading_stats", JSON.stringify(stats));
      } catch (e) {
        console.error("Failed to log reading timer progress:", e);
      }
    }, 60000); // every minute
    
    return () => clearInterval(interval);
  }, []);

  async function loadPdfBlob() {
    try {
      setLoading(true);
      setError(null);

      const fileData = await getBookFile(book.id);
      if (!fileData) {
        throw new Error("PDF ebook is not cached locally. Please download or re-upload.");
      }

      const blobUrl = URL.createObjectURL(fileData.blob);
      setPdfUrl(blobUrl);
      setLoading(false);
    } catch (err: any) {
      console.error("PDF Loader Error:", err);
      setError(err.message || "Failed to load PDF file.");
      setLoading(false);
    }
  }

  async function handleSaveProgress() {
    setIsSaved(true);
    const validatedPage = Math.max(1, Math.min(totalPages, currentPage));
    const percent = totalPages > 0 ? Math.round((validatedPage / totalPages) * 100) : 0;
    
    const updated: BookMetadata = {
      ...book,
      notes: notes,
      status: percent === 100 ? "completed" : "reading",
      progress: {
        ...book.progress,
        pageNumber: validatedPage,
        totalPages: totalPages,
        percent,
        lastReadTime: Date.now()
      }
    };

    onProgressUpdate(updated);
    await syncBookToCloud(userId, updated);

    setTimeout(() => setIsSaved(false), 2000);
  }

  return (
    <div id="pdf-reader-container" className="fixed inset-0 z-[100] flex flex-col bg-kindle-bg text-kindle-text transition-colors duration-200">
      {/* Brightness Overlay */}
      <div 
        className="fixed inset-0 pointer-events-none z-[60] bg-black" 
        style={{ opacity: `${(100 - brightness) * 0.7}%` }} 
      />
      {/* 1. PDF Top Toolbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-kindle-border bg-opacity-95">
        <div className="flex items-center gap-4">
          <button 
            id="close-pdf-reader-btn"
            onClick={onClose} 
            className="p-2 rounded-xl hover:bg-neutral-500/10 transition text-kindle-text"
            title="Back to Library"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-kindle-text text-kindle-bg text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider font-sans shadow-xs">PDF</span>
              <h1 className="font-sans font-bold text-xs uppercase tracking-widest text-kindle-text-muted">
                {book.title}
              </h1>
            </div>
          </div>
        </div>

        {/* Sync status button */}
        <div className="flex items-center gap-2">
        </div>
      </header>

      {/* 2. Main PDF Screen Display */}
      <div className="flex-1 flex overflow-hidden">
        {/* PDF Frame Viewer */}
        <div className="flex-1 bg-[#f0ede8]/40 relative border-r border-[#e8e4de]">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#7c7467]">
              <div className="w-8 h-8 border-4 border-[#5c5346] border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-sans animate-pulse">Retrieving local PDF ebook...</p>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
              <div className="w-full bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-[2rem] p-8 md:p-10 shadow-xl flex flex-col items-center animate-in fade-in zoom-in-95 duration-500">
                <div className="w-20 h-20 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center mb-6 shadow-inner">
                  <AlertTriangle className="w-10 h-10 text-red-600 dark:text-red-400" />
                </div>
                
                <h2 className="text-xl md:text-2xl font-serif font-bold text-red-900 dark:text-red-100 mb-3">
                  PDF Reader Error
                </h2>
                
                <div className="bg-white/50 dark:bg-black/20 rounded-2xl p-4 mb-6 border border-red-200/50 dark:border-red-800/30 w-full">
                  <p className="text-xs md:text-sm text-red-700 dark:text-red-300 font-mono leading-relaxed break-words">
                    Error: {error}
                  </p>
                </div>

                <div className="space-y-4 text-left w-full">
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 font-medium px-1 uppercase tracking-widest opacity-70">
                    Troubleshooting Steps:
                  </p>
                  <ul className="grid grid-cols-1 gap-2.5">
                    {[
                      { icon: <RefreshCw className="w-3.5 h-3.5" />, text: "Try refreshing the page or restarting the reader." },
                      { icon: <Database className="w-3.5 h-3.5" />, text: "Clear local cache and re-download (mirror might have failed)." },
                      { icon: <FileText className="w-3.5 h-3.5" />, text: "Verify the file is a valid PDF (not an HTML error page)." },
                      { icon: <Zap className="w-3.5 h-3.5" />, text: "Ensure your browser supports native PDF viewing." }
                    ].map((step, idx) => (
                      <li key={idx} className="flex items-start gap-3 p-3 bg-white/40 dark:bg-white/5 rounded-xl border border-white/60 dark:border-white/5 shadow-sm">
                        <span className="mt-0.5 text-red-500">{step.icon}</span>
                        <span className="text-[11px] md:text-xs text-neutral-700 dark:text-neutral-300 leading-snug">{step.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full mt-8">
                  <button 
                    onClick={loadPdfBlob}
                    className="flex-1 px-6 py-3 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-all flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" /> Retry
                  </button>
                  <button 
                    onClick={async () => {
                      try {
                        await deleteBookFile(book.id);
                        onClose();
                      } catch (err) {
                        console.error("Failed to delete local cache", err);
                      }
                    }}
                    className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-xs font-bold uppercase tracking-widest shadow-lg shadow-red-600/20 transition-all flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" /> Reset & Close
                  </button>
                </div>
              </div>
            </div>
          ) : pdfUrl ? (
            /* Embedding the raw Blob PDF natively using the browser's incredibly rich viewer */
            <iframe
              src={`${pdfUrl}#toolbar=1&navpanes=1`}
              title={book.title}
              className="w-full h-full border-0 transition-all duration-300"
              style={{ 
                filter: theme === 'dark' ? 'invert(0.9) hue-rotate(180deg)' : 
                        theme === 'sepia' ? 'sepia(0.3) contrast(1.1)' :
                        theme === 'green' ? 'sepia(0.2) hue-rotate(60deg) saturate(1.2)' : 'none'
              }}
              referrerPolicy="no-referrer"
            />
          ) : null}
        </div>

        {/* Sidebar Panel for progress logging, notes, and AI Assistant */}
        <aside className="w-80 md:w-96 border-l border-kindle-border bg-kindle-bg flex flex-col overflow-y-auto text-kindle-text">
          {/* Section 1: Page Logging & Notebook */}
          <div className="p-6 border-b border-kindle-border space-y-5">
            <h3 className="text-[10px] font-bold tracking-widest uppercase text-kindle-text-muted flex items-center gap-2 font-sans">
              <Bookmark className="w-4 h-4 text-kindle-accent" />
              Reading Progress
            </h3>

            {/* Display Settings */}
            <div className="space-y-4 pt-2 border-b border-kindle-border pb-6">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted block mb-2">Brightness</label>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={brightness}
                  onChange={(e) => setBrightness(parseInt(e.target.value))}
                  className="w-full accent-kindle-accent h-1 bg-neutral-200 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted block mb-2">Display Theme</label>
                <div className="grid grid-cols-4 gap-2">
                  {['light', 'dark', 'sepia', 'green'].map(t => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={`py-2 text-[9px] font-bold uppercase rounded-lg border transition ${
                        theme === t ? "bg-kindle-text text-kindle-bg border-transparent" : "border-kindle-border hover:border-kindle-text-muted"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 font-sans text-xs">
                <div>
                  <label className="text-kindle-text-muted block mb-1.5 font-bold uppercase tracking-widest text-[9px]">Current</label>
                  <input
                    type="number"
                    min="1"
                    max={totalPages}
                    value={currentPage}
                    onChange={(e) => setCurrentPage(parseInt(e.target.value) || 1)}
                    className="w-full bg-white border border-kindle-border rounded-xl px-4 py-2.5 text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                  />
                </div>
                <div>
                  <label className="text-kindle-text-muted block mb-1.5 font-bold uppercase tracking-widest text-[9px]">Total</label>
                  <input
                    type="number"
                    min="1"
                    value={totalPages}
                    onChange={(e) => setTotalPages(parseInt(e.target.value) || 100)}
                    className="w-full bg-white border border-kindle-border rounded-xl px-4 py-2.5 text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                  />
                </div>
              </div>

              {/* Slider for quick setting */}
              <div className="pt-2">
                <input
                  type="range"
                  min="1"
                  max={totalPages}
                  value={currentPage}
                  onChange={(e) => setCurrentPage(parseInt(e.target.value) || 1)}
                  className="w-full accent-kindle-accent h-1.5 bg-neutral-200 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-kindle-text-muted font-bold uppercase tracking-widest mt-2">
                  <span>Start</span>
                  <span>{Math.round((currentPage / totalPages) * 100)}%</span>
                  <span>End</span>
                </div>
              </div>

              {/* Reader Notes */}
              <div>
                <label className="text-[10px] text-kindle-text-muted font-bold uppercase tracking-widest block mb-2 flex items-center gap-2">
                  <Edit3 className="w-3.5 h-3.5 text-kindle-accent" />
                  Notes & Highlights
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Journal your thoughts..."
                  rows={4}
                  className="w-full text-xs bg-white border border-kindle-border rounded-xl p-3.5 text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent placeholder-kindle-text-muted resize-none font-sans"
                />
              </div>

              <button
                onClick={handleSaveProgress}
                className={`w-full py-3.5 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition shadow-sm ${
                  isSaved 
                    ? "bg-emerald-700 text-white" 
                    : "bg-kindle-text hover:bg-kindle-accent text-kindle-bg"
                }`}
              >
                {isSaved ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Synced</span>
                  </>
                ) : (
                  <span>Sync Progress</span>
                )}
              </button>

              <button
                onClick={() => {
                  const content = `Book: ${book.title}\nAuthor: ${book.author}\n\nNotes:\n${notes || "No notes yet."}`;
                  const url = `https://github.com/CHAOTIC-RAY/Pensieve?content=${encodeURIComponent(content)}`;
                  window.open(url, "_blank");
                }}
                className="w-full py-2.5 bg-neutral-100 text-kindle-text border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-neutral-200 transition"
              >
                Export to Pensieve
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
