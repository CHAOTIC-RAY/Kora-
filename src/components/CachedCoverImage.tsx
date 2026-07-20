import React, { useEffect, useState } from "react";
import { resolveCoverImageSrc } from "../lib/coverImage";
import { resolveCachedCoverSrc, warmCoverCache } from "../lib/coverCache";

interface CachedCoverImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  coverUrl?: string | null;
  bookTitle?: string;
  /** Fallback when image fails — title chip or empty */
  fallback?: "title" | "empty";
}

function coverRedirectFallback(title?: string, original?: string | null): string | null {
  if (title?.trim()) {
    return `/api/cover-redirect?title=${encodeURIComponent(title.trim())}`;
  }
  if (original && /^https?:\/\//i.test(original.trim())) {
    // Last resort: try raw URL without proxy (may work for same-origin-friendly CDNs)
    return original.trim().replace(/^http:\/\//i, "https://");
  }
  return null;
}

/** Cover <img> that serves from offline IDB cache when available, with load fallbacks. */
export default function CachedCoverImage({
  coverUrl,
  bookTitle,
  alt,
  fallback = "title",
  className,
  ...rest
}: CachedCoverImageProps) {
  const [src, setSrc] = useState<string | null>(() => resolveCoverImageSrc(coverUrl));
  const [failed, setFailed] = useState(false);
  const [triedRedirect, setTriedRedirect] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const display = resolveCoverImageSrc(coverUrl);
    setSrc(display);
    setFailed(false);
    setTriedRedirect(false);
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

  const onError = () => {
    if (!triedRedirect) {
      const next = coverRedirectFallback(bookTitle, coverUrl);
      setTriedRedirect(true);
      if (next && next !== src) {
        setSrc(next);
        return;
      }
    }
    setFailed(true);
    setSrc(null);
  };

  if (!src || failed) {
    if (fallback === "empty") return null;
    return (
      <div
        className={`bg-kindle-border/40 flex items-center justify-center p-1 text-[9px] font-bold uppercase text-kindle-text-muted text-center leading-tight ${className || ""}`}
        aria-label={alt || bookTitle || "No cover"}
      >
        <span className="line-clamp-4 px-0.5">{bookTitle || "No cover"}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || bookTitle || "Book cover"}
      loading="lazy"
      decoding="async"
      className={className}
      onError={onError}
      {...rest}
    />
  );
}
