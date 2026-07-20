import { useEffect } from "react";
import { setLiquidGlassRefraction } from "../../lib/liquidGlass/runtime";
import { LiquidGlassFilters } from "./LiquidGlassFilters";

export function LiquidGlassProvider({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) {
      document.documentElement.removeAttribute("data-liquid-glass");
    }
  }, [enabled]);

  if (!enabled) return null;
  return <LiquidGlassFilters onReady={setLiquidGlassRefraction} />;
}
