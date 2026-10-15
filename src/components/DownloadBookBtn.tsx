import React, { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { getBookFile } from "../db/indexedDB";
import { BookMetadata } from "../lib/firebase";

export default function DownloadBookBtn({ book }: { book: BookMetadata }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setDownloading(true);
      const fileData = await getBookFile(book.id);
      if (!fileData) {
        alert("File not found in local cache. Try re-downloading it from Discover.");
        return;
      }
      const url = URL.createObjectURL(fileData.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileData.fileName || `${book.title}.${book.extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("Failed to download book", err);
      alert("Error downloading the book.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      className="p-2 bg-kindle-card border border-kindle-border text-emerald-600 rounded-full shadow-lg hover:bg-emerald-500/10 transition"
      title="Download File"
    >
      {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
    </button>
  );
}
