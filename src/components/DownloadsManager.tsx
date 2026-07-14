import React, { useState, useEffect } from "react";
import { Download, CheckCircle, Clock, FileWarning, Trash2, Globe, Sparkles, AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { storeBookFile } from "../db/indexedDB";

interface DownloadsManagerProps {
  userId?: string;
  onRefreshLibrary?: () => void;
}

export default function DownloadsManager({ userId = "", onRefreshLibrary }: DownloadsManagerProps) {
  const [downloads, setDownloads] = useState<any[]>([]);
  const [clipperUrl, setClipperUrl] = useState<string>("");
  const [clipStatus, setClipStatus] = useState<"idle" | "fetching" | "converting" | "saving" | "success" | "error">("idle");
  const [clipError, setClipError] = useState<string | null>(null);

  useEffect(() => {
    const cached = localStorage.getItem("kora_downloads_log");
    if (cached) {
      try {
        setDownloads(JSON.parse(cached));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const addDownloadLog = (title: string, author: string, size: string, status: "completed" | "downloading" | "error") => {
    const newDl = {
      title,
      author,
      size,
      status,
      timestamp: Date.now()
    };
    const updated = [newDl, ...downloads];
    setDownloads(updated);
    localStorage.setItem("kora_downloads_log", JSON.stringify(updated));
  };

  const handleClipUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clipperUrl.trim()) return;

    setClipStatus("fetching");
    setClipError(null);

    try {
      // 1. Send URL to our server-side API
      const response = await fetch("/api/convert-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: clipperUrl.trim() })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `HTTP error ${response.status}`);
      }

      setClipStatus("converting");
      const data = await response.json();

      setClipStatus("saving");

      // 2. Generate unique book metadata
      const bookId = `clipper-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const sizeStr = `${(data.htmlContent.length / 1024).toFixed(1)} KB`;
      
      const newBook: BookMetadata = {
        id: bookId,
        title: data.title || "Clipped Article",
        author: data.author || "Web Article",
        extension: "html",
        size: sizeStr,
        tags: ["Clipped", "Web"],
        status: "to-read",
        progress: {
          percent: 0,
          lastReadTime: Date.now()
        },
        dateAdded: Date.now(),
        description: data.description || `Clipped from ${new URL(clipperUrl).hostname}`
      };

      // 3. Store raw HTML content in IndexedDB
      const blob = new Blob([data.htmlContent], { type: "text/html" });
      await storeBookFile(bookId, blob, `${newBook.title}.html`, "html");

      // 4. Save metadata to Cloud / LocalStorage
      await syncBookToCloud(userId, newBook);

      // 5. Update download logs
      addDownloadLog(newBook.title, newBook.author, sizeStr, "completed");

      // 6. Reset clipper & refresh parent
      setClipStatus("success");
      setClipperUrl("");
      if (onRefreshLibrary) {
        onRefreshLibrary();
      }

      setTimeout(() => setClipStatus("idle"), 3500);

    } catch (err: any) {
      console.error("[Clipper Error]:", err);
      setClipError(err.message || "Failed to convert website.");
      setClipStatus("error");
      addDownloadLog("Web Import Failure", clipperUrl, "0 KB", "error");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 text-left">
      <div>
        <h1 className="text-3xl font-lexend font-bold tracking-tight text-kindle-text mb-1">Downloads</h1>
        <p className="text-[10px] text-kindle-text-muted uppercase tracking-wider font-semibold font-mono mb-6">
          Manage your active and completed book downloads here.
        </p>

        {/* Web Clipper Input Section */}
        <div className="bg-kindle-card border border-kindle-border rounded-2xl p-6 mb-8 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-kindle-accent/[0.08] border border-kindle-accent/20 rounded-xl">
              <Globe className="w-5 h-5 text-kindle-accent" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-kindle-text font-lexend">Web Clipper & Link Importer</h2>
              <p className="text-[10px] text-kindle-text-muted">
                Paste any article, blog post, or webpage link to convert it into a beautifully organized eBook.
              </p>
            </div>
          </div>

          <form onSubmit={handleClipUrl} className="flex gap-2 mt-4">
            <input
              type="url"
              required
              disabled={clipStatus !== "idle" && clipStatus !== "success" && clipStatus !== "error"}
              placeholder="https://example.com/some-interesting-article"
              value={clipperUrl}
              onChange={(e) => setClipperUrl(e.target.value)}
              className="flex-1 bg-kindle-bg border border-kindle-border rounded-xl px-4 py-2.5 text-xs text-kindle-text placeholder:text-kindle-text-muted/60 focus:outline-none focus:ring-1 focus:ring-kindle-accent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={clipStatus !== "idle" && clipStatus !== "success" && clipStatus !== "error"}
              className="px-5 py-2.5 bg-kindle-accent hover:bg-kindle-accent-hover disabled:bg-kindle-accent/40 text-white rounded-xl text-xs font-bold font-lexend transition-all shadow-sm flex items-center gap-2"
            >
              {(clipStatus === "fetching" || clipStatus === "converting" || clipStatus === "saving") ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {clipStatus === "idle" && "Convert"}
              {clipStatus === "fetching" && "Scraping..."}
              {clipStatus === "converting" && "AI Structuring..."}
              {clipStatus === "saving" && "Saving..."}
              {clipStatus === "success" && "Clipped!"}
              {clipStatus === "error" && "Retry"}
            </button>
          </form>

          {/* Clipper Feedback & Status */}
          {clipStatus !== "idle" && (
            <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
              {clipStatus === "fetching" && (
                <div className="flex items-center gap-3 p-3 bg-kindle-accent/[0.04] border border-kindle-accent/15 rounded-xl">
                  <Loader2 className="w-4 h-4 text-kindle-accent animate-spin" />
                  <p className="text-[11px] font-medium text-kindle-text-muted">
                    Fetching webpage content and rendering dynamic elements...
                  </p>
                </div>
              )}
              {clipStatus === "converting" && (
                <div className="flex items-center gap-3 p-3 bg-kindle-accent/[0.04] border border-kindle-accent/15 rounded-xl animate-pulse">
                  <Sparkles className="w-4 h-4 text-kindle-accent" />
                  <p className="text-[11px] font-medium text-kindle-text-muted">
                    Gemini AI is parsing the content, removing ads/clutter, and organizing into chapters...
                  </p>
                </div>
              )}
              {clipStatus === "saving" && (
                <div className="flex items-center gap-3 p-3 bg-kindle-accent/[0.04] border border-kindle-accent/15 rounded-xl">
                  <Clock className="w-4 h-4 text-kindle-accent animate-pulse" />
                  <p className="text-[11px] font-medium text-kindle-text-muted">
                    Formatting Kindle-style layout and storing to your offline library index...
                  </p>
                </div>
              )}
              {clipStatus === "success" && (
                <div className="flex items-center gap-3 p-3 bg-green-500/5 border border-green-500/20 rounded-xl">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <p className="text-[11px] font-bold text-green-600 dark:text-green-400">
                    Perfectly converted! The article has been added as a beautiful eBook in your Library tab.
                  </p>
                </div>
              )}
              {clipStatus === "error" && (
                <div className="flex items-center gap-3 p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                  <div>
                    <p className="text-[11px] font-bold text-red-600 dark:text-red-400">Import Failed</p>
                    <p className="text-[10px] text-kindle-text-muted mt-0.5">{clipError}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {downloads.length === 0 ? (
          <div className="bg-kindle-card border border-kindle-border rounded-lg p-12 text-center flex flex-col items-center">
            <Download className="w-12 h-12 text-kindle-text-muted mb-4 opacity-50" />
            <h3 className="text-xl font-medium mb-2">No active downloads</h3>
            <p className="text-sm text-kindle-text-muted">
              Books you download from the Discover tab or clip from the web will appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-kindle-text-muted mb-1 font-mono">
              Activity History
            </h3>
            {downloads.map((dl, idx) => (
              <div key={idx} className="bg-kindle-card border border-kindle-border rounded-lg p-4 flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-xs">{dl.title}</h4>
                  <p className="text-[10px] text-kindle-text-muted mt-0.5">
                    {dl.author} • {dl.size || "Unknown size"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {dl.status === "completed" && <CheckCircle className="w-5 h-5 text-green-500" />}
                  {dl.status === "downloading" && <Clock className="w-5 h-5 text-yellow-500 animate-pulse" />}
                  {dl.status === "error" && <FileWarning className="w-5 h-5 text-red-500" />}
                  <button 
                    onClick={() => {
                      const newDls = downloads.filter((_, i) => i !== idx);
                      setDownloads(newDls);
                      localStorage.setItem("kora_downloads_log", JSON.stringify(newDls));
                    }}
                    className="p-2 text-kindle-text-muted hover:text-red-400 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
