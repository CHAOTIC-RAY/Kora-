import React, { useEffect, useRef, useState } from "react";

// "kora" wordmark glyph paths (same source as KoraLogo.KoraWordmark).
const KORA_PATHS = [
  "M287.6,104.25c-1.64,4.59-5.45,6.69-10,7.53-8.61,1.57-11.14-.13-16.94-11-4.9,6.39-10.94,10.55-19,11.62-9.95,1.31-19.48-3.36-22.59-11.64-3.59-9.57-.58-19.55,9.17-24.2,9.2-4.38,19.27-7,29.1-10,3-.9,4.36-1.9,3.94-5-.58-4.27-.66-8.66-1.78-12.78-1.63-6-6.3-9-12.29-8.95s-9.29,3-11.31,9.37c-1,3-.55,7-5,7.73-3.67.56-7.22.11-9-3.68s-.78-7.18,2.33-9.9c6.48-5.68,14.43-7.47,22.66-7.93a48.52,48.52,0,0,1,12.88,1.12c10.13,2.22,15.8,8.93,16.21,19.42.43,11,.28,22,.38,33,0,1.66,0,3.33,0,5C276.63,102.86,278.61,104.64,287.6,104.25Zm-26.6-34c-8.44,2.41-16.47,4.43-22.9,10.05-4.55,4-5.81,10.76-3.44,16.45a11.76,11.76,0,0,0,12,7c5.67-.42,13.76-5.58,14.15-10.21C261.46,86,261,78.4,261,70.24Z",
  "M24.18,0V6.78c0,29.14,0,58.28-.07,87.42,0,6,.3,11.44,7.51,13.29.7.19,1.09,1.61,2,3.05H.64l-.64-1c1.19-1,2.24-2.37,3.61-2.9,3.94-1.53,5.62-4.17,5.61-8.4q-.13-40,0-79.93c0-4.73-1.93-7.46-6.26-9C1.9,9,1.15,7.79.27,7,1.2,6.27,2,5.18,3.09,4.92,9.84,3.24,16.64,1.74,24.18,0Z",
  "M193.44,110.51H159.7l-.57-1c1.07-.9,2-2.13,3.25-2.62,4.54-1.79,6-5,5.94-9.79-.2-14-.28-28,0-42,.13-5.65-1.58-9.3-7.11-11a3.26,3.26,0,0,1-1.77-2c-.13-.38.8-1.52,1.4-1.67,7-1.75,14.08-3.37,21.77-5.18V51.06l1.11.4,2.54-4.36c3.51-6,8.15-10.58,15.32-11.7,7.35-1.15,12.17,3.38,10.85,10-1,5.16-4.11,6.91-9.13,5.17-12.43-4.32-19.44.57-19.59,13.8-.12,10.66.14,21.33-.21,32-.19,5.71,1.76,9.21,7.35,10.72,1.23.33,2.23,1.52,3.34,2.31Z",
  "M78.32,110.77c-7.1,0-14.2.08-21.29-.1a4.78,4.78,0,0,1-3-2Q40.66,90.3,27.46,71.89c5.26-5.49,10.61-11.09,16-16.65,2.08-2.15,4.31-4.16,6.37-6.33,3.77-4,3.34-5.72-1.66-8.06a4.92,4.92,0,0,1-2.57-3.51H73.37l.76,1.25C70.3,40.71,66.22,42.48,62.71,45a109.36,109.36,0,0,0-11.2,9.9C48.05,58.27,44.85,61.86,41,66,53.4,80.35,61.76,98.66,79,109.66Z",
  "M151.77,74.1h0a45.46,45.46,0,0,0-3.51-17.51,33.2,33.2,0,0,0-4.87-8.34l-.23-.28c-.23-.29-.47-.58-.71-.86a29.45,29.45,0,0,0-5.49-5,37.39,37.39,0,0,0-43.9,0,29.71,29.71,0,0,0-5.48,5c-.25.28-.48.57-.72.86l-.22.28a33.2,33.2,0,0,0-4.87,8.34,45.27,45.27,0,0,0-3.51,17.51h0A42.74,42.74,0,0,0,82.47,93a32.76,32.76,0,0,0,15.32,15.69,37.5,37.5,0,0,0,15.86,4.09h.07l1.29,0,1.3,0h.07a37.5,37.5,0,0,0,15.86-4.09A32.73,32.73,0,0,0,147.55,93,42.61,42.61,0,0,0,151.77,74.1ZM133,90.13A66.71,66.71,0,0,1,129.34,99a15.55,15.55,0,0,1-14.18,9h-.29a15.56,15.56,0,0,1-14.19-9A66.63,66.63,0,0,1,97,90.13c-.9-3.49-1.64-7-2.42-10.56a51.39,51.39,0,0,1-.4-8.67c1.25-8.9,3.25-16.72,6.32-21.79,3.52-5.81,9-8.92,14.48-9.21,5.47.29,11,3.4,14.49,9.21,3.07,5.07,5.06,12.89,6.31,21.79a51.39,51.39,0,0,1-.4,8.67C134.63,83.1,133.89,86.64,133,90.13Z",
];

const VIEW_W = 287.6;
const VIEW_H = 112.78;
const FILL_THRESHOLD = 14000;

/**
 * Realistic-ink "kora" wordmark, ported 1:1 from the reference HTML:
 * a canvas sized to its own box hand-draws the glyph outline, then fills it
 * with thousands of ink-drop strokes; an SVG feTurbulence filter gives the
 * wobble. After the fill completes, the children (subtitle) fade up.
 */
export default function KoraWordmarkReveal({ children }: { children?: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const svg = document.getElementById("kora-ink-source") as SVGSVGElement | null;
    const paths = svg ? Array.from(svg.querySelectorAll("path")) : [];

    let raf = 0;
    let cancelled = false;
    let started = false;

    const start = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Size the canvas to its displayed box (capped so the wordmark stays sane).
      const DISPLAY_W = Math.min(wrap.clientWidth || 420, 420);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(DISPLAY_W * dpr);
      canvas.height = Math.round(DISPLAY_W * (VIEW_H / VIEW_W) * dpr);
      canvas.style.width = `${DISPLAY_W}px`;
      canvas.style.height = `${(DISPLAY_W * (VIEW_H / VIEW_W)).toFixed(1)}px`;

      const scale = (canvas.width / VIEW_W) * 0.92;
      const offsetX = (canvas.width - VIEW_W * scale) / 2;
      const offsetY = (canvas.height - VIEW_H * scale) / 2;

      const path2D: Path2D[] = [];
      const outlinePoints: ({ x: number; y: number } | null)[] = [];
      paths.forEach((p) => {
        path2D.push(new Path2D(p.getAttribute("d") || ""));
        const len = p.getTotalLength();
        outlinePoints.push(null);
        for (let i = 0; i <= len; i += 2) {
          const pt = p.getPointAtLength(i);
          outlinePoints.push({ x: pt.x * scale + offsetX, y: pt.y * scale + offsetY });
        }
      });

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0a1221";
      ctx.fillStyle = "#0a1221";

      const STATE_OUTLINE = 0,
        STATE_ZOOM = 1,
        STATE_FILL = 2,
        STATE_FINISHED = 3;
      let state = STATE_OUTLINE;
      let outlineIdx = 0;
      let fillCount = 0;
      let lastX: number | null = null;
      let lastY: number | null = null;

      const drawOutline = () => {
        for (let i = 0; i < 4; i++) {
          if (outlineIdx >= outlinePoints.length) {
            state = STATE_ZOOM;
            wrap.classList.add("kora-ink-zoomed");
            setTimeout(() => {
              if (!cancelled) state = STATE_FILL;
            }, 1500);
            return;
          }
          const pt = outlinePoints[outlineIdx++];
          if (!pt) {
            lastX = lastY = null;
          } else {
            if (lastX !== null) {
              ctx.beginPath();
              ctx.lineWidth = 1.8 * dpr;
              ctx.moveTo(lastX, lastY as number);
              ctx.lineTo(pt.x, pt.y);
              ctx.stroke();
            }
            lastX = pt.x;
            lastY = pt.y;
          }
        }
      };

      const drawFill = () => {
        if (fillCount >= FILL_THRESHOLD) {
          state = STATE_FINISHED;
          setDone(true);
          return;
        }
        for (let i = 0; i < 45; i++) {
          const rx = Math.random() * VIEW_W;
          const ry = Math.random() * VIEW_H;
          if (path2D.some((p) => ctx.isPointInPath(p, rx, ry))) {
            fillCount++;
            const sx = rx * scale + offsetX;
            const sy = ry * scale + offsetY;
            ctx.beginPath();
            ctx.lineWidth = (Math.random() * 2.5 + 0.5) * dpr;
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + (Math.random() - 0.5) * 8 * dpr, sy + (Math.random() - 0.5) * 8 * dpr);
            ctx.globalAlpha = 0.7;
            ctx.stroke();
            ctx.globalAlpha = 1;
            if (Math.random() > 0.99) {
              ctx.beginPath();
              ctx.arc(sx, sy, Math.random() * 3 * dpr, 0, Math.PI * 2);
              ctx.fill();
            }
          }
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

    let t: number | undefined;
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        if (!cancelled) start();
      }, 300);
    };
    window.addEventListener("resize", onResize);

    // Start the animation only when the About section scrolls into view.
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !started) {
            started = true;
            start();
          }
        });
      },
      { threshold: 0.3 }
    );
    io.observe(wrap);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(t);
      io.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div className="relative flex flex-col items-center gap-4">
      <svg id="kora-ink-source" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ display: "none" }} aria-hidden>
        {KORA_PATHS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>

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
        <canvas ref={canvasRef} className="block" style={{ width: "min(86vw, 420px)", height: "auto" }} />
      </div>

      <div
        className="space-y-3 max-w-lg mx-auto transition-opacity duration-700 ease-out"
        style={{ opacity: done ? 1 : 0, transform: done ? "translateY(0)" : "translateY(14px)" }}
      >
        {children}
      </div>

      <style>{`
        .kora-ink-wrapper { transition: transform 1.5s cubic-bezier(0.45,0.05,0.55,0.95); }
        .kora-ink-zoomed { transform: scale(0.7); }
      `}</style>
    </div>
  );
}
