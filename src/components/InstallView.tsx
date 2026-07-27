import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Download,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  ArrowLeft,
  BookOpen,
  Headphones,
  Radio,
  Gamepad2,
  ExternalLink,
  QrCode,
  Globe,
  ChevronDown,
  Zap,
  Copy,
  Check,
  X,
  Play,
  Volume2,
  Grid3X3,
  Search,
  Mic,
  Sliders,
  FileText,
  Compass,
  Palette,
  Crown,
  Cloud
} from "lucide-react";
import { fetchLatestApkDownloadUrl } from "../lib/apkUpdater";
import { KoraIcon, KoraWordmark } from "./KoraLogo";
import GameScoreTracker from "./GameScoreTracker";
import CrosswordGame from "./CrosswordGame";
import WordSearchGame from "./WordSearchGame";
import WikipediaWidget from "./WikipediaWidget";
import ThemeShowcase from "./ThemeShowcase";
import FeatureDemosGrid from "./FeatureDemosGrid";

export default function InstallView() {
  const [apk, setApk] = useState<{ url: string; versionName: string; size: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  
  // Modals
  const [showScoreTrackerDemo, setShowScoreTrackerDemo] = useState(false);
  const [showCrosswordDemo, setShowCrosswordDemo] = useState(false);
  const [showWordSearchDemo, setShowWordSearchDemo] = useState(false);
  const [showWikipediaDemo, setShowWikipediaDemo] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);

  useEffect(() => {
    let alive = true;
    fetchLatestApkDownloadUrl()
      .then((info) => {
        if (!alive) return;
        if (info) setApk(info);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
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
        });
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "24.5 MB";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-kindle-bg text-kindle-text font-sans antialiased selection:bg-kindle-accent/20 flex flex-col">
      {/* Premium Minimal Navigation */}
      <nav className="sticky top-0 z-40 bg-kindle-bg/90 backdrop-blur-xl border-b border-kindle-border">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-lg bg-kindle-text text-kindle-bg flex items-center justify-center transition-transform group-hover:scale-105">
              <KoraIcon className="w-4 h-4 fill-current" />
            </div>
            <KoraWordmark className="h-4 text-kindle-text" />
          </a>
          
          <div className="hidden md:flex items-center gap-8 text-[11px] font-bold uppercase tracking-[0.15em] text-kindle-text-muted">
            <button onClick={() => scrollToSection("features")} className="hover:text-kindle-text transition">Features</button>
            <button onClick={() => scrollToSection("workshop")} className="hover:text-kindle-text transition">Workshop</button>
            <button onClick={() => scrollToSection("faq")} className="hover:text-kindle-text transition">FAQ</button>
          </div>

          <a
            href="/"
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-widest hover:bg-opacity-90 transition shadow-sm"
          >
            <ArrowLeft className="w-3 h-3" /> Web Reader
          </a>
        </div>
      </nav>

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-12 md:py-24 space-y-32">
        {/* Huge Bold Hero Section */}
        <header className="flex flex-col md:flex-row items-center gap-12 md:gap-24">
          <div className="flex-1 space-y-8 text-center md:text-left">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-kindle-accent/10 text-kindle-accent border border-kindle-accent/20 text-[10px] font-bold uppercase tracking-[0.2em]"
            >
              <Zap className="w-3.5 h-3.5" /> Version 2.0 Now Available
            </motion.div>
            
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-5xl md:text-7xl lg:text-8xl font-serif font-bold text-kindle-text tracking-tighter leading-[0.95]"
            >
              Read deep. <br/> Listen far.
            </motion.h1>
            
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-base md:text-xl text-kindle-text-muted max-w-2xl font-medium leading-relaxed mx-auto md:mx-0"
            >
              The premium open-source E-Ink reader with native system voice narration, federated library discovery, and built-in cognitive lounge games. 100% offline.
            </motion.p>
          </div>

          {/* Download Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="w-full md:w-[400px] shrink-0 bg-kindle-card border border-kindle-border rounded-[2rem] p-8 shadow-2xl space-y-8"
          >
            <div className="space-y-2 text-center">
              <div className="w-12 h-12 bg-kindle-text text-kindle-bg rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Smartphone className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold font-serif text-kindle-text">Kora Android App</h3>
              <p className="text-xs text-kindle-text-muted font-mono uppercase tracking-wider">
                {loading ? "Fetching version..." : `v${apk?.versionName || "2.4.0"} • ${formatSize(apk?.size)}`}
              </p>
            </div>

            <div className="space-y-3">
              <a
                href={apk?.url || "https://github.com/CHAOTIC-RAY/Kora-/releases/latest"}
                className="w-full py-4 rounded-xl bg-kindle-text text-kindle-bg font-bold text-[11px] uppercase tracking-[0.2em] flex items-center justify-center gap-2 hover:bg-opacity-90 active:scale-[0.98] transition shadow-lg"
              >
                <Download className="w-4 h-4" /> Download APK
              </a>
              <button
                onClick={() => setShowQrModal(true)}
                className="w-full py-4 rounded-xl bg-transparent border-2 border-kindle-border text-kindle-text font-bold text-[11px] uppercase tracking-[0.2em] flex items-center justify-center gap-2 hover:border-kindle-accent hover:text-kindle-accent transition"
              >
                <QrCode className="w-4 h-4" /> Show QR Code
              </button>
            </div>

            <div className="pt-6 border-t border-kindle-border flex flex-col gap-3 text-[10px] font-bold text-kindle-text-muted uppercase tracking-wider text-center">
              <div className="flex items-center justify-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Play Protect Verified
              </div>
              <div className="flex items-center justify-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> 100% Offline & Private
              </div>
            </div>
          </motion.div>
        </header>

        {/* Bento Grid Layout for Features */}
        <section id="features" className="space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl md:text-5xl font-serif font-bold text-kindle-text tracking-tight">Core Pillars</h2>
            <p className="text-sm text-kindle-text-muted uppercase tracking-[0.2em] font-bold">Uncompromising Utility</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-[300px]">
            {/* E-Ink Block (Spans 2 cols) */}
            <div className="md:col-span-2 bg-kindle-card border border-kindle-border rounded-[2rem] p-8 md:p-12 flex flex-col justify-between group overflow-hidden relative">
              <div className="relative z-10 space-y-3 max-w-lg">
                <div className="w-10 h-10 rounded-xl bg-kindle-text text-kindle-bg flex items-center justify-center mb-6">
                  <Palette className="w-5 h-5" />
                </div>
                <h3 className="text-2xl font-serif font-bold text-kindle-text">E-Ink Display Engine</h3>
                <p className="text-sm text-kindle-text-muted leading-relaxed">
                  Five meticulously crafted reading themes including Solarized Amber and Sepia Warmth. Precise typographic control for total immersion.
                </p>
              </div>
              <div className="absolute right-0 bottom-0 opacity-10 group-hover:opacity-20 transition-opacity translate-x-1/4 translate-y-1/4">
                <BookOpen className="w-64 h-64 text-kindle-text" />
              </div>
            </div>

            {/* Voice Reader Block */}
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-[2rem] p-8 flex flex-col justify-between group">
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-black flex items-center justify-center mb-6">
                  <Volume2 className="w-5 h-5" />
                </div>
                <h3 className="text-2xl font-serif font-bold text-amber-600 dark:text-amber-400">Voice Narrator</h3>
                <p className="text-sm text-kindle-text-muted leading-relaxed">
                  System neural voices read your EPUBs aloud with live highlighting and background play.
                </p>
              </div>
            </div>

            {/* Cloud Sync Block */}
            <div className="bg-sky-500/5 border border-sky-500/20 rounded-[2rem] p-8 flex flex-col justify-between group">
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center mb-6">
                  <Cloud className="w-5 h-5" />
                </div>
                <h3 className="text-2xl font-serif font-bold text-sky-600 dark:text-sky-400">Cloud Sync</h3>
                <p className="text-sm text-kindle-text-muted leading-relaxed">
                  Sync progress and annotations across devices via Firebase, Drive, or WebDAV.
                </p>
              </div>
            </div>

            {/* Federated Block (Spans 2 cols) */}
            <div className="md:col-span-2 bg-emerald-500/5 border border-emerald-500/20 rounded-[2rem] p-8 md:p-12 flex flex-col justify-between group overflow-hidden relative">
              <div className="relative z-10 space-y-3 max-w-lg">
                <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center mb-6">
                  <Compass className="w-5 h-5" />
                </div>
                <h3 className="text-2xl font-serif font-bold text-emerald-600 dark:text-emerald-400">Federated Discovery</h3>
                <p className="text-sm text-kindle-text-muted leading-relaxed">
                  Search millions of public domain texts and academic papers directly from the app using Rave Engine and Anna's Archive integration.
                </p>
              </div>
              <div className="absolute right-0 bottom-0 opacity-10 group-hover:opacity-20 transition-opacity translate-x-1/4 translate-y-1/4">
                <Globe className="w-64 h-64 text-emerald-500" />
              </div>
            </div>
          </div>
        </section>

        {/* Feature Component Showcases (The actual UI widgets from the app) */}
        <section className="space-y-12">
           <div className="text-center space-y-4">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-kindle-text tracking-tight">Experience Kora</h2>
            <p className="text-sm text-kindle-text-muted uppercase tracking-[0.2em] font-bold">Live Components</p>
          </div>
          <FeatureDemosGrid />
          <ThemeShowcase />
        </section>

        {/* Workshop Games Section */}
        <section id="workshop" className="space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl md:text-5xl font-serif font-bold text-kindle-text tracking-tight">Workshop Lounge</h2>
            <p className="text-sm text-kindle-text-muted uppercase tracking-[0.2em] font-bold">Interactive Cognitive Tools</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-kindle-card border border-kindle-border rounded-3xl p-6 flex flex-col justify-between h-64">
              <div className="space-y-3">
                <Crown className="w-6 h-6 text-kindle-text" />
                <h4 className="font-bold text-kindle-text">Score Tracker</h4>
                <p className="text-xs text-kindle-text-muted">Track board game scores with turn timers.</p>
              </div>
              <button onClick={() => setShowScoreTrackerDemo(true)} className="w-full py-3 bg-kindle-text text-kindle-bg text-xs font-bold uppercase tracking-wider rounded-xl">Play Now</button>
            </div>
            
            <div className="bg-kindle-card border border-kindle-border rounded-3xl p-6 flex flex-col justify-between h-64">
              <div className="space-y-3">
                <Grid3X3 className="w-6 h-6 text-kindle-text" />
                <h4 className="font-bold text-kindle-text">Crosswords</h4>
                <p className="text-xs text-kindle-text-muted">Literary crosswords from your books.</p>
              </div>
              <button onClick={() => setShowCrosswordDemo(true)} className="w-full py-3 bg-kindle-text text-kindle-bg text-xs font-bold uppercase tracking-wider rounded-xl">Play Now</button>
            </div>

            <div className="bg-kindle-card border border-kindle-border rounded-3xl p-6 flex flex-col justify-between h-64">
              <div className="space-y-3">
                <Search className="w-6 h-6 text-emerald-500" />
                <h4 className="font-bold text-kindle-text">Word Search</h4>
                <p className="text-xs text-kindle-text-muted">Multi-directional vocabulary grids.</p>
              </div>
              <button onClick={() => setShowWordSearchDemo(true)} className="w-full py-3 bg-emerald-600 text-white text-xs font-bold uppercase tracking-wider rounded-xl">Play Now</button>
            </div>

            <div className="bg-kindle-card border border-kindle-border rounded-3xl p-6 flex flex-col justify-between h-64">
              <div className="space-y-3">
                <Globe className="w-6 h-6 text-amber-500" />
                <h4 className="font-bold text-kindle-text">Wikipedia Hub</h4>
                <p className="text-xs text-kindle-text-muted">Search and save articles as Ebooks.</p>
              </div>
              <button onClick={() => setShowWikipediaDemo(true)} className="w-full py-3 bg-amber-600 text-white text-xs font-bold uppercase tracking-wider rounded-xl">Open Hub</button>
            </div>
          </div>
        </section>
        
        {/* PWA & FAQ */}
        <section id="faq" className="grid grid-cols-1 lg:grid-cols-2 gap-16 pt-12 border-t border-kindle-border">
          <div className="space-y-8">
            <h2 className="text-3xl font-serif font-bold text-kindle-text">Web & PWA Setup</h2>
            <div className="bg-kindle-card border border-kindle-border rounded-3xl p-8 space-y-6">
              <div className="space-y-4">
                <h3 className="font-bold text-kindle-text uppercase tracking-widest text-[11px]">iOS Safari</h3>
                <ol className="list-decimal list-inside text-sm text-kindle-text-muted space-y-2">
                  <li>Open <span className="text-kindle-text">{displayHost}</span> in Safari.</li>
                  <li>Tap the Share button (square with arrow).</li>
                  <li>Select 'Add to Home Screen'.</li>
                </ol>
              </div>
              <div className="pt-6 border-t border-kindle-border space-y-4">
                <h3 className="font-bold text-kindle-text uppercase tracking-widest text-[11px]">Desktop & Chrome</h3>
                <ol className="list-decimal list-inside text-sm text-kindle-text-muted space-y-2">
                  <li>Click the install icon in the URL bar.</li>
                  <li>Launch as a standalone desktop app.</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="space-y-8">
            <h2 className="text-3xl font-serif font-bold text-kindle-text">FAQ</h2>
            <div className="space-y-4">
              {[
                { q: "Is Kora free?", a: "Yes, 100% free and open-source." },
                { q: "Do I need the Android APK?", a: "The APK unlocks background audio narration and native notifications. The web app provides everything else." },
                { q: "Where is my data stored?", a: "Everything is stored locally on your device by default (Offline-First). Cloud sync is entirely optional." }
              ].map((faq, i) => (
                <div key={i} className="bg-kindle-card border border-kindle-border rounded-2xl p-6 cursor-pointer" onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}>
                  <div className="flex justify-between items-center font-bold text-sm text-kindle-text">
                    {faq.q}
                    <ChevronDown className={`w-4 h-4 transition ${expandedFaq === i ? "rotate-180" : ""}`} />
                  </div>
                  {expandedFaq === i && <p className="text-sm text-kindle-text-muted mt-4">{faq.a}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-kindle-border py-12 text-center text-xs font-bold uppercase tracking-[0.2em] text-kindle-text-muted mt-auto">
        Kora Reader © {new Date().getFullYear()} • Open Source E-Ink Suite
      </footer>

      {/* Modals */}
      <AnimatePresence>
        {showQrModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-kindle-bg border border-kindle-border rounded-[2rem] p-8 max-w-sm w-full text-center space-y-6">
              <button onClick={() => setShowQrModal(false)} className="absolute top-6 right-6 text-kindle-text-muted hover:text-kindle-text">
                <X className="w-5 h-5" />
              </button>
              <h3 className="font-bold text-kindle-text">Scan to Install</h3>
              <div className="bg-white p-4 rounded-2xl mx-auto w-fit">
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(installUrl)}`} alt="QR" className="w-48 h-48" />
              </div>
              <button onClick={handleCopyLink} className="w-full py-3 bg-kindle-card border border-kindle-border font-bold text-[11px] uppercase tracking-wider rounded-xl hover:border-kindle-accent">
                {copiedLink ? "Copied!" : "Copy Link"}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <GameScoreTracker open={showScoreTrackerDemo} onClose={() => setShowScoreTrackerDemo(false)} />
      <CrosswordGame open={showCrosswordDemo} onClose={() => setShowCrosswordDemo(false)} />
      <WordSearchGame open={showWordSearchDemo} onClose={() => setShowWordSearchDemo(false)} />
      <AnimatePresence>
        {showWikipediaDemo && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-5xl">
              <WikipediaWidget onClose={() => setShowWikipediaDemo(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
