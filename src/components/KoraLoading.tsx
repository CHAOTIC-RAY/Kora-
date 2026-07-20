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

/** Corner triangles peeling from bottom-right, smallest to largest. */
const PAGE_FLAPS = [
  {
    clip: "polygon(78% 68%, 100% 52%, 100% 100%, 64% 100%)",
    delay: 0,
    z: 4,
    tone: "text-kindle-accent",
  },
  {
    clip: "polygon(62% 48%, 100% 24%, 100% 100%, 38% 100%)",
    delay: 0.38,
    z: 3,
    tone: "text-kindle-accent/95",
  },
  {
    clip: "polygon(42% 24%, 100% 0%, 100% 100%, 14% 100%)",
    delay: 0.76,
    z: 2,
    tone: "text-kindle-accent/85",
  },
  {
    clip: "polygon(14% 0%, 100% 0%, 100% 100%, 0% 92%)",
    delay: 1.14,
    z: 1,
    tone: "text-kindle-accent/75",
  },
] as const;

const PAGE_TURN_CYCLE = 3.2;

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
  z,
  tone,
  iconClass,
}: {
  clip: string;
  delay: number;
  z: number;
  tone: string;
  iconClass: string;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-visible"
      style={{ clipPath: clip, WebkitClipPath: clip, zIndex: z }}
    >
      <motion.div
        className="absolute inset-0 overflow-visible"
        style={{
          transformOrigin: "100% 100%",
          transformStyle: "preserve-3d",
        }}
        animate={{
          rotateY: [0, -8, -72, -155, -175, -12, 0],
          rotateX: [0, -4, -10, -18, -12, -3, 0],
          rotateZ: [0, 2, 1, 0, -1, 0, 0],
          scale: [1, 1, 0.98, 0.96, 0.98, 1, 1],
        }}
        transition={{
          duration: PAGE_TURN_CYCLE,
          repeat: Infinity,
          delay,
          ease: [0.45, 0.02, 0.2, 1],
          times: [0, 0.08, 0.28, 0.5, 0.62, 0.82, 1],
        }}
      >
        <div
          className="absolute inset-0"
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
        >
          <KoraIcon className={`${iconClass} ${tone} drop-shadow-[0_2px_6px_rgba(0,0,0,0.18)]`} />
        </div>
        <div
          className="absolute inset-0"
          style={{
            transform: "rotateY(180deg)",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
        >
          <KoraIcon className={`${iconClass} text-kindle-accent/25`} />
        </div>
      </motion.div>

      <motion.div
        className="pointer-events-none absolute bottom-0 right-0 h-px w-[42%] origin-bottom-right bg-black/20"
        animate={{ opacity: [0, 0.55, 0.2, 0], scaleX: [0.4, 1, 0.7, 0.4] }}
        transition={{
          duration: PAGE_TURN_CYCLE,
          repeat: Infinity,
          delay,
          ease: "easeInOut",
          times: [0, 0.3, 0.55, 1],
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
        perspective: "520px",
        perspectiveOrigin: "88% 92%",
      }}
    >
      <div
        className="absolute inset-0"
        style={{ transformStyle: "preserve-3d", transform: "translateZ(-6px)" }}
      >
        <div className="absolute inset-0 translate-y-[2px] opacity-15">
          <KoraIcon className={`${iconClass} text-kindle-accent`} />
        </div>
        <div className="absolute inset-0 translate-x-[1px] translate-y-[3px] opacity-25">
          <KoraIcon className={`${iconClass} text-kindle-accent`} />
        </div>
        <div className="absolute inset-0 translate-x-[2px] translate-y-[4px] opacity-35">
          <KoraIcon className={`${iconClass} text-kindle-accent`} />
        </div>
      </div>

      <div className="absolute inset-0 opacity-40">
        <KoraIcon className={`${iconClass} text-kindle-accent/65`} />
      </div>

      <div
        className="absolute inset-0"
        style={{ transformStyle: "preserve-3d" }}
      >
        {PAGE_FLAPS.map((flap) => (
          <PageFlap
            key={flap.clip}
            clip={flap.clip}
            delay={flap.delay}
            z={flap.z}
            tone={flap.tone}
            iconClass={iconClass}
          />
        ))}
      </div>

      <motion.div
        className="pointer-events-none absolute bottom-0 right-0 z-10 h-[46%] w-[46%]"
        style={{
          background:
            "radial-gradient(ellipse at 100% 100%, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0.04) 42%, transparent 72%)",
        }}
        animate={{ opacity: [0.2, 0.65, 0.2] }}
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

      <div className="relative flex items-center justify-center overflow-visible">
        <motion.div
          className="absolute -inset-5 rounded-full bg-kindle-accent/10 blur-xl"
          animate={{ opacity: [0.2, 0.45, 0.2] }}
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
