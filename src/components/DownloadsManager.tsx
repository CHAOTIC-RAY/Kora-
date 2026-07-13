import React, { useState, useEffect } from "react";
import { Download, CheckCircle, Clock, FileWarning, Trash2 } from "lucide-react";

export default function DownloadsManager() {
  const [downloads, setDownloads] = useState<any[]>([]);

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

  return (
    <div className="w-full bg-kindle-bg text-kindle-text font-sans p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="max-w-4xl">
        <h1 className="text-3xl font-lexend font-bold tracking-tight text-kindle-text mb-1">Downloads</h1>
        <p className="text-[10px] text-kindle-text-muted uppercase tracking-wider font-semibold font-mono mb-8">
          Manage your active and completed book downloads here.
        </p>

        {downloads.length === 0 ? (
          <div className="bg-kindle-card border border-kindle-border rounded-lg p-12 text-center flex flex-col items-center">
            <Download className="w-12 h-12 text-kindle-text-muted mb-4 opacity-50" />
            <h3 className="text-xl font-medium mb-2">No active downloads</h3>
            <p className="text-sm text-kindle-text-muted">
              Books you download from the Discover tab will appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {downloads.map((dl, idx) => (
              <div key={idx} className="bg-kindle-card border border-kindle-border rounded-lg p-4 flex items-center justify-between">
                <div>
                  <h4 className="font-bold">{dl.title}</h4>
                  <p className="text-xs text-kindle-text-muted">{dl.author} • {dl.size || "Unknown size"}</p>
                </div>
                <div className="flex items-center gap-3">
                  {dl.status === "completed" && <CheckCircle className="w-5 h-5 text-green-500" />}
                  {dl.status === "downloading" && <Clock className="w-5 h-5 text-yellow-500" />}
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
