import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Smartphone,
  Tablet,
  Database,
  Wifi,
  Zap,
  Flame,
} from "lucide-react";

type SyncMode = "hybrid" | "p2p" | "firebase";

const MODES: { id: SyncMode; label: string; accent: string; icon: React.ReactNode }[] = [
  {
    id: "hybrid",
    label: "Hybrid",
    accent: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400",
    icon: <Zap className="w-3.5 h-3.5" />,
  },
  {
    id: "p2p",
    label: "Direct P2P",
    accent: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
    icon: <Wifi className="w-3.5 h-3.5" />,
  },
  {
    id: "firebase",
    label: "Firebase",
    accent: "bg-orange-500/10 text-orange-600 border-orange-500/30 dark:text-orange-400",
    icon: <Database className="w-3.5 h-3.5" />,
  },
];

export default function SyncArchitectureAnimation() {
  const [mode, setMode] = useState<SyncMode>("hybrid");

  return (
    <div className="w-full bg-kindle-card rounded-3xl border border-kindle-border p-4 sm:p-5 text-kindle-text relative overflow-hidden shadow-xl flex flex-col">
      <div className="flex items-center gap-2">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setMode(item.id)}
            className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold font-mono flex items-center gap-1.5 cursor-pointer transition ${
              mode === item.id
                ? item.accent
                : "bg-kindle-bg border-kindle-border text-kindle-text-muted hover:border-kindle-accent"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      <div className="relative w-full rounded-2xl border border-kindle-border/60 bg-kindle-bg mt-4">
        <div className="relative w-full min-h-[340px] sm:min-h-[400px] flex items-center justify-center sm:p-4">
          <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 600 360">
            <defs>
              <linearGradient id="firebaseLeft" x1="0%" y1="100%" x2="50%" y2="0%">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="firebaseRight" x1="100%" y1="100%" x2="50%" y2="0%">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="p2pStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="50%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>

            <AnimatePresence>
              {mode !== "p2p" && (
                <motion.g key="firebase-paths">
                  <motion.path
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.85 }}
                    exit={{ opacity: 0 }}
                    d="M 110 240 Q 190 160 300 90"
                    fill="none"
                    stroke="url(#firebaseLeft)"
                    strokeWidth="2.5"
                    strokeDasharray="6 6"
                  />
                  <motion.path
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.85 }}
                    exit={{ opacity: 0 }}
                    d="M 490 240 Q 410 160 300 90"
                    fill="none"
                    stroke="url(#firebaseRight)"
                    strokeWidth="2.5"
                    strokeDasharray="6 6"
                  />
                  <motion.circle initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="5" fill="#f59e0b">
                    <animateMotion path="M 110 240 Q 190 160 300 90" dur="1.8s" repeatCount="indefinite" />
                  </motion.circle>
                  <motion.circle initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="4" fill="#10b981">
                    <animateMotion path="M 300 90 Q 190 160 110 240" dur="2.3s" repeatCount="indefinite" />
                  </motion.circle>
                  <motion.circle initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="5" fill="#f59e0b">
                    <animateMotion path="M 490 240 Q 410 160 300 90" dur="2.0s" repeatCount="indefinite" />
                  </motion.circle>
                  <motion.circle initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="4" fill="#06b6d4">
                    <animateMotion path="M 300 90 Q 410 160 490 240" dur="2.5s" repeatCount="indefinite" />
                  </motion.circle>
                </motion.g>
              )}

              {mode !== "firebase" && (
                <motion.g key="p2p-paths">
                  <motion.path
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.9 }}
                    exit={{ opacity: 0 }}
                    d="M 110 240 Q 300 300 490 240"
                    fill="none"
                    stroke="url(#p2pStroke)"
                    strokeWidth="3"
                    filter="drop-shadow(0 0 8px rgba(16,185,129,0.4))"
                  />
                  <motion.circle initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="5" fill="#10b981">
                    <animateMotion path="M 110 240 Q 300 300 490 240" dur="1.2s" repeatCount="indefinite" />
                  </motion.circle>
                  <motion.circle initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="4.5" fill="#34d399">
                    <animateMotion path="M 490 240 Q 300 300 110 240" dur="1.4s" repeatCount="indefinite" />
                  </motion.circle>
                </motion.g>
              )}
            </AnimatePresence>

            <motion.div
              className="absolute top-6 left-1/2 -translate-x-1/2 flex flex-col items-center"
              whileHover={{ scale: 1.03 }}
            >
              <div className="relative">
                <div className="absolute -inset-3 rounded-3xl bg-gradient-to-r from-amber-500 to-orange-500 opacity-30 blur-md" />
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-amber-50 dark:bg-[#1d1810] border-2 border-amber-500/60 flex flex-col items-center justify-center shadow-xl shadow-amber-900/10">
                  <Flame className="w-12 h-12 sm:w-14 sm:h-14 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
            </motion.div>

            <motion.div className="absolute bottom-6 left-[6%] sm:left-[8%] flex flex-col items-center gap-2" whileHover={{ scale: 1.03 }}>
              <div className="relative">
                <div className="absolute -inset-3 rounded-3xl bg-emerald-500/20 blur-md" />
                <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-2xl bg-emerald-50 dark:bg-[#151916] border-2 border-emerald-500/60 flex flex-col items-center justify-center gap-2 shadow-xl shadow-emerald-900/10">
                  <Smartphone className="w-6 h-6 sm:w-7 text-emerald-600 dark:text-emerald-400" />
                  <Tablet className="w-6 h-6 sm:w-7 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Mobile / Tablet</span>
            </motion.div>

            <motion.div className="absolute bottom-6 right-[6%] sm:right-[8%] flex flex-col items-center gap-2" whileHover={{ scale: 1.03 }}>
              <div className="relative">
                <div className="absolute -inset-3 rounded-3xl bg-cyan-500/20 blur-md" />
                <div className="w-24 h-20 sm:w-28 sm:h-24 rounded-2xl bg-cyan-50 dark:bg-[#12161a] border-2 border-cyan-500/60 flex flex-col items-center justify-center shadow-xl shadow-cyan-900/10">
                  <Database className="w-10 h-10 sm:w-12 text-cyan-600 dark:text-cyan-400" />
                </div>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-600 dark:text-cyan-400">Firebase</span>
            </motion.div>
          </svg>
        </div>
      </div>
    </div>
  );
}
