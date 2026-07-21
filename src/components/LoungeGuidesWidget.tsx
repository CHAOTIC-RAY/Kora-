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
  X,
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
  const limit = variant === "bento" ? 3 : 2;
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
    const [featured, ...rest] = guides;

    return (
      <div className="h-full flex flex-col gap-3 min-h-0" aria-label="Guides">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="block h-px w-4 bg-kindle-accent/70 shrink-0" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.28em] text-kindle-text">
                Guides
              </h3>
              <p className="text-[10px] text-kindle-text-muted truncate">
                Hands-on tab tours · setup popup
              </p>
            </div>
          </div>
          {guides.length > 0 && (
            <span className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted tabular-nums shrink-0">
              {guides.length}
            </span>
          )}
        </div>

        {featured ? (
          <div className="flex flex-col gap-2 flex-1 min-h-0">
            <GuideFeatureTile
              guide={featured}
              Icon={ICONS[featured.icon] || Sparkles}
              reduceMotion={!!reduceMotion}
              onDismiss={() => handleDismiss(featured.id)}
              onStart={() => handleStart(featured.id)}
              index={0}
            />
            {rest.length > 0 && (
              <div
                className={`grid gap-2 flex-1 min-h-0 ${
                  rest.length === 1 ? "grid-cols-1" : "grid-cols-2"
                }`}
              >
                {rest.map((guide, i) => (
                  <GuideMiniTile
                    key={guide.id}
                    guide={guide}
                    Icon={ICONS[guide.icon] || Sparkles}
                    reduceMotion={!!reduceMotion}
                    onDismiss={() => handleDismiss(guide.id)}
                    onStart={() => handleStart(guide.id)}
                    index={i + 1}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-3 py-8 gap-2 rounded-2xl border border-dashed border-kindle-border/70 bg-kindle-bg/35">
            <Sparkles className="w-5 h-5 text-kindle-text-muted opacity-40" />
            <p className="text-xs text-kindle-text-muted leading-relaxed max-w-[14rem]">
              You&apos;re caught up — no pending guides right now.
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
        <div className="flex items-center gap-2.5">
          <span className="block h-px w-4 bg-kindle-accent/70" aria-hidden />
          <h2 className="font-display font-bold text-sm text-kindle-text tracking-tight">
            Guides for you
          </h2>
        </div>
        <p className="text-[10px] text-kindle-text-muted font-medium">Swipe to hide</p>
      </div>

      <div className="space-y-2.5">
        {guides.map((guide, i) => (
          <GuideFeatureTile
            key={guide.id}
            guide={guide}
            Icon={ICONS[guide.icon] || Sparkles}
            reduceMotion={!!reduceMotion}
            onDismiss={() => handleDismiss(guide.id)}
            onStart={() => handleStart(guide.id)}
            index={i}
            showBlurb
          />
        ))}
      </div>
    </section>
  );
}

function GuideFeatureTile({
  guide,
  Icon,
  reduceMotion,
  onDismiss,
  onStart,
  index = 0,
  showBlurb = true,
}: {
  guide: GuideDefinition;
  Icon: React.ComponentType<{ className?: string }>;
  reduceMotion: boolean;
  onDismiss: () => void;
  onStart: () => void;
  index?: number;
  showBlurb?: boolean;
}) {
  const [exiting, setExiting] = useState(false);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 100 || Math.abs(info.velocity.x) > 650) {
      setExiting(true);
      window.setTimeout(onDismiss, reduceMotion ? 0 : 220);
    }
  };

  return (
    <motion.div
      layout
      drag={reduceMotion ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.8}
      onDragEnd={onDragEnd}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={exiting ? { opacity: 0, x: 110 } : { opacity: 1, x: 0, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, delay: index * 0.05 }}
      className="relative touch-pan-y"
    >
      <div className="absolute inset-y-1 left-1 right-1 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-end pr-3 pointer-events-none">
        <span className="text-[9px] font-bold uppercase tracking-wider text-red-600/80">Hide</span>
      </div>

      <motion.button
        type="button"
        onClick={onStart}
        whileTap={reduceMotion ? undefined : { scale: 0.985 }}
        className="relative w-full text-left rounded-2xl overflow-hidden border border-kindle-border/70 bg-kindle-bg/80 hover:border-kindle-accent/35 transition group"
      >
        <div
          className="absolute inset-0 opacity-60 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, color-mix(in srgb, var(--kindle-accent) 16%, transparent), transparent 55%)",
          }}
          aria-hidden
        />
        <div className="relative p-3.5 pr-10">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-kindle-text text-kindle-bg flex items-center justify-center shrink-0 shadow-sm">
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">
                {guide.short || "Tour"}
              </p>
              <h3 className="font-lexend font-bold text-kindle-text mt-1 text-[15px] leading-snug line-clamp-2">
                {guide.title}
              </h3>
              {showBlurb && (
                <p className="text-[11px] text-kindle-text-muted mt-1.5 leading-relaxed line-clamp-2">
                  {guide.blurb}
                </p>
              )}
              <span className="inline-flex items-center gap-1 mt-2.5 text-[10px] font-bold uppercase tracking-wider text-kindle-accent group-hover:gap-1.5 transition-all">
                Start tour <ChevronRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        </div>
      </motion.button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-card/90 transition"
        aria-label={`Hide ${guide.title} forever`}
        title="Hide forever"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

function GuideMiniTile({
  guide,
  Icon,
  reduceMotion,
  onDismiss,
  onStart,
  index = 0,
}: {
  guide: GuideDefinition;
  Icon: React.ComponentType<{ className?: string }>;
  reduceMotion: boolean;
  onDismiss: () => void;
  onStart: () => void;
  index?: number;
}) {
  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, delay: index * 0.05 }}
      className="relative min-h-0"
    >
      <motion.button
        type="button"
        onClick={onStart}
        whileTap={reduceMotion ? undefined : { scale: 0.98 }}
        className="relative w-full h-full min-h-[6.5rem] text-left rounded-2xl border border-kindle-border/70 bg-kindle-bg/55 hover:border-kindle-accent/35 hover:bg-kindle-bg/80 transition p-3 pr-8 flex flex-col gap-2 group"
      >
        <div className="w-8 h-8 rounded-xl bg-kindle-accent/12 ring-1 ring-kindle-accent/10 flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-kindle-accent" />
        </div>
        <div className="min-w-0 flex-1 flex flex-col">
          <h3 className="font-bold text-kindle-text text-[12px] leading-snug line-clamp-2">
            {guide.title}
          </h3>
          <span className="mt-auto pt-2 inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted group-hover:text-kindle-accent transition">
            Start <ChevronRight className="w-3 h-3" />
          </span>
        </div>
      </motion.button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full flex items-center justify-center text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-card transition"
        aria-label={`Hide ${guide.title} forever`}
        title="Hide forever"
      >
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  );
}
