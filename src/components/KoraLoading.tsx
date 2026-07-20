import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { KoraIcon, KoraWordmark } from "./KoraLogo";

export type KoraLoadingContext =
  | "app"
  | "reader"
  | "audiobook-player"
  | "search"
  | "audiobook-search"
  | "category";

interface KoraLoadingProps {
  context?: KoraLoadingContext;
  message?: string;
  query?: string;
  categorySource?: string;
  compact?: boolean;
}

const APP_MESSAGES = [
  "Getting things ready…",
  "Setting up your shelf…",
  "Almost there…",
];

const PAGE_TURN_CYCLE = 2.8;

/** Ghost/onion-skin flap offsets — like the paper-turn logo stills. */
const GHOST_FLAPS = [
  { delay: 0, opacity: 0.95, scale: 1 },
  { delay: 0.12, opacity: 0.55, scale: 1.04 },
  { delay: 0.24, opacity: 0.32, scale: 1.08 },
  { delay: 0.36, opacity: 0.16, scale: 1.12 },
] as const;

function truncateQuery(query: string, max = 36) {
  const trimmed = query.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function resolveMessage(
  context: KoraLoadingContext,
  query?: string,
  categorySource?: string
): string | string[] {
  switch (context) {
    case "app":
      return APP_MESSAGES;
    case "reader":
      return "Opening your book…";
    case "audiobook-player":
      return "Starting your listen…";
    case "search":
      return query?.trim()
        ? `Looking for “${truncateQuery(query)}”…`
        : "Searching for books…";
    case "audiobook-search":
      return query?.trim()
        ? `Finding audiobooks for “${truncateQuery(query)}”…`
        : "Finding audiobooks…";
    case "category":
      if (categorySource === "audiobook") return "Pulling together audiobook picks…";
      if (categorySource === "goodreads") return "Gathering reader favorites…";
      return "Loading what’s trending…";
    default:
      return "Just a moment…";
  }
}

/** Triangle paper flap peeling from the top-right corner with fold gradients. */
function PaperFlapLayer({
  delay,
  opacity,
  scale,
  size,
}: {
  delay: number;
  opacity: number;
  scale: number;
  size: number;
}) {
  return (
    <motion.div
      className="pointer-events-none absolute right-0 top-0 origin-top-right"
      style={{
        width: size,
        height: size,
        transformStyle: "preserve-3d",
      }}
      animate={{
        rotateY: [0, -28, -118, -168, -12, 0],
        rotateX: [0, 8, 14, 6, 2, 0],
        rotateZ: [0, -4, -8, -3, 0, 0],
        opacity: [0, opacity, opacity * 0.9, opacity * 0.55, 0.08, 0],
        scale: [0.92, scale, scale * 1.02, scale, 0.96, 0.92],
      }}
      transition={{
        duration: PAGE_TURN_CYCLE,
        repeat: Infinity,
        delay,
        ease: [0.45, 0.05, 0.2, 1],
        times: [0, 0.12, 0.38, 0.58, 0.82, 1],
      }}
    >
      {/* Front of paper — light face with fold gradient */}
      <div
        className="absolute inset-0"
        style={{
          clipPath: "polygon(0 0, 100% 0, 100% 100%)",
          WebkitClipPath: "polygon(0 0, 100% 0, 100% 100%)",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          background:
            "linear-gradient(135deg, #f7f4ef 0%, #fffefb 38%, #e8e2d8 72%, #d4cdc2 100%)",
          boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(225deg, rgba(255,255,255,0.85) 0%, transparent 42%, rgba(0,0,0,0.08) 100%)",
          }}
        />
        <div
          className="absolute left-0 top-0 h-full w-[2px] origin-top-left"
          style={{
            transform: "rotate(45deg)",
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.18), rgba(0,0,0,0.04), transparent)",
          }}
        />
      </div>

      {/* Underside of paper */}
      <div
        className="absolute inset-0"
        style={{
          clipPath: "polygon(0 0, 100% 0, 100% 100%)",
          WebkitClipPath: "polygon(0 0, 100% 0, 100% 100%)",
          transform: "rotateY(180deg)",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          background:
            "linear-gradient(315deg, #cfc8bc 0%, #b8b0a4 45%, #9a9288 100%)",
          boxShadow: "inset 0 0 10px rgba(0,0,0,0.15)",
        }}
      />
    </motion.div>
  );
}

function KoraPageTurnIcon({ compact }: { compact: boolean }) {
  const iconClass = compact ? "h-12 w-auto" : "h-16 w-auto";
  const boxClass = compact ? "h-12 w-10" : "h-16 w-[3.35rem]";
  const flapSize = compact ? 28 : 38;

  return (
    <div
      className={`relative overflow-visible ${boxClass}`}
      style={{ perspective: "640px", perspectiveOrigin: "85% 15%" }}
    >
      {/* Soft stack behind the mark */}
      <div className="absolute inset-0 translate-x-[1px] translate-y-[2px] opacity-25">
        <KoraIcon className={`${iconClass} text-kindle-accent`} />
      </div>
      <div className="absolute inset-0 opacity-90">
        <KoraIcon className={`${iconClass} text-kindle-accent`} />
      </div>

      {/* Corner shade under the peel */}
      <motion.div
        className="pointer-events-none absolute right-0 top-0"
        style={{
          width: flapSize * 1.15,
          height: flapSize * 1.15,
          clipPath: "polygon(0 0, 100% 0, 100% 100%)",
          background:
            "linear-gradient(225deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.06) 55%, transparent 100%)",
        }}
        animate={{ opacity: [0.15, 0.55, 0.2, 0.15] }}
        transition={{ duration: PAGE_TURN_CYCLE, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="absolute inset-0 overflow-visible" style={{ transformStyle: "preserve-3d" }}>
        {GHOST_FLAPS.map((flap) => (
          <PaperFlapLayer
            key={flap.delay}
            delay={flap.delay}
            opacity={flap.opacity}
            scale={flap.scale}
            size={flapSize}
          />
        ))}
      </div>
    </div>
  );
}

export default function KoraLoading({
  context = "app",
  message,
  query,
  categorySource,
  compact = false,
}: KoraLoadingProps) {
  const wordmarkSize = compact ? "h-7" : "h-9";

  const resolved = useMemo(
    () => (message ? message : resolveMessage(context, query, categorySource)),
    [message, context, query, categorySource]
  );

  const [cycleIndex, setCycleIndex] = useState(0);

  useEffect(() => {
    setCycleIndex(0);
  }, [resolved]);

  useEffect(() => {
    if (!Array.isArray(resolved) || resolved.length < 2) return;
    const timer = window.setInterval(() => {
      setCycleIndex((i) => (i + 1) % resolved.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, [resolved]);

  const statusMessage = Array.isArray(resolved)
    ? resolved[cycleIndex] ?? resolved[0]
    : resolved;

  return (
    <div
      className={`flex flex-col items-center justify-center ${compact ? "gap-5" : "gap-7"}`}
      role="status"
      aria-live="polite"
      aria-label={statusMessage}
    >
      <KoraWordmark className={`${wordmarkSize} text-kindle-text`} />

      <div className="relative flex items-center justify-center overflow-visible py-1">
        <KoraPageTurnIcon compact={compact} />
      </div>

      <motion.p
        key={statusMessage}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        className="max-w-[220px] text-center text-[8px] leading-relaxed font-medium text-kindle-text-muted/80 sm:max-w-xs sm:text-[9px]"
      >
        {statusMessage}
      </motion.p>
    </div>
  );
}
