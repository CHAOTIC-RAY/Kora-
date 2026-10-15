import React, { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { getBookFile, deleteBookFile } from "../db/indexedDB";
import { getTimeOfDayAutoTheme } from "../lib/readerThemes";
import { 
  X, AlertCircle, AlertTriangle, RefreshCw, Database, Zap, FileText, Bookmark, Trash2,
  ChevronLeft, ChevronRight, Edit3, CheckCircle, Sliders, ExternalLink,
  ZoomIn, ZoomOut, Maximize2, Moon, Sun
} from "lucide-react";

// Configure pdfjs worker to reliable Cloudflare CDN matching pdfjs version or default
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
} catch (e) {
  console.warn("PDFjs worker setup warning:", e);
}

interface BookReaderPDFProps {
  book: BookMetadata;
  userId: string;
  onClose: () => void;
  onProgressUpdate: (updatedBook: BookMetadata) => void;
}

export default function BookReaderPDF({ book, userId, onClose, onProgressUpdate }: BookReaderPDFProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [rendering, setRendering] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // PDF Engine States
  const pdfDocRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<any>(null);

  // Reader Progress & View States
  const [currentPage, setCurrentPage] = useState<number>(book.progress?.pageNumber ?? 1);
  const [totalPages, setTotalPages] = useState<number>(book.progress?.totalPages ?? 1);
  const [zoomScale, setZoomScale] = useState<number>(1.2);
  const [notes, setNotes] = useState<string>(book.notes ?? "");
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [brightness, setBrightness] = useState<number>(100);
  const [theme, setTheme] = useState<string>("light"); // light, dark, sepia, green
  const [autoAdjustTheme, setAutoAdjustTheme] = useState<boolean>(true);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false); // Bottom sheet settings
  const [useNativeViewer, setUseNativeViewer] = useState<boolean>(false);

  // Handle auto theme
  useEffect(() => {
    if (autoAdjustTheme) {
      setTheme(getTimeOfDayAutoTheme());
    }
  }, [autoAdjustTheme]);

  // Auto-track reading focus session time
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

  // Load PDF Blob/ArrayBuffer
  useEffect(() => {
    loadPdfBlob();
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [book.id]);

  async function loadPdfBlob() {
    try {
      setLoading(true);
      setError(null);

      let arrayBuffer: ArrayBuffer | null = null;
      let blob: Blob | null = null;

      // 1. Try local IndexedDB
      const fileData = await getBookFile(book.id);
      if (fileData?.blob) {
        blob = fileData.blob;
        arrayBuffer = await blob.arrayBuffer();
      } else if (book.downloadUrl) {
        // 2. Remote download fallback
        const targetUrl = book.downloadUrl;
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error(`HTTP Error ${res.status} fetching PDF file.`);
        arrayBuffer = await res.arrayBuffer();
        blob = new Blob([arrayBuffer], { type: "application/pdf" });
      }

      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error("PDF file data is empty or not cached locally. Please re-download or re-upload.");
      }

      // Create object URL for native iframe fallback option
      if (blob) {
        const pdfBlob = new Blob([arrayBuffer], { type: "application/pdf" });
        const blobUrl = URL.createObjectURL(pdfBlob);
        setPdfUrl(blobUrl);
      }

      // Load with pdfjs-dist
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const doc = await loadingTask.promise;
      pdfDocRef.current = doc;
      
      const numPages = doc.numPages;
      setTotalPages(numPages);
      
      const initialPage = Math.max(1, Math.min(numPages, currentPage));
      setCurrentPage(initialPage);

      setLoading(false);
    } catch (err: any) {
      console.error("PDF Loader Error:", err);
      setError(err.message || "Failed to load PDF file.");
      setLoading(false);
    }
  }

  // Render Page onto Canvas
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDocRef.current || !canvasRef.current || useNativeViewer) return;
    try {
      setRendering(true);

      // Cancel any ongoing render task
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (_) {}
      }

      const doc = pdfDocRef.current;
      const validPage = Math.max(1, Math.min(doc.numPages, pageNum));
      const page = await doc.getPage(validPage);

      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;

      // Calculate viewport scale based on container width & zoom scale
      const container = containerRef.current;
      const containerWidth = container ? Math.max(280, container.clientWidth - 32) : window.innerWidth - 32;
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      const fitScale = (containerWidth / unscaledViewport.width) * zoomScale;
      const viewport = page.getViewport({ scale: Math.max(0.4, Math.min(3.5, fitScale)) });

      // HiDPI / Retina Crisp Display
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

      const renderContext = {
        canvasContext: context,
        transform: transform,
        viewport: viewport,
      };

      const task = page.render(renderContext);
      renderTaskRef.current = task;
      await task.promise;
      setRendering(false);
    } catch (err: any) {
      if (err?.name !== "RenderingCancelledException") {
        console.error("PDF Page Render Error:", err);
      }
      setRendering(false);
    }
  }, [zoomScale, useNativeViewer]);

  // Re-render when page, zoom, or component loads
  useEffect(() => {
    if (!loading && !error && pdfDocRef.current) {
      renderPage(currentPage);
    }
  }, [currentPage, zoomScale, loading, error, renderPage]);

  // Window resize listener to scale canvas smoothly
  useEffect(() => {
    function handleResize() {
      if (!loading && pdfDocRef.current) {
        renderPage(currentPage);
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [currentPage, loading, renderPage]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        goToPrevPage();
      } else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        goToNextPage();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPage, totalPages]);

  // Auto-save progress
  useEffect(() => {
    if (loading || error) return;
    const timeout = setTimeout(() => {
      saveProgressSilently();
    }, 2000); // 2 second debounce for auto-saving
    return () => clearTimeout(timeout);
  }, [currentPage, notes]);

  async function saveProgressSilently() {
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
    await syncBookToCloud(userId, updated).catch(err => console.error("Auto-save sync failed", err));
  }

  const goToPrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  async function handleSaveProgress() {
    setIsSaved(true);
    await saveProgressSilently();
    setTimeout(() => setIsSaved(false), 2000);
  }

  return (
    <div id="pdf-reader-container" className="fixed inset-0 z-[100] flex flex-col bg-kindle-bg text-kindle-text transition-colors duration-200 overflow-hidden">
      {/* Brightness Overlay */}
      <div 
        className="fixed inset-0 pointer-events-none z-[60] bg-black" 
        style={{ opacity: `${(100 - brightness) * 0.7}%` }} 
      />

      {/* 1. PDF Top Navigation Toolbar */}
      <header className="flex items-center justify-between px-3 sm:px-6 py-3 border-b border-kindle-border bg-kindle-bg/95 backdrop-blur-md z-50 shrink-0 select-none">
        <div className="flex items-center gap-2 overflow-hidden mr-2">
          <button 
            id="close-pdf-reader-btn"
            onClick={onClose} 
            className="p-2 rounded-xl hover:bg-neutral-500/10 transition text-kindle-text shrink-0 cursor-pointer"
            title="Back to Library"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex items-center gap-2">
            <span className="bg-kindle-text text-kindle-bg text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider font-sans shrink-0">PDF</span>
            <h1 className="font-sans font-bold text-xs sm:text-sm uppercase tracking-wider text-kindle-text truncate max-w-[160px] sm:max-w-xs md:max-w-md">
              {book.title}
            </h1>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {pdfUrl && (
            <button
              onClick={() => window.open(pdfUrl, '_blank')}
              className="p-2 sm:px-3 sm:py-2 rounded-xl border border-kindle-border text-kindle-text-muted hover:text-kindle-text hover:bg-neutral-500/10 transition flex items-center gap-1.5 text-xs font-bold cursor-pointer"
              title="Open PDF in Fullscreen / New Tab"
            >
              <ExternalLink className="w-4 h-4" />
              <span className="hidden md:inline">Open in New Tab</span>
            </button>
          )}

          {/* Bottom Sheet Settings Toggle Button */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`p-2 sm:px-3 sm:py-2 rounded-xl border transition flex items-center gap-1.5 text-xs font-bold cursor-pointer ${
              sidebarOpen 
                ? "bg-kindle-text text-kindle-bg border-transparent shadow-xs" 
                : "border-kindle-border text-kindle-text hover:bg-neutral-500/10"
            }`}
            title="PDF Settings & Notes"
          >
            <Sliders className="w-4 h-4" />
            <span className="hidden sm:inline">Settings & Notes</span>
          </button>
        </div>
      </header>

      {/* 2. Main PDF Canvas Display Stage */}
      <div className="flex-1 flex flex-col relative overflow-hidden bg-neutral-900/10 dark:bg-black/30">
        <div 
          ref={containerRef}
          className="flex-1 overflow-auto flex flex-col items-center justify-start p-2 sm:p-6 relative select-none scrollbar-thin"
        >
          {loading ? (
            <div className="my-auto flex flex-col items-center justify-center gap-3 text-[#7c7467] py-20">
              <div className="w-10 h-10 border-4 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-bold tracking-wider uppercase animate-pulse">Loading PDF Document...</p>
            </div>
          ) : error ? (
            <div className="my-auto p-6 text-center max-w-lg mx-auto">
              <div className="w-full bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-3xl p-6 md:p-8 shadow-xl flex flex-col items-center animate-in fade-in">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center mb-4">
                  <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
                </div>
                
                <h2 className="text-lg font-bold text-red-900 dark:text-red-100 mb-2">
                  PDF Reader Couldn't Load Ebook
                </h2>
                
                <p className="text-xs text-red-700 dark:text-red-300 font-mono mb-6 leading-relaxed break-words bg-white/50 dark:bg-black/20 p-3 rounded-xl w-full">
                  {error}
                </p>

                <div className="flex flex-col sm:flex-row gap-3 w-full">
                  <button 
                    onClick={loadPdfBlob}
                    className="flex-1 px-4 py-3 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-neutral-100 transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" /> Retry Loading
                  </button>
                  {pdfUrl && (
                    <button 
                      onClick={() => window.open(pdfUrl, '_blank')}
                      className="flex-1 px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ExternalLink className="w-4 h-4" /> Open Native
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : useNativeViewer && pdfUrl ? (
            /* Fallback Native Embed Viewer */
            <iframe
              src={`${pdfUrl}#toolbar=1&navpanes=1`}
              title={book.title}
              className="w-full h-full border-0 transition-all duration-300 rounded-xl"
              style={{ 
                filter: theme === 'dark' ? 'invert(0.9) hue-rotate(180deg)' : 
                        theme === 'sepia' ? 'sepia(0.3) contrast(1.1)' :
                        theme === 'green' ? 'sepia(0.2) hue-rotate(60deg) saturate(1.2)' : 'none'
              }}
            />
          ) : (
            /* High-Fidelity Canvas Page Render */
            <div className="relative my-auto py-2 flex flex-col items-center">
              <div 
                className="relative shadow-2xl rounded-sm transition-all duration-200 overflow-hidden"
                style={{ 
                  filter: theme === 'dark' ? 'invert(0.9) hue-rotate(180deg)' : 
                          theme === 'sepia' ? 'sepia(0.3) contrast(1.1)' :
                          theme === 'green' ? 'sepia(0.2) hue-rotate(60deg) saturate(1.2)' : 'none'
                }}
              >
                <canvas 
                  ref={canvasRef} 
                  className="block max-w-full h-auto mx-auto rounded-xs bg-white"
                />
                {rendering && (
                  <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Rendering...</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3. Floating Bottom Page Navigation Controls */}
        {!loading && !error && (
          <div className="px-4 py-3 border-t border-kindle-border bg-kindle-bg/95 backdrop-blur-md z-40 flex items-center justify-between gap-2 shrink-0 select-none">
            <button
              onClick={goToPrevPage}
              disabled={currentPage <= 1}
              className="px-3 py-2 rounded-xl border border-kindle-border hover:bg-neutral-500/10 disabled:opacity-30 disabled:pointer-events-none transition flex items-center gap-1 text-xs font-bold cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Previous</span>
            </button>

            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-kindle-text-muted">Page</span>
              <input
                type="number"
                min="1"
                max={totalPages}
                value={currentPage}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val)) {
                    setCurrentPage(Math.max(1, Math.min(totalPages, val)));
                  }
                }}
                className="w-14 text-center text-xs font-bold bg-white dark:bg-neutral-800 border border-kindle-border rounded-lg py-1 px-1 text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
              />
              <span className="text-xs font-mono font-bold text-kindle-text-muted">of {totalPages}</span>
            </div>

            <button
              onClick={goToNextPage}
              disabled={currentPage >= totalPages}
              className="px-3 py-2 rounded-xl border border-kindle-border hover:bg-neutral-500/10 disabled:opacity-30 disabled:pointer-events-none transition flex items-center gap-1 text-xs font-bold cursor-pointer"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 4. Bottom Sheet Settings Modal Backdrop Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[110] transition-opacity duration-300"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 5. Bottom Sheet Settings Drawer (Slides UP from Bottom like EPUB settings) */}
      <aside 
        className={`fixed inset-x-0 bottom-0 z-[120] max-h-[85vh] sm:max-h-[80vh] w-full max-w-3xl mx-auto rounded-t-3xl border-t border-kindle-border bg-kindle-bg text-kindle-text flex flex-col transition-transform duration-300 ease-out shadow-[0_-10px_40px_rgba(0,0,0,0.3)] ${
          sidebarOpen ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {/* Modal Header Bar with Drag Handle */}
        <div className="sticky top-0 bg-kindle-bg pt-3 pb-3 px-6 border-b border-kindle-border flex items-center justify-between shrink-0 z-10 rounded-t-3xl">
          <div className="w-12 h-1 bg-kindle-text-muted/30 rounded-full mx-auto absolute left-1/2 -translate-x-1/2 top-2.5" />
          <h3 className="text-xs font-bold tracking-widest uppercase text-kindle-text flex items-center gap-2 pt-1 font-sans">
            <Sliders className="w-4 h-4 text-kindle-accent" />
            PDF Settings & Notes
          </h3>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 px-3.5 rounded-xl bg-kindle-text text-kindle-bg font-bold text-xs uppercase tracking-wider hover:opacity-90 transition cursor-pointer"
          >
            Done
          </button>
        </div>

        {/* Scrollable Bottom Sheet Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 pb-[max(1.5rem,var(--kora-safe-bottom))]">
          {/* Display & Reading Modes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pb-5 border-b border-kindle-border">
            {/* Reading Theme */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted block">
                  Reading Theme Filter
                </label>
                <button
                  type="button"
                  onClick={() => setAutoAdjustTheme(!autoAdjustTheme)}
                  className={`px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider transition flex items-center gap-1 border ${
                    autoAdjustTheme
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30"
                      : "bg-neutral-500/10 text-neutral-500 border-transparent hover:bg-neutral-500/20"
                  }`}
                >
                  {autoAdjustTheme ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
                  Auto
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {['light', 'dark', 'sepia', 'green'].map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setAutoAdjustTheme(false);
                      setTheme(t);
                    }}
                    className={`py-2 text-[10px] font-bold uppercase rounded-xl border transition cursor-pointer ${
                      !autoAdjustTheme && theme === t ? "bg-kindle-text text-kindle-bg border-transparent shadow-xs" : "border-kindle-border hover:border-kindle-text-muted"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Brightness Slider */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted block">
                Screen Brightness ({brightness}%)
              </label>
              <input
                type="range"
                min="20"
                max="100"
                value={brightness}
                onChange={(e) => setBrightness(parseInt(e.target.value))}
                className="w-full accent-kindle-accent h-2 bg-neutral-200 dark:bg-neutral-800 rounded-lg appearance-none cursor-pointer mt-2"
              />
            </div>
          </div>

          {/* Zoom Controls & View Engine Switch */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pb-5 border-b border-kindle-border">
            {/* Zoom Controls */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted block">
                Zoom Scale
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setZoomScale((prev) => Math.max(0.6, prev - 0.2))}
                  className="p-2 rounded-xl border border-kindle-border hover:bg-neutral-500/10 text-kindle-text cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <div className="flex-1 text-center font-mono font-bold text-xs bg-neutral-500/5 py-2 rounded-xl border border-kindle-border">
                  {Math.round(zoomScale * 100)}%
                </div>
                <button
                  onClick={() => setZoomScale((prev) => Math.min(2.5, prev + 0.2))}
                  className="p-2 rounded-xl border border-kindle-border hover:bg-neutral-500/10 text-kindle-text cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setZoomScale(1.0)}
                  className="px-2.5 py-2 text-[10px] font-bold uppercase rounded-xl border border-kindle-border hover:bg-neutral-500/10 text-kindle-text-muted cursor-pointer"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Viewer Mode Toggle */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted block">
                Rendering Engine
              </label>
              <button
                type="button"
                onClick={() => setUseNativeViewer(!useNativeViewer)}
                className={`w-full py-2.5 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                  useNativeViewer ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-kindle-border text-kindle-text hover:bg-neutral-500/10"
                }`}
              >
                <span>{useNativeViewer ? "Native IFrame Viewer" : "HTML5 Canvas Engine"}</span>
                <span className="text-[9px] uppercase tracking-wider opacity-70">Switch</span>
              </button>
            </div>
          </div>

          {/* Page Jump & Sync Progress */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 font-sans text-xs">
              <div>
                <label className="text-kindle-text-muted block mb-1 font-bold uppercase tracking-widest text-[9px]">
                  Current Page
                </label>
                <input
                  type="number"
                  min="1"
                  max={totalPages}
                  value={currentPage}
                  onChange={(e) => setCurrentPage(parseInt(e.target.value) || 1)}
                  className="w-full bg-white dark:bg-neutral-800 border border-kindle-border rounded-xl px-3.5 py-2 text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                />
              </div>
              <div>
                <label className="text-kindle-text-muted block mb-1 font-bold uppercase tracking-widest text-[9px]">
                  Total Pages
                </label>
                <input
                  type="number"
                  min="1"
                  value={totalPages}
                  onChange={(e) => setTotalPages(parseInt(e.target.value) || 1)}
                  className="w-full bg-white dark:bg-neutral-800 border border-kindle-border rounded-xl px-3.5 py-2 text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent"
                />
              </div>
            </div>

            {/* Reader Notes */}
            <div>
              <label className="text-[10px] text-kindle-text-muted font-bold uppercase tracking-widest block mb-1.5 flex items-center gap-2">
                <Edit3 className="w-3.5 h-3.5 text-kindle-accent" />
                Notes & Journal
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Write your notes or thoughts for this PDF..."
                rows={3}
                className="w-full text-xs bg-white dark:bg-neutral-800 border border-kindle-border rounded-xl p-3 text-kindle-text focus:outline-none focus:ring-1 focus:ring-kindle-accent placeholder-kindle-text-muted resize-none font-sans"
              />
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveProgress}
              className={`w-full py-3.5 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition shadow-sm cursor-pointer ${
                isSaved 
                  ? "bg-emerald-700 text-white" 
                  : "bg-kindle-text hover:bg-kindle-accent text-kindle-bg"
              }`}
            >
              {isSaved ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>Progress & Notes Synced</span>
                </>
              ) : (
                <span>Save Reading Progress</span>
              )}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
