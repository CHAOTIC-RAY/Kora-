import React, { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, AlertTriangle, RefreshCw, Database, FileText, Zap, Trash2 } from "lucide-react";
import { getBookFile, deleteBookFile } from "../db/indexedDB";

export default function BookReaderText({ book, onClose }: { book: any; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="fixed inset-0 z-50 bg-kindle-bg flex flex-col font-sans">
      <div className="h-14 flex items-center justify-between px-4 border-b border-kindle-border shrink-0 bg-kindle-bg">
        <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-kindle-card transition text-kindle-text-muted hover:text-kindle-text">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-xs font-bold uppercase tracking-widest text-kindle-text-muted truncate max-w-[200px]">{book.title}</span>
        <div className="w-9" />
      </div>
      <div className="flex-1 overflow-auto p-4 md:p-8 bg-white dark:bg-black relative">
        {loading ? (
          <div className="flex justify-center py-20"><span className="text-xs font-bold uppercase tracking-widest animate-pulse">Loading...</span></div>
        ) : error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto bg-kindle-bg">
            <div className="w-full bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-[2rem] p-8 md:p-10 shadow-xl flex flex-col items-center animate-in fade-in zoom-in-95 duration-500">
              <div className="w-20 h-20 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center mb-6 shadow-inner">
                <AlertTriangle className="w-10 h-10 text-red-600 dark:text-red-400" />
              </div>
              
              <h2 className="text-xl md:text-2xl font-serif font-bold text-red-900 dark:text-red-100 mb-3">
                Text Reader Error
              </h2>
              
              <div className="bg-white/50 dark:bg-black/20 rounded-2xl p-4 mb-6 border border-red-200/50 dark:border-red-800/30 w-full">
                <p className="text-xs md:text-sm text-red-700 dark:text-red-300 font-mono leading-relaxed break-words">
                  Error: {error}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 w-full">
                <button 
                  onClick={load}
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
                  <Trash2 className="w-4 h-4" /> Reset
                </button>
              </div>
            </div>
          </div>
        ) : book.extension === "html" || book.extension === "htm" ? (
          <iframe className="w-full h-full border-0 bg-white" srcDoc={content || ""} sandbox="allow-same-origin" title={book.title} />
        ) : (
          <pre className="text-xs font-mono whitespace-pre-wrap text-kindle-text max-w-4xl mx-auto">{content}</pre>
        )}
      </div>
    </div>
  );
}
