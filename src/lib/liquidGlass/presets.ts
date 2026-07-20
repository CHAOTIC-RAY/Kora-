/**
 * LiquidGlassKit material presets — ported from DnV1eX/LiquidGlassKit
 * https://github.com/DnV1eX/LiquidGlassKit
 *
 * Maps Metal ShaderUniforms + background capture params to web CSS/SVG.
 */

export type LiquidGlassMaterial = "regular" | "lens" | "thumb";

export interface LiquidGlassPreset {
  /** Metal: glassThickness */
  glassThickness: number;
  /** Metal: refractiveIndex */
  refractiveIndex: number;
  /** Metal: dispersionStrength */
  dispersionStrength: number;
  /** Metal: glareIntensity */
  glareIntensity: number;
  /** Metal: glareDirectionOffset (radians) */
  glareDirectionOffset: number;
  /** SVG feDisplacementMap scale */
  displaceScale: number;
  /** Chromatic fringe offset (px) */
  chromaticScale: number;
  /** backdrop-filter blur (px) */
  blurPx: number;
  /** backdrop saturate */
  saturate: number;
  /** backdrop brightness */
  brightness: number;
  /** ShadowView-style drop shadow */
  shadow: boolean;
}

/** LiquidGlass.regular — tab bar, header, cards */
export const LG_REGULAR: LiquidGlassPreset = {
  glassThickness: 10,
  refractiveIndex: 1.5,
  dispersionStrength: 5,
  glareIntensity: 0.1,
  glareDirectionOffset: -Math.PI / 4,
  displaceScale: 38,
  chromaticScale: 7,
  blurPx: 10,
  saturate: 1.85,
  brightness: 1.06,
  shadow: true,
};

/** LiquidGlass.lens — selected tab pill, circular controls */
export const LG_LENS: LiquidGlassPreset = {
  glassThickness: 6,
  refractiveIndex: 1.1,
  dispersionStrength: 15,
  glareIntensity: 0.1,
  glareDirectionOffset: -Math.PI / 4,
  displaceScale: 52,
  chromaticScale: 12,
  blurPx: 5,
  saturate: 2.1,
  brightness: 1.12,
  shadow: true,
};

/** LiquidGlass.thumb — compact controls */
export const LG_THUMB: LiquidGlassPreset = {
  glassThickness: 10,
  refractiveIndex: 1.11,
  dispersionStrength: 5,
  glareIntensity: 0.01,
  glareDirectionOffset: Math.PI * 0.9,
  displaceScale: 28,
  chromaticScale: 5,
  blurPx: 8,
  saturate: 1.7,
  brightness: 1.05,
  shadow: true,
};

export const LG_PRESETS: Record<LiquidGlassMaterial, LiquidGlassPreset> = {
  regular: LG_REGULAR,
  lens: LG_LENS,
  thumb: LG_THUMB,
};

/** LiquidGlass.regular tintColor — light / dark from kit UIColor literals */
export const LG_TINT_LIGHT = "rgba(230, 242, 255, 0.8)";
export const LG_TINT_DARK = "rgba(0, 13, 25, 0.8)";

/** LiquidLensView resting pill */
export const LG_RESTING_PILL = "rgba(255, 255, 255, 0.3)";

export const LIQUID_GLASS_ATTR = "data-liquid-glass";

export function presetFilterId(material: LiquidGlassMaterial): string {
  return material === "lens" ? "lg-filter-lens" : "lg-filter-regular";
}
