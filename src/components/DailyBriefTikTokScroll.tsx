import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ExternalLink, Newspaper, Settings2, Share2, Bookmark, Loader2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { useAndroidBackLayer } from "../hooks/useAndroidBackLayer";
import { useNewsReaderPrefs } from "../hooks/useNewsReaderPrefs";
import { newsReaderThemeClasses } from "../lib/newsReaderPrefs";
import { collectTodayBriefArticles, buildTodayDailyBrief } from "../lib/dailyNewsBriefClient";
import type { FeedItem } from "../lib/feedStorage";
import NewsReaderSettingsPanel from "./NewsReaderSettingsPanel";

interface DailyBriefTikTokScrollProps {
  items: FeedItem[];
  onReadArticle: (item: FeedItem) => void;
  onOpenManage?: () => void;
}

interface BriefSlide {
  source: string;
  itemCount: number;
  headline: string;
  detail: string;
  link: string;
  id: string;
  cover?: string;
  sourceId?: string;
  sourceUrl?: string;
  sourceIconUrl?: string;
  sourceFaviconUrl?: string;
}

function sectionToSlide(section: { source: string; items: { headline: string; detail: string; link: string }[] }, fallbackCover?: string): BriefSlide {
  const top = section.items[0];
  return {
    source: section.source,
    itemCount: section.items.length,
    headline: top?.headline || section.source,
    detail: top?.detail || "",
    link: top?.link || section.items[1]?.link || "",
    id: `${section.source}:${(top?.link || "").slice(0, 32)}`,
    cover: fallbackCover,
  };
}

export default function DailyBriefTikTokScroll({ items, onReadArticle, onOpenManage }: DailyBriefTikTokScrollProps) {
  const brief = useMemo(() => {
    const articles = collectTodayBriefArticles(items);
    const built = buildTodayDailyBrief(articles);
    if (!built) return null;
    if (!built.sections.length) return null;
    return built;
  }, [items]);

  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const { prefs, updatePrefs } = useNewsReaderPrefs();
  const theme = useMemo(() => newsReaderThemeClasses(prefs.theme), [prefs.theme]);

  /* ---------- TikTok snap state ---------- */
  const slides = useMemo<BriefSlide[]>(() => {
    if (!brief) return [];
    const covers = items.slice(0, 8).map((it) => (typeof (it as any).thumbnail === "string" ? (it as any).thumbnail : undefined));
    return brief.sections.map((s) => sectionToSlide(s, covers[Math.floor(Math.random() * covers.length)] || undefined));
  }, [brief, items]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== "undefined" ? window.innerWidth < 768 : true);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [articleHtmlMap, setArticleHtmlMap] = useState<Record<string, { html: string; loading: boolean }>>({});

  const go = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el || !slides.length) return;
    const next = Math.min(slides.length - 1, Math.max(0, active + dir));
    el.children[next]?.scrollIntoView({ behavior: "smooth" });
  }, [active, slides.length]);

  const dismiss = useAndroidBackLayer(open, "daily-brief-tiktok", () => {
    setShowSettings(false);
    setOpen(false);
  });

  const kbClassFor = (idx: number): string => {
    const cover = slides[idx]?.cover;
    if (!cover) return "";
    const list = ["kora-kb-zi", "kora-kb-zo", "kora-kb-px", "kora-kb-py"];
    return `kora-kb ${list[idx % list.length]}`;
  };

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Lock scroll while overlay is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!brief) return null;

  const readSlideItem = (link: string) => {
    const article = (items as FeedItem[]).find((it) => it.link === link);
    if (article) {
      dismiss();
      onReadArticle(article);
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
  };

  /* ---------- slide renderer ---------- */
  const slide = (s: BriefSlide, idx: number) => {
    const isExpanded = expandedIndex === idx;
    return (
      <section
        key={s.id}
        className="relative snap-start snap-always [scroll-snap-stop:always] flex flex-col justify-end p-4 md:p-6 h-full w-full shrink-0 overflow-hidden"
      >
        <div className={`absolute inset-0 ${s.cover ? "" : "rounded-2xl"} ${kbClassFor(idx)}`}>
          {s.cover ? (
            <img src={s.cover} alt="" referrerPolicy="no-referrer" loading="lazy"
                 className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-kindle-accent/20 to-black/60" />
          )}
        </div>
        <div className={`absolute inset-0 transition-all duration-300 ${isExpanded ? "bg-black/85" : "bg-gradient-to-t from-black/95 via-black/40 to-black/10"}`} />

        {/* source + swipe hint */}
        <div className="absolute left-0 right-0 bottom-[28%] md:bottom-[20%] z-20 pointer-events-none px-5">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80">
            {s.source}
            {`${s.itemCount} stor${s.itemCount === 1 ? "y" : "ies"}`}
          </span>
        </div>

        <div className={`relative z-10 cursor-pointer select-text pb-[7.5rem] md:pb-6 pr-16 md:pr-24 ${isExpanded ? "text-white" : ""}`} onClick={() => setExpandedIndex(isExpanded ? null : idx)}>
          <h2 className={`text-lg sm:text-xl md:text-2xl font-lexend font-bold leading-tight mb-2 transition-all ${isExpanded ? "text-white" : "line-clamp-4 text-white"}`}>
            {s.headline}
          </h2>
          <p className="text-xs sm:text-sm leading-relaxed text-white/80 font-serif whitespace-pre-wrap">{s.detail}</p>

          {/* expanded: bullet cards for all stories */}
          {isExpanded && (
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">Brief Settings</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowSettings((v) => !v); }}
                    className="p-2 rounded-full bg-white/15 text-white border border-white/20"
                    aria-pressed={showSettings}
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>
                </div>
                {showSettings && (
                  <div className="rounded-xl bg-black/50 p-3 border border-white/10">
                    <NewsReaderSettingsPanel prefs={prefs} onChange={updatePrefs} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* navigation + counter */}
          <div className="flex items-center gap-2 mt-3.5 text-[10px] sm:text-[11px] text-white/70">
            {isExpanded ? (
              <><ChevronDown className="w-4 h-4 rotate-180" /><span>Tap to collapse</span></>
            ) : (
              <><ChevronDown className="w-4 h-4 animate-bounce" /><span>Tap to open brief</span></>
            )}
            <span className="ml-auto font-mono">{idx + 1}/{slides.length}</span>
          </div>
        </div>
      </section>
    );
  };

  /* ---------- fullbrief overlay (opens from bottom) ---------- */
  const overlay = open ? (
    <div className={`fixed inset-0 z-[9999] flex flex-col ${theme.shell} sm:bg-black/60 sm:items-center sm:justify-center sm:p-4 animate-in fade-in duration-200`} style={{ width: "100vw", height: "100dvh", maxHeight: "100dvh", filter: prefs.brightness < 100 ? `brightness(${prefs.brightness}%)` : undefined }} role="presentation">
      <button type="button" aria-label="Close brief" className="hidden sm:block absolute inset-0 cursor-pointer" onClick={() => dismiss()} />
      <div role="dialog" aria-modal="true" aria-label="Today's News Brief"
        className={`relative flex flex-col w-full h-full min-h-0 overflow-hidden ${theme.shell} sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-2xl sm:border ${theme.border} sm:shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200`} onClick={(e) => e.stopPropagation()}>

        <div className={`absolute z-20 left-0 right-0 top-0 flex items-start justify-between gap-2 pointer-events-none transition-opacity ${chromeVisible || showSettings ? "opacity-100" : "opacity-0"}`} style={{ padding: "max(0.5rem, var(--kora-safe-left)) max(0.5rem, var(--kora-safe-right)) 0 max(0.5rem, var(--kora-safe-left))" }}>
          <button type="button" onClick={() => dismiss()} className={`pointer-events-auto p-2.5 rounded-full ${theme.header} border ${theme.border} shadow-lg backdrop-blur-md`} aria-label="Back"><ChevronLeft className="w-5 h-5" /></button>
          <div className="pointer-events-auto flex items-center gap-2 pt-2 pr-2">
            <button type="button" onClick={() => setShowSettings((v) => !v)} className={`p-2.5 rounded-full ${theme.header} border ${theme.border} shadow-lg backdrop-blur-md`} aria-pressed={showSettings} aria-label="Brief reader settings"><Settings2 className="w-4 h-4" /></button>
            <button type="button" onClick={() => { toast.success("Article link copied to clipboard"); }} className={`p-2.5 rounded-full ${theme.header} border ${theme.border} shadow-lg backdrop-blur-md`} aria-label="Share brief"><Share2 className="w-4 h-4" /></button>
          </div>
        </div>

        <div className={`flex-1 overflow-y-auto overscroll-contain min-h-0`} style={{ paddingTop: `calc(var(--kora-safe-top) + 3.25rem)`, paddingBottom: `calc(var(--kora-safe-bottom) + 1.5rem)` }} onClick={() => { if (showSettings) { setShowSettings(false); return; } setChromeVisible((v) => !v); }}>
          <div className={`${theme.content}`} onClick={(e) => { if (showSettings) { setShowSettings(false); e.stopPropagation(); } else { e.stopPropagation(); } }}>
            <div className="space-y-1 mb-4">
              <p className={`text-[9px] font-bold uppercase tracking-widest ${theme.muted}`}>Daily News Brief</p>
              <h2 className="font-lexend font-bold" style={{ fontSize: `${Math.round(prefs.fontSize * 1.25)}px`, lineHeight: 1.25 }}>{brief.date ? `Brief · ${brief.date}` : "Today’s News Brief"}</h2>
              <p className={`font-mono ${theme.muted}`} style={{ fontSize: `${Math.max(11, Math.round(prefs.fontSize * 0.72))}px`, lineHeight: prefs.lineSpacing }}>
                {brief.sections.reduce((t, s) => t + s.items.length, 0)} stories · {brief.sections.length} sources
              </p>
            </div>
            <p className={theme.content} style={{ fontSize: `${prefs.fontSize}px`, lineHeight: prefs.lineSpacing }}>{brief.lead}</p>
            <div style={{ marginTop: `${prefs.paragraphSpacing * 0.6}em` }} className="space-y-5 mt-4">
              {brief.sections.map((section, i) => (
                <section key={section.source} style={{ marginTop: i ? `${prefs.paragraphSpacing * 0.6}em` : 0 }} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className={`text-[10px] font-bold uppercase tracking-widest ${theme.muted}`}>{section.source}</h3>
                    <span className={`font-mono shrink-0 ${theme.muted}`} style={{ fontSize: `${Math.max(11, Math.round(prefs.fontSize * 0.72))}px`, lineHeight: prefs.lineSpacing }}>{section.items.length} stor{section.items.length === 1 ? "y" : "ies"}</span>
                  </div>
                  {section.intro ? <p className={theme.muted} style={{ fontSize: `${Math.max(12, Math.round(prefs.fontSize * 0.85))}px`, lineHeight: prefs.lineSpacing, marginTop: `${prefs.paragraphSpacing * 0.35}em` }}>{section.intro}</p> : null}
                  <ul className="space-y-2.5">
                    {section.items.map((story) => (
                      <li key={story.link} className={`rounded-xl border ${theme.border} ${theme.header} p-3`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0" style={{ fontSize: `${prefs.fontSize}px`, lineHeight: 1.5 }}>
                            <p className="font-lexend font-bold leading-snug">{story.headline}</p>
                            <p className={theme.muted} style={{ fontSize: `${Math.max(12, Math.round(prefs.fontSize * 0.85))}px`, lineHeight: prefs.lineSpacing, marginTop: `${prefs.paragraphSpacing * 0.35}em` }}>{story.detail}</p>
                          </div>
                          <button type="button" onClick={() => readSlideItem(open ? story.link : "")} className={`shrink-0 p-1.5 rounded-lg border ${theme.border} ${theme.muted} hover:opacity-90 transition`}>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
        {showSettings ? <NewsReaderSettingsPanel prefs={prefs} onChange={updatePrefs} /> : null}
      </div>
    </div>
  ) : null;

  return (
    <div className="fixed inset-x-0 top-0 bottom-0 w-full bg-neutral-950 z-[45] flex flex-col overflow-hidden">
      {/* header */}
      <div className="absolute left-0 right-0 z-30 flex items-center justify-between gap-2 pointer-events-none pt-[max(env(safe-area-inset-top),0.75rem)] px-3">
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button type="button" onClick={() => setOpen(true)} className="p-2 rounded-full border border-amber-400/30 bg-amber-500/10 backdrop-blur-md text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.25)] active:scale-95 transition" title="Read Brief"><Newspaper className="w-4 h-4" /></button>
          {onOpenManage && (
            <button type="button" onClick={onOpenManage} className="p-2.5 rounded-full border border-white/20 bg-black/50 backdrop-blur-md text-white active:scale-95 transition" title="Manage feeds"><Settings2 className="w-4 h-4" /></button>
          )}
        </div>
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button type="button" onClick={dismiss} className="p-2.5 rounded-full border border-white/20 bg-black/50 backdrop-blur-md text-white active:scale-95 transition" title="Close"><Bookmark className="w-4 h-4" /></button>
        </div>
      </div>

      {/* progress */}
      <div className="absolute left-4 right-4 z-20 flex gap-1 pointer-events-none top-[4.75rem]">
        {slides.map((_, i) => <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= active ? "bg-amber-400" : "bg-white/20"}`} />)}
      </div>

      <div ref={scrollRef} tabIndex={0} onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === " ") { e.preventDefault(); go(1); } else if (e.key === "ArrowUp") { e.preventDefault(); go(-1); } }} className="w-full h-full overflow-y-auto overscroll-contain scrollbar-none touch-pan-y snap-y snap-mandatory [scroll-snap-stop:always]">
        {slides.map((s, i) => slide(s, i))}
      </div>

      {overlay}
    </div>
  );
}
