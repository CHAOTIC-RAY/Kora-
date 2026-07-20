import React from "react";
import {
  NEWS_READER_FONT_OPTIONS,
  NEWS_READER_MARGIN_OPTIONS,
  NEWS_READER_THEME_OPTIONS,
  newsReaderThemeClasses,
  type NewsReaderPrefs,
} from "../lib/newsReaderPrefs";

interface NewsReaderSettingsPanelProps {
  prefs: NewsReaderPrefs;
  onChange: (patch: Partial<NewsReaderPrefs>) => void;
  className?: string;
}

export default function NewsReaderSettingsPanel({
  prefs,
  onChange,
  className = "",
}: NewsReaderSettingsPanelProps) {
  const theme = newsReaderThemeClasses(prefs.theme);

  return (
    <div
      className={`border-t ${theme.border} ${theme.header} px-4 py-4 space-y-4 max-h-[45vh] overflow-y-auto shrink-0 ${className}`}
    >
      <p className={`text-[10px] ${theme.muted}`}>
        Applies to Feed articles and the Daily News Brief. Saved on this device.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold">Font Size</h4>
          <span className={`text-[10px] font-mono ${theme.muted}`}>{prefs.fontSize}px</span>
        </div>
        <input
          type="range"
          min={12}
          max={36}
          step={1}
          value={prefs.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
          className="w-full accent-kindle-accent cursor-pointer"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold">Line Spacing</h4>
          <span className={`text-[10px] font-mono ${theme.muted}`}>{prefs.lineSpacing.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={1.2}
          max={2.6}
          step={0.1}
          value={prefs.lineSpacing}
          onChange={(e) => onChange({ lineSpacing: Number(e.target.value) })}
          className="w-full accent-kindle-accent cursor-pointer"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold">Paragraph Spacing</h4>
          <span className={`text-[10px] font-mono ${theme.muted}`}>{prefs.paragraphSpacing.toFixed(1)}em</span>
        </div>
        <input
          type="range"
          min={0.6}
          max={2.2}
          step={0.1}
          value={prefs.paragraphSpacing}
          onChange={(e) => onChange({ paragraphSpacing: Number(e.target.value) })}
          className="w-full accent-kindle-accent cursor-pointer"
        />
      </div>

      <div className="space-y-2">
        <h4 className={`text-[9px] uppercase tracking-widest font-bold ${theme.muted}`}>Font Family</h4>
        <div className="flex flex-wrap gap-2">
          {NEWS_READER_FONT_OPTIONS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onChange({ fontFamily: f.id })}
              className={`px-3 py-1.5 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition ${
                prefs.fontFamily === f.id
                  ? "bg-kindle-text text-kindle-bg border-kindle-text"
                  : `${theme.border} ${theme.muted}`
              }`}
            >
              <span className={f.id}>{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className={`text-[9px] uppercase tracking-widest font-bold ${theme.muted}`}>Page Width</h4>
        <div className="flex flex-wrap gap-2">
          {NEWS_READER_MARGIN_OPTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ marginSize: m.id })}
              className={`px-3 py-1.5 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition ${
                prefs.marginSize === m.id
                  ? "bg-kindle-text text-kindle-bg border-kindle-text"
                  : `${theme.border} ${theme.muted}`
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className={`text-[9px] uppercase tracking-widest font-bold ${theme.muted}`}>Theme</h4>
        <div className="grid grid-cols-4 gap-2">
          {NEWS_READER_THEME_OPTIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange({ theme: t.id })}
              className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition ${
                prefs.theme === t.id ? "border-kindle-accent ring-1 ring-kindle-accent/30" : theme.border
              }`}
            >
              <div className={`w-6 h-6 rounded-md ${t.bg} ring-1 ${t.ring}`} />
              <span className="text-[8px] font-bold uppercase tracking-widest">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold">Brightness</h4>
          <span className={`text-[10px] font-mono ${theme.muted}`}>{prefs.brightness}%</span>
        </div>
        <input
          type="range"
          min={40}
          max={100}
          step={5}
          value={prefs.brightness}
          onChange={(e) => onChange({ brightness: Number(e.target.value) })}
          className="w-full accent-kindle-accent cursor-pointer"
        />
      </div>
    </div>
  );
}
