/**
 * Browse an installed manga/comic source — popular listing + search —
 * then open ComicDetailView for a series.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Search, BookOpen, RefreshCw } from "lucide-react";
import { createSourceClient } from "../lib/sources/client";
import type { Manga, SourcePlugin } from "../lib/sources/types";
import { resolveCoverImageSrc } from "../lib/coverImage";
import ComicDetailView from "./ComicDetailView";

interface SourceBrowseViewProps {
  plugin: SourcePlugin;
  onClose: () => void;
}

export default function SourceBrowseView({ plugin, onClose }: SourceBrowseViewProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mangas, setMangas] = useState<Manga[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const load = useCallback(
    async (nextPage: number, search: string) => {
      setLoading(true);
      setError("");
      try {
        const client = createSourceClient(plugin);
        const result = search.trim()
          ? await client.search(search.trim(), nextPage)
          : await client.popular(nextPage);
        setMangas(result.mangas || []);
        setHasNext(!!result.hasNextPage);
        setPage(nextPage);
      } catch (e: unknown) {
        setMangas([]);
        setError(e instanceof Error ? e.message : "Failed to load listing");
      } finally {
        setLoading(false);
      }
    },
    [plugin]
  );

  useEffect(() => {
    void load(1, "");
  }, [load]);

  if (selected) {
    return (
      <ComicDetailView
        book={selected}
        onClose={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[90] bg-kindle-bg text-kindle-text flex flex-col kora-safe-top">
      <header className="shrink-0 border-b border-kindle-border bg-kindle-card px-3 py-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-xl border border-kindle-border hover:bg-kindle-bg transition"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold truncate">{plugin.name}</h2>
          <p className="text-[10px] uppercase tracking-wider text-kindle-text-muted">Browse series</p>
        </div>
        <button
          type="button"
          onClick={() => void load(page, query)}
          className="p-2 rounded-xl border border-kindle-border hover:bg-kindle-bg transition"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <form
        className="shrink-0 px-3 py-2 border-b border-kindle-border flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(1, query);
        }}
      >
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-kindle-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this source…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-kindle-border bg-kindle-card text-xs"
          />
        </div>
        <button
          type="submit"
          className="px-3 py-2 rounded-xl bg-kindle-accent text-kindle-bg text-[10px] font-bold uppercase tracking-wider"
        >
          Search
        </button>
      </form>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="py-16 flex flex-col items-center gap-3 text-kindle-text-muted">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-xs">Loading series…</p>
          </div>
        )}
        {!loading && error && (
          <div className="py-12 text-center space-y-3">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => void load(page, query)}
              className="px-4 py-2 rounded-xl border border-kindle-border text-xs font-bold"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && mangas.length === 0 && (
          <div className="py-16 flex flex-col items-center gap-2 text-kindle-text-muted">
            <BookOpen className="w-8 h-8 opacity-40" />
            <p className="text-sm">No series found</p>
          </div>
        )}
        {!loading && !error && mangas.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {mangas.map((m) => (
              <button
                key={m.url}
                type="button"
                onClick={() =>
                  setSelected({
                    title: m.title,
                    author: m.author || "",
                    coverUrl: m.thumbnailUrl,
                    pluginId: plugin.id,
                    sourceId: m.url,
                    kind: "manga",
                  })
                }
                className="text-left space-y-2 group"
              >
                <div className="aspect-[2/3] rounded-xl border border-kindle-border bg-kindle-card overflow-hidden">
                  {m.thumbnailUrl ? (
                    <img
                      src={resolveCoverImageSrc(m.thumbnailUrl) || m.thumbnailUrl}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <BookOpen className="w-6 h-6 text-kindle-text-muted opacity-40" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[11px] font-bold line-clamp-2 leading-snug">{m.title}</p>
                  {m.author && (
                    <p className="text-[9px] text-kindle-text-muted truncate">{m.author}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {(page > 1 || hasNext) && !loading && (
        <div className="shrink-0 border-t border-kindle-border px-3 py-2 flex items-center justify-between kora-safe-bottom">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => void load(page - 1, query)}
            className="px-3 py-1.5 rounded-lg border border-kindle-border text-[10px] font-bold uppercase disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-[10px] text-kindle-text-muted font-mono">Page {page}</span>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => void load(page + 1, query)}
            className="px-3 py-1.5 rounded-lg border border-kindle-border text-[10px] font-bold uppercase disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
