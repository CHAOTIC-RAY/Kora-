import React from "react";
import { KORA_ICON_PATH, KORA_VIEW, KORA_WORDMARK_PATHS } from "../lib/koraBrandPaths";

export const KoraIcon = ({
  className = "w-8 h-8",
  fill = "currentColor",
  onClick,
}: {
  className?: string;
  fill?: string;
  onClick?: () => void;
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox={`0 0 ${KORA_VIEW.iconW} ${KORA_VIEW.iconH}`}
    className={className}
    fill={fill}
    onClick={onClick}
  >
    <path d={KORA_ICON_PATH} />
  </svg>
);

export const KoraWordmark = ({
  className = "h-6",
  fill = "currentColor",
}: {
  className?: string;
  fill?: string;
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox={`0 0 ${KORA_VIEW.wordW} ${KORA_VIEW.wordH}`}
    className={className}
    fill={fill}
  >
    {KORA_WORDMARK_PATHS.map((path, index) => <path key={index} d={path} />)}
  </svg>
);
