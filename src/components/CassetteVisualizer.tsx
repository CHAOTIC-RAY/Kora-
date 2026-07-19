import React from "react";
import { Headphones } from "lucide-react";
import { resolveCoverImageSrc } from "../lib/coverImage";

export interface CassetteVisualizerProps {
  title: string;
  coverUrl?: string;
  grayscaleCovers?: boolean;
  hideCovers?: boolean;
  size?: "thumb" | "card" | "player";
  playing?: boolean;
  className?: string;
}

function CassetteScrew({ className }: { className: string }) {
  return (
    <div className={`absolute rounded-full bg-neutral-600 border border-neutral-500/80 shadow-inner ${className}`}>
      <div className="absolute inset-[28%] rounded-full bg-neutral-800" />
      <div className="absolute top-1/2 left-[22%] right-[22%] h-[1px] -translate-y-1/2 bg-neutral-500/60" />
      <div className="absolute left-1/2 top-[22%] bottom-[22%] w-[1px] -translate-x-1/2 bg-neutral-500/60" />
    </div>
  );
}

function CassetteReel({
  playing,
  reverse,
  className,
}: {
  playing: boolean;
  reverse?: boolean;
  className: string;
}) {
  return (
    <div className={`relative ${className}`}>
      {/* Outer flange */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-neutral-500 to-neutral-800 border border-neutral-600/90 shadow-md" />
      {/* Tape pack ring */}
      <div className="absolute inset-[8%] rounded-full border border-amber-950/30 bg-amber-900/20" />
      {/* Spinning hub */}
      <div
        className={`absolute inset-[16%] rounded-full bg-gradient-to-br from-neutral-700 to-neutral-950 border border-neutral-600/70 ${
          playing ? (reverse ? "cassette-reel-spin-reverse" : "cassette-reel-spin") : ""
        }`}
      >
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <div
            key={deg}
            className="absolute top-1/2 left-1/2 w-[42%] h-[1.5px] origin-left bg-neutral-500/35"
            style={{ transform: `rotate(${deg}deg)` }}
          />
        ))}
        <div className="absolute inset-[30%] rounded-full bg-gradient-to-br from-neutral-600 to-neutral-900 border border-neutral-500/40" />
        <div className="absolute top-1/2 left-1/2 w-[16%] h-[16%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-400/30 shadow-inner" />
      </div>
    </div>
  );
}

function VuDots({ playing, count = 4 }: { playing: boolean; count?: number }) {
  return (
    <div className="flex items-end gap-[2px] h-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`w-[3px] rounded-[1px] bg-white/70 ${playing ? "cassette-vu-bar" : ""}`}
          style={{
            height: `${40 + i * 18}%`,
            animationDelay: playing ? `${i * 0.12}s` : undefined,
          }}
        />
      ))}
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

  const coverSrc = resolveCoverImageSrc(coverUrl);

  const shellRadius = isThumb ? "rounded-[6px]" : isPlayer ? "rounded-[18px]" : "rounded-[14px]";
  const labelSize = isThumb ? "text-[4px]" : isPlayer ? "text-[8px]" : "text-[6.5px]";
  const reelSize = isThumb ? "w-3 h-3" : isPlayer ? "w-11 h-11" : "w-6 h-6";
  const screwSize = isThumb ? "w-1 h-1" : isPlayer ? "w-2.5 h-2.5" : "w-1.5 h-1.5";

  const displayTitle = title.length > (isPlayer ? 28 : isThumb ? 14 : 22)
    ? `${title.slice(0, isPlayer ? 26 : isThumb ? 12 : 20)}…`
    : title;

  return (
    <div
      className={`relative flex flex-col items-center justify-center w-full shrink-0 ${
        isPlayer
          ? "max-w-md w-full h-[168px] sm:h-[188px]"
          : isThumb
            ? "w-16 h-11"
            : "aspect-[10/6.2] min-h-[92px]"
      } ${className}`}
    >
      <div
        className={`cassette-shell relative w-full h-full overflow-hidden ${shellRadius} ${
          playing ? "cassette-shell-active" : ""
        }`}
      >
        {/* Plastic shell texture + depth */}
        <div className="absolute inset-0 cassette-plastic" />
        <div className="absolute inset-0 cassette-highlight pointer-events-none" />

        {/* Top label strip — ruled paper look */}
        <div className="absolute top-0 left-0 right-0 h-[20%] cassette-label-strip border-b border-black/50">
          <div className="absolute inset-0 cassette-label-lines opacity-30" />
          <div className="relative h-full flex items-center justify-between px-2 gap-1.5">
            <div className="flex items-center gap-1 min-w-0">
              <div
                className={`rounded-full shrink-0 border border-white/30 ${
                  playing ? "bg-red-400/90 cassette-rec-blink" : "bg-white/20"
                } ${isThumb ? "w-1 h-1" : "w-1.5 h-1.5"}`}
              />
              {!isThumb && (
                <span className="text-[5px] font-mono text-white/50 uppercase tracking-widest hidden sm:inline">
                  {playing ? "PLAY" : "STOP"}
                </span>
              )}
            </div>
            <span
              className={`text-white/95 font-bold uppercase tracking-[0.12em] truncate font-mono flex-1 text-center ${labelSize}`}
            >
              {displayTitle}
            </span>
            {!isThumb && <VuDots playing={playing} count={isPlayer ? 5 : 3} />}
          </div>
        </div>

        {/* Window recess bezel */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 cassette-window-bezel ${
            isThumb
              ? "top-[23%] w-[78%] h-[52%] rounded-[3px]"
              : isPlayer
                ? "top-[22%] w-[72%] h-[54%] rounded-lg"
                : "top-[23%] w-[76%] h-[52%] rounded-md"
          }`}
        >
          {/* Cover / art behind window */}
          <div className="absolute inset-[3px] rounded-[inherit] overflow-hidden bg-black">
            {!hideCovers && coverSrc ? (
              <img
                src={coverSrc}
                alt={title}
                className={`w-full h-full object-cover opacity-90 ${grayscaleCovers ? "grayscale" : ""}`}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-neutral-900">
                <Headphones
                  className={`text-white/25 ${isThumb ? "w-3 h-3" : isPlayer ? "w-10 h-10" : "w-5 h-5"}`}
                />
              </div>
            )}
            {/* Glass reflection */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/30 pointer-events-none" />
          </div>

          {/* Tape path overlay at bottom of window */}
          <div className="absolute bottom-[8%] left-[10%] right-[10%] flex items-center justify-between pointer-events-none">
            <div className={`${reelSize} opacity-95`}>
              <CassetteReel playing={playing} className="w-full h-full" />
            </div>

            {/* Magnetic tape ribbon between reels */}
            <div className="flex-1 mx-1 relative h-[3px]">
              <div className="absolute inset-0 rounded-full bg-amber-950/60 border border-amber-800/30" />
              <div
                className={`absolute inset-y-0 left-0 rounded-full bg-amber-700/50 ${
                  playing ? "cassette-tape-flow" : "w-full"
                }`}
              />
              {playing && <div className="absolute inset-0 cassette-tape-shimmer rounded-full" />}
            </div>

            <div className={`${reelSize} opacity-95`}>
              <CassetteReel playing={playing} reverse className="w-full h-full" />
            </div>
          </div>
        </div>

        {/* Bottom ridge + pressure pad */}
        {!isThumb && (
          <div
            className={`absolute left-1/2 -translate-x-1/2 bottom-[6%] rounded-sm bg-neutral-800/80 border border-neutral-700/50 ${
              isPlayer ? "w-[28%] h-[6px]" : "w-[24%] h-[4px]"
            }`}
          />
        )}

        {/* Corner screws */}
        <CassetteScrew className={`top-[5px] left-[5px] ${screwSize}`} />
        <CassetteScrew className={`top-[5px] right-[5px] ${screwSize}`} />
        <CassetteScrew className={`bottom-[5px] left-[5px] ${screwSize}`} />
        <CassetteScrew className={`bottom-[5px] right-[5px] ${screwSize}`} />

        {/* Write-protect notches */}
        {!isThumb && (
          <>
            <div className="absolute top-[20%] left-0 w-[3px] h-[8%] bg-black/40 rounded-r-sm" />
            <div className="absolute top-[20%] right-0 w-[3px] h-[8%] bg-black/40 rounded-l-sm" />
          </>
        )}
      </div>
    </div>
  );
}
