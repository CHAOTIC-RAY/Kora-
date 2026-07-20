import React from "react";
import { motion } from "motion/react";
import { KoraIcon, KoraWordmark } from "./KoraLogo";

interface KoraLoadingProps {
  message?: string;
  compact?: boolean;
}

export default function KoraLoading({ message = "Synchronizing...", compact = false }: KoraLoadingProps) {
  const iconSize = compact ? "w-12 h-12" : "w-16 h-16";
  const wordmarkSize = compact ? "h-7" : "h-9";

  return (
    <div
      className={`flex flex-col items-center justify-center ${compact ? "gap-5" : "gap-7"}`}
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <KoraWordmark className={`${wordmarkSize} text-kindle-text`} />

      <div className="relative flex items-center justify-center">
        <motion.div
          className="absolute inset-0 rounded-full bg-kindle-accent/15 blur-xl"
          animate={{ scale: [0.9, 1.25, 0.9], opacity: [0.35, 0.75, 0.35] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />

        <motion.div
          className="absolute inset-0 rounded-full border border-kindle-accent/20"
          animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
        />

        <motion.div
          animate={{
            scale: [1, 1.08, 1],
            rotate: [0, 4, 0, -4, 0],
            y: [0, -4, 0],
          }}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <motion.div
            animate={{ opacity: [0.75, 1, 0.75] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <KoraIcon className={`${iconSize} text-kindle-accent relative z-10`} />
          </motion.div>
        </motion.div>
      </div>

      <motion.p
        className="text-[10px] font-bold uppercase tracking-[0.3em] text-kindle-text-muted"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        {message}
      </motion.p>
    </div>
  );
}
