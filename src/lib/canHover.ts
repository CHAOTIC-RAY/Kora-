/** True when the device supports real hover (mouse/trackpad), not touch-only. */
export function canHover(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/**
 * Default game presentation:
 *  • fullscreen on touch/mobile/APK (no hover, or native Android) — maximize the board
 *  • popup elsewhere (desktop with a mouse)
 */
export function gameViewVariant(): "fullscreen" | "popup" {
  if (typeof window === "undefined") return "popup";
  const touch =
    !window.matchMedia("(hover: hover) and (pointer: fine)").matches ||
    /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  return touch ? "fullscreen" : "popup";
}
