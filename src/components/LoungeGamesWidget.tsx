import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Grid3X3, Search, Swords, Pause, Play, Gamepad2 } from "lucide-react";

type GameId = "crossword" | "wordsearch" | "guardian";

interface GameSlide {
  id: GameId;
  title: string;
  tag: string;
  blurb: string;
  icon: React.ReactNode;
  accent: string; // tailwind text color for accent
}

const SLIDES: GameSlide[] = [
  {
    id: "crossword",
    title: "Crossword",
    tag: "Word Puzzle",
    blurb: "Fill the grid from your library's vocabulary. Difficulty scales as you go.",
    icon: <Grid3X3 className="w-5 h-5" />,
    accent: "text-amber-500",
  },
  {
    id: "wordsearch",
    title: "Word Search",
    tag: "Word Hunt",
    blurb: "Spot hidden words pulled from your reading. Calm, focused, offline.",
    icon: <Search className="w-5 h-5" />,
    accent: "text-emerald-500",
  },
  {
    id: "guardian",
    title: "Linguist Guardian",
    tag: "Battle",
    blurb: "Free-for-all word duels — local, online, or vs CPU. Last scholar standing.",
    icon: <Swords className="w-5 h-5" />,
    accent: "text-rose-500",
  },
];

const FLIP_MS = 5000;

export default function LoungeGamesWidget({ onPlayGame }: { onPlayGame?: (g: GameId) => void }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const t = window.setInterval(() => {
      if (!pausedRef.current) setIdx((i) => (i + 1) % SLIDES.length);
    }, FLIP_MS);
    return () => window.clearInterval(t);
  }, []);

  const go = (i: number) => setIdx((i + SLIDES.length) % SLIDES.length);
  const cur = SLIDES[idx];

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded bg-rose-500/10 text-rose-500">
            <Gamepad2 className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text truncate">
            Workshop Games
          </h3>
          <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500 border border-rose-500/20">
            Auto
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="p-1.5 rounded-lg bg-kindle-bg border border-kindle-border text-kindle-text hover:text-kindle-accent transition cursor-pointer"
          title={paused ? "Resume auto-switch" : "Pause auto-switch"}
          aria-label={paused ? "Resume" : "Pause"}
        >
          {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
        </button>
      </div>

      {/* Auto-switching slide */}
      <div
        className="relative min-h-[112px] rounded-xl border border-kindle-border bg-kindle-bg/40 overflow-hidden"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={cur.id}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 p-3.5 flex flex-col justify-center gap-1.5"
          >
            <div className="flex items-center gap-2">
              <span className={`${cur.accent}`}>{cur.icon}</span>
              <div className={`text-[9px] font-bold uppercase tracking-widest ${cur.accent}`}>{cur.tag}</div>
            </div>
            <h4 className="text-base font-serif font-bold text-kindle-text leading-tight">{cur.title}</h4>
            <p className="text-[11px] text-kindle-text-muted leading-relaxed line-clamp-2">{cur.blurb}</p>
            <button
              type="button"
              onClick={() => onPlayGame?.(cur.id)}
              className="mt-1 self-start px-3 py-1.5 rounded-lg bg-kindle-accent/15 border border-kindle-accent/30 text-kindle-accent hover:bg-kindle-accent hover:text-white transition cursor-pointer text-[10px] font-bold uppercase tracking-wider"
            >
              Play
            </button>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Dots */}
      <div className="flex items-center justify-center gap-1.5">
        {SLIDES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(i)}
            aria-label={`Show ${s.title}`}
            className={`h-1.5 rounded-full transition-all ${
              i === idx ? "w-5 bg-kindle-accent" : "w-1.5 bg-kindle-text-muted/30 hover:bg-kindle-text-muted/60"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
