import React, { useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown, ChevronUp, Filter, Grid, Loader2, RefreshCw, Share2, Settings2 } from "lucide-react";
import type { FeedItem } from "../lib/feedStorage";
import { getItemThumbnail } from "../lib/feedPreview";
import { resolveFeedArticle, prepareFeedArticleHtml } from "../lib/feedArticle";
import { toast } from "react-hot-toast";

// Ken Burns loop: alternate slow zoom-in / zoom-out / pan so the cover is
// always in motion, but never scales below 1 so blank edges never show.
// Direction is chosen per-slide from the image size (wide → pan sideways,
// tall → zoom) so it doesn't over-zoom a small image into nothing.
const KEN_BURNS = `
@keyframes koraKBzoomIn { from { transform: scale(1.08); } to { transform: scale(1.18); } }
@keyframes koraKBzoomOut { from { transform: scale(1.18); } to { transform: scale(1.08); } }
@keyframes koraKBpanX { from { transform: scale(1.12) translateX(-3%); } to { transform: scale(1.12) translateX(3%); } }
@keyframes koraKBpanY { from { transform: scale(1.12) translateY(-3%); } to { transform: scale(1.12) translateY(3%); } }
.kora-kb { animation-duration: 18s; animation-iteration-count: infinite; animation-direction: alternate; animation-timing-function: ease-in-out; will-change: transform; }
.kora-kb-zi { animation-name: koraKBzoomIn; }
.kora-kb-zo { animation-name: koraKBzoomOut; }
.kora-kb-px { animation-name: koraKBpanX; }
.kora-kb-py { animation-name: koraKBpanY; }
@media (prefers-reduced-motion: reduce) {
  .kora-kb { animation: none !important; transform: scale(1.08) !important; }
}
`;

/**
 * Build a Kora-styled shareable card image: headline + short description +
 * cover photo + a deep link that opens the article directly in the Kora app.
 * Returns a data URL. Pure canvas — no external deps.
 */
async function buildKoraShareImage(item: FeedItem, cover?: string): Promise<string> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");

  const INK = "#1a1a18";
  const PAPER = "#ECE8D4";
  const ACCENT = "#7c9a5a";
  const MUTED = "#6b6357";

  // Paper background
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // Cover image area (top 720px), with accent frame
  const imgY = 0;
  const imgH = 760;
  if (cover) {
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = cover;
      });
      // cover-fit
      const ratio = Math.min(W / img.width, imgH / img.height);
      const dw = img.width * ratio;
      const dh = img.height * ratio;
      ctx.drawImage(img, (W - dw) / 2, imgY + (imgH - dh) / 2, dw, dh);
    } catch {
      // draw accent block fallback
      ctx.fillStyle = ACCENT;
      ctx.fillRect(0, imgY, W, imgH);
    }
  } else {
    ctx.fillStyle = ACCENT;
    ctx.fillRect(0, imgY, W, imgH);
  }
  // subtle dark gradient at image bottom for legibility
  const grad = ctx.createLinearGradient(0, imgH - 220, 0, imgH);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, imgH - 220, W, 220);

  // Kora wordmark (ink, near-white safe)
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 46px Lexend, Georgia, serif";
  ctx.textBaseline = "top";
  ctx.fillText("KORA", 64, 56);

  let y = imgH + 70;

  // Source + "READ IN KORA" eyebrow
  const source = (() => {
    try {
      return new URL(item.link).hostname.replace(/^www\./, "");
    } catch {
      return item.subscriptionTitle || "kora";
    }
  })();
  ctx.fillStyle = ACCENT;
  ctx.font = "700 30px Arial, sans-serif";
  ctx.fillText(source.toUpperCase(), 64, y);
  y += 50;

  // Headline (wrap)
  ctx.fillStyle = INK;
  ctx.font = "700 58px Lexend, Georgia, serif";
  const head = item.title || "Kora news";
  y = wrapText(ctx, head, 64, y, W - 128, 68, 4);

  // Short description (wrap, muted) — clamp to keep the footer visible
  const desc = (item.summary || "").replace(/\s+/g, " ").trim();
  if (desc) {
    y += 28;
    ctx.fillStyle = MUTED;
    ctx.font = "400 34px Georgia, serif";
    y = wrapText(ctx, desc, 64, y, W - 128, 46, 3);
  }

  // Footer: deep link + tagline
  ctx.fillStyle = INK;
  ctx.font = "700 32px Arial, sans-serif";
  ctx.fillText("Read this in the Kora app →", 64, H - 150);
  ctx.fillStyle = MUTED;
  ctx.font = "400 28px Arial, sans-serif";
  const link = buildKoraDeepLink(item);
  ctx.fillText(truncate(link, 56), 64, H - 100);

  return canvas.toDataURL("image/png");
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxLines: number
): number {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lineH;
      line = words[i];
      lines++;
      if (lines >= maxLines - 1) break;
    } else {
      line = test;
    }
  }
  // last (possibly truncated) line
  const remaining = words.slice(words.indexOf(line) + (line ? 1 : 0)).join(" ");
  const last = line + (remaining && lines < maxLines - 1 ? " " + remaining : "");
  if (lines < maxLines) {
    let l = last;
    while (ctx.measureText(l + "…").width > maxW && l.length > 1) l = l.slice(0, -1);
    ctx.fillText(l + (l.length < last.length ? "…" : ""), x, y);
    y += lineH;
  }
  return y;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Deep link that opens the article directly in the Kora app (APK + web). */
function buildKoraDeepLink(item: FeedItem): string {
  try {
    return `app.kora.reader://news?url=${encodeURIComponent(item.link)}`;
  } catch {
    return "kora.app";
  }
}

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

  // Inject Ken Burns keyframes once.
  useEffect(() => {
    if (document.getElementById("kora-kb-style")) return;
    const style = document.createElement("style");
    style.id = "kora-kb-style";
    style.textContent = KEN_BURNS;
    document.head.appendChild(style);
  }, []);

  // Pick a Ken Burns variant from the cover's natural dimensions so we never
  // over-zoom a tiny image or pan a portrait photo off-screen.
  const kbClassFor = (item: FeedItem, idx: number): string => {
    const cover = getItemThumbnail(item);
    if (!cover) return "";
    const key = `kora-kb-dims:${cover}`;
    let dims = (window as any).__koraKbDims?.[key] as { w: number; h: number } | undefined;
    const variants = ["kora-kb-zi", "kora-kb-zo", "kora-kb-px", "kora-kb-py"];
    if (!dims) {
      // No dimensions yet — pick a stable pseudo-random variant from the index.
      return `kora-kb ${variants[idx % variants.length]}`;
    }
    const ratio = dims.w / dims.h;
    if (ratio > 1.4) return "kora-kb kora-kb-px";
    if (ratio < 0.8) return "kora-kb kora-kb-py";
    return `kora-kb ${variants[idx % 2 === 0 ? 0 : 1]}`;
  };


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
    try {
      const cover = getItemThumbnail(item);
      const dataUrl = await buildKoraShareImage(item, cover);
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "kora-news.png", { type: "image/png" });
      const deepLink = buildKoraDeepLink(item);

      // Prefer sharing the image + deep link via the native share sheet.
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: item.title,
            text: `${item.title}\n\nRead it in the Kora app: ${deepLink}`,
          });
          return;
        } catch {
          // user cancelled — fall through to generic share
        }
      }
      if (navigator.share) {
        try {
          await navigator.share({
            title: item.title,
            text: `${item.title}\n\nRead it in the Kora app: ${deepLink}`,
            url: deepLink,
          });
          return;
        } catch {
          // user cancelled or failed, fallback
        }
      }
      // No share API: download the image, copy the article link.
      try {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = "kora-news.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await navigator.clipboard.writeText(item.link);
        toast.success("Share card saved & link copied");
        return;
      } catch { /* ignore */ }
      await navigator.clipboard.writeText(item.link);
      toast.success("Article link copied to clipboard");
    } catch {
      // Image generation failed — simple link fallback.
      try {
        await navigator.clipboard.writeText(item.link);
        toast.success("Article link copied to clipboard");
      } catch {
        toast.error("Failed to share");
      }
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
  const sectionStyle = !isMobile && height ? { height: `${height}px` } : undefined;

  return (
    <div
      style={wrapperStyle}
      className={
        isMobile
          ? "fixed inset-x-0 top-0 bottom-0 w-full bg-neutral-950 z-[45] flex flex-col overflow-hidden"
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
          const kbCls = !perfMode ? kbClassFor(item, index) : "";

          const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
            try {
              const el = e.currentTarget;
              const w = el.naturalWidth, h = el.naturalHeight;
              if (w && h) {
                const store = ((window as any).__koraKbDims ||= {});
                store[`kora-kb-dims:${cover}`] = { w, h };
              }
            } catch { /* ignore */ }
          };

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
                  onLoad={onImgLoad}
                  className={
                    isMobile
                      ? `absolute inset-0 w-full h-full object-cover ${kbCls} ${
                          isExpanded ? "blur-sm" : ""
                        } ${grayscaleCovers ? "grayscale" : ""}`
                      : `absolute inset-0 w-full h-full object-cover rounded-2xl ${kbCls} ${
                          isExpanded ? "blur-sm" : ""
                        } ${grayscaleCovers ? "grayscale" : ""}`
                  }
                />
              ) : (
                <div
                  className={
                    isMobile
                      ? `absolute inset-0 bg-gradient-to-br from-kindle-accent/30 to-black/60 ${kbCls} ${
                          isExpanded ? "blur-xs" : ""
                        }`
                      : `absolute inset-0 bg-gradient-to-br from-kindle-accent/30 to-black/60 rounded-2xl ${kbCls} ${
                          isExpanded ? "blur-xs" : ""
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
                      : "bg-gradient-to-t from-[#ECE8D4] via-[#ECE8D4]/95 to-[#ECE8D4]/40"
                    : isDarkMode
                      ? "bg-gradient-to-t from-black/95 via-black/55 to-black/10"
                      : "bg-gradient-to-t from-[#ECE8D4] via-[#ECE8D4]/85 to-[#ECE8D4]/10"
                }`}
              />

              <div
                className={`relative z-10 cursor-pointer select-text pb-[7rem] md:pb-6 transition-all duration-300 ${
                  isDarkMode ? "text-white" : "text-neutral-900"
                }`}
                onClick={() => setExpandedIndex(isExpanded ? null : index)}
              >
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest mb-1 sm:mb-2 transition-colors ${
                  isDarkMode ? "text-white/80" : "text-neutral-600"
                }`}>
                  {source}
                  {item.read ? (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                      isDarkMode ? "bg-white/20 text-white" : "bg-neutral-200 text-neutral-800"
                    }`}>Read</span>
                  ) : (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                      isDarkMode ? "bg-kindle-accent text-black" : "bg-kindle-accent text-neutral-900"
                    }`}>New</span>
                  )}
                </span>
                <h2 className={`text-lg sm:text-xl md:text-2xl font-lexend font-bold leading-tight mb-2 sm:mb-3 transition-all ${
                  isDarkMode
                    ? isExpanded ? "text-white" : "line-clamp-4 text-white"
                    : isExpanded ? "text-neutral-950" : "line-clamp-4 text-neutral-900"
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
