import React, { useState } from "react";
import {
  Book,
  Check,
  ChevronRight,
  ChevronLeft,
  Cloud,
  LogIn,
  Smartphone,
  MousePointerClick,
  ArrowDownToLine,
  Palette,
  Type,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "react-hot-toast";
import { APP_SKINS, type AppSkinId } from "../lib/appSkin";

const SKIN_PREVIEW: Record<AppSkinId, string> = {
  kora: "border-kindle-border bg-kindle-card/80",
  paper: "border-amber-900/15 bg-[#f4ede3]",
  studio: "border-2 border-kindle-text bg-kindle-bg",
  soft: "border-kindle-border/50 bg-kindle-card shadow-md",
};

const DISPLAY_THEMES = [
  { id: "theme-light-white", name: "Classic Pearl", bg: "bg-white", text: "text-zinc-800" },
  { id: "theme-light-yellow", name: "Warm Sepia", bg: "bg-[#F7F3E3]", text: "text-[#3D3B36]" },
  { id: "theme-dark-grey", name: "Slate Charcoal", bg: "bg-[#18181B]", text: "text-[#F4F4F5]" },
  { id: "theme-dark-blue", name: "Mystic Nebula", bg: "bg-[#0B1120]", text: "text-[#E2E8F0]" },
];

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: (preferences: {
    nickname: string;
    displayTheme: string;
    appSkin: AppSkinId;
    fontSize: number;
    isContinuous: boolean;
    dailyGoal: number;
    autoCache: boolean;
    dailyReminders: boolean;
  }) => void;
  currentTheme: string;
  onThemeChange: (theme: string) => void;
  appSkin: AppSkinId;
  onAppSkinChange: (skin: AppSkinId) => void;
  onOpenAuth: () => void;
}

const STEP_LABELS = ["Reader", "Appearance", "Legal", "Account"] as const;
const TOTAL_STEPS = STEP_LABELS.length;

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
  const [fontSize, setFontSize] = useState(18);
  const [isContinuous, setIsContinuous] = useState(false);
  const [dailyGoal, setDailyGoal] = useState(30);
  const [autoCache, setAutoCache] = useState(true);
  const [dailyReminders, setDailyReminders] = useState(false);
  const [agreedToLicenses, setAgreedToLicenses] = useState(false);

  if (!isOpen) return null;

  const finishPayload = () => ({
    nickname: nickname.trim() || "Reader",
    displayTheme: currentTheme,
    appSkin,
    fontSize,
    isContinuous,
    dailyGoal,
    autoCache,
    dailyReminders,
  });

  const handleFinish = () => {
    if (!agreedToLicenses) {
      toast.error("Please agree to the legal terms before continuing.");
      return;
    }
    onComplete(finishPayload());
  };

  const handleSignIn = () => {
    if (!agreedToLicenses) {
      toast.error("Please agree to the legal terms first.");
      return;
    }
    onComplete(finishPayload());
    onOpenAuth();
  };

  const nextStep = () => {
    if (step === 1 && !nickname.trim()) {
      setNickname("Reader");
    }
    if (step === 3 && !agreedToLicenses) {
      toast.error("Please agree to the legal terms before continuing.");
      return;
    }
    setStep((prev) => Math.min(TOTAL_STEPS, prev + 1));
  };

  const prevStep = () => setStep((prev) => Math.max(1, prev - 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md">
      <div className="w-full max-w-lg sm:max-w-xl bg-kindle-bg border border-kindle-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[min(92vh,720px)]">
        <div className="p-3 sm:p-4 border-b border-kindle-border bg-kindle-card/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Book className="w-5 h-5 text-kindle-accent shrink-0" />
            <span className="font-lexend font-bold text-[10px] sm:text-xs uppercase tracking-wider text-kindle-text truncate">
              Getting started with Kora
            </span>
          </div>
          <div className="flex gap-1 shrink-0">
            {STEP_LABELS.map((label, i) => {
              const s = i + 1;
              return (
                <div
                  key={label}
                  title={label}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    s === step ? "bg-kindle-accent w-6" : s < step ? "bg-kindle-accent/40 w-3" : "bg-kindle-border w-3"
                  }`}
                />
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-7">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="reader"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                className="space-y-5"
              >
                <header className="text-center space-y-1.5">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-kindle-accent/10 text-[10px] uppercase font-bold tracking-widest rounded-full text-kindle-text">
                    <Type className="w-3 h-3" />
                    Reader setup
                  </span>
                  <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-kindle-text">
                    How you read
                  </h2>
                  <p className="text-xs text-kindle-text-muted max-w-sm mx-auto">
                    Font size and page style for ebooks. You can change these anytime in the reader gear menu.
                  </p>
                </header>

                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-kindle-text-muted">
                    Nickname (optional)
                  </label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="Reader"
                    className="w-full px-3.5 py-2.5 bg-kindle-card border border-kindle-border rounded-xl text-sm focus:outline-hidden focus:ring-1 focus:ring-kindle-accent text-kindle-text"
                  />
                </div>

                <div className="p-3.5 bg-kindle-card border border-kindle-border rounded-xl space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-kindle-text-muted">
                      Font size
                    </span>
                    <span className="font-mono text-xs font-bold">{fontSize}px</span>
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
                    className="p-2.5 border border-kindle-border/50 rounded-lg bg-kindle-bg/50 text-center font-serif text-kindle-text"
                    style={{ fontSize: `${fontSize}px` }}
                  >
                    The love of books is the best of hobbies.
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-kindle-text-muted">
                    Page style
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIsContinuous(false)}
                      className={`p-3 rounded-xl border text-left transition ${
                        !isContinuous
                          ? "border-kindle-text bg-kindle-text text-kindle-bg"
                          : "border-kindle-border bg-kindle-card text-kindle-text"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <MousePointerClick className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Tap pages</span>
                      </div>
                      <p className={`text-[10px] leading-relaxed ${!isContinuous ? "opacity-80" : "text-kindle-text-muted"}`}>
                        Tap edges or swipe to turn pages.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsContinuous(true)}
                      className={`p-3 rounded-xl border text-left transition ${
                        isContinuous
                          ? "border-kindle-text bg-kindle-text text-kindle-bg"
                          : "border-kindle-border bg-kindle-card text-kindle-text"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Scroll</span>
                      </div>
                      <p className={`text-[10px] leading-relaxed ${isContinuous ? "opacity-80" : "text-kindle-text-muted"}`}>
                        Continuous scroll through a chapter.
                      </p>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-kindle-card border border-kindle-border rounded-xl space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase font-bold text-kindle-text-muted">Daily goal</span>
                      <span className="font-mono text-xs font-bold">{dailyGoal} pages</span>
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
                  </div>
                  <div className="p-3 bg-kindle-card border border-kindle-border rounded-xl space-y-2.5 text-[10px]">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoCache}
                        onChange={(e) => setAutoCache(e.target.checked)}
                        className="w-3.5 h-3.5 mt-0.5 rounded accent-kindle-accent"
                      />
                      <span className="text-kindle-text-muted leading-snug">Cache downloads offline in this browser</span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dailyReminders}
                        onChange={(e) => setDailyReminders(e.target.checked)}
                        className="w-3.5 h-3.5 mt-0.5 rounded accent-kindle-accent"
                      />
                      <span className="text-kindle-text-muted leading-snug">Daily reading reminder on open</span>
                    </label>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="appearance"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                className="space-y-5"
              >
                <header className="text-center space-y-1.5">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-kindle-accent/10 text-[10px] uppercase font-bold tracking-widest rounded-full text-kindle-text">
                    <Palette className="w-3 h-3" />
                    App appearance
                  </span>
                  <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-kindle-text">
                    Look & feel
                  </h2>
                  <p className="text-xs text-kindle-text-muted max-w-sm mx-auto">
                    Colors and chrome for tabs, Library, and Lounge — separate from in-book reader themes.
                  </p>
                </header>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-kindle-text-muted">
                    Display theme
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {DISPLAY_THEMES.map((t) => {
                      const selected = currentTheme === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onThemeChange(t.id)}
                          className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition ${
                            selected ? "border-kindle-accent ring-2 ring-kindle-accent/20" : "border-kindle-border"
                          } ${t.bg}`}
                        >
                          <span className={`text-[9px] font-bold text-center leading-tight ${t.text}`}>{t.name}</span>
                          {selected && <Check className={`w-3 h-3 ${t.text}`} />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider font-bold text-kindle-text-muted">
                    App skin
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {APP_SKINS.map((skin) => {
                      const selected = appSkin === skin.id;
                      return (
                        <button
                          key={skin.id}
                          type="button"
                          onClick={() => onAppSkinChange(skin.id)}
                          className={`p-3 rounded-xl border text-left transition ${
                            selected
                              ? "border-kindle-accent ring-1 ring-kindle-accent/30 bg-kindle-card"
                              : "border-kindle-border hover:border-kindle-text-muted"
                          }`}
                        >
                          <div className={`h-7 rounded-lg border mb-2 ${SKIN_PREVIEW[skin.id]}`} />
                          <span className="text-[10px] font-bold uppercase tracking-wider">{skin.label}</span>
                          <p className="text-[9px] text-kindle-text-muted mt-0.5 leading-snug">{skin.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="legal"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                className="space-y-5"
              >
                <header className="text-center space-y-1.5">
                  <span className="px-2.5 py-0.5 bg-kindle-accent/10 text-[10px] uppercase font-bold tracking-widest rounded-full text-kindle-text">
                    Legal agreement
                  </span>
                  <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-kindle-text">
                    Terms & regulations
                  </h2>
                  <p className="text-xs text-kindle-text-muted max-w-sm mx-auto">
                    Please read and agree before using Kora.
                  </p>
                </header>

                <div className="p-3.5 bg-kindle-card border border-kindle-border rounded-xl max-h-44 sm:max-h-52 overflow-y-auto text-[10px] text-kindle-text-muted leading-relaxed font-mono space-y-2">
                  <p>
                    <strong className="text-kindle-text">1. Client only</strong> — Kora is a reader and search client. It does not host book files; it queries third-party indices you choose.
                  </p>
                  <p>
                    <strong className="text-kindle-text">2. Your responsibility</strong> — Comply with copyright where you live. Only access works you have the right to use.
                  </p>
                  <p>
                    <strong className="text-kindle-text">3. No piracy</strong> — Do not infringe copyright or distribute protected works without permission.
                  </p>
                  <p>
                    <strong className="text-kindle-text">4. Takedowns</strong> — Kora cannot remove files at their source; rights holders contact the host platform.
                  </p>
                  <p>
                    <strong className="text-kindle-text">5. Privacy</strong> — Reading data stays in your browser. Optional sign-in syncs metadata, not your files.
                  </p>
                  <p>
                    <strong className="text-kindle-text">6. No warranty</strong> — Kora is provided as-is; third-party links are at your own risk.
                  </p>
                </div>

                <label className="flex items-start gap-3 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreedToLicenses}
                    onChange={(e) => setAgreedToLicenses(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded accent-amber-600 shrink-0"
                  />
                  <span className="text-[11px] text-kindle-text leading-snug">
                    I have read and agree to the terms above. I accept full responsibility for files I access through third-party sources.
                  </span>
                </label>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div
                key="account"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                className="space-y-5"
              >
                <header className="text-center space-y-1.5">
                  <span className="px-2.5 py-0.5 bg-kindle-accent/10 text-[10px] uppercase font-bold tracking-widest rounded-full text-kindle-text">
                    Account
                  </span>
                  <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-kindle-text">
                    Sign in or continue as guest
                  </h2>
                  <p className="text-xs text-kindle-text-muted max-w-sm mx-auto">
                    Next you&apos;ll land in Library — tap <strong className="text-kindle-text">Getting started with Kora</strong> to open the guide book.
                  </p>
                </header>

                <div className="p-3.5 bg-kindle-card border border-kindle-border rounded-xl space-y-3 text-[11px] text-kindle-text-muted leading-relaxed">
                  <div className="flex items-start gap-3">
                    <Cloud className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                    <p>
                      <span className="font-bold text-kindle-text block text-[10px] uppercase tracking-wider mb-0.5">With an account</span>
                      Sync shelf metadata, progress, and highlights across devices. Book files stay on each device.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Smartphone className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p>
                      <span className="font-bold text-kindle-text block text-[10px] uppercase tracking-wider mb-0.5">P2P transfer</span>
                      Move files device-to-device from Tools → Devices & Sync — explained in the guide book.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <LogIn className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <p>
                      <span className="font-bold text-kindle-text block text-[10px] uppercase tracking-wider mb-0.5">Guest</span>
                      Full offline reader — no account required. Guest data resets after 30 days.
                    </p>
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

        <div className="p-3 sm:p-4 border-t border-kindle-border bg-kindle-card/50 flex justify-between items-center gap-2">
          {step > 1 ? (
            <button
              type="button"
              onClick={prevStep}
              className="py-2 px-3.5 bg-kindle-card border border-kindle-border rounded-xl font-bold text-[10px] uppercase tracking-wider flex items-center gap-1"
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
              disabled={step === 3 && !agreedToLicenses}
              className={`py-2 px-4 rounded-xl font-bold text-[10px] uppercase tracking-wider flex items-center gap-1 ml-auto ${
                step === 3 && !agreedToLicenses
                  ? "bg-neutral-300 text-neutral-500 cursor-not-allowed"
                  : "bg-kindle-accent text-kindle-bg hover:opacity-90"
              }`}
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
