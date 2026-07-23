import React, { useState } from "react";
import {
  Book,
  BookOpen,
  Check,
  ChevronRight,
  ChevronLeft,
  Compass,
  Heart,
  Library,
  Rss,
  Globe,
  Target,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "react-hot-toast";
import {
  CURATED_FEED_OPTIONS,
  DEFAULT_FEED_SUBSCRIPTIONS,
  INTERNATIONAL_FEED_OPTIONS,
} from "../lib/feedStorage";
import { DEFAULT_APP_SKIN, type AppSkinId } from "../lib/appSkin";

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: (preferences: {
    nickname: string;
    archetype: string;
    displayTheme: string;
    appSkin: AppSkinId;
    fontSize: number;
    isContinuous: boolean;
    dailyGoal: number;
    autoCache: boolean;
    dailyReminders: boolean;
    selectedFeedUrls: string[];
  }) => void;
  currentTheme: string;
  onThemeChange: (theme: string) => void;
  appSkin?: AppSkinId;
  onAppSkinChange?: (skin: AppSkinId) => void;
  onOpenAuth?: () => void;
}

const ARCHETYPES = [
  {
    id: "midnight-reader",
    title: "The Midnight Reader",
    desc: "Reads until 3 AM under a warm blanket. Drinks black coffee, loves mysterious thrillers, and lives in dark mode.",
    icon: MoonIcon,
    defaultTheme: "theme-dark-grey",
    quote: "Just one more chapter...",
  },
  {
    id: "cozy-tea-sipper",
    title: "The Cozy Tea Sipper",
    desc: "Enjoys warm sepia lighting, a hot cup of chamomile tea, and peaceful, timeless classics.",
    icon: CoffeeIcon,
    defaultTheme: "theme-light-yellow",
    quote: "A cup of tea and a good book is bliss.",
  },
  {
    id: "curator-bibliophile",
    title: "The Bibliophile Curator",
    desc: "Loves cataloging, keeping shelves perfectly organized, and tracking fine literary details.",
    icon: BookmarkIcon,
    defaultTheme: "theme-light-white",
    quote: "My library is my sanctuary.",
  },
  {
    id: "speed-scholar",
    title: "The Speed Scholar",
    desc: "Inhales textbooks and non-fiction at light speed. Uses clean sans-serif layouts to optimize focus.",
    icon: GlassesIcon,
    defaultTheme: "theme-dark-blue",
    quote: "Knowledge is the ultimate superpower.",
  },
];

const KORA_PILLARS = [
  {
    title: "Library",
    desc: "Your books stay on-device for offline reading, notes, and highlights.",
    icon: Library,
  },
  {
    title: "News Brief",
    desc: "A daily digest from Maldives and world RSS sources you pick below.",
    icon: Rss,
  },
  {
    title: "Discover",
    desc: "Find new titles from curated lists and open catalogs.",
    icon: Compass,
  },
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

const TOTAL_STEPS = 3;

export default function OnboardingModal({
  isOpen,
  onComplete,
  currentTheme,
  onThemeChange,
  appSkin = DEFAULT_APP_SKIN,
}: OnboardingModalProps) {
  const [step, setStep] = useState(1);
  const [nickname, setNickname] = useState("");
  const [selectedArchetype, setSelectedArchetype] = useState("curator-bibliophile");
  const [dailyGoal, setDailyGoal] = useState(30);
  const [autoCache, setAutoCache] = useState(true);
  const [dailyReminders, setDailyReminders] = useState(false);
  const [agreedToLicenses, setAgreedToLicenses] = useState(false);
  const [selectedFeedUrls, setSelectedFeedUrls] = useState<string[]>(() =>
    DEFAULT_FEED_SUBSCRIPTIONS.map((feed) => feed.feedUrl)
  );

  if (!isOpen) return null;

  const handleArchetypeSelect = (arc: (typeof ARCHETYPES)[0]) => {
    setSelectedArchetype(arc.id);
    onThemeChange(arc.defaultTheme);
  };

  const nextStep = () => {
    if (step === 1 && !nickname.trim()) {
      setNickname("Anonymous Reader");
    }
    setStep((prev) => Math.min(prev + 1, TOTAL_STEPS));
  };

  const prevStep = () => {
    setStep((prev) => Math.max(prev - 1, 1));
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
      fontSize: 18,
      isContinuous: false,
      dailyGoal,
      autoCache,
      dailyReminders,
      selectedFeedUrls: selectedFeedUrls.length
        ? selectedFeedUrls
        : DEFAULT_FEED_SUBSCRIPTIONS.map((feed) => feed.feedUrl),
    });
  };

  const toggleFeed = (feedUrl: string) => {
    setSelectedFeedUrls((prev) =>
      prev.includes(feedUrl) ? prev.filter((url) => url !== feedUrl) : [...prev, feedUrl]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="w-full max-w-2xl bg-kindle-bg border border-kindle-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-kindle-border bg-kindle-card/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Book className="w-5 h-5 text-kindle-accent" />
            <span className="font-lexend font-bold text-xs uppercase tracking-wider text-kindle-text">
              Reader Setup & Legal Agreement
            </span>
          </div>
          <div className="flex gap-1.5">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s === step ? "bg-kindle-accent w-10" : s < step ? "bg-kindle-accent/40 w-7" : "bg-kindle-border w-7"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <AnimatePresence mode="wait">
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
                    Let&apos;s personalize your reading environment
                  </h2>
                  <p className="text-xs text-kindle-text-muted font-sans max-w-md mx-auto">
                    Kora is built by book lovers, for book lovers. Start with a nickname and the reading vibe that fits you.
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
                    {ARCHETYPES.map((arc) => {
                      const IconComponent = arc.icon;
                      const isSelected = selectedArchetype === arc.id;
                      return (
                        <button
                          key={arc.id}
                          type="button"
                          onClick={() => handleArchetypeSelect(arc)}
                          className={`p-4 rounded-xl border text-left transition-all duration-300 flex gap-3 cursor-pointer ${
                            isSelected
                              ? "bg-kindle-card border-kindle-accent shadow-xs scale-[1.01]"
                              : "bg-kindle-card/50 border-kindle-border hover:border-kindle-text-muted"
                          }`}
                        >
                          <div
                            className={`p-2 rounded-lg shrink-0 h-10 w-10 flex items-center justify-center ${
                              isSelected ? "bg-kindle-accent text-kindle-bg" : "bg-kindle-border/40 text-kindle-text-muted"
                            }`}
                          >
                            <IconComponent className="w-5 h-5" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="font-display font-bold text-xs text-kindle-text flex items-center gap-1.5">
                              {arc.title}
                              {isSelected && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                            </h4>
                            <p className="text-[10px] text-kindle-text-muted leading-relaxed">{arc.desc}</p>
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

            {step === 2 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
                key="step2"
              >
                <div className="text-center space-y-2">
                  <span className="px-3 py-1 bg-kindle-accent/10 text-kindle-text text-[10px] uppercase font-bold tracking-widest rounded-full inline-flex items-center gap-1.5">
                    <Heart className="w-3.5 h-3.5 text-kindle-accent" />
                    Meet Kora
                  </span>
                  <h2 className="text-2xl font-display font-bold tracking-tight text-kindle-text">
                    Your offline reading home
                  </h2>
                  <p className="text-xs text-kindle-text-muted font-sans max-w-lg mx-auto leading-relaxed">
                    Kora is a private reader for books and news. Themes, fonts, and page layout live inside each book —
                    here you only set what shapes your daily habit and your news brief.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {KORA_PILLARS.map((pillar) => {
                    const Icon = pillar.icon;
                    return (
                      <div
                        key={pillar.title}
                        className="p-3.5 rounded-xl border border-kindle-border bg-kindle-card/70 space-y-2"
                      >
                        <div className="w-8 h-8 rounded-lg bg-kindle-accent/10 text-kindle-accent flex items-center justify-center">
                          <Icon className="w-4 h-4" />
                        </div>
                        <h3 className="font-display font-bold text-xs text-kindle-text">{pillar.title}</h3>
                        <p className="text-[10px] text-kindle-text-muted leading-relaxed">{pillar.desc}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-4 p-4 bg-kindle-card border border-kindle-border rounded-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Rss className="w-4 h-4 text-sky-500 shrink-0" />
                        <h3 className="font-display font-bold text-sm text-kindle-text uppercase tracking-wider">
                          News feed sources
                        </h3>
                      </div>
                      <p className="text-[11px] text-kindle-text-muted leading-relaxed">
                        Choose Maldives and international RSS sources for your Read tab. Your Daily News Brief uses these.
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-kindle-text-muted shrink-0 pt-0.5">
                      {selectedFeedUrls.length} selected
                    </span>
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
                      onClick={() => setSelectedFeedUrls(CURATED_FEED_OPTIONS.map((feed) => feed.feedUrl))}
                      className="px-3 py-1.5 rounded-lg border border-kindle-border text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-text"
                    >
                      Select all
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-kindle-accent" />
                    <h3 className="font-display font-bold text-xs uppercase tracking-wider text-kindle-text">
                      Daily habits
                    </h3>
                  </div>

                  <div className="p-4 bg-kindle-card border border-kindle-border rounded-xl space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] uppercase tracking-wider font-bold text-kindle-text-muted">
                        Daily Reading Goal
                      </span>
                      <span className="font-mono text-xs font-bold text-kindle-text">{dailyGoal} Pages</span>
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="p-4 bg-kindle-card border border-kindle-border rounded-xl flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoCache}
                        onChange={(e) => setAutoCache(e.target.checked)}
                        className="w-4 h-4 rounded border-kindle-border text-kindle-accent focus:ring-kindle-accent cursor-pointer shrink-0 mt-0.5"
                      />
                      <span>
                        <span className="font-display font-bold text-xs text-kindle-text block">
                          Offline Library Cache
                        </span>
                        <span className="text-[9px] text-kindle-text-muted leading-relaxed block mt-1">
                          Keep books in IndexedDB so you can read without a connection.
                        </span>
                      </span>
                    </label>

                    <label className="p-4 bg-kindle-card border border-kindle-border rounded-xl flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dailyReminders}
                        onChange={(e) => setDailyReminders(e.target.checked)}
                        className="w-4 h-4 rounded border-kindle-border text-kindle-accent focus:ring-kindle-accent cursor-pointer shrink-0 mt-0.5"
                      />
                      <span>
                        <span className="font-display font-bold text-xs text-kindle-text block">
                          Daily Reading Reminders
                        </span>
                        <span className="text-[9px] text-kindle-text-muted leading-relaxed block mt-1">
                          A friendly quote when you open Kora to keep your streak going.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
                key="step3"
              >
                <div className="text-center space-y-2">
                  <span className="px-3 py-1 bg-kindle-accent/10 text-kindle-text text-[10px] uppercase font-bold tracking-widest rounded-full">
                    Legal Disclaimer & Copyright Compliance
                  </span>
                  <h2 className="text-2xl font-display font-bold tracking-tight text-kindle-text">
                    Terms of Use & Regulations
                  </h2>
                  <p className="text-xs text-kindle-text-muted font-sans max-w-md mx-auto">
                    Please read and agree to our legally focused policy regarding copyright laws, local regulations, and
                    personal liability before continuing.
                  </p>
                </div>

                <div className="p-4 bg-kindle-card border border-kindle-border rounded-xl space-y-3 max-h-[160px] overflow-y-auto text-[10px] text-kindle-text-muted leading-relaxed font-mono">
                  <div className="font-sans font-bold text-xs text-kindle-text border-b border-kindle-border pb-1 mb-2">
                    LEGAL COMPLIANCE, COPYRIGHT DISCLAIMER & PRIVACY POLICY
                  </div>
                  <p>
                    <strong>1. DISCLAIMER OF CONTENT ORIGIN & AGGREGATION</strong>
                    <br />
                    Kora is a browser-based, independent, open-source client utility. It provides search aggregation,
                    reader customization, and metadata indexing by querying public third-party web indices, open APIs,
                    and decentralized document mirror databases. Kora does not host, control, store, upload, or
                    distribute any digital book files or copyright-protected materials on its own servers.
                  </p>
                  <p className="mt-2">
                    <strong>2. LOCAL JURISDICTION & USER RESPONSIBILITY</strong>
                    <br />
                    By using this application, you acknowledge that you are entirely and solely responsible for
                    compliance with all applicable local, national, and international copyright laws and intellectual
                    property regulations. Any book download, file conversion, or metadata search initiated through
                    decentralized mirror links must strictly conform to fair use, open access, public domain exemptions,
                    or explicit personal license ownership under your local jurisdiction. You are strictly prohibited
                    from using Kora to commit copyright infringement or engage in the unauthorized piracy of protected
                    publications.
                  </p>
                  <p className="mt-2">
                    <strong>3. DMCA & TAKEDOWN REQUESTS</strong>
                    <br />
                    Because Kora dynamically queries third-party search APIs and decentralized storage mirrors, it does
                    not possess the technical capability to delete, disable, or remove files at their source. Copyright
                    holders seeking DMCA takedowns, file removals, or suppression of metadata must direct their requests
                    to the actual host platforms, server hosts, or API gateways that serve the documents.
                  </p>
                  <p className="mt-2">
                    <strong>4. DATA PRIVACY & SANDBOXED STORAGE</strong>
                    <br />
                    Your personal reading history remains fully confidential. All loaded book files, local reader
                    progress, highlights, and annotations are stored locally within your browser&apos;s sandboxed
                    IndexedDB container. No raw text content, imported documents, or private reading records are
                    transmitted to external servers, ensuring absolute isolation and privacy.
                  </p>
                </div>

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
                      I have read and agree to the legal terms, disclaimers, and copyright regulations. I understand and
                      accept full personal responsibility regarding files accessed, searched, or downloaded using
                      third-party indices.
                    </label>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="p-4 border-t border-kindle-border bg-kindle-card/50 flex justify-between items-center">
          {step > 1 ? (
            <button
              type="button"
              onClick={prevStep}
              className="py-2.5 px-4 bg-kindle-card border border-kindle-border hover:border-kindle-text text-kindle-text rounded-xl font-bold text-[11px] uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <div />
          )}

          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={nextStep}
              className="py-2.5 px-5 bg-kindle-accent text-kindle-bg hover:opacity-90 rounded-xl font-bold text-[11px] uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ml-auto"
            >
              Next Step
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              className={`py-2.5 px-6 rounded-xl font-bold text-[11px] uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ml-auto shadow-md ${
                agreedToLicenses
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-neutral-300 text-neutral-500 cursor-not-allowed"
              }`}
            >
              <BookOpen className="w-4 h-4 text-kindle-text-muted" />
              Get Started
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
