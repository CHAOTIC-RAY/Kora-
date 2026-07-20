import React from "react";
import { motion } from "motion/react";
import { KoraIcon } from "./KoraLogo";

const WORDMARK_PATHS = [
  "M287.6,104.25c-1.64,4.59-5.45,6.69-10,7.53-8.61,1.57-11.14-.13-16.94-11-4.9,6.39-10.94,10.55-19,11.62-9.95,1.31-19.48-3.36-22.59-11.64-3.59-9.57-.58-19.55,9.17-24.2,9.2-4.38,19.27-7,29.1-10,3-.9,4.36-1.9,3.94-5-.58-4.27-.66-8.66-1.78-12.78-1.63-6-6.3-9-12.29-8.95s-9.29,3-11.31,9.37c-1,3-.55,7-5,7.73-3.67.56-7.22.11-9-3.68s-.78-7.18,2.33-9.9c6.48-5.68,14.43-7.47,22.66-7.93a48.52,48.52,0,0,1,12.88,1.12c10.13,2.22,15.8,8.93,16.21,19.42.43,11,.28,22,.38,33,0,1.66,0,3.33,0,5C276.63,102.86,278.61,104.64,287.6,104.25Zm-26.6-34c-8.44,2.41-16.47,4.43-22.9,10.05-4.55,4-5.81,10.76-3.44,16.45a11.76,11.76,0,0,0,12,7c5.67-.42,13.76-5.58,14.15-10.21C261.46,86,261,78.4,261,70.24Z",
  "M24.18,0V6.78c0,29.14,0,58.28-.07,87.42,0,6,.3,11.44,7.51,13.29.7.19,1.09,1.61,2,3.05H.64l-.64-1c1.19-1,2.24-2.37,3.61-2.9,3.94-1.53,5.62-4.17,5.61-8.4q-.13-40,0-79.93c0-4.73-1.93-7.46-6.26-9C1.9,9,1.15,7.79.27,7,1.2,6.27,2,5.18,3.09,4.92,9.84,3.24,16.64,1.74,24.18,0Z",
  "M193.44,110.51H159.7l-.57-1c1.07-.9,2-2.13,3.25-2.62,4.54-1.79,6-5,5.94-9.79-.2-14-.28-28,0-42,.13-5.65-1.58-9.3-7.11-11a3.26,3.26,0,0,1-1.77-2c-.13-.38.8-1.52,1.4-1.67,7-1.75,14.08-3.37,21.77-5.18V51.06l1.11.4,2.54-4.36c3.51-6,8.15-10.58,15.32-11.7,7.35-1.15,12.17,3.38,10.85,10-1,5.16-4.11,6.91-9.13,5.17-12.43-4.32-19.44.57-19.59,13.8-.12,10.66.14,21.33-.21,32-.19,5.71,1.76,9.21,7.35,10.72,1.23.33,2.23,1.52,3.34,2.31Z",
  "M78.32,110.77c-7.1,0-14.2.08-21.29-.1a4.78,4.78,0,0,1-3-2Q40.66,90.3,27.46,71.89c5.26-5.49,10.61-11.09,16-16.65,2.08-2.15,4.31-4.16,6.37-6.33,3.77-4,3.34-5.72-1.66-8.06a4.92,4.92,0,0,1-2.57-3.51H73.37l.76,1.25C70.3,40.71,66.22,42.48,62.71,45a109.36,109.36,0,0,0-11.2,9.9C48.05,58.27,44.85,61.86,41,66,53.4,80.35,61.76,98.66,79,109.66Z",
  "M151.77,74.1h0a45.46,45.46,0,0,0-3.51-17.51,33.2,33.2,0,0,0-4.87-8.34l-.23-.28c-.23-.29-.47-.58-.71-.86a29.45,29.45,0,0,0-5.49-5,37.39,37.39,0,0,0-43.9,0,29.71,29.71,0,0,0-5.48,5c-.25.28-.48.57-.72.86l-.22.28a33.2,33.2,0,0,0-4.87,8.34,45.27,45.27,0,0,0-3.51,17.51h0A42.74,42.74,0,0,0,82.47,93a32.76,32.76,0,0,0,15.32,15.69,37.5,37.5,0,0,0,15.86,4.09h.07l1.29,0,1.3,0h.07a37.5,37.5,0,0,0,15.86-4.09A32.73,32.73,0,0,0,147.55,93,42.61,42.61,0,0,0,151.77,74.1ZM133,90.13A66.71,66.71,0,0,1,129.34,99a15.55,15.55,0,0,1-14.18,9h-.29a15.56,15.56,0,0,1-14.19-9A66.63,66.63,0,0,1,97,90.13c-.9-3.49-1.64-7-2.42-10.56a51.39,51.39,0,0,1-.4-8.67c1.25-8.9,3.25-16.72,6.32-21.79,3.52-5.81,9-8.92,14.48-9.21,5.47.29,11,3.4,14.49,9.21,3.07,5.07,5.06,12.89,6.31,21.79a51.39,51.39,0,0,1-.4,8.67C134.63,83.1,133.89,86.64,133,90.13Z",
];

function AnimatedWordmark({ className = "h-10" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 287.6 112.78"
      className={className}
      fill="currentColor"
      aria-hidden
    >
      <defs>
        <linearGradient id="kora-shimmer" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="45%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="kora-shimmer-sweep" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={120} y2={0}>
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="40%" stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="50%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="60%" stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <mask id="kora-wordmark-mask">
          {WORDMARK_PATHS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </mask>
      </defs>

      {WORDMARK_PATHS.map((d, i) => (
        <motion.path
          key={i}
          d={d}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.55,
            delay: 0.08 * i,
            ease: [0.22, 1, 0.36, 1],
          }}
          fill="url(#kora-shimmer)"
        />
      ))}

      <motion.rect
        x={-140}
        y={0}
        width={140}
        height={112.78}
        fill="url(#kora-shimmer-sweep)"
        mask="url(#kora-wordmark-mask)"
        opacity={0.85}
        animate={{ x: [-140, 320] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </svg>
  );
}

interface KoraLoadingProps {
  message?: string;
  compact?: boolean;
}

export default function KoraLoading({ message = "Synchronizing...", compact = false }: KoraLoadingProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center ${compact ? "space-y-4" : "space-y-8"}`}
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <div className="relative flex flex-col items-center">
        <motion.div
          className="absolute -inset-10 rounded-full bg-kindle-accent/10 blur-2xl"
          animate={{ scale: [0.85, 1.1, 0.85], opacity: [0.35, 0.7, 0.35] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.88 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex flex-col items-center gap-4"
        >
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <KoraIcon className={`${compact ? "w-10 h-10" : "w-14 h-14"} text-kindle-accent`} />
          </motion.div>

          <motion.div
            animate={{ opacity: [0.82, 1, 0.82] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            className="text-kindle-text"
          >
            <AnimatedWordmark className={compact ? "h-8" : "h-11"} />
          </motion.div>
        </motion.div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="block h-1.5 w-1.5 rounded-full bg-kindle-accent"
              animate={{ y: [0, -6, 0], opacity: [0.35, 1, 0.35] }}
              transition={{
                duration: 0.9,
                repeat: Infinity,
                delay: i * 0.15,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>

        <motion.p
          className="text-[10px] font-bold uppercase tracking-[0.3em] text-kindle-text-muted"
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          {message}
        </motion.p>
      </div>
    </div>
  );
}
