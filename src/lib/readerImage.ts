/**
 * Decode-size maths for the comic reader.
 *
 * Why this exists. A webtoon page is routinely 800-2000px wide and
 * 10,000-20,000px tall. Handing that URL to an `<img>` forces the browser
 * to decode the *whole* bitmap before it can paint anything: a
 * 1000x15000 RGBA surface is roughly 60MB of heap, which on a mid-range
 * phone is the difference between a page turn and a tab being killed by
 * the OS. The same problem is why Android ships
 * `subsampling-scale-image-view` — it decodes a tile-sized slice of the
 * bitmap rather than the whole thing. There is no web equivalent of
 * tiling, but there is a web equivalent of *not decoding at all*: decode
 * at a reduced size with `createImageBitmap(url, { resizeWidth, ... })`,
 * which downscales during the JPEG/PNG decode instead of after it.
 *
 * So the fix is to make sure the decode is bounded by what the screen can
 * actually show, and to keep that bound in a pure function so it can be
 * tested. A canvas draw is not worth asserting on; "how big am I going to
 * ask the decoder for" is exactly the thing that was wrong three times
 * while the reader was built.
 *
 * The rule throughout: never upscale. Asking the decoder for a size larger
 * than the source wastes memory and gains nothing.
 */

/** Smallest edge we will ask for, so a pathological size cannot collapse to 0. */
const MIN_EDGE = 1;
/** Hard ceiling on either decode edge, whatever the viewport claims. */
export const MAX_EDGE = 8192;

export interface DecodeSizeInput {
  /** Intrinsic pixel size of the source image. */
  naturalWidth: number;
  naturalHeight: number;
  /** Space available for the decoded bitmap, in CSS px. */
  maxWidth: number;
  maxHeight: number;
}

export interface DecodeSize {
  /** Pixel width to request from the decoder. */
  width: number;
  /** Pixel height to request from the decoder. */
  height: number;
  /** Requested size divided by intrinsic size. 1 means "no reduction". */
  scale: number;
  /** True when the decode was actually shrunk. */
  limited: boolean;
  /**
   * Bytes the naive full-resolution decode would have cost (RGBA, 4 bytes
   * per pixel). Lets the caller log or badge the saving.
   */
  fullBytes: number;
  /** Bytes the bounded decode will cost. */
  decodeBytes: number;
}

const isUsable = (n: number) => Number.isFinite(n) && n > 0;

/**
 * The size to decode a page image at, bounded by the space available.
 *
 * The scale is the *smaller* of the two axis ratios, so the aspect ratio
 * always survives and the bitmap never overflows the box it was sized for.
 */
export function computeDecodeSize(input: DecodeSizeInput): DecodeSize {
  const { naturalWidth: nw, naturalHeight: nh, maxWidth: mw, maxHeight: mh } = input;

  // An unknown or zero intrinsic size means the image has not loaded yet.
  // Decode at the box size and let the caller redraw when the real size
  // arrives rather than returning something that divides by zero.
  if (!isUsable(nw) || !isUsable(nh)) {
    const w = clamp(Math.round(isUsable(mw) ? mw : 1024));
    const h = clamp(Math.round(isUsable(mh) ? mh : 1024));
    return {
      width: w,
      height: h,
      scale: 1,
      limited: false,
      fullBytes: 0,
      decodeBytes: w * h * 4,
    };
  }

  // An unbounded or absurd box must not unlock a full-resolution decode.
  const boxW = isUsable(mw) ? Math.min(mw, MAX_EDGE) : MAX_EDGE;
  const boxH = isUsable(mh) ? Math.min(mh, MAX_EDGE) : MAX_EDGE;

  const raw = Math.min(boxW / nw, boxH / nh, 1);
  const scale = Math.max(raw, MIN_EDGE / Math.max(nw, nh));

  const width = clamp(Math.round(nw * scale));
  const height = clamp(Math.round(nh * scale));

  return {
    width,
    height,
    scale,
    limited: scale < 1,
    fullBytes: nw * nh * 4,
    decodeBytes: width * height * 4,
  };
}

/**
 * The box to decode into, from the viewport.
 *
 * `supersample` is what makes a 2x/3x phone screen look sharp: the decode
 * is allowed to be that many device pixels per CSS pixel, which is why the
 * long edge of a page is bounded by `viewportHeight * dpr * supersample`
 * rather than by the viewport height. Two is the usual value — beyond that
 * the extra pixels are not visible, only resident.
 */
export function viewportDecodeBox(opts: {
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  /** Device pixels per CSS pixel to spend on the decode. Default 2. */
  supersample?: number;
}): { maxWidth: number; maxHeight: number } {
  const dpr = isUsable(opts.devicePixelRatio) ? Math.min(opts.devicePixelRatio, 3) : 1;
  const super_ = isUsable(opts.supersample) ? Math.min(opts.supersample, 3) : 2;
  const scale = dpr * super_;
  return {
    maxWidth: Math.max(1, Math.round(opts.viewportWidth * scale)),
    maxHeight: Math.max(1, Math.round(opts.viewportHeight * scale)),
  };
}

function clamp(n: number) {
  return Math.min(MAX_EDGE, Math.max(MIN_EDGE, Math.round(n)));
}
