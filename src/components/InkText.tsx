import React, { useEffect, useRef, useState } from "react";

/**
 * Same realistic-ink effect as KoraWordmarkReveal, but for arbitrary text:
 * the words are rendered to an offscreen canvas to build a pixel mask, the
 * edge pixels are traced as the outline, then ink drops fill the interior.
 * `fillBatch` controls speed (higher = faster fill).
 */
export default function InkText({
  text,
  className = "",
  fontFamily = "Inter, system-ui, sans-serif",
  fontWeight = 800,
  color = "#0a1221",
  fillBatch = 140,
  zoomTo = 0.7,
}: {
  text: string;
  className?: string;
  fontFamily?: string;
  fontWeight?: number;
  color?: string;
  fillBatch?: number;
  zoomTo?: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let cancelled = false;

    const build = async () => {
      // Wait for webfont so the mask matches the rendered glyphs.
      try {
        await (document as any).fonts.ready;
      } catch {
        /* ignore */
      }
      if (cancelled) return;

      const cssW = wrap.clientWidth || 600;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const maxW = cssW * dpr;

      // Fit font size so the wrapped text spans ~ the container width.
      let fontPx = 56 * dpr;
      const lineH = () => fontPx * 1.12;
      const wrapLines = (px: number) => {
        ctx.font = `${fontWeight} ${px}px ${fontFamily}`;
        const words = text.split(" ");
        const lines: string[] = [];
        let cur = "";
        for (const w of words) {
          const test = cur ? cur + " " + w : w;
          if (ctx.measureText(test).width > maxW && cur) {
            lines.push(cur);
            cur = w;
          } else cur = test;
        }
        if (cur) lines.push(cur);
        return lines;
      };
      let lines = wrapLines(fontPx);
      while (lines.length > 1 && fontPx > 22 * dpr) {
        fontPx -= 2 * dpr;
        lines = wrapLines(fontPx);
      }

      const cw = maxW;
      const ch = Math.ceil(lines.length * lineH() + fontPx * 0.4);
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${(cw / dpr).toFixed(0)}px`;
      canvas.style.height = `${(ch / dpr).toFixed(0)}px`;
      ctx.clearRect(0, 0, cw, ch);
      ctx.font = `${fontWeight} ${fontPx}px ${fontFamily}`;
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const totalH = lines.length * lineH();
      lines.forEach((ln, i) => {
        ctx.fillText(ln, cw / 2, ch / 2 - totalH / 2 + lineH() * (i + 0.5));
      });

      // Build mask + edge set from the rendered pixels.
      const img = ctx.getImageData(0, 0, cw, ch).data;
      const step = 2;
      const inked = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= cw || y >= ch) return false;
        const a = img[(y * cw + x) * 4 + 3];
        return a > 40;
      };
      type P = { x: number; y: number };
      const edges: P[] = [];
      const interior: P[] = [];
      for (let y = 0; y < ch; y += step) {
        for (let x = 0; x < cw; x += step) {
          if (!inked(x, y)) continue;
          const on =
            !inked(x - step, y) ||
            !inked(x + step, y) ||
            !inked(x, y - step) ||
            !inked(x, y + step);
          if (on) edges.push({ x, y });
          else interior.push({ x, y });
        }
      }
      ctx.clearRect(0, 0, cw, ch);

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const STATE_OUTLINE = 0,
        STATE_ZOOM = 1,
        STATE_FILL = 2,
        STATE_FINISHED = 3;
      let state = STATE_OUTLINE;
      let edgeIdx = 0;
      let fillCount = 0;

      const drawOutline = () => {
        for (let i = 0; i < 6; i++) {
          if (edgeIdx >= edges.length) {
            state = STATE_ZOOM;
            wrap.classList.add("kora-ink-zoomed");
            setTimeout(() => {
              if (!cancelled) state = STATE_FILL;
            }, 900);
            return;
          }
          const p = edges[edgeIdx++];
          ctx.beginPath();
          ctx.lineWidth = 1.6 * dpr;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 1, p.y + 1);
          ctx.stroke();
        }
      };

      const drawFill = () => {
        if (fillCount >= interior.length * 0.85) {
          state = STATE_FINISHED;
          return;
        }
        for (let i = 0; i < fillBatch; i++) {
          const p = interior[(Math.random() * interior.length) | 0];
          if (!p) continue;
          fillCount++;
          ctx.beginPath();
          ctx.lineWidth = Math.random() * 2.2 * dpr + 0.4;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + (Math.random() - 0.5) * 7 * dpr, p.y + (Math.random() - 0.5) * 7 * dpr);
          ctx.globalAlpha = 0.7;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      };

      const loop = () => {
        if (cancelled) return;
        if (state === STATE_OUTLINE) drawOutline();
        else if (state === STATE_FILL) drawFill();
        if (state !== STATE_FINISHED) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };

    build();

    let t: number | undefined;
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        if (!cancelled) build();
      }, 300);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, [text, fontFamily, fontWeight, color, fillBatch, zoomTo]);

  return (
    <div className={`relative ${className}`}>
      <svg style={{ display: "none" }} aria-hidden>
        <filter id="kora-realistic-ink">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves={3} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={3} xChannelSelector="R" result="distorted" />
          <feGaussianBlur in="distorted" stdDeviation="1.2" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -8" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </svg>
      <div
        ref={wrapRef}
        className="kora-ink-wrapper w-full flex justify-center"
        style={{ filter: "url(#kora-realistic-ink)" }}
      >
        <canvas ref={canvasRef} className="block" />
      </div>
      <style>{`
        .kora-ink-wrapper { transition: transform 1.2s cubic-bezier(0.45,0.05,0.55,0.95); }
        .kora-ink-zoomed { transform: scale(${zoomTo}); }
      `}</style>
    </div>
  );
}
