import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export const koraSpring = {
  type: "spring" as const,
  stiffness: 420,
  damping: 34,
  mass: 0.85,
};

/** Snappy pill / chrome motion for tab bar switches */
export const koraTabSpring = {
  type: "spring" as const,
  stiffness: 620,
  damping: 42,
  mass: 0.55,
};

export const koraEase = [0.22, 1, 0.36, 1] as const;

export const koraTabTween = {
  type: "tween" as const,
  duration: 0.16,
  ease: koraEase,
};

type FluidOverlayProps = {
  open: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  /** Bottom sheet on small screens; centered dialog on sm+ */
  variant?: "sheet" | "dialog";
  className?: string;
  panelClassName?: string;
  zIndexClassName?: string;
  labelledBy?: string;
};

/**
 * Shared fluid backdrop + panel for popups / sheets.
 * Uses spring motion; respects prefers-reduced-motion.
 */
export default function FluidOverlay({
  open,
  onClose,
  children,
  variant = "dialog",
  className = "",
  panelClassName = "",
  zIndexClassName = "z-[120]",
  labelledBy,
}: FluidOverlayProps) {
  const reduceMotion = useReducedMotion();

  const backdropTransition = reduceMotion
    ? { duration: 0.01 }
    : { duration: 0.22, ease: koraEase };

  const panelTransition = reduceMotion ? { duration: 0.01 } : koraSpring;

  const sheetInitial = reduceMotion ? { opacity: 0 } : { y: "108%", opacity: 0.85 };
  const sheetAnimate = { y: 0, opacity: 1 };
  const sheetExit = reduceMotion ? { opacity: 0 } : { y: "108%", opacity: 0.85 };

  const dialogInitial = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.92, y: 18 };
  const dialogAnimate = { opacity: 1, scale: 1, y: 0 };
  const dialogExit = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.94, y: 12 };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={`fixed inset-0 ${zIndexClassName} flex ${
            variant === "sheet"
              ? "items-end sm:items-center justify-center p-0 sm:p-4"
              : "items-center justify-center p-4"
          } ${className}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
          role="presentation"
        >
          <motion.button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={backdropTransition}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className={`relative w-full ${
              variant === "sheet"
                ? "sm:max-w-sm max-h-[90vh] rounded-t-3xl sm:rounded-2xl"
                : "max-w-sm rounded-2xl"
            } bg-kindle-card border border-kindle-border shadow-2xl text-kindle-text overflow-hidden ${panelClassName}`}
            initial={variant === "sheet" ? sheetInitial : dialogInitial}
            animate={variant === "sheet" ? sheetAnimate : dialogAnimate}
            exit={variant === "sheet" ? sheetExit : dialogExit}
            transition={panelTransition}
            onClick={(e) => e.stopPropagation()}
          >
            {variant === "sheet" && (
              <div className="w-12 h-1 bg-kindle-border rounded-full mx-auto mt-3 sm:hidden shrink-0" />
            )}
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
