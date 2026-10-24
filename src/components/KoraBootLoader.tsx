import React, { useEffect, useState } from "react";
import KoraInlineLoader from "./KoraInlineLoader";
import KoraWordmarkReveal from "./KoraWordmarkReveal";

/**
 * Optional boot sequence: the inline loop plays while the app is working, and the
 * moment it is `ready` the ink reveal plays once, then `onDone` fires.
 *
 *   <KoraBootLoader ready={authChecked && dataLoaded} onDone={() => setShowApp(true)} />
 *
 * `minLoopMs` keeps the loop on screen briefly so very fast boots don't flash.
 */
export interface KoraBootLoaderProps {
  ready: boolean;
  onDone?: () => void;
  minLoopMs?: number;
  /** Shown under the wordmark once the reveal has finished. */
  children?: React.ReactNode;
}

export default function KoraBootLoader({ ready, onDone, minLoopMs = 600, children }: KoraBootLoaderProps) {
  const [phase, setPhase] = useState<"loop" | "reveal" | "done">("loop");
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), minLoopMs);
    return () => clearTimeout(t);
  }, [minLoopMs]);

  useEffect(() => {
    if (phase === "loop" && ready && minElapsed) setPhase("reveal");
  }, [phase, ready, minElapsed]);

  if (phase === "loop") {
    return (
      <div className="flex items-center justify-center py-6">
        <KoraInlineLoader width={200} />
      </div>
    );
  }

  return (
    <div className="w-52 sm:w-64 max-w-full mx-auto">
      <KoraWordmarkReveal
        onDone={() => {
          setTimeout(() => {
            setPhase("done");
            onDone?.();
          }, 500);
        }}
      >
        {children}
      </KoraWordmarkReveal>
    </div>
  );
}
