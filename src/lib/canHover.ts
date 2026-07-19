/** True when the device supports real hover (mouse/trackpad), not touch-only. */
export function canHover(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
