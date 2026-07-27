import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Palette,
  Sun,
  Moon,
  Coffee,
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  Sliders,
  Type,
  Clock,
  Eye,
  Zap,
  Check,
  BookOpen,
  ArrowRight
} from "lucide-react";
import { READER_FONTS } from "../lib/readerThemes";

export interface ReadingThemeItem {
  id: string;
  name: string;
  tagline: string;
  timeOfDay: string;
  icon: typeof Sun;
  bg: string;
  text: string;
  card: string;
  border: string;
  accent: string;
  badgeBg: string;
  badgeText: string;
  description: string;
}

export const READING_THEMES_SHOWCASE: ReadingThemeItem[] = [
  {
    id: "paper",
    name: "Natural Paper",
    tagline: "Unbleached E-Ink Matte",
    timeOfDay: "09:00 AM • Morning Reading",
    icon: Sun,
    bg: "#FAF7F2",
    text: "#2C2A26",
    card: "#F3EEE6",
    border: "#E4DDD2",
    accent: "#8B7355",
    badgeBg: "bg-amber-100 text-amber-900",
    badgeText: "Morning Light",
    description: "Simulates unbleached physical paper with warm organic texture and zero screen glare. Engineered for traditional paperback lovers."
  },
  {
    id: "sepia",
    name: "Vintage Sepia",
    tagline: "Cozy Golden Amber",
    timeOfDay: "02:00 PM • Afternoon Coffee",
    icon: Coffee,
    bg: "#F4ECD8",
    text: "#5B4636",
    card: "#EFE3C5",
    border: "#DBCDA4",
    accent: "#9C7A5B",
    badgeBg: "bg-amber-200/80 text-amber-950",
    badgeText: "Cozy Golden Hour",
    description: "Cuts blue light radiation by 60% with soft amber tinting. Perfect for reading near windows or under warm incandescent lamps."
  },
  {
    id: "green",
    name: "Botanical Mint",
    tagline: "High-Focus Eye Care",
    timeOfDay: "05:00 PM • Intensive Study",
    icon: Eye,
    bg: "#E3EDD3",
    text: "#2D3E1E",
    card: "#D9E6C3",
    border: "#C5D6A8",
    accent: "#4A6B32",
    badgeBg: "bg-emerald-100 text-emerald-900",
    badgeText: "Study & Eye Care",
    description: "Gentle green color spectrum recommended by optometrists to alleviate ocular strain during long research and textbook study sessions."
  },
  {
    id: "night",
    name: "Dusk Twilight",
    tagline: "Charcoal Slate Canvas",
    timeOfDay: "08:00 PM • Evening Relaxation",
    icon: Moon,
    bg: "#1C1F26",
    text: "#D6D8DE",
    card: "#252A33",
    border: "#3A4050",
    accent: "#7DD3FC",
    badgeBg: "bg-slate-800 text-slate-200",
    badgeText: "Dusk Reading",
    description: "Subdued slate charcoal dark palette with softened contrast to prepare your mind for sleep without harsh stark white text."
  },
  {
    id: "oled",
    name: "Midnight OLED",
    tagline: "True Pitch Black",
    timeOfDay: "11:00 PM • Bedtime Mode",
    icon: Sparkles,
    bg: "#000000",
    text: "#E8E8E8",
    card: "#0D0D0D",
    border: "#262626",
    accent: "#E8E8E8",
    badgeBg: "bg-zinc-900 text-zinc-100 border border-zinc-700",
    badgeText: "OLED Pitch Black",
    description: "Turns off subpixels completely on OLED & AMOLED mobile screens. Zero backlight bleed, ultimate battery efficiency, and zero room disturbance."
  },
  {
    id: "light",
    name: "Pristine Light",
    tagline: "Daylight High Contrast",
    timeOfDay: "12:00 PM • Outdoor Sunlight",
    icon: Sun,
    bg: "#FFFFFF",
    text: "#111111",
    card: "#F4F4F5",
    border: "#E4E4E7",
    accent: "#18181B",
    badgeBg: "bg-zinc-100 text-zinc-900",
    badgeText: "Direct Sunlight",
    description: "Stark high-contrast stark daylight mode designed for outdoor reading under direct sunlight or bright ambient office illumination."
  }
];

const SAMPLE_EXCERPTS = [
  {
    title: "Frankenstein (Ch. 1)",
    author: "Mary Shelley",
    text: "I am by birth a Genevese, and my family is one of the most distinguished of that republic. My ancestors had been for many years counsellors and syndics, and my father had filled several public situations with honour and reputation. He was respected by all who knew him for his integrity and indefatigable attention to public business."
  },
  {
    title: "Pride and Prejudice",
    author: "Jane Austen",
    text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters."
  },
  {
    title: "The Time Machine",
    author: "H.G. Wells",
    text: "The Time Traveller (for so it will be convenient to call him) was expounding a recondite matter to us. His grey eyes shone and twinkled, and his usually pale face was flushed and animated. The fire burned brightly, and the soft radiance of the incandescent lights caught the bubbles that flashed and passed in our glasses."
  }
];

export default function ThemeShowcase() {
  const [currentThemeIndex, setCurrentThemeIndex] = useState(0);
  const [currentFontIndex, setCurrentFontIndex] = useState(0);
  const [switchIntervalMs, setSwitchIntervalMs] = useState(3000);
  const [fontSize, setFontSize] = useState(16);
  const [lineHeight, setLineHeight] = useState(1.6);
  const [excerptIndex, setExcerptIndex] = useState(0);

  // Auto-switching timer loop: cycles BOTH theme and font automatically!
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentThemeIndex((prev) => (prev + 1) % READING_THEMES_SHOWCASE.length);
      setCurrentFontIndex((prev) => (prev + 1) % READER_FONTS.length);
    }, switchIntervalMs);

    return () => clearInterval(timer);
  }, [switchIntervalMs]);

  const activeTheme = READING_THEMES_SHOWCASE[currentThemeIndex];
  const activeFont = READER_FONTS[currentFontIndex];
  const activeExcerpt = SAMPLE_EXCERPTS[excerptIndex];

  return (
    <div id="themes" className="space-y-8 animate-in fade-in duration-300 pt-6">
      {/* Header Banner */}
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-kindle-accent/10 border border-kindle-accent/20 text-kindle-accent text-[10px] font-bold uppercase tracking-widest">
          <Palette className="w-3.5 h-3.5" /> Adaptive Reader Palette & Font Engine
        </div>
        <h2 className="text-2xl sm:text-3xl font-serif font-bold text-kindle-text">
          Practical Reading Themes & Typography
        </h2>
        <p className="text-xs sm:text-sm text-kindle-text-muted leading-relaxed">
          Kora automatically adjusts display palettes and typography pairings throughout the day to protect your eyes and optimize focus. Watch auto-switching live below!
        </p>
      </div>

      {/* Main Interactive Showcase Card */}
      <div className="bg-kindle-card border border-kindle-border rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        
        {/* Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-kindle-border pb-5">
          {/* Live Auto-Switching Badge Indicator */}
          <div className="flex items-center gap-3">
            <div className="px-3.5 py-2 rounded-xl bg-kindle-bg border border-kindle-border text-xs font-bold text-kindle-accent flex items-center gap-2 shadow-xs">
              <Sparkles className="w-3.5 h-3.5 animate-pulse text-amber-500" />
              <span>Auto-Switching Active</span>
            </div>

            {/* Cycle Speed Selector */}
            <div className="flex items-center gap-1 bg-kindle-bg p-1 rounded-xl border border-kindle-border text-[11px] font-bold">
              {[
                { label: "1.5s", ms: 1500 },
                { label: "3.0s", ms: 3000 },
                { label: "5.0s", ms: 5000 }
              ].map((speed) => (
                <button
                  key={speed.ms}
                  type="button"
                  onClick={() => setSwitchIntervalMs(speed.ms)}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    switchIntervalMs === speed.ms
                      ? "bg-kindle-card text-kindle-accent shadow-xs"
                      : "text-kindle-text-muted hover:text-kindle-text"
                  }`}
                >
                  {speed.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Book Excerpt Selector */}
          <div className="flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-kindle-text-muted" />
            <select
              value={excerptIndex}
              onChange={(e) => setExcerptIndex(Number(e.target.value))}
              className="bg-kindle-bg border border-kindle-border rounded-xl px-3 py-1.5 text-xs font-medium text-kindle-text focus:outline-none focus:border-kindle-accent cursor-pointer"
            >
              {SAMPLE_EXCERPTS.map((ex, i) => (
                <option key={i} value={i}>
                  {ex.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Live Reader Canvas Frame */}
        <div className="relative rounded-2xl overflow-hidden shadow-inner border transition-all duration-500" style={{ borderColor: activeTheme.border }}>
          {/* Simulated Reader Header Bar */}
          <motion.div
            animate={{
              backgroundColor: activeTheme.card,
              color: activeTheme.text,
              borderColor: activeTheme.border
            }}
            transition={{ duration: 0.5 }}
            className="px-6 py-3 border-b flex items-center justify-between text-xs font-bold font-sans select-none"
          >
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${activeTheme.badgeBg}`}>
                {activeTheme.badgeText}
              </span>
              <span className="opacity-80 font-medium hidden sm:inline">{activeTheme.timeOfDay}</span>
            </div>

            <div className="flex items-center gap-3 text-[11px] opacity-75">
              <span>{activeExcerpt.title}</span>
              <span>•</span>
              <span>Page 1 of 24</span>
            </div>
          </motion.div>

          {/* Simulated Book Page Body */}
          <motion.div
            animate={{
              backgroundColor: activeTheme.bg,
              color: activeTheme.text
            }}
            transition={{ duration: 0.5 }}
            className="p-8 sm:p-12 min-h-[260px] flex flex-col justify-between space-y-6"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: activeTheme.border }}>
                <span className="text-xs font-bold uppercase tracking-widest opacity-60">
                  {activeExcerpt.author}
                </span>
                <span className="text-[10px] font-mono opacity-50">
                  Theme: <strong style={{ color: activeTheme.accent }}>{activeTheme.name}</strong>
                </span>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={`${currentThemeIndex}-${currentFontIndex}-${excerptIndex}`}
                  initial={{ opacity: 0.4, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0.4, y: -4 }}
                  transition={{ duration: 0.3 }}
                  style={{
                    fontSize: `${fontSize}px`,
                    lineHeight: lineHeight
                  }}
                  className={`${activeFont.value} tracking-normal text-justify select-text leading-relaxed`}
                >
                  {activeExcerpt.text}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Reading Progress Footer Indicator */}
            <div className="flex items-center justify-between text-[10px] font-mono opacity-60 border-t pt-3" style={{ borderColor: activeTheme.border }}>
              <span>4% completed • Font: <strong className="font-bold">{activeFont.name}</strong></span>
              <div className="flex items-center gap-1">
                <span>E-Ink Screen Sync</span>
                <Check className="w-3 h-3 text-emerald-500" />
              </div>
            </div>
          </motion.div>

          {/* Progress Bar for Auto-Switch Timer */}
          <motion.div
            key={`${currentThemeIndex}-${currentFontIndex}`}
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: switchIntervalMs / 1000, ease: "linear" }}
            className="h-1 bg-kindle-accent absolute bottom-0 left-0"
          />
        </div>

        {/* Theme Swatch Selection Chips */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-kindle-text uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-kindle-accent" /> Available Presets (Tap to Test)
            </span>
            <span className="text-[10px] font-bold text-kindle-text-muted">
              Theme {currentThemeIndex + 1} of {READING_THEMES_SHOWCASE.length} • Font: {activeFont.name}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {READING_THEMES_SHOWCASE.map((t, idx) => {
              const isSelected = idx === currentThemeIndex;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setCurrentThemeIndex(idx)}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between space-y-2 relative overflow-hidden ${
                    isSelected
                      ? "ring-2 ring-kindle-accent scale-[1.02] shadow-md"
                      : "hover:border-kindle-accent/50 opacity-85 hover:opacity-100"
                  }`}
                  style={{
                    backgroundColor: t.bg,
                    color: t.text,
                    borderColor: isSelected ? t.accent : t.border
                  }}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-bold">{t.name}</span>
                    {isSelected && <Check className="w-3.5 h-3.5" style={{ color: t.accent }} />}
                  </div>

                  <span className="text-[9px] opacity-75 font-medium line-clamp-1">
                    {t.tagline}
                  </span>

                  {/* Color Swatch Pill */}
                  <div className="w-full h-1.5 rounded-full overflow-hidden flex border" style={{ borderColor: t.border }}>
                    <div className="w-2/3 h-full" style={{ backgroundColor: t.bg }} />
                    <div className="w-1/3 h-full" style={{ backgroundColor: t.card }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Theme Detailed Card Description */}
        <motion.div
          key={activeTheme.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 bg-kindle-bg border border-kindle-border rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-kindle-text">{activeTheme.name} Palette</span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${activeTheme.badgeBg}`}>
                {activeTheme.badgeText}
              </span>
            </div>
            <p className="text-xs text-kindle-text-muted leading-relaxed max-w-2xl">
              {activeTheme.description}
            </p>
          </div>

          {/* Quick Font & Size Adjustment Controls */}
          <div className="flex flex-wrap items-center gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-kindle-border w-full sm:w-auto">
            <div className="flex items-center gap-1 bg-kindle-card p-1 rounded-xl border border-kindle-border">
              <Type className="w-3.5 h-3.5 text-kindle-text-muted ml-1" />
              <select
                value={activeFont.value}
                onChange={(e) => {
                  const idx = READER_FONTS.findIndex((f) => f.value === e.target.value);
                  if (idx !== -1) setCurrentFontIndex(idx);
                }}
                className="bg-transparent text-xs font-bold text-kindle-text focus:outline-none cursor-pointer pr-1"
              >
                {READER_FONTS.map((f) => (
                  <option key={f.value} value={f.value} className="text-black">
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1 bg-kindle-card p-1 rounded-xl border border-kindle-border text-xs font-bold text-kindle-text">
              <button
                type="button"
                onClick={() => setFontSize((s) => Math.max(12, s - 1))}
                className="px-2 py-0.5 rounded hover:bg-kindle-bg cursor-pointer"
              >
                A-
              </button>
              <span className="text-[10px] text-kindle-text-muted">{fontSize}px</span>
              <button
                type="button"
                onClick={() => setFontSize((s) => Math.min(26, s + 1))}
                className="px-2 py-0.5 rounded hover:bg-kindle-bg cursor-pointer"
              >
                A+
              </button>
            </div>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
