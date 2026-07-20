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
};

export default function LoungeGuidesWidget({ onStartGuide }: LoungeGuidesWidgetProps) {
  const guidesApi = useGuidesOptional();
  const reduceMotion = useReducedMotion();
  const [guides, setGuides] = useState<GuideDefinition[]>(() => pickLoungeGuideWidgets(2));

  useEffect(() => {
    const refresh = () => setGuides(pickLoungeGuideWidgets(2));
    window.addEventListener("kora-guides-changed", refresh);
    return () => window.removeEventListener("kora-guides-changed", refresh);
  }, []);

  if (!guides.length) return null;

  const handleDismiss = (id: GuideId) => {
    dismissGuideForever(id);
    setGuides((prev) => prev.filter((g) => g.id !== id));
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
}: {
  guide: GuideDefinition;
  Icon: React.ComponentType<{ className?: string }>;
  reduceMotion: boolean;
  onDismiss: () => void;
  onStart: () => void;
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
      animate={exiting ? { opacity: 0, x: 120, height: 0, marginBottom: 0 } : { opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="relative touch-pan-y"
    >
      <div className="absolute inset-y-2 left-2 right-2 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-end pr-4 pointer-events-none">
        <span className="text-[10px] font-bold uppercase tracking-wider text-red-600/80">Hide forever</span>
      </div>
      <motion.button
        type="button"
        onClick={onStart}
        className="relative w-full text-left rounded-2xl border border-kindle-border bg-kindle-card p-3.5 flex items-start gap-3 shadow-sm active:scale-[0.99] transition"
        whileTap={reduceMotion ? undefined : { scale: 0.985 }}
      >
        <div className="w-10 h-10 rounded-xl bg-kindle-accent/12 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-kindle-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
            Interactive guide
          </p>
          <h3 className="text-sm font-bold text-kindle-text mt-0.5">{guide.title}</h3>
          <p className="text-[12px] text-kindle-text-muted mt-1 leading-relaxed line-clamp-2">
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
