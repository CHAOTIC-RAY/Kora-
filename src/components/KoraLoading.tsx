import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { KoraWordmark } from "./KoraLogo";

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

export default function KoraLoading({
  context = "app",
  message,
  query,
  categorySource,
  compact = false,
}: KoraLoadingProps) {
  const wordmarkSize = compact ? "h-8" : "h-11";

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
      className={`flex flex-col items-center justify-center ${compact ? "gap-4" : "gap-6"}`}
      role="status"
      aria-live="polite"
      aria-label={statusMessage}
    >
      <motion.div
        initial={{ opacity: 0.55, y: 4 }}
        animate={{ opacity: [0.55, 1, 0.55], y: [2, 0, 2] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <KoraWordmark className={`${wordmarkSize} text-kindle-text`} />
      </motion.div>

      <motion.p
        key={statusMessage}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        className="max-w-[220px] text-center text-[8px] leading-relaxed font-medium text-kindle-text-muted/80 sm:max-w-xs sm:text-[9px]"
      >
        {statusMessage}
      </motion.p>
    </div>
  );
}
