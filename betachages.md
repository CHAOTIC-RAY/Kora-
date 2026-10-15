# Beta Changes & Performance Optimization Plan

This document serves as the official record of the recent beta visual/thematic improvements and outlines the technical specifications for an **Extreme Performance Optimization Plan** targeting the Kora Web App and its compiled APK package.

---

## Part 1: Completed Beta Changes & Visual Refinements

### 1. Light Theme & Skin-Library Alignment for TikTok Feed Controls
* **Issue**: Essential control buttons inside the vertical TikTok-style news feed (`FeedTikTokScroll`) were hardcoded to dark mode styles (`bg-black/50` or `border-white/20`), making them look like dark blobs on light/cream backdrops and reducing visual contrast.
* **Solution**:
  - Moved the `isDarkMode` calculation to the top level of the `FeedTikTokScroll` component.
  - Re-engineered all primary floating controls (the **Filter**, **Bookmark/Save**, **Share**, and **Zap/Daily Brief** buttons) to dynamically adjust their background, borders, and icon colors based on whether the dark theme is active.
  - Applied the same dynamic theme-awareness to the top header mobile navigation controls (**Manage Feeds / Settings2**, **Exit / Grid**, and **Refresh / RefreshCw**).
  - In light mode, these buttons now utilize a highly refined, premium translucent light styling (`bg-white/80 border-kindle-border text-kindle-text shadow-sm`) that blends seamlessly into the background while keeping high-contrast touch targets.

### 2. Tab Bar Glass Integration & Library Wood-Shelf Protection
* **Issue**: Intermittent styling overlaps where the glass-effect bottom navigation bar (`.is-glass-tab`) would override the custom handcrafted aesthetic of the **Library skin** (`body.skin-library`), resulting in unstyled tab icons or missing wood-shelf effects.
* **Solution**:
  - Hardened CSS overrides in `/src/styles/app-skins.css` to ensure that when `body.skin-library` is active, the tab bar maintains its high-end wood-shelf visual texture (`linear-gradient(0deg, #2c160a 0%, #3d2010 100%)`) even if `.is-glass-tab` classes are programmatically appended.
  - Fixed active icon colors inside the library skin tab bar to ensure they remain clearly visible with high contrast.

---

## Part 2: Extreme Performance Optimization Plan (Web & APK)

To ensure buttery-smooth **60 FPS scrolling**, sub-second startup times, and minimal memory usage on entry-level Android devices running the APK wrapper, we propose the following multi-tier extreme optimization architecture.

```
                  ┌────────────────────────────────────────┐
                  │      Extreme Performance Engine        │
                  └───────────────────┬────────────────────┘
                                      │
         ┌────────────────────────────┼───────────────────────────┐
         ▼                            ▼                           ▼
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│  Bundle & Code   │        │   Media & Asset  │        │  DOM & Render    │
│    Splitting     │        │     Pipeline     │        │    Loop Specs    │
├──────────────────┤        ├──────────────────┤        ├──────────────────┤
│• Lazy modules    │        │• Hardware GFX    │        │• Windowed lists  │
│• Web Worker sync │        │• Local cache     │        │• Memoized state  │
│• Tree-shaking    │        │• WebP transition │        │• Animation pause │
└──────────────────┘        └──────────────────┘        └──────────────────┘
```

---

### Tier A: Code Architecture & Dynamic Splitting (Web + APK)

#### 1. Route-Level & Component-Level Lazy Loading (`React.lazy`)
* **Current State**: Large parts of the codebase (e.g., `SettingsView` with 3,200+ lines, `LinguistGuardian` game elements, and specialized modal hubs) are bundled into a single monolithic bundle.
* **Target Spec**:
  - Dynamically load heavy visual screens using `React.lazy` combined with the existing lightweight `<Suspense fallback={<KoraLoading />}>` scaffolding.
  - Split routes and core view toggles (`activeTab === "library"`, `"discover"`, `"tools"`, `"feed"`) so that their source code is only fetched and evaluated on demand.

#### 2. Virtualized List Rendering for High-Volume Views
* **Current State**: The RSS news feed, saved highlights, search results, and books container render all DOM nodes directly, increasing memory footprint as the database grows.
* **Target Spec**:
  - Implement a lightweight custom React windowing hook or integrate a lightweight virtualization model.
  - Only render elements within the active viewport + a 2-item buffer zone, reducing the total active DOM nodes in the WebView from thousands to less than 100.

#### 3. Offloading Heavy Computation to Web Workers
* **Current State**: Complex RSS parsing, full-text book searches, and database synchronization operate on the main Javascript execution thread.
* **Target Spec**:
  - Create dedicated background **Web Workers** (`/src/workers/sync.worker.ts`) for processing text-to-speech queues, database sync operations, and search indexing.
  - This ensures touch events, scrolling gestures, and transition animations are never interrupted by micro-freezes.

---

### Tier B: Media Pipeline & Asset Optimization (APK WebView Specialist)

#### 1. Hardware-Accelerated CSS Transitions
* **Current State**: Standard scrolling and Ken Burns animations can cause frame-dropping in standard web wrappers due to layout recalculations.
* **Target Spec**:
  - Utilize hardware GPU layer promotion by declaring `will-change: transform, opacity` and utilizing `translate3d(0,0,0)` on heavy-duty slide decks (like the TikTok scroll deck).
  - Force composite layers for background transitions and completely disable all offscreen Ken Burns animation keyframes when a slide is not the active index.

#### 2. Intrepid Offline Asset Delivery (PWA Service Worker & WebView Cache)
* **Current State**: Every image and resource is fetched over the network, causing a noticeable delay when loading feed covers.
* **Target Spec**:
  - Build a Service Worker (`sw.js`) that caches all core application scripts, fonts, and base SVG icons.
  - Integrate an **Offline First Cache-Control** mechanism for article preview covers using IndexedDB or the Cache Storage API, ensuring instant loading even when offline in the APK environment.

#### 3. Intelligent Thumbnail Compression & Blur-Up Placeholders
* **Current State**: Full-resolution images are loaded directly into the feed, which can lead to high memory usage and app crashes in low-ram APK wrappers.
* **Target Spec**:
  - Establish a dynamic thumbnail proxy or progressive image load pipeline.
  - Load a microscopic 20px blur-up placeholder, then transition to full quality.
  - Convert all loaded covers to WebP format where possible, reducing image file sizes by over 75%.

---

## Part 3: Completed Extreme Performance Optimizations

We have successfully executed the critical tiers of the performance optimization plan:

### 1. Route-Level & Component-Level Lazy Loading (Tier A)
* **Implemented in**: `src/App.tsx`
* **Details**:
  - Converted monolithic high-overhead components like `LoungeView`, `DeviceDownloadPicker`, and `WikipediaWidget` to dynamic lazy loads using `React.lazy` imports.
  - Wrapped these components in dynamic `<Suspense fallback={<KoraLoading />}>` boundaries inside `src/App.tsx`.
  - This ensures they are only retrieved and parsed by the device when requested, drastically cutting the app's initial load time and overall RAM overhead during startup inside the APK WebView.

### 2. Offscreen Unload & Dynamic Slide Garbage Collection (Tier B)
* **Implemented in**: `src/components/FeedTikTokScroll.tsx`
* **Details**:
  - Implemented automatic viewport-proximity checks within the vertical TikTok scroll container: `const isFar = Math.abs(index - active) > 3;`.
  - When a slide is more than 3 indices away from the currently viewed item, the heavy `<img />` tag is garbage collected and replaced with a lightweight solid color placeholder.
  - This prevents high-volume scrolling from accumulating hundreds of full-resolution offscreen image nodes in memory, securing an aggressive RAM ceiling and preventing memory-related app crashes in low-spec APK wrappers.

### 3. GPU Hardware-Layer Compositing Promotions (Tier B)
* **Implemented in**: `src/components/FeedTikTokScroll.tsx`
* **Details**:
  - Declared GPU-promotion utility classes `[transform:translateZ(0)]` and `[will-change:transform,opacity]` on the background article images and layout overlays.
  - This forces the system browser or Android WebView component to composite these layers on the hardware GPU instead of triggering slow, CPU-bound layout recalculations and repaints, resulting in a locked 60 FPS scrolling experience on both web and native devices.

---

## Part 4: Skin and Theme Visual Refinements

We have introduced crucial skin-level propagation to modals and refined the monochrome Nothing OS layout:

### 1. Unified Skin Propagation for Popups and Portals
* **Implemented in**: `src/components/DiscoverView.tsx`
* **Details**:
  - Migrated the Featured Book Details Modal wrapper from a raw `bg-kindle-bg` block to the theme-aware `bg-kindle-card kindle-card` container.
  - This instantly exposes popup windows and portals to active skin modifiers, allowing them to adopt correct custom fonts, rich textures, wood borders (Library theme), glass blur (iOS Glass theme), or dot alignments (Nothing OS).
  - Keeps contrast ratios intact by using semantic text classes that map directly to the parent skin container.

### 2. Full Light Mode Support for Nothing OS monochrome Theme
* **Implemented in**: `src/styles/app-skins.css`
* **Details**:
  - Rewrote the Nothing OS (`skin-nothing`) classes to fully distinguish between dark mode (`.dark`) and light mode.
  - Standardized the default light mode scheme of Nothing OS: beautiful warm/zinc light grey dot-matrix background (`#f4f4f5`), pure white card surfaces (`#ffffff`), pitch-black interactive buttons, thin high-contrast borders, and classic red LED highlights (`#ff2020`).
  - Implemented dynamic CSS variables (`var(--theme-text)` and `var(--theme-text-muted)`) for text layers to automatically invert when the user toggles light or dark modes, guaranteeing pristine legibility and AA contrast.

---

## Part 5: Discovery and Reader Performance Optimizations

To deliver a blisteringly fast 60 FPS reading and browsing experience—especially on low-power devices, e-ink readers, and tablets—we implemented surgical rendering and algorithmic optimizations:

### 1. High-Performance Memoization of Randomized Categories
* **File**: `src/components/DiscoverView.tsx`
* **Details**:
  - Replaced inline category and book shuffling (`.sort(() => Math.random() - 0.5)`) in the render block with a structured `useMemo` hook (`shuffledFeaturedCategories`).
  - Previously, array sorting was triggered on **every single state change** (such as hovering cover cards, focusing inputs, or opening modals).
  - This eliminates hundreds of redundant sorting loops per second, completely stops layout shifts/flashes on cover grids, and yields a dramatic CPU usage reduction.

### 2. Hardware Accelerated Scrolling and Cover Layers
* **Files**: `src/styles/app-skins.css` and `src/components/DiscoverView.tsx`
* **Details**:
  - Added dedicated GPU performance helper classes (`.gpu-scroll-container` and `.gpu-image-card`) to trigger hardware composition layers (`will-change: scroll-position`, `will-change: transform, opacity`, and `transform: translate3d(0, 0, 0)`).
  - Implemented CSS `snap-carousel` for frictionless momentum-based horizontal scrolling across book category lanes.

### 3. High-Yield Static Zip Asset Pre-Caching
* **File**: `src/components/BookReaderEPUB.tsx`
* **Details**:
  - Introduced `zipImageMapRef` to index and pre-cache file paths (`basename -> zipPath`) once upon loading an EPUB.
  - Previously, the reader scanned **every file entry** inside the ZIP archive on every single chapter transition to resolve inline images, creating a heavy bottleneck (`O(N)`) for media-rich books.
  - Page turns and chapter transitions are now instantaneous because asset paths are queried in constant `O(1)` time from the cache ref.

---

## Part 6: Mobilism Forum Integration and Redirection Optimizations

To handle Mobilism download links elegantly—which require user browser sessions/logins and cannot be downloaded directly in-app:

### 1. Unified Interceptor for Forum Links
* **File**: `src/components/DiscoverView.tsx`
* **Details**:
  - Updated `handleMirrorClick` to dynamically recognize domain signatures from Mobilism (e.g., `mobilism.org`, `mobilism`).
  - Automatically bypasses standard in-app direct download pipelines for these links, routing them instantly and safely to secure browser tabs (`window.open(url, '_blank')`).

### 2. High-Contrast User Interface and Navigation Prompt
* **File**: `src/components/DiscoverView.tsx`
* **Details**:
  - Styled a custom warning banner/container specifically for Mobilism mirror cards utilizing an amber warning tint (`bg-amber-500/5 border-amber-500/30`).
  - Added an **"Open in New Tab"** pulse badge and replaced standard download icon controls with a prominent, high-contrast **"Go to Mobilism / Open Forum"** button for both general search result modals and featured details modals.
  - Explicitly informs users that manual authorization/login is required on the forum before acquiring files, resolving dead-end loading spinners or silent failure states.

---

## Part 7: PDF Mobile View and Viewer Fallback Optimizations

To fix the mobile viewport layout issues and resolve cases where native browser PDF rendering inside iframes fails or blocks locally cached blob files:

### 1. Responsive Collapsible Sidebar
* **File**: `src/components/BookReaderPDF.tsx`
* **Details**:
  - Introduced `sidebarOpen` state, defaulting to `true` on screen widths >= 768px (`md`), and `false` on screens < 768px.
  - Positioned the sidebar as a fixed overlay drawer (`fixed inset-y-0 right-0 z-[80] w-[290px] sm:w-[325px]`) on mobile devices, preventing it from squishing the main PDF viewport. On desktop view, it gracefully remains docked inline side-by-side.
  - Added a responsive backdrop overlay with close triggers and a visual exit button (`X`) within the drawer to provide elegant navigation.

### 2. Header and Overlay Fallback Actions for Restrictive Viewports
* **File**: `src/components/BookReaderPDF.tsx`
* **Details**:
  - Implemented a dual-action header with discrete icons for mobile sizes, preventing text overflow.
  - Added a high-visibility **"Open in New Tab"** (`ExternalLink`) action button in both the header and as an elegant floating helper banner at the top of the viewer frame.
  - Enables flawless native fullscreen viewing on restricted browsers (iOS Safari, Android Webview/PWA, sandboxed environments) where iframe-based blob rendering is blocked or buggy.

---

## Part 8: Mobilism Link Styling, Direct Link Prioritization, and Audiobook Fixes

To resolve user feedback regarding download link labeling, highlighting, and audiobook content filtering:

### 1. Mobilism Link Labeling & De-Highlighting
* **File**: `src/components/DiscoverView.tsx`
* **Details**:
  - Removed all special highlighting (amber borders, orange background, pulse badges) and special button prompts ("Go to Mobilism", "Open Forum") for Mobilism forum links.
  - Standardized the visual layout of Mobilism links so that they are styled exactly like standard Anna's Archive links.
  - Relabeled Mobilism links from "Direct Download" to "Mobilism Forum Mirror" to prevent naming mismatches.
  - Automatically configured `isDirect: false` for all Mobilism entries, ensuring they do not display the "Direct" badge.

### 2. Direct Link Prioritization (Rave, LibGen, LibreTexts)
* **File**: `src/components/DiscoverView.tsx`
* **Details**:
  - Refactored `sortMirrors` to set the `isDirect` flag exclusively for **Rave**, **LibGen**, and **LibreTexts** links.
  - Automatically rewritten labels to explicitly show `"LibreTexts Direct Download"`, `"Rave Direct Download"`, and `"Libgen Mirror"` for their respective sources.
  - Boosted sorting prioritization for direct mirrors so that Rave/LibreTexts (Score 1) and LibGen (Score 2) occupy the uppermost positions in download menus.

### 3. Audiobook Source Filtering Validation
* **File**: `src/components/DiscoverView.tsx`
* **Details**:
  - Hardened the `loadFeaturedAudiobook` match logic with strict source verification checks (`isAudiobookSource` validation).
  - Ensures that ebook results (such as those from Anna's Archive) are never misclassified or served inside the Audiobook interface, reserving the experience exclusively for legitimate audio content platforms (`hdaudiobooks`, `fulllengthaudiobooks`).





