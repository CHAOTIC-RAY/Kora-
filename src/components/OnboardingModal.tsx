import React, { useState } from "react";
import { 
  Book, Glasses, Sparkles, Coffee, Bookmark, Check, ChevronRight, 
  ChevronLeft, Info, Shield, Heart, Smile, Star, BookOpen, Settings, Compass, Download, Award, Rss, Globe,
  Cloud, LogIn, Smartphone, Sofa, Headphones
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "react-hot-toast";
import {
  CURATED_FEED_OPTIONS,
  DEFAULT_FEED_SUBSCRIPTIONS,
  INTERNATIONAL_FEED_OPTIONS,
} from "../lib/feedStorage";
import { APP_SKINS, type AppSkinId } from "../lib/appSkin";

const SKIN_PREVIEW: Record<AppSkinId, string> = {
  kora: "border-kindle-border bg-kindle-card/80",
  paper: "border-amber-900/15 bg-[#f4ede3]",
  studio: "border-2 border-kindle-text bg-kindle-bg",
  soft: "border-kindle-border/50 bg-kindle-card shadow-md",
};

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: (preferences: {
    nickname: string;
    archetype: string;
    displayTheme: string;
    appSkin: AppSkinId;
    fontSize: number;
    dailyGoal: number;
    autoCache: boolean;
    dailyReminders: boolean;
    selectedFeedUrls: string[];
  }) => void;
  currentTheme: string;
  onThemeChange: (theme: string) => void;
  appSkin: AppSkinId;
  onAppSkinChange: (skin: AppSkinId) => void;
  onOpenAuth: () => void;
}

const ARCHETYPES = [
  {
    id: "midnight-reader",
    title: "The Midnight Reader",
    desc: "Reads until 3 AM under a warm blanket. Drinks black coffee, loves mysterious thrillers, and lives in dark mode.",
    icon: MoonIcon,
    defaultTheme: "theme-dark-grey",
    quote: "Just one more chapter..."
  },
  {
    id: "cozy-tea-sipper",
    title: "The Cozy Tea Sipper",
    desc: "Enjoys warm sepia lighting, a hot cup of chamomile tea, and peaceful, timeless classics.",
    icon: CoffeeIcon,
    defaultTheme: "theme-light-yellow",
    quote: "A cup of tea and a good book is bliss."
  },
  {
    id: "curator-bibliophile",
    title: "The Bibliophile Curator",
    desc: "Loves cataloging, keeping shelves perfectly organized, and tracking fine literary details.",
    icon: BookmarkIcon,
    defaultTheme: "theme-light-white",
    quote: "My library is my sanctuary."
  },
  {
    id: "speed-scholar",
    title: "The Speed Scholar",
    desc: "Inhales textbooks and non-fiction at light speed. Uses clean sans-serif layouts to optimize focus.",
    icon: GlassesIcon,
    defaultTheme: "theme-dark-blue",
    quote: "Knowledge is the ultimate superpower."
  }
];

function MoonIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function CoffeeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <path d="M6 2v2" />
      <path d="M10 2v2" />
      <path d="M14 2v2" />
    </svg>
  );
}

function BookmarkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
}

function GlassesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="6" cy="15" r="3" />
      <circle cx="18" cy="15" r="3" />
      <path d="M14 15a2.5 2.5 0 0 0-4 0" />
      <path d="M3 15V9h18v6" />
    </svg>
  );
}

export default function OnboardingModal({
  isOpen,
  onComplete,
  currentTheme,
  onThemeChange,
  appSkin,
  onAppSkinChange,
  onOpenAuth,
}: OnboardingModalProps) {
  const [step, setStep] = useState(1);
  const [nickname, setNickname] = useState("");
  const [selectedArchetype, setSelectedArchetype] = useState("curator-bibliophile");
  const [fontSize, setFontSize] = useState(18);
  const [dailyGoal, setDailyGoal] = useState(30); // minutes or pages
  const [autoCache, setAutoCache] = useState(true);
  const [dailyReminders, setDailyReminders] = useState(false);
  const [agreedToLicenses, setAgreedToLicenses] = useState(false);
  const [showFullLicense, setShowFullLicense] = useState(false);
  const [selectedFeedUrls, setSelectedFeedUrls] = useState<string[]>(() =>
    DEFAULT_FEED_SUBSCRIPTIONS.map((feed) => feed.feedUrl)
  );

  // Walkthrough step within step 3
  const [walkthroughIndex, setWalkthroughIndex] = useState(0);

  if (!isOpen) return null;

  const handleArchetypeSelect = (arc: typeof ARCHETYPES[0]) => {
    setSelectedArchetype(arc.id);
    onThemeChange(arc.defaultTheme);
  };

  const nextStep = () => {
    if (step === 1 && !nickname.trim()) {
      setNickname("Anonymous Reader");
    }
    setStep(prev => prev + 1);
  };

  const prevStep = () => {
    setStep(prev => prev - 1);
  };

  const handleFinish = () => {
    if (!agreedToLicenses) {
      toast.error("Please review and agree to the legal terms and copyright guidelines before continuing.");
      return;
    }
    onComplete({
      nickname: nickname.trim() || "Registered Reader",
      archetype: selectedArchetype,
      displayTheme: currentTheme,
      appSkin,
      fontSize,
      dailyGoal,
      autoCache,
      dailyReminders,
      selectedFeedUrls: selectedFeedUrls.length
        ? selectedFeedUrls
        : DEFAULT_FEED_SUBSCRIPTIONS.map((feed) => feed.feedUrl),
    });
  };

  const handleSignIn = () => {
    if (!agreedToLicenses) {
      toast.error("Please agree to the legal terms on the previous step first.");
      return;
    }
    handleFinish();
    onOpenAuth();
  };

  const toggleFeed = (feedUrl: string) => {
    setSelectedFeedUrls((prev) =>
      prev.includes(feedUrl) ? prev.filter((url) => url !== feedUrl) : [...prev, feedUrl]
    );
  };

  const walkthroughSteps = [
    {
      title: "Lounge — Your Dashboard",
      desc: "Lounge is your home screen. Artistic widgets cycle between Continue (book or listen), Shelf, Discover trending picks, and The Paper — latest, unread, or saved headlines. You can hide Lounge anytime in Settings.",
      icon: Sofa,
      color: "text-kindle-accent",
      bg: "bg-kindle-accent/10"
    },
    {
      title: "Library & Your Shelf",
      desc: "Keep EPUB, PDF, TXT, and audiobooks organized. Import from your device or open titles you already downloaded — progress and highlights stay with each book.",
      icon: BookOpen,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10"
    },
    {
      title: "News Feed Sources",
      desc: "Pick Maldives and international RSS sources for your Read tab. Your Daily News Brief and Lounge paper widget use these selections.",
      icon: Rss,
      color: "text-sky-500",
      bg: "bg-sky-500/10"
    },
    {
      title: "Discover Books & Audio",
      desc: "Browse New York Times bestsellers, Goodreads lists, and federated search. Tap a cover to download an ebook or open an audiobook — Discover also feeds Lounge trending tiles.",
      icon: Compass,
      color: "text-amber-500",
      bg: "bg-amber-500/10"
    },
    {
      title: "Downloads & Narrator",
      desc: "Background downloads group in one notification with pause and resume per book. In the reader, Voice Narrator reads pages aloud; audiobooks play in the full player.",
      icon: Headphones,
      color: "text-blue-500",
      bg: "bg-blue-500/10"
    },
    {
      title: "Cross-Device Sync",
      desc: "Sign in to sync library metadata across devices. On a new device, choose which books to download. Files stay on-device — share via peer transfer or WebDAV in Tools → Devices & Sync.",
      icon: Cloud,
      color: "text-teal-500",
      bg: "bg-teal-500/10"
    },
    {
      title: "Display, Skins & Themes",
      desc: "Tune font size, contrast, and line height. Pick an app skin (Kora, Paper, Studio, Soft) and a display theme for eye-safe reading — day or night.",
      icon: Settings,
      color: "text-stone-500",
      bg: "bg-stone-500/10"
    }
  ];

  const isNewsFeedsStep = walkthroughIndex === 2;
  const totalSteps = 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="w-full max-w-2xl bg-kindle-bg border border-kindle-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header indicator */}
        <div className="p-4 border-b border-kindle-border bg-kindle-card/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Book className="w-5 h-5 text-kindle-accent" />
            <span className="font-lexend font-bold text-xs uppercase tracking-wider text-kindle-text">
              Reader Setup & Legal Agreement
            </span>
          </div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map(s => (
              <div 
                key={s} 
                className={`w-7 h-1.5 rounded-full transition-all duration-300 ${
                  s === step ? "bg-kindle-accent w-10" : s < step ? "bg-kindle-accent/40" : "bg-kindle-border"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Content Box */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <AnimatePresence mode="wait">
            
            {/* STEP 1: Welcome & Persona Setup */}
            {step === 1 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
                key="step1"
              >
                <div className="text-center space-y-2">
                  <span className="px-3 py-1 bg-kindle-accent/10 text-kindle-text text-[10px] uppercase font-bold tracking-widest rounded-full">
                    Welcome to Kora
                  </span>
                  <h2 className="text-2xl font-display font-bold tracking-tight text-kindle-text">
                    Let's personalize your reading environment
                  </h2>
                  <p className="text-xs text-kindle-text-muted font-sans max-w-md mx-auto">
                    Kora is built by book lovers, for book lovers. Set up your preferences to tailor your eye-comfort experience.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] uppercase tracking-wider font-bold text-kindle-text-muted">
                    Your Reader Nickname / Pen Name
                  </label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="e.g. Reader, Scholar, Night Owl..."
                    className="w-full px-4 py-3 bg-kindle-card border border-kindle-border rounded-xl text-sm font-sans focus:outline-hidden focus:ring-1 focus:ring-kindle-accent text-kindle-text"
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] uppercase tracking-wider font-bold text-kindle-text-muted block">
                    Choose Your Reader Archetype
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {ARCHETYPES.map(arc => {
                      const IconComponent = arc.icon;
                      const isSelected = selectedArchetype === arc.id;
                      return (
                        <button
                          key={arc.id}
                          onClick={() => handleArchetypeSelect(arc)}
                          className={`p-4 rounded-xl border text-left transition-all duration-300 flex gap-3 cursor-pointer ${
                            isSelected 
                              ? "bg-kindle-card border-kindle-accent shadow-xs scale-[1.01]" 
                              : "bg-kindle-card/50 border-kindle-border hover:border-kindle-text-muted"
                          }`}
                        >
                          <div className={`p-2 rounded-lg shrink-0 h-10 w-10 flex items-center justify-center ${
                            isSelected ? "bg-kindle-accent text-kindle-bg" : "bg-kindle-border/40 text-kindle-text-muted"
                          }`}>
                            <IconComponent className="w-5 h-5" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="font-display font-bold text-xs text-kindle-text flex items-center gap-1.5">
                              {arc.title}
                              {isSelected && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                            </h4>
                            <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                              {arc.desc}
                            </p>
                            <span className="text-[9px] italic text-kindle-text-muted/80 block pt-1">
                              &ldquo;{arc.quote}&rdquo;
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 2: Custom preferences */}
            {step === 2 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
                key="step2"
              >
                <div className="text-center space-y-2">
                  <span className="px-3 py-1 bg-kindle-accent/10 text-kindle-text text-[10px] uppercase font-bold tracking-widest rounded-full">
                    Eye Comfort Settings
                  </span>
                  <h2 className="text-2xl font-display font-bold tracking-tight text-kindle-text">
                    Fine-tune your reading interface
                  </h2>
                  <p className="text-xs text-kindle-text-muted font-sans max-w-md mx-auto">
                    Kora renders texts to maximize focus and reduce eye strain. Customize the display to match your lighting conditions.
                  </p>
                </div>

                {/* Theme palette preview */}
                <div className="space-y-3">
                  <label className="text-[11px] uppercase tracking-wider font-bold text-kindle-text-muted">
                    Quick Canvas Theme Select
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { id: "theme-light-white", name: "Classic Pearl", bg: "bg-white", text: "text-zinc-800", desc: "Pure high contrast light" },
                      { id: "theme-light-yellow", name: "Warm Sepia", bg: "bg-[#F7F3E3]", text: "text-[#3D3B36]", desc: "Amber glow, great for evenings" },
                      { id: "theme-dark-grey", name: "Slate Charcoal", bg: "bg-[#18181B]", text: "text-[#F4F4F5]", desc: "Clean dark mode with warm tint" },
                      { id: "theme-dark-blue", name: "Mystic Nebula", bg: "bg-[#0B1120]", text: "text-[#E2E8F0]", desc: "Cosmic navy blue vibe" }
                    ].map(t => {
                      const isSelected = currentTheme === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => onThemeChange(t.id)}
                          className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 text-center cursor-pointer transition-all ${
                            isSelected ? "border-kindle-accent ring-2 ring-kindle-accent/20 scale-[1.02]" : "border-kindle-border hover:border-kindle-text-muted"
                          } ${t.bg}`}
                        >
                          <span className={`text-[10px] font-bold ${t.text}`}>{t.name}</span>
                          <div className="w-5 h-5 rounded-full border border-neutral-300 flex items-center justify-center bg-radial from-white to-neutral-200">
                            {isSelected && <Check className="w-3 h-3 text-black" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Font Size Selector */}
                <div className="p-4 bg-kindle-card border border-kindle-border rounded-xl space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase tracking-wider font-bold text-kindle-text-muted">
                      Preferred Font Size
                    </span>
                    <span className="font-mono text-xs font-bold text-kindle-text">
                      {fontSize}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="12"
                    max="32"
                    value={fontSize}
                    onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-kindle-border rounded-lg appearance-none cursor-pointer accent-kindle-accent"
                  />
                  <div 
                    className="p-3 border border-kindle-border/50 rounded-lg bg-kindle-bg/50 text-center font-serif text-kindle-text"
                    style={{ fontSize: `${fontSize}px` }}
                  >
                    The love of books is the best of hobbies.
                  </div>
                </div>

                {/* Daily reading goal */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-kindle-card border border-kindle-border rounded-xl space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] uppercase tracking-wider font-bold text-kindle-text-muted">
                        Daily Reading Goal
                      </span>
                      <span className="font-mono text-xs font-bold text-kindle-text">
                        {dailyGoal} Pages
                      </span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="100"
                      step="5"
                      value={dailyGoal}
                      onChange={(e) => setDailyGoal(parseInt(e.target.value, 10))}
                      className="w-full h-1.5 bg-kindle-border rounded-lg appearance-none cursor-pointer accent-kindle-accent"
                    />
                    <p className="text-[9px] text-kindle-text-muted text-center italic">
                      Equivalent to approx. {Math.round(dailyGoal * 1.5)} minutes of focused reading.
                    </p>
                  </div>

                  <div className="p-4 bg-kindle-card border border-kindle-border rounded-xl flex flex-col justify-between space-y-3">
                    <div className="flex justify-between items-start gap-2 border-b border-kindle-border pb-3">
                      <div>
                        <h4 className="font-display font-bold text-xs text-kindle-text">
                          Offline Library Cache
                        </h4>
                        <p className="text-[9px] text-kindle-text-muted leading-relaxed">
                          Automatically cache loaded books inside your browser's persistent IndexedDB local storage. Highly recommended for offline reading.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={autoCache}
                        onChange={(e) => setAutoCache(e.target.checked)}
                        className="w-4 h-4 rounded border-kindle-border text-kindle-accent focus:ring-kindle-accent cursor-pointer shrink-0 mt-0.5"
                      />
                    </div>
                    <div className="flex justify-between items-start gap-2 pt-1">
                      <div>
                        <h4 className="font-display font-bold text-xs text-kindle-text">
                          Daily Reading Reminders
                        </h4>
                        <p className="text-[9px] text-kindle-text-muted leading-relaxed">
                          Opt in to receive a friendly daily quote and motivation on open to hit your reading streak.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={dailyReminders}
                        onChange={(e) => setDailyReminders(e.target.checked)}
                        className="w-4 h-4 rounded border-kindle-border text-kindle-accent focus:ring-kindle-accent cursor-pointer shrink-0 mt-0.5"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] uppercase tracking-wider font-bold text-kindle-text-muted block">
                    App Skin
                  </label>
                  <p className="text-[10px] text-kindle-text-muted -mt-1">
                    Skins change chrome and layout. Switch anytime in Settings → Appearance.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {APP_SKINS.map((skin) => {
                      const selected = appSkin === skin.id;
                      return (
                        <button
                          key={skin.id}
                          type="button"
                          onClick={() => onAppSkinChange(skin.id)}
                          className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                            selected
                              ? "border-kindle-accent ring-1 ring-kindle-accent/30 bg-kindle-card"
                              : "border-kindle-border hover:border-kindle-text-muted"
                          }`}
                        >
                          <div className={`h-8 rounded-lg border mb-2 ${SKIN_PREVIEW[skin.id]}`} />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-kindle-text">
                            {skin.label}
                          </span>
                          <p className="text-[9px] text-kindle-text-muted mt-0.5 leading-snug">{skin.description}</p>
                          <p className="text-[8px] text-kindle-text-muted/80 uppercase tracking-wider font-mono mt-1">
                            UI font: {skin.uiFont}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 3: Walkthrough (Playful, Booknerd theme) */}
            {step === 3 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
                key="step3"
              >
                <div className="text-center space-y-2">
                  <span className="px-3 py-1 bg-kindle-accent/10 text-kindle-text text-[10px] uppercase font-bold tracking-widest rounded-full flex items-center gap-1 w-fit mx-auto">
                    <Award className="w-3.5 h-3.5 text-kindle-accent" />
                    Interactive Guide
                  </span>
                  <h2 className="text-2xl font-display font-bold tracking-tight text-kindle-text">
                    How Kora Fits Together
                  </h2>
                  <p className="text-xs text-kindle-text-muted font-sans max-w-md mx-auto">
                    Lounge is home. From there, Library, Discover, and the morning paper are one tap away.
                  </p>
                </div>

                {/* Curated Interactive walkthrough tabs */}
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 bg-kindle-card p-1 border border-kindle-border rounded-xl">
                  {walkthroughSteps.map((wStep, idx) => {
                    const StepIcon = wStep.icon;
                    return (
                      <button
                        key={idx}
                        onClick={() => setWalkthroughIndex(idx)}
                        className={`py-2 px-1 rounded-lg text-[9px] font-bold font-sans flex flex-col items-center gap-1 transition-all cursor-pointer ${
                          walkthroughIndex === idx
                            ? "bg-kindle-accent text-kindle-bg"
                            : "text-kindle-text-muted hover:text-kindle-text"
                        }`}
                      >
                        <StepIcon className="w-3.5 h-3.5" />
                        <span className="truncate w-full text-center">{wStep.title.split(" ")[0]}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Active Walkthrough Card */}
                <div className="p-5 bg-kindle-card border border-kindle-border rounded-xl space-y-4">
                  <div className="flex flex-col md:flex-row items-center gap-4">
                    <div className={`p-4 rounded-full shrink-0 ${walkthroughSteps[walkthroughIndex].bg}`}>
                      {React.createElement(walkthroughSteps[walkthroughIndex].icon, {
                        className: `w-9 h-9 ${walkthroughSteps[walkthroughIndex].color}`
                      })}
                    </div>
                    <div className="space-y-2 text-center md:text-left">
                      <h3 className="font-display font-bold text-sm text-kindle-text uppercase tracking-wider">
                        {walkthroughSteps[walkthroughIndex].title}
                      </h3>
                      <p className="text-xs text-kindle-text-muted font-sans leading-relaxed">
                        {walkthroughSteps[walkthroughIndex].desc}
                      </p>
                    </div>
                  </div>

                  {isNewsFeedsStep && (
                    <div className="space-y-4 border-t border-kindle-border pt-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                          Select sources
                        </p>
                        <p className="text-[10px] font-mono text-kindle-text-muted">
                          {selectedFeedUrls.length} selected
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-kindle-text">
                          <Rss className="w-3.5 h-3.5 text-sky-500" />
                          Maldives
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {DEFAULT_FEED_SUBSCRIPTIONS.map((feed) => {
                            const selected = selectedFeedUrls.includes(feed.feedUrl);
                            return (
                              <button
                                key={feed.feedUrl}
                                type="button"
                                onClick={() => toggleFeed(feed.feedUrl)}
                                className={`text-left px-3 py-2.5 rounded-xl border transition flex items-center justify-between gap-2 ${
                                  selected
                                    ? "border-kindle-accent bg-kindle-accent/10 text-kindle-text"
                                    : "border-kindle-border bg-kindle-bg/40 text-kindle-text-muted hover:text-kindle-text"
                                }`}
                              >
                                <span className="text-xs font-bold truncate">{feed.title}</span>
                                {selected && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-kindle-text">
                          <Globe className="w-3.5 h-3.5 text-amber-500" />
                          International
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {INTERNATIONAL_FEED_OPTIONS.map((feed) => {
                            const selected = selectedFeedUrls.includes(feed.feedUrl);
                            return (
                              <button
                                key={feed.feedUrl}
                                type="button"
                                onClick={() => toggleFeed(feed.feedUrl)}
                                className={`text-left px-3 py-2.5 rounded-xl border transition flex items-center justify-between gap-2 ${
                                  selected
                                    ? "border-kindle-accent bg-kindle-accent/10 text-kindle-text"
                                    : "border-kindle-border bg-kindle-bg/40 text-kindle-text-muted hover:text-kindle-text"
                                }`}
                              >
                                <span className="text-xs font-bold truncate">{feed.title}</span>
                                {selected && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedFeedUrls(DEFAULT_FEED_SUBSCRIPTIONS.map((feed) => feed.feedUrl))
                          }
                          className="px-3 py-1.5 rounded-lg border border-kindle-border text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-text"
                        >
                          Maldives only
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedFeedUrls(CURATED_FEED_OPTIONS.map((feed) => feed.feedUrl))
                          }
                          className="px-3 py-1.5 rounded-lg border border-kindle-border text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-text"
                        >
                          Select all
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-center gap-1.5">
                  {walkthroughSteps.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setWalkthroughIndex(idx)}
                      className={`w-2.5 h-2.5 rounded-full transition-all ${
                        walkthroughIndex === idx ? "bg-kindle-accent scale-125" : "bg-kindle-border hover:bg-kindle-text-muted"
                      }`}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {/* STEP 4: Legal & Licenses */}
            {step === 4 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
                key="step4"
              >
                <div className="text-center space-y-2">
                  <span className="px-3 py-1 bg-kindle-accent/10 text-kindle-text text-[10px] uppercase font-bold tracking-widest rounded-full">
                    Legal Disclaimer & Copyright Compliance
                  </span>
                  <h2 className="text-2xl font-display font-bold tracking-tight text-kindle-text">
                    Terms of Use & Regulations
                  </h2>
                  <p className="text-xs text-kindle-text-muted font-sans max-w-md mx-auto">
                    Please read and agree to our legally focused policy regarding copyright laws, local regulations, and personal liability before continuing.
                  </p>
                </div>

                {/* Terms text box */}
                <div className="p-4 bg-kindle-card border border-kindle-border rounded-xl space-y-3 max-h-[160px] overflow-y-auto text-[10px] text-kindle-text-muted leading-relaxed font-mono">
                  <div className="font-sans font-bold text-xs text-kindle-text border-b border-kindle-border pb-1 mb-2">
                    LEGAL COMPLIANCE, COPYRIGHT DISCLAIMER & PRIVACY POLICY
                  </div>
                  <p>
                    <strong>1. DISCLAIMER OF CONTENT ORIGIN & AGGREGATION</strong><br />
                    Kora is a browser-based, independent, open-source client utility. It provides search aggregation, reader customization, and metadata indexing by querying public third-party web indices, open APIs, and decentralized document mirror databases. Kora does not host, control, store, upload, or distribute any digital book files or copyright-protected materials on its own servers.
                  </p>
                  <p className="mt-2">
                    <strong>2. LOCAL JURISDICTION & USER RESPONSIBILITY</strong><br />
                    By using this application, you acknowledge that you are entirely and solely responsible for compliance with all applicable local, national, and international copyright laws and intellectual property regulations. Any book download, file conversion, or metadata search initiated through decentralized mirror links must strictly conform to fair use, open access, public domain exemptions, or explicit personal license ownership under your local jurisdiction. You are strictly prohibited from using Kora to commit copyright infringement or engage in the unauthorized piracy of protected publications.
                  </p>
                  <p className="mt-2">
                    <strong>3. DMCA & TAKEDOWN REQUESTS</strong><br />
                    Because Kora dynamically queries third-party search APIs and decentralized storage mirrors, it does not possess the technical capability to delete, disable, or remove files at their source. Copyright holders seeking DMCA takedowns, file removals, or suppression of metadata must direct their requests to the actual host platforms, server hosts, or API gateways that serve the documents.
                  </p>
                  <p className="mt-2">
                    <strong>4. DATA PRIVACY & SANDBOXED STORAGE</strong><br />
                    Your personal reading history remains fully confidential. All loaded book files, local reader progress, highlights, and annotations are stored locally within your browser's sandboxed IndexedDB container. No raw text content, imported documents, or private reading records are transmitted to external servers, ensuring absolute isolation and privacy.
                  </p>
                </div>

                {/* Legally focused agreement pact */}
                <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="pact-checkbox"
                      checked={agreedToLicenses}
                      onChange={(e) => setAgreedToLicenses(e.target.checked)}
                      className="w-4 h-4 rounded border-amber-500/40 text-amber-600 focus:ring-amber-500 cursor-pointer shrink-0 mt-0.5"
                    />
                    <label htmlFor="pact-checkbox" className="text-[11px] font-sans text-kindle-text leading-tight cursor-pointer">
                      <span className="font-bold block text-amber-800">Acknowledgment of Legal Responsibility:</span>
                      I have read and agree to the legal terms, disclaimers, and copyright regulations. I understand and accept full personal responsibility regarding files accessed, searched, or downloaded using third-party indices.
                    </label>
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 5: Account & sync */}
            {step === 5 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
                key="step5"
              >
                <div className="text-center space-y-2">
                  <span className="px-3 py-1 bg-kindle-accent/10 text-kindle-text text-[10px] uppercase font-bold tracking-widest rounded-full">
                    Your Account
                  </span>
                  <h2 className="text-2xl font-display font-bold tracking-tight text-kindle-text">
                    Sign in to keep your library
                  </h2>
                  <p className="text-xs text-kindle-text-muted font-sans max-w-md mx-auto">
                    A free account syncs your bookshelf, reading progress, and highlights across devices via Firebase.
                  </p>
                </div>

                <div className="p-4 bg-kindle-card border border-kindle-border rounded-xl space-y-3 text-xs text-kindle-text-muted leading-relaxed">
                  <div className="flex items-start gap-3">
                    <Cloud className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-kindle-text text-[11px] uppercase tracking-wider mb-1">How sync works</p>
                      <p>Metadata (library, progress, highlights) syncs to your account in the cloud. Book files stay on your devices — use <strong className="text-kindle-text">Tools → Devices & Sync</strong> for peer-to-peer transfer or your own WebDAV archive.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Smartphone className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-kindle-text text-[11px] uppercase tracking-wider mb-1">Guest mode</p>
                      <p>You can continue without signing in. Guest sessions reset every <strong className="text-kindle-text">30 days</strong> — your local library will be cleared when the guest account expires.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleSignIn}
                    className="w-full py-3 bg-kindle-text text-kindle-bg hover:opacity-90 rounded-xl font-bold text-[11px] uppercase tracking-wider transition flex items-center justify-center gap-2"
                  >
                    <LogIn className="w-4 h-4" />
                    Sign in or create account
                  </button>
                  <button
                    type="button"
                    onClick={handleFinish}
                    className="w-full py-3 border border-kindle-border text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-bg rounded-xl font-bold text-[11px] uppercase tracking-wider transition"
                  >
                    Continue as guest
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Footer controls */}
        <div className="p-4 border-t border-kindle-border bg-kindle-card/50 flex justify-between items-center">
          {step > 1 ? (
            <button
              onClick={prevStep}
              className="py-2.5 px-4 bg-kindle-card border border-kindle-border hover:border-kindle-text text-kindle-text rounded-xl font-bold text-[11px] uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <div />
          )}

          {step < totalSteps ? (
            <button
              onClick={() => {
                if (step === 4 && !agreedToLicenses) {
                  toast.error("Please agree to the legal terms before continuing.");
                  return;
                }
                nextStep();
              }}
              className={`py-2.5 px-5 rounded-xl font-bold text-[11px] uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ml-auto ${
                step === 4 && !agreedToLicenses
                  ? "bg-neutral-300 text-neutral-500 cursor-not-allowed"
                  : "bg-kindle-accent text-kindle-bg hover:opacity-90"
              }`}
            >
              Next Step
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : null}
        </div>

      </div>
    </div>
  );
}
