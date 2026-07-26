import React, { useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown } from "lucide-react";
import type { FeedItem } from "../lib/feedStorage";
import { getItemThumbnail } from "../lib/feedPreview";

interface FeedTikTokScrollProps {
  items: FeedItem[];
  grayscaleCovers?: boolean;
  perfMode?: boolean;
  onRead: (item: FeedItem) => void;
  onSave: (item: FeedItem) => void;
}

/**
 * TikTok/Reels-style vertical news scroll: one article per screen, swipe or
 * arrow-key to advance, tap to open the fullscreen reader, Save pill per slide.
 * Uses theme vars so it works in light/dark/yellow/blue. Respects perf mode
 * (disables snap + smooth scroll) and reduced-motion.
 */
export default function FeedTikTokScroll({
  items,
  grayscaleCovers,
  perfMode,
  onRead,
  onSave,
}: FeedTikTokScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const go = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const next = Math.min(items.length - 1, Math.max(0, active + dir));
    el.children[next + 1]?.scrollIntoView({ behavior: perfMode ? "auto" : "smooth" });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const idx = Array.prototype.indexOf.call(el.children, e.target);
            if (idx > 0) setActive(idx - 1);
          }
        });
      },
      { root: el, threshold: 0.6 }
    );
    // children[0] is the sticky progress bar; slides start at index 1.
    Array.from(el.children).slice(1).forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [items.length]);

  if (!items.length) return null;

  return (
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
      className={`relative h-[calc(100dvh-3.5rem-4rem)] w-full overflow-y-auto overscroll-contain scrollbar-none ${
        perfMode ? "" : "snap-y snap-mandatory"
      }`}
    >
      <div className="sticky top-0 z-20 flex gap-1 px-4 pt-3 pointer-events-none">
        {items.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= active ? "bg-kindle-accent" : "bg-white/20"
            }`}
          />
        ))}
      </div>
      {items.map((item, index) => {
        const cover = getItemThumbnail(item);
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
            className="relative h-[calc(100dvh-3.5rem-4rem)] snap-start flex flex-col justify-end p-4 md:p-6"
            style={{ contentVisibility: "auto" }}
          >
            {cover ? (
              <img
                src={cover}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
                className={`absolute inset-0 w-full h-full object-cover ${
                  grayscaleCovers ? "grayscale" : ""
                }`}
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-kindle-accent/30 to-black/60" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

            <button
              type="button"
              onClick={() => onSave(item)}
              className="absolute top-12 right-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white active:scale-95 transition"
            >
              <Bookmark className="w-3.5 h-3.5" /> Save
            </button>

            <div className="relative z-10 text-white" onClick={() => onRead(item)}>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 mb-2">
                {source}
                {item.read ? (
                  <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[9px]">Read</span>
                ) : (
                  <span className="rounded-full bg-kindle-accent px-1.5 py-0.5 text-[9px] text-black">New</span>
                )}
              </span>
              <h2 className="text-2xl md:text-3xl font-lexend font-bold leading-tight mb-3 line-clamp-5">
                {item.title}
              </h2>
              <div className="flex items-center gap-2 text-[11px] text-white/70">
                <ChevronDown className="w-4 h-4 animate-bounce" />
                <span>Tap to read</span>
                <span className="ml-auto">
                  {index + 1}/{items.length}
                </span>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
