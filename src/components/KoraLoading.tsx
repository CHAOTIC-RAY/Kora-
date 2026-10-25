import React, { useEffect, useState } from "react";

interface KoraLoadingProps {
  context?: string;
  query?: string;
  compact?: boolean;
  categorySource?: any;
}

/**
 * Generic loading state using the supplied ink-reveal animation. Reduced-motion
 * users receive a static final frame of the same artwork.
 */
export default function KoraLoading({ context, query, compact }: KoraLoadingProps = {}) {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("dark") || document.body.classList.contains("dark");
  });

  useEffect(() => {
    const updateTheme = () => setIsDark(
      document.documentElement.classList.contains("dark") || document.body.classList.contains("dark")
    );
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // The supplied assets are named for the ink color: dark artwork for light
  // surfaces and light artwork for dark surfaces.
  const artwork = isDark ? "light" : "dark";
  const label = query ? `Searching ${query}` : context ? `Loading ${context}` : "Loading";
  return (
    <div className={`flex flex-col items-center justify-center ${compact ? "py-3 space-y-2" : "py-6 space-y-4"}`}>
      <div role="status" aria-live="polite" aria-label={label} className={compact ? "w-40 sm:w-48" : "w-52 sm:w-64 max-w-full"}>
        <picture>
          <source
            media="(prefers-reduced-motion: reduce)"
            srcSet={`/loading/kora-ink-reveal-${artwork}-still.png`}
          />
          <source type="image/gif" srcSet={`/loading/kora-ink-reveal-${artwork}.gif`} />
          <img
            src={`/loading/kora-ink-reveal-${artwork}.png`}
            alt=""
            width="560"
            height="236"
            decoding="async"
            className="block h-auto w-full"
          />
        </picture>
      </div>
      <p className="animate-pulse text-[10px] font-bold uppercase tracking-[0.3em] text-kindle-text-muted motion-reduce:animate-none">
        {query ? `Searching "${query}"...` : context ? `Loading ${context}...` : "Synchronizing..."}
      </p>
    </div>
  );
}
