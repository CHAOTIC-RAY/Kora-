import React from "react";
import { Headphones } from "lucide-react";

export interface CassetteVisualizerProps {
  title: string;
  coverUrl?: string;
  grayscaleCovers?: boolean;
  hideCovers?: boolean;
  size?: "thumb" | "card" | "player";
  playing?: boolean;
  className?: string;
}

function CassetteReel({
  playing,
  className,
}: {
  playing: boolean;
  className: string;
}) {
  return (
    <div className={`relative rounded-full border-2 border-neutral-500/70 bg-neutral-800 ${className}`}>
      <div
        className={`absolute inset-[18%] rounded-full bg-neutral-950 border border-neutral-600/60 ${
          playing ? "cassette-reel-spin" : ""
        }`}
      >
        <div className="absolute inset-[28%] rounded-full bg-neutral-700/80" />
        <div className="absolute top-1/2 left-1/2 w-[18%] h-[18%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-500/50" />
      </div>
    </div>
  );
}

export default function CassetteVisualizer({
  title,
  coverUrl,
  grayscaleCovers = false,
  hideCovers = false,
  size = "card",
  playing = false,
  className = "",
}: CassetteVisualizerProps) {
  const isThumb = size === "thumb";
  const isPlayer = size === "player";

  const coverSrc = coverUrl
    ? coverUrl.startsWith("http")
      ? `/api/proxy-image?url=${encodeURIComponent(coverUrl)}`
      : coverUrl
    : null;

  const shellRadius = isThumb ? "rounded-md" : isPlayer ? "rounded-2xl" : "rounded-xl";
  const labelSize = isThumb ? "text-[5px]" : isPlayer ? "text-[9px]" : "text-[7px]";
  const reelSize = isThumb ? "w-2.5 h-2.5" : isPlayer ? "w-10 h-10" : "w-5 h-5";

  return (
    <div
      className={`relative flex flex-col items-center justify-center w-full ${
        isPlayer ? "max-w-sm" : isThumb ? "w-16 h-11" : "aspect-[5/3] min-h-[88px]"
      } ${className}`}
    >
      <div
        className={`relative w-full h-full overflow-hidden shadow-lg border border-neutral-600/80 ${shellRadius}`}
        style={{
          background: "linear-gradient(155deg, #3a3a3f 0%, #1f1f23 42%, #2b2b30 100%)",
        }}
      >
        {/* Label strip */}
        <div className="absolute top-0 left-0 right-0 h-[18%] bg-gradient-to-b from-neutral-500/90 to-neutral-600/80 border-b border-black/40 flex items-center px-2 gap-1.5">
          <div className={`rounded-full bg-white/80 shrink-0 ${isThumb ? "w-1 h-1" : "w-1.5 h-1.5"}`} />
          <span className={`text-white/95 font-bold uppercase tracking-[0.14em] truncate font-mono ${labelSize}`}>
            {title}
          </span>
        </div>

        {/* Cover window */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 bg-black/50 border border-black/60 overflow-hidden ${
            isThumb
              ? "top-[22%] w-[70%] h-[48%] rounded-[2px]"
              : isPlayer
                ? "top-[22%] w-[58%] h-[44%] rounded-md"
                : "top-[24%] w-[62%] h-[46%] rounded-sm"
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
            <div className="w-full h-full flex items-center justify-center bg-neutral-800/60">
              <Headphones
                className={`text-white/40 ${isThumb ? "w-3 h-3" : isPlayer ? "w-8 h-8" : "w-5 h-5"}`}
              />
            </div>
          )}
        </div>

        {/* Tape ribbon */}
        <div
          className={`absolute left-[20%] right-[20%] bg-amber-900/40 rounded-full ${
            isPlayer ? "bottom-[30%] h-1" : "bottom-[28%] h-[3px]"
          } ${playing ? "cassette-tape-pulse" : ""}`}
        />

        <CassetteReel playing={playing} className={`absolute bottom-[10%] left-[12%] ${reelSize}`} />
        <CassetteReel playing={playing} className={`absolute bottom-[10%] right-[12%] ${reelSize}`} />

        {/* Screw details */}
        {!isThumb && (
          <>
            <div className="absolute top-[7px] right-[7px] w-1 h-1 rounded-full bg-neutral-400/30" />
            <div className="absolute bottom-[7px] left-[7px] w-1 h-1 rounded-full bg-neutral-400/30" />
          </>
        )}
      </div>
    </div>
  );
}
