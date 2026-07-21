/**
 * Interactive guides — catalog, persistence, and helpers.
 * Status: pending | completed | dismissed (swipe forever).
 *
 * Post-onboarding journey starts with the in-library walkthrough book,
 * then Discover (first download) and Read tab.
 */

export type GuideId =
  | "walkthrough-book"
  | "sync-setup"
  | "first-book-search"
  | "reader-tour"
  | "news-feed"
  | "narrator-mode"
  | "audiobook-generator"
  | "add-news-source";

export type GuideStatus = "pending" | "completed" | "dismissed";

export type GuideStepAction = "next" | "tap-target" | "wait-event";

/** Auto-open a real UI surface when the step becomes active */
export type GuideOpenAction =
  | "setup"
  | "auth"
  | "settings"
  | "feed-manage"
  | "tools-sync"
  | "tools-tts";

export type GuideStepLink = {
  label: string;
  /** Start another guide after finishing the current one */
  startGuide?: GuideId;
  /** Switch app tab */
  tab?: "lounge" | "library" | "discover" | "feed" | "tools" | "settings";
  /** Mark current guide complete and clear remaining journey */
  finishTour?: boolean;
};

export type GuideStep = {
  id: string;
  title: string;
  body: string;
  /** CSS selector; prefer [data-guide="…"] */
  target?: string;
  /** Switch app tab before showing this step */
  tab?: "lounge" | "library" | "discover" | "feed" | "tools" | "settings";
  /** Open a popup/panel when this step activates */
  open?: GuideOpenAction;
  action?: GuideStepAction;
  /** CustomEvent name when action === wait-event */
  event?: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  /** Optional CTA label when action is next */
  cta?: string;
  /** Extra action buttons (e.g. end-of-tour shortcuts) */
  links?: GuideStepLink[];
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
    id: "walkthrough-book",
    title: "Getting started book",
    short: "Open the guide book",
    blurb: "Open Getting started with Kora in Library and read it like any book — the last chapter lists more guides.",
    icon: "book",
    journey: true,
    loungeWidget: true,
    steps: [
      {
        id: "wt-open-book",
        title: "Open your guide book",
        body: "Tap Getting started with Kora on your shelf. Read the chapters at your own pace — no popups inside the book.",
        target: '[data-guide="walkthrough-book"]',
        tab: "library",
        action: "wait-event",
        event: "kora-guide:walkthrough-opened",
      },
    ],
  },
  {
    id: "sync-setup",
    title: "Setup & sync",
    short: "Prefs + cross-device sync",
    blurb: "We'll open a setup popup, then take you to Sign in and Devices & Sync.",
    icon: "cloud",
    loungeWidget: true,
    steps: [
      {
        id: "setup-prefs",
        title: "Reading setup",
        body: "A setup popup will open — pick font size and tap vs scroll. Save when you're happy.",
        tab: "lounge",
        open: "setup",
        action: "wait-event",
        event: "kora-guide:setup-saved",
      },
      {
        id: "sync-sign-in",
        title: "Sign in (optional)",
        body: "Tap Sign in in the header to sync progress across devices — or continue as a guest.",
        target: '[data-guide="auth-open"]',
        tab: "lounge",
        action: "next",
        cta: "Next: Tools",
      },
      {
        id: "sync-tools-nav",
        title: "Open Tools",
        body: "Tap Tools — Devices & Sync lives there.",
        target: '[data-guide="nav-tools"]',
        action: "tap-target",
      },
      {
        id: "sync-panel",
        title: "Devices & Sync",
        body: "Tap Sync to jump to Devices & Sync. Name this device or connect WebDAV when you're ready.",
        target: '[data-guide="tools-sync"]',
        tab: "tools",
        open: "tools-sync",
        action: "next",
        cta: "Done with sync",
      },
    ],
  },
  {
    id: "first-book-search",
    title: "Find your first book",
    short: "Search & download from Discover",
    blurb: "We'll take you to Discover, have you search, download, then open the book.",
    icon: "search",
    journey: true,
    loungeWidget: true,
    steps: [
      {
        id: "search-tab",
        title: "Open Discover",
        body: "Tap Discover — that's where you search archives and bestsellers.",
        target: '[data-guide="nav-discover"]',
        action: "tap-target",
      },
      {
        id: "search-box",
        title: "Search for a title",
        body: "Type a book you know and submit. We'll wait for your search.",
        target: '[data-guide="discover-search"]',
        tab: "discover",
        action: "wait-event",
        event: "kora-guide:search-submitted",
      },
      {
        id: "search-result",
        title: "Download a result",
        body: "Open a result and start the download. We'll continue when the book is on your shelf.",
        target: '[data-guide="discover-results"]',
        tab: "discover",
        action: "wait-event",
        event: "kora-guide:book-added",
      },
      {
        id: "search-open",
        title: "Open it to read",
        body: "Tap Library, then open your new book — you're ready to read for real.",
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
    blurb: "Open any EPUB and we'll spotlight display settings, Narrator, and highlights.",
    icon: "book",
    loungeWidget: true,
    steps: [
      {
        id: "reader-need-book",
        title: "Open a book first",
        body: "Open any EPUB from Library or Lounge Continue. We'll continue when the reader opens.",
        tab: "library",
        action: "wait-event",
        event: "kora-guide:reader-opened",
      },
      {
        id: "reader-settings",
        title: "Display settings",
        body: "Tap the gear to open in-reader settings — theme, margins, and more.",
        target: "#toggle-settings-btn",
        action: "tap-target",
      },
      {
        id: "reader-settings-done",
        title: "Tune to taste",
        body: "Adjust anything you like, then continue for Voice Narrator.",
        target: '[data-guide="reader-settings-panel"], #toggle-settings-btn',
        action: "next",
        cta: "Next: Narrator",
      },
      {
        id: "reader-narrator",
        title: "Voice Narrator",
        body: "Tap headphones to hear the page read aloud.",
        target: "#toggle-audiobook-btn",
        action: "tap-target",
      },
      {
        id: "reader-notes",
        title: "Highlights & notes",
        body: "Open Highlights & Notes, then long-press text on the page to select.",
        target: '[data-guide="reader-notes-btn"]',
        action: "tap-target",
      },
      {
        id: "reader-select",
        title: "Try a selection",
        body: "Long-press a word — highlight, note, or look it up. That finishes this tour.",
        action: "wait-event",
        event: "kora-guide:text-selected",
      },
    ],
  },
  {
    id: "news-feed",
    title: "Morning paper",
    short: "Read tab & headlines",
    blurb: "We'll open Read, show the feed, then Manage Sources for your RSS list.",
    icon: "rss",
    journey: true,
    loungeWidget: true,
    steps: [
      {
        id: "feed-open",
        title: "Open Read",
        body: "Tap Read — your headlines and Daily Brief live here.",
        target: '[data-guide="nav-feed"]',
        action: "tap-target",
      },
      {
        id: "feed-cards",
        title: "Use the cards",
        body: "Swipe a headline right to mark read, left to save. Tap a card to open the article.",
        target: '[data-guide="feed-list"]',
        tab: "feed",
        action: "next",
        cta: "Next: Sources",
      },
      {
        id: "feed-manage",
        title: "Manage sources",
        body: "We'll open Manage Sources — toggle feeds or add a custom RSS URL.",
        target: '[data-guide="feed-manage"]',
        tab: "feed",
        open: "feed-manage",
        action: "next",
        cta: "Done",
      },
    ],
  },
  {
    id: "narrator-mode",
    title: "Try Voice Narrator",
    short: "Hands-free reading",
    blurb: "Open a book, then tap headphones — we'll guide each tap.",
    icon: "headphones",
    loungeWidget: true,
    steps: [
      {
        id: "narrator-open-book",
        title: "Open a book",
        body: "Open any EPUB from Library. We'll continue when the reader opens.",
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
        body: "Narrator pace and voices live under Tools → Read Aloud for conversions.",
        action: "next",
        cta: "Done",
      },
    ],
  },
  {
    id: "audiobook-generator",
    title: "Audiobook generator",
    short: "Turn text into audio",
    blurb: "We'll take you to Tools → Read Aloud and open the converter.",
    icon: "wrench",
    loungeWidget: true,
    steps: [
      {
        id: "tts-nav",
        title: "Open Tools",
        body: "Tap Tools — audiobook conversion lives here.",
        target: '[data-guide="nav-tools"]',
        action: "tap-target",
      },
      {
        id: "tts-tile",
        title: "Read Aloud",
        body: "Tap Read Aloud — we'll scroll you to the converter.",
        target: '[data-guide="tools-tts"]',
        tab: "tools",
        open: "tools-tts",
        action: "tap-target",
      },
      {
        id: "tts-panel",
        title: "Generate audio",
        body: "Pick a library book, choose a voice, and generate. Files stay on this device.",
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
    blurb: "We'll open Read → Manage Sources so you can paste an RSS URL.",
    icon: "plus",
    loungeWidget: true,
    steps: [
      {
        id: "add-feed-tab",
        title: "Open Read",
        body: "Tap Read to manage your news sources.",
        target: '[data-guide="nav-feed"]',
        action: "tap-target",
      },
      {
        id: "add-feed-manage",
        title: "Manage sources",
        body: "Manage Sources is opening — you'll add a custom feed next.",
        target: '[data-guide="feed-manage"]',
        tab: "feed",
        open: "feed-manage",
        action: "next",
        cta: "Show URL field",
      },
      {
        id: "add-feed-url",
        title: "Paste an RSS URL",
        body: "Enter a feed URL (/rss or /feed on many sites) and add it. We'll finish when a source is added.",
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

/** Default post-onboarding queue — guide book first, then Discover + Read. */
export function startPostOnboardingJourney() {
  const queue: GuideId[] = ["walkthrough-book", "first-book-search", "news-feed"];
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
