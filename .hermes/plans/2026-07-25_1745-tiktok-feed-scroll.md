# TikTok-Style News Scroll for the Feed Tab

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a vertical, full-viewport, swipe-to-advance "TikTok/Reels-style" news scroll to Kora's Feed tab, reusing the existing article data, cards, and fullscreen reader — without breaking the current card-grid Feed.

**Architecture:** Introduce a new optional view mode inside `FeedView`. A segmented control switches between the existing "Grid" layout and the new "Scroll" (TikTok) layout. The Scroll layout is a `100dvh` vertical snap container where each article is one full-screen slide (cover image + title + source + progress bar), swipeable via touch/pointer and keyboard (↑/↓, Space, Esc), with tap-to-open the existing `FeedArticleReader` and a "Save later" quick action. State (mode) persists to `localStorage`. No new data layer — reuse `visibleItems`, `getItemThumbnail`, `handleReadArticle`, `markFeedItemSaved`, `handleSaveLater`.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind (utility classes already used throughout), existing `FeedArticleCard` + `FeedArticleReader`. No new deps.

---

## Current context (verified read-only)

- Feed tab mounts `FeedView` at `src/App.tsx:2576` inside `{mountedTabs.has("feed") && …}`.
- `FeedView` renders a header + filter chips + a 2-col grid (`grid grid-cols-1 sm:grid-cols-2 gap-3`, `src/components/FeedView.tsx:668`) of `<FeedArticleCard>` in `visibleItems.map`.
- Existing handlers: `handleReadArticle(item)` (`FeedView.tsx:527`) opens `FeedArticleReader` via `setReadingArticle`. `handleSaveLater(item)` exists. `getItemThumbnail(item)`, `displayTitle(item)`, `getBentoVariant(index)` exist.
- `FeedArticleReader` (`src/components/FeedArticleReader.tsx`) is already a fullscreen reader that accepts `queue` and `onOpenItem` (paging) and `onClose`. So the TikTok scroll only handles *browsing*; reading is delegated to the existing reader.
- Theme vars (`bg-kindle-bg`, `text-kindle-text`, `kindle-accent`, `kindle-border`, `kindle-card`) are theme-aware — the scroll must use them so it works in dark/light/yellow/blue modes.
- Build: `npm run build` (no test script; build is the gate). `tsc` runs as part of build.

## Risks / tradeoffs

- **Don't replace the grid** — many users prefer scannable grid; make Scroll an opt-in toggle, default follows last choice (localStorage). Keep both code paths alive.
- **Auto-advance**: TikTok auto-plays video; we have text articles, so NO auto-advance/timer. Swipe/scroll only. (If desired later, add a per-article reading-time-based optional auto-advance — out of scope now.)
- **Virtualization**: feed lists can be long. Use `content-visibility:auto` on each slide (already used in Library) so off-screen slides don't cost layout. Only render the slide + 1 neighbor for images if perf demands; start simple (all slides in DOM, `content-visibility` handles cost).
- **Reduced motion / Performance Mode**: respect `prefers-reduced-motion` and the existing `kora_performance_mode` (disable snap scroll-behavior + transitions).
- iOS rubber-band: add `overscroll-behavior-y: contain` to the scroll container.

---

## Task 1: Add `feedLayout` persisted state to FeedView

**Objective:** Track and persist the user's Feed layout choice ("grid" | "scroll").

**Files:**
- Modify: `src/components/FeedView.tsx:55` (near `FeedFilter` type) and the component body (~line 100-160 where other `useState`s live).

**Step 1:** Add the type + state. Near line 55 (`type FeedFilter = …`) add:

```ts
type FeedLayout = "grid" | "scroll";
```

In the component body (with the other `useState` calls, ~line 120), add:

```ts
const [feedLayout, setFeedLayout] = useState<FeedLayout>(() => {
  const v = localStorage.getItem("kora_feed_layout");
  return v === "scroll" || v === "grid" ? v : "grid";
});
const persistFeedLayout = (next: FeedLayout) => {
  setFeedLayout(next);
  localStorage.setItem("kora_feed_layout", next);
};
```

**Step 2:** No test infra (no test script). Verify by `npm run build` compiles.

**Step 3:** Commit.
```bash
git add src/components/FeedView.tsx
git commit -m "feat(feed): persist feed layout choice (grid|scroll)"
```

## Task 2: Add the layout segmented control to the Feed header

**Objective:** Let the user switch between Grid and Scroll modes from the header.

**Files:**
- Modify: `src/components/FeedView.tsx` — the `<header>` block (lines ~562-575) where filter chips live. Insert the toggle next to existing filter chips.

**Step 1:** Add a small segmented control. After the existing filter `<div className="flex gap-2 overflow-x-auto …">` (line 617) insert:

```tsx
<div className="flex items-center gap-1 rounded-xl border border-kindle-border bg-kindle-bg p-0.5 shrink-0">
  {(["grid", "scroll"] as FeedLayout[]).map((mode) => (
    <button
      key={mode}
      type="button"
      onClick={() => persistFeedLayout(mode)}
      aria-pressed={feedLayout === mode}
      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition ${
        feedLayout === mode
          ? "bg-kindle-text text-kindle-bg"
          : "text-kindle-text-muted hover:text-kindle-text"
      }`}
    >
      {mode === "grid" ? "Grid" : "Scroll"}
    </button>
  ))}
</div>
```

**Step 2:** Build.
```bash
npm run build 2>&1 | tail -3   # expect BUILD_EXIT=0
```

**Step 3:** Commit.
```bash
git add src/components/FeedView.tsx
git commit -m "feat(feed): grid/scroll layout toggle in header"
```

## Task 3: Create `FeedTikTokScroll.tsx`

**Objective:** Build the vertical full-screen snap-scroll component that renders one article per viewport slide.

**Files:**
- Create: `src/components/FeedTikTokScroll.tsx`

**Step 1:** Write the component. Key behaviors:
- Outer: `h-[100dvh] w-full overflow-y-auto snap-y snap-mandatory overscroll-contain scrollbar-none` (disable snap if `perfMode`).
- Each slide: `h-[100dvh] snap-start relative flex flex-col justify-end p-4 md:p-6` with `content-visibility:auto`.
- Slide content (bottom-anchored, readable over cover): gradient scrim + source chip + title (`text-2xl font-lexend font-bold`) + progress bar (read %).
- Tap on slide body → `onRead(item)`. Quick "Save" pill top-right → `onSave(item)`. Down-chevron hint at bottom.
- Keyboard: attach `onKeyDown` on the scroll container: ArrowDown/Space → `scrollTo` next slide; ArrowUp → prev; Esc → `onExit?()`.
- Track active index via `IntersectionObserver` to update a top progress dots row (optional, keep minimal: a thin progress bar showing `activeIndex+1 / total`).

```tsx
import React, { useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown } from "lucide-react";
import type { FeedItem } from "../lib/feedStorage";
import { getItemThumbnail } from "../lib/feedPreview";

interface Props {
  items: FeedItem[];
  grayscaleCovers?: boolean;
  perfMode?: boolean;
  onRead: (item: FeedItem) => void;
  onSave: (item: FeedItem) => void;
  onExit?: () => void;
}

export default function FeedTikTokScroll({ items, grayscaleCovers, perfMode, onRead, onSave, onExit }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const go = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const next = Math.min(items.length - 1, Math.max(0, active + dir));
    el.children[next]?.scrollIntoView({ behavior: perfMode ? "auto" : "smooth" });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          const idx = Array.prototype.indexOf.call(el.children, e.target);
          if (idx >= 0) setActive(idx);
        }
      }),
      { root: el, threshold: 0.6 }
    );
    Array.from(el.children).forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [items.length]);

  return (
    <div
      ref={ref}
      className={`h-[100dvh] w-full overflow-y-auto overscroll-contain scrollbar-none ${
        perfMode ? "" : "snap-y snap-mandatory"
      }`}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === " ") { e.preventDefault(); go(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); go(-1); }
        else if (e.key === "Escape") onExit?.();
      }}
      tabIndex={0}
    >
      <div className="sticky top-0 z-10 flex gap-1 px-4 pt-3">
        {items.map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i <= active ? "bg-kindle-accent" : "bg-white/20"}`} />
        ))}
      </div>
      {items.map((item) => {
        const cover = getItemThumbnail(item);
        return (
          <section
            key={item.id}
            className="relative h-[100dvh] snap-start flex flex-col justify-end p-4 md:p-6"
            style={{ contentVisibility: "auto" }}
          >
            {cover ? (
              <img
                src={cover}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
                className={`absolute inset-0 w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`}
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
            <button
              type="button"
              onClick={() => onSave(item)}
              className="absolute top-12 right-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white"
            >
              <Bookmark className="w-3.5 h-3.5" /> Save
            </button>
            <div className="relative z-10 text-white" onClick={() => onRead(item)}>
              <span className="inline-block text-[10px] font-bold uppercase tracking-widest text-white/80 mb-2">
                {item.subscriptionTitle}
              </span>
              <h2 className="text-2xl md:text-3xl font-lexend font-bold leading-tight mb-3 line-clamp-4">
                {item.title}
              </h2>
              <div className="flex items-center gap-2 text-[11px] text-white/70">
                <span>{item.read ? "Read" : "New"}</span>
                <ChevronDown className="w-4 h-4 animate-bounce" />
                <span className="ml-auto">{active + 1}/{items.length}</span>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

**Step 2:** Build (`npm run build` → BUILD_EXIT=0). The component is imported in Task 4.

**Step 3:** Commit.
```bash
git add src/components/FeedTikTokScroll.tsx
git commit -m "feat(feed): add TikTok-style vertical snap-scroll component"
```

## Task 4: Wire `FeedTikTokScroll` into `FeedView` (conditional render)

**Objective:** Render the Scroll layout instead of the grid when `feedLayout === "scroll"`.

**Files:**
- Modify: `src/components/FeedView.tsx`
  - Add import: `import FeedTikTokScroll from "./FeedTikTokScroll";` (top imports, ~line 44).
  - Wrap the existing items block (lines 664-697, the `space-y-4` + grid) so it only renders in grid mode, and render `<FeedTikTokScroll>` in scroll mode.

**Step 1:** At line ~662 (just before `<div className="space-y-4">` at 664), insert a mode branch:

```tsx
{feedLayout === "scroll" ? (
  <FeedTikTokScroll
    items={visibleItems}
    grayscaleCovers={grayscaleCovers}
    perfMode={performanceMode}
    onRead={(item) => void handleReadArticle(item)}
    onSave={(item) => void handleSaveLater(item)}
  />
) : (
  <div className="space-y-4">
    {filter === "all" && !selectedSubscriptionId && (
      <TodayNewsBriefCard items={retainedItems} onReadArticle={handleReadArticle} />
    )}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {visibleItems.map((item, index) => {
        const cover = getItemThumbnail(item);
        const title = displayTitle(item);
        return (
          <FeedArticleCard
            key={item.id}
            item={item}
            cover={cover}
            busy={false}
            title={title}
            variant={getBentoVariant(index)}
            grayscaleCovers={grayscaleCovers}
            onRead={() => void handleReadArticle(item)}
            onToggleRead={() => {
              const nextRead = !item.read;
              markFeedItemRead(item.id, nextRead);
              setItems(getFeedItems());
              toast.success(nextRead ? "Marked as read" : "Marked as unread");
            }}
            onSaveLater={() => void handleSaveLater(item)}
          />
        );
      })}
    </div>
  </div>
)}
```

Note: this replaces the existing `space-y-4`+grid block (lines 664-697). Keep `showManageFeeds` modal and `readingArticle`/`FeedArticleReader` unchanged below.

**Step 2:** Add a `performanceMode` source. Check if `perfMode` already exists in FeedView; if not, read it once: at the other useState block add `const performanceMode = localStorage.getItem("kora_performance_mode") === "1";` (read-only is fine; Settings already writes it).

**Step 3:** Build.
```bash
npm run build 2>&1 | tail -3   # BUILD_EXIT=0
```

**Step 4:** Commit.
```bash
git add src/components/FeedView.tsx src/components/FeedTikTokScroll.tsx
git commit -m "feat(feed): render TikTok scroll when layout=scroll"
```

## Task 5: Mobile tab-bar safe area + Scroll mode height

**Objective:** Ensure the 100dvh scroll doesn't hide behind the floating mobile tab bar.

**Files:**
- Modify: `src/components/FeedTikTokScroll.tsx` (slide height) and/or `src/App.tsx` feed mount wrapper.

**Step 1:** In `FeedTikTokScroll`, change the slide + scroll height to account for the bottom tab bar. Use `h-[calc(100dvh-4rem)]` (the mobile tab bar is ~4rem) instead of `h-[100dvh]` for both the outer scroll and each `<section>`, and add `pb-16` to the last slide. Simplest: replace `h-[100dvh]` (3 occurrences: outer, sticky parent not, section) → `h-[calc(100dvh-4rem)]` for outer + section; keep sticky progress bar. Alternatively apply a CSS var `--kora-tabbar-h` if defined. Verify the mobile tab bar height constant used elsewhere (search `h-16` in App header / tab bar).

**Step 2:** Build + visual check on a phone viewport (DevTools device toolbar, 390x844). Confirm each slide ≈ one screen, swipe snaps, tap opens reader, Save works, Esc/← exits to grid.

**Step 3:** Commit.
```bash
git add src/components/FeedTikTokScroll.tsx
git commit -m "fix(feed): fit TikTok scroll to mobile tab bar height"
```

## Task 6: Deploy + verify

**Objective:** Ship and sanity-check live.

**Files:** none (deploy only).

**Step 1:** Build.
```bash
npm run build 2>&1 | tail -3   # BUILD_EXIT=0
```

**Step 2:** Deploy.
```bash
npx wrangler deploy
```

**Step 3:** Manual verification (state to user):
- Open Feed tab → toggle "Scroll" → each article is a full screen, swipe up/down snaps, tap opens fullscreen reader, Save pill works.
- Toggle back to "Grid" → original layout intact.
- Switch theme (dark/light/yellow/blue) → scroll uses theme vars, readable.
- Enable Performance Mode in Settings → snap/scroll-smooth disabled.

---

## Files likely to change
- `src/components/FeedView.tsx` (state, toggle, conditional render)
- `src/components/FeedTikTokScroll.tsx` (NEW)
- `src/App.tsx` (only if tab-bar height needs a shared var; optional)

## Validation
- `npm run build` exits 0 (tsc + vite). No test script exists.
- Manual: phone viewport, both layout modes, theme switch, performance mode.

## Open questions
- Default mode: plan defaults to "grid" (preserves current behavior). If you'd rather default new users to Scroll, set the default in Task 1 to `"scroll"`.
- Auto-advance: intentionally omitted (text articles, not video). Can add a reading-time timer later if wanted.
- Should the Scroll mode also replace the "Today in Brief" hero (`TodayNewsBriefCard`)? Plan keeps it in grid mode only; Scroll starts at article 1. Say the word if you want the brief as the first slide.
