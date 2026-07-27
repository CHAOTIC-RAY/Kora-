import React, { useState } from "react";
import { Grid3X3, Search, Swords, Gamepad2 } from "lucide-react";

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
  const [active, setActive] = useState<GameId>("crossword");

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
        </div>
        <button
          type="button"
          onClick={() => onPlayGame?.(active)}
          className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition shrink-0"
        >
          Play active →
        </button>
      </div>

      {/* Game list — every game visible, no hidden auto-rotate */}
      <div className="flex flex-col gap-2">
        {SLIDES.map((s) => {
          const isActive = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setActive(s.id);
                onPlayGame?.(s.id);
              }}
              onMouseEnter={() => setActive(s.id)}
              className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-3 transition cursor-pointer ${
                isActive
                  ? "border-kindle-accent/40 bg-kindle-accent/10"
                  : "border-kindle-border bg-kindle-bg/40 hover:border-kindle-accent/25"
              }`}
            >
              <span className={`shrink-0 ${s.accent}`}>{s.icon}</span>
              <div className="min-w-0 flex-1">
                <div className={`text-[9px] font-bold uppercase tracking-widest ${s.accent}`}>
                  {s.tag}
                </div>
                <h4 className="text-[13px] font-serif font-bold text-kindle-text leading-tight truncate">
                  {s.title}
                </h4>
              </div>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-kindle-accent">
                Play
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
