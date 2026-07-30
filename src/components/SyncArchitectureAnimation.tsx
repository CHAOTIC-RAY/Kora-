import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Smartphone,
  Laptop,
  Cloud,
  Database,
  Wifi,
  Zap,
  Activity,
  ShieldCheck,
  Flame,
  ArrowLeftRight,
  RefreshCw,
  CheckCircle2,
  Lock
} from "lucide-react";

type SyncMode = "all" | "p2p" | "firebase";

export default function SyncArchitectureAnimation() {
  const [activeMode, setActiveMode] = useState<SyncMode>("all");
  const [transfersCount, setTransfersCount] = useState(142);
  const [isSimulating, setIsSimulating] = useState(true);

  // Trigger manual packet flash burst
  const handlePing = () => {
    setTransfersCount((c) => c + 1);
  };

  const showP2P = true;
  const showFirebase = true;

  return (
    <div className="w-full bg-kindle-card rounded-3xl border border-kindle-border p-4 sm:p-6 text-kindle-text relative overflow-hidden shadow-xl flex flex-col items-center">
      {/* Background ambient radial glow */}
      <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-96 h-96 bg-amber-500/10 blur-[100px] pointer-events-none rounded-full" />
      <div className="absolute -bottom-16 left-1/4 w-80 h-80 bg-emerald-500/10 blur-[90px] pointer-events-none rounded-full" />
      <div className="absolute -bottom-16 right-1/4 w-80 h-80 bg-cyan-500/10 blur-[90px] pointer-events-none rounded-full" />

      {/* Top Header */}
      <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-kindle-border pb-4 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 dark:text-amber-400 shrink-0">
            <Activity className="w-4 h-4 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-bold text-kindle-text tracking-wide truncate">Sync Topology Engine</h4>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono font-bold flex items-center gap-1 border border-emerald-500/30 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                LIVE
              </span>
            </div>
            <p className="text-[11px] text-kindle-text-muted truncate">Direct Peer-to-Peer &amp; Firebase Cloud Realtime Sync</p>
          </div>
        </div>

        {/* Static Hybrid Architecture Badge */}
        <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px] font-bold font-mono flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          <span>Hybrid (P2P + Firebase)</span>
        </div>
      </div>

      {/* Main Diagram Canvas Area */}
      <div className="relative w-full min-h-[260px] sm:min-h-[300px] flex items-center justify-center my-3 z-10 bg-kindle-card border border-kindle-border/40 rounded-2xl p-2 sm:p-4 shadow-inner">
        {/* SVG Animated Lines Layer */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 600 300">
          <defs>
            {/* Linear Gradients for paths */}
            <linearGradient id="firebaseLeftGrad" x1="0%" y1="100%" x2="50%" y2="0%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.8" />
            </linearGradient>
            <linearGradient id="firebaseRightGrad" x1="100%" y1="100%" x2="50%" y2="0%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.8" />
            </linearGradient>
            <linearGradient id="p2pGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>

            {/* Glowing filters */}
            <filter id="glowGreen" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="glowAmber" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* PATH 1: Firebase Left Connection Line (Phone -> Firebase) */}
          {showFirebase && (
            <>
              <path
                d="M 110 210 Q 180 140 300 80"
                fill="none"
                stroke="url(#firebaseLeftGrad)"
                strokeWidth="2.5"
                strokeDasharray="6 6"
                className="opacity-70"
              />
              {/* Traveling Packet Dots (Upward to Firebase) */}
              <circle r="4" fill="#f59e0b" filter="url(#glowAmber)">
                <animateMotion
                  path="M 110 210 Q 180 140 300 80"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
              </circle>
              {/* Traveling Packet Dots (Downward from Firebase) */}
              <circle r="3.5" fill="#10b981" filter="url(#glowGreen)">
                <animateMotion
                  path="M 300 80 Q 180 140 110 210"
                  dur="2.3s"
                  repeatCount="indefinite"
                />
              </circle>
            </>
          )}

          {/* PATH 2: Firebase Right Connection Line (Laptop -> Firebase) */}
          {showFirebase && (
            <>
              <path
                d="M 490 210 Q 420 140 300 80"
                fill="none"
                stroke="url(#firebaseRightGrad)"
                strokeWidth="2.5"
                strokeDasharray="6 6"
                className="opacity-70"
              />
              {/* Traveling Packet Dots (Upward to Firebase) */}
              <circle r="4" fill="#f59e0b" filter="url(#glowAmber)">
                <animateMotion
                  path="M 490 210 Q 420 140 300 80"
                  dur="2.0s"
                  repeatCount="indefinite"
                />
              </circle>
              {/* Traveling Packet Dots (Downward from Firebase) */}
              <circle r="3.5" fill="#06b6d4" filter="url(#glowGreen)">
                <animateMotion
                  path="M 300 80 Q 420 140 490 210"
                  dur="2.5s"
                  repeatCount="indefinite"
                />
              </circle>
            </>
          )}

          {/* PATH 3: P2P Direct Connection Curve (Phone <-> Laptop) */}
          {showP2P && (
            <>
              <path
                d="M 110 210 Q 300 280 490 210"
                fill="none"
                stroke="url(#p2pGrad)"
                strokeWidth="3"
                filter="url(#glowGreen)"
                className="opacity-90"
              />
              {/* Fast P2P Data Packets Right */}
              <circle r="4.5" fill="#10b981" filter="url(#glowGreen)">
                <animateMotion
                  path="M 110 210 Q 300 280 490 210"
                  dur="1.2s"
                  repeatCount="indefinite"
                />
              </circle>
              {/* Fast P2P Data Packets Left */}
              <circle r="4" fill="#34d399" filter="url(#glowGreen)">
                <animateMotion
                  path="M 490 210 Q 300 280 110 210"
                  dur="1.4s"
                  repeatCount="indefinite"
                />
              </circle>
            </>
          )}
        </svg>

        {/* NODE 1: TOP CENTER - FIREBASE CLOUD NODE */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
          <motion.div
            whileHover={{ scale: 1.05 }}
            onClick={handlePing}
            className="group cursor-pointer flex flex-col items-center"
          >
            {/* Outer animated aura ring */}
            <div className="relative">
              <div className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 opacity-30 blur-md group-hover:opacity-60 transition duration-500 animate-pulse" />
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-amber-50 dark:bg-[#1d1810] border-2 border-amber-500/50 flex flex-col items-center justify-center relative z-10 shadow-xl shadow-amber-500/10 dark:shadow-amber-950/40">
                <Flame className="w-7 h-7 sm:w-8 sm:h-8 text-amber-500 dark:text-amber-400 group-hover:scale-110 transition-transform" />
                <span className="text-[9px] font-mono font-bold text-amber-700 dark:text-amber-300 mt-0.5">FIRESTORE</span>
              </div>
            </div>
            
            {/* Cloud badge pill */}
            <div className="mt-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-[10px] font-bold font-mono shadow-sm flex items-center gap-1.5 backdrop-blur-md">
              <Database className="w-3 h-3 text-amber-500 dark:text-amber-400" />
              <span>Firebase Cloud DB</span>
            </div>
          </motion.div>
        </div>

        {/* NODE 2: BOTTOM LEFT - MOBILE DEVICE */}
        <div className="absolute bottom-3 left-[5%] sm:left-[10%] z-20 flex flex-col items-center">
          <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center group">
            <div className="relative">
              <div className="absolute -inset-2 rounded-2xl bg-emerald-500/20 blur-md group-hover:opacity-70 transition" />
              <div className="w-12 h-20 sm:w-14 sm:h-22 rounded-xl bg-emerald-50 dark:bg-[#161817] border-2 border-emerald-500/60 flex flex-col items-center justify-between p-2 relative z-10 shadow-xl shadow-emerald-500/10 dark:shadow-emerald-950/40">
                <div className="w-4 h-1 rounded-full bg-emerald-500/40" />
                <Smartphone className="w-6 h-6 text-emerald-600 dark:text-emerald-400 my-auto" />
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              </div>
            </div>
            <div className="mt-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold font-mono shadow-sm flex items-center gap-1">
              <Smartphone className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              <span>Mobile Client</span>
            </div>
          </motion.div>
        </div>

        {/* NODE 3: BOTTOM RIGHT - DESKTOP / LAPTOP DEVICE */}
        <div className="absolute bottom-3 right-[5%] sm:right-[10%] z-20 flex flex-col items-center">
          <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center group">
            <div className="relative">
              <div className="absolute -inset-2 rounded-2xl bg-cyan-500/20 blur-md group-hover:opacity-70 transition" />
              <div className="w-20 h-14 sm:w-24 sm:h-16 rounded-xl bg-cyan-50 dark:bg-[#14181c] border-2 border-cyan-500/60 flex flex-col items-center justify-center p-2 relative z-10 shadow-xl shadow-cyan-500/10 dark:shadow-cyan-950/40">
                <Laptop className="w-7 h-7 text-cyan-600 dark:text-cyan-400 my-auto" />
                <div className="w-8 h-1 rounded-t-sm bg-cyan-500/40 absolute -bottom-1" />
              </div>
            </div>
            <div className="mt-2 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-800 dark:text-cyan-300 text-[10px] font-bold font-mono shadow-sm flex items-center gap-1">
              <Laptop className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
              <span>Desktop Web</span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Realtime Diagnostics Footer */}
      <div className="w-full mt-3 pt-3 border-t border-kindle-border grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-mono z-10">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-kindle-bg border border-kindle-border">
          <Wifi className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <div className="truncate">
            <span className="text-kindle-text-muted block">P2P Latency:</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">12ms (Direct LAN/WebRTC)</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-kindle-bg border border-kindle-border">
          <Flame className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <div className="truncate">
            <span className="text-kindle-text-muted block">Firebase Firestore:</span>
            <span className="text-amber-600 dark:text-amber-400 font-bold">Connected • Realtime Snapshot</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-kindle-bg border border-kindle-border">
          <Lock className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
          <div className="truncate">
            <span className="text-kindle-text-muted block">Security &amp; Encryption:</span>
            <span className="text-cyan-600 dark:text-cyan-300 font-bold">AES-GCM E2EE Protected</span>
          </div>
        </div>
      </div>
    </div>
  );
}
