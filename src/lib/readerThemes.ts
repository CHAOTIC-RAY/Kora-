/** Shared KOReader-style theme & typography presets for ebook readers. */

export type ReaderThemeKey = "sepia" | "night" | "paper" | "oled" | "light" | "green" | "dark";

export interface ReaderThemeSpec {
  key: ReaderThemeKey;
  label: string;
  bg: string;
  text: string;
  card: string;
  border: string;
  /** Preview swatch for settings grids */
  previewBg: string;
  previewText: string;
}

export const READER_THEMES: Record<string, ReaderThemeSpec> = {
  sepia: {
    key: "sepia",
    label: "Sepia",
    bg: "bg-[#F4ECD8]",
    text: "text-[#5B4636]",
    card: "bg-[#EFE3C5]",
    border: "border-[#DBCDA4]",
    previewBg: "#F4ECD8",
    previewText: "#5B4636",
  },
  night: {
    key: "night",
    label: "Night",
    bg: "bg-[#1C1F26]",
    text: "text-[#D6D8DE]",
    card: "bg-[#252A33]",
    border: "border-[#3A4050]",
    previewBg: "#1C1F26",
    previewText: "#D6D8DE",
  },
  paper: {
    key: "paper",
    label: "Paper",
    bg: "bg-[#FAF7F2]",
    text: "text-[#2C2A26]",
    card: "bg-[#F3EEE6]",
    border: "border-[#E4DDD2]",
    previewBg: "#FAF7F2",
    previewText: "#2C2A26",
  },
  oled: {
    key: "oled",
    label: "OLED",
    bg: "bg-[#000000]",
    text: "text-[#E8E8E8]",
    card: "bg-[#0A0A0A]",
    border: "border-[#222222]",
    previewBg: "#000000",
    previewText: "#E8E8E8",
  },
  light: {
    key: "light",
    label: "Light",
    bg: "bg-[#FFFFFF]",
    text: "text-[#1A1A1A]",
    card: "bg-[#F9F9F9]",
    border: "border-[#E5E5E5]",
    previewBg: "#FFFFFF",
    previewText: "#1A1A1A",
  },
  green: {
    key: "green",
    label: "Green",
    bg: "bg-[#E3EDD3]",
    text: "text-[#2D3E1E]",
    card: "bg-[#D9E6C3]",
    border: "border-[#C5D6A8]",
    previewBg: "#E3EDD3",
    previewText: "#2D3E1E",
  },
  dark: {
    key: "dark",
    label: "Dark",
    bg: "bg-[#1A1A1A]",
    text: "text-[#E5E5E5]",
    card: "bg-[#262626]",
    border: "border-[#333333]",
    previewBg: "#1A1A1A",
    previewText: "#E5E5E5",
  },
};

/** Primary theme chips shown in the reader settings grid */
export const PRIMARY_READER_THEME_KEYS: ReaderThemeKey[] = ["sepia", "night", "paper", "oled"];

export interface ReaderFontOption {
  name: string;
  value: string;
  dyslexiaFriendly?: boolean;
}

export const READER_FONTS: ReaderFontOption[] = [
  { name: "Lora Serif", value: "font-serif" },
  { name: "Inter Sans", value: "font-sans" },
  { name: "Lexend", value: "font-lexend" },
  { name: "OpenDyslexic", value: "font-opendyslexic", dyslexiaFriendly: true },
  { name: "JetBrains Mono", value: "font-mono" },
  { name: "Bookerly", value: "font-bookerly" },
  { name: "ChareInk7SP", value: "font-chareink" },
  { name: "Lexica Ultralegible", value: "font-lexica" },
];

export const MARGIN_PRESETS = [
  { label: "None", val: "max-w-full" },
  { label: "Narrow", val: "max-w-2xl" },
  { label: "Wide", val: "max-w-xl" },
] as const;

export const LINE_HEIGHT_PRESETS = [
  { label: "Compact", val: 1.2 },
  { label: "Regular", val: 1.6 },
  { label: "Wide", val: 2.0 },
] as const;

export function resolveReaderTheme(key?: string | null): ReaderThemeSpec {
  if (key && READER_THEMES[key]) return READER_THEMES[key];
  // Migrate legacy "dark" preference toward night for KOReader parity when unset naming
  return READER_THEMES.sepia;
}
