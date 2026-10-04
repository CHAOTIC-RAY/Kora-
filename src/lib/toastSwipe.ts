/**
 * Swipe-to-dismiss for in-app toasts.
 *
 * `react-hot-toast` v2 has no built-in gesture dismissal — only a click. This
 * adds horizontal swipe through a single delegated handler wrapped around the
 * `<Toaster />`, so all 140+ toast call sites are covered without touching any
 * of them.
 *
 * Why delegation rather than a per-toast hook: the toasts are rendered by the
 * library, not by us, so there is no per-toast element to wire up. One wrapper
 * catches everything.
 *
 * Why the axis lock matters: toasts sit `bottom-center` directly above the
 * mobile tab bar, so vertical scrolling gestures start on top of them. The
 * direction is decided from the first few pixels of movement, and a mostly
 * vertical drag is released untouched instead of being read as a swipe.
 */

/** Horizontal travel that commits a dismissal. */
const DISMISS_DISTANCE = 72;
/** Movement under this is a tap or a scroll, not a drag. */
const DIRECTION_LOCK_PX = 8;
/** Cap travel so the toast never leaves the screen mid-drag. */
const MAX_TRAVEL = DISMISS_DISTANCE * 1.4;

export interface ToastSwipeHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  style: React.CSSProperties;
}

export interface ToastSwipeOptions {
  /**
   * Dismiss the toast the gesture started on. Given the toast element so the
   * caller can resolve its id, without this module needing to know how
   * `react-hot-toast` identifies its toasts.
   */
  dismiss: (el: HTMLElement) => void;
}

/** Build delegated swipe handlers for a container wrapping the toaster. */
export function createToastSwipeHandlers({ dismiss }: ToastSwipeOptions): ToastSwipeHandlers {
  // Plain closure state, not React state: these run on every pointermove and a
  // re-render would fight the transform being animated.
  let toastEl: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let offsetX = 0;
  let locked: "none" | "x" | "y" = "none";
  let active = false;

  const applyOffset = (x: number) => {
    offsetX = x;
    if (!toastEl) return;
    // Fade as it travels so a committed dismissal reads as intentional.
    const progress = Math.min(1, Math.abs(x) / DISMISS_DISTANCE);
    toastEl.style.transform = `translateX(${x}px) scale(${1 - progress * 0.06})`;
    toastEl.style.opacity = String(1 - progress * 0.55);
  };

  const clearDrag = (animateBack: boolean) => {
    if (toastEl) {
      const el = toastEl;
      if (animateBack) {
        el.style.transition = "transform 200ms cubic-bezier(0.22,1,0.36,1), opacity 200ms";
        el.style.transform = "";
        el.style.opacity = "";
        setTimeout(() => {
          if (el.isConnected) el.style.transition = "";
        }, 220);
      } else {
        el.style.transform = "";
        el.style.opacity = "";
        el.style.transition = "";
      }
    }
    toastEl = null;
    offsetX = 0;
    locked = "none";
    active = false;
  };

  /**
   * Nearest ancestor that IS a toast, or null.
   *
   * `react-hot-toast` renders each toast as an `<li id={toastId}>` with
   * `role="status"` and no `data-*` marker of its own (the only data attribute
   * in the library is `data-rht-toaster` on the container). So match on the
   * list-item role, and read the element's `id` as the toast id.
   */
  const findToast = (target: EventTarget | null): HTMLElement | null => {
    let node = target as HTMLElement | null;
    while (node) {
      if (node.tagName === "LI" && node.getAttribute("role") === "status") return node;
      // Stop at the toaster container; anything above it is not a toast.
      if (node.hasAttribute && node.hasAttribute("data-rht-toaster")) return null;
      node = node.parentElement;
    }
    return null;
  };

  return {
    onPointerDown: (e) => {
      // Ignore secondary buttons so a right-click never starts a drag.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const el = findToast(e.target);
      if (!el) return;
      // Clear any leftover state from a previous drag. A committed swipe sets
      // `transition: none` before flinging; without this an ignored pointerdown
      // (e.g. right-click) would leave the toast stuck transition-less.
      if (toastEl && toastEl !== el) clearDrag(false);

      toastEl = el;
      startX = e.clientX;
      startY = e.clientY;
      locked = "none";
      active = true;
      el.style.transition = "none";
    },

    onPointerMove: (e) => {
      if (!active || !toastEl) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Lock the axis once, early, so a vertical scroll over a toast is never
      // swallowed as a horizontal swipe.
      if (locked === "none") {
        if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
        locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (locked === "y") {
          clearDrag(false);
          return;
        }
      }
      if (locked !== "x") return;

      applyOffset(Math.sign(dx) * Math.min(Math.abs(dx), MAX_TRAVEL));
    },

    onPointerUp: () => {
      if (!active || !toastEl) {
        clearDrag(false);
        return;
      }
      const el = toastEl;
      const committed = Math.abs(offsetX) >= DISMISS_DISTANCE;

      if (committed) {
        // Fling out in the drag direction, then dismiss.
        el.style.transition = "transform 180ms ease-in, opacity 180ms ease-in";
        el.style.transform = `translateX(${Math.sign(offsetX) * 240}px)`;
        el.style.opacity = "0";
        dismiss(el);
        setTimeout(() => clearDrag(false), 240);
      } else {
        clearDrag(true);
      }
    },

    onPointerCancel: () => clearDrag(true),

    // Let the browser keep vertical scrolling; we only claim the horizontal axis.
    style: { touchAction: "pan-y" },
  };
}