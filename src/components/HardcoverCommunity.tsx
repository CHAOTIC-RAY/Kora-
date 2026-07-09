import React, { useState, useEffect } from "react";
import { MessageSquare, Star, Loader2, Users } from "lucide-react";
import { BookMetadata } from "../lib/firebase";

interface HardcoverCommunityProps {
  book: BookMetadata;
}

export default function HardcoverCommunity({ book }: HardcoverCommunityProps) {
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
        <button className="px-4 py-2 border border-kindle-border rounded-full text-xs font-bold uppercase tracking-widest hover:bg-neutral-50 transition">
          Write a Review
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between border-b border-kindle-border pb-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5" />
          Hardcover Community Reviews
        </h3>
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
            <p className="text-sm text-kindle-text-muted leading-relaxed line-clamp-4">
              {rev.review}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
