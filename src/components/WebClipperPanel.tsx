import React, { useState } from "react";
import { ArrowRight, Globe, Loader2 } from "lucide-react";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { storeBookFile } from "../db/indexedDB";

interface WebClipperPanelProps {
  userId?: string;
  onRefreshLibrary?: () => void | Promise<void>;
}

export default function WebClipperPanel({ userId = "", onRefreshLibrary }: WebClipperPanelProps) {
  const [clipperUrl, setClipperUrl] = useState("");
  const [clipStatus, setClipStatus] = useState<"idle" | "fetching" | "converting" | "saving" | "success" | "error">("idle");
  const [clipError, setClipError] = useState<string | null>(null);

  const handleClipUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clipperUrl.trim()) return;

    setClipStatus("fetching");
    setClipError(null);

    try {
      const response = await fetch("/api/convert-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: clipperUrl.trim() }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error ${response.status}`);
      }

      setClipStatus("converting");
      const data = await response.json();
      setClipStatus("saving");

      const bookId = `clipper-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
          lastReadTime: Date.now(),
        },
        dateAdded: Date.now(),
        description: data.description || `Clipped from ${new URL(clipperUrl).hostname}`,
      };

      const blob = new Blob([data.htmlContent], { type: "text/html" });
      await storeBookFile(bookId, blob, `${newBook.title}.html`, "html");
      await syncBookToCloud(userId, newBook);

      setClipStatus("success");
      setClipperUrl("");
      await onRefreshLibrary?.();
      setTimeout(() => setClipStatus("idle"), 3500);
    } catch (err) {
      setClipError((err as Error).message || "Failed to convert website.");
      setClipStatus("error");
    }
  };

  return (
    <section className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-kindle-accent/[0.08] border border-kindle-accent/20 rounded-xl">
          <Globe className="w-5 h-5 text-kindle-accent" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-kindle-text font-lexend">Web Clipper</h3>
          <p className="text-[10px] text-kindle-text-muted">
            Paste any article or webpage link to save it as a readable ebook in your library.
          </p>
        </div>
      </div>

      <form onSubmit={handleClipUrl} className="flex flex-col sm:flex-row gap-2">
        <input
          type="url"
          required
          disabled={clipStatus !== "idle" && clipStatus !== "success" && clipStatus !== "error"}
          placeholder="https://example.com/article"
          value={clipperUrl}
          onChange={(e) => setClipperUrl(e.target.value)}
          className="flex-1 bg-kindle-bg border border-kindle-border rounded-xl px-4 py-2.5 text-xs text-kindle-text placeholder:text-kindle-text-muted/60 focus:outline-none focus:ring-1 focus:ring-kindle-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={clipStatus !== "idle" && clipStatus !== "success" && clipStatus !== "error"}
          className="px-5 py-2.5 bg-kindle-text text-kindle-bg rounded-xl text-[10px] font-bold uppercase tracking-wider transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {(clipStatus === "fetching" || clipStatus === "converting" || clipStatus === "saving") ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {clipStatus === "fetching" ? "Fetching" : clipStatus === "converting" ? "Converting" : "Saving"}
            </>
          ) : clipStatus === "success" ? (
            "Saved"
          ) : (
            <>
              Clip
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </form>

      {clipError && (
        <p className="text-[10px] text-red-500 bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">
          {clipError}
        </p>
      )}
    </section>
  );
}
