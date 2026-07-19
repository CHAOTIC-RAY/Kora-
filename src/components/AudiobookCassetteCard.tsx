import React from "react";
import { Headphones } from "lucide-react";

interface AudiobookCassetteCardProps {
  title: string;
  coverUrl?: string;
  grayscaleCovers?: boolean;
  hideCovers?: boolean;
  size?: "card" | "thumb";
  className?: string;
}

export default function AudiobookCassetteCard({
  title,
  coverUrl,
  grayscaleCovers = false,
  hideCovers = false,
  size = "card",
  className = "",
}: AudiobookCassetteCardProps) {
  const isThumb = size === "thumb";
  const coverSrc = coverUrl
    ? coverUrl.startsWith("http")
      ? `/api/proxy-image?url=${encodeURIComponent(coverUrl)}`
      : coverUrl
    : null;

  return (
    <div
      className={`relative flex flex-col items-center justify-center ${
        isThumb ? "w-16 h-11" : "w-full aspect-[5/3] min-h-[88px]"
      } ${className}`}
    >
      {/* Cassette shell */}
      <div
        className={`relative w-full h-full rounded-lg overflow-hidden shadow-md border border-neutral-700/80 ${
          isThumb ? "rounded-md" : "rounded-xl"
        }`}
        style={{
          background: "linear-gradient(145deg, #2a2a35 0%, #1a1a22 45%, #252530 100%)",
        }}
      >
        {/* Top label strip */}
        <div className="absolute top-0 left-0 right-0 h-[18%] bg-gradient-to-b from-neutral-600/90 to-neutral-700/70 border-b border-black/30 flex items-center px-2 gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-purple-400/80 shrink-0" />
          <span className={`text-white/90 font-bold uppercase tracking-wider truncate ${isThumb ? "text-[5px]" : "text-[7px]"}`}>
            {title}
          </span>
        </div>

        {/* Cover window */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 bg-black/40 border border-black/50 overflow-hidden ${
            isThumb ? "top-[22%] w-[70%] h-[48%] rounded-[2px]" : "top-[24%] w-[62%] h-[46%] rounded-sm"
          }`}
        >
          {!hideCovers && coverSrc ? (
            <img
              src={coverSrc}
              alt={title}
              className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-purple-900/30">
              <Headphones className={isThumb ? "w-3 h-3 text-purple-300/60" : "w-5 h-5 text-purple-300/60"} />
            </div>
          )}
        </div>

        {/* Reel holes */}
        <div className={`absolute bottom-[12%] left-[14%] rounded-full border-2 border-neutral-500/60 bg-neutral-800/80 ${isThumb ? "w-2.5 h-2.5" : "w-5 h-5"}`}>
          <div className={`absolute inset-[22%] rounded-full bg-neutral-900 border border-neutral-600/50`} />
        </div>
        <div className={`absolute bottom-[12%] right-[14%] rounded-full border-2 border-neutral-500/60 bg-neutral-800/80 ${isThumb ? "w-2.5 h-2.5" : "w-5 h-5"}`}>
          <div className={`absolute inset-[22%] rounded-full bg-neutral-900 border border-neutral-600/50`} />
        </div>

        {/* Tape ribbon */}
        <div className="absolute bottom-[28%] left-[22%] right-[22%] h-[3px] bg-amber-900/50 rounded-full" />

        {/* Screw details */}
        <div className={`absolute top-[6px] right-[6px] w-1 h-1 rounded-full bg-neutral-500/40 ${isThumb ? "hidden" : ""}`} />
        <div className={`absolute bottom-[6px] left-[6px] w-1 h-1 rounded-full bg-neutral-500/40 ${isThumb ? "hidden" : ""}`} />
      </div>
    </div>
  );
}
