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
  
  const cleanSearchQuery = (title: string, author: string) => {
    const cleanTitle = (title || "")
      .split(':')[0]
      .replace(/\b\d{10,13}\b/g, '') // Remove ISBNs
      .replace(/\(.*\)/g, '')
      .replace(/volume\s+\d+/gi, '')
      .replace(/book\s+\d+/gi, '')
      .replace(/[^\w\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
      
    const cleanAuthor = (author || "")
      .split(',')[0]
      .replace(/\b\d{4}-\d{4}\b/g, '') // 1922-2012
      .replace(/\bUnknown\b/gi, '')
      .replace(/\(.*\)/g, '')
      .replace(/[^\w\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return `${cleanTitle} ${cleanAuthor}`.trim();
  };

  const [searchQuery, setSearchQuery] = useState(cleanSearchQuery(book.title, book.author || ""));
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ url: string; source: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError("");
    try {
      const searchPromises = [];

      // 1. Open Library
      searchPromises.push(
        fetch(`/api/open-library/search?q=${encodeURIComponent(searchQuery)}`)
          .then(async (res) => {
            if (!res.ok) return [];
            const data = await res.json();
            return (data.docs || [])
              .filter((doc: any) => doc.cover_i)
              .map((doc: any) => ({
                url: `/api/proxy-image?url=${encodeURIComponent(`https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`)}`,
                source: "Open Library"
              }))
              .slice(0, 6);
          })
          .catch(() => [])
      );

      // 2. Google Books API
      searchPromises.push(
        fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(searchQuery)}&maxResults=6`)
          .then(async (res) => {
            if (!res.ok) return [];
            const data = await res.json();
            return (data.items || [])
              .filter((item: any) => item.volumeInfo?.imageLinks?.thumbnail)
              .map((item: any) => {
                let thumb = item.volumeInfo.imageLinks.thumbnail;
                thumb = thumb.replace("&edge=curl", "");
                if (thumb.startsWith("http://")) thumb = thumb.replace("http://", "https://");
                return {
                  url: `/api/proxy-image?url=${encodeURIComponent(thumb)}`,
                  source: "Google Books"
                };
              });
          })
          .catch(() => [])
      );

      // 3. Anna's Archive dynamic search
      searchPromises.push(
        fetch(`/api/annas-archive/search?q=${encodeURIComponent(searchQuery)}`)
          .then(async (res) => {
            if (!res.ok) return [];
            const data = await res.json();
            const list = data.books || data.results || [];
            return list
              .filter((item: any) => item && item.coverUrl)
              .map((item: any) => ({
                url: item.coverUrl,
                source: "Ana's Archive"
              }))
              .slice(0, 6);
          })
          .catch(() => [])
      );

      // 4. NYT bestseller list dynamic overview match
      searchPromises.push(
        fetch(`/api/nytimes/overview`)
          .then(async (res) => {
            if (!res.ok) return [];
            const data = await res.json();
            const lists = data.results?.lists || [];
            const booksInList = lists.flatMap((list: any) => list.books || []);
            const queryLower = searchQuery.toLowerCase().trim();
            return booksInList
              .filter((b: any) => 
                b && 
                b.book_image && 
                ((b.title || "").toLowerCase().includes(queryLower) || 
                 queryLower.includes((b.title || "").toLowerCase()))
              )
              .map((b: any) => ({
                url: b.book_image,
                source: "NYT Best Sellers"
              }))
              .slice(0, 6);
          })
          .catch(() => [])
      );

      const resultsArray = await Promise.all(searchPromises);
      let combinedResults = resultsArray.flat();

      // Always prepend direct matches for the current book
      // 5. Direct Anna's Archive Match (if book md5 is available)
      if (book.md5) {
        combinedResults.unshift({
          url: `/api/cover-redirect?md5=${book.md5}`,
          source: "Ana's Archive"
        });
      }

      // 6. Direct NYT Bestseller Match
      combinedResults.unshift({
        url: `/api/cover-redirect?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author || "")}`,
        source: "NYT Best Sellers"
      });

      // De-duplicate results by URL
      const seen = new Set<string>();
      const finalResults = combinedResults.filter(item => {
        if (!item.url || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });

      setResults(finalResults);
      if (finalResults.length === 0) {
        setError("No covers found for this search. Try a different query.");
      }
    } catch (err) {
      setError("Failed to search book covers.");
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
      <div className="relative w-full max-w-2xl bg-kindle-card rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in fade-in duration-200 border border-kindle-border">
        <div className="p-6 border-b border-kindle-border flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-bold font-sans tracking-tight text-kindle-text">Edit Book Cover</h3>
            <p className="text-[10px] text-kindle-text-muted font-bold uppercase tracking-widest">{book.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-kindle-bg rounded-xl transition text-kindle-text">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-kindle-border bg-kindle-card">
          <button 
            onClick={() => setActiveTab("search")}
            className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-colors ${activeTab === "search" ? "bg-kindle-bg text-kindle-accent border-b-2 border-kindle-accent" : "bg-kindle-card text-kindle-text-muted hover:bg-kindle-bg"}`}
          >
            Search Online
          </button>
          <button 
            onClick={() => setActiveTab("upload")}
            className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-colors ${activeTab === "upload" ? "bg-kindle-bg text-kindle-accent border-b-2 border-kindle-accent" : "bg-kindle-card text-kindle-text-muted hover:bg-kindle-bg"}`}
          >
            Upload Custom
          </button>
        </div>

        <div className="p-6 h-[400px] overflow-y-auto custom-scrollbar bg-kindle-bg">
          {activeTab === "search" ? (
            <div className="space-y-6">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-kindle-card border border-kindle-border text-kindle-text rounded-xl px-4 py-2 text-sm outline-none focus:border-kindle-accent transition"
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <button 
                  onClick={handleSearch}
                  className="px-4 py-2 bg-kindle-text text-kindle-bg rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-kindle-accent hover:text-white transition"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-kindle-text-muted">
                  <Loader2 className="w-8 h-8 animate-spin mb-4 text-kindle-accent" />
                  <p className="text-xs uppercase tracking-widest font-bold">Searching Cover Sources...</p>
                </div>
              ) : error ? (
                <p className="text-center py-20 text-red-500 text-xs">{error}</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                  {results.map((item, idx) => (
                    <button 
                      key={idx} 
                      onClick={() => handleSelectCover(item.url)}
                      className="aspect-[3/4] rounded-xl overflow-hidden border border-kindle-border hover:border-kindle-accent transition group relative bg-kindle-card flex items-center justify-center animate-in fade-in zoom-in-95 duration-200"
                    >
                      <img src={item.url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                      <div className="absolute top-1.5 left-1.5 bg-black/85 text-white text-[7px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded shadow-sm">
                        {item.source}
                      </div>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 flex items-center justify-center transition">
                        <Check className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-kindle-border rounded-3xl bg-kindle-card p-8 text-center space-y-4">
              <div className="p-4 bg-kindle-bg border border-kindle-border rounded-full shadow-md">
                {uploading ? <Loader2 className="w-8 h-8 animate-spin text-kindle-accent" /> : <Upload className="w-8 h-8 text-kindle-text-muted" />}
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-sm text-kindle-text">Select high-quality cover image</h4>
                <p className="text-xs text-kindle-text-muted">Supports JPG, PNG, WEBP</p>
              </div>
              <label className="px-6 py-3 bg-kindle-text text-kindle-bg rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-kindle-accent transition cursor-pointer shadow-lg inline-flex items-center gap-2 hover:text-white">
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
