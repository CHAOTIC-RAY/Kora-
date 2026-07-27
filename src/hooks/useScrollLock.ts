import { useEffect } from "react";

/**
 * Locks body scroll while `active` is true (e.g. a fullscreen modal / popup
 * is open) and restores the previous overflow on close. Prevents the
 * underlying page from scrolling behind an open overlay.
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
