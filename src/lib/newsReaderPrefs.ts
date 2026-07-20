export type NewsReaderThemeId =
  | "app"
  | "sepia"
  | "night"
  | "paper"
  | "oled"
  | "light"
  | "dark"
  | "green";

export interface NewsReaderPrefs {
  fontSize: number;
  lineSpacing: number;
  paragraphSpacing: number;
  fontFamily: string;
  marginSize: string;
  theme: NewsReaderThemeId;
  brightness: number;
}

export const NEWS_READER_PREFS_KEY = "kora_news_reader_prefs";
export const NEWS_READER_PREFS_EVENT = "kora-news-reader-prefs";

export const DEFAULT_NEWS_READER_PREFS: NewsReaderPrefs = {
  fontSize: 18,
  lineSpacing: 1.7,
  paragraphSpacing: 1.1,
  fontFamily: "font-lexica",
  marginSize: "max-w-2xl px-5",
  theme: "app",
  brightness: 100,
};

export const NEWS_READER_FONT_OPTIONS = [
  { id: "font-serif", label: "Serif" },
  { id: "font-sans", label: "Sans" },
  { id: "font-lexend", label: "Lexend" },
  { id: "font-opendyslexic", label: "OpenDyslexic" },
  { id: "font-mono", label: "Mono" },
  { id: "font-bookerly", label: "Bookerly" },
  { id: "font-chareink", label: "ChareInk7SP" },
  { id: "font-lexica", label: "Lexica Ultralegible" },
] as const;

export const NEWS_READER_MARGIN_OPTIONS = [
  { id: "max-w-xl px-4", label: "Narrow" },
  { id: "max-w-2xl px-5", label: "Medium" },
  { id: "max-w-3xl px-6", label: "Wide" },
  { id: "max-w-4xl px-8", label: "Full" },
] as const;

export const NEWS_READER_THEME_OPTIONS: {
  id: NewsReaderThemeId;
  label: string;
  bg: string;
  ring: string;
}[] = [
  { id: "app", label: "App", bg: "bg-kindle-bg", ring: "ring-kindle-border" },
  { id: "sepia", label: "Sepia", bg: "bg-[#f4ecd8]", ring: "ring-[#cbb994]" },
  { id: "night", label: "Night", bg: "bg-[#1c1f26]", ring: "ring-[#3a4050]" },
  { id: "paper", label: "Paper", bg: "bg-[#faf7f2]", ring: "ring-[#e4ddd2]" },
  { id: "oled", label: "OLED", bg: "bg-black", ring: "ring-neutral-700" },
  { id: "light", label: "Light", bg: "bg-white", ring: "ring-neutral-300" },
  { id: "dark", label: "Dark", bg: "bg-[#1a1a1a]", ring: "ring-neutral-600" },
  { id: "green", label: "Green", bg: "bg-[#c7edcc]", ring: "ring-[#7fb987]" },
];

export function newsReaderThemeClasses(theme: NewsReaderThemeId): {
  shell: string;
  header: string;
  border: string;
  muted: string;
  content: string;
} {
  switch (theme) {
    case "sepia":
      return {
        shell: "bg-[#f4ecd8] text-[#3d3426]",
        header: "bg-[#efe6d2]/95 text-[#3d3426]",
        border: "border-[#cbb994]/70",
        muted: "text-[#6f6452]",
        content: "text-[#3d3426]",
      };
    case "night":
      return {
        shell: "bg-[#1c1f26] text-[#e8eaef]",
        header: "bg-[#232833]/95 text-[#e8eaef]",
        border: "border-[#3a4050]",
        muted: "text-[#9aa3b5]",
        content: "text-[#e8eaef]",
      };
    case "paper":
      return {
        shell: "bg-[#faf7f2] text-[#2a2621]",
        header: "bg-[#f3efe8]/95 text-[#2a2621]",
        border: "border-[#e4ddd2]",
        muted: "text-[#7a7368]",
        content: "text-[#2a2621]",
      };
    case "oled":
      return {
        shell: "bg-black text-[#f5f5f5]",
        header: "bg-neutral-950/95 text-[#f5f5f5]",
        border: "border-neutral-800",
        muted: "text-neutral-400",
        content: "text-[#f5f5f5]",
      };
    case "light":
      return {
        shell: "bg-white text-neutral-900",
        header: "bg-white/95 text-neutral-900",
        border: "border-neutral-200",
        muted: "text-neutral-500",
        content: "text-neutral-900",
      };
    case "dark":
      return {
        shell: "bg-[#1a1a1a] text-neutral-100",
        header: "bg-[#141414]/95 text-neutral-100",
        border: "border-neutral-700",
        muted: "text-neutral-400",
        content: "text-neutral-100",
      };
    case "green":
      return {
        shell: "bg-[#c7edcc] text-[#1f3d24]",
        header: "bg-[#bfe6c5]/95 text-[#1f3d24]",
        border: "border-[#7fb987]/60",
        muted: "text-[#3d6a45]",
        content: "text-[#1f3d24]",
      };
    case "app":
    default:
      return {
        shell: "bg-kindle-bg text-kindle-text",
        header: "bg-kindle-card/90 text-kindle-text",
        border: "border-kindle-border",
        muted: "text-kindle-text-muted",
        content: "text-kindle-text",
      };
  }
}

function normalizePrefs(raw: Partial<NewsReaderPrefs> | null | undefined): NewsReaderPrefs {
  const base = { ...DEFAULT_NEWS_READER_PREFS };
  if (!raw || typeof raw !== "object") return base;
  return {
    fontSize: clamp(Number(raw.fontSize) || base.fontSize, 12, 36),
    lineSpacing: clamp(Number(raw.lineSpacing) || base.lineSpacing, 1.2, 2.6),
    paragraphSpacing: clamp(Number(raw.paragraphSpacing) || base.paragraphSpacing, 0.6, 2.2),
    fontFamily: typeof raw.fontFamily === "string" ? raw.fontFamily : base.fontFamily,
    marginSize: typeof raw.marginSize === "string" ? raw.marginSize : base.marginSize,
    theme: (NEWS_READER_THEME_OPTIONS.some((t) => t.id === raw.theme) ? raw.theme : base.theme) as NewsReaderThemeId,
    brightness: clamp(Number(raw.brightness) || base.brightness, 40, 100),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function loadNewsReaderPrefs(): NewsReaderPrefs {
  try {
    const saved = localStorage.getItem(NEWS_READER_PREFS_KEY);
    if (!saved) return { ...DEFAULT_NEWS_READER_PREFS };
    return normalizePrefs(JSON.parse(saved));
  } catch {
    return { ...DEFAULT_NEWS_READER_PREFS };
  }
}

export function saveNewsReaderPrefs(prefs: NewsReaderPrefs): void {
  const next = normalizePrefs(prefs);
  localStorage.setItem(NEWS_READER_PREFS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(NEWS_READER_PREFS_EVENT, { detail: next }));
}

export function patchNewsReaderPrefs(patch: Partial<NewsReaderPrefs>): NewsReaderPrefs {
  const next = normalizePrefs({ ...loadNewsReaderPrefs(), ...patch });
  saveNewsReaderPrefs(next);
  return next;
}
