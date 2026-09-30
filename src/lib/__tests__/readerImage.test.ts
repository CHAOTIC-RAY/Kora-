/**
 * Decode-size maths for the reader's huge-image path.
 *
 * Each of these is the failure mode that motivated the module: a webtoon
 * page decoded at full resolution (60MB) freezing a phone, and the fix
 * overshooting in the other direction and decoding so small the page was
 * unreadable.
 */
import { computeDecodeSize, viewportDecodeBox, MAX_EDGE as MAX_EDGE_PREVIEW } from "../readerImage";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL ", name, detail === undefined ? "" : JSON.stringify(detail));
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ---- the actual case: a 1000x15000 webtoon strip ---- */
{
  const r = computeDecodeSize({
    naturalWidth: 1000,
    naturalHeight: 15000,
    maxWidth: 1600,
    maxHeight: 3200,
  });
  // 15000 tall into 3200 available => scale 0.2133
  ok("webtoon is downscaled", r.limited, r);
  ok("webtoon keeps its 15:1 aspect", Math.abs(r.width / r.height - 1000 / 15000) < 0.01, r);
  ok("webtoon height fits the box", r.height <= 3200, r);
  // The whole point: ~8.5MB decoded instead of ~60MB.
  ok("webtoon decode stays small", r.decodeBytes < 12 * 1024 * 1024, r);
  ok("webtoon saving is large", r.fullBytes / r.decodeBytes > 5, r);
  ok("full bytes computed as RGBA", r.fullBytes === 1000 * 15000 * 4, r);
}

/* ---- never upscale: a small image in a big box decodes at its own size ---- */
{
  const r = computeDecodeSize({
    naturalWidth: 800,
    naturalHeight: 1200,
    maxWidth: 4000,
    maxHeight: 4000,
  });
  ok("small image is not upscaled", r.scale === 1, r);
  ok("small image keeps intrinsic size", eq([r.width, r.height], [800, 1200]), r);
  ok("small image is not limited", r.limited === false, r);
}

/* ---- an exact fit is not a resize ---- */
{
  const r = computeDecodeSize({
    naturalWidth: 1000,
    naturalHeight: 2000,
    maxWidth: 1000,
    maxHeight: 2000,
  });
  ok("exact fit is scale 1", r.scale === 1, r);
}

/* ---- a single tight axis decides the scale; the other is padded ---- */
{
  const r = computeDecodeSize({
    naturalWidth: 2000,
    naturalHeight: 1000, // landscape
    maxWidth: 500,
    maxHeight: 4000,
  });
  ok("width axis constrains a landscape page", r.width <= 500, r);
  ok("landscape page keeps aspect", Math.abs(r.width / r.height - 2) < 0.02, r);
}

/* ---- degenerate inputs must not divide by zero or collapse to nothing ---- */
{
  const zero = computeDecodeSize({ naturalWidth: 0, naturalHeight: 0, maxWidth: 800, maxHeight: 600 });
  ok("zero intrinsic still returns a size", zero.width > 0 && zero.height > 0, zero);
  ok("zero intrinsic does not claim a saving", zero.limited === false, zero);

  const nan = computeDecodeSize({
    naturalWidth: Number.NaN,
    naturalHeight: 100,
    maxWidth: 800,
    maxHeight: 600,
  });
  ok("NaN intrinsic still returns a size", nan.width > 0 && nan.height > 0, nan);

  const thin = computeDecodeSize({ naturalWidth: 10000, naturalHeight: 1, maxWidth: 300, maxHeight: 300 });
  ok("a 1px-tall strip keeps a nonzero height", thin.height >= 1, thin);
  ok("a 1px-tall strip is still bounded", thin.width <= MAX_EDGE_PREVIEW, thin);
}

/* ---- an absurd box must not unlock a giant decode ---- */
{
  const r = computeDecodeSize({
    naturalWidth: 20000,
    naturalHeight: 20000,
    maxWidth: 1e9,
    maxHeight: 1e9,
  });
  ok("huge box is capped", r.width <= MAX_EDGE_PREVIEW && r.height <= MAX_EDGE_PREVIEW, r);
}

/* ---- the viewport box: DPR x supersample, clamped ---- */
{
  const dpr2 = viewportDecodeBox({ viewportWidth: 400, viewportHeight: 800, devicePixelRatio: 2 });
  ok("2x screen gets a 2x box", eq(dpr2, { maxWidth: 1600, maxHeight: 3200 }), dpr2);

  const dpr3 = viewportDecodeBox({ viewportWidth: 400, viewportHeight: 800, devicePixelRatio: 3 });
  ok("3x screen gets a 3x box", eq(dpr3, { maxWidth: 2400, maxHeight: 4800 }), dpr3);

  const dpr1 = viewportDecodeBox({ viewportWidth: 400, viewportHeight: 800, devicePixelRatio: 1 });
  ok("1x screen still gets 2x for sharpness", eq(dpr1, { maxWidth: 800, maxHeight: 1600 }), dpr1);

  const weird = viewportDecodeBox({ viewportWidth: 400, viewportHeight: 800, devicePixelRatio: 0 });
  ok("zero DPR falls back to 1", weird.maxWidth === 800, weird);

  const huge = viewportDecodeBox({ viewportWidth: 400, viewportHeight: 800, devicePixelRatio: 12 });
  ok("absurd DPR is clamped", huge.maxWidth === 400 * 3 * 2, huge);
}

/* ---- end to end: viewport box then decode, on the real strip ---- */
{
  const box = viewportDecodeBox({ viewportWidth: 412, viewportHeight: 915, devicePixelRatio: 2.625 });
  const r = computeDecodeSize({
    naturalWidth: 1180,
    naturalHeight: 15940,
    maxWidth: box.maxWidth,
    maxHeight: box.maxHeight,
  });
  ok("end-to-end decode fits the box", r.width <= box.maxWidth && r.height <= box.maxHeight, r);
  ok("end-to-end decode is bounded in memory", r.decodeBytes < 16 * 1024 * 1024, r);
  ok("end-to-end saving is at least 4x", r.fullBytes / r.decodeBytes >= 4, r);
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
