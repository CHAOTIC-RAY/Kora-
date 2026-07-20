/** iOS Safari / PWA helpers — zoom, installability, and touch quirks. */

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports as MacIntel with touch
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Safari (not Chrome/Firefox/Edge on iOS). */
export function isIosSafari(): boolean {
  if (!isIosDevice()) return false;
  const ua = navigator.userAgent || "";
  // CriOS = Chrome iOS, FxiOS = Firefox, EdgiOS = Edge
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//i.test(ua);
}

/**
 * Reduce accidental pinch / gesture zoom on iOS (especially in standalone).
 * Does not block accessibility zoom via system settings.
 */
export function initIosTouchGuards(): void {
  if (typeof document === "undefined" || !isIosDevice()) return;

  document.documentElement.classList.add("kora-ios");

  // Legacy iOS Safari pinch-zoom gestures on the document
  const blockGesture = (e: Event) => {
    e.preventDefault();
  };
  document.addEventListener("gesturestart", blockGesture, { passive: false });
  document.addEventListener("gesturechange", blockGesture, { passive: false });
  document.addEventListener("gestureend", blockGesture, { passive: false });
}
