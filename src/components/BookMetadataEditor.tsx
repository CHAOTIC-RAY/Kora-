import React, { useState } from "react";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { X, Save, BookOpen, Star, RefreshCw, Sparkles, Search, Loader2 } from "lucide-react";
import HardcoverCommunity from "./HardcoverCommunity";
import { enrichBookMetadata } from "../lib/metadataEnricher";

interface BookMetadataEditorProps {
  userId: string;
  book: BookMetadata;
  onClose: () => void;
  onSave: () => void;
}

export default function BookMetadataEditor({ userId, book, onClose, onSave }: BookMetadataEditorProps) {
  const [title, setTitle] = useState(book.title || "");
  const [author, setAuthor] = useState(book.author || "");
  const [description, setDescription] = useState(book.description || "");
  const [tags, setTags] = useState(book.tags?.join(", ") || "");
  const [series, setSeries] = useState(book.series || "");
  const [seriesNumber, setSeriesNumber] = useState(book.seriesNumber || "");
  const [rating, setRating] = useState(book.rating || 0);
  const [coverUrl, setCoverUrl] = useState(book.coverUrl || "");
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

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
      cat.split("/").forEach(t => newTags.add(t.trim()));
    });
    if (newTags.size > 0) {
      setTags(Array.from(newTags).join(", "));
    }
    
    setShowResults(false);
  }

  async function handleEnrich() {
    setEnriching(true);
    try {
      const enriched = await enrichBookMetadata(userId, book);
      setTitle(enriched.title);
      setAuthor(enriched.author);
      setDescription(enriched.description || "");
      setTags(enriched.tags?.join(", ") || "");
      setSeries(enriched.series || "");
      setSeriesNumber(enriched.seriesNumber || "");
      setCoverUrl(enriched.coverUrl || "");
    } catch (e) {
      console.error(e);
    } finally {
      setEnriching(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    const updatedBook = {
      ...book,
      title,
      author,
      description,
      tags: tags.split(",").map(t => t.trim()).filter(Boolean),
      series,
      seriesNumber,
      rating,
      coverUrl
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-kindle-card border border-kindle-border rounded-3xl shadow-2xl p-6 md:p-8 animate-in zoom-in fade-in duration-200 overflow-y-auto max-h-[90vh]">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-lexend font-bold">Edit Metadata</h2>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleEnrich} 
              disabled={enriching}
              title="Enrich from Google Books"
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-kindle-accent/10 text-kindle-accent hover:bg-kindle-accent/20 transition disabled:opacity-50"
            >
              {enriching ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
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
                  onChange={e => setTitle(e.target.value)} 
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
              <input value={author} onChange={e => setAuthor(e.target.value)} className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Series</label>
              <input value={series} onChange={e => setSeries(e.target.value)} placeholder="e.g. Harry Potter" className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Series Number</label>
              <input value={seriesNumber} onChange={e => setSeriesNumber(e.target.value)} placeholder="e.g. 1" className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Tags (comma separated)</label>
            <input value={tags} onChange={e => setTags(e.target.value)} className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Rating (0-5)</label>
              <input type="number" min="0" max="5" value={rating} onChange={e => setRating(Number(e.target.value))} className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
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
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5} className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent resize-none" />
          </div>

        </div>

        <div className="mt-8 pt-6 border-t border-kindle-border">
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
