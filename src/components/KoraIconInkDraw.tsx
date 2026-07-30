import React, { useEffect, useRef } from "react";

const K_PATH =
  "M271.51,39.63l-42.07,52.3c-17.41,21.62-35,43.1-52.11,64.95A37.6,37.6,0,0,1,155.49,171a247.39,247.39,0,0,0-32.92,10c9.08,1.27,18.13,2.88,27.25,3.73,9.34.87,16.1,4.44,22.23,12.22,32.89,41.77,66.48,83,100.67,125.46-3.19.45-5.23,1-7.27,1-24.79,0-49.59.29-74.38-.25-4.21-.09-9.63-2.53-12.31-5.71-23.17-27.58-45.83-55.57-68.66-83.43-2.88-3.51-5.88-6.93-9.41-11.08-9.07,6.79-17.8,12.7-25.66,19.6-2.44,2.13-3.47,6.92-3.53,10.52-.35,19.83-.2,39.67-.22,59.51v10.29H0V9.71H71V144.39l2,.8c1.45-2.17,3-4.26,4.32-6.51,14.8-25.37,29.18-51,44.58-76A55.77,55.77,0,0,1,139.68,44.8c25-15.18,50.74-29.26,78-44.8,0,13.22.61,24.64-.44,35.91-.26,2.78-5.91,5.06-11.36,9.36V20.68c-23.31,13.65-44.83,26.22-66.3,38.9a10.59,10.59,0,0,0-3.32,3.64c-20.51,33.72-41,67.47-59.65,102.47Q99.29,138,122,110.23c3.14-3.83,7-7.23,9.4-11.49,12.19-21.85,31.95-31.34,55.31-37,25.89-6.34,51.27-14.81,76.88-22.32,2.14-.63,4.35-1,6.52-1.55Z";

const VIEW_W = 272.72;
const VIEW_H = 323.58;
const FILL_THRESHOLD = 16000;

interface KoraIconInkDrawProps {
  className?: string;
  size?: number; // width in px
  opacity?: number;
  inkColor?: string;
}

export default function KoraIconInkDraw({
  className = "",
  size = 360,
  opacity = 0.18,
  inkColor,
}: KoraIconInkDrawProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const svgPathRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const pathEl = svgPathRef.current;
    if (!canvas || !wrap || !pathEl) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let cancelled = false;

    // Resolve active ink color if not passed explicitly
    const isDark = 
      document.documentElement.classList.contains("dark") || 
      document.body.classList.contains("dark");
    const activeInkColor = inkColor || (isDark ? "#f3f1ea" : "#222226");

    const DISPLAY_W = size;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(DISPLAY_W * dpr);
    canvas.height = Math.round(DISPLAY_W * (VIEW_H / VIEW_W) * dpr);
    canvas.style.width = `${DISPLAY_W}px`;
    canvas.style.height = `${(DISPLAY_W * (VIEW_H / VIEW_W)).toFixed(1)}px`;

    const scale = (canvas.width / VIEW_W) * 0.94;
    const offsetX = (canvas.width - VIEW_W * scale) / 2;
    const offsetY = (canvas.height - VIEW_H * scale) / 2;

    const path2D = new Path2D(K_PATH);
    const len = pathEl.getTotalLength();
    const outlinePoints: ({ x: number; y: number } | null)[] = [];

    for (let i = 0; i <= len; i += 2) {
      const pt = pathEl.getPointAtLength(i);
      outlinePoints.push({ x: pt.x * scale + offsetX, y: pt.y * scale + offsetY });
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = activeInkColor;
    ctx.fillStyle = activeInkColor;

    const STATE_OUTLINE = 0,
      STATE_FILL = 1,
      STATE_HOLD = 2,
      STATE_UNFILL = 3,
      STATE_DEOUTLINE = 4,
      STATE_PAUSE = 5;

    let state = STATE_OUTLINE;
    let outlineIdx = 0;
    let fillCount = 0;
    let holdFrameCount = 0;
    let unfillCount = 0;
    let deoutlineIdx = 0;
    let pauseFrameCount = 0;
    let lastX: number | null = null;
    let lastY: number | null = null;

    const drawOutline = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = activeInkColor;
      ctx.fillStyle = activeInkColor;
      for (let i = 0; i < 10; i++) {
        if (outlineIdx >= outlinePoints.length) {
          state = STATE_FILL;
          return;
        }
        const pt = outlinePoints[outlineIdx++];
        if (!pt) {
          lastX = lastY = null;
        } else {
          if (lastX !== null) {
            ctx.beginPath();
            ctx.lineWidth = 3.5 * dpr;
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
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = activeInkColor;
      ctx.fillStyle = activeInkColor;
      if (fillCount >= 18000) {
        state = STATE_HOLD;
        holdFrameCount = 0;
        return;
      }
      for (let i = 0; i < 80; i++) {
        const rx = Math.random() * VIEW_W;
        const ry = Math.random() * VIEW_H;
        if (ctx.isPointInPath(path2D, rx, ry)) {
          fillCount++;
          const sx = rx * scale + offsetX;
          const sy = ry * scale + offsetY;
          ctx.beginPath();
          ctx.lineWidth = (Math.random() * 3.2 + 0.8) * dpr;
          ctx.moveTo(sx, sy);
          ctx.lineTo(
            sx + (Math.random() - 0.5) * 12 * dpr,
            sy + (Math.random() - 0.5) * 12 * dpr
          );
          ctx.globalAlpha = 0.75;
          ctx.stroke();
          ctx.globalAlpha = 1;

          if (Math.random() > 0.98) {
            ctx.beginPath();
            ctx.arc(sx, sy, Math.random() * 3.8 * dpr, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    };

    const drawUnfill = () => {
      ctx.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 110; i++) {
        const rx = Math.random() * VIEW_W;
        const ry = Math.random() * VIEW_H;
        if (ctx.isPointInPath(path2D, rx, ry)) {
          const sx = rx * scale + offsetX;
          const sy = ry * scale + offsetY;
          ctx.beginPath();
          ctx.arc(sx, sy, (Math.random() * 7 + 2.5) * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      unfillCount++;
      if (unfillCount >= 150) {
        deoutlineIdx = outlinePoints.length - 1;
        state = STATE_DEOUTLINE;
      }
    };

    const drawDeoutline = () => {
      ctx.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 12; i++) {
        if (deoutlineIdx < 0) {
          state = STATE_PAUSE;
          pauseFrameCount = 0;
          return;
        }
        const pt = outlinePoints[deoutlineIdx--];
        if (pt) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 7 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const drawPause = () => {
      pauseFrameCount++;
      if (pauseFrameCount >= 20) {
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = activeInkColor;
        ctx.fillStyle = activeInkColor;
        state = STATE_OUTLINE;
        outlineIdx = 0;
        fillCount = 0;
        holdFrameCount = 0;
        unfillCount = 0;
        lastX = null;
        lastY = null;
      }
    };

    const loop = () => {
      if (cancelled) return;
      if (state === STATE_OUTLINE) drawOutline();
      else if (state === STATE_FILL) drawFill();
      else if (state === STATE_HOLD) {
        holdFrameCount++;
        if (holdFrameCount >= 140) {
          unfillCount = 0;
          state = STATE_UNFILL;
        }
      } else if (state === STATE_UNFILL) drawUnfill();
      else if (state === STATE_DEOUTLINE) drawDeoutline();
      else if (state === STATE_PAUSE) drawPause();

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [size, inkColor]);

  return (
    <div
      ref={wrapRef}
      className={`pointer-events-none select-none ${className}`}
      style={{
        opacity,
        filter: "url(#kora-icon-ink-filter)",
      }}
    >
      <svg
        style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
        aria-hidden="true"
      >
        <filter id="kora-icon-ink-filter">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves={2} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={3.5} xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <path ref={svgPathRef} d={K_PATH} />
      </svg>

      <canvas
        ref={canvasRef}
        className="block"
        style={{ width: `${size}px`, height: "auto", aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
      />
    </div>
  );
}
