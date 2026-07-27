import React, { useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown, ChevronUp, Filter, Grid, Loader2, RefreshCw, Share2, Settings2 } from "lucide-react";
import type { FeedItem } from "../lib/feedStorage";
import { getItemThumbnail } from "../lib/feedPreview";
import { resolveFeedArticle, prepareFeedArticleHtml } from "../lib/feedArticle";
import { toast } from "react-hot-toast";

interface FeedTikTokScrollProps {
  items: FeedItem[];
  grayscaleCovers?: boolean;
  perfMode?: boolean;
  onRead: (item: FeedItem) => void;
  onSave: (item: FeedItem) => void;
  onExit?: () => void;
  onRefresh?: () => void;
  onManage?: () => void;
  onFilter?: () => void;
  refreshing?: boolean;
  height?: number | null;
}

/**
 * TikTok/Reels-style vertical news scroll: one article per screen, swipe or
 * arrow-key to advance, tap to open the fullscreen reader, Save pill per slide.
 * Uses theme vars so it works in light/dark/yellow/blue. Respects perf mode
 * (disables snap + smooth scroll) and reduced-motion.
 *
 * Implements an immersive full-screen view on mobile (z-index 110) covering headers
 * and tab bars, and extracts the progress indicators out of the scroll container to
 * guarantee perfect snap alignment and no text clipping.
 */
export default function FeedTikTokScroll({
  items,
  grayscaleCovers,
  perfMode,
  onRead,
  onSave,
  onExit,
  onRefresh,
  onManage,
  onFilter,
  refreshing,
  height,
}: FeedTikTokScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [articleHtmlMap, setArticleHtmlMap] = useState<Record<string, { html: string; loading: boolean }>>({});

  useEffect(() => {
    if (expandedIndex === null) return;
    const item = items[expandedIndex];
    if (!item) return;
    if (articleHtmlMap[item.id]?.loading || articleHtmlMap[item.id]?.html) return;

    setArticleHtmlMap((prev) => ({
      ...prev,
      [item.id]: { html: "", loading: true },
    }));

    resolveFeedArticle(item)
      .then((res) => {
        const prepared = prepareFeedArticleHtml(res.htmlContent || "", res.title || item.title);
        setArticleHtmlMap((prev) => ({
          ...prev,
          [item.id]: { html: prepared || item.summary || "", loading: false },
        }));
      })
      .catch(() => {
        setArticleHtmlMap((prev) => ({
          ...prev,
          [item.id]: { html: item.summary || "", loading: false },
        }));
      });
  }, [expandedIndex, items, articleHtmlMap]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Collapse full details automatically when user scrolls to a different slide
  useEffect(() => {
    setExpandedIndex(null);
  }, [active]);

  const handleShare = async (item: FeedItem) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: item.title,
          text: item.summary || item.title,
          url: item.link,
        });
        return;
      } catch (err) {
        // user cancelled or failed, fallback
      }
    }
    try {
      await navigator.clipboard.writeText(item.link);
      toast.success("Article link copied to clipboard");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const go = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const next = Math.min(items.length - 1, Math.max(0, active + dir));
    el.children[next]?.scrollIntoView({ behavior: perfMode ? "auto" : "smooth" });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const idx = Array.prototype.indexOf.call(el.children, e.target);
            if (idx >= 0) setActive(idx);
          }
        });
      },
      { root: el, threshold: 0.6 }
    );
    Array.from(el.children).forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [items.length]);

  if (!items.length) return null;

  // Layout styles
  const wrapperStyle = !isMobile && height ? { height: `${height}px` } : undefined;
  const sectionStyle = !isMobile && height ? { height: `${height}px`, contentVisibility: "auto" as const } : { contentVisibility: "auto" as const };

  return (
    <div
      style={wrapperStyle}
      className={
        isMobile
          ? "fixed inset-x-0 top-0 bottom-14 w-full bg-neutral-950 z-[110] flex flex-col overflow-hidden"
          : "relative w-full rounded-2xl overflow-hidden border border-kindle-border bg-kindle-card shadow-xs"
      }
    >
      {/* 1. Immersive Floating Header for Mobile */}
      {isMobile && (
        <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between gap-2 pointer-events-none">
          <div className="flex items-center gap-1.5 pointer-events-auto">
            {onManage && (
              <button
                type="button"
                onClick={onManage}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-white/20 bg-black/50 backdrop-blur-md text-[10px] font-bold uppercase tracking-wider text-white active:scale-95 transition"
                title="Manage feeds"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Manage</span>
              </button>
            )}
            {onFilter && (
              <button
                type="button"
                onClick={onFilter}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-white/20 bg-black/50 backdrop-blur-md text-[10px] font-bold uppercase tracking-wider text-white active:scale-95 transition"
                title="Filter & sources"
              >
                <Filter className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Filter</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 pointer-events-auto">
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/20 bg-black/50 backdrop-blur-md text-[10px] font-bold uppercase tracking-wider text-white active:scale-95 transition"
              >
                <Grid className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Grid</span>
              </button>
            )}

            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="p-2 rounded-full border border-white/20 bg-black/50 backdrop-blur-md text-white active:scale-95 transition disabled:opacity-50"
                title="Refresh feeds"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. Top Progress Indicators - Extracted out of flow to prevent offset clipping */}
      <div className={`absolute left-4 right-4 z-20 flex gap-1 pointer-events-none ${isMobile ? "top-20" : "top-3"}`}>
        {items.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= active ? "bg-kindle-accent" : "bg-white/20"
            }`}
          />
        ))}
      </div>

      {/* 3. Snapping Scroll Container */}
      <div
        ref={ref}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === " ") {
            e.preventDefault();
            go(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            go(-1);
          }
        }}
        className={`w-full h-full overflow-y-auto overscroll-contain scrollbar-none ${
          perfMode ? "" : "snap-y snap-mandatory"
        }`}
      >
        {items.map((item, index) => {
          const cover = getItemThumbnail(item);
          const isExpanded = expandedIndex === index;
          const isDarkMode = document.body.classList.contains("dark") || document.body.className.includes("dark");

          const source = (() => {
            try {
              return new URL(item.link).hostname.replace(/^www\./, "");
            } catch {
              return item.subscriptionTitle;
            }
          })();
          return (
            <section
              key={item.id}
              style={sectionStyle}
              className="relative snap-start flex flex-col justify-end p-4 md:p-6 h-full w-full shrink-0 overflow-hidden"
            >
              {cover ? (
                <img
                  src={cover}
                  alt=""
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className={
                    isMobile
                      ? `absolute inset-0 w-full h-full object-cover transition-all duration-300 ${
                          isExpanded ? "blur-sm scale-105" : ""
                        } ${grayscaleCovers ? "grayscale" : ""}`
                      : `absolute inset-0 w-full h-full object-cover rounded-2xl transition-all duration-300 ${
                          isExpanded ? "blur-sm scale-105" : ""
                        } ${grayscaleCovers ? "grayscale" : ""}`
                  }
                />
              ) : (
                <div
                  className={
                    isMobile
                      ? `absolute inset-0 bg-gradient-to-br from-kindle-accent/30 to-black/60 transition-all duration-300 ${
                          isExpanded ? "blur-xs scale-105" : ""
                        }`
                      : `absolute inset-0 bg-gradient-to-br from-kindle-accent/30 to-black/60 rounded-2xl transition-all duration-300 ${
                          isExpanded ? "blur-xs scale-105" : ""
                        }`
                  }
                />
              )}
              <div
                              className={`absolute inset-0 transition-all duration-300 ${
                                isMobile ? "" : "rounded-2xl"
                              } ${
                                isExpanded
                                  ? isDarkMode
                                    ? "bg-black/80"
                                    : "bg-gradient-to-t from-white via-white/95 to-white/45"
                                  : isDarkMode
                                    ? "bg-gradient-to-t from-black/95 via-black/40 to-transparent"
                                    : "bg-gradient-to-t from-white/95 via-white/40 to-transparent"
                              }`}
                            />

              <div
                className={`relative z-10 cursor-pointer select-text pb-10 md:pb-6 transition-all duration-300 ${
                  isExpanded && !isDarkMode ? "text-neutral-900" : "text-white"
                }`}
                onClick={() => setExpandedIndex(isExpanded ? null : index)}
              >
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest mb-1 sm:mb-2 transition-colors ${
                  isExpanded && !isDarkMode ? "text-neutral-600" : "text-white/80"
                }`}>
                  {source}
                  {item.read ? (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                      isExpanded && !isDarkMode ? "bg-neutral-200 text-neutral-800" : "bg-white/20 text-white"
                    }`}>Read</span>
                  ) : (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                      isExpanded && !isDarkMode ? "bg-kindle-accent text-neutral-900" : "bg-kindle-accent text-black"
                    }`}>New</span>
                  )}
                </span>
                <h2 className={`text-lg sm:text-xl md:text-2xl font-lexend font-bold leading-tight mb-2 sm:mb-3 transition-all ${
                  isExpanded
                    ? isExpanded && !isDarkMode
                      ? "text-neutral-950"
                      : "text-white"
                    : "line-clamp-4 text-white"
                }`}>
                  {item.title}
                </h2>

                {/* Expanded Details Section */}
                {isExpanded && (
                  <div
                    className={`mt-4 overflow-y-auto max-h-[45vh] pr-2 space-y-4 border-t pt-4 transition-colors ${
                      isDarkMode
                        ? "border-white/10 text-neutral-200"
                        : "border-neutral-200 text-neutral-800"
                    } scrollbar-thin select-text`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {articleHtmlMap[item.id]?.loading ? (
                      <div className="flex items-center gap-2 py-4">
                        <Loader2 className="w-4 h-4 animate-spin text-kindle-accent shrink-0" />
                        <p className="text-xs font-sans">Extracting full article…</p>
                      </div>
                    ) : articleHtmlMap[item.id]?.html ? (
                      <div
                        dir="auto"
                        className={`feed-article-content max-w-none text-xs sm:text-sm font-serif leading-relaxed [&_*]:[unicode-bidi:plaintext] ${
                          isDarkMode ? "text-neutral-200" : "text-neutral-900"
                        }`}
                        dangerouslySetInnerHTML={{ __html: articleHtmlMap[item.id].html }}
                      />
                    ) : item.summary ? (
                      <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-serif">
                        {item.summary}
                      </p>
                    ) : (
                      <p className="text-xs sm:text-sm italic opacity-70">
                        No content available for this article.
                      </p>
                    )}

                    <div className="pt-2">
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider hover:underline ${
                          isDarkMode ? "text-kindle-accent" : "text-neutral-900 underline decoration-kindle-accent decoration-2"
                        }`}
                      >
                        Read Full Original Article →
                      </a>
                    </div>
                  </div>
                )}

                {/* Save and Share Buttons Row */}
                <div
                  className="flex items-center gap-2 mt-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onSave(item)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all duration-200 shadow-xs active:scale-95 border ${
                      isExpanded && !isDarkMode
                        ? item.saved
                          ? "bg-kindle-accent/25 text-kindle-accent border-kindle-accent/30 font-extrabold"
                          : "bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border-neutral-200 font-bold"
                        : item.saved
                          ? "bg-kindle-accent/30 text-kindle-accent border-kindle-accent/40 font-extrabold"
                          : "bg-white/15 hover:bg-white/25 text-white border-white/10 font-bold"
                    }`}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${item.saved ? "fill-current" : ""}`} />
                    <span>{item.saved ? "Saved" : "Save"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleShare(item)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all duration-200 shadow-xs active:scale-95 border ${
                      isExpanded && !isDarkMode
                        ? "bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border-neutral-200 font-bold"
                        : "bg-white/15 hover:bg-white/25 text-white border-white/10 font-bold"
                    }`}
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share</span>
                  </button>
                </div>

                {/* Navigation and State Indicator */}
                <div className={`flex items-center gap-2 mt-3.5 text-[10px] sm:text-[11px] transition-colors ${
                  isExpanded && !isDarkMode ? "text-neutral-600" : "text-white/70"
                }`}>
                  {isExpanded ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      <span>Tap to collapse</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-bounce" />
                      <span>Tap to read</span>
                    </>
                  )}
                  <span className="ml-auto font-mono">
                    {index + 1}/{items.length}
                  </span>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
