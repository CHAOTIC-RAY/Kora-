/**
 * Reading-direction rules.
 *
 * Each of these encodes a bug that was live in the reader: a right-to-left
 * book opening on page 1 instead of its last, the page counter counting
 * down while you read, and a swipe that turned the page the wrong way.
 */
import {
  initialIndex,
  stepForward,
  stepBack,
  displayedPage,
  indexForDisplayed,
  swipeDirection,
  tapZoneAction,
  tapAction,
  canAct,
} from "../readingDirection";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL ", name, detail === undefined ? "" : JSON.stringify(detail));
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ---- a right-to-left manga opens on its LAST page ---- */
ok("rtl starts at the last page", initialIndex({ rtl: true, total: 9 }) === 8);
ok("ltr starts at the first page", initialIndex({ rtl: false, total: 9 }) === 0);
ok("empty chapter starts at 0", initialIndex({ rtl: true, total: 0 }) === 0);
ok("single page starts at 0", initialIndex({ rtl: true, total: 1 }) === 0);

/* ---- forward means towards the start of the book ---- */
// RTL: index 8 -> 7 -> 6 (decreasing, because the array is reversed)
ok("rtl forward decrements", stepForward({ rtl: true, total: 9, index: 8 }) === 7);
ok("rtl forward again", stepForward({ rtl: true, total: 9, index: 7 }) === 6);
// LTR: index 0 -> 1 -> 2
ok("ltr forward increments", stepForward({ rtl: false, total: 9, index: 0 }) === 1);
ok("ltr forward again", stepForward({ rtl: false, total: 9, index: 1 }) === 2);

// and back is the mirror in both
ok("rtl back increments", stepBack({ rtl: true, total: 9, index: 6 }) === 7);
ok("ltr back decrements", stepBack({ rtl: false, total: 9, index: 2 }) === 1);

/* ---- neither end may run off the chapter ---- */
ok("rtl forward clamps at 0", stepForward({ rtl: true, total: 9, index: 0 }) === 0);
ok("rtl back clamps at last", stepBack({ rtl: true, total: 9, index: 8 }) === 8);
ok("ltr forward clamps at last", stepForward({ rtl: false, total: 9, index: 8 }) === 8);
ok("ltr back clamps at 0", stepBack({ rtl: false, total: 9, index: 0 }) === 0);

/* ---- the counter must read 1..9 as you read, in both directions ---- */
// RTL: you open on array index 8, which is displayed page 1.
ok("rtl opens showing page 1", displayedPage({ rtl: true, total: 9, index: 8 }) === 1);
ok("rtl next shows page 2", displayedPage({ rtl: true, total: 9, index: 7 }) === 2);
ok("rtl last page shows 9", displayedPage({ rtl: true, total: 9, index: 0 }) === 9);
// LTR mirrors it.
ok("ltr opens showing page 1", displayedPage({ rtl: false, total: 9, index: 0 }) === 1);
ok("ltr last shows 9", displayedPage({ rtl: false, total: 9, index: 8 }) === 9);

/* ---- the slider is the exact inverse of the counter ---- */
for (const rtl of [true, false]) {
  for (let index = 0; index < 9; index++) {
    const page = displayedPage({ rtl, total: 9, index });
    const back = indexForDisplayed({ rtl, total: 9, page });
    ok(`slider round-trips rtl=${rtl} i=${index}`, back === index, { page, back });
  }
}
ok("slider clamps above range", indexForDisplayed({ rtl: false, total: 9, page: 99 }) === 8);
ok("slider clamps below range", indexForDisplayed({ rtl: false, total: 9, page: 0 }) === 0);

/* ---- a swipe advances towards the start of the book ---- */
// In RTL that is a leftward drag: dx negative.
ok("rtl leftward drag advances", swipeDirection(-200, true).advancing === true);
ok("rtl rightward drag goes back", swipeDirection(200, true).advancing === false);
// LTR is the mirror.
ok("ltr rightward drag advances", swipeDirection(200, false).advancing === true);
ok("ltr leftward drag goes back", swipeDirection(-200, false).advancing === false);

/* ---- tap zones match the swipe direction ---- */
// Left third and leftward swipe must agree, or the same gesture in two
// forms does opposite things.
ok("rtl left third advances", tapAction(0.1, true) === "forward", tapAction(0.1, true));
ok("rtl right third goes back", tapAction(0.9, true) === "back", tapAction(0.9, true));
ok("ltr left third goes back", tapAction(0.1, false) === "back", tapAction(0.1, false));
ok("ltr right third advances", tapAction(0.9, false) === "forward", tapAction(0.9, false));
ok("middle tap toggles chrome", tapAction(0.5, true) === "toggle");
ok("middle tap toggles in ltr too", tapAction(0.5, false) === "toggle");

/* the two input methods must never disagree about direction */
for (const rtl of [true, false]) {
  const leftTap = tapAction(0.1, rtl);
  const leftSwipe = swipeDirection(-150, rtl).advancing ? "forward" : "back";
  ok(`tap and swipe agree rtl=${rtl}`, leftTap === leftSwipe, { leftTap, leftSwipe });
  const rightTap = tapAction(0.9, rtl);
  const rightSwipe = swipeDirection(150, rtl).advancing ? "forward" : "back";
  ok(`tap and swipe agree (right) rtl=${rtl}`, rightTap === rightSwipe, {
    rightTap,
    rightSwipe,
  });
}

/* ---- zone boundaries ---- */
ok("33% is still left", tapZoneAction(0.32) === "left");
ok("50% is the middle", tapZoneAction(0.5) === "toggle");
ok("67% is still middle", tapZoneAction(0.66) === "toggle");
ok("68% is right", tapZoneAction(0.68) === "right");

/* ---- buttons disable at the right end in each direction ---- */
// RTL: at index 8 (page 1) there is nowhere to go back; at 0 (page 9) no
// way to go forward.
ok("rtl at first page cannot go back", !canAct("back", { rtl: true, total: 9, index: 8 }));
ok("rtl at first page can go forward", canAct("forward", { rtl: true, total: 9, index: 8 }));
ok("rtl at last page cannot go forward", !canAct("forward", { rtl: true, total: 9, index: 0 }));
ok("rtl at last page can go back", canAct("back", { rtl: true, total: 9, index: 0 }));
// LTR is the mirror: at index 0 (page 1) there is nowhere to go back, and
// at index 8 (page 9) no way to go forward.
ok("ltr at first page cannot go back", !canAct("back", { rtl: false, total: 9, index: 0 }));
ok("ltr at first page can go forward", canAct("forward", { rtl: false, total: 9, index: 0 }));
ok("ltr at last page cannot go forward", !canAct("forward", { rtl: false, total: 9, index: 8 }));
ok("ltr at last page can go back", canAct("back", { rtl: false, total: 9, index: 8 }));

/* ---- a full read of a 9-page rtl chapter visits each page once ---- */
{
  let i = initialIndex({ rtl: true, total: 9 });
  const seen = [i];
  const pages: number[] = [displayedPage({ rtl: true, total: 9, index: i })];
  for (let n = 0; n < 12; n++) {
    const next = stepForward({ rtl: true, total: 9, index: i });
    if (next === i) break;
    i = next;
    seen.push(i);
    pages.push(displayedPage({ rtl: true, total: 9, index: i }));
  }
  ok("reads every page exactly once", eq(seen, [8, 7, 6, 5, 4, 3, 2, 1, 0]), seen);
  ok("counter runs 1..9 in reading order", eq(pages, [1, 2, 3, 4, 5, 6, 7, 8, 9]), pages);
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
