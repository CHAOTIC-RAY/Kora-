import React, { useEffect, useState } from "react";
import { resolveCoverImageSrc } from "../lib/coverImage";
import { resolveCachedCoverSrc, warmCoverCache } from "../lib/coverCache";

interface CachedCoverImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  coverUrl?: string | null;
  bookTitle?: string;
}

/** Cover <img> that serves from offline IDB cache when available. */
export default function CachedCoverImage({ coverUrl, bookTitle, alt, ...rest }: CachedCoverImageProps) {
  const [src, setSrc] = useState<string | null>(() => resolveCoverImageSrc(coverUrl));

  useEffect(() => {
    let cancelled = false;
    const display = resolveCoverImageSrc(coverUrl);
    setSrc(display);
    if (!display) return;

    (async () => {
      const cached = await resolveCachedCoverSrc(display);
      if (!cancelled && cached) setSrc(cached);
      else if (display) void warmCoverCache(display);
    })();

    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  if (!src) {
    return (
      <div
        className={`bg-kindle-border/40 flex items-center justify-center text-[10px] text-kindle-text-muted ${rest.className || ""}`}
        aria-label={alt || bookTitle || "No cover"}
      >
        No cover
      </div>
    );
  }

  return <img src={src} alt={alt || bookTitle || "Book cover"} loading="lazy" decoding="async" {...rest} />;
}
