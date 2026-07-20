import type { LiquidGlassPreset } from "./presets";

export type DisplacementShape = "pill" | "circle" | "card";

/**
 * Build SDF displacement map matching LiquidGlassKit Metal shader logic:
 * roundedRectangleSDF → finite-difference normal → edge-band refraction strength.
 * R/G channels = displacement; 128 = neutral center.
 */
export function buildLiquidGlassDisplacementMap(options: {
  size?: number;
  shape: DisplacementShape;
  preset: LiquidGlassPreset;
  cornerRadiusPx?: number;
}): string {
  const size = options.size ?? 256;
  const { shape, preset } = options;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";

  const half = size / 2;
  const margin = 4;
  let rx: number;
  let ry: number;
  let corner: number;

  if (shape === "circle") {
    rx = half - margin;
    ry = half - margin;
    corner = rx;
  } else if (shape === "pill") {
    rx = half - margin;
    ry = half * 0.38;
    corner = ry;
  } else {
    rx = half - margin;
    ry = half - margin * 2;
    corner = 28;
  }

  if (options.cornerRadiusPx) {
    corner = Math.min(corner, options.cornerRadiusPx);
  }

  const thickness = preset.glassThickness * 2.8;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const sdf = (px: number, py: number) => roundedRectSdf(px, py, rx, ry, corner);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - half;
      const py = y + 0.5 - half;
      const dist = sdf(px, py);

      const e = 1.1;
      const d1 = sdf(px + e, py) - sdf(px - e, py);
      const d2 = sdf(px, py + e) - sdf(px, py - e);
      const len = Math.hypot(d1, d2) || 1;
      const nx = d1 / len;
      const ny = d2 / len;

      // Metal shader: edge band inside shape only
      const edge = dist < 0 ? Math.min(1, -dist / thickness) : 0;
      const depthRatio = 1 - edge;
      const incident = Math.pow(Math.max(0, depthRatio), 2);
      const refracted = Math.asin(
        Math.min(1, (1 / preset.refractiveIndex) * Math.sin(incident * (Math.PI / 2)))
      );
      const edgeShift = Math.max(0, Math.tan(refracted - incident * (Math.PI / 2)) * 0.5);
      const strength = edge > 0 ? edgeShift * (1 + preset.dispersionStrength * 0.02) : 0;

      const i = (y * size + x) * 4;
      data[i] = Math.round(128 + nx * strength * 127);
      data[i + 1] = Math.round(128 + ny * strength * 127);
      data[i + 2] = Math.round(128 + strength * 40);
      data[i + 3] = dist <= 1.5 ? 255 : 0;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

function roundedRectSdf(px: number, py: number, rx: number, ry: number, corner: number) {
  const qx = Math.abs(px) - (rx - corner);
  const qy = Math.abs(py) - (ry - corner);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const outside = Math.hypot(ox, oy);
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - corner;
}
