import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PieChart, X } from "lucide-react";
import type { BookMetadata } from "../lib/firebase";
import {
  buildReadingInsights,
  pieSlicePath,
  slicesWithAngles,
  type PieSlice,
} from "../lib/readingInsights";

interface ReadingInsightsToolProps {
  open: boolean;
  onClose: () => void;
  books: BookMetadata[];
}

function InteractivePie({
  title,
  blurb,
  slices,
}: {
  title: string;
  blurb: string;
  slices: PieSlice[];
}) {
  const [active, setActive] = useState<string | null>(null);
  const angled = useMemo(() => slicesWithAngles(slices), [slices]);
  const selected = angled.find((s) => s.id === active) || angled[0];
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const r = 78;

  if (!slices.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="font-serif text-lg font-bold mb-1">{title}</h3>
        <p className="text-[11px] opacity-50">Not enough library data yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div>
        <h3 className="font-serif text-lg font-bold">{title}</h3>
        <p className="text-[11px] opacity-55">{blurb}</p>
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-44 h-44 shrink-0 drop-shadow-lg"
          role="img"
          aria-label={title}
        >
          {angled.map((slice) => {
            const isActive = (active || angled[0]?.id) === slice.id;
            const scale = isActive ? 1.04 : 1;
            return (
              <g
                key={slice.id}
                style={{
                  transformOrigin: `${cx}px ${cy}px`,
                  transform: `scale(${scale})`,
                  transition: "transform 0.2s ease",
                  cursor: "pointer",
                }}
                onMouseEnter={() => setActive(slice.id)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(slice.id === active ? null : slice.id)}
              >
                <path
                  d={pieSlicePath(cx, cy, r, slice.start, slice.end)}
                  fill={slice.color}
                  opacity={isActive ? 1 : 0.82}
                  stroke="#141210"
                  strokeWidth="2"
                />
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r="34" fill="#1a1814" />
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            fill="#f5f0e8"
            fontSize="16"
            fontFamily="serif"
            fontWeight="700"
          >
            {selected ? Math.round(selected.pct) : 0}%
          </text>
          <text
            x={cx}
            y={cy + 14}
            textAnchor="middle"
            fill="rgba(245,240,232,0.55)"
            fontSize="8"
            fontFamily="monospace"
          >
            {(selected?.label || "").slice(0, 12)}
          </text>
        </svg>

        <ul className="flex-1 w-full space-y-1.5 max-h-44 overflow-y-auto">
          {angled.map((slice) => {
            const isActive = (active || angled[0]?.id) === slice.id;
            return (
              <li key={slice.id}>
                <button
                  type="button"
                  onClick={() => setActive(slice.id)}
                  onMouseEnter={() => setActive(slice.id)}
                  className={`w-full flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition ${
                    isActive ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ background: slice.color }}
                  />
                  <span className="flex-1 text-[12px] truncate">{slice.label}</span>
                  <span className="text-[10px] font-mono opacity-60">
                    {slice.value} · {Math.round(slice.pct)}%
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default function ReadingInsightsTool({ open, onClose, books }: ReadingInsightsToolProps) {
  const insights = useMemo(() => buildReadingInsights(books || []), [books]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[80] flex flex-col bg-[#141210]/96 backdrop-blur-md text-[#f5f0e8]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Reading Insights"
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-50"
          style={{
            background:
              "radial-gradient(ellipse at 15% 10%, rgba(244,114,182,0.18), transparent 45%), radial-gradient(ellipse at 85% 20%, rgba(56,189,248,0.16), transparent 40%), radial-gradient(ellipse at 50% 100%, rgba(212,165,116,0.2), transparent 50%)",
          }}
        />

        <header className="relative z-10 flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,var(--kora-safe-top))] pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-white/5 border border-white/10">
              <PieChart className="w-4 h-4 text-neutral-300" />
            </div>
            <div className="min-w-0">
              <h2 className="font-serif text-lg font-bold tracking-tight truncate">Reading Insights</h2>
              <p className="text-[10px] uppercase tracking-widest opacity-50 font-mono">
                {insights.totals.books} books · {insights.totals.completed} done · {insights.totals.reading} reading
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full border border-white/10 hover:bg-white/5"
            aria-label="Close insights"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="relative z-10 flex-1 overflow-y-auto overscroll-contain px-4 py-6 pb-[max(1.5rem,var(--kora-safe-bottom))]">
          <div className="max-w-2xl mx-auto space-y-5">
            <div className="text-center space-y-2">
              <p className="text-sm text-neutral-400 leading-relaxed">
                Interactive pies of your library moods, pacing, and genres. Tap a slice to explore.
              </p>
            </div>

            <InteractivePie
              title="Moods"
              blurb="Tone inferred from titles, tags, and descriptions"
              slices={insights.moods}
            />
            <InteractivePie
              title="Pacing"
              blurb="How you move through books — binge, steady, slow, or paused"
              slices={insights.pacing}
            />
            <InteractivePie
              title="Genres"
              blurb="Top tags across your shelf"
              slices={insights.genres}
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
