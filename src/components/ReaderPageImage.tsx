/**
 * One page image, decoded at a size the device can survive.
 *
 * The web equivalent of Tachiyomi's `subsampling-scale-image-view`. That
 * library exists because a 1000x15000 webtoon page decoded at full
 * resolution is a ~60MB RGBA bitmap, and a phone that allocates it can be
 * killed by the OS mid-page-turn. There is no web equivalent of tiling, so
 * the fix is to make sure the decode is bounded by what the screen can show:
 * `createImageBitmap(url, { resizeWidth, resizeHeight })` downscales
 * *during* the decode, which is the difference between allocating 60MB and
 * allocating 8MB. The sizing maths lives in `readerImage.ts` and is unit
 * tested; this file is only the part that touches the DOM.
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

    const bust =
      attempt > 0
        ? `${url}${url.includes("?") ? "&" : "?"}kora_retry=${attempt}`
        : url;

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
          if (!alive) return;
          // Bounded decode failed. Almost always the image is genuinely
          // broken or gone — so report it rather than silently retrying at
          // full resolution, which is the decode that kills the tab.
          logger.warn("[reader] bounded decode failed", { url, pageLabel });
          setStatus("error");
          setMessage("This page could not be loaded.");
          onFailure?.(url);
        });
    };

    probe.onload = () => {
      const nw = probe.naturalWidth;
      const nh = probe.naturalHeight;
      if (!nw || !nh) {
        if (alive) {
          setStatus("error");
          setMessage("This image reported no size.");
          onFailure?.(url);
        }
        return;
      }
      withIntrinsic(nw, nh);
    };
    probe.onerror = () => {
      if (!alive) return;
      const proxied =
        typeof window !== "undefined"
          ? `/api/proxy-image?url=${encodeURIComponent(url)}`
          : null;
      if (!proxied || attempt > 0) {
        logger.warn("[reader] page load failed", { url, pageLabel, attempt });
        setStatus("error");
        setMessage("This page failed to load. The image may be missing or the source may be down.");
        onFailure?.(url);
        return;
      }
      logger.info("[reader] retrying page through proxy-image", { url, pageLabel });
      const retryProbe = new Image();
      retryProbe.decoding = "async";
      retryProbe.onload = () => {
        if (!alive) return;
        setMode("img");
        setStatus("ready");
      };
      retryProbe.onerror = () => {
        if (!alive) return;
        logger.warn("[reader] proxy-image retry failed", { url, pageLabel });
        setStatus("error");
        setMessage("This page failed to load. The image may be missing or the source may be down.");
        onFailure?.(url);
      };
      retryProbe.src = proxied;
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
  }, [url, attempt, onFailure]);

  const fail = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    setStatus("error");
    setMessage("This page failed to load. The image may be missing or the source may be down.");
    onFailure?.(url);
  };

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, transformOrigin: "center center" as const }
    : undefined;

  const surfaceClass = webtoon ? "w-full select-none" : "max-w-full max-h-full object-contain";

  if (status === "error") {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 px-6 text-center"
        role="alert"
      >
        <AlertTriangle className="w-7 h-7 text-amber-500" />
        <p className="text-[11px] uppercase tracking-widest text-white/80">
          Page {pageLabel} unavailable
        </p>
        <p className="text-[10px] text-white/50 max-w-xs leading-relaxed">{message}</p>
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRetry?.(url);
              setRetry((r) => ({ url, attempt: r.url === url ? r.attempt + 1 : 1 }));
            }}
            className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/25 rounded-lg text-[10px] font-bold uppercase tracking-widest text-white/85 hover:bg-white/10 cursor-pointer"
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
              className="pointer-events-auto px-3 py-1.5 border border-white/25 rounded-lg text-[10px] font-bold uppercase tracking-widest text-white/85 hover:bg-white/10 cursor-pointer"
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
              className="pointer-events-auto px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-white cursor-pointer"
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
        src={url}
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
        <Loader2 className="absolute inset-0 m-auto w-6 h-6 animate-spin text-white/40 pointer-events-none" />
      )}
    </div>
  );
}

export default ReaderPageImage;
