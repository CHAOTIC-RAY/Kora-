import React, { useEffect, useRef } from "react";
import { Headphones } from "lucide-react";
import { resolveCoverImageSrc } from "../lib/coverImage";
import { useCassetteAudioLevels } from "../lib/useCassetteAudioLevels";

export interface CassetteVisualizerProps {
  title: string;
  coverUrl?: string;
  grayscaleCovers?: boolean;
  hideCovers?: boolean;
  size?: "thumb" | "card" | "player";
  orientation?: "landscape" | "portrait";
  playing?: boolean;
  className?: string;
  getAudioElement?: () => HTMLAudioElement | null;
  voiceMode?: boolean;
}

function CassetteScrew({ className }: { className: string }) {
  return (
    <div className={`absolute rounded-full bg-neutral-500/90 border border-neutral-400/60 shadow-inner ${className}`}>
      <div className="absolute inset-[28%] rounded-full bg-neutral-800/90" />
      <div className="absolute top-1/2 left-[22%] right-[22%] h-[1px] -translate-y-1/2 bg-neutral-400/50" />
      <div className="absolute left-1/2 top-[22%] bottom-[22%] w-[1px] -translate-x-1/2 bg-neutral-400/50" />
    </div>
  );
}

function ReelHub({ className }: { className?: string }) {
  return (
    <div className={`absolute inset-[22%] rounded-full bg-gradient-to-br from-neutral-600 to-neutral-950 border border-neutral-500/50 shadow-inner ${className || ""}`}>
      {[0, 60, 120].map((deg) => (
        <div
          key={deg}
          className="absolute top-1/2 left-1/2 w-[46%] h-[2px] origin-left bg-neutral-400/25"
          style={{ transform: `rotate(${deg}deg)` }}
        />
      ))}
      <div className="absolute inset-[34%] rounded-full bg-gradient-to-br from-neutral-500 to-neutral-900 border border-neutral-400/30" />
      <div className="absolute top-1/2 left-1/2 w-[18%] h-[18%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-300/25" />
    </div>
  );
}

function CoverTapeReel({
  playing,
  reverse,
  coverSrc,
  hideCovers,
  grayscaleCovers,
  className,
}: {
  playing: boolean;
  reverse?: boolean;
  coverSrc: string | null;
  hideCovers: boolean;
  grayscaleCovers: boolean;
  className: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <div className="absolute inset-0 rounded-full border border-neutral-500/70 bg-neutral-800/40 shadow-[inset_0_2px_8px_rgba(0,0,0,0.45)]" />

      <div
        className={`absolute inset-[5%] rounded-full overflow-hidden ${
          playing ? (reverse ? "cassette-reel-spin-reverse" : "cassette-reel-spin") : ""
        }`}
      >
        {!hideCovers && coverSrc ? (
          <>
            <img
              src={coverSrc}
              alt=""
              className={`absolute inset-0 w-full h-full object-cover scale-110 ${grayscaleCovers ? "grayscale" : ""}`}
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_18%,rgba(69,26,3,0.15)_32%,rgba(69,26,3,0.55)_58%,rgba(28,12,4,0.92)_78%)]" />
            {[22, 34, 46, 58].map((inset) => (
              <div
                key={inset}
                className="absolute rounded-full border border-amber-950/25"
                style={{ inset: `${inset}%` }}
              />
            ))}
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-amber-950/80 via-amber-900/50 to-neutral-900 flex items-center justify-center">
            <Headphones className="w-[38%] h-[38%] text-white/20" />
          </div>
        )}

        <ReelHub />
      </div>
    </div>
  );
}

function VisualizerTapeReel({
  playing,
  reverse,
  levels,
  className,
}: {
  playing: boolean;
  reverse?: boolean;
  levels: number[];
  className: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth || 120;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = size / 2;
    const cy = size / 2;
    const innerR = size * 0.16;
    const maxOuter = size * 0.44;
    const bars = levels.length;

    ctx.clearRect(0, 0, size, size);

    for (let i = 0; i < bars; i++) {
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const level = playing ? levels[i] ?? 0 : 0.08;
      const outerR = innerR + 6 + level * (maxOuter - innerR - 6);
      const x1 = cx + Math.cos(angle) * innerR;
      const y1 = cy + Math.sin(angle) * innerR;
      const x2 = cx + Math.cos(angle) * outerR;
      const y2 = cy + Math.sin(angle) * outerR;

      const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
      gradient.addColorStop(0, "rgba(251, 191, 36, 0.35)");
      gradient.addColorStop(1, `rgba(251, 146, 60, ${0.45 + level * 0.55})`);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = Math.max(2, size * 0.028);
      ctx.lineCap = "round";
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, innerR * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(24, 24, 27, 0.85)";
    ctx.fill();
  }, [levels, playing]);

  return (
    <div className={`relative ${className}`}>
      <div className="absolute inset-0 rounded-full border border-neutral-500/70 bg-neutral-800/35 shadow-[inset_0_2px_8px_rgba(0,0,0,0.45)]" />

      <div
        className={`absolute inset-[5%] rounded-full ${
          playing ? (reverse ? "cassette-reel-spin-reverse" : "cassette-reel-spin") : ""
        }`}
      >
        <div className="absolute inset-[8%] rounded-full bg-gradient-to-br from-neutral-700/50 to-neutral-950/80 border border-neutral-600/40" />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        <ReelHub />
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
  orientation = "landscape",
  playing = false,
  className = "",
  getAudioElement,
  voiceMode = false,
}: CassetteVisualizerProps) {
  const isThumb = size === "thumb";
  const isPlayer = size === "player";
  const isPortrait = orientation === "portrait" && !isThumb && !isPlayer;
  const barCount = isThumb ? 12 : isPlayer ? 28 : 18;
  const levels = useCassetteAudioLevels(playing, getAudioElement, voiceMode, barCount);

  const coverSrc = resolveCoverImageSrc(coverUrl);

  const shellRadius = isThumb ? "rounded-[6px]" : isPlayer ? "rounded-[18px]" : "rounded-[14px]";
  const labelSize = isThumb ? "text-[4px]" : isPlayer ? "text-[8px]" : "text-[6.5px]";
  const coverReelSize = isThumb
    ? "w-[42%] max-w-[1.65rem]"
    : isPlayer
      ? "w-[48%] max-w-[9.5rem]"
      : "w-[42%] max-w-[3.9rem]";
  const visualizerReelSize = isThumb
    ? "w-[22%] max-w-[0.95rem]"
    : isPlayer
      ? "w-[24%] max-w-[4.25rem]"
      : "w-[22%] max-w-[2rem]";
  const screwSize = isThumb ? "w-1 h-1" : isPlayer ? "w-2.5 h-2.5" : "w-1.5 h-1.5";

  const displayTitle = title.length > (isPlayer ? 28 : isThumb ? 14 : 22)
    ? `${title.slice(0, isPlayer ? 26 : isThumb ? 12 : 20)}…`
    : title;

  const shell = (
    <div
      className={`cassette-shell cassette-shell-transparent relative w-full h-full overflow-hidden ${shellRadius} ${
        playing ? "cassette-shell-active" : ""
      }`}
    >
      <div className="absolute inset-0 cassette-plastic-transparent" />
      <div className="absolute inset-0 cassette-highlight pointer-events-none" />

      <div className="absolute top-0 left-0 right-0 h-[18%] cassette-label-strip border-b border-black/40">
        <div className="absolute inset-0 cassette-label-lines opacity-25" />
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

      <div
        className={`absolute left-1/2 -translate-x-1/2 cassette-window-bezel cassette-window-transparent ${
          isThumb
            ? "top-[21%] w-[84%] h-[58%] rounded-[3px]"
            : isPlayer
              ? "top-[19%] w-[78%] h-[62%] rounded-xl"
              : "top-[21%] w-[82%] h-[58%] rounded-md"
        }`}
      >
        <div className="absolute inset-[3px] rounded-[inherit] overflow-hidden cassette-window-glass">
          <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/20 via-transparent to-neutral-950/35" />

          <div className="absolute inset-x-[6%] top-[14%] bottom-[18%] flex items-center justify-between gap-[3%]">
            <CoverTapeReel
              playing={playing}
              coverSrc={coverSrc}
              hideCovers={hideCovers}
              grayscaleCovers={grayscaleCovers}
              className={`${coverReelSize} aspect-square shrink-0`}
            />

            <div className="flex-1 relative h-[10%] min-w-[10%] max-w-[24%] self-center">
              <div className="absolute inset-0 rounded-full bg-amber-950/70 border border-amber-900/40 shadow-inner" />
              <div
                className={`absolute inset-y-[18%] left-[8%] right-[8%] rounded-full bg-gradient-to-r from-amber-800/80 via-amber-600/70 to-amber-800/80 ${
                  playing ? "cassette-tape-pulse" : ""
                }`}
              />
              {playing && <div className="absolute inset-0 cassette-tape-shimmer rounded-full opacity-70" />}
            </div>

            <VisualizerTapeReel
              playing={playing}
              reverse
              levels={levels}
              className={`${visualizerReelSize} aspect-square shrink-0`}
            />
          </div>

          <div className="absolute inset-0 bg-gradient-to-br from-white/12 via-transparent to-black/25 pointer-events-none" />
          <div className="absolute inset-x-[8%] top-[8%] h-[18%] bg-gradient-to-b from-white/10 to-transparent pointer-events-none rounded-t-[inherit]" />
        </div>
      </div>

      {!isThumb && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 bottom-[7%] rounded-sm bg-neutral-700/70 border border-neutral-500/40 ${
            isPlayer ? "w-[30%] h-[7px]" : "w-[24%] h-[4px]"
          }`}
        />
      )}

      <CassetteScrew className={`top-[5px] left-[5px] ${screwSize}`} />
      <CassetteScrew className={`top-[5px] right-[5px] ${screwSize}`} />
      <CassetteScrew className={`bottom-[5px] left-[5px] ${screwSize}`} />
      <CassetteScrew className={`bottom-[5px] right-[5px] ${screwSize}`} />

      {!isThumb && (
        <>
          <div className="absolute top-[18%] left-0 w-[3px] h-[8%] bg-black/30 rounded-r-sm" />
          <div className="absolute top-[18%] right-0 w-[3px] h-[8%] bg-black/30 rounded-l-sm" />
        </>
      )}
    </div>
  );

  return (
    <div
      className={`relative flex flex-col items-center justify-center w-full shrink-0 ${
        isPlayer
          ? "max-w-md w-full h-[188px] sm:h-[210px]"
          : isThumb
            ? "w-16 h-11"
            : isPortrait
              ? "aspect-[2/3] w-full"
              : "aspect-[10/6.2] min-h-[92px]"
      } ${className}`}
    >
      {isPortrait ? (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-gradient-to-b from-neutral-900/25 to-neutral-950/40">
          <div className="rotate-90 w-[148%] aspect-[10/6.2] shrink-0">{shell}</div>
        </div>
      ) : (
        shell
      )}
    </div>
  );
}
