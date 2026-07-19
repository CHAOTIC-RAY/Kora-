import { useCallback, useEffect, useRef } from "react";
import { pushAndroidBackLayer, removeAndroidBackLayer } from "../lib/androidGestures";

export function useAndroidBackLayer(active: boolean, id: string, onBack: () => void) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;

    pushAndroidBackLayer(id, () => onBackRef.current());

    return () => {
      removeAndroidBackLayer(id);
    };
  }, [active, id]);

  const dismiss = useCallback(() => {
    removeAndroidBackLayer(id, { navigateBack: true });
    onBackRef.current();
  }, [id]);

  return dismiss;
}
