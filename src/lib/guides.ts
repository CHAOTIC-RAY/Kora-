/**
 * Interactive guides — catalog, persistence, and helpers.
 * Status: pending | completed | dismissed (swipe forever).
 */

export type GuideId =
  | "sync-setup"
  | "first-book-search"
  | "reader-tour"
  | "news-feed"
  | "narrator-mode"
  | "audiobook-generator"
  | "add-news-source";

export type GuideStatus = "pending" | "completed" | "dismissed";

export type GuideStepAction = "next" | "tap-target" | "wait-event";

export type GuideStep = {
  id: string;
  title: string;
  body: string;
  /** CSS selector; prefer [data-guide="…"] */
  target?: string;
  /** Switch app tab before showing this step */
  tab?: "lounge" | "library" | "discover" | "feed" | "tools" | "settings";
  action?: GuideStepAction;
  /** CustomEvent name when action === wait-event */
  event?: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  /** Optional CTA label when action is next */
  cta?: string;
};

export type GuideDefinition = {
  id: GuideId;
  title: string;
  short: string;
  /** Shown on Lounge widget */
  blurb: string;
  icon: "cloud" | "search" | "book" | "rss" | "headphones" | "wrench" | "plus";
  /** Part of the post-onboarding forced journey */
  journey?: boolean;
  /** Eligible for Lounge random widgets */
  loungeWidget?: boolean;
  steps: GuideStep[];
};

const STORAGE_KEY = "kora_guides_status_v1";
const JOURNEY_KEY = "kora_guides_journey_v1";

export const GUIDE_CATALOG: GuideDefinition[] = [
  {
    id: "sync-setup",
    title: "Sync & account",
    short: "Keep your shelf across devices",
    blurb: "Sign in once so progress, highlights, and library metadata follow you. Files stay on-device.",
    icon: "cloud",
    journey: true,
    loungeWidget: true,
    steps: [
      {
        id: "sync-intro",
        title: "Cross-device sync",
        body: "Kora syncs library metadata when you sign in. Book files stay on each device — use peer transfer or WebDAV in Tools for files.",
        tab: "lounge",
        action: "next",
        cta: "Show me where",
      },
      {
        id: "sync-sign-in",
        title: "Sign in (optional)",
        body: "Tap Sign in in the header to create an account, or continue as a guest. You can always sign in later from Settings.",
        target: '[data-guide="auth-open"]',
        tab: "lounge",
        action: "next",
        cta: "Continue",
      },
      {
        id: "sync-tools",
        title: "Devices & Sync",
        body: "In Tools → Devices & Sync you can name this device, enable peer sharing, or connect WebDAV.",
        target: '[data-guide="nav-tools"]',
        tab: "tools",
        action: "tap-target",
      },
      {
        id: "sync-panel",
        title: "Open Devices & Sync",
        body: "Tap Sync to jump to Devices & Sync and review this device. When you're ready, continue.",
        target: '[data-guide="tools-sync"]',
        tab: "tools",
        action: "next",
        cta: "Done with sync",
      },
    ],
  },
  {
    id: "first-book-search",
    title: "Find your first book",
    short: "Search & download from Discover",
    blurb: "We'll walk you through searching Discover and starting a download.",
    icon: "search",
    journey: true,
    loungeWidget: true,
    steps: [
      {
        id: "search-tab",
        title: "Open Discover",
        body: "Discover is where you search archives, bestsellers, and audiobooks. Tap Discover to continue.",
        target: '[data-guide="nav-discover"]',
        action: "tap-target",
      },
      {
        id: "search-box",
        title: "Search for a title",
        body: "Type a book you love — title or author — then submit. Try something you already know so the download is easy to spot.",
        target: '[data-guide="discover-search"]',
        tab: "discover",
        action: "wait-event",
        event: "kora-guide:search-submitted",
      },
      {
        id: "search-result",
        title: "Pick a result",
        body: "Tap a cover or result to open details, then start the download. Kora will move you to Library when the file is ready.",
        target: '[data-guide="discover-results"]',
        tab: "discover",
        action: "wait-event",
        event: "kora-guide:book-added",
      },
      {
        id: "search-open",
        title: "Open it to read",
        body: "Great — your book is on the shelf. Open it from Library (or Continue on Lounge) to learn the reader.",
        target: '[data-guide="nav-library"]',
        tab: "library",
        action: "wait-event",
        event: "kora-guide:reader-opened",
      },
    ],
  },
  {
    id: "reader-tour",
    title: "Reader studio",
    short: "Settings, narrator, notes",
    blurb: "Learn display settings, Voice Narrator, highlights, and chapter notes inside a book.",
    icon: "book",
    journey: true,
    loungeWidget: true,
    steps: [
      {
        id: "reader-settings",
        title: "Display settings",
        body: "Tap the gear to tune font size, theme, margins, and page-turn style. Your eye comfort lives here.",
        target: "#toggle-settings-btn",
        action: "tap-target",
      },
      {
        id: "reader-settings-done",
        title: "Tune to taste",
        body: "Adjust anything you like, then close the panel (or tap Next) when you're ready for Voice Narrator.",
        target: '[data-guide="reader-settings-panel"], #toggle-settings-btn',
        action: "next",
        cta: "Next: Narrator",
      },
      {
        id: "reader-narrator",
        title: "Voice Narrator",
        body: "Tap the headphones icon to hear the page read aloud. Speed and voice are under Tools → Read Aloud for conversions.",
        target: "#toggle-audiobook-btn",
        action: "tap-target",
      },
      {
        id: "reader-narrator-done",
        title: "Listen or pause",
        body: "Play a few sentences, then continue. Narrator works offline with the built-in voices on your device.",
        action: "next",
        cta: "Next: Notes",
      },
      {
        id: "reader-notes",
        title: "Highlights & notes",
        body: "Open Highlights & Notes. Long-press text in the page to select, highlight, or look up a word.",
        target: '[data-guide="reader-notes-btn"]',
        action: "tap-target",
      },
      {
        id: "reader-select",
        title: "Try a selection",
        body: "Long-press a word on the page. You'll get highlight, note, and dictionary actions. That finishes the reader tour.",
        action: "wait-event",
        event: "kora-guide:text-selected",
      },
    ],
  },
  {
    id: "news-feed",
    title: "Morning paper",
    short: "Read tab & headlines",
    blurb: "Swipe stories, save for later, and skim your Daily Brief from sources you picked.",
    icon: "rss",
    journey: true,
    loungeWidget: true,
    steps: [
      {
        id: "feed-open",
        title: "Open Read",
        body: "Your news lives on the Read tab. We'll switch there for you — watch the nav highlight.",
        target: '[data-guide="nav-feed"]',
        tab: "feed",
        action: "next",
        cta: "Show my feeds",
      },
      {
        id: "feed-cards",
        title: "Swipe the cards",
        body: "Swipe a headline right to mark read, left to save. Tap a card to open the article reader.",
        target: '[data-guide="feed-list"]',
        tab: "feed",
        action: "next",
        cta: "Got it",
      },
      {
        id: "feed-manage",
        title: "Manage sources",
        body: "Tap Manage anytime to toggle Maldives / international feeds or add a custom RSS URL.",
        target: '[data-guide="feed-manage"]',
        tab: "feed",
        action: "tap-target",
      },
    ],
  },
  {
    id: "narrator-mode",
    title: "Try Voice Narrator",
    short: "Hands-free reading",
    blurb: "Open any ebook and start Voice Narrator for the first time.",
    icon: "headphones",
    loungeWidget: true,
    steps: [
      {
        id: "narrator-open-book",
        title: "Open a book",
        body: "Open any EPUB from Library or Lounge Continue, then we'll highlight Narrator.",
        tab: "library",
        action: "wait-event",
        event: "kora-guide:reader-opened",
      },
      {
        id: "narrator-tap",
        title: "Start Narrator",
        body: "Tap headphones to start listening. Pause anytime from the mini player.",
        target: "#toggle-audiobook-btn",
        action: "tap-target",
      },
      {
        id: "narrator-done",
        title: "You're set",
        body: "Narrator remembers pace in Tools. Enjoy hands-free chapters.",
        action: "next",
        cta: "Done",
      },
    ],
  },
  {
    id: "audiobook-generator",
    title: "Audiobook generator",
    short: "Turn text into audio",
    blurb: "Use Tools → Read Aloud to convert chapters into an offline audiobook.",
    icon: "wrench",
    loungeWidget: true,
    steps: [
      {
        id: "tts-nav",
        title: "Open Tools",
        body: "Audiobook conversion lives under Tools. Tap Tools to continue.",
        target: '[data-guide="nav-tools"]',
        action: "tap-target",
      },
      {
        id: "tts-tile",
        title: "Read Aloud",
        body: "Tap Read Aloud to jump to the built-in audiobook converter.",
        target: '[data-guide="tools-tts"]',
        tab: "tools",
        action: "tap-target",
      },
      {
        id: "tts-panel",
        title: "Generate audio",
        body: "Pick a book from your library, choose a voice, and generate. Files stay on this device for offline listening.",
        target: '[data-guide="tts-tools-panel"]',
        tab: "tools",
        action: "next",
        cta: "Done",
      },
    ],
  },
  {
    id: "add-news-source",
    title: "Add a news source",
    short: "Custom RSS",
    blurb: "Paste any RSS/Atom URL into Manage Sources on the Read tab.",
    icon: "plus",
    loungeWidget: true,
    steps: [
      {
        id: "add-feed-tab",
        title: "Open Read",
        body: "We'll open the Read tab so you can add a custom source.",
        target: '[data-guide="nav-feed"]',
        tab: "feed",
        action: "next",
        cta: "Continue",
      },
      {
        id: "add-feed-manage",
        title: "Manage sources",
        body: "Tap Manage to open your feed list.",
        target: '[data-guide="feed-manage"]',
        tab: "feed",
        action: "tap-target",
      },
      {
        id: "add-feed-url",
        title: "Paste an RSS URL",
        body: "Enter a feed URL (many news sites publish /rss or /feed) and add it. We'll finish when a source is added.",
        target: '[data-guide="feed-add-url"]',
        tab: "feed",
        action: "wait-event",
        event: "kora-guide:feed-added",
      },
    ],
  },
];

export function getGuide(id: GuideId): GuideDefinition | undefined {
  return GUIDE_CATALOG.find((g) => g.id === id);
}

type StatusMap = Partial<Record<GuideId, GuideStatus>>;

function readStatus(): StatusMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StatusMap;
  } catch {
    return {};
  }
}

function writeStatus(map: StatusMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  window.dispatchEvent(new CustomEvent("kora-guides-changed"));
}

export function getGuideStatus(id: GuideId): GuideStatus {
  return readStatus()[id] || "pending";
}

export function setGuideStatus(id: GuideId, status: GuideStatus) {
  const map = readStatus();
  map[id] = status;
  writeStatus(map);
}

export function completeGuide(id: GuideId) {
  setGuideStatus(id, "completed");
}

export function dismissGuideForever(id: GuideId) {
  setGuideStatus(id, "dismissed");
}

export function isGuideOpenable(id: GuideId): boolean {
  const s = getGuideStatus(id);
  return s === "pending";
}

/** Lounge widgets: pending guides marked loungeWidget, shuffled. */
export function pickLoungeGuideWidgets(limit = 2): GuideDefinition[] {
  const pending = GUIDE_CATALOG.filter(
    (g) => g.loungeWidget && getGuideStatus(g.id) === "pending"
  );
  // Stable-ish shuffle per day so the set feels random but not frantic
  const day = Math.floor(Date.now() / 86_400_000);
  const scored = pending.map((g, i) => {
    const hash = (g.id.charCodeAt(0) * 31 + g.id.length * 17 + day + i * 13) % 997;
    return { g, hash };
  });
  scored.sort((a, b) => a.hash - b.hash);
  return scored.slice(0, limit).map((s) => s.g);
}

export type JourneyState = {
  active: boolean;
  queue: GuideId[];
  /** Index in queue */
  index: number;
};

export function loadJourney(): JourneyState | null {
  try {
    const raw = localStorage.getItem(JOURNEY_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as JourneyState;
  } catch {
    return null;
  }
}

export function saveJourney(state: JourneyState | null) {
  if (!state) {
    localStorage.removeItem(JOURNEY_KEY);
  } else {
    localStorage.setItem(JOURNEY_KEY, JSON.stringify(state));
  }
  window.dispatchEvent(new CustomEvent("kora-guides-changed"));
}

/** Clear the forced post-onboarding queue without dismissing Lounge guide cards. */
export function clearJourney() {
  saveJourney(null);
}

/** Default post-onboarding queue */
export function startPostOnboardingJourney() {
  const queue: GuideId[] = ["sync-setup", "first-book-search", "reader-tour", "news-feed"];
  const filtered = queue.filter((id) => getGuideStatus(id) === "pending");
  if (!filtered.length) {
    saveJourney(null);
    return null;
  }
  const state: JourneyState = { active: true, queue: filtered, index: 0 };
  saveJourney(state);
  return state;
}

export function emitGuideEvent(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function guideDataAttr(id: string): Record<string, string> {
  return { "data-guide": id };
}
