/**
 * Web port of LiquidGlassKit-style materials.
 * Native kit uses Metal: SDF refraction, chromatic dispersion, Fresnel, glare.
 * Here we approximate with SVG feDisplacementMap + CSS backdrop chemistry.
 */

export const LIQUID_GLASS_ATTR = "data-liquid-glass";

/** LiquidGlassKit `.regular` preset, adapted for CSS/SVG. */
export const LIQUID_GLASS_REGULAR = {
  glassThickness: 10,
  refractiveIndex: 1.5,
  dispersionStrength: 5,
  glareIntensity: 0.1,
  blurPx: 12,
  displaceScale: 42,
  chromaticScale: 8,
} as const;

/** LiquidGlassKit `.lens` preset (tab selection / circular controls). */
export const LIQUID_GLASS_LENS = {
  glassThickness: 6,
  refractiveIndex: 1.1,
  dispersionStrength: 15,
  glareIntensity: 0.1,
  blurPx: 6,
  displaceScale: 56,
  chromaticScale: 14,
} as const;

/**
 * Build an SDF-style displacement map (R=nx, G=ny, 128=neutral).
 * Mimics LiquidGlassKit surface normals near the rounded silhouette.
 */
export function buildRoundedGlassDisplacementMap(options?: {
  size?: number;
  cornerRatio?: number;
  thickness?: number;
}): string {
  const size = options?.size ?? 256;
  const cornerRatio = options?.cornerRatio ?? 0.5; // 0.5 ≈ pill/circle
  const thickness = options?.thickness ?? 28;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";

  const img = ctx.createImageData(size, size);
  const data = img.data;
  const half = size / 2;
  const rx = half - 2;
  const ry = half - 2;
  const corner = Math.min(rx, ry) * cornerRatio;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - half;
      const py = y + 0.5 - half;
      // Rounded-rect SDF (box + corner radius)
      const qx = Math.abs(px) - (rx - corner);
      const qy = Math.abs(py) - (ry - corner);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const outside = Math.hypot(ox, oy);
      const inside = Math.min(Math.max(qx, qy), 0);
      const dist = outside + inside - corner;

      // Finite-difference normal (LiquidGlassKit-style)
      const e = 1.2;
      const d1 = sdf(px + e, py) - sdf(px - e, py);
      const d2 = sdf(px, py + e) - sdf(px, py - e);
      const len = Math.hypot(d1, d2) || 1;
      const nx = d1 / len;
      const ny = d2 / len;

      // Edge band only (glass thickness) — center stays neutral like Metal shader
      const edge = dist < 0 ? Math.min(1, (-dist) / thickness) : 0;
      const depthRatio = 1 - edge;
      const strength = edge > 0 ? Math.pow(Math.max(0, 1 - depthRatio), 1.35) : 0;

      const i = (y * size + x) * 4;
      data[i] = Math.round(128 + nx * strength * 127); // R → X displace
      data[i + 1] = Math.round(128 + ny * strength * 127); // G → Y displace
      data[i + 2] = 128;
      data[i + 3] = dist <= 1 ? 255 : 0;
    }
  }

  function sdf(px: number, py: number) {
    const qx = Math.abs(px) - (rx - corner);
    const qy = Math.abs(py) - (ry - corner);
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - corner;
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export function canUseBackdropSvgFilter(): boolean {
  if (typeof document === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  // Firefox parses url() then paints nothing; Safari ignores it. Gate to Chromium.
  const ua = navigator.userAgent;
  const isChromium = /Chrome|Chromium|Edg|CriOS/.test(ua) && !/Firefox|FxiOS/.test(ua);
  if (!isChromium) return false;
  try {
    if (!CSS.supports("backdrop-filter", "url(#kora-liquid-lens)")) return false;
  } catch {
    return false;
  }

  // Paint-test: some Chromium builds invalidate the whole backdrop-filter when url() fails.
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:-9999px;top:0;width:40px;height:40px;backdrop-filter:blur(4px) url(#kora-liquid-regular) saturate(120%);";
  document.documentElement.appendChild(probe);
  const applied = getComputedStyle(probe).backdropFilter || "";
  probe.remove();
  return applied !== "none" && /url\(/i.test(applied);
}

export function setLiquidGlassEnabled(enabled: boolean) {
  if (typeof document === "undefined") return;
  if (enabled && canUseBackdropSvgFilter()) {
    document.documentElement.setAttribute(LIQUID_GLASS_ATTR, "on");
  } else {
    document.documentElement.removeAttribute(LIQUID_GLASS_ATTR);
  }
}
