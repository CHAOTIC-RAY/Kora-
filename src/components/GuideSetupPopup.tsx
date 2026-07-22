import React, { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Settings2, BookOpen, ArrowDown, X, Check } from "lucide-react";

export type GuideSetupValues = {
  fontSize: number;
  isContinuous: boolean;
};

type GuideSetupPopupProps = {
  isOpen: boolean;
  initial: GuideSetupValues;
  onSave: (values: GuideSetupValues) => void;
  onSkip: () => void;
};

/**
 * Shared setup popup used by interactive guides for reading preferences.
 * Saves via onSave; both Save and Skip emit completion so wait-event steps advance.
 */
export default function GuideSetupPopup({
  isOpen,
  initial,
  onSave,
  onSkip,
}: GuideSetupPopupProps) {
  const reduceMotion = useReducedMotion();
  const [fontSize, setFontSize] = useState(initial.fontSize);
  const [isContinuous, setIsContinuous] = useState(initial.isContinuous);

  useEffect(() => {
    if (!isOpen) return;
    setFontSize(initial.fontSize);
    setIsContinuous(initial.isContinuous);
  }, [isOpen, initial.fontSize, initial.isContinuous]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center p-4 bg-black/65 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.01 : 0.2 }}
          role="dialog"
          aria-modal="true"
          aria-label="Reading setup"
        >
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="w-full max-w-md rounded-3xl border border-kindle-border bg-kindle-card shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-kindle-text text-kindle-bg flex items-center justify-center shrink-0">
                  <Settings2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-accent">
                    Setup
                  </p>
                  <h2 className="font-lexend font-bold text-lg text-kindle-text leading-tight mt-0.5">
                    Reading preferences
                  </h2>
                  <p className="text-xs text-kindle-text-muted mt-1 leading-relaxed">
                    Tune these once — guides will walk you through the rest of the app.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onSkip}
                className="p-2 rounded-xl text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-bg transition shrink-0"
                aria-label="Skip setup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 pb-5 space-y-5">
              <div className="rounded-2xl border border-kindle-border/70 bg-kindle-bg/50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-kindle-text">
                    Font size
                  </p>
                  <span className="text-[11px] font-mono text-kindle-text-muted tabular-nums">
                    {fontSize}px
                  </span>
                </div>
                <input
                  type="range"
                  min={14}
                  max={28}
                  step={1}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full accent-[var(--kindle-accent)]"
                  aria-label="Font size"
                />
                <p
                  className="font-serif text-kindle-text leading-relaxed"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  The day begins between covers.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-kindle-text px-0.5">
                  Page turn
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsContinuous(false)}
                    className={`rounded-2xl border p-3.5 text-left transition ${
                      !isContinuous
                        ? "border-kindle-accent bg-kindle-accent/10"
                        : "border-kindle-border bg-kindle-bg/40 hover:border-kindle-border"
                    }`}
                  >
                    <BookOpen className="w-4 h-4 text-kindle-accent mb-2" />
                    <p className="text-sm font-bold text-kindle-text">Tap pages</p>
                    <p className="text-[11px] text-kindle-text-muted mt-0.5 leading-snug">
                      Tap edges to flip like paper
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsContinuous(true)}
                    className={`rounded-2xl border p-3.5 text-left transition ${
                      isContinuous
                        ? "border-kindle-accent bg-kindle-accent/10"
                        : "border-kindle-border bg-kindle-bg/40 hover:border-kindle-border"
                    }`}
                  >
                    <ArrowDown className="w-4 h-4 text-kindle-accent mb-2" />
                    <p className="text-sm font-bold text-kindle-text">Scroll</p>
                    <p className="text-[11px] text-kindle-text-muted mt-0.5 leading-snug">
                      Continuous vertical reading
                    </p>
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onSkip}
                  className="flex-1 py-3 rounded-xl border border-kindle-border text-[11px] font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-bg transition"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => onSave({ fontSize, isContinuous })}
                  className="flex-[1.4] py-3 rounded-xl bg-kindle-text text-kindle-bg text-[11px] font-bold uppercase tracking-wider inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition"
                >
                  <Check className="w-3.5 h-3.5" /> Save & continue
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
