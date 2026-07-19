import React, { useEffect, useMemo, useState } from "react";
import { Volume2 } from "lucide-react";
import {
  formatVoiceOptionLabel,
  getQualityPresetLabel,
  getSpeechVoices,
  getTtsSettings,
  getUniqueVoiceLanguages,
  getVoicesForLanguage,
  saveTtsSettings,
  speakTestPhrase,
  subscribeToVoicesChanged,
  TtsGenerationMode,
  TtsPlaybackMode,
  TtsQualityPreset,
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

  useEffect(() => {
    return subscribeToVoicesChanged(() => setVoices(getSpeechVoices()));
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
    <div className={`space-y-3 ${compact ? "" : "rounded-xl border border-kindle-border bg-kindle-bg/60 p-3"}`}>
      <div className="space-y-1.5">
        <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted flex items-center gap-1">
          <Volume2 className="w-3 h-3" />
          Narrator Voice
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[8px] font-bold uppercase tracking-wider text-kindle-text-muted/80">Language</label>
            <select
              value={settings.voiceLang}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="w-full text-[11px] bg-kindle-card border border-kindle-border rounded-lg px-3 py-2"
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
              className="w-full text-[11px] bg-kindle-card border border-kindle-border rounded-lg px-3 py-2"
            >
              {voicesForLanguage.length === 0 ? (
                <option value="">No voices for this language</option>
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
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">Rate</label>
          <input
            type="range"
            min={0.75}
            max={1.5}
            step={0.05}
            value={settings.rate}
            onChange={(e) => update({ rate: parseFloat(e.target.value) })}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">Pitch</label>
          <input
            type="range"
            min={0.8}
            max={1.2}
            step={0.05}
            value={settings.pitch}
            onChange={(e) => update({ pitch: parseFloat(e.target.value) })}
            className="w-full"
          />
        </div>
      </div>

      <div className="flex gap-2">
        {(["narrator", "speed"] as TtsPlaybackMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => update({ playbackMode: mode })}
            className={`flex-1 text-[9px] font-bold uppercase tracking-wider py-2 rounded-lg border transition ${
              settings.playbackMode === mode
                ? "bg-white text-black border-white"
                : "border-kindle-border text-kindle-text-muted hover:text-kindle-text"
            }`}
          >
            {mode === "narrator" ? "Narrator" : "Speed"}
          </button>
        ))}
      </div>

      {showQualityPresets && (
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">
            Quality Preset
          </label>
          <select
            value={settings.qualityPreset}
            onChange={(e) => update({ qualityPreset: e.target.value as TtsQualityPreset })}
            className="w-full text-[11px] bg-kindle-card border border-kindle-border rounded-lg px-3 py-2"
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
        <div className="flex gap-2">
          {(["live", "pregenerate"] as TtsGenerationMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => update({ generationMode: mode })}
              className={`flex-1 text-[9px] font-bold uppercase tracking-wider py-2 rounded-lg border transition ${
                settings.generationMode === mode
                  ? "bg-kindle-accent text-white border-kindle-accent"
                  : "border-kindle-border text-kindle-text-muted hover:text-kindle-text"
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
          className="w-full text-[9px] font-bold uppercase tracking-wider py-2 rounded-lg border border-kindle-border hover:bg-kindle-card transition disabled:opacity-50"
        >
          {testing ? "Testing voice…" : "Test Voice"}
        </button>
      )}

      {testError && <p className="text-[9px] text-red-500">{testError}</p>}
    </div>
  );
}
