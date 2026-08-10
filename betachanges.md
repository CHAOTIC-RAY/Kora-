# Beta Changes & Release Notes

## Discover & Feed Enhancements
- **Feed Article Timestamp**: Added the exact publication date and time next to the "NEW"/"Read" badges in the immersive TikTok-style feed, formatting it natively based on the source's `publishedAt` timestamp.

## PDF Reader Enhancements
- **Auto-Sync Reading Progress**: Implemented a silent background auto-save mechanism in `BookReaderPDF.tsx` that debounces and automatically syncs the user's current reading page, total pages, and notes to the cloud without requiring manual button clicks.
- **Auto Reading Theme Support**: Added an EPUB-like Auto Theme setting (`getTimeOfDayAutoTheme`) that dynamically switches the PDF canvas reading theme (Light/Dark mode color inversions) based on the user's current local time of day.

## Read Tab Floating Side Action Buttons Lift (`bottom-36`)
- **Elevated Floating Side Action Buttons**: Shifted the right-side floating action button stack (`Filter`, `Save/Bookmark`, `Share`, `Daily Brief Zap`) in `FeedTikTokScroll.tsx` from `bottom-24` up to `bottom-36` on mobile devices. The action controls now rest comfortably in the middle-right area, preventing overlap with article headline text and floating navigation bar touch targets.

## Brand Consistency — Removed Wattpad Branding
- **Custom Kora Branding**: Removed all legacy external "Wattpad" mentions across the application (`CreateView.tsx`, `CommunityStoriesHub.tsx`, `DiscoverView.tsx`, and `firebase.ts`).
- **Updated Copy**: Replaced "Wattpad-style Community Stories" with **Community Web Stories & Novels** and **Kora Community**, highlighting Kora as its own standalone reading and publishing platform.

## PDF Reader Engine Overhaul & Fixes
- **HTML5 Canvas PDF Engine (`pdfjs-dist`)**: Replaced browser `<iframe>` embedding in `BookReaderPDF.tsx` with high-fidelity `pdfjs-dist` HTML5 canvas rendering. Solved the broken document sad-face icon issue in Chrome, iOS, and iframe environments.
- **Crisp HiDPI Display**: Integrated Retina device pixel ratio scaling (`window.devicePixelRatio`) to render PDF pages with crisp typography and zero blurriness.
- **Zoom & Navigation Controls**: Added responsive page controls (Previous/Next page buttons, jump to page input, keyboard arrow shortcuts `ArrowLeft`/`ArrowRight`, and zoom scale adjustments `0.6x` to `2.5x`).
- **Engine Switch Fallback**: Added a toggle option for users to switch between the HTML5 Canvas engine and native browser viewer if desired.

## PDF Reader Settings Bottom Sheet Modal
- **Bottom Sheet Drawer**: Transformed the PDF reader settings panel in `BookReaderPDF.tsx` from a side drawer into an elegant bottom sheet modal (`fixed inset-x-0 bottom-0 z-[120]`) that slides up smoothly from the bottom, matching the EPUB reader settings interface.
- **Integrated Controls**: Includes drag handle indicator, reading theme filters (`light`, `dark`, `sepia`, `green`), brightness slider, zoom scale, current/total page progress inputs, notes journal textarea, and cloud sync button.

## Discover View Sub-Tabs Simplification
- **Simplified Discover Navigation Tabs**: Removed the extra sub-tabs (`NYT Best Sellers`, `NetGalley Catalog`, `Goodreads Favorites`, and `Audiobooks`) from `DiscoverView.tsx` as requested.
- **Renamed "All Feeds" to "Archives"**: Renamed the primary feed catalog tab from "All Feeds" to **Archives**.
- **Streamlined Tab Bar**: Kept only **Archives** and **Community** tabs side-by-side in `DiscoverView.tsx` for a clean, focused search and discovery header.

## Mobile Read Tab & Feed View UI Fixes
- **Full-Bleed Viewport & Bottom Gap Fix (`fixed inset-0`)**: Updated the mobile TikTok scroll view container in `FeedTikTokScroll.tsx` from `bottom-[4.25rem]` to `fixed inset-0`. The news feed background canvas now fills 100% of the screen down to the bottom edge (`bottom-0`), completely eliminating the white gap beneath the floating bottom navigation bar.
- **Elevated Floating Action Buttons (`bottom-24` on Mobile)**: Lifted the right-side floating action button stack (`Filter`, `Save/Bookmark`, `Share`, `Daily Brief Zap`) from `bottom-5` to `bottom-24` on mobile. The action buttons now rest comfortably above the floating mobile footer, preventing overlap or obstructed touch targets.
- **Enhanced Article Text Bottom Padding (`pb-20`)**: Added `pb-20` bottom padding to the article headline and source container on mobile view, ensuring news titles and badges remain fully legible above the floating navigation bar.
- **App Header Overlay Fix (z-index correction)**: Set the mobile layout container's z-index inside `FeedTikTokScroll.tsx` to `z-[45]`. This allows the fixed full-bleed TikTok scroll layout (`top-0`) to perfectly stack above the main app header (`z-40`), completely hiding the main Kora navigation header on mobile devices, while remaining under the floating bottom tab bar (`z-50`) so tab navigation remains fully functional.
- **Top Bar Segments Hidden on Mobile**: Hid the horizontal segment progress indicator lines on mobile (`isMobile ? "hidden" : "top-3"`) to clean up the header area and match the original clean look of the GitHub version.
- **Immersive Corner-Anchored Mobile Controls**: Simplified the top floating header in the mobile TikTok scroll view (`FeedTikTokScroll.tsx`) to match the clean Github design. Replaced complex multi-button pill headers with two minimalistic, theme-adaptive, corner-anchored circular buttons (`w-10 h-10` with custom drop shadow & background blur): a "Manage Sources" (`Settings2`) button in the top-left and a "Refresh Feeds" (`RefreshCw`) button in the top-right. Removed the unnecessary "Filter" and "Grid Layout" toggle buttons from the top bar on mobile to maximize viewable screen space.
- **Theme-Adaptive Light & Dark Mode Styling**: Restored theme-aware styles across `FeedTikTokScroll.tsx`. In Light Mode, floating control pills (`Filter`, `Manage`, `Refresh`, `Grid`, `Save`, `Share`), slide scrims, background containers (`bg-kindle-bg`), text colors (`text-kindle-text`), and progress bars dynamically adapt to warm paper cream tones instead of forcing dark neutral colors. Added a live `MutationObserver` on `document.body` to seamlessly transition between Light and Dark themes in real time.
- **Tab Panel CSS Containment Fix**: Updated `.kora-tab-panel` in `src/index.css` from `contain: layout style` to `contain: style`. Removing layout containment prevents `position: fixed` mobile overlays (such as the TikTok news feed scroll) from being trapped inside constrained tab panel containers, allowing them to expand to the full viewport height without collapsing or leaving empty gaps above the bottom navigation bar.
- **Mobile Read Tab Full Screen Layout**: Configured `FeedTikTokScroll.tsx` to expand `fixed inset-x-0 top-0 bottom-[4.25rem]` seamlessly on mobile devices (`isMobile`), stretching across the full screen height above the bottom navigation bar without collapsing. Added an active `window` resize listener to dynamically update mobile state on device rotation or viewport size changes.
- **Top Control Bar & Progress Spacing**: Re-positioned floating control buttons (`Settings2` Manage, `Filter`, `RefreshCw`, `Grid` layout switch) to `top-2` and slide progress bars to `top-10`, ensuring no collision with app header text or notch status areas.
- **High-Contrast Dark Scrim & Typography**: Upgraded card overlay gradients to a high-contrast dark gradient scrim (`from-black/95 via-black/70 via-35% to-black/15`) paired with crisp white text (`text-white drop-shadow-md`). Guarantees 100% legibility over any news photo regardless of whether the light or dark app theme is active.
- **Bidirectional Layout Toggle (Scroll vs Grid)**: Added layout switcher buttons in both `FeedView.tsx` header and `FeedTikTokScroll.tsx` controls, allowing users to freely toggle between TikTok-style vertical scroll and Bento Grid view on mobile and desktop.
- **Action Button Safety**: Repositioned floating side buttons (`Filter`, `Bookmark`, `Share2`, `Zap`) to `bottom-5 right-3` to prevent text overlap and avoid collision with the bottom navigation bar.

## Community & Wattpad-Style Story Publishing
- **Community Discovery Hub Integration**: Mounted `CommunityStoriesHub` directly inside `DiscoverView.tsx` under the "Community" filter tab. Users can browse stories by genre (Fantasy, Romance, Sci-Fi, Mystery, YA, Fanfiction, etc.), view live read counts and likes, read chapters directly in an interactive chapter viewer, leave comments, and import stories straight into their Kora personal library.
- **Seamless Story Creator Workflow**: Connected `CreateView.tsx` and `DiscoverView.tsx` to `App.tsx` via `onOpenCreateView` and `onOpenCommunity`. Authors can click "Write & Publish Story" from the Community Hub to launch the Kora Story Studio, write or generate chapters, customize metadata, and publish directly to the global community feed.
- **Full Community Experience**: Built `CommunityStoriesHub.tsx` with support for reading community stories, liking, commenting, author attribution, and chapter selection.
- **Backend Sync**: Added Firestore support for `communityBooks` and `communityComments` collections in `src/lib/firebase.ts`, `firestore.rules`, and `firebase-blueprint.json`.
- **Firebase Helpers**: Exported `clearLibraryExcept` in `src/lib/firebase.ts` to support settings cleanup routines.

## Stability & Bug Fixes
- **SEO & Search Engine Metadata (`src/lib/seo.ts`)**: Created the missing SEO manager module supplying `setSeo` to dynamically manage document titles, meta descriptions, canonical URLs, and indexability across views.
- **APK Updater Exports (`src/lib/apkUpdater.ts`)**: Exported `getLocalAppInfo` and `rememberRemote` to resolve module import dependencies in the APK Update Banner component.
- **Story Creation Text Utilities (`src/lib/textUtils.ts` & `src/lib/htmlToMarkdown.ts`)**: Created string replace and HTML-to-Markdown conversion helpers required by the Story Studio authoring workflow.
- **FeedTikTokScroll Prop Destructuring**: Fixed a missing `onToggleLayout` parameter in `FeedTikTokScroll.tsx` destructuring that was throwing a runtime `ReferenceError` and triggering the global Error Boundary fallback ("Something went wrong").
- **TypeScript Type Safety**: Aligned `CommunityBook` schema (`likesCount`, `readsCount`) in `CommunityStoriesHub.tsx`, updated `addCommunityComment` user object parameter, corrected `BookMetadata` creation in `App.tsx`, and passed a `Set` to `clearLibraryExcept` in `SettingsView.tsx`.
