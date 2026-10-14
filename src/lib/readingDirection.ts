/**
 * Reading-direction rules for the comic reader.
 *
 * These were wrong three times while the reader was built, and each time
 * the browser harness gave a plausible-looking result that did not pin the
 * bug down: a right-to-left book and a left-to-right one both open showing
 * "1 / 9", so a screenshot cannot tell you which direction is actually
 * wired up. Extracting the decision makes it testable.
 *
 * The rule throughout: the page array is in the source's order, and
 * "forward" means towards the *start* of the book, not towards a higher
 * array index.
 */

export interface DirectionOptions {
  /** True for a manga read right-to-left, the common case. */
  rtl: boolean;
  /** Total pages in the chapter. */
  total: number;
  /** Current position in the source's array order. */
  index: number;
}

/** Where a right-to-left book starts: its last page, not its first. */
export function initialIndex(opts: { rtl: boolean; total: number }): number {
  if (opts.total <= 0) return 0;
  return opts.rtl ? opts.total - 1 : 0;
}

/** One page forward in reading order. Never leaves the chapter. */
export function stepForward(opts: DirectionOptions): number {
  const last = Math.max(0, opts.total - 1);
  const next = opts.index + (opts.rtl ? -1 : 1);
  return Math.min(Math.max(0, next), last);
}

/** One page back in reading order. Never leaves the chapter. */
export function stepBack(opts: DirectionOptions): number {
  const last = Math.max(0, opts.total - 1);
  const next = opts.index + (opts.rtl ? 1 : -1);
  return Math.min(Math.max(0, next), last);
}

/**
 * The page number to display, counted the way the reader reads.
 *
 * A right-to-left book runs backwards through the source array, so the raw
 * index would count down as you read: "9 / 9" on the first page and "1 / 9"
 * on the last. This is the only function allowed to produce a displayed
 * page number.
 */
export function displayedPage(opts: { rtl: boolean; total: number; index: number }): number {
  if (opts.total <= 0) return 1;
  return opts.rtl ? opts.total - opts.index : opts.index + 1;
}

/** Inverse of `displayedPage`, for the page slider. */
export function indexForDisplayed(opts: { rtl: boolean; total: number; page: number }): number {
  const last = Math.max(0, opts.total - 1);
  const page = Math.min(Math.max(1, opts.page), Math.max(1, opts.total));
  return opts.rtl ? opts.total - page : page - 1;
}

/**
 * Did this horizontal drag turn the page, and in which direction?
 *
 * `advancing` means the drag moved towards the start of the book, which is
 * a leftward drag in a right-to-left manga — the way a physical page turns
 * when you are reading one.
 */
export function swipeDirection(
  dx: number,
  rtl: boolean
): { turn: boolean; advancing: boolean } {
  return { turn: true, advancing: rtl ? dx < 0 : dx > 0 };
}

/**
 * Which action a tap at this fraction of the viewport width performs.
 *
 * "left" and "right" are physical screen sides; the caller has already
 * translated them into an action, so the direction is in reading terms.
 */
export function tapZoneAction(frac: number): "left" | "right" | "toggle" {
  if (frac < 0.33) return "left";
  if (frac > 0.67) return "right";
  return "toggle";
}

/**
 * Resolve a tap's screen side into a reading action.
 *
 * The zones are laid out in reading order: the far side of the screen is
 * the far side of the book. In a right-to-left manga the next page is to
 * the left, matching a leftward swipe.
 */
export function tapAction(frac: number, rtl: boolean): "back" | "forward" | "toggle" {
  const zone = tapZoneAction(frac);
  if (zone === "toggle") return "toggle";
  const physicalLeft = zone === "left";
  const advancing = rtl ? physicalLeft : !physicalLeft;
  return advancing ? "forward" : "back";
}

/** Is the given action available? Used to disable the buttons. */
export function canAct(action: "back" | "forward", opts: DirectionOptions): boolean {
  return action === "forward" ? stepForward(opts) !== opts.index : stepBack(opts) !== opts.index;
}
