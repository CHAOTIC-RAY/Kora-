import React, { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getBookFile } from "../db/indexedDB";

export default function BookReaderText({ book, onClose }: { book: any; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const fileData = await getBookFile(book.id);
        if (fileData) {
          const text = await fileData.blob.text();
          setContent(text);
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    }
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
      <div className="flex-1 overflow-auto p-4 md:p-8 bg-white dark:bg-black">
        {loading ? (
          <div className="flex justify-center py-20"><span className="text-xs font-bold uppercase tracking-widest animate-pulse">Loading...</span></div>
        ) : book.extension === "html" || book.extension === "htm" ? (
          <iframe className="w-full h-full border-0 bg-white" srcDoc={content || ""} sandbox="allow-same-origin" title={book.title} />
        ) : (
          <pre className="text-xs font-mono whitespace-pre-wrap text-kindle-text max-w-4xl mx-auto">{content}</pre>
        )}
      </div>
    </div>
  );
}
