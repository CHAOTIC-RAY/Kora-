import React, { useEffect, useRef, useState } from "react";
import { KORA_WORDMARK_PATHS } from "../lib/koraBrandPaths";

/**
 * Kora ink reveal (v2) - drop-in replacement for the old KoraWordmarkReveal.
 *
 *   1. Pencil sketch: the "kora" outline is drawn letter by letter in a doubled,
 *      wobbling line (the "boil" is done on the canvas - no SVG filters needed).
 *   2. Zoom-out: the wordmark settles from 1.14x to 1x, like the original.
 *   3. Ink fill: thousands of short pen strokes (random direction and thickness
 *      at ~60-80% opacity, the same technique as v1) pile up into a grainy,
 *      hand-inked mass. Improvements over v1: a consistent hatching angle,
 *      extra strokes along the contours so the edges read as crisply inked,
 *      mottled opacity, and a seeded layout so every load looks identical.
 *
 * Props are backwards compatible with v1 (`children`, `replay`).
 *   - children  revealed (fade + slide) once the ink has finished.
 *   - replay    replay when the element scrolls back into view (InstallView).
 *   - onDone    called once when the reveal completes.
 *   - speed     playback speed, 1 = ~5 s (default 1.5 = ~3.3 s).
 *   - color     ink colour override; defaults to --theme-text, then a dark/light fallback.
 */

const VIEW_W = 287.6;
const VIEW_H = 112.78;
const SVG_NS = "http://www.w3.org/2000/svg";

// Timeline in seconds at speed 1.
const OUTLINE_START = 0.35;
const OUTLINE_STAGGER = 0.2;
const OUTLINE_DUR = 1.2;
const ZOOM_FROM = 2.3;
const ZOOM_TO = 2.9;
const ZOOM_SCALE = 1.14;
const FILL_START = 2.6;
const FILL_SPAN = 2.3;
const END = FILL_START + FILL_SPAN + 0.15;

// Stroke-width buckets (in px on a 1400px-wide canvas; scaled to the real size).
const WIDTH_BUCKETS = [1.7, 3.2, 5.0, 6.8, 8.8];

type Stroke = [number, number, number, number, number]; // x0, y0, x1, y1, appearsAt

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveInk(override?: string): string {
  if (override) return override;
  try {
    const v = getComputedStyle(document.body).getPropertyValue("--theme-text").trim();
    if (v) return v;
  } catch {
    /* ignore */
  }
  const dark =
    document.documentElement.classList.contains("dark") ||
    document.body.classList.contains("dark") ||
    document.documentElement.getAttribute("data-theme") === "dark" ||
    (typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
  return dark ? "#f3f1ea" : "#111116";
}

export interface KoraWordmarkRevealProps {
  children?: React.ReactNode;
  replay?: boolean;
  /** Repeat the reveal while visible. Respects the user's reduced-motion setting. */
  loop?: boolean;
  onDone?: () => void;
  speed?: number;
  color?: string;
  /** Use a compact, parent-constrained wordmark in dense settings surfaces. */
  compact?: boolean;
}

export default function KoraWordmarkReveal({
  children,
  replay = false,
  loop = false,
  onDone,
  speed = 1.5,
  color,
  compact = false,
}: KoraWordmarkRevealProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion =
      typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    const letters = KORA_WORDMARK_PATHS.map((d) => {
      const el = document.createElementNS(SVG_NS, "path");
      el.setAttribute("d", d);
      return { d, len: el.getTotalLength(), path: new Path2D(d) };
    });

    let W = 0;
    let H = 0;
    let sc = 1;
    let strokes: Stroke[][][] = [];
    let drops: Stroke[] = [];
    let ink = resolveInk(color);
    let raf = 0;
    let loopTimer: number | undefined;
    let t0 = -1;
    let running = false;
    let finished = false;
    let lastT = 0;
    let cancelled = false;

    // --- geometry + stroke layout (rebuilt when the canvas size changes) -----------
    const prepare = () => {
      const cssW = canvas.clientWidth || 420;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nW = Math.max(240, Math.round(cssW * dpr));
      if (nW === W && strokes.length) return;
      W = nW;
      H = Math.round((W * VIEW_H) / VIEW_W);
      sc = W / VIEW_W;
      canvas.width = W;
      canvas.height = H;
      const k = W / 1400;

      const glyphs = new Path2D();
      const m = new DOMMatrix([sc, 0, 0, sc, 0, 0]);
      letters.forEach((l) => glyphs.addPath(new Path2D(l.d), m));
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const octx = off.getContext("2d", { willReadFrequently: true });
      if (!octx) return;
      octx.fillStyle = "#000";
      octx.fill(glyphs);
      const fillMask = octx.getImageData(0, 0, W, H).data;
      octx.globalCompositeOperation = "destination-out";
      octx.lineWidth = 4.4 * sc;
      octx.stroke(glyphs);
      const innerMask = octx.getImageData(0, 0, W, H).data;
      const at = (a: Uint8ClampedArray, x: number, y: number) => {
        const px = Math.round(x);
        const py = Math.round(y);
        return px >= 0 && py >= 0 && px < W && py < H && a[(py * W + px) * 4 + 3] > 128;
      };

      const R = mulberry32(20261);
      strokes = WIDTH_BUCKETS.map(() => [[], []]);
      drops = [];
      const add = (x: number, y: number, hatch: number) => {
        const w = 0.5 + R() * 2.5;
        const wi = Math.min(4, Math.floor((w - 0.5) / 0.5));
        const th = R() < hatch ? -0.72 + (R() - 0.5) * 0.95 : R() * 6.283;
        const len = (R() < 0.5 ? 3 + R() * 9 : R() * 13) * k;
        const ts = FILL_START + (0.8 * R() + 0.2 * (x / W)) * FILL_SPAN;
        strokes[wi][R() < 0.45 ? 0 : 1].push([x, y, x + Math.cos(th) * len, y + Math.sin(th) * len, ts]);
        if (R() > 0.985) drops.push([x, y, (0.6 + R() * 2.8) * 3.1 * k, 0, ts + 0.02]);
      };
      for (let n = 0; n < 9400; ) {
        const x = R() * W;
        const y = R() * H;
        if (!at(fillMask, x, y)) continue;
        n++;
        add(x, y, 0.6);
      }
      for (let n = 0; n < 3200; ) {
        const x = R() * W;
        const y = R() * H;
        if (!at(fillMask, x, y) || at(innerMask, x, y)) continue;
        n++;
        add(x, y, 0.35);
      }
      strokes.forEach((g) => g.forEach((a) => a.sort((p, q) => p[4] - q[4])));
      drops.sort((p, q) => p[4] - q[4]);
    };

    // --- one frame ------------------------------------------------------------------
    const draw = (t: number) => {
      lastT = t;
      const k = W / 1400;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // zoom-out (CSS transform on the wrapper: no layout shift)
      const z = t < ZOOM_FROM ? ZOOM_SCALE : t > ZOOM_TO ? 1 : ZOOM_SCALE + (1 - ZOOM_SCALE) * easeInOut((t - ZOOM_FROM) / (ZOOM_TO - ZOOM_FROM));
      wrap.style.transform = `scale(${z})`;

      // pencil outline (boil is quantised so it flickers like hand-drawn animation)
      const olAlpha = t < 4.6 ? 1 : t < 5.4 ? 1 - (0.6 * (t - 4.6)) / 0.8 : 0.4;
      const boil = Math.floor(t / 0.14);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = ink;
      for (let pass = 0; pass < 2; pass++) {
        const rj = mulberry32(boil * 31 + pass * 977);
        const jx = (rj() - 0.5) * 0.9 + (pass ? 0.8 : 0);
        const jy = (rj() - 0.5) * 0.9 + (pass ? -0.6 : 0);
        ctx.setTransform(sc, 0, 0, sc, jx * sc, jy * sc);
        ctx.lineWidth = 0.85;
        ctx.globalAlpha = olAlpha * (pass ? 0.55 : 1);
        letters.forEach((l, i) => {
          const p = easeInOut(clamp01((t - (OUTLINE_START + i * OUTLINE_STAGGER + pass * 0.18)) / OUTLINE_DUR));
          if (p <= 0) return;
          ctx.setLineDash([l.len, l.len + 2]);
          ctx.lineDashOffset = l.len * (1 - p);
          ctx.stroke(l.path);
        });
      }
      ctx.setLineDash([]);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // ink fill: short pen strokes
      if (t >= FILL_START) {
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        strokes.forEach((g, wi) =>
          g.forEach((a, ai) => {
            if (!a.length || a[0][4] > t) return;
            ctx.beginPath();
            for (const s of a) {
              if (s[4] > t) break;
              ctx.moveTo(s[0], s[1]);
              ctx.lineTo(s[2], s[3]);
            }
            ctx.lineWidth = WIDTH_BUCKETS[wi] * k;
            ctx.globalAlpha = ai ? 0.8 : 0.58;
            ctx.stroke();
          }),
        );
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        for (const d of drops) {
          if (d[4] > t) break;
          ctx.moveTo(d[0] + d[2], d[1]);
          ctx.arc(d[0], d[1], d[2], 0, 6.283);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const markDone = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      setDone(true);
      onDoneRef.current?.();
    };

    const loop = (now: number) => {
      if (cancelled || !running) return;
      if (t0 < 0) t0 = now;
      const t = ((now - t0) / 1000) * speed;
      if (t >= END) {
        draw(END + 1);
        running = false;
        finished = true;
        markDone();
        if (loop && !reduceMotion) loopTimer = window.setTimeout(start, 1200);
        return;
      }
      draw(t);
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (cancelled) return;
      cancelAnimationFrame(raf);
      prepare();
      doneRef.current = false;
      setDone(false);
      finished = false;
      if (reduceMotion) {
        draw(END + 1);
        finished = true;
        markDone();
        return;
      }
      t0 = -1;
      running = true;
      raf = requestAnimationFrame(loop);
    };

    const reset = () => {
      running = false;
      finished = false;
      if (loopTimer !== undefined) window.clearTimeout(loopTimer);
      loopTimer = undefined;
      cancelAnimationFrame(raf);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      wrap.style.transform = `scale(${ZOOM_SCALE})`;
      doneRef.current = false;
      setDone(false);
    };

    // --- lifecycle ------------------------------------------------------------------
    let io: IntersectionObserver | null = null;
    let visible = false;
    let replayArmed = true;
    const onScrollToTop = () => {
      // Kora can scroll inside an app container instead of the window.
      // Use the nearest genuinely scrollable ancestor when one exists.
      let parent = wrap.parentElement;
      let scrollTop = window.scrollY;
      while (parent) {
        const style = window.getComputedStyle(parent);
        const canScroll = /(auto|scroll|overlay)/.test(
          `${style.overflowY} ${style.overflow}`
        ) && parent.scrollHeight > parent.clientHeight + 1;
        if (canScroll) {
          scrollTop = parent.scrollTop;
          break;
        }
        parent = parent.parentElement;
      }
      // Re-arm only after returning to the top; leaving the animation alone
      // keeps its completed frame visible.
      if (scrollTop <= 8) {
        replayArmed = true;
        reset();
      }
    };

    if (replay && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => {
        const e = entries[entries.length - 1];
        if (e.isIntersecting && !visible) {
          visible = true;
          if (replayArmed) {
            replayArmed = false;
            start();
          }
        } else if (!e.isIntersecting && visible) {
          visible = false;
        }
      }, { threshold: 0.2 });
      io.observe(wrap);
      document.addEventListener("scroll", onScrollToTop, { passive: true, capture: true });
    } else {
      start();
    }

    // keep crisp on resize, and follow theme changes
    let lastW = canvas.clientWidth;
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (Math.abs(canvas.clientWidth - lastW) < 8) return;
          lastW = canvas.clientWidth;
          prepare();
          if (finished || running) draw(finished ? END + 1 : lastT);
        })
      : null;
    ro?.observe(canvas);

    const mo = new MutationObserver(() => {
      const next = resolveInk(color);
      if (next === ink) return;
      ink = next;
      if (finished) draw(END + 1);
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

    return () => {
      cancelled = true;
      if (loopTimer !== undefined) window.clearTimeout(loopTimer);
      cancelAnimationFrame(raf);
      io?.disconnect();
      document.removeEventListener("scroll", onScrollToTop, true);
      ro?.disconnect();
      mo.disconnect();
    };
  }, [replay, loop, speed, color]);

  return (
    <div className="relative flex flex-col items-center gap-4">
      <div
        ref={wrapRef}
        className="kora-ink-wrapper w-full flex justify-center"
        style={{ transform: `scale(${ZOOM_SCALE})`, willChange: "transform" }}
      >
        {/* Height is pinned by CSS so the layout box is stable before, during and
            after the animation (a bare canvas would jump from 300x150). */}
        <canvas
          ref={canvasRef}
          className="block"
          role="img"
          aria-label="Kora"
          style={{ width: compact ? "100%" : "min(86vw, 420px)", maxWidth: compact ? "280px" : undefined, aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        />
      </div>

      <div
        className="space-y-3 max-w-lg mx-auto transition-opacity duration-700 ease-out"
        style={{ opacity: done ? 1 : 0, transform: done ? "translateY(0)" : "translateY(14px)" }}
      >
        {children}
      </div>
    </div>
  );
}
