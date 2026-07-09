import React, { useState } from "react";
import { MessageSquare, Search, BookOpen } from "lucide-react";
import HardcoverCommunity from "./HardcoverCommunity";

export default function HardcoverCommunityTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedQuery(searchQuery);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-32 animate-in fade-in duration-500">
      <section className="space-y-4 px-4 md:px-0 pt-8">
        <h2 className="text-xl font-bold font-sans">Community</h2>
        <p className="text-xs text-kindle-text-muted max-w-2xl leading-relaxed">
          Explore book reviews, ratings, and social commentary from the Hardcover community. 
          Search for a book to see what others are saying.
        </p>

        <form onSubmit={handleSearch} className="relative max-w-lg mt-6">
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for a book..."
            className="w-full bg-kindle-bg border-2 border-kindle-border rounded-xl px-12 py-3.5 text-sm focus:outline-none focus:border-kindle-accent focus:ring-1 focus:ring-kindle-accent transition font-sans placeholder:text-kindle-text-muted/60 shadow-sm"
          />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-kindle-text-muted" />
          <button 
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-kindle-accent text-kindle-bg p-2 rounded-lg hover:brightness-110 transition shadow-md"
          >
            <Search className="w-4 h-4" />
          </button>
        </form>
      </section>

      {submittedQuery ? (
        <section className="px-4 md:px-0 border-t border-kindle-border pt-8">
          <HardcoverCommunity book={{ title: submittedQuery } as any} />
        </section>
      ) : (
        <div className="py-24 text-center text-kindle-text-muted space-y-4">
          <MessageSquare className="w-12 h-12 mx-auto opacity-20" />
          <p className="text-sm">Search for a book to view community discussions</p>
        </div>
      )}
    </div>
  );
}
