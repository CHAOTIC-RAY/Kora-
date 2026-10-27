import React from "react";
import { getDisplayRating } from "../../lib/bookRating";

export default function DiscoverRatingBadge({ book, className = "" }: { book: any; className?: string }) {
  const display = getDisplayRating(book);
  if (!display) return null;
  return (
    <div
      className={`absolute top-2 right-2 bg-amber-500/95 text-white font-sans font-bold text-[8.5px] px-1.5 py-0.5 rounded flex items-center gap-0.5 shadow-md z-10 ${className}`}
      title={display.title}
    >
      ★ {display.value}
    </div>
  );
}
