import React, { useEffect, useMemo, useState } from "react";
import {
  LIQUID_GLASS_LENS,
  LIQUID_GLASS_REGULAR,
  buildRoundedGlassDisplacementMap,
  setLiquidGlassEnabled,
} from "../lib/liquidGlass";

/**
 * SVG filter defs inspired by LiquidGlassKit Metal shaders:
 * refraction (displacement), chromatic dispersion (R/G/B scales), soft frost.
 * Mount once at app root; CSS references url(#kora-liquid-*).
 */
export default function LiquidGlassFilters() {
  const [pillMap, setPillMap] = useState("");
  const [circleMap, setCircleMap] = useState("");

  useEffect(() => {
    setPillMap(
      buildRoundedGlassDisplacementMap({
        size: 256,
        cornerRatio: 0.5,
        thickness: LIQUID_GLASS_REGULAR.glassThickness * 3,
      })
    );
    setCircleMap(
      buildRoundedGlassDisplacementMap({
        size: 256,
        cornerRatio: 0.5,
        thickness: LIQUID_GLASS_LENS.glassThickness * 4,
      })
    );
  }, []);

  const mapsReady = useMemo(() => Boolean(pillMap && circleMap), [pillMap, circleMap]);

  useEffect(() => {
    if (!mapsReady) return;
    // Enable refraction only after filter nodes exist (paint-tested).
    const id = window.setTimeout(() => setLiquidGlassEnabled(true), 0);
    return () => {
      window.clearTimeout(id);
      setLiquidGlassEnabled(false);
    };
  }, [mapsReady]);

  if (!mapsReady) {
    return (
      <svg width={0} height={0} aria-hidden className="absolute w-0 h-0 overflow-hidden" />
    );
  }

  return (
    <svg
      width={0}
      height={0}
      aria-hidden
      className="absolute w-0 h-0 overflow-hidden pointer-events-none"
    >
      <defs>
        {/* Regular glass — tab bar / cards / header */}
        <filter
          id="kora-liquid-regular"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feImage href={pillMap} result="map" preserveAspectRatio="none" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale={LIQUID_GLASS_REGULAR.displaceScale}
            xChannelSelector="R"
            yChannelSelector="G"
            result="refract"
          />
          {/* Chromatic dispersion (LiquidGlassKit sampleWithDispersion) */}
          <feOffset in="refract" dx={LIQUID_GLASS_REGULAR.chromaticScale * 0.15} dy={0} result="rShift" />
          <feOffset in="refract" dx={-LIQUID_GLASS_REGULAR.chromaticScale * 0.15} dy={0} result="bShift" />
          <feColorMatrix
            in="rShift"
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="red"
          />
          <feColorMatrix
            in="refract"
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="green"
          />
          <feColorMatrix
            in="bShift"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            result="blue"
          />
          <feBlend in="red" in2="green" mode="screen" result="rg" />
          <feBlend in="rg" in2="blue" mode="screen" result="rgb" />
          <feGaussianBlur in="rgb" stdDeviation={0.4} result="soft" />
          <feBlend in="soft" in2="refract" mode="normal" />
        </filter>

        {/* Lens glass — circular buttons / selected pill */}
        <filter
          id="kora-liquid-lens"
          x="-35%"
          y="-35%"
          width="170%"
          height="170%"
          colorInterpolationFilters="sRGB"
        >
          <feImage href={circleMap} result="map" preserveAspectRatio="none" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale={LIQUID_GLASS_LENS.displaceScale}
            xChannelSelector="R"
            yChannelSelector="G"
            result="refract"
          />
          <feOffset in="refract" dx={LIQUID_GLASS_LENS.chromaticScale * 0.2} dy={0} result="rShift" />
          <feOffset in="refract" dx={-LIQUID_GLASS_LENS.chromaticScale * 0.2} dy={0} result="bShift" />
          <feColorMatrix
            in="rShift"
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="red"
          />
          <feColorMatrix
            in="refract"
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="green"
          />
          <feColorMatrix
            in="bShift"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            result="blue"
          />
          <feBlend in="red" in2="green" mode="screen" result="rg" />
          <feBlend in="rg" in2="blue" mode="screen" />
        </filter>
      </defs>
    </svg>
  );
}
