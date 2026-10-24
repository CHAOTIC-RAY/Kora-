import React from "react";
import { KORA_ICON_PATH, KORA_VIEW, KORA_WORDMARK_PATHS } from "../lib/koraBrandPaths";

/**
 * Kora inline loader: the endless "loop" animation for anything that is loading
 * (buttons, lists, search, pull-to-refresh). A short ink line chases around the
 * outline of the "kora" wordmark (or the K icon), letter after letter.
 *
 * Pure SVG + CSS, no JS timers, inherits `currentColor`, so it follows the theme.
 *
 *   <KoraInlineLoader />                       // wordmark, 160px wide
 *   <KoraInlineLoader variant="icon" width={48} />
 */
export interface KoraInlineLoaderProps {
  /** "word" (default, the kora wordmark) or "icon" (the K). */
  variant?: "word" | "icon";
  /** CSS width of the loader, number = px. */
  width?: number | string;
  /** Screen-reader label. */
  label?: string;
  className?: string;
  /** Line thickness in viewBox units. */
  strokeWidth?: number;
}

const CSS = `
.kora-loader-base{fill:none;stroke:currentColor;stroke-opacity:.18;stroke-linecap:round;stroke-linejoin:round}
.kora-loader-chase{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:.16 .84;animation:kora-chase 2.2s linear infinite}
@keyframes kora-chase{to{stroke-dashoffset:-1}}
@media (prefers-reduced-motion:reduce){.kora-loader-chase{animation:none;stroke-dasharray:1;stroke-opacity:.55}}
`;

export default function KoraInlineLoader({
  variant = "word",
  width = 160,
  label = "Loading",
  className,
  strokeWidth,
}: KoraInlineLoaderProps) {
  const word = variant === "word";
  const viewBox = word ? `0 0 ${KORA_VIEW.wordW} ${KORA_VIEW.wordH}` : `0 0 ${KORA_VIEW.iconW} ${KORA_VIEW.iconH}`;
  const paths = word ? KORA_WORDMARK_PATHS : [KORA_ICON_PATH];
  const sw = strokeWidth ?? (word ? 1.6 : 3.2);

  return (
    <span
      role="status"
      aria-live="polite"
      className={className}
      style={{ position: "relative", display: "inline-block", width, lineHeight: 0 }}
    >
      <svg viewBox={viewBox} width="100%" style={{ display: "block", overflow: "visible" }} aria-hidden="true" focusable="false">
        {paths.map((d, i) => (
          <path key={`b${i}`} d={d} pathLength={1} className="kora-loader-base" strokeWidth={sw} />
        ))}
        {paths.map((d, i) => (
          <path
            key={`c${i}`}
            d={d}
            pathLength={1}
            className="kora-loader-chase"
            strokeWidth={sw * 1.5}
            style={{ animationDelay: `${-i * 0.32}s` }}
          />
        ))}
      </svg>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <style>{CSS}</style>
    </span>
  );
}
