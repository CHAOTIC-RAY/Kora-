import React, { useEffect, useLayoutEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X, ChevronRight, Sparkles } from "lucide-react";
import type { GuideDefinition, GuideStep, GuideStepLink } from "../lib/guides";

type Rect = { top: number; left: number; width: number; height: number };

function queryTarget(selector?: string): Element | null {
  if (!selector || typeof document === "undefined") return null;
  // Support comma-separated fallbacks; prefer the first *visible* match
  for (const part of selector.split(",").map((s) => s.trim()).filter(Boolean)) {
    try {
      const nodes = document.querySelectorAll(part);
      for (const el of Array.from(nodes)) {
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (r.width >= 2 && r.height >= 2 && style.visibility !== "hidden" && style.display !== "none") {
          return el;
        }
      }
    } catch {
      /* invalid selector */
    }
  }
  return null;
}

function measure(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 && r.height < 2) return null;
  const pad = 8;
  return {
    top: Math.max(0, r.top - pad),
    left: Math.max(0, r.left - pad),
    width: Math.min(window.innerWidth - 8, r.width + pad * 2),
    height: Math.min(window.innerHeight - 8, r.height + pad * 2),
  };
}

type GuideSpotlightProps = {
  guide: GuideDefinition;
  step: GuideStep;
  stepIndex: number;
  stepCount: number;
  onNext: () => void;
  onSkip: () => void;
  onSkipAll?: () => void;
  onDismissForever: () => void;
  onTargetActivated?: () => void;
  onStepLink?: (link: GuideStepLink) => void;
};

export default function GuideSpotlight({
  guide,
  step,
  stepIndex,
  stepCount,
  onNext,
  onSkip,
  onSkipAll,
  onDismissForever,
  onTargetActivated,
  onStepLink,
}: GuideSpotlightProps) {
  const reduceMotion = useReducedMotion();
  const [hole, setHole] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    setReady(false);
    let tries = 0;
    let raf = 0;
    const tick = () => {
      const el = queryTarget(step.target);
      const rect = measure(el);
      setHole(rect);
      tries += 1;
      if ((!step.target || rect) && tries > 2) {
        setReady(true);
        return;
      }
      if (tries < 40) {
        raf = requestAnimationFrame(tick);
      } else {
        setReady(true);
      }
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => setHole(measure(queryTarget(step.target)));
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [step.id, step.target]);

  // When user taps the highlighted target, advance
  useEffect(() => {
    if (!onTargetActivated || !step.target) return;
    const el = queryTarget(step.target);
    if (!el) return;

    const handler = (e: Event) => {
      // Let the click/tap through, then advance on next frame
      requestAnimationFrame(() => onTargetActivated());
    };
    el.addEventListener("click", handler, { capture: true });
    return () => el.removeEventListener("click", handler, { capture: true } as EventListenerOptions);
  }, [step.id, step.target, onTargetActivated, ready]);

  // Scroll target into view
  useEffect(() => {
    if (step.target?.includes("reader-surface")) return;
    const el = queryTarget(step.target);
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    } catch {
      /* ignore */
    }
  }, [step.id, step.target, reduceMotion]);

  const showNext =
    step.action === "next" ||
    step.action === undefined ||
    (step.action === "tap-target" && !step.target) ||
    (step.action === "wait-event" && !step.event);

  /** Full-reader / page-interaction steps must not trap pointer events in the dim panes. */
  const passThroughHole =
    guide.id === "walkthrough-book" ||
    (!!step.target &&
      (step.target.includes("reader-surface") ||
        step.event === "kora-guide:text-selected" ||
        step.event === "kora-guide:walkthrough-opened"));

  // Tip card placement
  const tipStyle = (() => {
    const pinBottom =
      step.placement === "bottom" ||
      step.target?.includes("reader-settings-panel");

    if (pinBottom) {
      return {
        bottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))",
        left: 16,
        right: 16,
        maxWidth: "28rem",
        marginLeft: "auto",
        marginRight: "auto",
      } as React.CSSProperties;
    }

    // Full-reader interaction steps: pin tip under the chrome so page text stays free.
    if (passThroughHole && step.target?.includes("reader-surface")) {
      return {
        top: "calc(4.25rem + env(safe-area-inset-top, 0px))",
        left: 16,
        right: 16,
        maxWidth: "28rem",
        marginLeft: "auto",
        marginRight: "auto",
      } as React.CSSProperties;
    }
    if (!hole) {
      return { bottom: "calc(5.5rem + env(safe-area-inset-bottom))", left: 16, right: 16 } as React.CSSProperties;
    }
    const spaceBelow = window.innerHeight - (hole.top + hole.height);
    const preferBottom = step.placement === "bottom" || (step.placement !== "top" && spaceBelow > 160);
    if (preferBottom) {
      return {
        top: Math.min(window.innerHeight - 200, hole.top + hole.height + 14),
        left: 16,
        right: 16,
      } as React.CSSProperties;
    }
    return {
      bottom: Math.max(16, window.innerHeight - hole.top + 14),
      left: 16,
      right: 16,
    } as React.CSSProperties;
  })();

  return (
    <AnimatePresence>
      {ready && (
        <motion.div
          className="fixed inset-0 z-[200] pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.01 : 0.25 }}
          role="dialog"
          aria-modal="true"
          aria-label={`${guide.title}: ${step.title}`}
        >
          {/* Four dim panes around the hole so outside clicks are blocked but the target stays tappable */}
          {hole ? (
            <>
              <div
                data-kora-pass-through
                className={`absolute bg-black/62 ${passThroughHole ? "pointer-events-none" : "pointer-events-auto"}`}
                style={{ top: 0, left: 0, right: 0, height: hole.top }}
              />
              <div
                data-kora-pass-through
                className={`absolute bg-black/62 ${passThroughHole ? "pointer-events-none" : "pointer-events-auto"}`}
                style={{
                  top: hole.top + hole.height,
                  left: 0,
                  right: 0,
                  bottom: 0,
                }}
              />
              <div
                data-kora-pass-through
                className={`absolute bg-black/62 ${passThroughHole ? "pointer-events-none" : "pointer-events-auto"}`}
                style={{
                  top: hole.top,
                  left: 0,
                  width: hole.left,
                  height: hole.height,
                }}
              />
              <div
                data-kora-pass-through
                className={`absolute bg-black/62 ${passThroughHole ? "pointer-events-none" : "pointer-events-auto"}`}
                style={{
                  top: hole.top,
                  left: hole.left + hole.width,
                  right: 0,
                  height: hole.height,
                }}
              />
              <motion.div
                className="absolute rounded-2xl pointer-events-none border-2 border-kindle-accent/80"
                style={{
                  top: hole.top,
                  left: hole.left,
                  width: hole.width,
                  height: hole.height,
                  boxShadow: "0 0 0 1px rgba(255,255,255,0.12)",
                }}
                initial={reduceMotion ? false : { scale: 0.94, opacity: 0.5 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
              />
              {!reduceMotion && (
                <motion.div
                  className="absolute rounded-2xl border-2 border-kindle-accent pointer-events-none"
                  style={{
                    top: hole.top,
                    left: hole.left,
                    width: hole.width,
                    height: hole.height,
                  }}
                  initial={{ opacity: 0.9, scale: 1 }}
                  animate={{ opacity: [0.9, 0.2, 0.9], scale: [1, 1.035, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
            </>
          ) : (
            // No spotlight target: keep the tip readable but do NOT block the UI
            // (otherwise wait-event steps like “select text” can never complete).
            <div data-kora-pass-through className="absolute inset-0 bg-black/35 pointer-events-none" />
          )}

          {/* Tip card — pointer events on */}
          <motion.div
            data-kora-guide-tip
            className="absolute pointer-events-auto z-10 mx-auto max-w-md"
            style={tipStyle}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 30, delay: 0.05 }}
          >
            <div className="rounded-2xl border border-kindle-border bg-kindle-card text-kindle-text shadow-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-kindle-accent/15 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-kindle-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                    {guide.title} · {stepIndex + 1}/{stepCount}
                  </p>
                  <h3 className="text-sm font-bold mt-0.5">{step.title}</h3>
                  <p className="text-[12px] text-kindle-text-muted mt-1 leading-relaxed">{step.body}</p>

                  {step.links && step.links.length > 0 && (
                    <div className="flex flex-col gap-2 mt-3">
                      {step.links.map((link) => (
                        <button
                          key={link.label}
                          type="button"
                          onClick={() => onStepLink?.(link)}
                          className="w-full text-left px-3 py-2 rounded-xl border border-kindle-border bg-kindle-bg/60 hover:bg-kindle-bg text-[11px] font-bold text-kindle-text transition"
                        >
                          {link.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {(showNext || step.cta) && !step.links?.length && (
                      <button
                        type="button"
                        onClick={onNext}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-kindle-text text-kindle-bg text-[11px] font-bold uppercase tracking-wider"
                      >
                        {step.cta || "Next"}
                        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                      </button>
                    )}
                    {(showNext || step.cta) && step.links?.length ? (
                      <button
                        type="button"
                        onClick={onNext}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-kindle-border text-[11px] font-bold uppercase tracking-wider text-kindle-text-muted"
                      >
                        {step.cta || "Next"}
                        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                      </button>
                    ) : null}
                    {step.action === "tap-target" && (
                      <span className="text-[10px] text-kindle-text-muted font-medium">
                        Tap the highlighted control
                      </span>
                    )}
                    {step.action === "wait-event" && (
                      <span className="text-[10px] text-kindle-text-muted font-medium animate-pulse">
                        {step.open === "setup"
                          ? "Complete the setup popup…"
                          : step.event?.includes("search")
                            ? "Submit a search…"
                            : step.event?.includes("book-added")
                              ? "Download a book…"
                              : step.event?.includes("walkthrough")
                                ? "Open the guide book…"
                            : step.event?.includes("reader")
                                ? "Open a book…"
                                : step.event?.includes("font-size")
                                  ? "Change the font size…"
                                  : step.event?.includes("reader-setting")
                                    ? "Change a setting…"
                                : step.event?.includes("feed")
                                  ? "Add a source…"
                                  : step.event?.includes("text-selected")
                                    ? "Long-press text…"
                                    : "Waiting for you…"}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={onSkip}
                      className="ml-auto text-[11px] font-semibold text-kindle-text-muted hover:text-kindle-text px-2 py-1"
                    >
                      Skip step
                    </button>
                    {onSkipAll && (
                      <button
                        type="button"
                        onClick={onSkipAll}
                        className="text-[11px] font-semibold text-kindle-text-muted hover:text-kindle-text px-2 py-1"
                      >
                        Skip all
                      </button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onDismissForever}
                  className="p-1 rounded-lg hover:bg-black/5 shrink-0"
                  aria-label="Hide this guide forever"
                  title="Hide forever"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[9px] text-kindle-text-muted mt-2 px-1">
                Tip: swipe away guide cards on Lounge to hide them forever. Use Skip all to end the tour.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
