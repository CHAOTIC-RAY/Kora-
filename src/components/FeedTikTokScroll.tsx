import React, { useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown, ChevronUp, Filter, Grid, Loader2, RefreshCw, Share2, Settings2, Zap } from "lucide-react";
import type { FeedItem } from "../lib/feedStorage";
import { getItemThumbnail } from "../lib/feedPreview";
import { resolveFeedArticle, prepareFeedArticleHtml } from "../lib/feedArticle";
import { resolveCoverImageSrc } from "../lib/coverImage";
import { toast } from "react-hot-toast";

// Ken Burns loop: alternate slow zoom-in / zoom-out / pan so the cover is
// always in motion, but never scales below 1 so blank edges never show.
// Direction is chosen per-slide from the image size (wide → pan sideways,
// tall → zoom) so it doesn't over-zoom a small image into nothing.
const KEN_BURNS = `
@keyframes koraKBzoomIn {
  0% { transform: scale(1.04); }
  100% { transform: scale(1.16); }
}
@keyframes koraKBzoomOut {
  0% { transform: scale(1.16); }
  100% { transform: scale(1.04); }
}
@keyframes koraKBpanX {
  0% { transform: scale(1.12) translateX(-3.5%); }
  100% { transform: scale(1.12) translateX(3.5%); }
}
@keyframes koraKBpanY {
  0% { transform: scale(1.12) translateY(-3.5%); }
  100% { transform: scale(1.12) translateY(3.5%); }
}
.kora-kb {
  animation-duration: 22s;
  animation-iteration-count: infinite;
  animation-direction: alternate;
  animation-timing-function: ease-in-out;
  will-change: transform;
  transform-origin: center center;
}
.kora-kb-zi { animation-name: koraKBzoomIn; }
.kora-kb-zo { animation-name: koraKBzoomOut; }
.kora-kb-px { animation-name: koraKBpanX; }
.kora-kb-py { animation-name: koraKBpanY; }
@media (prefers-reduced-motion: reduce) {
  .kora-kb { animation: none !important; transform: scale(1.05) !important; }
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
    let objectUrl: string | null = null;
    try {
      const proxied = resolveCoverImageSrc(cover) || cover;
      try {
        const resp = await fetch(proxied);
        if (resp.ok) {
          const blob = await resp.blob();
          objectUrl = URL.createObjectURL(blob);
        }
      } catch {
        // ignore fetch error and fallback to direct URL
      }

      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        if (!objectUrl) {
          im.crossOrigin = "anonymous";
        }
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = objectUrl || proxied;
      });

      // cover-fit
      const ratio = Math.min(W / img.width, imgH / img.height);
      const dw = img.width * ratio;
      const dh = img.height * ratio;
      ctx.drawImage(img, (W - dw) / 2, imgY + (imgH - dh) / 2, dw, dh);
    } catch (err) {
      console.warn("[Kora/Share] Image loading fallback to accent block", err);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(0, imgY, W, imgH);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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

  // Load the beautiful Kora wordmark SVG
  const logoImg = await new Promise<HTMLImageElement>((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null as any); // fallback if it fails
    im.src = "data:image/svg+xml;base64," + btoa(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 287.6 112.78" fill="#ffffff">
        <path d="M287.6,104.25c-1.64,4.59-5.45,6.69-10,7.53-8.61,1.57-11.14-.13-16.94-11-4.9,6.39-10.94,10.55-19,11.62-9.95,1.31-19.48-3.36-22.59-11.64-3.59-9.57-.58-19.55,9.17-24.2,9.2-4.38,19.27-7,29.1-10,3-.9,4.36-1.9,3.94-5-.58-4.27-.66-8.66-1.78-12.78-1.63-6-6.3-9-12.29-8.95s-9.29,3-11.31,9.37c-1,3-.55,7-5,7.73-3.67.56-7.22.11-9-3.68s-.78-7.18,2.33-9.9c6.48-5.68,14.43-7.47,22.66-7.93a48.52,48.52,0,0,1,12.88,1.12c10.13,2.22,15.8,8.93,16.21,19.42.43,11,.28,22,.38,33,0,1.66,0,3.33,0,5C276.63,102.86,278.61,104.64,287.6,104.25Zm-26.6-34c-8.44,2.41-16.47,4.43-22.9,10.05-4.55,4-5.81,10.76-3.44,16.45a11.76,11.76,0,0,0,12,7c5.67-.42,13.76-5.58,14.15-10.21C261.46,86,261,78.4,261,70.24Z"/>
        <path d="M24.18,0V6.78c0,29.14,0,58.28-.07,87.42,0,6,.3,11.44,7.51,13.29.7.19,1.09,1.61,2,3.05H.64l-.64-1c1.19-1,2.24-2.37,3.61-2.9,3.94-1.53,5.62-4.17,5.61-8.4q-.13-40,0-79.93c0-4.73-1.93-7.46-6.26-9C1.9,9,1.15,7.79.27,7,1.2,6.27,2,5.18,3.09,4.92,9.84,3.24,16.64,1.74,24.18,0Z"/>
        <path d="M193.44,110.51H159.7l-.57-1c1.07-.9,2-2.13,3.25-2.62,4.54-1.79,6-5,5.94-9.79-.2-14-.28-28,0-42,.13-5.65-1.58-9.3-7.11-11a3.26,3.26,0,0,1-1.77-2c-.13-.38.8-1.52,1.4-1.67,7-1.75,14.08-3.37,21.77-5.18V51.06l1.11.4,2.54-4.36c3.51-6,8.15-10.58,15.32-11.7,7.35-1.15,12.17,3.38,10.85,10-1,5.16-4.11,6.91-9.13,5.17-12.43-4.32-19.44.57-19.59,13.8-.12,10.66.14,21.33-.21,32-.19,5.71,1.76,9.21,7.35,10.72,1.23.33,2.23,1.52,3.34,2.31Z"/>
        <path d="M78.32,110.77c-7.1,0-14.2.08-21.29-.1a4.78,4.78,0,0,1-3-2Q40.66,90.3,27.46,71.89c5.26-5.49,10.61-11.09,16-16.65,2.08-2.15,4.31-4.16,6.37-6.33,3.77-4,3.34-5.72-1.66-8.06a4.92,4.92,0,0,1-2.57-3.51H73.37l.76,1.25C70.3,40.71,66.22,42.48,62.71,45a109.36,109.36,0,0,0-11.2,9.9C48.05,58.27,44.85,61.86,41,66,53.4,80.35,61.76,98.66,79,109.66Z"/>
        <path d="M151.77,74.1h0a45.46,45.46,0,0,0-3.51-17.51,33.2,33.2,0,0,0-4.87-8.34l-.23-.28c-.23-.29-.47-.58-.71-.86a29.45,29.45,0,0,0-5.49-5,37.39,37.39,0,0,0-43.9,0,29.71,29.71,0,0,0-5.48,5c-.25.28-.48.57-.72.86l-.22.28a33.2,33.2,0,0,0-4.87,8.34,45.27,45.27,0,0,0-3.51,17.51h0A42.74,42.74,0,0,0,82.47,93a32.76,32.76,0,0,0,15.32,15.69,37.5,37.5,0,0,0,15.86,4.09h.07l1.29,0,1.3,0h.07a37.5,37.5,0,0,0,15.86-4.09A32.73,32.73,0,0,0,147.55,93,42.61,42.61,0,0,0,151.77,74.1ZM133,90.13A66.71,66.71,0,0,1,129.34,99a15.55,15.55,0,0,1-14.18,9h-.29a15.56,15.56,0,0,1-14.19-9A66.63,66.63,0,0,1,97,90.13c-.9-3.49-1.64-7-2.42-10.56a51.39,51.39,0,0,1-.4-8.67c1.25-8.9,3.25-16.72,6.32-21.79,3.52-5.81,9-8.92,14.48-9.21,5.47.29,11,3.4,14.49,9.21,3.07,5.07,5.06,12.89,6.31,21.79a51.39,51.39,0,0,1-.4,8.67C134.63,83.1,133.89,86.64,133,90.13Z"/>
      </svg>
    `);
  });

  if (logoImg) {
    const logoW = 160;
    const logoH = logoW * (112.78 / 287.6);
    ctx.drawImage(logoImg, 64, 56, logoW, logoH);
  } else {
    // Kora wordmark fallback
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 46px Lexend, Georgia, serif";
    ctx.textBaseline = "top";
    ctx.fillText("KORA", 64, 56);
  }

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
    return `https://kora.chaoticstudio.workers.dev/news?url=${encodeURIComponent(item.link)}`;
  } catch {
    return "https://kora.chaoticstudio.workers.dev";
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
  onOpenDailyBrief?: () => void;
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
  onOpenDailyBrief,
  refreshing,
  height,
}: FeedTikTokScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [articleHtmlMap, setArticleHtmlMap] = useState<Record<string, { html: string; loading: boolean }>>({});
  const [autoScroll, setAutoScroll] = useState(false);
  const [loadedDims, setLoadedDims] = useState<Record<string, { w: number; h: number }>>({});


  // Auto scroll effect for news feed
  useEffect(() => {
    if (!autoScroll || expandedIndex !== null || !items.length) return;
    const interval = setInterval(() => {
      const el = ref.current;
      if (!el) return;
      setActive((prev) => {
        const next = (prev + 1) % items.length;
        el.children[next]?.scrollIntoView({ behavior: perfMode ? "auto" : "smooth" });
        return next;
      });
    }, 4800);
    return () => clearInterval(interval);
  }, [autoScroll, expandedIndex, items.length, perfMode]);

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
    const dims = loadedDims[cover] || (window as any).__koraKbDims?.[key];
    const variants = ["kora-kb-zi", "kora-kb-zo", "kora-kb-px", "kora-kb-py"];
    if (!dims) {
      // No dimensions yet — pick a stable pseudo-random variant from the index.
      return `kora-kb ${variants[idx % variants.length]}`;
    }
    const ratio = dims.w / dims.h;
    if (ratio > 1.35) return "kora-kb kora-kb-px";
    if (ratio < 0.8) return "kora-kb kora-kb-py";
    return `kora-kb ${idx % 2 === 0 ? "kora-kb-zi" : "kora-kb-zo"}`;
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
      const fileName = "kora-news.png";
      const deepLink = buildKoraDeepLink(item);
      const shareText = `${item.title}\n\nRead it in the Kora app: ${deepLink}`;

      // 1) Native share sheet with the image card + link (Capacitor — reliable on APK).
      try {
        const { Share } = await import("@capacitor/share");
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        await Filesystem.writeFile({ path: fileName, data: dataUrl, directory: Directory.Cache });
        const fileUri = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
        await Share.share({
          title: item.title,
          text: shareText,
          files: [fileUri.uri],
          dialogTitle: "Share article",
        });
        return;
      } catch (nativeErr) {
        console.warn("[Kora/Share] native share failed, trying web", nativeErr);
      }

      // 2) Web fallback: native share API if available, then copy link.
      if (navigator.canShare && navigator.canShare({ files: [new File([blob], fileName, { type: "image/png" })] })) {
        try {
          await navigator.share({ files: [new File([blob], fileName, { type: "image/png" })], title: item.title, text: shareText });
          return;
        } catch { /* user cancelled */ }
      }
      if (navigator.share) {
        try {
          await navigator.share({ title: item.title, text: shareText, url: deepLink });
          return;
        } catch { /* user cancelled */ }
      }
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      await navigator.clipboard.writeText(item.link);
      toast.success("Share card saved & link copied");
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
        <div className="absolute left-0 right-0 z-30 flex items-center justify-between gap-2 pointer-events-none pt-[max(env(safe-area-inset-top),0.75rem)] px-3">
          <div className="flex items-center gap-1.5 pointer-events-auto">
            {onManage && (
              <button
                type="button"
                onClick={onManage}
                className="p-2.5 rounded-full border border-white/20 bg-black/50 backdrop-blur-md text-white active:scale-95 transition"
                title="Manage feeds"
              >
                <Settings2 className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 pointer-events-auto">
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="p-2.5 rounded-full border border-white/20 bg-black/50 backdrop-blur-md text-white active:scale-95 transition"
                title="Close"
              >
                <Grid className="w-4 h-4" />
              </button>
            )}

            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="p-2.5 rounded-full border border-white/20 bg-black/50 backdrop-blur-md text-white active:scale-95 transition disabled:opacity-50"
                title="Refresh feeds"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
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
        className={`w-full h-full overflow-y-auto overscroll-contain scrollbar-none touch-pan-y ${
          perfMode
            ? ""
            : expandedIndex === null
              ? "snap-y snap-mandatory [scroll-snap-stop:always]"
              : ""
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
              if (w && h && cover) {
                const store = ((window as any).__koraKbDims ||= {});
                store[`kora-kb-dims:${cover}`] = { w, h };
                setLoadedDims((prev) => ({
                  ...prev,
                  [cover]: { w, h },
                }));
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
              className="relative snap-start snap-always [scroll-snap-stop:always] flex flex-col justify-end p-4 md:p-6 h-full w-full shrink-0 overflow-hidden"
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
                      ? "bg-black/90"
                      : "bg-kindle-bg"
                    : isDarkMode
                      ? "bg-gradient-to-t from-black/95 via-black/55 to-black/10"
                      : "bg-gradient-to-t from-kindle-bg via-kindle-bg/95 to-kindle-bg/30"
                }`}
              />

                {/* Floating Side Action Buttons (TikTok style) */}
                <div
                  className="absolute right-4 bottom-[8.5rem] z-30 flex flex-col items-center gap-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Filter Button */}
                  {onFilter && (
                    <button
                      type="button"
                      onClick={onFilter}
                      className="active:scale-95 transition text-white group"
                    >
                      <div className="w-11 h-11 rounded-full border border-white/20 bg-black/60 backdrop-blur-md flex items-center justify-center hover:bg-black/80 shadow-lg transition-all duration-200">
                        <Filter className="w-4.5 h-4.5 text-white" />
                      </div>
                    </button>
                  )}

                  {/* Save Button */}
                  <button
                    type="button"
                    onClick={() => onSave(item)}
                    className="active:scale-95 transition text-white group"
                  >
                    <div className={`w-11 h-11 rounded-full border flex items-center justify-center hover:bg-black/80 shadow-lg transition-all duration-200 ${
                      item.saved
                        ? "bg-kindle-accent border-kindle-accent text-neutral-950 scale-105"
                        : "bg-black/60 border-white/20 text-white"
                    }`}>
                      <Bookmark className={`w-4.5 h-4.5 ${item.saved ? "fill-current" : ""}`} />
                    </div>
                  </button>

                  {/* Share Button */}
                  <button
                    type="button"
                    onClick={() => void handleShare(item)}
                    className="active:scale-95 transition text-white group"
                  >
                    <div className="w-11 h-11 rounded-full border border-white/20 bg-black/60 backdrop-blur-md flex items-center justify-center hover:bg-black/80 shadow-lg transition-all duration-200">
                      <Share2 className="w-4.5 h-4.5 text-white" />
                    </div>
                  </button>

                  {/* Daily Brief Button */}
                  {onOpenDailyBrief && (
                    <button
                      type="button"
                      onClick={onOpenDailyBrief}
                      className="active:scale-95 transition text-white group"
                      title="Open Daily News Brief"
                    >
                      <div className="w-11 h-11 rounded-full border border-kindle-accent/30 bg-kindle-accent flex items-center justify-center hover:opacity-95 shadow-lg transition-all duration-200 relative animate-pulse">
                        <Zap className={`w-4.5 h-4.5 fill-current ${isDarkMode ? "text-neutral-950" : "text-kindle-bg"}`} />
                        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                        </span>
                      </div>
                    </button>
                  )}
                </div>

                <div
                  className={`relative z-10 cursor-pointer select-text pb-[7rem] md:pb-6 transition-all duration-300 pr-18 md:pr-24 ${
                    isDarkMode ? "text-white" : "text-kindle-text"
                  }`}
                  onClick={() => setExpandedIndex(isExpanded ? null : index)}
                >
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest mb-1 sm:mb-2 transition-colors ${
                    isDarkMode ? "text-white/80" : "text-kindle-text-muted"
                  }`}>
                    {source}
                    {item.read ? (
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                        isDarkMode ? "bg-white/20 text-white" : "bg-kindle-border text-kindle-text"
                      }`}>Read</span>
                    ) : (
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                        isDarkMode ? "bg-kindle-accent text-black" : "bg-kindle-accent text-kindle-bg"
                      }`}>New</span>
                    )}
                  </span>
                  <h2 className={`text-lg sm:text-xl md:text-2xl font-lexend font-bold leading-tight mb-2 sm:mb-3 transition-all ${
                    isDarkMode
                      ? isExpanded ? "text-white" : "line-clamp-4 text-white"
                      : isExpanded ? "text-kindle-text" : "line-clamp-4 text-kindle-text"
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

                  {/* Navigation and State Indicator */}
                  <div className={`flex items-center gap-2 mt-3.5 text-[10px] sm:text-[11px] transition-colors ${
                    isDarkMode ? "text-white/70" : "text-kindle-text font-medium"
                  }`}>
                  {isExpanded ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedIndex(null);
                      }}
                      className="cursor-pointer p-1.5 -m-1.5 flex items-center justify-center hover:opacity-85 transition"
                      aria-label="Collapse"
                    >
                      <ChevronUp className="w-5 h-5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedIndex(index);
                      }}
                      className="cursor-pointer p-1.5 -m-1.5 flex items-center justify-center hover:opacity-85 transition"
                      aria-label="Expand"
                    >
                      <ChevronDown className="w-5 h-5 animate-bounce text-kindle-accent" />
                    </button>
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
