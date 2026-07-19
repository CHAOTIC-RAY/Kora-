import { useCallback, useEffect, useRef } from "react";
import { pushAndroidBackLayer, removeAndroidBackLayer } from "../lib/androidGestures";

export function useAndroidBackLayer(active: boolean, id: string, onBack: () => void) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;

    // Defer pushState one frame so the overlay paints before history mutates.
    // Immediate pushState on PWA open can race with Android gesture nav and
    // make fullscreen UI appear to never open (instant minimize / blank).
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      pushAndroidBackLayer(id, () => onBackRef.current());
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      removeAndroidBackLayer(id);
    };
  }, [active, id]);

  const dismiss = useCallback(() => {
    removeAndroidBackLayer(id, { navigateBack: true });
    onBackRef.current();
  }, [id]);

  return dismiss;
}
