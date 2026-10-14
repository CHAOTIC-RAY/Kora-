/**
 * One page image, decoded at a size the device can survive.
 *
 * The web equivalent of Android's `subsampling-scale-image-view`. That
 * library exists because a 1000x15000 webtoon page decoded at full
 * resolution is a ~60MB RGBA bitmap, and a phone that allocates it can be
 * killed by the OS mid-page-turn. There is no web equivalent of tiling, so
 * the fix is to make sure the decode is bounded by what the screen can show:
 * `createImageBitmap(url, { resizeWidth, resizeHeight })` downscales
 * *during* the decode, which is the difference between allocating 60MB and
 * allocating 8MB. The sizing maths lives in `readerImage.ts` and is unit
 * tested; this file is only the part that touches the DOM.
 *
 * Where the bytes come from:
 *
 *   Plugin images — manga covers and manga pages — are fetched through the
 *   Worker's `/api/proxy-image`, and that is the DEFAULT rather than a
 *   fallback. Two things push it there. Manga CDNs hotlink-protect, so a
 *   direct request to mangaread.org or cdn-2.mangazin.org is refused by the
 *   origin regardless of CORS, and `createImageBitmap` is stricter still, so
 *   it rejects where the `<img>` probe sometimes succeeds. And on a network
 *   with a DNS filter in front of it, the browser never reaches the origin
 *   at all — the answer comes back signed by a Fortiguard block page, and
 *   the handshake fails with `ERR_CERT_AUTHORITY_INVALID`. Cloudflare's
 *   resolver is not behind that filter, so the same URL relayed through the
 *   Worker returns a real image.
 *
 *   The distinction this replaces: a decode failure on a *direct* URL used
 *   to mean "this host needs the relay", which is the difference between a
 *   working chapter and an unavailable card on every page of it. Now the
 *   route is decided from the URL before any request is made, so there is no
 *   doomed first attempt to classify — `pluginImage.ts` holds that decision
 *   and `readerImage.ts` holds the sizing maths. This file is the DOM half.
 *
 * Three rendering paths, in order of preference:
 *
 *   1. Canvas, bounded decode. The normal case, and the only one that
 *      bounds memory.
 *   2. Plain `<img>`. When `createImageBitmap` is missing (older Safari) or
 *      throws. Correct, just not memory-bounded — the whole reason this
 *      component exists, so it is a fallback rather than the default.
 *   3. A failure card with Retry and Skip. A 404 on one page must not end
 *      the session: the reader has to stay open and the user has to be able
 *      to move on. The back button is deliberately still rendered here.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { computeDecodeSize, viewportDecodeBox } from "../lib/readerImage";
import { logger } from "../lib/logger";
import { resolvePluginImageSrc, shouldProxyImageUrl } from "../lib/pluginImage";

/**
 * The URL a plugin page is actually fetched from.
 *
 * Remote URLs go through the Worker from the very first attempt, not as a
 * fallback. This used to be direct-first with an escalation on failure, which
 * cost a doomed request per image: manga CDNs hotlink-refuse the direct
 * fetch, and on a network whose DNS filter answers with a Fortiguard
 * "Blocked Page" certificate the browser refuses the TLS handshake outright
 * (`ERR_CERT_AUTHORITY_INVALID`) — so *every* direct attempt fails and the
 * "fallback" had quietly become the normal path, with the wasted handshake
 * added on top. Routing by default also means the probe and the decode agree
 * with the `<img>` surface on the first frame rather than after a remount.
 *
 * Non-remote URLs (bundled assets, `data:`/`blob:`) are returned untouched.
 */
function routedImageUrl(url: string): string {
  return resolvePluginImageSrc(url) ?? url;
}

export interface ReaderPageImageProps {
  url: string;
  /** Accessible description — chapter and page, so a screen reader says where. */
  alt: string;
  /** Bare page number for the failure card, e.g. "7 of 20". */
  pageLabel?: string;
  /** Tall strip: fit the width and let the container scroll. */
  webtoon?: boolean;
  /** Zoom/pan transform, applied identically to both render paths. */
  transform?: { x: number; y: number; scale: number };
  /** Called when the image definitively failed, so preloading stops on it. */
  onFailure?: (url: string) => void;
  /**
   * Called when the user asks to retry. Lets the reader clear the recorded
   * failure: a URL that failed once would otherwise stay barred from
   * preloading for the rest of the session, even after the user has proven
   * the network came back.
   */
  onRetry?: (url: string) => void;
  /** Move off this page — a dead page must not trap the reader. */
  onSkip?: () => void;
  /** Keep the reader's own close control available on the failure card. */
  onClose?: () => void;
}

/** True when this browser can decode-with-resize at all. */
function canDecodeResized(): boolean {
  return (
    typeof createImageBitmap === "function" &&
    typeof HTMLCanvasElement !== "undefined"
  );
}

type Status = "loading" | "ready" | "error";

export function ReaderPageImage({
  url,
  alt,
  pageLabel = "—",
  webtoon = false,
  transform,
  onFailure,
  onRetry,
  onSkip,
  onClose,
}: ReaderPageImageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * Which surface to render, decided once per mount. This is separate from
   * the load status on purpose: the canvas has to be in the DOM from the
   * first render, because the decode effect measures and paints through
   * `canvasRef` and a canvas mounted later would be measured at zero size.
   */
  const [mode, setMode] = useState<"canvas" | "img">(() =>
    canDecodeResized() ? "canvas" : "img"
  );
  const [status, setStatus] = useState<Status>("loading");
  /**
   * Retry counter, tagged with the URL it belongs to. Storing the URL
   * alongside is what makes a page change reset the counter: a bare counter
   * would carry the previous page's `?kora_retry=1` onto the next page,
   * which busts the cache of an image that was never retried.
   */
  const [retry, setRetry] = useState<{ url: string; attempt: number }>({
    url: "",
    attempt: 0,
  });
  const attempt = retry.url === url ? retry.attempt : 0;
  /**
   * Whether this page goes through the Worker. Derived, not stored: the route
   * is a property of the URL, so it cannot get out of step with the page the
   * way the old escalation flag did — a flag flipped on after a decode
   * failure had to be reset during render to avoid an effect loop.
   */
  const useProxy = shouldProxyImageUrl(url);
  /**
   * The origin-form URL this page came from, for cache busting and logging.
   * The relay keeps the original in its query string, so a retry has to bust
   * the *proxied* URL — busting the bare URL would re-request the same
   * cached failure behind a fresh-looking origin.
   */
  const fetchUrl = routedImageUrl(url);
  const [message, setMessage] = useState("");

  // A new page is a new image: reset before decoding, never after, or the
  // previous page's canvas stays on screen for a frame.
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setMessage("");

    if (!url) {
      setStatus("error");
      setMessage("This page has no image.");
      return;
    }

    const base = fetchUrl;
    const bust =
      attempt > 0
        ? `${base}${base.includes("?") ? "&" : "?"}kora_retry=${attempt}`
        : base;

    // No bounded decode available: fall back to a plain `<img>`, which is
    // what this component did before it existed. Unbounded in memory, but
    // a working reader beats an elegant crash.
    if (!canDecodeResized()) {
      setMode("img");
      setStatus("ready");
      return;
    }
    setMode("canvas");

    // Size the canvas off the container so the decode is bounded by what is
    // actually on screen, not by the image's intrinsic size.
    const el = canvasRef.current?.parentElement;
    const vw = el?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 1024);
    const vh = el?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 768);
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const box = viewportDecodeBox({ viewportWidth: vw, viewportHeight: vh, devicePixelRatio: dpr });

    const giveUp = () => {
      if (!alive) return;
      logger.warn("[reader] page unavailable", { url, pageLabel, useProxy });
      setStatus("error");
      setMessage(
        "This page failed to load. The image may be missing or the source may be down."
      );
      onFailure?.(url);
    };

    /**
     * Nowhere left to escalate. A remote page is fetched through the Worker
     * from the first attempt now, so a failure here is a failure at the
     * origin or the relay — not a routing mistake — and reporting it
     * immediately is what stops the reader re-requesting a dead page on
     * every turn.
     */
    const escalateOrGiveUp = () => {
      if (!alive) return;
      if (useProxy) {
        logger.warn("[reader] relay load failed", { url, pageLabel });
      }
      giveUp();
    };

    // Two stages, and the order matters.
    //
    // `createImageBitmap` with BOTH resizeWidth and resizeHeight does not
    // letterbox — it *stretches* the decode to exactly that box. Asking for
    // a 1600x3200 box on a 1000x15000 webtoon strip would squash fifteen
    // pages of art into a 1:2 shape. So the intrinsic size has to be known
    // first, and only one axis may be passed to the decoder.
    //
    // Reading dimensions off an `Image` does not force a full decode — the
    // size comes from the file header — so this stage stays cheap even on a
    // 60MB source.
    const probe = new Image();
    probe.decoding = "async";

    const withIntrinsic = (nw: number, nh: number) => {
      if (!alive) return;
      const size = computeDecodeSize({
        naturalWidth: nw,
        naturalHeight: nh,
        maxWidth: box.maxWidth,
        maxHeight: box.maxHeight,
      });

      const drawTo = (src: ImageBitmap | HTMLImageElement, w: number, h: number) => {
        const canvas = canvasRef.current;
        if (!canvas || !alive) return;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          // No 2d context (a locked-down WebView, or a canvas that hit the
          // browser's own size cap). Fall back to the `<img>` path.
          setMode("img");
          setStatus("ready");
          return;
        }
        ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
        setStatus("ready");
      };

      // The decode box is already aspect-correct (computeDecodeSize uses
      // the smaller of the two axis ratios), so passing both axes asks the
      // decoder for exactly that shape and nothing is stretched. When the
      // source already fits, no resize is requested at all — upscaling a
      // decoded page only costs memory.
      const opts: ImageBitmapOptions = { resizeQuality: "high" };
      if (size.limited) {
        opts.resizeWidth = size.width;
        opts.resizeHeight = size.height;
      }

      // No bounded decode available: let the `<img>` element do the decode,
      // which is correct but not memory-bounded. A working reader beats an
      // elegant crash on a browser this old.
      if (!canDecodeResized()) {
        setMode("img");
        setStatus("ready");
        return;
      }

      // TS's `createImageBitmap` overloads do not include the `(URL, opts)`
      // form — the runtime does, and it is the form that matters, because
      // passing a URL lets the browser reuse its own HTTP cache and decode
      // straight off the network response instead of round-tripping through
      // an `HTMLImageElement` first. Hence the cast through `unknown`.
      const decodeResized = createImageBitmap as unknown as (
        src: string,
        o?: ImageBitmapOptions
      ) => Promise<ImageBitmap>;
      decodeResized(bust, opts)
        .then((bmp) => {
          if (!alive) {
            bmp.close?.();
            return;
          }
          // Both axes are passed only when the decoder has already been
          // told the exact aspect-correct size, so nothing is stretched.
          drawTo(bmp, bmp.width, bmp.height);
          bmp.close?.();
        })
        .catch(() => {
          // A decode rejection is not proof the bytes are bad: hotlink
          // protection and strict CORS make the decoder fail on images the
          // page could still render through the Worker. Escalate rather
          // than condemning the page.
          if (!alive) return;
          logger.warn("[reader] bounded decode failed", {
            url,
            pageLabel,
            useProxy,
          });
          escalateOrGiveUp();
        });
    };

    probe.onload = () => {
      const nw = probe.naturalWidth;
      const nh = probe.naturalHeight;
      if (!nw || !nh) {
        if (alive) {
          logger.warn("[reader] image reported no size", { url, pageLabel, useProxy });
          escalateOrGiveUp();
        }
        return;
      }
      withIntrinsic(nw, nh);
    };
    probe.onerror = () => {
      if (!alive) return;
      escalateOrGiveUp();
    };
    probe.src = bust;

    return () => {
      // Detach the probe so an in-flight load cannot fire into a component
      // that has already moved on to the next page. `removeAttribute`, not
      // `src = ""` — an empty src attribute resolves against the document
      // URL in several browsers, which fires a bogus load of the page itself.
      alive = false;
      probe.onload = null;
      probe.onerror = null;
      probe.removeAttribute("src");
    };
  }, [url, attempt, useProxy, onFailure]);

  const fail = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    // The `<img>` surface can fail where the probe succeeded — a different
    // request, a different cache state. The route is fixed by the URL now,
    // so there is no second attempt to make: this is a dead page.
    setStatus("error");
    setMessage(
      "This page failed to load. The image may be missing or the source may be down."
    );
    onFailure?.(url);
  };

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, transformOrigin: "center center" as const }
    : undefined;

  const surfaceClass = webtoon ? "w-full select-none" : "max-w-full max-h-full object-contain";

  /**
   * The `<img>` surface has to render the *same* source the decode used,
   * routed the same way and retry-busted the same way. Rendering the bare
   * `url` here was how a manual Retry silently re-requested the cached
   * failure — and would have meant a direct fetch even when the decode
   * succeeded through the relay.
   */
  const imgSrc =
    attempt > 0
      ? `${fetchUrl}${fetchUrl.includes("?") ? "&" : "?"}kora_retry=${attempt}`
      : fetchUrl;

  if (status === "error") {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 px-6 text-center"
        role="alert"
      >
        <AlertTriangle className="w-7 h-7 text-amber-500" />
        <p className="text-[11px] uppercase tracking-widest text-kindle-text">
          Page {pageLabel} unavailable
        </p>
        <p className="text-[10px] text-kindle-text-muted max-w-xs leading-relaxed">{message}</p>
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRetry?.(url);
              setRetry((r) => ({ url, attempt: r.url === url ? r.attempt + 1 : 1 }));
            }}
            className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 border border-kindle-border rounded-lg text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-text/10 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
          {onSkip && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSkip();
              }}
              className="pointer-events-auto px-3 py-1.5 border border-kindle-border rounded-lg text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-text/10 cursor-pointer"
            >
              Skip page
            </button>
          )}
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="pointer-events-auto px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text cursor-pointer"
            >
              Back
            </button>
          )}
        </div>
      </div>
    );
  }

  if (mode === "img") {
    return (
      <img
        src={imgSrc}
        alt={alt}
        onError={fail}
        draggable={false}
        className={surfaceClass}
        style={style}
      />
    );
  }

  return (
    // The canvas stays mounted through `loading` — it has to, because the
    // decode effect paints into it — and is simply hidden until the first
    // draw lands. Unmounting it to show a spinner would zero its measured
    // size and the decode would come back at the wrong scale.
    <div className="relative inline-flex">
      <canvas
        ref={canvasRef}
        // A canvas is opaque to assistive tech, so it has to carry the same
        // meaning the `<img alt>` did or the page vanishes for a screen reader.
        role="img"
        aria-label={alt}
        draggable={false}
        className={surfaceClass}
        style={{
          ...style,
          visibility: status === "ready" ? "visible" : "hidden",
        }}
      />
      {status !== "ready" && (
        <Loader2 className="absolute inset-0 m-auto w-6 h-6 animate-spin text-kindle-text-muted/70 pointer-events-none" />
      )}
    </div>
  );
}

export default ReaderPageImage;
