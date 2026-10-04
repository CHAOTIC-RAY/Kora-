/**
 * Toast swipe-to-dismiss: the gesture maths, verified as pure logic.
 *
 * The DOM half cannot be exercised without a browser, so this pins the decision
 * rules that actually matter, each of which was a way to dismiss a toast when
 * the user did not intend to:
 *
 *  - a vertical scroll starting on a toast (they sit above the tab bar)
 *  - a short drag that should snap back, not dismiss
 *  - a right-click, which must never start a drag
 *
 * createToastSwipeHandlers returns plain functions over a DOM element, so this
 * drives it with a minimal fake element — no browser required.
 */
import { createToastSwipeHandlers } from "../src/lib/toastSwipe";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

type Style = Record<string, string>;

/** Minimal stand-in for the toast <li>. */
function fakeToast(id = "t1"): HTMLElement & { style: Style } {
  const el = {
    tagName: "LI",
    id,
    style: {} as Style,
    isConnected: true,
    getAttribute: (n: string) => (n === "role" ? "status" : null),
    hasAttribute: (n: string) => n === "data-rht-toaster",
    parentElement: null as any,
  };
  return el as any;
}

let dismissed: string | null = null;
const h = createToastSwipeHandlers({ dismiss: (el) => { dismissed = el.id; } });

const ev = (x: number, y: number, opts: Partial<React.PointerEvent> = {}) =>
  ({ clientX: x, clientY: y, button: 0, pointerType: "touch", target: null, ...opts }) as any;

console.log("=== a committed horizontal swipe dismisses ===");
const t1 = fakeToast("swipe-me");
dismissed = null;
h.onPointerDown(ev(100, 500, { target: t1 }));
for (let x = 110; x <= 200; x += 10) h.onPointerMove(ev(x, 500));
h.onPointerUp(ev(200, 500));
check("dismissed past the threshold", dismissed === "swipe-me", `got ${dismissed}`);
check("fling offset applied", t1.style.transform.includes("240"), t1.style.transform);

console.log("\n=== a short drag snaps back ===");
const t2 = fakeToast("short");
dismissed = null;
h.onPointerDown(ev(100, 500, { target: t2 }));
h.onPointerMove(ev(130, 500)); // 30px, well under 72
h.onPointerUp(ev(130, 500));
check("not dismissed", dismissed === null, `got ${dismissed}`);
check("snapped back to no transform", t2.style.transform === "", JSON.stringify(t2.style.transform));

console.log("\n=== a vertical scroll over a toast is ignored ===");
const t3 = fakeToast("scroll");
dismissed = null;
h.onPointerDown(ev(100, 500, { target: t3 }));
for (let y = 510; y <= 620; y += 10) h.onPointerMove(ev(102, y)); // mostly vertical
h.onPointerUp(ev(102, 620));
check("vertical drag does NOT dismiss", dismissed === null, `got ${dismissed}`);

console.log("\n=== a mostly-vertical drag with sideways drift is still ignored ===");
const t4 = fakeToast("diagonal");
dismissed = null;
h.onPointerDown(ev(100, 500, { target: t4 }));
h.onPointerMove(ev(110, 560)); // 10 right, 60 down -> vertical wins
h.onPointerMove(ev(130, 640));
h.onPointerUp(ev(130, 640));
check("diagonal (vertical-dominant) does not dismiss", dismissed === null, `got ${dismissed}`);

console.log("\n=== a right-click never starts a drag ===");
const t5 = fakeToast("rightclick");
dismissed = null;
h.onPointerDown(ev(100, 500, { target: t5, button: 2, pointerType: "mouse" }));
h.onPointerMove(ev(200, 500));
h.onPointerUp(ev(200, 500));
check("right-click dismissed nothing", dismissed === null, `got ${dismissed}`);
// The drag was never started, so this toast must be completely untouched — it
// did not even receive `transition: none`.
check(
  "right-click left the toast style untouched",
  Object.keys(t5.style).length === 0,
  JSON.stringify(t5.style)
);

console.log("\n=== state does not leak between toasts ===");
const tA = fakeToast("A");
const tB = fakeToast("B");
dismissed = null;
h.onPointerDown(ev(100, 500, { target: tA }));
h.onPointerMove(ev(130, 500)); // short, snaps back
h.onPointerUp(ev(130, 500));
// A fresh drag on a DIFFERENT toast must start clean, not inherit tA's offset.
h.onPointerDown(ev(100, 500, { target: tB }));
h.onPointerMove(ev(140, 500)); // 40px on its own — must NOT dismiss
h.onPointerUp(ev(140, 500));
check("second toast's drag is independent", dismissed === null, `got ${dismissed}`);

console.log("\n=== a pointer on non-toast content is ignored ===");
const t6 = fakeToast("unrelated");
dismissed = null;
const container: any = { tagName: "DIV", style: {}, getAttribute: () => null, hasAttribute: (n: string) => n === "data-rht-toaster", parentElement: null };
h.onPointerDown(ev(100, 500, { target: container }));
h.onPointerMove(ev(250, 500));
h.onPointerUp(ev(250, 500));
check("gesture outside a toast dismissed nothing", dismissed === null, `got ${dismissed}`);

console.log("\n=== swipe left also dismisses ===");
const t7 = fakeToast("leftward");
dismissed = null;
h.onPointerDown(ev(300, 500, { target: t7 }));
for (let x = 290; x >= 200; x -= 10) h.onPointerMove(ev(x, 500));
h.onPointerUp(ev(200, 500));
check("leftward swipe dismisses", dismissed === "leftward", `got ${dismissed}`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);