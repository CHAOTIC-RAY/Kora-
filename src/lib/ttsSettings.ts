export type TtsQualityPreset = "instant" | "balanced" | "studio";
export type TtsPlaybackMode = "narrator" | "speed";
export type TtsGenerationMode = "live" | "pregenerate";

export interface TtsSettings {
  voiceName: string;
  voiceLang: string;
  rate: number;
  pitch: number;
  qualityPreset: TtsQualityPreset;
  playbackMode: TtsPlaybackMode;
  generationMode: TtsGenerationMode;
}

export const TTS_VOICE_KEY = "kora_tts_voice";
export const TTS_VOICE_LANG_KEY = "kora_tts_voice_lang";
export const TTS_RATE_KEY = "kora_tts_rate";
export const TTS_PITCH_KEY = "kora_tts_pitch";
export const TTS_QUALITY_KEY = "kora_tts_quality";
export const TTS_MODE_KEY = "kora_tts_mode";
export const TTS_GENERATION_KEY = "kora_tts_generation";

const DEFAULT_SETTINGS: TtsSettings = {
  voiceName: "",
  voiceLang: "",
  rate: 1,
  pitch: 1,
  qualityPreset: "balanced",
  playbackMode: "narrator",
  generationMode: "live",
};

const PREFERRED_VOICE_NAMES = [
  "Samantha",
  "Daniel",
  "Karen",
  "Microsoft Aria Online",
  "Microsoft Jenny",
  "Microsoft Guy",
  "Microsoft Natural",
  "Google US English",
  "Google UK English Female",
  "Natural",
];

export function getTtsSettings(): TtsSettings {
  try {
    return {
      voiceName: localStorage.getItem(TTS_VOICE_KEY) || DEFAULT_SETTINGS.voiceName,
      voiceLang: localStorage.getItem(TTS_VOICE_LANG_KEY) || DEFAULT_SETTINGS.voiceLang,
      rate: parseFloat(localStorage.getItem(TTS_RATE_KEY) || "1") || 1,
      pitch: parseFloat(localStorage.getItem(TTS_PITCH_KEY) || "1") || 1,
      qualityPreset:
        (localStorage.getItem(TTS_QUALITY_KEY) as TtsQualityPreset) || DEFAULT_SETTINGS.qualityPreset,
      playbackMode:
        (localStorage.getItem(TTS_MODE_KEY) as TtsPlaybackMode) || DEFAULT_SETTINGS.playbackMode,
      generationMode:
        (localStorage.getItem(TTS_GENERATION_KEY) as TtsGenerationMode) ||
        DEFAULT_SETTINGS.generationMode,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveTtsSettings(patch: Partial<TtsSettings>) {
  const current = getTtsSettings();
  const next = { ...current, ...patch };
  try {
    if (patch.voiceName !== undefined) localStorage.setItem(TTS_VOICE_KEY, next.voiceName);
    if (patch.voiceLang !== undefined) localStorage.setItem(TTS_VOICE_LANG_KEY, next.voiceLang);
    if (patch.rate !== undefined) localStorage.setItem(TTS_RATE_KEY, String(next.rate));
    if (patch.pitch !== undefined) localStorage.setItem(TTS_PITCH_KEY, String(next.pitch));
    if (patch.qualityPreset !== undefined) localStorage.setItem(TTS_QUALITY_KEY, next.qualityPreset);
    if (patch.playbackMode !== undefined) localStorage.setItem(TTS_MODE_KEY, next.playbackMode);
    if (patch.generationMode !== undefined) {
      localStorage.setItem(TTS_GENERATION_KEY, next.generationMode);
    }
  } catch {
    // ignore storage failures
  }
  return next;
}

export function getSpeechVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

export function pickDefaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  for (const preferred of PREFERRED_VOICE_NAMES) {
    const match = voices.find(
      (voice) => voice.name.includes(preferred) && voice.lang.toLowerCase().startsWith("en")
    );
    if (match) return match;
  }

  return (
    voices.find((v) => v.lang.startsWith("en-US") && /natural/i.test(v.name)) ||
    voices.find((v) => v.lang.startsWith("en") && v.localService) ||
    voices.find((v) => v.lang.startsWith("en")) ||
    voices[0]
  );
}

export function resolveSpeechVoice(voiceName?: string, voiceLang?: string): SpeechSynthesisVoice | null {
  const voices = getSpeechVoices();
  if (!voices.length) return null;

  const settings = getTtsSettings();
  const targetName = voiceName ?? settings.voiceName;
  const targetLang = voiceLang ?? settings.voiceLang;

  if (targetName) {
    const exact = voices.find(
      (v) => v.name === targetName && (!targetLang || v.lang === targetLang || v.lang.startsWith(`${targetLang}-`))
    );
    if (exact) return exact;
    const byName = voices.find((v) => v.name === targetName);
    if (byName) return byName;
  }

  const langPool = targetLang
    ? voices.filter((v) => v.lang === targetLang || v.lang.startsWith(`${targetLang.split("-")[0]}-`))
    : voices;

  if (targetLang && langPool.length) {
    const picked = pickDefaultVoice(langPool);
    if (picked) return picked;
  }

  const picked = pickDefaultVoice(voices);
  if (picked && !settings.voiceName) {
    saveTtsSettings({ voiceName: picked.name, voiceLang: picked.lang });
  }
  return picked;
}

export function getUniqueVoiceLanguages(voices: SpeechSynthesisVoice[]): Array<{ code: string; label: string }> {
  const codes = new Set<string>();
  for (const voice of voices) {
    if (voice.lang) codes.add(voice.lang);
  }
  return Array.from(codes)
    .sort((a, b) => a.localeCompare(b))
    .map((code) => ({
      code,
      label: formatVoiceLanguageLabel(code),
    }));
}

export function formatVoiceLanguageLabel(langCode: string): string {
  try {
    const [language, region] = langCode.split("-");
    const languageName =
      new Intl.DisplayNames(["en"], { type: "language" }).of(language) || language;
    if (!region) return `${languageName} (${langCode})`;
    const regionName = new Intl.DisplayNames(["en"], { type: "region" }).of(region) || region;
    return `${languageName} (${regionName})`;
  } catch {
    return langCode;
  }
}

export function getVoicesForLanguage(
  voices: SpeechSynthesisVoice[],
  langCode: string
): SpeechSynthesisVoice[] {
  if (!langCode) return voices;
  const base = langCode.split("-")[0];
  return voices
    .filter((v) => v.lang === langCode || v.lang.startsWith(`${base}-`))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function formatVoiceOptionLabel(voice: SpeechSynthesisVoice): string {
  return voice.name.replace(/\s+Online\s+\(Natural\)/i, "").replace(/Multilingual/i, " Multilingual").trim();
}

export function getEffectiveSpeechRate(baseRate = 1): number {
  const settings = getTtsSettings();
  const modeMultiplier = settings.playbackMode === "narrator" ? 0.92 : 1.08;
  const qualityMultiplier =
    settings.qualityPreset === "instant" ? 1.05 : settings.qualityPreset === "studio" ? 0.95 : 1;
  return Math.min(2, Math.max(0.5, baseRate * settings.rate * modeMultiplier * qualityMultiplier));
}

export function getQualityPresetLabel(preset: TtsQualityPreset): string {
  switch (preset) {
    case "instant":
      return "Instant — live system voice";
    case "balanced":
      return "Balanced — prepared text + smoother flow";
    case "studio":
      return "Studio — pre-generate chapter audio locally";
  }
}

export function groupVoicesByLanguage(voices: SpeechSynthesisVoice[]): Array<{
  language: string;
  voices: SpeechSynthesisVoice[];
}> {
  const groups = new Map<string, SpeechSynthesisVoice[]>();
  for (const voice of voices) {
    const lang = voice.lang || "unknown";
    const languageLabel = (() => {
      try {
        return new Intl.DisplayNames(["en"], { type: "language" }).of(lang.split("-")[0]) || lang;
      } catch {
        return lang;
      }
    })();
    const bucket = groups.get(languageLabel) || [];
    bucket.push(voice);
    groups.set(languageLabel, bucket);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, groupedVoices]) => ({
      language,
      voices: groupedVoices.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export function subscribeToVoicesChanged(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.speechSynthesis) return () => {};

  const handler = () => callback();
  window.speechSynthesis.addEventListener("voiceschanged", handler);
  // Android WebView often never fires voiceschanged — also assign the legacy handler.
  try {
    window.speechSynthesis.onvoiceschanged = handler;
  } catch {
    /* ignore */
  }

  // Prime immediately + poll briefly (WebView populates voices asynchronously).
  const prime = () => {
    try {
      void window.speechSynthesis.getVoices();
    } catch {
      /* ignore */
    }
    callback();
  };
  prime();

  const started = Date.now();
  const poll = window.setInterval(() => {
    prime();
    if (getSpeechVoices().length > 0 || Date.now() - started > 5000) {
      window.clearInterval(poll);
    }
  }, 250);

  return () => {
    window.clearInterval(poll);
    window.speechSynthesis.removeEventListener("voiceschanged", handler);
    try {
      if (window.speechSynthesis.onvoiceschanged === handler) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    } catch {
      /* ignore */
    }
  };
}

/** Call on a user gesture / Capacitor boot so Android WebView loads TTS voices. */
export function primeSpeechVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  try {
    // Empty utterance kick-starts voice enumeration on some Android WebViews.
    const kick = new SpeechSynthesisUtterance("");
    kick.volume = 0;
    window.speechSynthesis.speak(kick);
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  return window.speechSynthesis.getVoices();
}

export async function speakTestPhrase(phrase = "This is how your narrator will sound.") {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    throw new Error("Text-to-speech is not supported in this browser.");
  }
  const settings = getTtsSettings();
  const voice = resolveSpeechVoice(settings.voiceName, settings.voiceLang);
  window.speechSynthesis.cancel();
  await new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(phrase);
    if (voice) utterance.voice = voice;
    utterance.rate = getEffectiveSpeechRate(1);
    utterance.pitch = settings.pitch;
    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      if (event.error !== "interrupted") reject(new Error("Voice test failed."));
      else resolve();
    };
    window.speechSynthesis.speak(utterance);
  });
}
