/**
 * iOS Safari / PWA helpers — zoom, installability, viewport, audio unlock.
 */

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
    window.matchMedia("(display-mode: fullscreen)").matches ||
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

let audioUnlocked = false;
let visualViewportBound = false;

/**
 * iOS blocks AudioContext / media until a user gesture.
 * Call once on first pointerdown — also warms speechSynthesis.
 */
export function unlockIosAudio(): void {
  if (audioUnlocked || typeof window === "undefined") return;
  audioUnlocked = true;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
      }
      // Tiny silent buffer so the session is truly "warm"
      try {
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        /* ignore */
      }
      // Keep a reference briefly then close to avoid leaking contexts
      window.setTimeout(() => {
        void ctx.close().catch(() => {});
      }, 500);
    }
  } catch {
    /* ignore */
  }

  try {
    if (window.speechSynthesis) {
      // Prime voices list (often empty until first interaction on iOS)
      void window.speechSynthesis.getVoices();
    }
  } catch {
    /* ignore */
  }
}

function syncVisualViewportCss() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  if (!vv) {
    root.style.setProperty("--kora-vvh", `${window.innerHeight}px`);
    root.style.setProperty("--kora-keyboard-inset", "0px");
    root.style.setProperty("--kora-vv-offset-top", "0px");
    return;
  }

  // Layout viewport vs visual viewport — keyboard shrinks visualViewport on iOS
  const keyboardInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  root.style.setProperty("--kora-vvh", `${vv.height}px`);
  root.style.setProperty("--kora-keyboard-inset", `${keyboardInset}px`);
  root.style.setProperty("--kora-vv-offset-top", `${vv.offsetTop}px`);
  root.classList.toggle("kora-keyboard-open", keyboardInset > 80);
}

/**
 * Keep CSS vars in sync with iOS Safari visualViewport (keyboard / URL bar).
 */
export function initIosVisualViewport(): void {
  if (typeof window === "undefined" || visualViewportBound) return;
  visualViewportBound = true;

  syncVisualViewportCss();
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", syncVisualViewportCss);
    vv.addEventListener("scroll", syncVisualViewportCss);
  }
  window.addEventListener("resize", syncVisualViewportCss);
  window.addEventListener("orientationchange", () => {
    window.setTimeout(syncVisualViewportCss, 250);
  });
}

/**
 * Reduce accidental pinch / gesture zoom on iOS (especially in standalone).
 * Sets html classes, visualViewport CSS vars, and audio unlock on first tap.
 */
export function initIosTouchGuards(): void {
  if (typeof document === "undefined") return;

  const ios = isIosDevice();
  if (ios) {
    document.documentElement.classList.add("kora-ios");
  }
  if (isStandaloneDisplay()) {
    document.documentElement.classList.add("kora-standalone");
  }

  // Always track visual viewport — helps Android Chrome keyboard too
  initIosVisualViewport();

  // Unlock audio on first real user gesture (all platforms; critical on iOS)
  const unlockOnce = () => {
    unlockIosAudio();
    document.removeEventListener("pointerdown", unlockOnce, true);
    document.removeEventListener("touchstart", unlockOnce, true);
    document.removeEventListener("click", unlockOnce, true);
  };
  document.addEventListener("pointerdown", unlockOnce, { capture: true, passive: true });
  document.addEventListener("touchstart", unlockOnce, { capture: true, passive: true });
  document.addEventListener("click", unlockOnce, { capture: true, passive: true });

  if (!ios) return;

  // Legacy iOS Safari pinch-zoom gestures on the document
  const blockGesture = (e: Event) => {
    e.preventDefault();
  };
  document.addEventListener("gesturestart", blockGesture, { passive: false });
  document.addEventListener("gesturechange", blockGesture, { passive: false });
  document.addEventListener("gestureend", blockGesture, { passive: false });

  // Stop iOS from bouncing the whole page when scrolling nested panes
  document.addEventListener(
    "touchmove",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Allow default inside scrollable regions
      let el: HTMLElement | null = target;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        const oy = style.overflowY;
        if (
          (oy === "auto" || oy === "scroll" || oy === "overlay") &&
          el.scrollHeight > el.clientHeight + 1
        ) {
          return;
        }
        el = el.parentElement;
      }
    },
    { passive: true }
  );
}

/**
 * Share a Blob via the iOS share sheet when available (better than <a download>).
 * Falls back to opening a blob URL.
 */
export async function shareOrDownloadBlob(
  blob: Blob,
  filename: string,
  title = "Kora"
): Promise<"shared" | "downloaded" | "opened"> {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  const nav = navigator as Navigator & {
    share?: (data: ShareData) => Promise<void>;
    canShare?: (data: ShareData) => boolean;
  };

  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    try {
      await nav.share({ files: [file], title });
      return "shared";
    } catch (err) {
      // User cancel — don't fall through noisily
      if ((err as Error)?.name === "AbortError") return "shared";
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // iOS Safari often ignores download — open in new tab as last resort
  if (isIosDevice()) {
    window.setTimeout(() => {
      window.open(url, "_blank");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, 400);
    return "opened";
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded";
}
