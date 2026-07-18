import React, { useState, useEffect, ErrorInfo, ReactNode } from "react";
import { MessageSquare, Star, Loader2, Users, AlertTriangle } from "lucide-react";
import { BookMetadata } from "../lib/firebase";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class HardcoverErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("HardcoverCommunity Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="py-8 px-4 border border-kindle-border rounded-xl bg-kindle-bg text-center space-y-2">
          <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto" />
          <p className="text-xs font-bold text-kindle-text-muted uppercase tracking-widest">Reviews Unavailable</p>
          <p className="text-[10px] text-kindle-text-muted/60">An error occurred while loading community data.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

interface HardcoverCommunityProps {
  book: BookMetadata;
}

function HardcoverCommunityContent({ book }: HardcoverCommunityProps) {
  if (!book || !book.title) {
    return (
      <div className="py-8 text-center text-kindle-text-muted text-xs italic">
        No community data available for this title.
      </div>
    );
  }

  const [activeTab, setActiveTab] = useState<"hardcover" | "goodreads">("hardcover");
  const [hardcoverReviews, setHardcoverReviews] = useState<any[]>([]);
  const [goodreadsReviews, setGoodreadsReviews] = useState<any[]>([]);
  
  const [loadingHardcover, setLoadingHardcover] = useState(true);
  const [loadingGoodreads, setLoadingGoodreads] = useState(true);
  
  const [hardcoverError, setHardcoverError] = useState("");
  const [goodreadsError, setGoodreadsError] = useState("");

  useEffect(() => {
    // Reset state when book changes
    setHardcoverReviews([]);
    setGoodreadsReviews([]);
    setLoadingHardcover(true);
    setLoadingGoodreads(true);
    setHardcoverError("");
    setGoodreadsError("");

    // 1. Fetch Hardcover Reviews
    async function fetchHardcover() {
      try {
        const query = `
          query GetBookReviews($title: String!) {
            books(where: {title: {_eq: $title}}, order_by: {users_count: desc}, limit: 1) {
              id
              title
              user_books(where: {review: {_is_null: false}}, limit: 10) {
                rating
                review
                user {
                  name
                  username
                }
              }
            }
          }
        `;
        
        const res = await fetch("/api/hardcover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            variables: { title: book.title }
          })
        });

        const data = await res.json();
        if (data.errors) {
          throw new Error(data.errors[0]?.message || "Failed to fetch from Hardcover");
        }

        const bookData = data.data?.books?.[0];
        if (bookData && bookData.user_books) {
          setHardcoverReviews(bookData.user_books);
        }
      } catch (err: any) {
        setHardcoverError(err.message || "Failed to load Hardcover reviews");
      } finally {
        setLoadingHardcover(false);
      }
    }

    // 2. Fetch Goodreads Reviews
    async function fetchGoodreads() {
      try {
        const res = await fetch("/api/goodreads/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: book.title,
            author: book.author || ""
          })
        });

        if (!res.ok) {
          throw new Error(`Goodreads API failed with status ${res.status}`);
        }

        const data = await res.json();
        if (data && Array.isArray(data.reviews)) {
          setGoodreadsReviews(data.reviews);
        } else {
          setGoodreadsReviews([]);
        }
      } catch (err: any) {
        setGoodreadsError(err.message || "Failed to load Goodreads reviews");
      } finally {
        setLoadingGoodreads(false);
      }
    }

    fetchHardcover();
    fetchGoodreads();
  }, [book.title, book.author]);

  const currentReviews = activeTab === "hardcover" ? hardcoverReviews : goodreadsReviews;
  const currentLoading = activeTab === "hardcover" ? loadingHardcover : loadingGoodreads;
  const currentError = activeTab === "hardcover" ? hardcoverError : goodreadsError;

  const writeReviewUrl = activeTab === "hardcover" 
    ? `https://hardcover.app/books/${book.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    : `https://www.goodreads.com/search?q=${encodeURIComponent(book.title + " " + (book.author || ""))}`;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header & Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-kindle-border pb-4 gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5" />
            Community Reviews
          </h3>
          <p className="text-[10px] text-kindle-text-muted/70 font-semibold uppercase tracking-wider">
            {book.title}
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-2 p-1 bg-kindle-bg/50 border border-kindle-border/40 rounded-xl self-start md:self-auto">
          <button
            onClick={() => setActiveTab("hardcover")}
            className={`px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
              activeTab === "hardcover"
                ? "bg-kindle-card text-kindle-text shadow-sm"
                : "text-kindle-text-muted hover:text-kindle-text"
            }`}
          >
            Hardcover ({loadingHardcover ? "..." : hardcoverReviews.length})
          </button>
          <button
            onClick={() => setActiveTab("goodreads")}
            className={`px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
              activeTab === "goodreads"
                ? "bg-kindle-card text-kindle-text shadow-sm"
                : "text-kindle-text-muted hover:text-kindle-text"
            }`}
          >
            Goodreads ({loadingGoodreads ? "..." : goodreadsReviews.length})
          </button>
        </div>

        {/* Action Button */}
        <button 
          onClick={() => window.open(writeReviewUrl, "_blank")}
          className="px-3 py-1.5 border border-kindle-border rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-neutral-50 transition self-start md:self-auto cursor-pointer"
        >
          Write a Review
        </button>
      </div>

      {/* Main Reviews Container */}
      {currentLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-kindle-text-muted gap-3">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-[10px] uppercase tracking-widest font-bold">
            Loading {activeTab === "hardcover" ? "Hardcover" : "Goodreads"} Reviews...
          </p>
        </div>
      ) : currentError ? (
        <div className="py-12 text-center text-red-500 text-xs font-semibold bg-red-50/10 border border-red-500/20 rounded-2xl">
          {currentError}
        </div>
      ) : currentReviews.length === 0 ? (
        <div className="py-12 text-center text-kindle-text-muted space-y-3 bg-kindle-card/5 border border-kindle-border/30 rounded-2xl">
          <Users className="w-8 h-8 mx-auto opacity-40" />
          <p className="text-xs">No reviews found on {activeTab === "hardcover" ? "Hardcover" : "Goodreads"} for this book yet.</p>
          <button 
            onClick={() => window.open(writeReviewUrl, "_blank")}
            className="px-4 py-2 border border-kindle-border rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-neutral-50 transition cursor-pointer"
          >
            Be the First to Review
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {currentReviews.map((rev, idx) => (
            <div key={idx} className="space-y-3 border-b border-kindle-border/30 pb-5 last:border-0 last:pb-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-kindle-card border border-kindle-border/60 flex items-center justify-center text-[10.5px] font-bold text-kindle-accent">
                    {(rev.user?.name || rev.user?.username || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-kindle-text">
                      {rev.user?.name || rev.user?.username || "Anonymous"}
                    </span>
                    <span className="text-[9px] text-kindle-text-muted font-mono">
                      @{rev.user?.username || "anonymous"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 bg-neutral-50 dark:bg-neutral-900/40 px-2 py-0.5 rounded-md border border-kindle-border/40">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star 
                      key={i} 
                      className={`w-3 h-3 ${i < (rev.rating || 0) ? "text-amber-500 fill-current" : "text-neutral-300 dark:text-neutral-700"}`} 
                    />
                  ))}
                </div>
              </div>
              <div 
                className="text-sm leading-relaxed text-kindle-text max-w-none prose prose-neutral dark:prose-invert [&_p]:mb-2 [&_p:last-child]:mb-0 [&_a]:text-kindle-accent"
                dangerouslySetInnerHTML={{ __html: rev.review || "" }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HardcoverCommunity(props: HardcoverCommunityProps) {
  return (
    <HardcoverErrorBoundary>
      <HardcoverCommunityContent {...props} />
    </HardcoverErrorBoundary>
  );
}
