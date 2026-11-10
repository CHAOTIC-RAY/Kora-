import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  adSlotDimensions,
  isNativeAppForAds,
  resolveAdBannerConfig,
  resolveZoneKeyForViewport,
  shouldShowAdBanner,
  type AdViewport,
} from "../lib/ads/adConfig";
import { AD_IFRAME_FAIL_MS, buildAdIframeSrcdoc } from "../lib/ads/adIframe";

export type AdBannerPlacement = "discover" | "library";

function useAdViewport(): AdViewport {
  const [viewport, setViewport] = useState<AdViewport>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop",
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setViewport(mq.matches ? "mobile" : "desktop");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return viewport;
}

export interface AdBannerProps {
  placement: AdBannerPlacement;
  className?: string;
}

/**
 * Fixed-height display banner in an isolated iframe. Lazy-loaded; collapses on
 * failure without throwing or spamming the console.
 */
export default function AdBanner({ placement, className = "" }: AdBannerProps) {
  const config = resolveAdBannerConfig();
  const viewport = useAdViewport();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [armed, setArmed] = useState(false);

  const native = isNativeAppForAds();
  const show = shouldShowAdBanner(config, { nativeApp: native });

  const zoneKey = useMemo(() => resolveZoneKeyForViewport(config, viewport), [config, viewport]);
  const { width, height } = adSlotDimensions(viewport, config.desktopSize);
  const missingZone = show && config.provider !== "placeholder" && !zoneKey;

  const srcdoc = useMemo(() => {
    if (!show || collapsed) return "";
    const ready = inView || config.provider === "placeholder";
    if (!ready) return "";
    return buildAdIframeSrcdoc(config, viewport, zoneKey);
  }, [show, inView, collapsed, config, viewport, zoneKey]);

  useEffect(() => {
    if (!show) return;
    if (config.provider === "placeholder") {
      setInView(true);
      return;
    }
    if (!rootRef.current) return;
    const el = rootRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px", threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [show, config.provider]);

  useEffect(() => {
    if (!srcdoc || collapsed) return;
    setArmed(true);
    if (config.provider === "placeholder") return;
    const timer = window.setTimeout(() => setCollapsed(true), AD_IFRAME_FAIL_MS);
    return () => window.clearTimeout(timer);
  }, [srcdoc, collapsed, config.provider]);

  if (!show || collapsed || missingZone) {
    return null;
  }

  const ariaLabel = `Sponsored banner (${placement})`;

  return (
    <div
      ref={rootRef}
      className={`w-full flex justify-center py-3 md:py-4 ${className}`}
      style={{ minHeight: height }}
      data-ad-placement={placement}
      data-testid={`ad-banner-${placement}`}
    >
      <div
        className="overflow-hidden rounded-lg border border-kindle-border/60 bg-kindle-card/40"
        style={{ width: "100%", maxWidth: width, height }}
      >
        {armed && srcdoc ? (
          <iframe
            title={ariaLabel}
            aria-label={ariaLabel}
            width={width}
            height={height}
            className="block border-0 mx-auto bg-transparent"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
            loading="lazy"
            referrerPolicy="no-referrer"
            srcDoc={srcdoc}
            onLoad={() => {
              /* successful load — keep slot; timeout may still collapse empty frames */
            }}
            onError={() => setCollapsed(true)}
          />
        ) : null}
      </div>
    </div>
  );
}
