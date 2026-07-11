import React, { useState } from "react";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { X, Save, BookOpen, Star, RefreshCw } from "lucide-react";
import HardcoverCommunity from "./HardcoverCommunity";

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
  const [saving, setSaving] = useState(false);

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
      rating
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
          <button onClick={onClose} className="p-2 hover:bg-kindle-bg rounded-xl transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
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

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Rating (0-5)</label>
            <input type="number" min="0" max="5" value={rating} onChange={e => setRating(Number(e.target.value))} className="w-full bg-kindle-bg border border-kindle-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-kindle-accent" />
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
