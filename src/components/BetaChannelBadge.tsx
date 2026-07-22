import React from "react";
import { IS_BETA_CHANNEL } from "../lib/appChannel";

export default function BetaChannelBadge() {
  if (!IS_BETA_CHANNEL) return null;

  return (
    <span
      className="inline-flex items-center rounded-md border border-amber-500/35 bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300"
      title="Beta build — features here may be unstable"
      aria-label="Beta build"
    >
      Beta
    </span>
  );
}
