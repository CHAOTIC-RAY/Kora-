import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Smartphone,
  Laptop,
  Database,
  Wifi,
  Zap,
  Activity,
  ShieldCheck,
  Flame,
  ArrowLeftRight,
  Lock,
  Play,
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
  const [transfersCount, setTransfersCount] = useState(142);
  const [isSimulating, setIsSimulating] = useState(true);

  const handlePing = () => {
    setTransfersCount((c) => c + 1);
  };

  return (
    <div className="w-full bg-kindle-card rounded-3xl border border-kindle-border p-4 sm:p-5 text-kindle-text relative overflow-hidden shadow-xl flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-kindle-border pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 dark:text-amber-400 shrink-0">
            <Activity className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-bold text-kindle-text tracking-wide">Sync Topology Engine</h4>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono font-bold flex items-center gap-1 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                LIVE
              </span>
            </div>
            <p className="text-[11px] text-kindle-text-muted max-w-[280px] sm:max-w-none">
              Direct Peer-to-Peer &amp; Firebase Cloud Realtime Sync
            </p>
          </div>
        </div>

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

          <div className="pl-2 flex items-center gap-1 text-[10px] text-kindle-text-muted font-mono">
            <span className="text-kindle-accent font-bold">#{transfersCount}</span>
            <span>pkt</span>
          </div>
        </div>
      </div>

      {/* Central Topology Diagram */}
      <div className="relative w-full rounded-2xl border border-kindle-border/60 bg-kindle-bg mt-4 overflow-hidden">
        <div className="relative w-full min-h-[220px] sm:min-h-[260px] flex items-center justify-center sm:p-4">
          {/* SVG paths for connections */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 600 280">
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
                <>
                  <motion.path
                    key="fb-left"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.85 }}
                    exit={{ opacity: 0 }}
                    d="M 110 200 Q 190 130 300 75"
                    fill="none"
                    stroke="url(#firebaseLeft)"
                    strokeWidth="2"
                    strokeDasharray="5 5"
                  />
                  <motion.circle key="fb-dot1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="3" fill="#f59e0b">
                    <animateMotion path="M 110 200 Q 190 130 300 75" dur="1.8s" repeatCount="indefinite" />
                  </motion.circle>
                  <motion.circle key="fb-dot2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="3" fill="#10b981">
                    <animateMotion path="M 300 75 Q 190 130 110 200" dur="2.3s" repeatCount="indefinite" />
                  </motion.circle>
                </>
              )}

              {mode !== "firebase" && (
                <>
                  <motion.path
                    key="p2p"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.9 }}
                    exit={{ opacity: 0 }}
                    d="M 110 200 Q 300 260 490 200"
                    fill="none"
                    stroke="url(#p2pStroke)"
                    strokeWidth="2.5"
                    filter="drop-shadow(0 0 6px rgba(16,185,129,0.35))"
                  />
                  <motion.circle key="p2p-dot1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="4" fill="#10b981">
                    <animateMotion path="M 110 200 Q 300 260 490 200" dur="1.2s" repeatCount="indefinite" />
                  </motion.circle>
                  <motion.circle key="p2p-dot2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="3.5" fill="#34d399">
                    <animateMotion path="M 490 200 Q 300 260 110 200" dur="1.4s" repeatCount="indefinite" />
                  </motion.circle>
                </>
              )}

              {mode !== "p2p" && (
                <>
                  <motion.path
                    key="fb-right"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.85 }}
                    exit={{ opacity: 0 }}
                    d="M 490 200 Q 410 130 300 75"
                    fill="none"
                    stroke="url(#firebaseRight)"
                    strokeWidth="2"
                    strokeDasharray="5 5"
                  />
                  <motion.circle key="fb-dot3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="4" fill="#f59e0b">
                    <animateMotion path="M 490 200 Q 410 130 300 75" dur="2.0s" repeatCount="indefinite" />
                  </motion.circle>
                  <motion.circle key="fb-dot4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} r="3.5" fill="#06b6d4">
                    <animateMotion path="M 300 75 Q 410 130 490 200" dur="2.5s" repeatCount="indefinite" />
                  </motion.circle>
                </>
              )}
            </AnimatePresence>

            {/* Node: Firestore */}
            <motion.div
              className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center"
              whileHover={{ scale: 1.03 }}
              onClick={handlePing}
            >
              <div className="relative">
                <div className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 opacity-30 blur-md" />
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-amber-50 dark:bg-[#1d1810] border-2 border-amber-500/60 flex flex-col items-center justify-center shadow-lg shadow-amber-900/10">
                  <Flame className="w-6 h-6 sm:w-7 sm:h-7 text-amber-600 dark:text-amber-400" />
                  <span className="text-[9px] font-mono font-bold text-amber-700 dark:text-amber-300 mt-0.5">FIRESTORE</span>
                </div>
              </div>
              <div className="mt-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[10px] font-bold font-mono shadow-sm flex items-center gap-1.5">
                <Database className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                <span>Firebase Cloud DB</span>
              </div>
            </motion.div>

            {/* Node: Mobile */}
            <motion.div className="absolute bottom-4 left-[6%] sm:left-[8%] flex flex-col items-center" whileHover={{ scale: 1.03 }}>
              <div className="relative">
                <div className="absolute -inset-2 rounded-2xl bg-emerald-500/20 blur-md" />
                <div className="w-11 h-18 sm:w-12.5 sm:h-22 rounded-xl bg-emerald-50 dark:bg-[#151916] border-2 border-emerald-500/60 flex flex-col items-center justify-between p-2 shadow-lg shadow-emerald-900/10">
                  <div className="w-3.5 h-1 rounded-full bg-emerald-500/40" />
                  <Smartphone className="w-5 h-5 sm:w-6 text-emerald-600 dark:text-emerald-400" />
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                </div>
              </div>
              <div className="mt-2 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold font-mono shadow-sm flex items-center gap-1">
                <Smartphone className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>Mobile Client</span>
              </div>
            </motion.div>

            {/* Node: Desktop */}
            <motion.div className="absolute bottom-4 right-[6%] sm:right-[8%] flex flex-col items-center" whileHover={{ scale: 1.03 }}>
              <div className="relative">
                <div className="absolute -inset-2 rounded-2xl bg-cyan-500/20 blur-md" />
                <div className="w-18 h-13 sm:w-20 sm:h-14 rounded-xl bg-cyan-50 dark:bg-[#12161a] border-2 border-cyan-500/60 flex items-center justify-center shadow-lg shadow-cyan-900/10">
                  <Laptop className="w-5 h-5 sm:w-6 text-cyan-600 dark:text-cyan-400" />
                </div>
              </div>
              <div className="mt-2 px-2 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300 text-[10px] font-bold font-mono shadow-sm flex items-center gap-1">
                <Laptop className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
                <span>Desktop Web</span>
              </div>
            </motion.div>
          </svg>
        </div>
      </div>

      {/* Footer Metric Cards (2-up) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-kindle-bg border border-kindle-border">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 shrink-0">
            <Wifi className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] text-kindle-text-muted font-bold">P2P Latency</span>
            <span className="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400 block truncate">
              12ms (Direct LAN/WebRTC)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-kindle-bg border border-kindle-border">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 shrink-0">
            <Flame className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] text-kindle-text-muted font-bold">Firebase Firestore</span>
            <span className="text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400 block truncate">
              Connected • Realtime Snapshot
            </span>
          </div>
        </div>
      </div>

      {/* Bottom row: lock + actions */}
      <div className="flex items-center justify-between gap-3 mt-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-kindle-bg border border-kindle-border">
          <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-500 shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] text-kindle-text-muted font-bold">Security &amp; Encryption:</span>
            <span className="text-[11px] font-mono font-bold text-cyan-600 dark:text-cyan-300 ml-1">AES-GCM E2EE</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsSimulating((v) => !v)}
          className="px-3 py-2 rounded-2xl bg-kindle-text text-kindle-bg border border-kindle-border text-[10px] font-bold cursor-pointer flex items-center gap-1.5 shadow-sm transition hover:brightness-110 shrink-0"
        >
          {isSimulating ? <Play className="w-3.5 h-3.5" /> : <ArrowLeftRight className="w-3.5 h-3.5" />}
          {isSimulating ? "Simulating" : "Resume"}
        </button>
      </div>
    </div>
  );
}
