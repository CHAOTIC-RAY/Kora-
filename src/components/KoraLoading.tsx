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

const FLAP_COUNT = 4;
const PAGE_TURN_CYCLE = 3.6;
const SLOT = PAGE_TURN_CYCLE / FLAP_COUNT;

/** Corner flap size (% of icon box) — each layer peels a larger corner wedge. */
const FLAP_SIZES = ["36%", "50%", "66%", "84%"] as const;

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

function flapKeyframes(index: number) {
  const slotStart = (index * SLOT) / PAGE_TURN_CYCLE;
  const lift = (index * SLOT + SLOT * 0.22) / PAGE_TURN_CYCLE;
  const mid = (index * SLOT + SLOT * 0.52) / PAGE_TURN_CYCLE;
  const end = ((index + 1) * SLOT) / PAGE_TURN_CYCLE;

  return {
    times: [0, slotStart, lift, mid, end, 1],
    rotateY: [0, 0, -22, -168, -178, 0] as number[],
    rotateX: [0, 0, -8, -16, -10, 0] as number[],
    shadow: [0, 0, 0.35, 0.55, 0.2, 0] as number[],
  };
}

function CornerFlap({
  index,
  size,
  iconClass,
  compact,
}: {
  index: number;
  size: string;
  iconClass: string;
  compact: boolean;
}) {
  const { times, rotateY, rotateX, shadow } = flapKeyframes(index);
  const iconW = compact ? "2.5rem" : "3.35rem";
  const iconH = compact ? "3rem" : "4rem";

  return (
    <div
      className="pointer-events-none absolute bottom-0 right-0 overflow-hidden"
      style={{
        width: size,
        height: size,
        clipPath: "polygon(0 0, 100% 0, 100% 100%)",
        WebkitClipPath: "polygon(0 0, 100% 0, 100% 100%)",
        zIndex: FLAP_COUNT - index,
      }}
    >
      <motion.div
        className="absolute bottom-0 right-0"
        style={{
          width: iconW,
          height: iconH,
          transformOrigin: "100% 100%",
          transformStyle: "preserve-3d",
        }}
        animate={{ rotateY, rotateX }}
        transition={{
          duration: PAGE_TURN_CYCLE,
          repeat: Infinity,
          ease: [0.42, 0.02, 0.18, 1],
          times,
        }}
      >
        <div
          className="absolute inset-0"
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
        >
          <KoraIcon className={`${iconClass} text-kindle-accent`} />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, transparent 58%, rgba(0,0,0,0.12) 78%, rgba(0,0,0,0.22) 100%)",
            }}
          />
        </div>

        <div
          className="absolute inset-0 rounded-sm bg-gradient-to-br from-kindle-card via-kindle-bg to-kindle-card/80"
          style={{
            transform: "rotateY(180deg)",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            boxShadow: "inset 0 0 12px rgba(0,0,0,0.08)",
          }}
        />
      </motion.div>

      <motion.div
        className="pointer-events-none absolute left-0 top-0 h-[141%] w-px origin-top-left bg-black/25"
        style={{ transform: "rotate(-45deg)" }}
        animate={{ opacity: shadow }}
        transition={{
          duration: PAGE_TURN_CYCLE,
          repeat: Infinity,
          ease: "easeInOut",
          times,
        }}
      />
    </div>
  );
}

function KoraPageTurnIcon({ compact }: { compact: boolean }) {
  const iconClass = compact ? "h-12 w-auto" : "h-16 w-auto";
  const boxClass = compact ? "h-12 w-10" : "h-16 w-[3.35rem]";

  return (
    <div
      className={`relative overflow-visible ${boxClass}`}
      style={{
        perspective: "480px",
        perspectiveOrigin: "92% 96%",
      }}
    >
      <div className="absolute inset-0 translate-y-[3px] opacity-20">
        <KoraIcon className={`${iconClass} text-kindle-accent`} />
      </div>
      <div className="absolute inset-0 translate-x-[1px] translate-y-[5px] opacity-30">
        <KoraIcon className={`${iconClass} text-kindle-accent`} />
      </div>

      <div className="absolute inset-0 opacity-50">
        <KoraIcon className={`${iconClass} text-kindle-accent/70`} />
      </div>

      <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {FLAP_SIZES.map((size, index) => (
          <CornerFlap
            key={size}
            index={index}
            size={size}
            iconClass={iconClass}
            compact={compact}
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

      <div className="relative flex items-center justify-center overflow-visible">
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
