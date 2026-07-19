export interface SmartSkipSettings {
  enabled: boolean;
  introSeconds: number;
  outroSeconds: number;
}

const STORAGE_KEY = "kora_audiobook_smart_skip";

const DEFAULT_SETTINGS: SmartSkipSettings = {
  enabled: true,
  introSeconds: 15,
  outroSeconds: 20,
};

export function getSmartSkipSettings(): SmartSkipSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SmartSkipSettings>;
    return {
      enabled: parsed.enabled ?? DEFAULT_SETTINGS.enabled,
      introSeconds: clampSeconds(parsed.introSeconds, DEFAULT_SETTINGS.introSeconds),
      outroSeconds: clampSeconds(parsed.outroSeconds, DEFAULT_SETTINGS.outroSeconds),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSmartSkipSettings(settings: SmartSkipSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function clampSeconds(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : fallback;
  return Math.min(60, Math.max(0, Math.round(n)));
}

export function shouldApplyIntroSkip(
  duration: number,
  resumeTime: number | undefined,
  introSeconds: number
): boolean {
  if (introSeconds <= 0 || !isFinite(duration) || duration <= introSeconds + 5) return false;
  if (resumeTime != null && resumeTime > introSeconds + 2) return false;
  return true;
}

export function shouldAutoAdvancePastOutro(
  currentTime: number,
  duration: number,
  outroSeconds: number,
  hasNextTrack: boolean
): boolean {
  if (!hasNextTrack || outroSeconds <= 0 || !isFinite(duration) || duration <= outroSeconds + 5) {
    return false;
  }
  return currentTime >= duration - outroSeconds;
}
