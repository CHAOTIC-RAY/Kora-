import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Download,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  ArrowLeft,
  HelpCircle,
  Info,
  BookOpen,
  Headphones,
  Radio,
  Gamepad2,
  ExternalLink,
  Flame,
  Swords,
  Trophy,
  Share2,
  QrCode,
  Globe,
  ChevronDown,
  Layers,
  Zap,
  Sparkles,
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
  Crown
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
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeTab, setActiveTab] = useState<"apk" | "themes" | "audio" | "workshop" | "pwa" | "guide" | "faq">("apk");
  const [showQrModal, setShowQrModal] = useState(false);
  
  // Game & Workshop Demo Modals State
  const [showScoreTrackerDemo, setShowScoreTrackerDemo] = useState(false);
  const [showCrosswordDemo, setShowCrosswordDemo] = useState(false);
  const [showWordSearchDemo, setShowWordSearchDemo] = useState(false);
  const [showWikipediaDemo, setShowWikipediaDemo] = useState(false);

  // Unified Experience Section Pillar State
  const [experiencePillar, setExperiencePillar] = useState<"library" | "themes" | "cloud" | "voice" | "catalog" | "workshop">("library");
  const [isVoiceSpeaking, setIsVoiceSpeaking] = useState(false);
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [catalogQuery, setCatalogQuery] = useState("");
  
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);

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

  const steps = [
    {
      number: "01",
      title: "Get Official Package",
      description: "Click 'Download APK' to fetch the signed Kora Android installation package directly from our release vault."
    },
    {
      number: "02",
      title: "Allow Unknown Sources",
      description: "If prompted by Android (Chrome or Files app), tap 'Settings' and enable 'Allow from this source'."
    },
    {
      number: "03",
      title: "Run Package Installer",
      description: "Tap the downloaded file in your browser's Downloads manager or notification drawer and press 'Install'."
    },
    {
      number: "04",
      title: "Step Into Kora Lounge",
      description: "Launch Kora from your home screen. Enjoy full offline reading, voice narrator audiobooks, and workshop games."
    }
  ];

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
      q: "Is Kora completely free and open source?",
      a: "Yes! Kora is 100% free, ad-free, and open source. There are no paywalls, hidden tracking scripts, or subscriptions."
    },
    {
      q: "How does the Voice Narrator / Text-to-Speech Audiobook feature work?",
      a: "Kora parses book chapters directly on your device and uses high-fidelity neural system voices to read aloud. You can customize speech rate, pitch, background play, and follow along with synchronized sentence tracking."
    },
    {
      q: "Why install the Android APK instead of using the web app?",
      a: "The native Android APK unlocks system-level background audio playback for voice audiobooks, native notification media controls, full device file system access, and instant offline P2P beam transfer."
    },
    {
      q: "Is installing an APK safe on my phone?",
      a: "Yes. Kora APKs are signed, clean, virus-scanned, and fully Play Protect compliant. You can inspect the source code on GitHub at any time."
    },
    {
      q: "What games are included in Kora's Workshop?",
      a: "Kora includes three lounge companions: 1) Board & Card Game Score Tracker (with Competition Mode, turn clocks, & tournament brackets), 2) Literary Crossword Grid & Wordscape Wheel, and 3) Word Search Grid Finder."
    }
  ];

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="min-h-screen bg-kindle-bg text-kindle-text font-sans antialiased selection:bg-kindle-accent/20">
      {/* Top Site Navigation Header */}
      <nav className="sticky top-0 z-40 bg-kindle-bg/95 backdrop-blur border-b border-kindle-border">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-kindle-card border border-kindle-border flex items-center justify-center group-hover:border-kindle-accent transition shadow-xs">
              <KoraIcon className="w-5 h-5 text-kindle-text" />
            </div>
            <KoraWordmark className="h-4 text-kindle-text" />
          </a>

          {/* Smooth Scroll Navigation Links */}
          <div className="hidden lg:flex items-center gap-5 text-xs font-bold uppercase tracking-wider text-kindle-text-muted">
            <button
              type="button"
              onClick={() => scrollToSection("download-card")}
              className="hover:text-kindle-text transition cursor-pointer py-1"
            >
              APK Download
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("capabilities")}
              className="hover:text-kindle-text transition cursor-pointer py-1"
            >
              Capabilities
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("themes")}
              className="hover:text-kindle-text transition cursor-pointer py-1 flex items-center gap-1 text-kindle-accent font-extrabold"
            >
              <Palette className="w-3.5 h-3.5" /> Reading Themes
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("audio")}
              className="hover:text-kindle-text transition cursor-pointer py-1 flex items-center gap-1"
            >
              <Volume2 className="w-3.5 h-3.5" /> Voice Reader
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("workshop")}
              className="hover:text-kindle-text transition cursor-pointer py-1 flex items-center gap-1 text-[#e0533c]"
            >
              <Gamepad2 className="w-3.5 h-3.5" /> Workshop
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("pwa")}
              className="hover:text-kindle-text transition cursor-pointer py-1"
            >
              PWA Web
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("guide")}
              className="hover:text-kindle-text transition cursor-pointer py-1"
            >
              Guide
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("faq")}
              className="hover:text-kindle-text transition cursor-pointer py-1"
            >
              FAQ
            </button>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-kindle-card border border-kindle-border text-xs font-bold text-kindle-text hover:border-kindle-accent transition cursor-pointer shadow-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Web Reader
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="max-w-5xl mx-auto px-6 pt-10 pb-12 text-center space-y-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="mx-auto w-20 h-20 bg-kindle-card border-2 border-kindle-border/80 rounded-3xl flex items-center justify-center shadow-xl hover:border-kindle-accent/50 transition-colors"
        >
          <KoraIcon className="w-10 h-10 text-kindle-text" />
        </motion.div>

        <div className="space-y-4 max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-kindle-accent/10 border border-kindle-accent/25 text-[10px] font-bold uppercase tracking-widest text-kindle-accent"
          >
            <Zap className="w-3 h-3" /> E-Ink Reader • Voice Narrator • Workshop Games
            <span>•</span>
            <button
              type="button"
              onClick={() => setActiveTab("themes")}
              className="inline-flex items-center gap-1 text-kindle-accent font-extrabold hover:underline cursor-pointer"
            >
              <Palette className="w-3 h-3" /> Auto Reading Themes
            </button>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-4xl sm:text-5xl font-serif font-bold text-kindle-text tracking-tight leading-[1.1]"
          >
            Read Without Boundaries. <br className="hidden sm:inline" />
            Listen Anywhere.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base sm:text-lg text-kindle-text-muted leading-relaxed max-w-2xl mx-auto font-medium"
          >
            The open E-Ink digital reader with integrated text-to-speech voice narration, federated open-book discovery, and a lounge games suite.
          </motion.p>
        </div>

        {/* Official Download Vault Card */}
        <motion.div
          id="download-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="max-w-2xl mx-auto bg-kindle-card border border-kindle-border rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden"
        >
          <div className="flex flex-col items-center justify-center text-center gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-accent flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5" /> Official Android Release Vault
            </span>
            <h3 className="text-sm font-bold text-kindle-text">Direct Android Package (.APK)</h3>
          </div>

          <div className="p-1.5 border border-kindle-border rounded-2xl bg-kindle-bg/60">
            {loading ? (
              <div className="py-6 flex flex-col items-center justify-center gap-2">
                <div className="w-5 h-5 border-2 border-kindle-accent border-t-transparent rounded-full animate-spin" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Fetching release info...</p>
              </div>
            ) : (
              <div className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-left space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-kindle-text">Kora Android App</span>
                    <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-kindle-accent/10 text-kindle-accent border border-kindle-accent/20">
                      v{apk?.versionName || "2.4.0"}
                    </span>
                  </div>
                  <p className="text-[10px] text-kindle-text-muted font-mono uppercase">
                    Size: {formatSize(apk?.size)} • Android 8.0+ Compliant
                  </p>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <a
                    href={apk?.url || "https://github.com/CHAOTIC-RAY/Kora-/releases/latest"}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-kindle-text text-kindle-bg font-bold text-xs uppercase tracking-wider hover:bg-opacity-90 active:scale-98 transition shadow-lg shrink-0 cursor-pointer"
                  >
                    <Download className="w-4 h-4" /> Download APK
                  </a>

                  <button
                    type="button"
                    onClick={() => setShowQrModal(true)}
                    className="p-3.5 bg-kindle-bg border border-kindle-border rounded-xl text-kindle-text hover:border-kindle-accent transition cursor-pointer"
                    title="Generate Mobile Scan QR Code"
                  >
                    <QrCode className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[10px] text-kindle-text-muted font-medium border-t border-kindle-border/60 pt-4">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Virus Total Scanned
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-kindle-accent" /> Play Protect Compliant
            </span>
            <span>•</span>
            <button
              type="button"
              onClick={handleCopyLink}
              className="text-kindle-accent hover:underline flex items-center gap-1 cursor-pointer"
            >
              {copiedLink ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              {copiedLink ? "Portal Link Copied!" : "Copy Link"}
            </button>
          </div>
        </motion.div>
      </header>

      {/* Main Continuous Feature Sections - Scroll Site with Each Feature One by One */}
      <section className="max-w-5xl mx-auto px-6 pb-20 space-y-16">

        {/* Section 1: Ebook & Reader Engine */}
        <div id="ebooks" className="pt-8 border-t border-kindle-border/60 scroll-mt-20 space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-kindle-accent/10 border border-kindle-accent/20 text-kindle-accent text-[10px] font-bold uppercase tracking-widest">
              <BookOpen className="w-3.5 h-3.5" /> Core Ebook Engine
            </div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-kindle-text">
              Distraction-Free E-Ink Reading & Library Catalog
            </h2>
            <p className="text-xs text-kindle-text-muted leading-relaxed">
              Organize your collection with instant search, format tags, custom shelves, and seamless Grid or List layout toggles. Enjoy smooth EPUB and PDF pagination with zero friction.
            </p>
          </div>
          <FeatureDemosGrid />
        </div>

        {/* Section 2: Reading Themes & Daylight E-Ink Canvas */}
        <div id="themes" className="pt-8 border-t border-kindle-border/60 scroll-mt-20 space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase tracking-widest">
              <Palette className="w-3.5 h-3.5" /> Daylight & E-Ink Aesthetics
            </div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-kindle-text">
              Custom Paper Tints & Typographic Pairings
            </h2>
            <p className="text-xs text-kindle-text-muted leading-relaxed">
              Switch between 5 handcrafted reading themes including Sepia Warmth, E-Ink Paper, Midnight Obsidian, and Solarized Amber. Adjust line height, margins, and font families for optimal focus.
            </p>
          </div>
          <ThemeShowcase />
        </div>

        {/* Section 3: Multi-Destination Cloud Sync */}
        <div id="cloud" className="pt-8 border-t border-kindle-border/60 scroll-mt-20 space-y-8">
          <div className="bg-kindle-card border border-kindle-border rounded-3xl p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-kindle-border/60 pb-6">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-500 uppercase tracking-wider">
                  <Zap className="w-4 h-4" /> Multi-Destination Cloud Sync
                </div>
                <h3 className="text-xl font-serif font-bold text-kindle-text">
                  Instant Progress & Annotations Sync
                </h3>
                <p className="text-xs text-kindle-text-muted max-w-xl">
                  Seamlessly sync bookmarks, reading progress percentages, and highlight notes across Android, Web, and desktop via Google Firestore or WebDAV.
                </p>
              </div>
            </div>

            {/* Cloud Target Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 bg-kindle-bg border border-kindle-border rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-kindle-text">Firebase Firestore</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>
                <p className="text-[10px] text-kindle-text-muted">Real-time sync across devices with zero setup required.</p>
              </div>
              <div className="p-4 bg-kindle-bg border border-kindle-border rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-kindle-text">Google Drive Backup</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>
                <p className="text-[10px] text-kindle-text-muted">Backup full EPUB library files to private Google Drive space.</p>
              </div>
              <div className="p-4 bg-kindle-bg border border-kindle-border rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-kindle-text">WebDAV / Nextcloud</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>
                <p className="text-[10px] text-kindle-text-muted">Self-hosted WebDAV sync protocol for complete data ownership.</p>
              </div>
              <div className="p-4 bg-kindle-bg border border-kindle-border rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-kindle-text">Local IndexedDB</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>
                <p className="text-[10px] text-kindle-text-muted">100% offline access when no network connection is present.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Voice Narrator Audiobooks */}
        <div id="voice" className="pt-8 border-t border-kindle-border/60 scroll-mt-20 space-y-8">
          <div className="bg-kindle-card border border-kindle-border rounded-3xl p-6 sm:p-8 space-y-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 border-b border-kindle-border pb-6">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-kindle-accent/10 text-kindle-accent text-[10px] font-bold uppercase tracking-widest">
                  <Volume2 className="w-3.5 h-3.5" /> High-Fidelity Voice Synthesis
                </div>
                <h3 className="text-xl sm:text-2xl font-serif font-bold text-kindle-text">
                  Text-to-Audiobook Voice Narrator
                </h3>
                <p className="text-xs text-kindle-text-muted max-w-xl leading-relaxed">
                  Convert any EPUB book or document into an immersive audio narration. Listen on the go with custom speed controls, system neural voices, and background audio playback.
                </p>
              </div>

              <a
                href="/"
                className="px-6 py-3.5 bg-kindle-accent text-white font-bold text-xs uppercase tracking-wider rounded-2xl hover:bg-opacity-90 transition shadow-lg cursor-pointer flex items-center gap-2 shrink-0"
              >
                <Headphones className="w-4 h-4" /> Try Voice Reader in App
              </a>
            </div>

            {/* Audiobook Features Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 bg-kindle-bg border border-kindle-border rounded-2xl space-y-2">
                <Mic className="w-5 h-5 text-kindle-accent" />
                <h4 className="text-xs font-bold text-kindle-text">Neural Speech Engine</h4>
                <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                  Natural intonation with full support for system neural text-to-speech voices across languages.
                </p>
              </div>

              <div className="p-4 bg-kindle-bg border border-kindle-border rounded-2xl space-y-2">
                <Sliders className="w-5 h-5 text-amber-500" />
                <h4 className="text-xs font-bold text-kindle-text">Speed & Pitch Tuning</h4>
                <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                  Adjust narration speed from 0.5x to 3.0x with pitch adjustment and sentence jump controls.
                </p>
              </div>

              <div className="p-4 bg-kindle-bg border border-kindle-border rounded-2xl space-y-2">
                <Headphones className="w-5 h-5 text-emerald-500" />
                <h4 className="text-xs font-bold text-kindle-text">Background Audio</h4>
                <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                  Keep listening when your screen turns off or while using other applications on Android.
                </p>
              </div>

              <div className="p-4 bg-kindle-bg border border-kindle-border rounded-2xl space-y-2">
                <FileText className="w-5 h-5 text-purple-500" />
                <h4 className="text-xs font-bold text-kindle-text">Live Sync Highlighting</h4>
                <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                  Follow along visually as sentences highlight in real-time on your E-Ink reading canvas.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 5: Open Catalog & Mirror Discovery */}
        <div id="catalog" className="pt-8 border-t border-kindle-border/60 scroll-mt-20 space-y-8">
          <div className="bg-kindle-card border border-kindle-border rounded-3xl p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-kindle-border/60 pb-6">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-500 uppercase tracking-wider">
                  <Search className="w-4 h-4" /> Open Search & Mirror Discovery
                </div>
                <h3 className="text-xl font-serif font-bold text-kindle-text">
                  Rave Engine, LibGen & Anna's Archive Search
                </h3>
                <p className="text-xs text-kindle-text-muted max-w-xl">
                  Search millions of open-source ebooks, public domain literature, and academic texts across public library mirrors.
                </p>
              </div>
            </div>

            {/* Search Input Simulator */}
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-kindle-text-muted absolute left-3 top-3" />
                  <input
                    type="text"
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    placeholder="Try searching author or title (e.g. 'Jane Austen', 'Dune', 'Sherlock')..."
                    className="w-full bg-kindle-bg border border-kindle-border rounded-xl pl-9 pr-4 py-2.5 text-xs text-kindle-text focus:outline-none focus:border-kindle-accent"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setCatalogQuery("Mary Shelley Frankenstein")}
                  className="px-4 py-2.5 bg-kindle-accent text-white font-bold text-xs rounded-xl hover:bg-opacity-90 transition cursor-pointer"
                >
                  Sample Search
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-kindle-bg border border-kindle-border rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-sky-500 uppercase tracking-wider">Rave Engine</span>
                  <p className="font-bold text-kindle-text">Frankenstein (1818)</p>
                  <p className="text-[10px] text-kindle-text-muted">EPUB • 420 KB • Clean Formatting</p>
                </div>
                <div className="p-3 bg-kindle-bg border border-kindle-border rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">LibGen Mirror</span>
                  <p className="font-bold text-kindle-text">Pride and Prejudice</p>
                  <p className="text-[10px] text-kindle-text-muted">PDF • 1.2 MB • Original Typeface</p>
                </div>
                <div className="p-3 bg-kindle-bg border border-kindle-border rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-purple-500 uppercase tracking-wider">Anna's Archive</span>
                  <p className="font-bold text-kindle-text">The Time Machine</p>
                  <p className="text-[10px] text-kindle-text-muted">EPUB • 380 KB • Illustrated Edition</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 6: Workshop Lounge & Interactive Games */}
        <div id="workshop" className="pt-8 border-t border-kindle-border/60 scroll-mt-20 space-y-8">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#e0533c]/10 text-[#e0533c] text-[10px] font-bold uppercase tracking-widest">
              <Gamepad2 className="w-3.5 h-3.5" /> Kora Workshop Lounge
            </div>
            <h3 className="text-2xl font-serif font-bold text-kindle-text">
              Interactive Tools & Games Suite
            </h3>
            <p className="text-xs text-kindle-text-muted leading-relaxed">
              Launch interactive game demos and research tools directly in your browser!
            </p>
          </div>

          {/* Game Demos Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Game 1: Score Tracker */}
            <div className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4 flex flex-col justify-between hover:border-kindle-accent/50 transition-all shadow-xs">
              <div className="space-y-2">
                <div className="p-2.5 bg-kindle-accent/10 text-kindle-accent rounded-xl w-fit">
                  <Crown className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-kindle-text">Game Score Tracker</h4>
                <p className="text-xs text-kindle-text-muted leading-relaxed">
                  Track Catan, Scrabble, & board game rounds with turn timers & crowns.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowScoreTrackerDemo(true)}
                className="w-full py-2.5 bg-kindle-accent text-white font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-opacity-90 transition shadow-md cursor-pointer flex items-center justify-center gap-2"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Open Tool
              </button>
            </div>

            {/* Game 2: Crossword Grid */}
            <div className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4 flex flex-col justify-between hover:border-kindle-accent/50 transition-all shadow-xs">
              <div className="space-y-2">
                <div className="p-2.5 bg-kindle-accent/10 text-kindle-accent rounded-xl w-fit">
                  <Grid3X3 className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-kindle-text">Mini Crossword Grid</h4>
                <p className="text-xs text-kindle-text-muted leading-relaxed">
                  Literary crosswords and letter-wheel wordscapes built from classic books.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowCrosswordDemo(true)}
                className="w-full py-2.5 bg-kindle-accent text-white font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-opacity-90 transition shadow-md cursor-pointer flex items-center justify-center gap-2"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Open Tool
              </button>
            </div>

            {/* Game 3: Word Search */}
            <div className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4 flex flex-col justify-between hover:border-emerald-500/50 transition-all shadow-xs">
              <div className="space-y-2">
                <div className="p-2.5 bg-emerald-500/10 text-emerald-600 rounded-xl w-fit">
                  <Search className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-kindle-text">Word Search Grid</h4>
                <p className="text-xs text-kindle-text-muted leading-relaxed">
                  Multi-directional vocabulary search with hints & difficulty progression.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowWordSearchDemo(true)}
                className="w-full py-2.5 bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-opacity-90 transition shadow-md cursor-pointer flex items-center justify-center gap-2"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Open Tool
              </button>
            </div>

            {/* Workshop Tool 4: Wikipedia Hub */}
            <div className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4 flex flex-col justify-between hover:border-amber-500/50 transition-all shadow-xs">
              <div className="space-y-2">
                <div className="p-2.5 bg-amber-500/10 text-amber-600 rounded-xl w-fit">
                  <Globe className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-kindle-text">Wikipedia Hub</h4>
                <p className="text-xs text-kindle-text-muted leading-relaxed">
                  Search articles & convert topics into custom Kora Ebooks with audio TTS.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowWikipediaDemo(true)}
                className="w-full py-2.5 bg-amber-600 text-white font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-opacity-90 transition shadow-md cursor-pointer flex items-center justify-center gap-2"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Open Tool
              </button>
            </div>
          </div>
        </div>

        {/* Section 5: Progressive Web App (PWA) Guide */}
        <div id="pwa" className="space-y-8 pt-8 border-t border-kindle-border/60 scroll-mt-20">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <h2 className="text-2xl font-serif font-bold text-kindle-text">
              Progressive Web App (PWA) Mode
            </h2>
            <p className="text-xs text-kindle-text-muted leading-relaxed">
              Install Kora on iOS, Windows, macOS, or ChromeOS directly from your browser.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-kindle-card border border-kindle-border rounded-2xl p-6 space-y-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-accent">Chrome / Edge / Android Web</span>
              <h3 className="text-sm font-bold text-kindle-text">Desktop & Android Web Setup</h3>
              <ol className="space-y-2 text-xs text-kindle-text-muted list-decimal list-inside leading-relaxed">
                <li>Open <span className="font-mono text-kindle-text font-bold">{displayHost}</span> in Chrome or Edge.</li>
                <li>Click the installation icon in your address bar or tap the three dots menu.</li>
                <li>Select <span className="font-bold text-kindle-text">'Install Kora Reader'</span> or 'Add to Home Screen'.</li>
                <li>Launch directly from your desktop or app launcher with full offline storage.</li>
              </ol>
            </div>

            <div className="bg-kindle-card border border-kindle-border rounded-2xl p-6 space-y-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-accent">iOS Safari (iPhone / iPad)</span>
              <h3 className="text-sm font-bold text-kindle-text">Apple iOS Setup</h3>
              <ol className="space-y-2 text-xs text-kindle-text-muted list-decimal list-inside leading-relaxed">
                <li>Open <span className="font-mono text-kindle-text font-bold">{displayHost}</span> in Safari.</li>
                <li>Tap the <span className="font-bold text-kindle-text">Share button</span> (square with arrow) at the bottom toolbar.</li>
                <li>Scroll down and tap <span className="font-bold text-kindle-text">'Add to Home Screen'</span>.</li>
                <li>Tap 'Add' in the top right to create a standalone full-screen web app icon.</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Section 6: Step-by-Step Installation Guide */}
        <div id="guide" className="space-y-8 pt-8 border-t border-kindle-border/60 scroll-mt-20">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <h2 className="text-2xl font-serif font-bold text-kindle-text">
              Step-by-Step Setup Guide
            </h2>
            <p className="text-xs text-kindle-text-muted leading-relaxed">
              Installing Kora directly via APK takes less than a minute. Follow these simple steps:
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((st, idx) => (
              <div
                key={idx}
                className="bg-kindle-card border border-kindle-border rounded-2xl p-6 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <span className="block font-mono text-3xl font-bold text-kindle-accent/30">{st.number}</span>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text">{st.title}</h4>
                  <p className="text-xs text-kindle-text-muted leading-relaxed">{st.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 7: FAQ Accordion */}
        <div id="faq" className="space-y-6 max-w-3xl mx-auto pt-8 border-t border-kindle-border/60 scroll-mt-20">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-serif font-bold text-kindle-text">
              Frequently Asked Questions
            </h2>
            <p className="text-xs text-kindle-text-muted">
              Got questions about installation, voice features, or privacy? We have answers.
            </p>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, idx) => {
              const isOpen = expandedFaq === idx;
              return (
                <div
                  key={idx}
                  className="bg-kindle-card border border-kindle-border rounded-2xl overflow-hidden transition"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedFaq(isOpen ? null : idx)}
                    className="w-full px-6 py-4 text-left font-bold text-xs text-kindle-text flex items-center justify-between cursor-pointer hover:bg-kindle-bg/50 transition"
                  >
                    <span>{faq.q}</span>
                    <ChevronDown className={`w-4 h-4 text-kindle-text-muted transform transition ${isOpen ? "rotate-180" : "rotate-0"}`} />
                  </button>

                  {isOpen && (
                    <div className="px-6 pb-4 text-xs text-kindle-text-muted leading-relaxed border-t border-kindle-border/40 pt-3">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
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

      {/* Game & Workshop Interactive Demo Modals */}
      <GameScoreTracker open={showScoreTrackerDemo} onClose={() => setShowScoreTrackerDemo(false)} />
      <CrosswordGame open={showCrosswordDemo} onClose={() => setShowCrosswordDemo(false)} />
      <WordSearchGame open={showWordSearchDemo} onClose={() => setShowWordSearchDemo(false)} />

      <AnimatePresence>
        {showWikipediaDemo && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-5xl"
            >
              <WikipediaWidget onClose={() => setShowWikipediaDemo(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="border-t border-kindle-border/40 py-12 text-center text-xs text-kindle-text-muted">
        <div className="max-w-2xl mx-auto px-6 space-y-4">
          <div className="flex items-center justify-center gap-2">
            <KoraIcon className="w-5 h-5 text-kindle-text" />
            <KoraWordmark className="h-3 text-kindle-text" />
          </div>
          <p>© 2026 Kora • Universal E-Ink Reader, Voice Narrator, & Workshop Suite.</p>
          <div className="flex flex-wrap justify-center gap-4 text-[11px]">
            <a href="/" className="hover:text-kindle-text hover:underline transition">Open Web Reader</a>
            <span>•</span>
            <button
              type="button"
              onClick={() => { scrollToSection("workshop"); setShowScoreTrackerDemo(true); }}
              className="hover:text-kindle-text hover:underline transition cursor-pointer text-[#e0533c] font-bold"
            >
              Score Tracker Demo
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => { scrollToSection("workshop"); setShowCrosswordDemo(true); }}
              className="hover:text-kindle-text hover:underline transition cursor-pointer text-kindle-accent font-bold"
            >
              Crossword Demo
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => { scrollToSection("workshop"); setShowWordSearchDemo(true); }}
              className="hover:text-kindle-text hover:underline transition cursor-pointer text-emerald-600 font-bold"
            >
              Word Search Demo
            </button>
            <span>•</span>
            <a href="https://github.com/CHAOTIC-RAY/Kora-" target="_blank" rel="noopener noreferrer" className="hover:text-kindle-text hover:underline inline-flex items-center gap-0.5 transition">
              GitHub Repository <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
