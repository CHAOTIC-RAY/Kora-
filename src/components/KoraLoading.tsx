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

const PAGE_FLAPS = [
  {
    clip: "polygon(72% 62%, 100% 42%, 100% 100%, 58% 100%)",
    delay: 0,
    shade: "text-kindle-accent",
  },
  {
    clip: "polygon(52% 36%, 100% 10%, 100% 100%, 28% 100%)",
    delay: 0.42,
    shade: "text-kindle-accent/90",
  },
  {
    clip: "polygon(24% 0%, 100% 0%, 100% 100%, 0% 88%)",
    delay: 0.84,
    shade: "text-kindle-accent/75",
  },
] as const;

const PAGE_TURN_CYCLE = 2.6;

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

function PageFlap({
  clip,
  delay,
  shade,
  iconClass,
}: {
  clip: string;
  delay: number;
  shade: string;
  iconClass: string;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ clipPath: clip, WebkitClipPath: clip }}
    >
      <motion.div
        className="absolute inset-0"
        style={{
          transformOrigin: "100% 100%",
          transformStyle: "preserve-3d",
        }}
        animate={{
          rotateY: [0, -18, -148, -168, 0],
          rotateX: [0, -6, -14, -10, 0],
          rotateZ: [0, 1.5, 0, -1, 0],
        }}
        transition={{
          duration: PAGE_TURN_CYCLE,
          repeat: Infinity,
          delay,
          ease: [0.42, 0, 0.2, 1],
          times: [0, 0.18, 0.52, 0.68, 1],
        }}
      >
        <div className="absolute inset-0" style={{ backfaceVisibility: "hidden" }}>
          <KoraIcon className={`${iconClass} ${shade}`} />
        </div>
        <div
          className="absolute inset-0"
          style={{ transform: "rotateY(180deg)", backfaceVisibility: "hidden" }}
        >
          <KoraIcon className={`${iconClass} text-kindle-accent/35`} />
        </div>
      </motion.div>
    </div>
  );
}

function KoraPageTurnIcon({ compact }: { compact: boolean }) {
  const iconClass = compact ? "h-12 w-auto" : "h-16 w-auto";

  return (
    <div
      className={`relative ${compact ? "h-12 w-10" : "h-16 w-[3.35rem]"}`}
      style={{ perspective: "760px" }}
    >
      <div className="absolute inset-0 translate-y-[1px] opacity-20">
        <KoraIcon className={`${iconClass} text-kindle-accent`} />
      </div>
      <div className="absolute inset-0 translate-x-[1px] translate-y-[2px] opacity-30">
        <KoraIcon className={`${iconClass} text-kindle-accent`} />
      </div>

      <div className="absolute inset-0 opacity-45">
        <KoraIcon className={`${iconClass} text-kindle-accent/70`} />
      </div>

      {PAGE_FLAPS.map((flap) => (
        <PageFlap
          key={flap.clip}
          clip={flap.clip}
          delay={flap.delay}
          shade={flap.shade}
          iconClass={iconClass}
        />
      ))}

      <motion.div
        className="pointer-events-none absolute bottom-0 right-0 h-[38%] w-[38%] rounded-tl-md bg-gradient-to-br from-black/10 via-transparent to-transparent"
        animate={{ opacity: [0.15, 0.45, 0.15] }}
        transition={{ duration: PAGE_TURN_CYCLE, repeat: Infinity, ease: "easeInOut" }}
      />
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

      <div className="relative flex items-center justify-center">
        <motion.div
          className="absolute -inset-4 rounded-full bg-kindle-accent/10 blur-xl"
          animate={{ opacity: [0.25, 0.5, 0.25] }}
          transition={{ duration: PAGE_TURN_CYCLE, repeat: Infinity, ease: "easeInOut" }}
        />
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
