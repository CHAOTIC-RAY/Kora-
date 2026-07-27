import React, { useEffect, useMemo, useState } from "react";
import { Volume2 } from "lucide-react";
import {
  formatVoiceOptionLabel,
  getQualityPresetLabel,
  getSpeechVoices,
  getTtsEngineHint,
  getTtsSettings,
  getUniqueVoiceLanguages,
  getVoicesForLanguage,
  openNativeTtsInstall,
  saveTtsSettings,
  speakTestPhrase,
  subscribeToVoicesChanged,
  TtsGenerationMode,
  TtsPlaybackMode,
  TtsQualityPreset,
  usesNativeTts,
} from "../lib/ttsSettings";

interface TtsVoiceSettingsProps {
  compact?: boolean;
  showQualityPresets?: boolean;
  showGenerationMode?: boolean;
  showTestButton?: boolean;
  onSettingsChange?: () => void;
}

export default function TtsVoiceSettings({
  compact = false,
  showQualityPresets = true,
  showGenerationMode = false,
  showTestButton = true,
  onSettingsChange,
}: TtsVoiceSettingsProps) {
  const [settings, setSettings] = useState(getTtsSettings());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [engineHint, setEngineHint] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToVoicesChanged(() => {
      setVoices(getSpeechVoices());
      setEngineHint(getTtsEngineHint());
    });
  }, []);

  const languageOptions = useMemo(() => getUniqueVoiceLanguages(voices), [voices]);
  const voicesForLanguage = useMemo(
    () => getVoicesForLanguage(voices, settings.voiceLang),
    [voices, settings.voiceLang]
  );

  useEffect(() => {
    if (!voices.length) return;
    if (!settings.voiceLang && languageOptions.length) {
      const nextLang = languageOptions.find((opt) => opt.code.startsWith("en"))?.code || languageOptions[0].code;
      const next = saveTtsSettings({ voiceLang: nextLang });
      setSettings(next);
      return;
    }
    if (
      settings.voiceName &&
      !voicesForLanguage.some((voice) => voice.name === settings.voiceName)
    ) {
      const fallback = voicesForLanguage[0];
      const next = saveTtsSettings({
        voiceName: fallback?.name || "",
        voiceLang: fallback?.lang || settings.voiceLang,
      });
      setSettings(next);
    }
  }, [languageOptions, settings.voiceLang, settings.voiceName, voices.length, voicesForLanguage]);

  const update = (patch: Partial<typeof settings>) => {
    const next = saveTtsSettings(patch);
    setSettings(next);
    onSettingsChange?.();
  };

  const handleLanguageChange = (langCode: string) => {
    const pool = getVoicesForLanguage(voices, langCode);
    const keepCurrent = pool.find((voice) => voice.name === settings.voiceName);
    update({
      voiceLang: langCode,
      voiceName: keepCurrent?.name || pool[0]?.name || "",
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestError(null);
    try {
      await speakTestPhrase();
    } catch (err) {
      setTestError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={`space-y-4 ${compact ? "" : "rounded-xl border border-kindle-border bg-kindle-bg/60 p-4"}`}>
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted flex items-center gap-1">
          <Volume2 className="w-3.5 h-3.5" />
          Narrator Voice
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[8px] font-bold uppercase tracking-wider text-kindle-text-muted/80">Language</label>
            <select
              value={settings.voiceLang}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="w-full text-[11px] bg-kindle-card border border-kindle-border rounded-lg px-3 py-2 text-kindle-text focus:outline-none focus:border-kindle-accent"
            >
              {languageOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] font-bold uppercase tracking-wider text-kindle-text-muted/80">Voice</label>
            <select
              value={settings.voiceName}
              onChange={(e) => {
                const selected = voicesForLanguage.find((voice) => voice.name === e.target.value);
                update({
                  voiceName: e.target.value,
                  voiceLang: selected?.lang || settings.voiceLang,
                });
              }}
              className="w-full text-[11px] bg-kindle-card border border-kindle-border rounded-lg px-3 py-2 text-kindle-text focus:outline-none focus:border-kindle-accent"
            >
              {voicesForLanguage.length === 0 ? (
                <option value="">
                  {voices.length === 0
                    ? usesNativeTts()
                      ? "Loading Android system voices…"
                      : "Loading voices…"
                    : "No voices for this language"}
                </option>
              ) : (
                voicesForLanguage.map((voice) => (
                  <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                    {formatVoiceOptionLabel(voice)}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
        {engineHint || (usesNativeTts() && voices.length === 0) ? (
          <div className="space-y-1 mt-1">
            {engineHint ? (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-snug">{engineHint}</p>
            ) : null}
            {usesNativeTts() && voices.length === 0 ? (
              <button
                type="button"
                onClick={() => void openNativeTtsInstall()}
                className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 underline"
              >
                Open Android TTS settings
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">Rate ({settings.rate.toFixed(2)}x)</label>
          <input
            type="range"
            min={0.75}
            max={1.5}
            step={0.05}
            value={settings.rate}
            onChange={(e) => update({ rate: parseFloat(e.target.value) })}
            className="w-full accent-kindle-accent cursor-pointer"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">Pitch ({settings.pitch.toFixed(2)})</label>
          <input
            type="range"
            min={0.8}
            max={1.2}
            step={0.05}
            value={settings.pitch}
            onChange={(e) => update({ pitch: parseFloat(e.target.value) })}
            className="w-full accent-kindle-accent cursor-pointer"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        {(["narrator", "speed"] as TtsPlaybackMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => update({ playbackMode: mode })}
            className={`flex-1 text-[9px] font-bold uppercase tracking-wider py-2 rounded-lg border transition cursor-pointer ${
              settings.playbackMode === mode
                ? "bg-kindle-text text-kindle-bg border-kindle-text"
                : "border-kindle-border text-kindle-text-muted hover:text-kindle-text bg-kindle-card/40"
            }`}
          >
            {mode === "narrator" ? "Narrator" : "Speed"}
          </button>
        ))}
      </div>

      {showQualityPresets && (
        <div className="space-y-1.5 pt-1">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">
            Quality Preset
          </label>
          <select
            value={settings.qualityPreset}
            onChange={(e) => update({ qualityPreset: e.target.value as TtsQualityPreset })}
            className="w-full text-[11px] bg-kindle-card border border-kindle-border rounded-lg px-3 py-2 text-kindle-text focus:outline-none focus:border-kindle-accent"
          >
            {(["instant", "balanced", "studio"] as TtsQualityPreset[]).map((preset) => (
              <option key={preset} value={preset}>
                {getQualityPresetLabel(preset)}
              </option>
            ))}
          </select>
        </div>
      )}

      {showGenerationMode && (
        <div className="flex gap-2 pt-1">
          {(["live", "pregenerate"] as TtsGenerationMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => update({ generationMode: mode })}
              className={`flex-1 text-[9px] font-bold uppercase tracking-wider py-2 rounded-lg border transition cursor-pointer ${
                settings.generationMode === mode
                  ? "bg-kindle-text text-kindle-bg border-kindle-text"
                  : "border-kindle-border text-kindle-text-muted hover:text-kindle-text bg-kindle-card/40"
              }`}
            >
              {mode === "live" ? "Speak Live" : "Generate Now"}
            </button>
          ))}
        </div>
      )}

      {showTestButton && (
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="w-full text-[9px] font-bold uppercase tracking-wider py-2.5 rounded-lg border border-kindle-border bg-kindle-card/50 hover:bg-kindle-card transition disabled:opacity-50 text-kindle-text cursor-pointer mt-1"
        >
          {testing ? "Testing voice…" : "Test Voice"}
        </button>
      )}

      {testError && <p className="text-[9px] text-red-500 font-medium">{testError}</p>}
    </div>
  );
}
