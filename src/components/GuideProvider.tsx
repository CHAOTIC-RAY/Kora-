import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  completeGuide,
  dismissGuideForever,
  getGuide,
  getGuideStatus,
  GUIDE_CATALOG,
  clearJourney,
  loadJourney,
  saveJourney,
  startPostOnboardingJourney,
  type GuideDefinition,
  type GuideId,
  type GuideStep,
  type GuideStepLink,
  type JourneyState,
} from "../lib/guides";
import GuideSpotlight from "./GuideSpotlight";

type AppTab = "lounge" | "library" | "discover" | "feed" | "tools" | "settings";

type ActiveSession = {
  guideId: GuideId;
  stepIndex: number;
};

type GuideContextValue = {
  active: ActiveSession | null;
  currentGuide: GuideDefinition | null;
  currentStep: GuideStep | null;
  startGuide: (id: GuideId) => void;
  startJourney: () => void;
  nextStep: () => void;
  skipStep: () => void;
  dismissActive: (forever?: boolean) => void;
  /** End the active guide and clear the whole post-setup journey queue */
  skipAllGuides: () => void;
  completeActive: () => void;
};

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuides() {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error("useGuides must be used within GuideProvider");
  return ctx;
}

/** Optional — returns null outside provider */
export function useGuidesOptional() {
  return useContext(GuideContext);
}

type GuideProviderProps = {
  children: React.ReactNode;
  onSwitchTab: (tab: AppTab) => void;
  /** When true, don't auto-resume journey (e.g. during onboarding modal) */
  paused?: boolean;
};

export function GuideProvider({ children, onSwitchTab, paused = false }: GuideProviderProps) {
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [journey, setJourney] = useState<JourneyState | null>(() => loadJourney());

  const currentGuide = active ? getGuide(active.guideId) || null : null;
  const currentStep =
    currentGuide && active ? currentGuide.steps[active.stepIndex] || null : null;

  const finishGuideAndAdvanceJourney = useCallback(
    (guideId: GuideId, status: "completed" | "dismissed") => {
      if (status === "completed") completeGuide(guideId);
      else dismissGuideForever(guideId);

      setActive(null);

      setJourney((prev) => {
        const j = prev || loadJourney();
        if (!j?.active) return j;
        const idx = j.queue.indexOf(guideId);
        if (idx < 0) return j;
        const nextIndex = Math.max(j.index, idx) + 1;
        if (nextIndex >= j.queue.length) {
          saveJourney(null);
          return null;
        }
        const next: JourneyState = { ...j, index: nextIndex };
        saveJourney(next);
        // Start next guide shortly so UI can settle
        window.setTimeout(() => {
          const nextId = next.queue[next.index];
          if (nextId && getGuideStatus(nextId) === "pending") {
            setActive({ guideId: nextId, stepIndex: 0 });
          }
        }, 600);
        return next;
      });
    },
    []
  );

  const startGuide = useCallback(
    (id: GuideId) => {
      if (getGuideStatus(id) !== "pending") return;
      const def = getGuide(id);
      if (!def?.steps.length) return;
      setActive({ guideId: id, stepIndex: 0 });
    },
    []
  );

  const startJourney = useCallback(() => {
    const state = startPostOnboardingJourney();
    setJourney(state);
    if (state) {
      window.setTimeout(() => {
        setActive({ guideId: state.queue[0], stepIndex: 0 });
      }, 900);
    }
  }, []);

  const completeActive = useCallback(() => {
    if (!active) return;
    finishGuideAndAdvanceJourney(active.guideId, "completed");
  }, [active, finishGuideAndAdvanceJourney]);

  const dismissActive = useCallback(
    (forever = false) => {
      if (!active) return;
      if (forever) {
        finishGuideAndAdvanceJourney(active.guideId, "dismissed");
      } else {
        // Soft skip current guide but mark completed so journey continues
        finishGuideAndAdvanceJourney(active.guideId, "completed");
      }
    },
    [active, finishGuideAndAdvanceJourney]
  );

  const skipAllGuides = useCallback(() => {
    if (active) {
      // Soft-complete current so it doesn't keep nagging mid-journey
      completeGuide(active.guideId);
    }
    clearJourney();
    setJourney(null);
    setActive(null);
  }, [active]);

  const nextStep = useCallback(() => {
    if (!active || !currentGuide) return;
    const next = active.stepIndex + 1;
    if (next >= currentGuide.steps.length) {
      finishGuideAndAdvanceJourney(active.guideId, "completed");
      return;
    }
    setActive({ ...active, stepIndex: next });
  }, [active, currentGuide, finishGuideAndAdvanceJourney]);

  const skipStep = useCallback(() => {
    nextStep();
  }, [nextStep]);

  // Switch tab when step requests it
  useEffect(() => {
    if (paused || !currentStep?.tab) return;
    onSwitchTab(currentStep.tab);
  }, [currentStep?.id, currentStep?.tab, onSwitchTab, paused]);

  // Auto-open popup/panel when step requests it
  useEffect(() => {
    if (paused || !currentStep?.open) return;
    const t = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("kora-guide:open", { detail: { open: currentStep.open } })
      );
    }, 280);
    return () => window.clearTimeout(t);
  }, [currentStep?.id, currentStep?.open, paused]);

  // Wait for custom events
  useEffect(() => {
    if (paused || !currentStep || currentStep.action !== "wait-event" || !currentStep.event) {
      return;
    }
    const handler = () => nextStep();
    window.addEventListener(currentStep.event, handler);
    return () => window.removeEventListener(currentStep.event!, handler);
  }, [currentStep, nextStep, paused]);

  // Resume journey after reload if mid-queue and nothing active
  useEffect(() => {
    if (paused || active) return;
    const j = loadJourney();
    if (!j?.active) return;
    const id = j.queue[j.index];
    if (id && getGuideStatus(id) === "pending") {
      const t = window.setTimeout(() => setActive({ guideId: id, stepIndex: 0 }), 1200);
      return () => window.clearTimeout(t);
    }
  }, [paused, active]);

  // Listen for external start requests
  useEffect(() => {
    const onStart = (e: Event) => {
      const id = (e as CustomEvent).detail?.id as GuideId | undefined;
      if (id) startGuide(id);
    };
    const onJourney = () => startJourney();
    window.addEventListener("kora-guide:start", onStart);
    window.addEventListener("kora-guide:start-journey", onJourney);
    return () => {
      window.removeEventListener("kora-guide:start", onStart);
      window.removeEventListener("kora-guide:start-journey", onJourney);
    };
  }, [startGuide, startJourney]);

  const value = useMemo<GuideContextValue>(
    () => ({
      active,
      currentGuide,
      currentStep,
      startGuide,
      startJourney,
      nextStep,
      skipStep,
      dismissActive,
      skipAllGuides,
      completeActive,
    }),
    [
      active,
      currentGuide,
      currentStep,
      startGuide,
      startJourney,
      nextStep,
      skipStep,
      dismissActive,
      skipAllGuides,
      completeActive,
    ]
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      {!paused && currentGuide && currentStep && (
        <GuideSpotlight
          guide={currentGuide}
          step={currentStep}
          stepIndex={active!.stepIndex}
          stepCount={currentGuide.steps.length}
          onNext={nextStep}
          onSkip={skipStep}
          onSkipAll={skipAllGuides}
          onDismissForever={() => dismissActive(true)}
          onTargetActivated={
            currentStep.action === "tap-target" ? nextStep : undefined
          }
          onStepLink={(link) => {
            if (link.tab) onSwitchTab(link.tab);
            if (link.finishTour) {
              skipAllGuides();
              if (active) completeGuide(active.guideId);
              return;
            }
            if (link.startGuide) {
              const nextId = link.startGuide;
              if (active) completeGuide(active.guideId);
              setActive(null);
              // Keep journey moving toward this guide if present
              setJourney((prev) => {
                const j = prev || loadJourney();
                if (!j?.active) return j;
                const idx = j.queue.indexOf(nextId);
                if (idx >= 0) {
                  const next = { ...j, index: idx };
                  saveJourney(next);
                  return next;
                }
                return j;
              });
              window.setTimeout(() => {
                if (getGuideStatus(nextId) === "pending") {
                  setActive({ guideId: nextId, stepIndex: 0 });
                }
              }, 350);
              return;
            }
            nextStep();
          }}
        />
      )}
    </GuideContext.Provider>
  );
}

/** Re-export catalog length helper for settings debug */
export function listAllGuides() {
  return GUIDE_CATALOG;
}
