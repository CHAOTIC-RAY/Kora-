import React, { useState, useEffect } from "react";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { X, Search, Upload, Loader2, Image as ImageIcon, Check } from "lucide-react";

interface BookCoverEditorProps {
  book: BookMetadata;
  userId: string;
  onClose: () => void;
  onUpdate: (updatedBook: BookMetadata) => void;
}

export default function BookCoverEditor({ book, userId, onClose, onUpdate }: BookCoverEditorProps) {
  const [activeTab, setActiveTab] = useState<"search" | "upload">("search");
  const [searchQuery, setSearchQuery] = useState(`${book.title} ${book.author}`);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/open-library/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      
      const covers = (data.docs || [])
        .filter((doc: any) => doc.cover_i)
        .map((doc: any) => `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`)
        .slice(0, 12);
        
      setResults(covers);
      if (covers.length === 0) {
        setError("No covers found for this search. Try a different query.");
      }
    } catch (err) {
      setError("Failed to search Open Library.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleSearch();
  }, []);

  const handleSelectCover = async (url: string) => {
    setLoading(true);
    try {
      const updatedBook = { ...book, coverUrl: url };
      await syncBookToCloud(userId, updatedBook);
      onUpdate(updatedBook);
      onClose();
    } catch (err) {
      setError("Failed to update cover.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");

    try {
      // For simplicity in this demo, we convert to base64 and store in Firestore
      // In a real app, you'd use Firebase Storage
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        const updatedBook = { ...book, coverUrl: base64String };
        await syncBookToCloud(userId, updatedBook);
        onUpdate(updatedBook);
        onClose();
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError("Failed to upload image.");
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in fade-in duration-200">
        <div className="p-6 border-b border-kindle-border flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-bold font-sans tracking-tight">Edit Book Cover</h3>
            <p className="text-[10px] text-kindle-text-muted font-bold uppercase tracking-widest">{book.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-neutral-100 rounded-xl transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-kindle-border">
          <button 
            onClick={() => setActiveTab("search")}
            className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-colors ${activeTab === "search" ? "bg-white text-kindle-accent border-b-2 border-kindle-accent" : "bg-neutral-50 text-kindle-text-muted hover:bg-neutral-100"}`}
          >
            Search Online
          </button>
          <button 
            onClick={() => setActiveTab("upload")}
            className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-colors ${activeTab === "upload" ? "bg-white text-kindle-accent border-b-2 border-kindle-accent" : "bg-neutral-50 text-kindle-text-muted hover:bg-neutral-100"}`}
          >
            Upload Custom
          </button>
        </div>

        <div className="p-6 h-[400px] overflow-y-auto custom-scrollbar">
          {activeTab === "search" ? (
            <div className="space-y-6">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-neutral-50 border border-kindle-border rounded-xl px-4 py-2 text-sm outline-none focus:border-kindle-accent transition"
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <button 
                  onClick={handleSearch}
                  className="px-4 py-2 bg-kindle-text text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-kindle-accent transition"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-kindle-text-muted">
                  <Loader2 className="w-8 h-8 animate-spin mb-4" />
                  <p className="text-xs uppercase tracking-widest font-bold">Searching Open Library...</p>
                </div>
              ) : error ? (
                <p className="text-center py-20 text-red-500 text-xs">{error}</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                  {results.map((url, idx) => (
                    <button 
                      key={idx} 
                      onClick={() => handleSelectCover(url)}
                      className="aspect-[3/4] rounded-lg overflow-hidden border border-kindle-border hover:border-kindle-accent transition group relative"
                    >
                      <img src={url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition">
                        <Check className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-kindle-border rounded-3xl bg-neutral-50/50 p-8 text-center space-y-4">
              <div className="p-4 bg-white rounded-full shadow-md">
                {uploading ? <Loader2 className="w-8 h-8 animate-spin text-kindle-accent" /> : <Upload className="w-8 h-8 text-kindle-text-muted" />}
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-sm">Select high-quality cover image</h4>
                <p className="text-xs text-kindle-text-muted">Supports JPG, PNG, WEBP</p>
              </div>
              <label className="px-6 py-3 bg-kindle-text text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-kindle-accent transition cursor-pointer shadow-lg inline-flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                Choose File
                <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
