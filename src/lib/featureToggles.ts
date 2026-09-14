const KEY_NEWS_TAB = "kora_feature_news_tab_enabled";
const KEY_DISCOVER_TAB = "kora_feature_discover_tab_enabled";
const KEY_SOUND_EFFECTS = "kora_feature_sound_effects_enabled";
const DEFAULT_VALUE = true;

export function isNewsTabEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY_NEWS_TAB);
    if (raw === null) return DEFAULT_VALUE;
    return raw === "true";
  } catch {
    return DEFAULT_VALUE;
  }
}

export function setNewsTabEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY_NEWS_TAB, String(enabled));
  } catch {}
  window.dispatchEvent(new CustomEvent("kora-feature-toggles-changed"));
}

export function isDiscoverTabEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY_DISCOVER_TAB);
    if (raw === null) return DEFAULT_VALUE;
    return raw === "true";
  } catch {
    return DEFAULT_VALUE;
  }
}

export function setDiscoverTabEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY_DISCOVER_TAB, String(enabled));
  } catch {}
  window.dispatchEvent(new CustomEvent("kora-feature-toggles-changed"));
}

export function isSoundEffectsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY_SOUND_EFFECTS);
    if (raw === null) return DEFAULT_VALUE;
    return raw === "true";
  } catch {
    return DEFAULT_VALUE;
  }
}

export function setSoundEffectsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY_SOUND_EFFECTS, String(enabled));
  } catch {}
  window.dispatchEvent(new CustomEvent("kora-feature-toggles-changed"));
}

export type FeatureToggleId = "newsTab" | "discoverTab" | "soundEffects" | "gettingStartedBook" | "loungeGuides";

export function getFeatureToggleLabel(id: FeatureToggleId): string {
  switch (id) {
    case "newsTab":
      return "News tab";
    case "discoverTab":
      return "Discover tab";
    case "soundEffects":
      return "Sound effects";
    case "gettingStartedBook":
      return "Getting started book";
    case "loungeGuides":
      return "Lounge guides";
  }
}

export function getFeatureToggleDesc(id: FeatureToggleId): string {
  switch (id) {
    case "newsTab":
      return "Remove the News tab from navigation and hide its content.";
    case "discoverTab":
      return "Remove the Discover tab from navigation and hide its content.";
    case "soundEffects":
      return "Silence book reader flip sounds and game audio effects.";
    case "gettingStartedBook":
      return "Hide the Kora Getting Started guide book from your library shelf.";
    case "loungeGuides":
      return "Hide the Guides widget from the Lounge home screen.";
  }
}

const KEY_GETTING_STARTED = "kora_feature_getting_started_book_enabled";
const KEY_LOUNGE_GUIDES = "kora_feature_lounge_guides_enabled";

export function isGettingStartedBookEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY_GETTING_STARTED);
    if (raw === null) return DEFAULT_VALUE;
    return raw === "true";
  } catch {
    return DEFAULT_VALUE;
  }
}

export function setGettingStartedBookEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY_GETTING_STARTED, String(enabled));
  } catch {}
  window.dispatchEvent(new CustomEvent("kora-feature-toggles-changed"));
}

export function isLoungeGuidesEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY_LOUNGE_GUIDES);
    if (raw === null) return DEFAULT_VALUE;
    return raw === "true";
  } catch {
    return DEFAULT_VALUE;
  }
}

export function setLoungeGuidesEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY_LOUNGE_GUIDES, String(enabled));
  } catch {}
  window.dispatchEvent(new CustomEvent("kora-feature-toggles-changed"));
}

