import React from "react";
import { motion } from "motion/react";
import KoraInlineLoader from "./KoraInlineLoader";

interface KoraLoadingProps {
  context?: string;
  query?: string;
  compact?: boolean;
  categorySource?: any;
}

/**
 * Generic loading state. Uses the endless inline loop (the ink reveal is reserved
 * for brand moments: first boot and the InstallView hero).
 */
export default function KoraLoading({ context, query, compact }: KoraLoadingProps = {}) {
  return (
    <div className={`flex flex-col items-center justify-center ${compact ? "py-3 space-y-2" : "py-6 space-y-4"}`}>
      <div className={compact ? "w-40 sm:w-48" : "w-52 sm:w-64 max-w-full"}>
        <KoraInlineLoader width="100%" label={query ? `Searching ${query}` : context ? `Loading ${context}` : "Loading"} />
      </div>
      <motion.p
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        className="text-[10px] font-bold uppercase tracking-[0.3em] text-kindle-text-muted"
      >
        {query ? `Searching "${query}"...` : context ? `Loading ${context}...` : "Synchronizing..."}
      </motion.p>
    </div>
  );
}
