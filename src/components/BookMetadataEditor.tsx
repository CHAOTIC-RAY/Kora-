import React, { useEffect, useMemo, useState } from "react";
import { BookMetadata, getLocalLibrary, syncBookToCloud } from "../lib/firebase";
import { X, Save, BookOpen, RefreshCw, Search, Loader2, Library } from "lucide-react";
import HardcoverCommunity from "./HardcoverCommunity";
import { enrichBookMetadata } from "../lib/metadataEnricher";
import {
  ensureSeriesFields,
  getSeriesProgress,
  parseSeriesFromTitle,
} from "../lib/seriesHelper";

interface BookMetadataEditorProps {
  userId: string;
  book: BookMetadata;
  /** Full library for series shelf (falls back to local storage). */
  library?: BookMetadata[];
  onClose: () => void;
  onSave: () => void;
  /** Optional: open another book in the series */
  onOpenBook?: (book: BookMetadata) => void;
}

export default function BookMetadataEditor({
  userId,
  book,
  library,
  onClose,
  onSave,
  onOpenBook,
}: BookMetadataEditorProps) {
  const seeded = ensureSeriesFields(book);
  const [title, setTitle] = useState(book.title || "");
  const [author, setAuthor] = useState(book.author || "");
  const [description, setDescription] = useState(book.description || "");
  const [tags, setTags] = useState(book.tags?.join(", ") || "");
  const [series, setSeries] = useState(seeded.series || "");
  const [seriesNumber, setSeriesNumber] = useState(seeded.seriesNumber || "");
  const [rating, setRating] = useState(book.rating || 0);
  const [coverUrl, setCoverUrl] = useState(book.coverUrl || "");
  const [downloadUrl, setDownloadUrl] = useState(book.downloadUrl || "");
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    const next = ensureSeriesFields(book);
    setTitle(book.title || "");
    setAuthor(book.author || "");
    setDescription(book.description || "");
    setTags(book.tags?.join(", ") || "");
    setSeries(next.series || "");
    setSeriesNumber(next.seriesNumber || "");
    setRating(book.rating || 0);
    setCoverUrl(book.coverUrl || "");
    setDownloadUrl(book.downloadUrl || "");
    setShowResults(false);
  }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const shelf = useMemo(() => {
    const all = library?.length ? library : getLocalLibrary();
    return all.map(ensureSeriesFields);
  }, [library]);

  const seriesProgress = useMemo(() => {
    if (!series.trim()) return null;
    return getSeriesProgress(shelf, series);
  }, [shelf, series]);

  // Auto-detect when title changes and series empty
  useEffect(() => {
    if (series.trim() && seriesNumber.trim()) return;
    const parsed = parseSeriesFromTitle(title);
    if (!parsed) return;
    if (!series.trim()) setSeries(parsed.series);
    if (!seriesNumber.trim()) setSeriesNumber(parsed.seriesNumber);
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleManualSearch() {
    if (!title.trim()) return;
    setIsSearching(true);
    setShowResults(true);
    try {
      const q = encodeURIComponent(`intitle:${title}`);
      const res = await fetch(`/api/google-books/search?q=${q}&maxResults=5`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.items || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  }

  function applyMetadata(googleBook: any) {
    const info = googleBook.volumeInfo;
    setTitle(info.title || title);
    setAuthor(info.authors?.join(", ") || author);
    setDescription(info.description || description);

    if (info.imageLinks?.thumbnail) {
      setCoverUrl(info.imageLinks.thumbnail.replace("http:", "https:"));
    }

    const newTags = new Set<string>();
    info.categories?.forEach((cat: string) => {
      cat.split("/").forEach((t: string) => newTags.add(t.trim()));
    });
    if (newTags.size > 0) {
      setTags(Array.from(newTags).join(", "));
    }

    const parsed = parseSeriesFromTitle(info.title || title);
    if (parsed) {
      if (!series.trim()) setSeries(parsed.series);
      if (!seriesNumber.trim()) setSeriesNumber(parsed.seriesNumber);
    }

    setShowResults(false);
  }

  async function handleEnrich() {
    setEnriching(true);
    try {
      const enriched = await enrichBookMetadata(userId, book);
      const withSeries = ensureSeriesFields(enriched);
      setTitle(withSeries.title);
      setAuthor(withSeries.author);
      setDescription(withSeries.description || "");
      setTags(withSeries.tags?.join(", ") || "");
      setSeries(withSeries.series || "");
      setSeriesNumber(withSeries.seriesNumber || "");
      setCoverUrl(withSeries.coverUrl || "");
    } catch (e) {
      console.error(e);
    } finally {
      setEnriching(false);
    }
  }

  async function handleDetectSeries() {
    const parsed = parseSeriesFromTitle(title);
    if (parsed) {
      setSeries(parsed.series);
      setSeriesNumber(parsed.seriesNumber);
      return;
    }
    // Fall back: match same author books with shared title prefix
    const authorKey = (author || "").toLowerCase().trim();
    if (!authorKey) return;
    const sameAuthor = shelf.filter(
      (b) => b.id !== book.id && (b.author || "").toLowerCase().trim() === authorKey
    );
    for (const other of sameAuthor) {
      if (other.series?.trim()) {
        setSeries(other.series);
        if (!seriesNumber.trim() && other.seriesNumber) {
          /* leave number for user */
        }
        return;
      }
    }
  }

  async function handleSave() {
    setSaving(true);
    const updatedBook = {
      ...book,
      title,
      author,
      description,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      series: series.trim(),
      seriesNumber: seriesNumber.trim(),
      rating,
      coverUrl,
      downloadUrl,
      dateModified: Date.now(),
    };

    try {
      await syncBookToCloud(userId, updatedBook);
      onSave();
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const statusLabel = (b: BookMetadata) => {
    if (b.status === "completed") return "Done";
    if (b.status === "reading" || (b.progress?.percent || 0) > 0) {
      return `${Math.round(b.progress?.percent || 0)}%`;
    }
    return "To read";
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-kindle-card border border-kindle-border rounded-3xl shadow-2xl p-6 md:p-8 animate-in zoom-in fade-in duration-200 overflow-y-auto max-h-[90vh]">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-lexend font-bold">Book Details</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleEnrich}
              disabled={enriching}
              title="Enrich from Google Books"
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-kindle-accent/10 text-kindle-accent hover:bg-kindle-accent/20 transition disabled:opacity-50"
            >
              {enriching ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {enriching ? "Enriching..." : "Enrich"}
            </button>
            <button onClick={onClose} className="p-2 hover:bg-kindle-bg rounded-xl transition">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1 relative">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Title</label>
              <div className="relative group">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-kindle-bg border border-kindle-border rounded-xl pl-4 pr-10 py-3 text-sm focus:outline-none focus:border-kindle-accent"
                />
                <button
                  onClick={handleManualSearch}
                  disabled={isSearching}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-kindle-accent/10 text-kindle-text-muted hover:text-kindle-accent transition rounded-lg"
                >
                  {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>

              {showResults && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowResults(false)} />
                  <div className="absolute left-0 right-0 top-full mt-2 bg-kindle-card border border-kindle-border rounded-2xl shadow-2xl z-20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 max-h-[300px] overflow-y-auto">
                    <div className="p-2 border-b border-kindle-border bg-kindle-bg/50 flex justify-between items-center">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted px-2">Search Results</span>
                      <button onClick={() => setShowResults(false)} className="p-1 hover:bg-kindle-border rounded-lg transition">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="divide-y divide-kindle-border">
                      {searchResults.length > 0 ? (
                        searchResults.map((result) => (
                          <button
                            key={result.id}
                            onClick={() => applyMetadata(result)}
                            className="w-full p-3 flex gap-3 hover:bg-kindle-bg transition text-left group"
                          >
                            <div className="w-10 h-14 bg-kindle-bg rounded overflow-hidden shrink-0 shadow-sm">
                              {result.volumeInfo.imageLinks?.thumbnail ? (
                                <img src={result.volumeInfo.imageLinks.thumbnail} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-kindle-text-muted">
                                  <BookOpen className="w-4 h-4" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-kindle-text group-hover:text-kindle-accent transition truncate">{result.volumeInfo.title}</p>
                              <p className="text-xs text-kindle-text-muted truncate">{result.volumeInfo.authors?.join(", ")}</p>
                            </div>
                          </button>
                        ))
                      ) : !isSearching && (
                        <div className="p-6 text-center text-xs text-kindle-text-muted">
                          No results found. Try a different title.
                        </div>
                      )}
                      {isSearching && (
                        <div className="p-6 text-center text-xs text-kindle-text-muted flex items-center justify-center gap-2">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Searching Google Books...
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Author</label>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Series</label>
                <button
                  type="button"
                  onClick={handleDetectSeries}
                  className="text-[9px] font-bold uppercase tracking-wider text-kindle-accent hover:underline"
                >
                  Detect
                </button>
              </div>
              <input value={series} onChange={(e) => setSeries(e.target.value)} placeholder="e.g. Harry Potter" className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Series Number</label>
              <input value={seriesNumber} onChange={(e) => setSeriesNumber(e.target.value)} placeholder="e.g. 1" className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
            </div>
          </div>

          {seriesProgress && seriesProgress.total > 0 ? (
            <div className="rounded-2xl border border-kindle-border bg-kindle-bg/50 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted flex items-center gap-1.5">
                    <Library className="w-3.5 h-3.5" /> Series progress
                  </p>
                  <p className="text-sm font-bold mt-1 truncate">{seriesProgress.series}</p>
                  <p className="text-[11px] text-kindle-text-muted mt-0.5">
                    {seriesProgress.completed} of {seriesProgress.total} completed
                    {seriesProgress.furthestCompletedNumber > 0
                      ? ` · furthest #${seriesProgress.furthestCompletedNumber}`
                      : ""}
                  </p>
                </div>
                <span className="text-sm font-mono font-bold text-kindle-accent shrink-0">
                  {Math.round(seriesProgress.fraction * 100)}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-kindle-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-kindle-accent transition-all"
                  style={{ width: `${Math.round(seriesProgress.fraction * 100)}%` }}
                />
              </div>

              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted pt-1">
                  Books in order
                </p>
                {seriesProgress.ordered.map((b) => {
                  const current = b.id === book.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      disabled={current || !onOpenBook}
                      onClick={() => onOpenBook?.(b)}
                      className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                        current
                          ? "bg-kindle-accent/15 border border-kindle-accent/30"
                          : "hover:bg-kindle-card border border-transparent"
                      }`}
                    >
                      <span className="w-7 text-center text-[11px] font-mono font-bold opacity-60 shrink-0">
                        {b.seriesNumber || "·"}
                      </span>
                      <div className="w-8 h-11 rounded overflow-hidden bg-kindle-border shrink-0">
                        {b.coverUrl ? (
                          <img src={b.coverUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <BookOpen className="w-3 h-3 opacity-40" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-semibold truncate">{b.title}</p>
                        <p className="text-[10px] text-kindle-text-muted">{statusLabel(b)}</p>
                      </div>
                      {current ? (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-kindle-accent">Here</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : series.trim() ? (
            <p className="text-[11px] text-kindle-text-muted rounded-xl border border-dashed border-kindle-border px-3 py-2">
              No other books from this series in your library yet. Add them and they will line up here in order.
            </p>
          ) : null}

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Tags (comma separated)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Rating (0-5)</label>
              <input type="number" min="0" max="5" value={rating} onChange={(e) => setRating(Number(e.target.value))} className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">File Format</label>
              <div className="w-full bg-kindle-bg border border-transparent rounded-xl px-4 py-3 text-sm text-kindle-text uppercase font-mono font-bold tracking-widest flex items-center">
                {book.extension || "UNKNOWN"}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent resize-none" />
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-kindle-border">
          <div className="space-y-1 mb-6">
            <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Download URL</label>
            <input value={downloadUrl} onChange={(e) => setDownloadUrl(e.target.value)} placeholder="e.g. https://example.com/book.epub" className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
          </div>
          <HardcoverCommunity book={book} />
        </div>
        <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-kindle-border">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-xs font-bold font-sans uppercase tracking-widest hover:bg-kindle-bg transition">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 rounded-xl text-xs font-bold font-sans uppercase tracking-widest bg-kindle-text text-kindle-bg hover:bg-kindle-accent hover:text-white transition flex items-center gap-2 disabled:opacity-50">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
