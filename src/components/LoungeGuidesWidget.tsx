import React, { useEffect, useState } from "react";
import { motion, useReducedMotion, type PanInfo } from "motion/react";
import {
  Cloud,
  Compass,
  BookOpen,
  Rss,
  Headphones,
  Wrench,
  Plus,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import {
  dismissGuideForever,
  pickLoungeGuideWidgets,
  type GuideDefinition,
  type GuideId,
} from "../lib/guides";
import { useGuidesOptional } from "./GuideProvider";

const ICONS = {
  cloud: Cloud,
  search: Compass,
  book: BookOpen,
  rss: Rss,
  headphones: Headphones,
  wrench: Wrench,
  plus: Plus,
} as const;

type LoungeGuidesWidgetProps = {
  onStartGuide?: (id: GuideId) => void;
  /** Compact tile for the Lounge bento cell */
  variant?: "stack" | "bento";
};

export default function LoungeGuidesWidget({
  onStartGuide,
  variant = "stack",
}: LoungeGuidesWidgetProps) {
  const guidesApi = useGuidesOptional();
  const reduceMotion = useReducedMotion();
  const limit = 2;
  const [guides, setGuides] = useState<GuideDefinition[]>(() => pickLoungeGuideWidgets(limit));

  useEffect(() => {
    const refresh = () => setGuides(pickLoungeGuideWidgets(limit));
    refresh();
    window.addEventListener("kora-guides-changed", refresh);
    return () => window.removeEventListener("kora-guides-changed", refresh);
  }, [limit]);

  const handleDismiss = (id: GuideId) => {
    dismissGuideForever(id);
    setGuides((prev) => {
      const next = prev.filter((g) => g.id !== id);
      if (!next.length) return pickLoungeGuideWidgets(limit);
      return next;
    });
  };

  const handleStart = (id: GuideId) => {
    if (onStartGuide) {
      onStartGuide(id);
      return;
    }
    if (guidesApi) {
      guidesApi.startGuide(id);
      return;
    }
    window.dispatchEvent(new CustomEvent("kora-guide:start", { detail: { id } }));
  };

  if (variant === "bento") {
    return (
      <div className="h-full flex flex-col gap-2.5 min-h-0" aria-label="Guides">
        <div className="flex items-center justify-between gap-2 shrink-0 px-0.5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-kindle-accent" />
            <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text">
              Guides
            </h3>
          </div>
          <p className="text-[9px] text-kindle-text-muted font-medium">Swipe a card to hide forever</p>
        </div>

        {guides.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1 min-h-0">
            {guides.map((guide) => (
              <GuideSwipeCard
                key={guide.id}
                guide={guide}
                Icon={ICONS[guide.icon] || Sparkles}
                reduceMotion={!!reduceMotion}
                onDismiss={() => handleDismiss(guide.id)}
                onStart={() => handleStart(guide.id)}
                compact
              />
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-3 py-4 gap-1.5">
            <Sparkles className="w-5 h-5 text-kindle-text-muted opacity-40" />
            <p className="text-xs text-kindle-text-muted leading-relaxed">
              You&apos;re caught up — no pending guides.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (!guides.length) return null;

  return (
    <section className="space-y-3" aria-label="Guides">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-kindle-accent" />
          <h2 className="font-display font-bold text-sm text-kindle-text tracking-tight">
            Guides for you
          </h2>
        </div>
        <p className="text-[10px] text-kindle-text-muted font-medium">Swipe away to hide</p>
      </div>

      <div className="space-y-2.5">
        {guides.map((guide) => {
          const Icon = ICONS[guide.icon] || Sparkles;
          return (
            <GuideSwipeCard
              key={guide.id}
              guide={guide}
              Icon={Icon}
              reduceMotion={!!reduceMotion}
              onDismiss={() => handleDismiss(guide.id)}
              onStart={() => handleStart(guide.id)}
            />
          );
        })}
      </div>
    </section>
  );
}

function GuideSwipeCard({
  guide,
  Icon,
  reduceMotion,
  onDismiss,
  onStart,
  compact = false,
}: {
  guide: GuideDefinition;
  Icon: React.ComponentType<{ className?: string }>;
  reduceMotion: boolean;
  onDismiss: () => void;
  onStart: () => void;
  compact?: boolean;
}) {
  const [exiting, setExiting] = useState(false);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 110 || Math.abs(info.velocity.x) > 700) {
      setExiting(true);
      window.setTimeout(onDismiss, reduceMotion ? 0 : 220);
    }
  };

  return (
    <motion.div
      layout
      drag={reduceMotion ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.85}
      onDragEnd={onDragEnd}
      animate={exiting ? { opacity: 0, x: 120 } : { opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="relative touch-pan-y h-full"
    >
      <div className="absolute inset-y-1 left-1 right-1 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-end pr-3 pointer-events-none">
        <span className="text-[9px] font-bold uppercase tracking-wider text-red-600/80">Hide</span>
      </div>
      <motion.button
        type="button"
        onClick={onStart}
        className={`relative w-full text-left rounded-2xl border border-kindle-border bg-kindle-bg/80 hover:border-kindle-accent/30 transition flex items-start gap-3 ${
          compact ? "p-3 h-full min-h-[7.5rem]" : "p-3.5 shadow-sm"
        }`}
        whileTap={reduceMotion ? undefined : { scale: 0.985 }}
      >
        <div
          className={`rounded-xl bg-kindle-accent/12 flex items-center justify-center shrink-0 ${
            compact ? "w-9 h-9" : "w-10 h-10"
          }`}
        >
          <Icon className={compact ? "w-4 h-4 text-kindle-accent" : "w-5 h-5 text-kindle-accent"} />
        </div>
        <div className="min-w-0 flex-1 flex flex-col">
          <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">
            Interactive guide
          </p>
          <h3 className={`font-bold text-kindle-text mt-0.5 ${compact ? "text-sm" : "text-sm"}`}>
            {guide.title}
          </h3>
          <p
            className={`text-kindle-text-muted mt-1 leading-relaxed ${
              compact ? "text-[11px] line-clamp-2 flex-1" : "text-[12px] line-clamp-2"
            }`}
          >
            {guide.blurb}
          </p>
          <span className="inline-flex items-center gap-1 mt-2 text-[11px] font-bold text-kindle-accent uppercase tracking-wider">
            Start <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>
      </motion.button>
    </motion.div>
  );
}
