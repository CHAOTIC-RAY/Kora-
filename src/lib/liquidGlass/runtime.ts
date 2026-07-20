import { LIQUID_GLASS_ATTR } from "./presets";

export function canUseBackdropSvgFilter(): boolean {
  if (typeof document === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;

  const ua = navigator.userAgent;
  const isChromium = /Chrome|Chromium|Edg|CriOS/.test(ua) && !/Firefox|FxiOS/.test(ua);
  if (!isChromium) return false;

  try {
    if (!CSS.supports("backdrop-filter", "url(#lg-filter-lens)")) return false;
  } catch {
    return false;
  }

  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:-9999px;width:48px;height:48px;backdrop-filter:blur(4px) url(#lg-filter-regular) saturate(120%);";
  document.documentElement.appendChild(probe);
  const applied = getComputedStyle(probe).backdropFilter || "";
  probe.remove();
  return applied !== "none" && /url\(/i.test(applied);
}

/** Enable SVG refraction after filter defs mount. Returns cleanup. */
export function setLiquidGlassRefraction(): () => void {
  if (typeof document === "undefined") return () => undefined;

  const enable = () => {
    if (canUseBackdropSvgFilter()) {
      document.documentElement.setAttribute(LIQUID_GLASS_ATTR, "on");
    }
  };

  const id = window.setTimeout(enable, 0);
  return () => {
    window.clearTimeout(id);
    document.documentElement.removeAttribute(LIQUID_GLASS_ATTR);
  };
}

/** @deprecated use setLiquidGlassRefraction */
export function setLiquidGlassEnabled(enabled: boolean) {
  if (typeof document === "undefined") return;
  if (enabled && canUseBackdropSvgFilter()) {
    document.documentElement.setAttribute(LIQUID_GLASS_ATTR, "on");
  } else {
    document.documentElement.removeAttribute(LIQUID_GLASS_ATTR);
  }
}
