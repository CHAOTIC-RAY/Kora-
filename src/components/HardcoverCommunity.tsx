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

  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchReviews() {
      setLoading(true);
      setError("");
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
          setReviews(bookData.user_books);
        }
      } catch (err: any) {
        setError(err.message || "Failed to load community reviews");
      } finally {
        setLoading(false);
      }
    }

    fetchReviews();
  }, [book.title]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-kindle-text-muted">
        <Loader2 className="w-6 h-6 animate-spin mb-4" />
        <p className="text-xs uppercase tracking-widest font-bold">Loading Community Reviews</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-red-500 text-xs">
        {error}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="py-12 text-center text-kindle-text-muted space-y-3">
        <Users className="w-8 h-8 mx-auto opacity-50" />
        <p className="text-xs">No reviews found on Hardcover for this book yet.</p>
        <button 
          onClick={() => window.open(`https://hardcover.app/books/${book.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, "_blank")}
          className="px-4 py-2 border border-kindle-border rounded-full text-xs font-bold uppercase tracking-widest hover:bg-neutral-50 transition"
        >
          Write a Review
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-kindle-border pb-4 gap-4">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5" />
          Hardcover Community Reviews
        </h3>
        <button 
          onClick={() => window.open(`https://hardcover.app/books/${book.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, "_blank")}
          className="px-3 py-1.5 border border-kindle-border rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-neutral-50 transition"
        >
          Write a Review
        </button>
      </div>
      
      <div className="space-y-6">
        {reviews.map((rev, idx) => (
          <div key={idx} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-kindle-border flex items-center justify-center text-[10px] font-bold">
                  {rev.user?.name?.charAt(0) || rev.user?.username?.charAt(0) || "?"}
                </div>
                <span className="text-xs font-bold">{rev.user?.name || rev.user?.username || "Anonymous"}</span>
              </div>
              <div className="flex items-center">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star 
                    key={i} 
                    className={`w-3.5 h-3.5 ${i < (rev.rating || 0) ? "text-yellow-500 fill-current" : "text-neutral-300"}`} 
                  />
                ))}
              </div>
            </div>
            <div 
              className="text-base text-kindle-text leading-relaxed prose prose-neutral dark:prose-invert max-w-none [&_p]:mb-2 [&_p:last-child]:mb-0"
              dangerouslySetInnerHTML={{ __html: rev.review || "" }}
            />
          </div>
        ))}
      </div>
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
