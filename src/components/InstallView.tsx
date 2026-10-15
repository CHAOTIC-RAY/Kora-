import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useScroll, useTransform } from "motion/react";
import toast from "react-hot-toast";
import { useScrollLock } from "../hooks/useScrollLock";
import DictionaryWidget from "./DictionaryWidget";
import LinguistGuardian from "./LinguistGuardian";
import {
  LinguistGuardianDemo,
  GameScoreTrackerDemo,
  CrosswordSolvingDemo,
  WikipediaHubDemo,
  SearchableDictionaryDemo,
  WordSearchGridDemo
} from "./WorkshopInlineDemos";
import SyncArchitectureAnimation from "./SyncArchitectureAnimation";
import {
  Download,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  ArrowLeft,
  HelpCircle,
  Info,
  BookOpen,
  BookA,
  Headphones,
  Radio,
  Gamepad2,
  Rss,
  Hammer,
  ExternalLink,
  Flame,
  Swords,
  Trophy,
  Share2,
  QrCode,
  Globe,
  Server,
  Github,
  Star,
  Type,
  Settings,
  ChevronDown,
  Layers,
  Zap,
  Sparkles,
  Copy,
  Check,
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Grid3X3,
  Search,
  Mic,
  Sliders,
  FileText,
  RefreshCw,
  Compass,
  Heart,
  MessageCircle,
  Bookmark,
  Sun,
  Moon,
  Menu,
  PenTool,
  RotateCcw,
  Filter,
  LayoutGrid,
  Sofa,
  Wrench,
  Library,
  Tag,
  Cloud,
  Laptop,
} from "lucide-react";
import { fetchLatestApkDownloadUrl } from "../lib/apkUpdater";
import { KoraIcon, KoraWordmark } from "./KoraLogo";
import KoraWordmarkReveal from "./KoraWordmarkReveal";
import KoraIconInkDraw from "./KoraIconInkDraw";
import GameScoreTracker from "./GameScoreTracker";
import CrosswordGame from "./CrosswordGame";
import WordSearchGame from "./WordSearchGame";
import WikipediaWidget from "./WikipediaWidget";
import ThemeShowcase from "./ThemeShowcase";
import FeatureDemosGrid from "./FeatureDemosGrid";
import CassetteVisualizer from "./CassetteVisualizer";
import InkSketchScribbleBackground from "./InkSketchScribbleBackground";

/** Scroll-triggered reveal wrapper — fades, lifts, and scales into view with physical spring motion.
 *  Uses once:true for maximum stability and a refined, professional bento experience. */
function Reveal({ 
  children, 
  className = "", 
  delay = 0,
  y = 35,
  scale = 0.98
}: { 
  children: React.ReactNode; 
  className?: string; 
  delay?: number;
  y?: number;
  scale?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y, scale }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ 
        type: "spring",
        stiffness: 65,
        damping: 14,
        mass: 0.8,
        delay, 
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const MAGNIFIER_TEXTS = [
  {
    title: "Frankenstein",
    author: "Mary Shelley",
    text: "I am by birth a Genevese, and my family is one of the most distinguished of that republic. My ancestors had been for many years counsellors and syndics; and my father had filled several public situations with honour and reputation. He was respected by all who knew him for his integrity and indefatigable attention to public business. He passed his younger days perpetually occupied by the affairs of his country; a variety of circumstances had prevented his marrying early..."
  },
  {
    title: "The Time Machine",
    author: "H.G. Wells",
    text: "The Time Traveller (for so it will be convenient to speak of him) was expounding a recondite matter to us. His grey eyes shone and twinkled, and his usually pale face was flushed and animated. The fire burned brightly, and the soft radiance of the incandescent lights in the lilies of silver caught the bubbles that flashed and passed in our glasses. Our chairs, being his patents, embraced and caressed us rather than submitted to be sat upon..."
  }
];

function EInkMagnifier() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeTextObj = MAGNIFIER_TEXTS[selectedIdx];
  const zoomFactor = 2.4; // Zoom scale factor
  const lensSize = 160;   // Magnifying glass lens size
  const lensRadius = lensSize / 2;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setCoords({ x, y });
  };

  const containerWidth = containerRef.current?.clientWidth || 500;
  const containerHeight = containerRef.current?.clientHeight || 200;

  return (
    <div className="bg-kindle-card border border-kindle-border rounded-2xl p-5 shadow-lg flex flex-col justify-between h-[300px] relative overflow-hidden select-none group w-full">
      {/* Banner / Title */}
      <div className="flex items-center justify-between border-b border-kindle-border/40 pb-2 z-10">
        <div className="space-y-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-kindle-accent font-sans">
            E-INK CLARITY LAB
          </span>
          <h4 className="text-xs font-bold text-kindle-text">
            {activeTextObj.title} — {activeTextObj.author}
          </h4>
        </div>
        <button
          type="button"
          onClick={() => setSelectedIdx((prev) => (prev + 1) % MAGNIFIER_TEXTS.length)}
          className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-kindle-bg border border-kindle-border hover:border-kindle-accent text-kindle-text transition cursor-pointer"
        >
          Next Excerpt
        </button>
      </div>

      {/* Main interactive area */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        className="relative flex-1 overflow-hidden mt-3 p-4 rounded-xl bg-kindle-bg border border-kindle-border/40 cursor-none flex items-center justify-center text-left"
        style={{
          backgroundImage: "radial-gradient(rgba(0,0,0,0.03) 1px, transparent 1px)",
          backgroundSize: "16px 16px"
        }}
      >
        {/* Base Layer (Normal text size) */}
        <div className="w-full text-xs font-serif leading-relaxed text-kindle-text opacity-95 pointer-events-none select-none">
          {activeTextObj.text}
        </div>

        {/* Dynamic Precision Optical Lens */}
        {isHovering && (
          <div
            className="absolute pointer-events-none z-30"
            style={{
              width: `${lensSize}px`,
              height: `${lensSize}px`,
              left: `${coords.x - lensRadius}px`,
              top: `${coords.y - lensRadius}px`,
            }}
          >
            {/* Outer Ergonomic Lens Handle */}
            <div 
              className="absolute w-12 h-3.5 bg-gradient-to-r from-neutral-800 via-neutral-600 to-neutral-900 rounded-full shadow-lg border border-neutral-500/60 pointer-events-none"
              style={{
                right: "-20px",
                bottom: "-16px",
                transform: "rotate(45deg)",
                transformOrigin: "left center",
              }}
            />

            {/* Lens Rim Container */}
            <div className="w-full h-full rounded-full border-[3.5px] border-amber-600/90 dark:border-amber-400/90 bg-kindle-bg shadow-[0_15px_35px_rgba(0,0,0,0.35),_inset_0_2px_10px_rgba(255,255,255,0.7),_inset_0_-4px_12px_rgba(0,0,0,0.3)] ring-2 ring-amber-500/30 overflow-hidden relative">
              
              {/* Scaled Exact Replica Layer */}
              <div
                className="absolute p-4 pointer-events-none select-none flex items-center justify-center text-left"
                style={{
                  width: `${containerWidth}px`,
                  height: `${containerHeight}px`,
                  transformOrigin: "0 0",
                  transform: `scale(${zoomFactor})`,
                  left: `${lensRadius - coords.x * zoomFactor}px`,
                  top: `${lensRadius - coords.y * zoomFactor}px`,
                }}
              >
                <div className="w-full text-xs font-serif leading-relaxed text-kindle-text font-medium">
                  {activeTextObj.text}
                </div>
              </div>

              {/* Optical Center Crosshair Target removed as requested */}

              {/* Glass Glare Reflection */}
              <div 
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.08) 40%, rgba(0,0,0,0.15) 100%)"
                }}
              />

              {/* E-Ink Subpixel Matrix Grid Texture */}
              <div 
                className="absolute inset-0 pointer-events-none mix-blend-multiply opacity-[0.06] dark:opacity-[0.1]"
                style={{
                  backgroundImage: "linear-gradient(to right, #000 1px, transparent 1px), linear-gradient(to bottom, #000 1px, transparent 1px)",
                  backgroundSize: "3px 3px"
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-kindle-border/40 mt-2 z-10">
        <span className="text-[9px] text-kindle-text-muted">
          Hover above to activate E-Ink subpixel magnifier
        </span>
        <span className="text-[9px] font-mono font-bold text-kindle-accent animate-pulse">
          2.4X OPTICAL ZOOM
        </span>
      </div>
    </div>
  );
}

const HERO_NEWS_ITEMS = [
  {
    source: "KORA CHRONICLE • KORA.NEWS",
    badge: "NEW",
    title: "Federated P2P library sync & high-fidelity voice narration arrive on E-Ink readers",
    cover: "https://images.unsplash.com/photo-1506880018603-83d5b814b5a6?q=80&w=800&auto=format&fit=crop",
    itemNum: 1,
  },
  {
    source: "LITERARY HUB • LITHUB.COM",
    badge: "TRENDING",
    title: "The rise of distraction-free open reading hardware and open-source EPUB engines",
    cover: "https://images.unsplash.com/photo-1457369804613-52c61a468e7d?q=80&w=800&auto=format&fit=crop",
    itemNum: 2,
  },
  {
    source: "TECHCRUNCH • TECH.CO",
    badge: "FEATURED",
    title: "Kora 2.4 releases offline TTS audiobooks, WebDAV sync and cross-device bookmarking",
    cover: "https://images.unsplash.com/photo-1512820790803-83ca734da794?q=80&w=800&auto=format&fit=crop",
    itemNum: 3,
  },
  {
    source: "BOOKWIRE DAILY • BOOKWIRE.ORG",
    badge: "LIVE",
    title: "Over 10,000 public domain classics now available through integrated federated mirrors",
    cover: "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?q=80&w=800&auto=format&fit=crop",
    itemNum: 4,
  },
  {
    source: "THE VERGE • THEVERGE.COM",
    badge: "REVIEW",
    title: "Why E-Ink power users are switching to Kora for zero-lag page flips and custom fonts",
    cover: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?q=80&w=800&auto=format&fit=crop",
    itemNum: 5,
  },
];

function HeroGridContent({ apk, handleCopyLink, copiedLink, onTextMouseMove, onTextMouseLeave }: {
  apk: { url: string; versionName: string; size: number } | null;
  handleCopyLink: () => void;
  copiedLink: boolean;
  onTextMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onTextMouseLeave?: () => void;
}) {
  const [newsIdx, setNewsIdx] = useState(0);
  const [focusedDevice, setFocusedDevice] = useState<"tablet" | "phone" | null>(null);

  // Auto-scroll news feed every 3.2 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setNewsIdx((prev) => (prev + 1) % HERO_NEWS_ITEMS.length);
    }, 3200);
    return () => clearInterval(timer);
  }, []);

  const activeNews = HERO_NEWS_ITEMS[newsIdx];

  // Framer Motion variants for stagger-in page load animations
  const staggerContainer = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.05
      }
    }
  };

  const fadeInUpItem = {
    hidden: { opacity: 0, y: 22, scale: 0.99 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        type: "spring" as const,
        stiffness: 90,
        damping: 15,
        mass: 0.8
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 w-full z-10 relative">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
        {/* Left: Headline & Streamlined Quick Download Actions */}
        <motion.div 
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          onMouseMove={onTextMouseMove}
          onMouseLeave={onTextMouseLeave}
          className="lg:col-span-5 space-y-8 text-left cursor-crosshair"
        >
          <motion.div variants={fadeInUpItem} className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-kindle-border/40 bg-kindle-card/50 text-[10px] font-sans font-semibold uppercase tracking-[0.2em] text-kindle-accent/80 shadow-sm chromatic-amber">
              <Sparkles className="w-3.5 h-3.5 text-kindle-accent animate-pulse" />
              The E-Ink Reading Sanctuary
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-serif font-extrabold text-kindle-text leading-[1.05] tracking-tight">
              Read, Listen <span className="font-light italic text-kindle-accent font-serif">&amp;</span> Discover
            </h1>

            <p className="text-base sm:text-lg text-kindle-text-muted leading-relaxed font-medium">
              The open E-Ink digital reader with integrated high-fidelity voice narration, federated mirror discovery, and a beautiful mind games lounge.
            </p>
          </motion.div>

          {/* High-fidelity Streamlined Action Card */}
          <motion.div variants={fadeInUpItem} className="bg-kindle-card border border-kindle-border rounded-2xl p-5 shadow-lg space-y-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-kindle-accent/5 rounded-full blur-xl pointer-events-none" />
            
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Android Native Download Button */}
              <div className="flex-1 space-y-2">
                <span className="text-[9px] font-bold uppercase tracking-wider text-kindle-accent block">
                  Native App (Android)
                </span>
                <a
                  href={apk?.url || "https://github.com/CHAOTIC-RAY/Kora-/releases/latest"}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-kindle-text text-kindle-bg font-bold text-xs uppercase tracking-wider rounded-xl hover:opacity-90 active:scale-[0.98] transition cursor-pointer shadow-md"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Download APK</span>
                </a>
              </div>

              {/* Web Companion Button */}
              <div className="flex-1 space-y-2">
                <span className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted block">
                  Instant Web App
                </span>
                <a
                  href="/"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 border border-kindle-border bg-kindle-bg text-kindle-text font-bold text-xs uppercase tracking-wider rounded-xl hover:border-kindle-accent transition shadow-sm cursor-pointer"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Launch Web App</span>
                </a>
              </div>
            </div>

            {/* Badges and details */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[10px] text-kindle-text-muted font-medium pt-2 border-t border-kindle-border/40">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>Safe APK v{apk?.versionName || "2.4.0"}</span>
              </span>
              <span className="text-kindle-border">•</span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-kindle-accent" />
                <span>Play Protect Approved</span>
              </span>
              <span className="text-kindle-border">•</span>
              <button
                type="button"
                onClick={handleCopyLink}
                className="text-kindle-accent hover:underline flex items-center gap-1 cursor-pointer"
              >
                {copiedLink ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copiedLink ? "Copied!" : "Share Link"}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>

        {/* Right: Double Device Showcase (Tablet + Phone) */}
        <motion.div 
          initial={{ opacity: 0, x: 28, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 55, damping: 14, delay: 0.28 }}
          className="lg:col-span-7 w-full flex items-center justify-center lg:justify-end"
        >
          <div className="relative w-full max-w-[580px] h-[460px] sm:h-[510px] flex items-center justify-center select-none">
            
            {/* 1. Tablet Mockup with smooth spring physics transitions */}
            <motion.div 
              onMouseEnter={() => setFocusedDevice("tablet")}
              onMouseLeave={() => setFocusedDevice(null)}
              animate={{
                scale: focusedDevice === "tablet" ? 1.04 : focusedDevice === "phone" ? 0.95 : 1,
                y: focusedDevice === "tablet" ? -8 : 0,
                opacity: focusedDevice === "phone" ? 0.72 : 1,
                zIndex: focusedDevice === "tablet" ? 30 : 10,
                boxShadow: focusedDevice === "tablet" 
                  ? "0 35px 75px rgba(0,0,0,0.85)" 
                  : "0 20px 45px rgba(0,0,0,0.55)"
              }}
              transition={{ type: "spring", stiffness: 110, damping: 17 }}
              className={`absolute left-0 sm:left-2 top-4 sm:top-6 w-[360px] sm:w-[440px] h-[300px] sm:h-[340px] rounded-[22px] border-[10px] border-neutral-900 bg-black overflow-hidden flex flex-col cursor-pointer transition-shadow duration-300 ${
                focusedDevice === "tablet" ? "ring-2 ring-sky-500/50" : ""
              }`}
            >
              <div className="w-full h-8 bg-[#0d0d0d] border-b border-neutral-800 px-3 flex items-center justify-between text-[9px] font-sans font-bold text-neutral-400">
                <div className="flex items-center gap-2">
                  <ArrowLeft className="w-3 h-3 text-neutral-300 cursor-pointer" />
                  <RotateCcw className="w-3 h-3 text-neutral-400 cursor-pointer" />
                  <span className="font-sans font-bold text-neutral-200 text-[9px] tracking-widest uppercase ml-1">GETTING STARTED WITH KORA</span>
                </div>
                <div className="flex items-center gap-2.5 text-neutral-300">
                  <Sun className="w-3 h-3 hover:text-white transition cursor-pointer" />
                  <Menu className="w-3 h-3 hover:text-white transition cursor-pointer" />
                  <Settings className="w-3 h-3 hover:text-white transition cursor-pointer" />
                  <Headphones className="w-3 h-3 hover:text-white transition cursor-pointer" />
                  <PenTool className="w-3 h-3 hover:text-white transition cursor-pointer" />
                </div>
              </div>

              <div className="flex-1 p-4 sm:p-5 bg-black text-left relative overflow-hidden flex flex-col justify-between select-none">
                <div className="space-y-2 text-white">
                  <div className="text-[8px] font-mono tracking-widest text-neutral-400 uppercase font-bold">CHAPTER 3 OF 6</div>
                  <h3 className="text-base font-serif font-bold text-white mb-2 leading-snug">P2P sync &amp; devices</h3>
                  
                  <div className="space-y-1.5 text-[9px] font-sans text-neutral-300 leading-relaxed max-h-[160px] overflow-hidden">
                    <p className="font-bold text-white text-[10px]">P2P sync &amp; devices</p>
                    <p className="font-bold text-white text-[9.5px]">How sync works in Kora</p>
                    <p className="text-neutral-300">
                      Kora keeps book files on your device. Sign-in syncs shelf metadata, reading progress, highlights, and notes — not the raw EPUB bytes.
                    </p>

                    <p className="font-bold text-white text-[9.5px] pt-1">Peer-to-peer (P2P) transfer</p>
                    <p className="text-neutral-300">
                      When a title shows a P2P badge, another nearby device running Kora may share the file directly — no cloud upload of the book itself.
                    </p>

                    <p className="font-bold text-white text-[9.5px] pt-1">Open Tools → Devices &amp; Sync</p>
                    <p className="text-neutral-300 pl-1 border-l border-amber-500/50">Enable sharing on both devices on the same network</p>
                    <p className="text-neutral-300 pl-1 border-l border-amber-500/50">Tap a cloud-only book — proximity transfer can fill the local copy</p>
                  </div>
                </div>

                <div className="pt-2 border-t border-neutral-800/80 space-y-1">
                  <div className="flex items-center justify-between text-[8px] font-mono text-neutral-400">
                    <span>End of P2P sync &amp; devices</span>
                    <span>50% read</span>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="flex-1 relative flex items-center h-2">
                      <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                        <div className="h-full bg-white rounded-full" style={{ width: "50%" }} />
                      </div>
                      <div className="absolute left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-black shadow-md" />
                    </div>
                    <span className="text-[7.5px] font-mono text-neutral-400 whitespace-nowrap">chapter 3 of 6 • 50% • ~3 min left</span>
                    <div className="px-2 py-0.5 rounded bg-black border border-neutral-700 text-white text-[7.5px] font-bold tracking-wider flex items-center gap-1">
                      <LayoutGrid className="w-2.5 h-2.5" /> 2-PAGE
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* 2. Mobile Phone Mockup with smooth spring physics transitions */}
            <motion.div 
              onMouseEnter={() => setFocusedDevice("phone")}
              onMouseLeave={() => setFocusedDevice(null)}
              animate={{
                scale: focusedDevice === "phone" ? 1.04 : focusedDevice === "tablet" ? 0.95 : 1,
                y: focusedDevice === "phone" ? -8 : 0,
                opacity: focusedDevice === "tablet" ? 0.72 : 1,
                zIndex: focusedDevice === "phone" ? 30 : 20,
                boxShadow: focusedDevice === "phone" 
                  ? "0 35px 75px rgba(0,0,0,0.85)" 
                  : "0 20px 50px rgba(0,0,0,0.6)"
              }}
              transition={{ type: "spring", stiffness: 110, damping: 17 }}
              className={`absolute right-0 sm:right-2 bottom-2 w-[220px] sm:w-[245px] h-[410px] sm:h-[460px] rounded-[38px] border-[8px] border-neutral-900 bg-neutral-950 overflow-hidden flex flex-col cursor-pointer transition-shadow duration-300 ${
                focusedDevice === "phone" ? "ring-2 ring-emerald-500/50" : ""
              }`}
            >
              <div className="w-full h-9 bg-black/60 backdrop-blur-xs px-3 pt-2.5 flex items-center justify-between text-neutral-300 z-30">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-neutral-900/90 border border-neutral-800 flex items-center justify-center">
                    <Sliders className="w-3 h-3 text-neutral-300" />
                  </div>
                  <div className="w-6 h-6 rounded-full bg-neutral-900/90 border border-neutral-800 flex items-center justify-center">
                    <Filter className="w-3 h-3 text-neutral-300" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-neutral-900/90 border border-neutral-800 flex items-center justify-center">
                    <LayoutGrid className="w-3 h-3 text-neutral-300" />
                  </div>
                  <div className="w-6 h-6 rounded-full bg-neutral-900/90 border border-neutral-800 flex items-center justify-center">
                    <RotateCcw className="w-3 h-3 text-neutral-300" />
                  </div>
                </div>
              </div>

              <div className="flex-1 relative overflow-hidden flex flex-col justify-end p-3.5 select-none bg-neutral-900">
                <AnimatePresence>
                  <motion.div
                    key={newsIdx}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                    className="absolute inset-0 w-full h-full"
                  >
                    <img
                      src={activeNews.cover}
                      alt="Article Cover"
                      className="w-full h-full object-cover opacity-60"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
                  </motion.div>
                </AnimatePresence>

                {/* Right side floating buttons on phone mockup (TikTok style) */}
                <div className="absolute right-2.5 bottom-20 z-30 flex flex-col items-center gap-3">
                  {/* Filter Button */}
                  <div className="w-8 h-8 rounded-full border border-white/20 bg-black/60 flex items-center justify-center shadow-md">
                    <Filter className="w-3.5 h-3.5 text-white" />
                  </div>

                  {/* Save Button */}
                  <div className="w-8 h-8 rounded-full border border-white/20 bg-black/60 flex items-center justify-center shadow-md">
                    <Bookmark className="w-3.5 h-3.5 text-white" />
                  </div>

                  {/* Share Button */}
                  <div className="w-8 h-8 rounded-full border border-white/20 bg-black/60 flex items-center justify-center shadow-md">
                    <Share2 className="w-3.5 h-3.5 text-white" />
                  </div>

                  {/* Daily Brief Button (Zap) */}
                  <div className="w-8 h-8 rounded-full border border-kindle-accent/30 bg-kindle-accent flex items-center justify-center shadow-md relative">
                    <Zap className="w-3.5 h-3.5 text-kindle-bg fill-current" />
                  </div>
                </div>

                <div className="relative z-10 space-y-2 mb-12 pr-10 text-left">
                  <AnimatePresence>
                    <motion.div
                      key={newsIdx}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.4 }}
                      className="space-y-2"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="px-2 py-0.5 rounded-full bg-neutral-900/90 border border-neutral-700 text-[7.5px] font-bold text-white uppercase tracking-wider truncate">
                          {activeNews.source}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-full bg-white text-[7.5px] font-black text-black uppercase shrink-0">
                          {activeNews.badge}
                        </span>
                      </div>

                      <h4 className="text-xs sm:text-sm font-serif font-bold text-white leading-tight drop-shadow-md min-h-[2.5rem]">
                        {activeNews.title}
                      </h4>

                      <div className="flex items-center justify-between text-[7.5px] font-mono text-neutral-300 pt-1">
                        <span className="flex items-center gap-0.5 text-neutral-300">
                           <ChevronDown className="w-3 h-3 text-neutral-400" /> Tap to read
                        </span>
                        <span>{activeNews.itemNum}/5</span>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="absolute bottom-2 left-2 right-2 z-30">
                  <div className="bg-neutral-900/95 border border-neutral-800/90 backdrop-blur-md rounded-2xl py-1.5 flex items-center justify-around text-neutral-400">
                    <div className="p-1 rounded-lg text-neutral-400">
                      <Sofa className="w-4.5 h-4.5" />
                    </div>
                    <div className="p-1 rounded-lg text-neutral-400">
                      <Library className="w-4.5 h-4.5" />
                    </div>
                    <div className="p-1 rounded-lg text-neutral-400">
                      <Compass className="w-4.5 h-4.5" />
                    </div>
                    <div className="p-1.5 rounded-xl bg-neutral-800 border border-neutral-700 text-amber-400 shadow-xs">
                      <Rss className="w-4.5 h-4.5 text-amber-400" />
                    </div>
                    <div className="p-1 rounded-lg text-neutral-400">
                      <Hammer className="w-4.5 h-4.5" />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function MagnifyingTiltCard({ children, className = "", id = "" }: { children: React.ReactNode; className?: string; id?: string }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [glarePos, setGlarePos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Calculate rotation: ranges from -6 to 6 degrees
    const rotateX = -((y / rect.height) - 0.5) * 8;
    const rotateY = ((x / rect.width) - 0.5) * 8;
    
    setRotate({ x: rotateX, y: rotateY });
    setGlarePos({ x, y });
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setRotate({ x: 0, y: 0 });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      id={id}
      className={`relative transition-all duration-300 ease-out ${className}`}
      style={{
        transform: isHovered 
          ? `perspective(1000px) rotateX(${rotate.x}deg) rotateY(${rotate.y}deg) scale3d(1.02, 1.02, 1.02)` 
          : "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)",
        transformStyle: "preserve-3d",
        boxShadow: isHovered 
          ? "0 25px 50px -12px rgba(0, 0, 0, 0.25)" 
          : "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
      }}
    >
      <div style={{ transform: "translateZ(20px)" }} className="h-full w-full">
        {children}
      </div>

      {/* Radiant Cursor Glare Spotlight */}
      <div
        className="absolute inset-0 pointer-events-none rounded-[inherit] transition-opacity duration-300"
        style={{
          opacity: isHovered ? 1 : 0,
          background: `radial-gradient(circle 240px at ${glarePos.x}px ${glarePos.y}px, rgba(217, 119, 6, 0.08), transparent 80%)`,
        }}
      />
    </div>
  );
}

function MockBookCover({ title, author, className = "" }: { title: string; author: string; className?: string }) {
  const designs = [
    { bg: "bg-[#1e2d3b]", text: "text-[#f3ebd5]", accent: "border-[#e0533c]/60", font: "font-serif" },
    { bg: "bg-[#2d201c]", text: "text-[#f5ebd6]", accent: "border-amber-600/60", font: "font-serif" },
    { bg: "bg-[#14291f]", text: "text-[#e8f5ed]", accent: "border-emerald-500/60", font: "font-sans" },
    { bg: "bg-[#331c29]", text: "text-[#fcf0f5]", accent: "border-pink-500/60", font: "font-serif" },
    { bg: "bg-[#271d3a]", text: "text-[#f3ebf5]", accent: "border-purple-500/60", font: "font-serif" },
    { bg: "bg-[#423521]", text: "text-[#fcfaf4]", accent: "border-amber-500/60", font: "font-serif" },
    { bg: "bg-[#1a1a1e]", text: "text-neutral-200", accent: "border-neutral-500/60", font: "font-mono" },
  ];
  
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const design = designs[Math.abs(hash) % designs.length] || designs[0];

  return (
    <div className={`w-full h-full ${design.bg} ${className} flex flex-col justify-between p-2.5 sm:p-3 border border-white/10 relative overflow-hidden select-none`}>
      <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/30 pointer-events-none" />
      <div className="absolute top-0 left-0 bottom-0 w-1 bg-black/30 blur-[0.5px] pointer-events-none" />
      <div className="absolute top-0 left-1 bottom-0 w-[0.5px] bg-white/10 pointer-events-none" />

      <div className={`text-[7px] sm:text-[8px] tracking-widest ${design.text} opacity-50 font-mono text-center uppercase`}>
        Kora Classic
      </div>

      <div className="flex flex-col items-center justify-center text-center flex-1 py-1.5">
        <h4 className={`text-[10px] sm:text-xs font-bold ${design.text} leading-tight ${design.font} line-clamp-3 px-1`}>
          {title}
        </h4>
        <div className={`w-4 h-[1px] my-1 bg-current opacity-30 ${design.text}`} />
        <p className="text-[8px] sm:text-[9px] text-neutral-300 font-sans line-clamp-1 italic">
          {author}
        </p>
      </div>

      <div className="border-t border-white/10 pt-1 flex items-center justify-between text-[6px] sm:text-[7px] font-mono opacity-40">
        <span className="uppercase tracking-wider">E-INK</span>
        <span>KORA</span>
      </div>
    </div>
  );
}

function BookCoverImage({ book, className = "" }: { book: any; className?: string }) {
  const [urlIndex, setUrlIndex] = useState(0);
  const [hasError, setHasError] = useState(false);

  const sources = React.useMemo(() => {
    const list: string[] = [];
    
    // Extract ISBN if possible to construct multiple sources
    let isbn = "";
    if (book.cover) {
      const isbnMatch = book.cover.match(/isbn\/([0-9X]+)/i);
      if (isbnMatch && isbnMatch[1]) {
        isbn = isbnMatch[1];
      } else {
        const vidMatch = book.cover.match(/vid=ISBN:([0-9X]+)/i);
        if (vidMatch && vidMatch[1]) {
          isbn = vidMatch[1];
        }
      }
    }

    // 1. First priority: OpenLibrary URL with default=false (returns 404 if missing, triggering fallback)
    if (isbn) {
      list.push(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`);
    }

    // 2. Second priority: Original URL
    if (book.cover && !list.includes(book.cover)) {
      list.push(book.cover);
    }

    // 3. Third priority: Google Books Content URL
    if (isbn) {
      list.push(`https://books.google.com/books/content?vid=ISBN:${isbn}&printsec=frontcover&img=1&zoom=1`);
    }

    // 4. Fourth priority: General gorgeous fallback thematic book illustrations
    let hash = 0;
    const titleStr = book.title || "Book Title";
    for (let i = 0; i < titleStr.length; i++) {
      hash = titleStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const fallbackImages = [
      "https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=300&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=300&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=300&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1476275466078-4007374efbbe?w=300&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=300&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1589829085413-56de8ae18c73?w=300&auto=format&fit=crop&q=80"
    ];
    const pickedFallback = fallbackImages[Math.abs(hash) % fallbackImages.length];
    list.push(pickedFallback);

    return list;
  }, [book.cover, book.title]);

  const currentSrc = sources[urlIndex];

  const handleNextSource = () => {
    if (urlIndex < sources.length - 1) {
      setUrlIndex((prev) => prev + 1);
    } else {
      setHasError(true);
    }
  };

  if (hasError || !currentSrc) {
    return <MockBookCover title={book.title} author={book.author} className={className} />;
  }

  return (
    <img
      src={currentSrc}
      alt={book.title}
      className={`w-full h-full object-cover ${className}`}
      loading="lazy"
      onError={handleNextSource}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth <= 1 || img.naturalHeight <= 1) {
          handleNextSource();
        }
      }}
    />
  );
}

function GlobeGalleryRow({ books, speed }: { books: any[]; speed: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ cardWidth: 76, cardHeight: 114 });

  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < 640;
      setDimensions({
        cardWidth: isMobile ? 56 : 76,
        cardHeight: isMobile ? 84 : 114
      });
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let animationFrameId: number;
    let offset = 0;

    const items = Array.from(container.children) as HTMLDivElement[];
    const totalItems = items.length;
    if (totalItems === 0) return;

    const { cardWidth, cardHeight } = dimensions;
    const gap = 4;
    const itemWidth = cardWidth + gap;
    const totalWidth = totalItems * itemWidth;

    const update = () => {
      offset += speed;

      const containerWidth = container.offsetWidth || 600;
      const halfWidth = containerWidth / 2;

      items.forEach((item, idx) => {
        // Base wrapping formula that is 100% stable with positive & negative speed
        let x = ((idx * itemWidth + offset) % totalWidth + totalWidth) % totalWidth;

        // Shift elements to negative offscreen if they are in the second half to avoid visible wrap-around jumps
        if (x > containerWidth + itemWidth && x > totalWidth / 2) {
          x -= totalWidth;
        }

        // 3D Globe-like Perspective calculations
        const centerX = x + cardWidth / 2;
        const distanceFromCenter = centerX - halfWidth;
        const normalizedDistance = distanceFromCenter / halfWidth;

        // Clamp distance to avoid extreme distortion
        const clampedDist = Math.max(-1.5, Math.min(1.5, normalizedDistance));

        // Covers get smaller towards the sides (globe view)
        const scale = 1 - Math.pow(clampedDist, 2) * 0.20;

        // Warp effect: Rotate towards center
        const rotateY = clampedDist * -24;

        // Push edges back in Z-space
        const translateZ = -Math.pow(clampedDist, 2) * 110;

        // Spherical curve: subtle vertical arching at the sides
        const translateY = Math.pow(clampedDist, 2) * 6;

        // Soft opacity transition near edges
        const opacity = Math.max(0.15, 1 - Math.pow(clampedDist, 2) * 0.5);

        item.style.transform = `translateX(${x}px) translateY(${translateY}px) scale(${scale}) rotateY(${rotateY}deg) translateZ(${translateZ}px)`;
        item.style.opacity = `${opacity}`;
        item.style.position = "absolute";
        item.style.left = "0";
        item.style.top = "0";
        item.style.width = `${cardWidth}px`;
        item.style.height = `${cardHeight}px`;
      });

      animationFrameId = requestAnimationFrame(update);
    };

    update();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [books, speed, dimensions]);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden select-none pointer-events-none"
      style={{ 
        height: `${dimensions.cardHeight + 14}px`, 
        perspective: "1400px", 
        transformStyle: "preserve-3d" 
      }}
    >
      {books.map((book, idx) => (
        <div
          key={`${book.id}-${idx}`}
          className="rounded-xl overflow-hidden bg-kindle-card border border-kindle-border shadow-2xl pointer-events-none select-none flex flex-col items-center justify-center"
          style={{ willChange: "transform, opacity" }}
        >
          <BookCoverImage book={book} className="w-full h-full object-cover pointer-events-none select-none" />
          {book.rating && (
            <div className="absolute top-1.5 right-1.5 bg-black/85 backdrop-blur-md text-amber-400 font-extrabold text-[8px] px-1.5 py-0.5 rounded shadow flex items-center gap-0.5 border border-amber-500/20">
              <Star className="w-2 h-2 fill-amber-400 text-amber-400" /> {book.rating}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function InstallView() {
  const { scrollYProgress } = useScroll();
  const [headerMouse, setHeaderMouse] = useState({ x: 0, y: 0 });
  const handleHeaderMouseMove = (e: React.MouseEvent) => {
    const x = (e.clientX / (window.innerWidth || 1) - 0.5) * 20;
    const y = (e.clientY / (window.innerHeight || 1) - 0.5) * 20;
    setHeaderMouse({ x, y });
  };

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const theme = localStorage.getItem("kora_display_theme") || "theme-light-white";
    return theme.includes("dark") || theme === "night" || theme === "oled" || document.body.classList.contains("dark");
  });

  // Keep site CSS variables and root dark mode class perfectly in sync
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    if (isDarkMode) {
      root.classList.add("dark");
      body.classList.add("dark");
      const darkVars: Record<string, string> = {
        "--theme-bg": "#121214",
        "--theme-text": "#FAFAFA",
        "--theme-card": "#1E1E22",
        "--theme-border": "#2D2D30",
        "--theme-accent": "#F59E0B",
        "--theme-text-muted": "#A1A1AA",
        "--color-kindle-bg": "#121214",
        "--color-kindle-text": "#FAFAFA",
        "--color-kindle-card": "#1E1E22",
        "--color-kindle-border": "#2D2D30",
        "--color-kindle-accent": "#F59E0B",
        "--color-kindle-text-muted": "#A1A1AA",
      };
      Object.entries(darkVars).forEach(([k, v]) => {
        root.style.setProperty(k, v);
        body.style.setProperty(k, v);
      });
    } else {
      root.classList.remove("dark");
      body.classList.remove("dark");
      const lightVars: Record<string, string> = {
        "--theme-bg": "#FAF7F2",
        "--theme-text": "#2C2A26",
        "--theme-card": "#F3EEE6",
        "--theme-border": "#E4DDD2",
        "--theme-accent": "#8B7355",
        "--theme-text-muted": "#6F6A5F",
        "--color-kindle-bg": "#FAF7F2",
        "--color-kindle-text": "#2C2A26",
        "--color-kindle-card": "#F3EEE6",
        "--color-kindle-border": "#E4DDD2",
        "--color-kindle-accent": "#8B7355",
        "--color-kindle-text-muted": "#6F6A5F",
      };
      Object.entries(lightVars).forEach(([k, v]) => {
        root.style.setProperty(k, v);
        body.style.setProperty(k, v);
      });
    }
  }, [isDarkMode]);

  const toggleTheme = () => {
    const nextDark = !isDarkMode;
    setIsDarkMode(nextDark);
    localStorage.setItem("kora_display_theme", nextDark ? "theme-dark-charcoal" : "theme-light-white");
    window.dispatchEvent(new CustomEvent("kora:display-theme-changed", { detail: nextDark ? "dark" : "paper" }));
  };

  const [apk, setApk] = useState<{ url: string; versionName: string; size: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeTab, setActiveTab] = useState<"apk" | "themes" | "audio" | "workshop" | "pwa" | "guide" | "faq">("apk");
  const [showQrModal, setShowQrModal] = useState(false);
  
  // Game & Workshop Demo Modals State
  const [showScoreTrackerDemo, setShowScoreTrackerDemo] = useState(false);
  const [showCrosswordDemo, setShowCrosswordDemo] = useState(false);
  const [showWordSearchDemo, setShowWordSearchDemo] = useState(false);
  const [showWikipediaDemo, setShowWikipediaDemo] = useState(false);
  const [showDictionaryDemo, setShowDictionaryDemo] = useState(false);
  const [showLinguistGuardianDemo, setShowLinguistGuardianDemo] = useState(false);

  // Hide the sticky top nav once the closing notebook fills the screen.
  const [navHidden, setNavHidden] = useState(false);
  const notebookRef = useRef<HTMLElement | null>(null);
  const heroSectionRef = useRef<HTMLElement | null>(null);

  // Hero Section Image Magnifier Glass state (Restricted strictly to Hero Section Text area)
  const [magnifier, setMagnifier] = useState<{
    x: number;
    y: number;
    visible: boolean;
    heroWidth: number;
    heroHeight: number;
  } | null>(null);

  const handleTextMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!heroSectionRef.current) return;
    const rect = heroSectionRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setMagnifier({
      x,
      y,
      visible: true,
      heroWidth: rect.width,
      heroHeight: rect.height,
    });
  };

  const handleTextMouseLeave = () => {
    setMagnifier((prev) => (prev ? { ...prev, visible: false } : null));
  };

  const onScroll = useCallback(() => {}, []);

  useEffect(() => {
    const el = notebookRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNavHidden(entry.isIntersecting && entry.intersectionRatio > 0.35),
      { threshold: [0, 0.35, 0.6] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Lock scroll position when window loses focus — prevents
  // the landing view from jumping back to top after switching apps.
  useEffect(() => {
    const onBlur = () => {
      if (heroSectionRef.current) {
        heroSectionRef.current.dataset.scrollY = String(window.scrollY || window.pageYOffset || 0);
      }
    };
    const onFocus = () => {
      const saved = Number(heroSectionRef.current?.dataset.scrollY || 0);
      if (saved > 0 && Math.abs((window.scrollY || 0) - saved) > 10) {
        window.scrollTo({ top: saved, behavior: "instant" });
      }
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // FAQ stays fully visible — no scroll fade.
  const faqRef = useRef<HTMLDivElement | null>(null);

  // Interactive Download Mirror Hub Popup State & Saved Bookmarks
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set(["frankenstein"]));

  const toggleBookmark = (id: string) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        toast("Removed from Saved Favorites", { icon: "🤍" });
      } else {
        next.add(id);
        toast("Added to Saved Favorites!", { icon: "❤️" });
      }
      return next;
    });
  };

  // Lock background scroll whenever any fullscreen demo/popup is open.
  useScrollLock(
    showScoreTrackerDemo ||
      showCrosswordDemo ||
      showWordSearchDemo ||
      showWikipediaDemo ||
      showDictionaryDemo ||
      showLinguistGuardianDemo ||
      isDownloadModalOpen
  );

  // Unified Experience Section Pillar State
  const [experiencePillar, setExperiencePillar] = useState<"library" | "themes" | "cloud" | "voice" | "catalog" | "workshop">("library");
  const [isVoiceSpeaking, setIsVoiceSpeaking] = useState(true); // Autoplay by default
  const [isVoiceMuted, setIsVoiceMuted] = useState(true); // Muted by default
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [selectedBookId, setSelectedBookId] = useState<string>("frankenstein");
  const [activeDownload, setActiveDownload] = useState<{
    name: string;
    format: string;
    source: string;
    progress: number;
    completed: boolean;
  } | null>(null);

  const startSimulatedDownload = (sourceName: string, format: string, bookTitle: string) => {
    setActiveDownload({
      name: `${bookTitle} (${format})`,
      format,
      source: sourceName,
      progress: 12,
      completed: false,
    });

    let current = 12;
    const interval = setInterval(() => {
      current += Math.floor(Math.random() * 22) + 14;
      if (current >= 100) {
        current = 100;
        clearInterval(interval);
        setActiveDownload({
          name: `${bookTitle} (${format})`,
          format,
          source: sourceName,
          progress: 100,
          completed: true,
        });
        setTimeout(() => {
          setActiveDownload(null);
        }, 4500);
      } else {
        setActiveDownload((prev) => (prev ? { ...prev, progress: current } : null));
      }
    }, 320);
  };

  // Speech synthesis autoplay / playback loop with volume control
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    if (isVoiceSpeaking) {
      window.speechSynthesis.cancel();
      const text = "I am by birth a Genevese, and my family is one of the most distinguished of that republic. My ancestors had been for many years counsellors and syndics; and my father had filled several public situations with honour and reputation. He was respected by all who knew him for his integrity and indefatigable attention to public business.";
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = voiceSpeed;
      utterance.volume = isVoiceMuted ? 0 : 1;
      
      utterance.onend = () => {
        // Loop speech if still speaking
        if (isVoiceSpeaking) {
          const repeatUtterance = new SpeechSynthesisUtterance(text);
          repeatUtterance.rate = voiceSpeed;
          repeatUtterance.volume = isVoiceMuted ? 0 : 1;
          repeatUtterance.onend = utterance.onend;
          window.speechSynthesis.speak(repeatUtterance);
        }
      };

      window.speechSynthesis.speak(utterance);
    } else {
      window.speechSynthesis.cancel();
    }

    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [isVoiceSpeaking, isVoiceMuted, voiceSpeed]);
  
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);
  const [installTab, setInstallTab] = useState<"web" | "apk" | "ios" | "self">("web");

  // PWA install: capture the native prompt so we can trigger it from a button.
  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  }
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [pwaInstalled, setPwaInstalled] = useState(false);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as unknown as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setPwaInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt as EventListener);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt as EventListener);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const installPwa = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  useEffect(() => {
    let alive = true;
    fetchLatestApkDownloadUrl()
      .then((info) => {
        if (!alive) return;
        if (info) {
          setApk(info);
        } else {
          setError("Unable to retrieve latest version info directly.");
        }
        setLoading(false);
      })
      .catch(() => {
        if (alive) {
          setError("Failed to fetch latest APK data.");
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const installUrl = typeof window !== "undefined"
    ? `${window.location.origin}/install`
    : "https://kora.chaoticstudio.workers.dev/install";

  const displayHost = typeof window !== "undefined"
    ? window.location.host
    : "kora.chaoticstudio.workers.dev";

  const handleCopyLink = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(installUrl)
        .then(() => {
          setCopiedLink(true);
          setTimeout(() => setCopiedLink(false), 2000);
        })
        .catch(() => {});
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "24.5 MB";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  // Setup steps change by install type.
  const stepsByType: Record<string, { number: string; title: string; description: string }[]> = {
    web: [
      { number: "01", title: "Open Kora", description: `Visit ${displayHost} in any modern browser — Chrome, Edge, Safari, or Firefox.` },
      { number: "02", title: "Tap Install", description: "Use the address-bar install icon, or ⋮ menu → “Install” on desktop / Share → “Add to Home Screen” on mobile." },
      { number: "03", title: "Launch Offline", description: "Open from your home screen or app launcher. Full offline storage — no app store, no sign-up." },
      { number: "04", title: "Step Into Kora", description: "Read, listen, and play. Your library, progress, and notes stay on your device." },
    ],
    apk: [
      { number: "01", title: "Get Official Package", description: "Tap ‘Download APK’ to fetch the signed Kora Android package from our release vault." },
      { number: "02", title: "Allow Unknown Sources", description: "If Android (Chrome or Files) prompts, tap ‘Settings’ and enable ‘Allow from this source’." },
      { number: "03", title: "Run Package Installer", description: "Open the downloaded file from your Downloads manager or notification and press ‘Install’." },
      { number: "04", title: "Step Into Kora Lounge", description: "Launch Kora from your home screen — background voice, notification controls, and P2P transfer unlocked." },
    ],
    ios: [
      { number: "01", title: "Open in Safari", description: `Open ${displayHost} in Safari (not Chrome) on your iPhone or iPad.` },
      { number: "02", title: "Tap Share", description: "Hit the Share button (square with arrow) on the bottom toolbar." },
      { number: "03", title: "Add to Home Screen", description: "Scroll down and tap ‘Add to Home Screen’, then tap ‘Add’ top-right." },
      { number: "04", title: "Step Into Kora", description: "A standalone Kora icon appears — full-screen, offline, no Apple account needed." },
    ],
    self: [
      { number: "01", title: "Clone the Repo", description: "Clone github.com/CHAOTIC-RAY/Kora- to your machine or server." },
      { number: "02", title: "Install & Build", description: "Run npm install && npm run build to produce the dist/ folder." },
      { number: "03", title: "Deploy Static", description: "Ship dist/ to Cloudflare Pages, Netlify, or any static host; point the worker at your domain." },
      { number: "04", title: "Step Into Kora", description: "Add your Firebase config for optional sync. Your data, your domain, your rules." },
    ],
  };
  const steps = stepsByType[installTab] ?? stepsByType.apk;

  const features = [
    {
      icon: Volume2,
      title: "Voice Audiobook Engine",
      description: "Convert any EPUB, PDF, or document into a natural voice audiobook with customizable speeds, pitch controls, and background playback."
    },
    {
      icon: BookOpen,
      title: "Distraction-Free E-Ink Canvas",
      description: "Enjoy offline reading with custom typography, line spacing, paper tinting, and dedicated amber warm backlight filters."
    },
    {
      icon: Compass,
      title: "Federated Book Discovery",
      description: "Search open digital catalogs across Rave Engine, LibGen, and Anna's Archive with direct file mirror downloads."
    },
    {
      icon: Radio,
      title: "Wireless P2P Beam",
      description: "Instantly beam local files from your computer or phone straight to Kora over local Wi-Fi without cloud dependencies."
    },
    {
      icon: Gamepad2,
      title: "Lounge & Workshop Suite",
      description: "Relax between chapters with integrated mind games: Score Tracker with Competition Mode, Literary Crosswords, and Word Search Grids."
    },
    {
      icon: ShieldCheck,
      title: "100% Private & Offline First",
      description: "Your library, reading progress, and settings stay stored locally on your device with complete offline access."
    }
  ];

  const faqs = [
    {
      q: "Is Kora really free and open source?",
      a: "Yes. Kora is 100% free, ad-free, and open source under a permissive license. There are no paywalls, no accounts forced on you, no trackers, and no subscriptions. You can read the entire codebase on GitHub.",
    },
    {
      q: "Do I need an account to read?",
      a: "No. You can open any book, article, or feed and read completely offline with zero sign-up. An account is only optional — it enables cloud sync of bookmarks, highlights, and reading progress across your devices via Firebase or your own WebDAV server.",
    },
    {
      q: "Is Kora for piracy, or can I read copyrighted books?",
      a: "Kora is a reader, not a file host. Its discovery tools can query catalogs including LibGen, Anna's Archive, Rave, and Z-Library, some of which host copyrighted material. You decide what to open, and you're responsible for doing so legally in your jurisdiction. Kora itself stores nothing — it just loads whatever link or file you point it at (EPUB, PDF, MOBI, AZW3) and reads it.",
    },
    {
      q: "How does the Voice Narrator / audiobook feature work?",
      a: "Kora parses book chapters directly on your device and uses high-fidelity neural system voices to read aloud. You control speech rate, pitch, and background playback, and can follow along with synchronized sentence highlighting. On Android the APK keeps narration playing while the screen is off.",
    },
    {
      q: "How does Kora's P2P sharing work?",
      a: "Kora's P2P sharing lets you beam books and files directly between devices over the same Wi-Fi — on both the web app and the Android APK, with no cloud, server, or account in the middle. It's device-to-device: your file goes from one Kora to another and nowhere else. Great for sharing a library with a friend or moving books from your computer to your phone without uploading anything.",
    },
    {
      q: "Is my reading data private?",
      a: "Your library, progress, and annotations are stored locally on your device by default. Sync is end-to-end optional: use Google Firebase, your own WebDAV/Nextcloud server, or stay fully offline. We never sell or share your data.",
    },
    {
      q: "What is the Workshop / Lounge?",
      a: "A reading companion suite with three games: a Board & Card Score Tracker (competition mode, turn clocks, brackets), a Literary Crossword & Wordscape wheel, and a Word Search grid finder — all built to make reading breaks fun without leaving Kora.",
    },
  ];

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const sampleBooks = [
    {
      id: "intimate-deception",
      category: "Popular Audiobooks",
      title: "Intimate Deception",
      author: "Dr. Sheri Keffer",
      cover: "https://covers.openlibrary.org/b/isbn/9780800729110-L.jpg",
      rating: "4.9",
      source: "Libgen Mirror",
      info: "EPUB • 1.4 MB • Clean Formatting",
      color: "text-sky-500",
      editions: ["EPUB", "EN", "Unknown", "ANNA'S"],
      mirrors: [
        { name: "Libgen Mirror (libgen.li)", url: "https://libgen.li/get.php?md5=8391ab7228dbf0be62701dd7c639107a", format: "EPUB", size: "1.4 MB", status: "online" },
        { name: "Anna's Archive", url: "https://annas-archive.org/md5/8391ab7228dbf0be62701dd7c639107a", format: "EPUB", size: "1.4 MB", status: "fast" },
        { name: "Anna's Archive (Slow/Manual)", url: "https://annas-archive.gl/slow_download/8391ab7228dbf0be62701dd7c639107a", format: "PDF", size: "3.2 MB", status: "slow" },
      ],
      audioTracks: [
        "Dr. Sheri Keffer – Intimate Deception Audiobook (Recovering the Injuries of Sexual Betrayal - Ch 1)",
        "Dr. Sheri Keffer – Intimate Deception Audiobook (Recovering the Injuries of Sexual Betrayal - Ch 2)",
        "Dr. Sheri Keffer – Intimate Deception Audiobook (Recovering the Injuries of Sexual Betrayal - Ch 3)",
        "Dr. Sheri Keffer – Intimate Deception Audiobook (Recovering the Injuries of Sexual Betrayal - Ch 4)",
        "Dr. Sheri Keffer – Intimate Deception Audiobook (Recovering the Injuries of Sexual Betrayal - Ch 5)",
        "Dr. Sheri Keffer – Intimate Deception Audiobook (Recovering the Injuries of Sexual Betrayal - Ch 6)",
      ]
    },
    {
      id: "hunger-makes-me",
      category: "Popular Audiobooks",
      title: "Hunger Makes Me a Modern Girl",
      author: "Carrie Brownstein",
      cover: "https://covers.openlibrary.org/b/isbn/9780385680783-L.jpg",
      rating: "4.7",
      source: "Anna's Archive",
      info: "EPUB • 890 KB • Memoir",
      color: "text-amber-500",
      editions: ["EPUB", "EN", "Penguin", "FAST CDN"],
      mirrors: [
        { name: "Anna's Archive Node 1", url: "https://annas-archive.org/md5/71829bc81726a7182736152", format: "EPUB", size: "890 KB", status: "fast" },
        { name: "Libgen Mirror (libgen.li)", url: "https://libgen.li/get.php?md5=71829bc81726a7182736152", format: "PDF", size: "2.1 MB", status: "online" },
      ],
      audioTracks: [
        "Carrie Brownstein – Hunger Makes Me a Modern Girl Audiobook (Track 1)",
        "Carrie Brownstein – Hunger Makes Me a Modern Girl Audiobook (Track 2)",
        "Carrie Brownstein – Hunger Makes Me a Modern Girl Audiobook (Track 3)",
      ]
    },
    {
      id: "son-of-neptune",
      category: "Popular Audiobooks",
      title: "The Son of Neptune",
      author: "Rick Riordan",
      cover: "https://covers.openlibrary.org/b/isbn/9781423140597-L.jpg",
      rating: "4.9",
      source: "Rave Engine",
      info: "EPUB • 1.1 MB • Fantasy",
      color: "text-purple-500",
      editions: ["EPUB", "EN", "Disney-Hyperion", "PRIMARY"],
      mirrors: [
        { name: "RAVE Engine High Speed Node", url: "https://rave.engine/dl/son-of-neptune.epub", format: "EPUB", size: "1.1 MB", status: "fast" },
        { name: "Libgen Mirror (libgen.rs)", url: "https://libgen.rs/book/index.php?md5=918237192837192", format: "PDF", size: "3.4 MB", status: "online" },
      ],
      audioTracks: [
        "Rick Riordan – The Son of Neptune Audiobook (Narrated by Joshua Swanson - Part 1)",
        "Rick Riordan – The Son of Neptune Audiobook (Narrated by Joshua Swanson - Part 2)",
        "Rick Riordan – The Son of Neptune Audiobook (Narrated by Joshua Swanson - Part 3)",
      ]
    },
    {
      id: "against-the-wall",
      category: "Popular Audiobooks",
      title: "Against The Wall",
      author: "Rebecca Zanetti",
      cover: "https://covers.openlibrary.org/b/isbn/9781420131451-L.jpg",
      rating: "4.6",
      source: "Libgen Mirror",
      info: "EPUB • 520 KB • Romance/Thriller",
      color: "text-emerald-500",
      editions: ["EPUB", "EN", "Kensington"],
      mirrors: [
        { name: "Libgen Mirror (libgen.li)", url: "https://libgen.li/get.php?md5=129837192837192", format: "EPUB", size: "520 KB", status: "online" },
      ],
      audioTracks: [
        "Rebecca Zanetti – Against The Wall Audiobook (Full Narration)",
      ]
    },
    {
      id: "shatter-me",
      category: "Popular Audiobooks",
      title: "Shatter Me",
      author: "Tahereh Mafi",
      cover: "https://covers.openlibrary.org/b/isbn/9780062085504-L.jpg",
      rating: "4.8",
      source: "Anna's Archive",
      info: "EPUB • 780 KB • YA Dystopian",
      color: "text-rose-500",
      editions: ["EPUB", "EN", "HarperCollins"],
      mirrors: [
        { name: "Anna's Archive Fast Mirror", url: "https://annas-archive.org/md5/98127391283719", format: "EPUB", size: "780 KB", status: "fast" },
      ],
      audioTracks: [
        "Tahereh Mafi – Shatter Me Audiobook (Part 1)",
        "Tahereh Mafi – Shatter Me Audiobook (Part 2)",
      ]
    },
    {
      id: "wicked-king",
      category: "Popular Audiobooks",
      title: "The Wicked King",
      author: "Holly Black",
      cover: "https://covers.openlibrary.org/b/isbn/9780316310352-L.jpg",
      rating: "4.8",
      source: "Libgen Mirror",
      info: "EPUB • 1.2 MB • Fantasy",
      color: "text-sky-500",
      editions: ["EPUB", "EN", "Little Brown"],
      mirrors: [
        { name: "Libgen Mirror (libgen.li)", url: "https://libgen.li/get.php?md5=928137192837192", format: "EPUB", size: "1.2 MB", status: "online" },
      ],
      audioTracks: [
        "Holly Black – The Wicked King Audiobook (Full Track)",
      ]
    },
    {
      id: "what-if-its-us",
      category: "Popular Audiobooks",
      title: "What If It's Us",
      author: "Becky Albertalli, Adam Silvera",
      cover: "https://covers.openlibrary.org/b/isbn/9780062795250-L.jpg",
      rating: "4.7",
      source: "Anna's Archive",
      info: "EPUB • 950 KB • Contemporary",
      color: "text-teal-500",
      editions: ["EPUB", "EN", "HarperTeen"],
      mirrors: [
        { name: "Anna's Archive Fast Mirror", url: "https://annas-archive.org/md5/812739128371", format: "EPUB", size: "950 KB", status: "fast" },
      ],
      audioTracks: [
        "Becky Albertalli & Adam Silvera – What If It's Us Audiobook (Track 1)",
        "Becky Albertalli & Adam Silvera – What If It's Us Audiobook (Track 2)",
      ]
    },
    {
      id: "creative-act",
      category: "NYT: Business",
      title: "The Creative Act",
      author: "Rick Rubin",
      cover: "https://covers.openlibrary.org/b/isbn/9780593652886-L.jpg",
      rating: "4.9",
      source: "NYT Best Seller",
      info: "EPUB • 2.1 MB • Creativity & Way of Being",
      color: "text-amber-500",
      editions: ["EPUB", "EN", "Penguin Press", "BEST SELLER"],
      mirrors: [
        { name: "Libgen Mirror (libgen.li)", url: "https://libgen.li/get.php?md5=38192739128371", format: "EPUB", size: "2.1 MB", status: "online" },
        { name: "Anna's Archive", url: "https://annas-archive.org/md5/38192739128371", format: "EPUB", size: "2.1 MB", status: "fast" },
      ],
      audioTracks: [
        "Rick Rubin – The Creative Act: A Way of Being Audiobook (Narrated by Rick Rubin - Part 1)",
        "Rick Rubin – The Creative Act: A Way of Being Audiobook (Narrated by Rick Rubin - Part 2)",
      ]
    },
    {
      id: "let-them-theory",
      category: "NYT: Business",
      title: "The Let Them Theory",
      author: "Mel Robbins",
      cover: "https://covers.openlibrary.org/b/isbn/9781401971489-L.jpg",
      rating: "4.8",
      source: "NYT Best Seller",
      info: "EPUB • 1.6 MB • Self-Improvement",
      color: "text-emerald-500",
      editions: ["EPUB", "EN", "Hay House"],
      mirrors: [
        { name: "Anna's Archive Fast Node", url: "https://annas-archive.org/md5/19283719283719", format: "EPUB", size: "1.6 MB", status: "fast" },
      ],
      audioTracks: [
        "Mel Robbins – The Let Them Theory Audiobook (Full Stream)",
      ]
    },
    {
      id: "never-split-difference",
      category: "NYT: Business",
      title: "Never Split The Difference",
      author: "Chris Voss",
      cover: "https://covers.openlibrary.org/b/isbn/9780062407801-L.jpg",
      rating: "4.9",
      source: "NYT Best Seller",
      info: "EPUB • 1.2 MB • Negotiation",
      color: "text-rose-500",
      editions: ["EPUB", "EN", "HarperBusiness"],
      mirrors: [
        { name: "Libgen Mirror (libgen.li)", url: "https://libgen.li/get.php?md5=91823719283712", format: "EPUB", size: "1.2 MB", status: "online" },
      ],
      audioTracks: [
        "Chris Voss – Never Split The Difference Audiobook (Track 1)",
        "Chris Voss – Never Split The Difference Audiobook (Track 2)",
      ]
    },
    {
      id: "1929",
      category: "NYT: Business",
      title: "1929: The Great Crash",
      author: "Andrew Ross Sorkin",
      cover: "https://covers.openlibrary.org/b/isbn/9780593833150-L.jpg",
      rating: "4.8",
      source: "NYT Best Seller",
      info: "EPUB • 2.8 MB • History / Finance",
      color: "text-red-500",
      editions: ["EPUB", "EN", "Viking"],
      mirrors: [
        { name: "Libgen Mirror (libgen.li)", url: "https://libgen.li/get.php?md5=812739182739", format: "EPUB", size: "2.8 MB", status: "online" },
      ],
      audioTracks: [
        "Andrew Ross Sorkin – 1929 Audiobook (Part 1)",
      ]
    },
    {
      id: "i-will-teach-you",
      category: "NYT: Business",
      title: "I Will Teach You To Be Rich",
      author: "Ramit Sethi",
      cover: "https://covers.openlibrary.org/b/isbn/9781523505746-L.jpg",
      rating: "4.8",
      source: "NYT Best Seller",
      info: "EPUB • 1.5 MB • Personal Finance",
      color: "text-amber-500",
      editions: ["EPUB", "EN", "Workman"],
      mirrors: [
        { name: "Anna's Archive Fast Node", url: "https://annas-archive.org/md5/912837192837", format: "EPUB", size: "1.5 MB", status: "fast" },
      ],
      audioTracks: [
        "Ramit Sethi – I Will Teach You To Be Rich Audiobook (Full Narration)",
      ]
    },
    {
      id: "atomic-habits",
      category: "NYT: Business",
      title: "Atomic Habits",
      author: "James Clear",
      cover: "https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg",
      rating: "5.0",
      source: "NYT Best Seller",
      info: "EPUB • 1.8 MB • Habits & Productivity",
      color: "text-amber-500",
      editions: ["EPUB", "EN", "Avery", "BEST SELLER"],
      mirrors: [
        { name: "Libgen Mirror (libgen.li)", url: "https://libgen.li/get.php?md5=712839182739182", format: "EPUB", size: "1.8 MB", status: "online" },
        { name: "Anna's Archive", url: "https://annas-archive.org/md5/712839182739182", format: "EPUB", size: "1.8 MB", status: "fast" },
      ],
      audioTracks: [
        "James Clear – Atomic Habits Audiobook (Narrated by James Clear)",
      ]
    }
  ];

  const DISCOVER_FEED_CATEGORIES = [
    {
      id: "nyt",
      title: "NYT: Hardcover Fiction",
      icon: BookOpen,
      iconColor: "text-neutral-300",
      books: [
        { id: "whistler", title: "Whistler", author: "Ann Patchett", rating: "4.8", cover: "https://covers.openlibrary.org/b/isbn/9780062491107-L.jpg", info: "EPUB • 1.1 MB • Fiction" },
        { id: "love-you-more", title: "Love You More", author: "Emily Giffin", rating: "4.7", cover: "https://covers.openlibrary.org/b/isbn/9780312548087-L.jpg", info: "EPUB • 980 KB • Contemporary" },
        { id: "ransom", title: "Ransom", author: "Daniel Silva", rating: "4.9", cover: "https://covers.openlibrary.org/b/isbn/9780062834829-L.jpg", info: "EPUB • 1.4 MB • Thriller" },
        { id: "calamity-club", title: "The Calamity Club", author: "Kathryn Stockett", rating: "4.8", cover: "https://covers.openlibrary.org/b/isbn/9780399155345-L.jpg", info: "EPUB • 1.6 MB • Historical" },
        { id: "dungeon-cookbook", title: "The Dungeon Anarchist's Cookbook", author: "Matt Dinniman", rating: "4.9", cover: "https://covers.openlibrary.org/b/isbn/9781702816922-L.jpg", info: "EPUB • 2.2 MB • LitRPG / Fantasy" },
        { id: "yesteryear", title: "Yesteryear", author: "Caro Claire Burke", rating: "4.6", cover: "https://covers.openlibrary.org/b/isbn/9780593448380-L.jpg", info: "EPUB • 1.2 MB • Fiction" },
        { id: "feral-gods", title: "The Gate of the Feral Gods", author: "Matt Dinniman", rating: "4.9", cover: "https://covers.openlibrary.org/b/isbn/9781087950853-L.jpg", info: "EPUB • 2.4 MB • LitRPG / Sci-Fi" },
      ]
    },
    {
      id: "goodreads-best",
      title: "Goodreads: Best Ever",
      icon: Globe,
      iconColor: "text-amber-400",
      books: [
        { id: "outlander", title: "Outlander (Outlander, #1)", author: "Diana Gabaldon", rating: "4.3", cover: "https://covers.openlibrary.org/b/isbn/9780440212560-L.jpg", info: "EPUB • 2.5 MB • Historical Romance" },
        { id: "hitchhiker", title: "The Hitchhiker's Guide to the Galaxy", author: "Douglas Adams", rating: "4.2", cover: "https://covers.openlibrary.org/b/isbn/9780345391803-L.jpg", info: "EPUB • 820 KB • Sci-Fi / Comedy" },
        { id: "narnia", title: "The Chronicles of Narnia", author: "C.S. Lewis", rating: "4.3", cover: "https://covers.openlibrary.org/b/isbn/9780064471190-L.jpg", info: "EPUB • 3.1 MB • Fantasy Classic" },
        { id: "giving-tree", title: "The Giving Tree", author: "Shel Silverstein", rating: "4.4", cover: "https://covers.openlibrary.org/b/isbn/9780060256654-L.jpg", info: "EPUB • 450 KB • Illustrated" },
        { id: "princess-bride", title: "The Princess Bride", author: "William Goldman", rating: "4.3", cover: "https://covers.openlibrary.org/b/isbn/9780156027014-L.jpg", info: "EPUB • 1.3 MB • Adventure / Fantasy" },
        { id: "hunger-games", title: "The Hunger Games", author: "Suzanne Collins", rating: "4.3", cover: "https://covers.openlibrary.org/b/isbn/9780439023481-L.jpg", info: "EPUB • 1.1 MB • YA Dystopian" },
        { id: "little-prince", title: "The Little Prince", author: "Antoine de Saint-Exupéry", rating: "4.3", cover: "https://covers.openlibrary.org/b/isbn/9780156012195-L.jpg", info: "EPUB • 680 KB • Classic Philosophy" },
      ]
    },
    {
      id: "goodreads-21st",
      title: "Goodreads: 21st Century",
      icon: Globe,
      iconColor: "text-amber-400",
      books: [
        { id: "book-thief", title: "The Book Thief", author: "Markus Zusak", rating: "4.0", cover: "https://covers.openlibrary.org/b/isbn/9780375842207-L.jpg", info: "EPUB • 1.7 MB • Historical Fiction" },
        { id: "kite-runner", title: "The Kite Runner", author: "Khaled Hosseini", rating: "3.9", cover: "https://covers.openlibrary.org/b/isbn/9781594631931-L.jpg", info: "EPUB • 1.4 MB • Drama" },
        { id: "life-of-pi", title: "Life of Pi", author: "Yann Martel", rating: "4.3", cover: "https://covers.openlibrary.org/b/isbn/9780156027328-L.jpg", info: "EPUB • 1.2 MB • Adventure" },
        { id: "splendid-suns", title: "A Thousand Splendid Suns", author: "Khaled Hosseini", rating: "4.3", cover: "https://covers.openlibrary.org/b/isbn/9781594489501-L.jpg", info: "EPUB • 1.5 MB • Drama" },
        { id: "fault-in-our-stars", title: "The Fault in Our Stars", author: "John Green", rating: "4.2", cover: "https://covers.openlibrary.org/b/isbn/9780525478812-L.jpg", info: "EPUB • 920 KB • YA Fiction" },
        { id: "gone-girl", title: "Gone Girl", author: "Gillian Flynn", rating: "4.3", cover: "https://covers.openlibrary.org/b/isbn/9780307588371-L.jpg", info: "EPUB • 1.8 MB • Psychological Thriller" },
        { id: "atomic-habits", title: "Atomic Habits", author: "James Clear", rating: "5.0", cover: "https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg", info: "EPUB • 1.8 MB • Productivity" },
      ]
    },
    {
      id: "audiobooks-feed",
      title: "Popular Audiobooks",
      icon: Headphones,
      iconColor: "text-sky-400",
      books: [
        { id: "intimate-deception", title: "Intimate Deception", author: "Dr. Sheri Keffer", rating: "4.9", cover: "https://covers.openlibrary.org/b/isbn/9780800729110-L.jpg", info: "AUDIO • 1.4 MB • Clean Formatting" },
        { id: "hunger-makes-me", title: "Hunger Makes Me a Modern Girl", author: "Carrie Brownstein", rating: "4.7", cover: "https://covers.openlibrary.org/b/isbn/9780385680783-L.jpg", info: "AUDIO • 890 KB • Memoir" },
        { id: "son-of-neptune", title: "The Son of Neptune", author: "Rick Riordan", rating: "4.9", cover: "https://covers.openlibrary.org/b/isbn/9781423140597-L.jpg", info: "AUDIO • 1.1 MB • Fantasy" },
        { id: "against-the-wall", title: "Against The Wall", author: "Rebecca Zanetti", rating: "4.6", cover: "https://covers.openlibrary.org/b/isbn/9781420131451-L.jpg", info: "AUDIO • 520 KB • Romance/Thriller" },
        { id: "shatter-me", title: "Shatter Me", author: "Tahereh Mafi", rating: "4.8", cover: "https://covers.openlibrary.org/b/isbn/9780062085504-L.jpg", info: "AUDIO • 780 KB • YA Dystopian" },
        { id: "wicked-king", title: "The Wicked King", author: "Holly Black", rating: "4.8", cover: "https://covers.openlibrary.org/b/isbn/9780316310352-L.jpg", info: "AUDIO • 1.2 MB • Fantasy" },
        { id: "what-if-its-us", title: "What If It's Us", author: "Becky Albertalli, Adam Silvera", rating: "4.7", cover: "https://covers.openlibrary.org/b/isbn/9780062795250-L.jpg", info: "AUDIO • 950 KB • Contemporary" },
      ]
    }
  ];

  const allBooksList = [
    ...sampleBooks,
    ...DISCOVER_FEED_CATEGORIES.flatMap((c) =>
      c.books.map((b) => ({
        id: b.id,
        category: c.title,
        title: b.title,
        author: b.author,
        cover: b.cover,
        rating: b.rating,
        source: "Open Archive Mirror",
        info: b.info || "EPUB • 1.2 MB • E-Ink Optimized",
        color: "text-amber-500",
        editions: ["EPUB", "EN", "Primary Mirror"],
        mirrors: [
          { name: "Libgen Fast Mirror (libgen.li)", url: `https://libgen.li/get.php?md5=${b.id}`, format: "EPUB", size: "1.2 MB", status: "online" as const },
          { name: "Anna's Archive Node 1", url: `https://annas-archive.org/md5/${b.id}`, format: "EPUB", size: "1.2 MB", status: "fast" as const },
        ],
        audioTracks: [
          `${b.author} – ${b.title} Audiobook (Part 1)`,
          `${b.author} – ${b.title} Audiobook (Part 2)`,
        ],
      }))
    ),
  ];

  const selectedBook = allBooksList.find((b) => b.id === selectedBookId) || sampleBooks[0];

  const filteredBooks = sampleBooks.filter((b) => {
    if (!catalogQuery) return true;
    const q = catalogQuery.toLowerCase();
    return b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || b.category.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-kindle-bg text-kindle-text font-sans antialiased selection:bg-kindle-accent/20">
      {/* Dynamic Smooth Scroll Progress Bar */}
      <motion.div 
        className="fixed top-0 left-0 right-0 h-[3px] bg-kindle-accent z-50 origin-left"
        style={{ scaleX: scrollYProgress }}
      />

      {/* Top Site Navigation Header */}
      <nav className={`sticky top-0 z-40 bg-kindle-bg/95 backdrop-blur-md border-b border-kindle-border/80 transition-all duration-300 ${navHidden ? "-translate-y-full" : "translate-y-0 shadow-sm"}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2 sm:gap-3 group shrink-0">
            <div className="w-9 h-9 rounded-xl bg-kindle-card border border-kindle-border flex items-center justify-center group-hover:border-kindle-accent group-hover:shadow-[0_0_12px_rgba(245,158,11,0.15)] transition-all duration-300 shadow-xs">
              <KoraIcon className="w-5 h-5 text-kindle-text group-hover:scale-110 transition-transform duration-300" />
            </div>
            <KoraWordmark className="h-5 sm:h-5.5 text-kindle-text group-hover:text-kindle-accent transition-colors duration-300" />
          </a>

          {/* Smooth Scroll Navigation Links */}
          <div className="flex items-center gap-3 sm:gap-4 md:gap-5 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-kindle-text-muted overflow-x-auto scrollbar-none py-1 max-w-[calc(100vw-180px)] sm:max-w-none">
            <button
              type="button"
              onClick={() => scrollToSection("catalog")}
              className="hover:text-kindle-text transition cursor-pointer whitespace-nowrap relative after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1.5px] after:bg-kindle-accent after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-250 after:origin-left"
            >
              Catalog
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("cloud")}
              className="hover:text-kindle-text transition cursor-pointer whitespace-nowrap relative after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1.5px] after:bg-kindle-accent after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-250 after:origin-left"
            >
              Sync Engine
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("voice")}
              className="hover:text-kindle-text transition cursor-pointer whitespace-nowrap relative after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1.5px] after:bg-kindle-accent after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-250 after:origin-left"
            >
              Voice Reader
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("workshop")}
              className="hover:text-kindle-text transition cursor-pointer whitespace-nowrap relative after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1.5px] after:bg-kindle-accent after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-250 after:origin-left"
            >
              Tools &amp; Games
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("download-card")}
              className="hover:text-kindle-text transition cursor-pointer whitespace-nowrap relative after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1.5px] after:bg-kindle-accent after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-250 after:origin-left"
            >
              APK Download
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("guide")}
              className="hover:text-kindle-text transition cursor-pointer whitespace-nowrap relative after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1.5px] after:bg-kindle-accent after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-250 after:origin-left"
            >
              Guide
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("faq")}
              className="hover:text-kindle-text transition cursor-pointer whitespace-nowrap relative after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1.5px] after:bg-kindle-accent after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-250 after:origin-left"
            >
              FAQ
            </button>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Direct Theme Switcher Button */}
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 sm:px-3 sm:py-2 rounded-xl bg-kindle-card border border-kindle-border text-kindle-text hover:border-kindle-accent transition cursor-pointer shadow-xs flex items-center gap-1.5 text-[10px] sm:text-xs font-bold"
              title={isDarkMode ? "Switch to Pristine Light Theme" : "Switch to Dark Theme"}
            >
              {isDarkMode ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                  <span className="hidden sm:inline">Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-kindle-accent" />
                  <span className="hidden sm:inline">Dark Mode</span>
                </>
              )}
            </button>

            {/* Back to Web Reader */}
            <a
              href="/"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-kindle-card border border-kindle-border text-[10px] sm:text-xs font-bold text-kindle-text hover:border-kindle-accent hover:-translate-x-0.5 transition-all duration-200 cursor-pointer shadow-xs whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Web Reader</span>
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <header
        id="hero-section"
        ref={heroSectionRef}
        onMouseMove={handleHeaderMouseMove}
        className="relative w-full overflow-hidden flex flex-col justify-center min-h-[calc(100vh-68px)] lg:min-h-[90vh] py-16 md:py-24 lg:py-32 border-b border-kindle-border/60"
      >
        {/* Ambient Interactive Orbs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <motion.div
            animate={{ x: headerMouse.x * -1.5, y: headerMouse.y * -1.5 }}
            transition={{ type: "spring", stiffness: 60, damping: 25 }}
            className="absolute -top-24 -left-20 w-96 h-96 rounded-full bg-kindle-accent/5 blur-3xl opacity-70"
          />
          <motion.div
            animate={{ x: headerMouse.x * 2, y: headerMouse.y * 2 }}
            transition={{ type: "spring", stiffness: 60, damping: 25 }}
            className="absolute top-1/2 -right-24 w-[400px] h-[400px] rounded-full bg-amber-500/5 blur-3xl opacity-50"
          />
          {/* Authentic Notebook Ruled Lines Background */}
          <div 
            className="absolute inset-0 opacity-[0.35] dark:opacity-[0.12] pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(to bottom, var(--theme-border) 1px, transparent 1px),
                linear-gradient(to right, rgba(239, 68, 68, 0.4) 1px, transparent 1px)
              `,
              backgroundSize: "100% 28px, 100% 100%",
              backgroundPosition: "0 0, 100px 0",
              maskImage: "radial-gradient(circle at 50% 50%, black 85%, transparent 100%)",
              WebkitMaskImage: "radial-gradient(circle at 50% 50%, black 85%, transparent 100%)",
            }}
          />

          {/* Background Animated Ink Kora "K" Icon on Right Side */}
          <div className="absolute top-1/2 -translate-y-1/2 -right-16 sm:-right-10 lg:-right-4 xl:right-4 pointer-events-none select-none z-0 opacity-65 dark:opacity-40 hidden sm:block overflow-visible">
            <KoraIconInkDraw size={680} opacity={1} />
          </div>
        </div>

        <HeroGridContent 
          apk={apk} 
          handleCopyLink={handleCopyLink} 
          copiedLink={copiedLink} 
          onTextMouseMove={handleTextMouseMove}
          onTextMouseLeave={handleTextMouseLeave}
        />

        {/* Optical Image Magnifier Glass (Restricted strictly to Hero Section) */}
        <AnimatePresence>
          {magnifier && magnifier.visible && (
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="absolute pointer-events-none z-50 overflow-visible"
              style={{
                width: "120px",
                height: "120px",
                left: `${magnifier.x - 60}px`,
                top: `${magnifier.y - 60}px`,
              }}
            >
              {/* The Glass Lens Body - Pure Circle without handle */}
              <div className="w-full h-full rounded-full border-[3px] border-neutral-800 dark:border-neutral-200 bg-kindle-bg shadow-[0_15px_35px_rgba(0,0,0,0.6),inset_0_2px_8px_rgba(255,255,255,0.7)] overflow-hidden relative">
                
                {/* Optical Zoom Mirror of Hero Section Content */}
                <div
                  className="absolute pointer-events-none select-none flex flex-col justify-center py-16 md:py-24 lg:py-32"
                  style={{
                    width: `${magnifier.heroWidth}px`,
                    height: `${magnifier.heroHeight}px`,
                    transformOrigin: "0 0",
                    transform: "scale(2.0)",
                    left: `${60 - magnifier.x * 2.0}px`,
                    top: `${60 - magnifier.y * 2.0}px`,
                  }}
                >
                  <HeroGridContent apk={apk} handleCopyLink={handleCopyLink} copiedLink={copiedLink} />
                </div>

                {/* Optical Center Crosshair Target */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
                  <div className="w-full h-[0.5px] bg-amber-500/25" />
                  <div className="h-full w-[0.5px] bg-amber-500/25 absolute" />
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80 shadow-xs absolute ring-2 ring-black/40" />
                </div>

                {/* Convex Glass Refraction Reflection & Rim Highlight */}
                <div 
                  className="absolute inset-0 pointer-events-none z-10"
                  style={{
                    background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.08) 50%, rgba(0,0,0,0.2) 100%)"
                  }}
                />
                
                {/* Spherical Inner Lens Edge Bulge Distortion Shadow */}
                <div className="absolute inset-0 pointer-events-none rounded-full shadow-[inset_0_-8px_16px_rgba(0,0,0,0.25),inset_0_8px_16px_rgba(255,255,255,0.5)] border border-white/20 z-10" />

                {/* Subpixel Matrix Grid Texture */}
                <div 
                  className="absolute inset-0 pointer-events-none mix-blend-multiply opacity-[0.05] dark:opacity-[0.10] z-10"
                  style={{
                    backgroundImage: "linear-gradient(to right, #000 1px, transparent 1px), linear-gradient(to bottom, #000 1px, transparent 1px)",
                    backgroundSize: "4px 4px"
                  }}
                />
                
                {/* Subtle Backlit Warm Glass Tint */}
                <div className="absolute inset-0 pointer-events-none bg-amber-500/5 mix-blend-overlay z-10" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Main Continuous Feature Sections - Bento Grid Layout on Desktop */}
      <div className="relative overflow-hidden">
        <InkSketchScribbleBackground />
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 space-y-6 relative z-10">

        {/* Section 1: Ebook & Reader Engine */}
        <Reveal>
          <div id="ebooks" className="pt-6 border-t border-kindle-border/60 scroll-mt-20 space-y-6">
            <FeatureDemosGrid />
          </div>
        </Reveal>

        {/* Bento Grid layout for the key showcase sections on Desktop */}
        <div className="pt-6 border-t border-kindle-border/60">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">

            {/* Left Column (span 7): Themes, Discover/Catalog, and Games Grid */}
            <div className="lg:col-span-7 flex flex-col gap-6 h-full">

              {/* Section 2: Reading Themes & Typography (Bento Card 1) */}
              <div id="themes" className="scroll-mt-20 flex flex-col">
                <Reveal className="flex-1 flex flex-col">
                  <div>
                    <ThemeShowcase />
                  </div>
                </Reveal>
              </div>

              {/* Section 5: Open Catalog & Mirror Discovery (Bento Card 4) */}
              <div id="catalog" className="scroll-mt-20 flex flex-col flex-grow">
                <Reveal className="flex-1 flex flex-col">
                  {/* Single Unified Card with Flush Inner Discover Tab View */}
                  <div className="w-full min-h-[580px] sm:min-h-[640px] flex-grow bg-kindle-card border border-kindle-border rounded-3xl shadow-xl overflow-hidden text-left flex flex-col">
                    {/* Card Header */}
                    <div className="p-4 sm:p-5 space-y-1 border-b border-kindle-border bg-kindle-card shrink-0">
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-500 dark:text-sky-400 uppercase tracking-wider">
                        <Search className="w-4 h-4" /> Global Catalog &amp; Mirror Engine
                      </div>
                      <h3 className="text-lg sm:text-xl font-serif font-bold text-kindle-text">
                        Discover Tab &amp; Download Mirror Hub
                      </h3>
                      <p className="text-xs text-kindle-text-muted leading-relaxed">
                        Explore global archives, federated catalog feeds, and trending best sellers with live book cover art, direct mirror links, and multi-source download options.
                      </p>
                    </div>

                    {/* Flush Inner Multi-Row Panoramic Globe Cylinder Showcase Animation View */}
                    <div className="p-3 sm:p-4 relative text-left flex-grow bg-kindle-bg border-t border-kindle-border/40 flex flex-col overflow-hidden justify-center space-y-1.5 globe-perspective-container">
                      {/* Globe Cylinder Side Vignette & Warp Overlays */}
                      <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-kindle-bg via-kindle-bg/60 to-transparent backdrop-blur-[2px] z-25 pointer-events-none" />
                      <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-kindle-bg via-kindle-bg/60 to-transparent backdrop-blur-[2px] z-25 pointer-events-none" />

                      {/* Row 1: Leftwards 3D Cylinder */}
                      <GlobeGalleryRow 
                        books={[
                          ...DISCOVER_FEED_CATEGORIES[0].books,
                          ...DISCOVER_FEED_CATEGORIES[1].books,
                          ...DISCOVER_FEED_CATEGORIES[0].books,
                          ...DISCOVER_FEED_CATEGORIES[1].books
                        ]} 
                        speed={-0.6} 
                      />

                      {/* Row 2: Rightwards 3D Cylinder */}
                      <GlobeGalleryRow 
                        books={[
                          ...DISCOVER_FEED_CATEGORIES[2].books,
                          ...DISCOVER_FEED_CATEGORIES[3].books,
                          ...DISCOVER_FEED_CATEGORIES[2].books,
                          ...DISCOVER_FEED_CATEGORIES[3].books
                        ]} 
                        speed={0.6} 
                      />

                      {/* Row 3: Leftwards 3D Cylinder (Slower, staggered) */}
                      <GlobeGalleryRow 
                        books={[
                          ...DISCOVER_FEED_CATEGORIES[1].books,
                          ...DISCOVER_FEED_CATEGORIES[2].books,
                          ...DISCOVER_FEED_CATEGORIES[1].books,
                          ...DISCOVER_FEED_CATEGORIES[2].books
                        ]} 
                        speed={-0.45} 
                      />

                      {/* Row 4: Rightwards 3D Cylinder */}
                      <GlobeGalleryRow 
                        books={[
                          ...DISCOVER_FEED_CATEGORIES[3].books,
                          ...DISCOVER_FEED_CATEGORIES[0].books,
                          ...DISCOVER_FEED_CATEGORIES[3].books,
                          ...DISCOVER_FEED_CATEGORIES[0].books
                        ]} 
                        speed={0.5} 
                      />

                      {/* Row 5: Leftwards 3D Cylinder (Slower bottom row) */}
                      <GlobeGalleryRow 
                        books={[
                          ...DISCOVER_FEED_CATEGORIES[2].books,
                          ...DISCOVER_FEED_CATEGORIES[1].books,
                          ...DISCOVER_FEED_CATEGORIES[2].books,
                          ...DISCOVER_FEED_CATEGORIES[1].books
                        ]} 
                        speed={-0.35} 
                      />

                       {/* Active Download Progress Bar at bottom if active */}
                       {activeDownload && (
                         <div className="p-4 bg-kindle-card text-kindle-text rounded-2xl space-y-2 border border-emerald-500/40 shadow-xl animate-in fade-in duration-200 mt-2">
                           <div className="flex items-center justify-between text-xs font-bold">
                             <div className="flex items-center gap-2 truncate">
                               <Download className="w-4 h-4 text-emerald-500 animate-bounce" />
                               <span className="truncate">{activeDownload.name}</span>
                             </div>
                             <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400 shrink-0">
                               {activeDownload.completed ? "COMPLETED" : `${activeDownload.progress}%`}
                             </span>
                           </div>
                           <div className="w-full bg-kindle-border rounded-full h-2 overflow-hidden">
                             <div
                               className="bg-gradient-to-r from-amber-500 to-emerald-500 h-full transition-all duration-300"
                               style={{ width: `${activeDownload.progress}%` }}
                              />
                           </div>
                           <div className="flex items-center justify-between text-[10px] font-mono text-kindle-text-muted">
                             <span>Source: {activeDownload.source}</span>
                             <span>{activeDownload.completed ? "Saved to Kora Local Library!" : "Downloading..."}</span>
                           </div>
                         </div>
                       )}
                     </div>

                    {/* POPUP MODAL: Download Mirror Hub on Top of Discover Tab */}
                    <AnimatePresence>
                      {isDownloadModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 15 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 15 }}
                            transition={{ duration: 0.25, ease: "easeOut" }}
                            className="relative w-full max-w-xl max-h-[90vh] bg-kindle-card border border-kindle-border text-kindle-text rounded-3xl p-6 sm:p-7 shadow-2xl overflow-y-auto space-y-5 text-left"
                          >
                            {/* Modal Header */}
                            <div className="flex items-start justify-between border-b border-kindle-border pb-4">
                              <div className="flex items-center gap-4 min-w-0">
                                <BookCoverImage
                                  book={selectedBook}
                                  className="w-16 h-22 object-cover rounded-xl shadow-md border border-kindle-border shrink-0 bg-kindle-bg overflow-hidden"
                                />
                                <div className="space-y-1 min-w-0 flex-1">
                                  <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                                    DOWNLOAD MIRROR HUB
                                  </span>
                                  <h4 className="text-lg sm:text-xl font-serif font-bold text-kindle-text truncate leading-snug">
                                    {selectedBook.title}
                                  </h4>
                                  <p className="text-xs text-kindle-text-muted truncate">by {selectedBook.author}</p>
                                  <p className="text-[10.5px] font-mono text-kindle-text-muted opacity-80 truncate">{selectedBook.info}</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setIsDownloadModalOpen(false)}
                                className="p-2 rounded-full bg-kindle-bg hover:bg-kindle-border/50 text-kindle-text transition cursor-pointer shrink-0 ml-2 border border-kindle-border"
                                title="Close"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>

                            {/* SELECT EDITION Box */}
                            <div className="space-y-2">
                              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-kindle-text-muted">
                                SELECT EDITION / FORMAT:
                              </span>
                              <div className="p-3 bg-kindle-bg border border-kindle-border rounded-2xl flex flex-wrap gap-2 items-center">
                                {selectedBook.editions.map((ed, i) => (
                                  <span
                                    key={i}
                                    className={`px-3 py-1 rounded-xl text-xs font-mono font-bold uppercase tracking-wider border cursor-pointer transition ${
                                      i === 0
                                        ? "bg-kindle-text text-kindle-bg border-kindle-text shadow-xs"
                                        : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:border-kindle-accent"
                                    }`}
                                  >
                                    {ed}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* AVAILABLE DOWNLOAD MIRRORS Box */}
                            <div className="space-y-2.5">
                              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-kindle-text-muted">
                                AVAILABLE DOWNLOAD MIRRORS:
                              </span>
                              <div className="p-3 bg-kindle-bg border border-kindle-border rounded-2xl space-y-2.5">
                                {selectedBook.mirrors.map((mirror, idx) => (
                                  <div
                                    key={idx}
                                    className="p-3 bg-kindle-card border border-kindle-border rounded-xl flex items-center justify-between gap-3 hover:border-kindle-accent transition"
                                  >
                                    <div className="space-y-0.5 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${mirror.status === "fast" || mirror.status === "online" ? "bg-emerald-500 shadow-xs shadow-emerald-500/50 animate-pulse" : "bg-amber-500"}`} />
                                        <span className="font-bold text-xs text-kindle-text truncate">{mirror.name}</span>
                                      </div>
                                      <p className="text-[10px] font-mono text-kindle-text-muted truncate">{mirror.url}</p>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          toast.success(`Opening mirror link: ${mirror.name}`);
                                        }}
                                        className="p-2.5 rounded-xl bg-kindle-bg border border-kindle-border text-kindle-text hover:border-kindle-accent transition cursor-pointer"
                                        title="Mirror Link"
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          startSimulatedDownload(mirror.name, "EPUB", selectedBook.title);
                                        }}
                                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                                      >
                                        <Download className="w-3.5 h-3.5" /> Get File
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* AUDIOBOOK Track List (If available) */}
                            {selectedBook.audioTracks && selectedBook.audioTracks.length > 0 && (
                              <div className="space-y-2.5 pt-2">
                                <div className="flex items-center gap-2">
                                  <Headphones className="w-4 h-4 text-sky-500" />
                                  <h5 className="text-xs font-bold text-kindle-text uppercase tracking-wider">AUDIOBOOK TRACKS</h5>
                                </div>
                                <div className="bg-kindle-bg border border-kindle-border rounded-2xl overflow-hidden divide-y divide-kindle-border">
                                  {selectedBook.audioTracks.map((trackTitle, tIdx) => (
                                    <div
                                      key={tIdx}
                                      className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-kindle-card/80 transition cursor-pointer group"
                                      onClick={() => toast.success(`Playing preview: ${trackTitle}`)}
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <span className="text-[10px] font-mono text-kindle-text-muted font-bold w-4 text-right">
                                          {tIdx + 1}
                                        </span>
                                        <span className="text-kindle-text group-hover:text-kindle-accent truncate text-xs font-medium">
                                          {trackTitle}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        className="p-1.5 rounded-lg bg-kindle-card border border-kindle-border text-kindle-text group-hover:bg-kindle-accent group-hover:text-kindle-bg transition shrink-0 cursor-pointer"
                                      >
                                        <Play className="w-3.5 h-3.5 fill-current" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Modal Footer Close */}
                            <div className="pt-2 flex justify-end">
                              <button
                                type="button"
                                onClick={() => setIsDownloadModalOpen(false)}
                                className="px-5 py-2.5 bg-kindle-bg border border-kindle-border hover:border-kindle-accent text-kindle-text font-bold text-xs rounded-xl transition cursor-pointer"
                              >
                                Close Mirror Hub
                              </button>
                            </div>
                          </motion.div>
                        </div>
                      )}
                    </AnimatePresence>
                  </div>
                </Reveal>
              </div>

            </div>

            {/* Right Column (span 5): Cloud Sync, Voice, Workshop Header, Dictionary */}
            <div className="lg:col-span-5 flex flex-col gap-6 h-full">

              {/* Section 3: Multi-Destination Cloud Sync (Bento Card 2) */}
              <div id="cloud" className="scroll-mt-20 flex flex-col">
                <Reveal className="flex-1 flex flex-col">
                  <div className="bg-kindle-card border border-kindle-border rounded-3xl p-5 sm:p-6 space-y-5 flex flex-col justify-between">
                    <div className="space-y-4">
                      <div className="border-b border-kindle-border/60 pb-4">
                        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-500 uppercase tracking-wider chromatic-amber">
                          <Zap className="w-4 h-4" /> Multi-Destination Cloud Sync
                        </div>
                        <h3 className="text-xl font-serif font-bold text-kindle-text mt-1">
                          Instant Progress &amp; Annotations Sync
                        </h3>
                        <p className="text-xs text-kindle-text-muted mt-1 leading-relaxed">
                          Seamlessly sync bookmarks, reading progress percentages, and highlight notes across Android, Web, and desktop via Google Firestore or WebDAV.
                        </p>
                      </div>

                      {/* Cloud Target Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-3.5 bg-kindle-bg border border-kindle-border rounded-2xl space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-kindle-text">Firebase Firestore</span>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          </div>
                          <p className="text-[10px] text-kindle-text-muted leading-tight">Real-time sync across devices with zero setup required.</p>
                        </div>
                        <div className="p-3.5 bg-kindle-bg border border-kindle-border rounded-2xl space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-kindle-text">Google Drive Backup</span>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          </div>
                          <p className="text-[10px] text-kindle-text-muted leading-tight">Backup full EPUB library files to private Google Drive space.</p>
                        </div>
                        <div className="p-3.5 bg-kindle-bg border border-kindle-border rounded-2xl space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-kindle-text">WebDAV / Nextcloud</span>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          </div>
                          <p className="text-[10px] text-kindle-text-muted leading-tight">Self-hosted WebDAV sync protocol for complete data ownership.</p>
                        </div>
                        <div className="p-3.5 bg-kindle-bg border border-kindle-border rounded-2xl space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-kindle-text">Local IndexedDB</span>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          </div>
                          <p className="text-[10px] text-kindle-text-muted leading-tight">100% offline access when no network connection is present.</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 mb-2">
                      <SyncArchitectureAnimation />
                    </div>
                  </div>
                </Reveal>
              </div>

              {/* Section 4: Voice Narrator Audiobooks (Bento Card 3) */}
              <div id="voice" className="scroll-mt-20 flex flex-col flex-grow">
                <Reveal className="flex-1 flex flex-col">
                  <div className="bg-kindle-card border border-kindle-border rounded-3xl p-5 sm:p-6 space-y-4 flex flex-col justify-start flex-grow">
                    <div className="flex flex-col items-start justify-between gap-4 border-b border-kindle-border pb-5">
                      <div className="space-y-2">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-kindle-accent/10 text-kindle-accent text-[10px] font-bold uppercase tracking-widest chromatic-amber">
                          <Volume2 className="w-3.5 h-3.5 animate-bounce" /> High-Fidelity Voice Synthesis
                        </div>
                        <h3 className="text-xl font-serif font-bold text-kindle-text">
                          Voice Narrator
                        </h3>
                        <p className="text-xs text-kindle-text-muted leading-relaxed">
                          Convert any EPUB book or document into an immersive audio narration. Listen on the go with custom controls.
                        </p>
                      </div>

                      <a
                        href="/"
                        className="w-full justify-center px-4 py-2.5 bg-kindle-accent text-kindle-bg font-bold text-[10px] uppercase tracking-wider rounded-xl hover:bg-opacity-90 transition shadow-sm cursor-pointer flex items-center gap-2 shrink-0"
                      >
                        <Headphones className="w-3.5 h-3.5" /> Try Voice Reader in App
                      </a>
                    </div>

                    {/* Interactive Audiobook Player Simulator */}
                    <div className="flex flex-col gap-5">
                      {/* Top: Interactive Tape Simulator */}
                      <div className="bg-kindle-bg border border-kindle-border rounded-2xl p-4 space-y-4 shadow-sm flex flex-col justify-between">
                        <div className="flex items-center justify-between border-b border-kindle-border/60 pb-2">
                          <div className="space-y-0.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-kindle-accent font-sans">AUDIO PLAYBACK SIMULATOR</span>
                            <h4 className="text-xs font-bold text-kindle-text font-sans">Frankenstein — Ch 1</h4>
                          </div>
                          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${isVoiceSpeaking ? "bg-emerald-500/10 text-emerald-500 animate-pulse" : "bg-kindle-card text-kindle-text-muted"}`}>
                            {isVoiceSpeaking ? "SPEAKING" : "PAUSED"}
                          </span>
                        </div>

                        {/* Real Cassette Tape component */}
                        <div className="flex items-center justify-center py-3 bg-kindle-card/40 rounded-xl border border-kindle-border/40 relative overflow-hidden group">
                          <CassetteVisualizer
                            title="Frankenstein"
                            coverUrl="https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=120"
                            size="player"
                            orientation="landscape"
                            playing={isVoiceSpeaking}
                            voiceMode={true}
                            className="w-full max-w-[200px]"
                          />
                        </div>

                        <div className="space-y-3">
                          {/* Progress bar and time */}
                          <div className="flex items-center justify-between gap-3 text-right font-mono text-[10px] text-kindle-text-muted">
                            <div className="flex-1 bg-kindle-border/60 rounded-full h-1 overflow-hidden relative">
                              <div 
                                className="bg-kindle-accent h-full transition-all duration-300" 
                                style={{ width: isVoiceSpeaking ? "38%" : "19%" }} 
                              />
                            </div>
                            <span>02:44 / 14:10</span>
                          </div>

                          {/* Controls */}
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setIsVoiceSpeaking(!isVoiceSpeaking)}
                                className="p-2.5 bg-kindle-text text-kindle-bg rounded-xl hover:opacity-90 active:scale-95 transition cursor-pointer flex items-center justify-center shadow-md"
                                title={isVoiceSpeaking ? "Pause Narration" : "Play Narration"}
                              >
                                {isVoiceSpeaking ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setIsVoiceMuted(!isVoiceMuted);
                                  if (isVoiceMuted) {
                                    setIsVoiceSpeaking(true);
                                  }
                                }}
                                className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-center shadow-md ${
                                  isVoiceMuted 
                                    ? "bg-amber-500/10 border-amber-500/30 text-amber-500 hover:bg-amber-500/20" 
                                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20"
                                }`}
                                title={isVoiceMuted ? "Unmute (Click to listen)" : "Mute audio"}
                              >
                                {isVoiceMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                              </button>
                            </div>

                            {/* Speed selection */}
                            <div className="flex items-center gap-0.5 border border-kindle-border rounded-lg p-0.5 bg-kindle-card">
                              {[0.5, 1.0, 1.5, 2.0].map((speed) => (
                                <button
                                  key={speed}
                                  type="button"
                                  onClick={() => setVoiceSpeed(speed)}
                                  className={`px-1.5 py-1 text-[9px] font-bold rounded-md transition cursor-pointer ${voiceSpeed === speed ? "bg-kindle-text text-kindle-bg" : "text-kindle-text-muted hover:text-kindle-text"}`}
                                >
                                  {speed.toFixed(1)}x
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Bottom: Key Voice Specs (2 cols) */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-kindle-bg border border-kindle-border rounded-2xl space-y-1.5">
                          <Mic className="w-4 h-4 text-kindle-accent" />
                          <h4 className="text-[11px] font-sans font-bold text-kindle-text">Neural Engine</h4>
                          <p className="text-[9px] text-kindle-text-muted leading-tight">
                            Natural intonation across languages.
                          </p>
                        </div>

                        <div className="p-3 bg-kindle-bg border border-kindle-border rounded-2xl space-y-1.5">
                          <Sliders className="w-4 h-4 text-amber-500" />
                          <h4 className="text-[11px] font-sans font-bold text-kindle-text">Pitch Tuning</h4>
                          <p className="text-[9px] text-kindle-text-muted leading-tight">
                            Adjust narration speed &amp; sentence jump.
                          </p>
                        </div>

                        <div className="p-3 bg-kindle-bg border border-kindle-border rounded-2xl space-y-1.5">
                          <Headphones className="w-4 h-4 text-emerald-500" />
                          <h4 className="text-[11px] font-sans font-bold text-kindle-text">Background Play</h4>
                          <p className="text-[9px] text-kindle-text-muted leading-tight">
                            Keep listening when screen is off.
                          </p>
                        </div>

                        <div className="p-3 bg-kindle-bg border border-kindle-border rounded-2xl space-y-1.5">
                          <FileText className="w-4 h-4 text-purple-500" />
                          <h4 className="text-[11px] font-sans font-bold text-kindle-text">Live Sync</h4>
                          <p className="text-[9px] text-kindle-text-muted leading-tight">
                            Sentences highlight in real-time.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </Reveal>
              </div>

            </div>

          </div>
        </div>

        {/* Kora Workshop: Interactive Tools & Games Section (Unified) */}
        <div id="workshop" className="pt-4 border-t border-kindle-border/60 scroll-mt-20 space-y-6">
          <Reveal>
            {/* Workshop Lounge Header Card */}
            <div className="bg-gradient-to-r from-amber-600 via-[#e0533c] to-amber-700 border border-amber-500/30 rounded-3xl p-6 sm:p-8 flex flex-col justify-center items-center text-center space-y-4 relative overflow-hidden group shadow-xl min-h-[160px]">
              <div className="absolute inset-0 bg-black/20 z-0" />
              <div className="absolute -top-12 -left-12 w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />
              <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-amber-300/20 rounded-full blur-2xl pointer-events-none" />
              <div className="relative z-10 space-y-3 flex flex-col items-center">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-white text-[10px] font-bold uppercase tracking-widest backdrop-blur-md border border-white/30 shadow-xs">
                  <Gamepad2 className="w-3.5 h-3.5 animate-pulse" /> Kora Workshop
                </div>
                <h3 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight">
                  Interactive Tools &amp; Games
                </h3>
                <p className="text-xs sm:text-sm text-white/95 font-medium leading-relaxed max-w-lg mx-auto">
                  Launch mini-games and reference tools directly in your browser! Sharpen your vocabulary, track board game scores, and build custom books.
                </p>
              </div>
            </div>
          </Reveal>

          {/* Grid of all 6 tools & games */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

            {/* Game 1: Linguist Guardian */}
            <div className="flex flex-col">
              <Reveal className="h-full">
                <div className="bg-kindle-card border border-kindle-border rounded-3xl p-5 space-y-4 flex flex-col justify-between hover:border-amber-500/30 hover:shadow-md transition-all shadow-xs h-full group">
                  <div className="space-y-2">
                    <div className="p-2.5 bg-amber-500/10 text-amber-600 rounded-xl w-fit">
                      <Swords className="w-5 h-5" />
                    </div>
                    <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-amber-600">Vocabulary Defense</span>
                    <h4 className="text-sm font-sans font-bold text-kindle-text">Linguist Guardian</h4>
                    <p className="text-xs text-kindle-text-muted leading-relaxed">
                      Defend the ancient archives from word corruption. Type spelling barriers to defeat approaching linguistic foes!
                    </p>
                  </div>

                  <div className="mt-2 w-full">
                    <LinguistGuardianDemo />
                  </div>
                </div>
              </Reveal>
            </div>

            {/* Game 2: Score Tracker */}
            <div className="flex flex-col">
              <Reveal className="h-full">
                <div className="bg-kindle-card border border-kindle-border rounded-3xl p-5 space-y-4 flex flex-col justify-between hover:border-[#e0533c]/30 hover:shadow-md transition-all shadow-xs h-full group">
                  <div className="space-y-2">
                    <div className="p-2.5 bg-[#e0533c]/10 text-[#e0533c] rounded-xl w-fit">
                      <Trophy className="w-5 h-5" />
                    </div>
                    <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-[#e0533c]">Board &amp; Card Games</span>
                    <h4 className="text-sm font-sans font-bold text-kindle-text">Game Score Tracker</h4>
                    <p className="text-xs text-kindle-text-muted leading-relaxed">
                      Track Catan, Scrabble, &amp; board game rounds with turn timers &amp; crowns.
                    </p>
                  </div>

                  <div className="mt-2 w-full">
                    <GameScoreTrackerDemo />
                  </div>
                </div>
              </Reveal>
            </div>

            {/* Game 3: Crossword Grid */}
            <div className="flex flex-col">
              <Reveal className="h-full">
                <div className="bg-kindle-card border border-kindle-border rounded-3xl p-5 space-y-4 flex flex-col justify-between hover:border-kindle-accent/30 hover:shadow-md transition-all shadow-xs h-full group">
                  <div className="space-y-2">
                    <div className="p-2.5 bg-kindle-accent/10 text-kindle-accent rounded-xl w-fit">
                      <Grid3X3 className="w-5 h-5" />
                    </div>
                    <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-kindle-accent">Literary Puzzles</span>
                    <h4 className="text-sm font-sans font-bold text-kindle-text">Crossword Grid</h4>
                    <p className="text-xs text-kindle-text-muted leading-relaxed">
                      Literary crosswords and letter-wheel wordscapes built from classic books.
                    </p>
                  </div>

                  <div className="mt-2 w-full">
                    <CrosswordSolvingDemo />
                  </div>
                </div>
              </Reveal>
            </div>

            {/* Game 4: Word Search Grid */}
            <div className="flex flex-col">
              <Reveal className="h-full">
                <div className="bg-kindle-card border border-kindle-border rounded-3xl p-5 space-y-4 flex flex-col justify-between hover:border-emerald-500/30 hover:shadow-md transition-all shadow-xs h-full group">
                  <div className="space-y-2">
                    <div className="p-2.5 bg-emerald-500/10 text-emerald-600 rounded-xl w-fit">
                      <Search className="w-5 h-5" />
                    </div>
                    <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-emerald-600">Vocabulary Finder</span>
                    <h4 className="text-sm font-sans font-bold text-kindle-text">Word Search Grid</h4>
                    <p className="text-xs text-kindle-text-muted leading-relaxed">
                      Multi-directional vocabulary search with hints &amp; difficulty progression.
                    </p>
                  </div>

                  <div className="mt-2 w-full">
                    <WordSearchGridDemo />
                  </div>
                </div>
              </Reveal>
            </div>

            {/* Game 5: Wikipedia Hub */}
            <div className="flex flex-col">
              <Reveal className="h-full">
                <div className="bg-kindle-card border border-kindle-border rounded-3xl p-5 space-y-4 flex flex-col justify-between hover:border-amber-500/30 hover:shadow-md transition-all shadow-xs h-full group">
                  <div className="space-y-2">
                    <div className="p-2.5 bg-amber-500/10 text-amber-600 rounded-xl w-fit">
                      <Globe className="w-5 h-5" />
                    </div>
                    <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-amber-600">Research &amp; Ebooks</span>
                    <h4 className="text-sm font-sans font-bold text-kindle-text">Wikipedia Hub</h4>
                    <p className="text-xs text-kindle-text-muted leading-relaxed">
                      Search articles &amp; convert topics into custom Kora Ebooks with audio TTS.
                    </p>
                  </div>

                  <div className="mt-2 w-full">
                    <WikipediaHubDemo />
                  </div>
                </div>
              </Reveal>
            </div>

            {/* Game 6: Searchable Dictionary */}
            <div className="flex flex-col">
              <Reveal className="h-full">
                <div className="bg-kindle-card border border-kindle-border rounded-3xl p-5 space-y-4 flex flex-col justify-between hover:border-sky-500/30 hover:shadow-md transition-all shadow-xs h-full group">
                  <div className="space-y-2">
                    <div className="p-2.5 bg-sky-500/10 text-sky-600 rounded-xl w-fit">
                      <BookA className="w-5 h-5" />
                    </div>
                    <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-sky-600">Reference &amp; Words</span>
                    <h4 className="text-sm font-sans font-bold text-kindle-text">Searchable Dictionary</h4>
                    <p className="text-xs text-kindle-text-muted leading-relaxed">
                      Look up any word instantly from Kora's offline dictionary with definitions.
                    </p>
                  </div>

                  <div className="mt-2 w-full">
                    <SearchableDictionaryDemo />
                  </div>
                </div>
              </Reveal>
            </div>

          </div>
        </div>


        {/* Section: Tabbed Step-by-Step Install & Run Guide */}
        <Reveal>
          <div id="guide" className="pt-8 border-t border-kindle-border/60 scroll-mt-20 space-y-8">
            <div className="text-center max-w-2xl mx-auto space-y-3">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-kindle-accent/10 text-kindle-accent text-[10px] font-bold uppercase tracking-widest chromatic-amber">
                <Download className="w-3.5 h-3.5" /> Easy Setup Guide
              </div>
              <h3 className="text-2xl sm:text-3xl font-serif font-bold text-kindle-text">
                Install &amp; Run Kora
              </h3>
              <p className="text-xs text-kindle-text-muted leading-relaxed">
                Four ways to run Kora — pick what fits your device. Everything is free, open source, and works fully offline.
              </p>

              {/* Platform Tab Selector Bar */}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                {[
                  { id: "web", label: "WEB / PWA", icon: Globe },
                  { id: "apk", label: "ANDROID APK", icon: Smartphone },
                  { id: "ios", label: "IPHONE / IPAD", icon: Smartphone },
                  { id: "self", label: "RUN YOUR OWN", icon: Server },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = installTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setInstallTab(tab.id as any)}
                      className={`px-4 py-2.5 rounded-xl border text-xs font-sans font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 ${
                        isActive
                          ? "bg-kindle-text text-kindle-bg border-kindle-text shadow-md scale-105"
                          : "bg-kindle-card border-kindle-border text-kindle-text-muted hover:border-kindle-accent/60 hover:text-kindle-text"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Directly Render 4 Step Cards for Selected Tab */}
            <motion.div
              key={installTab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
            >
              {steps.map((step) => (
                <div
                  key={step.number}
                  className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-3 flex flex-col justify-between hover:border-kindle-accent/40 transition shadow-xs group"
                >
                  <div className="space-y-2">
                    <span className="text-3xl font-serif font-extrabold text-kindle-accent/70 group-hover:text-kindle-accent transition">
                      {step.number}
                    </span>
                    <h4 className="text-xs font-sans font-bold text-kindle-text uppercase tracking-wider">
                      {step.title}
                    </h4>
                    <p className="text-xs text-kindle-text-muted leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </motion.div>

            {/* Direct Action Bar below steps for the active tab */}
            <div className="bg-kindle-card/60 border border-kindle-border rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2.5 text-kindle-text-muted">
                <Info className="w-4 h-4 text-kindle-accent shrink-0" />
                {installTab === "web" && <span>Runs in Chrome, Edge, Safari, Firefox with full local IndexedDB offline storage.</span>}
                {installTab === "apk" && <span>Android 8.0+ required. Includes background voice narration and lock screen audio controls.</span>}
                {installTab === "ios" && <span>Recommended path for iOS since direct .ipa requires paid Apple Developer credentials.</span>}
                {installTab === "self" && <span>Self-host on any static provider (Cloudflare Pages, Vercel, Netlify, Nginx).</span>}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {installTab === "web" && (
                  <a
                    href="/"
                    className="px-4 py-2 bg-kindle-accent text-kindle-bg font-bold text-xs uppercase tracking-wider rounded-xl hover:opacity-90 transition shadow-xs"
                  >
                    Launch Web App
                  </a>
                )}
                {installTab === "apk" && (
                  <>
                    <a
                      href={apk?.url || "https://github.com/CHAOTIC-RAY/Kora-/releases/latest"}
                      className="px-4 py-2 bg-kindle-text text-kindle-bg font-bold text-xs uppercase tracking-wider rounded-xl hover:opacity-90 transition shadow-xs flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" /> Download APK
                    </a>
                    <button
                      type="button"
                      onClick={() => setShowQrModal(true)}
                      className="px-3 py-2 border border-kindle-border bg-kindle-bg text-kindle-text font-bold text-xs uppercase tracking-wider rounded-xl hover:border-kindle-accent transition cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                {installTab === "ios" && (
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="px-4 py-2 bg-kindle-card border border-kindle-border text-kindle-text font-bold text-xs uppercase tracking-wider rounded-xl hover:border-kindle-accent transition cursor-pointer"
                  >
                    {copiedLink ? "Link Copied!" : "Share Link to iOS Safari"}
                  </button>
                )}
                {installTab === "self" && (
                  <a
                    href="https://github.com/CHAOTIC-RAY/Kora-"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 border border-kindle-border bg-kindle-card text-kindle-text font-bold text-xs uppercase tracking-wider rounded-xl hover:border-kindle-accent transition flex items-center gap-1.5"
                  >
                    <Github className="w-3.5 h-3.5" /> GitHub Repo
                  </a>
                )}
              </div>
            </div>
          </div>
        </Reveal>



        {/* Section 7: FAQ Accordion */}
        <motion.div
          ref={faqRef}
          id="faq"
          className="space-y-8 w-full max-w-5xl mx-auto pt-10 border-t border-kindle-border/60 scroll-mt-20"
        >
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-kindle-text">
              Frequently Asked Questions
            </h2>
            <p className="text-xs sm:text-sm text-kindle-text-muted leading-relaxed">
              Got questions about installation, voice features, or privacy? We have answers.
            </p>
          </div>

          <div className="space-y-3.5 text-left w-full">
            {faqs.map((faq, idx) => {
              const isOpen = expandedFaq === idx;
              return (
                <div
                  key={idx}
                  className="bg-kindle-card border border-kindle-border rounded-2xl overflow-hidden transition-all duration-200 shadow-xs hover:border-kindle-accent/40"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedFaq(isOpen ? null : idx)}
                    className="w-full px-5 sm:px-7 py-4 sm:py-4.5 text-left font-sans font-bold text-sm sm:text-base text-kindle-text flex items-center justify-between cursor-pointer hover:bg-kindle-bg/50 transition gap-4"
                  >
                    <span className="leading-snug">{faq.q}</span>
                    <ChevronDown className={`w-4 h-4 text-kindle-text-muted shrink-0 transform transition-transform duration-200 ${isOpen ? "rotate-180 text-kindle-accent" : "rotate-0"}`} />
                  </button>

                  {isOpen && (
                    <div className="px-5 sm:px-7 pb-5 text-xs sm:text-sm text-kindle-text-muted leading-relaxed border-t border-kindle-border/40 pt-4 bg-kindle-bg/30">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>

      </section>

      {/* Closing Notebook — full-bleed, smooth fill-the-screen reveal on last scroll */}
      <section ref={notebookRef} className="relative">
        <motion.div
          initial={{ opacity: 0, y: 80, scale: 0.9 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.9, ease: [0.34, 1.56, 0.64, 1] }}
          className="relative w-full min-h-screen flex flex-col justify-center bg-gradient-to-br from-kindle-card via-kindle-card to-kindle-bg overflow-hidden px-6 sm:px-12 py-20 text-center space-y-8"
        >
          {/* notebook ruled page lines */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(180deg, transparent, transparent 2.2rem, currentColor 2.2rem, currentColor calc(2.2rem + 1px))",
              color: "var(--theme-text)",
            }}
          />

          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 flex flex-col items-center justify-around py-8 opacity-40"
          >
            {Array.from({ length: 14 }).map((_, i) => (
              <span key={i} className="w-3 h-3 rounded-full border-2 border-kindle-border bg-kindle-bg" />
            ))}
          </div>
          <KoraWordmarkReveal>
            <div className="relative space-y-3 max-w-lg mx-auto">
              <p className="text-base font-sans font-bold uppercase tracking-[0.25em] text-kindle-accent">
                A Chaos Studio Project
              </p>
              <p className="text-sm text-kindle-text-muted leading-relaxed">
                Kora is built by <span className="font-bold text-kindle-text">Chaos Studio</span> — a free,
                open, offline-first reading companion for books, news, and knowledge.
                No ads. No trackers. Your library stays yours.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-2 text-[11px] text-kindle-text-muted">
                <span>Universal E-Ink Reader</span><span className="text-kindle-border">•</span>
                <span>Voice Narrator</span><span className="text-kindle-border">•</span>
                <span>Workshop Suite</span><span className="text-kindle-border">•</span>
                <span>Wikipedia Hub</span><span className="text-kindle-border">•</span>
                <span>P2P Library Share</span>
              </div>
            </div>
          </KoraWordmarkReveal>

          <div className="relative flex items-center justify-center gap-3 pt-2">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 px-5 py-3 rounded-xl bg-kindle-text text-kindle-bg text-[11px] font-sans font-bold uppercase tracking-wider hover:opacity-90 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Reader
            </a>
            <a
              href="https://github.com/CHAOTIC-RAY/Kora-"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-5 py-3 rounded-xl border border-kindle-border bg-kindle-card text-[11px] font-sans font-bold uppercase tracking-wider text-kindle-text hover:border-kindle-accent transition"
            >
              <Github className="w-3.5 h-3.5" /> Source
            </a>
          </div>
        </motion.div>
      </section>

      {/* QR Code Scan Modal */}
      <AnimatePresence>
        {showQrModal && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-kindle-bg border border-kindle-border rounded-3xl p-6 max-w-sm w-full text-center space-y-6 shadow-2xl relative"
            >
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="absolute top-4 right-4 p-1 text-kindle-text-muted hover:text-kindle-text cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-1">
                <h3 className="text-sm font-bold text-kindle-text">Scan on Mobile Device</h3>
                <p className="text-xs text-kindle-text-muted">Point your phone camera at this QR code to open the APK download portal on your phone.</p>
              </div>

              {/* Dynamic QR Code Render via Public API */}
              <div className="p-4 bg-white rounded-2xl border border-kindle-border w-fit mx-auto shadow-md">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(installUrl)}`}
                  alt="Kora Install Portal QR Code"
                  className="w-48 h-48 mx-auto"
                />
              </div>

              <button
                type="button"
                onClick={handleCopyLink}
                className="w-full py-2.5 bg-kindle-card border border-kindle-border rounded-xl text-xs font-bold text-kindle-text hover:border-kindle-accent transition cursor-pointer"
              >
                {copiedLink ? "Link Copied!" : "Copy Portal URL"}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </div>

      {/* Game & Workshop Interactive Demo Modals */}
      <GameScoreTracker open={showScoreTrackerDemo} onClose={() => setShowScoreTrackerDemo(false)} />
      <CrosswordGame open={showCrosswordDemo} onClose={() => setShowCrosswordDemo(false)} />
      <WordSearchGame open={showWordSearchDemo} onClose={() => setShowWordSearchDemo(false)} />
      <LinguistGuardian open={showLinguistGuardianDemo} onClose={() => setShowLinguistGuardianDemo(false)} />

      <AnimatePresence>
        {showWikipediaDemo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black flex flex-col w-full h-full"
          >
            <WikipediaWidget onClose={() => setShowWikipediaDemo(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDictionaryDemo && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl h-[80vh] bg-kindle-bg border border-kindle-border rounded-3xl overflow-hidden shadow-2xl"
            >
              <DictionaryWidget onClose={() => setShowDictionaryDemo(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
