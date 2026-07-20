import { useEffect, useMemo, useState } from "react";
import {
  LG_LENS,
  LG_REGULAR,
  LG_THUMB,
  buildLiquidGlassDisplacementMap,
} from "../../lib/liquidGlass";

function ChromaticDispersionFilter({
  id,
  mapHref,
  displaceScale,
  chromaticScale,
  blurStd = 0,
}: {
  id: string;
  mapHref: string;
  displaceScale: number;
  chromaticScale: number;
  blurStd?: number;
}) {
  const rDx = chromaticScale * 0.15;
  const bDx = -chromaticScale * 0.15;

  return (
    <filter
      id={id}
      x="-25%"
      y="-25%"
      width="150%"
      height="150%"
      colorInterpolationFilters="sRGB"
    >
      <feImage href={mapHref} result="map" preserveAspectRatio="none" />
      <feDisplacementMap
        in="SourceGraphic"
        in2="map"
        scale={displaceScale}
        xChannelSelector="R"
        yChannelSelector="G"
        result="refract"
      />
      <feOffset in="refract" dx={rDx} dy={0} result="rShift" />
      <feOffset in="refract" dx={bDx} dy={0} result="bShift" />
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
      {blurStd > 0 ? (
        <>
          <feGaussianBlur in="rgb" stdDeviation={blurStd} result="soft" />
          <feBlend in="soft" in2="refract" mode="normal" />
        </>
      ) : (
        <feBlend in="rgb" in2="refract" mode="normal" />
      )}
    </filter>
  );
}

/**
 * SVG filter defs matching LiquidGlassKit Metal shaders:
 * SDF displacement refraction + chromatic dispersion.
 * CSS references url(#lg-filter-regular|lens|thumb).
 */
export function LiquidGlassFilters({ onReady }: { onReady?: () => () => void }) {
  const [pillMap, setPillMap] = useState("");
  const [circleMap, setCircleMap] = useState("");
  const [thumbMap, setThumbMap] = useState("");

  useEffect(() => {
    setPillMap(
      buildLiquidGlassDisplacementMap({
        size: 256,
        shape: "pill",
        preset: LG_REGULAR,
      })
    );
    setCircleMap(
      buildLiquidGlassDisplacementMap({
        size: 256,
        shape: "circle",
        preset: LG_LENS,
      })
    );
    setThumbMap(
      buildLiquidGlassDisplacementMap({
        size: 256,
        shape: "circle",
        preset: LG_THUMB,
      })
    );
  }, []);

  const ready = useMemo(
    () => Boolean(pillMap && circleMap && thumbMap),
    [pillMap, circleMap, thumbMap]
  );

  useEffect(() => {
    if (!ready || !onReady) return;
    return onReady();
  }, [ready, onReady]);

  if (!ready) {
    return (
      <svg
        aria-hidden
        className="lg-svg-defs"
        width={0}
        height={0}
        style={{ position: "absolute", overflow: "hidden" }}
      />
    );
  }

  return (
    <svg
      aria-hidden
      focusable="false"
      className="lg-svg-defs"
      width={0}
      height={0}
      style={{ position: "absolute", overflow: "hidden", pointerEvents: "none" }}
    >
      <defs>
        <ChromaticDispersionFilter
          id="lg-filter-regular"
          mapHref={pillMap}
          displaceScale={LG_REGULAR.displaceScale}
          chromaticScale={LG_REGULAR.chromaticScale}
          blurStd={0.35}
        />
        <ChromaticDispersionFilter
          id="lg-filter-lens"
          mapHref={circleMap}
          displaceScale={LG_LENS.displaceScale}
          chromaticScale={LG_LENS.chromaticScale}
        />
        <ChromaticDispersionFilter
          id="lg-filter-thumb"
          mapHref={thumbMap}
          displaceScale={LG_THUMB.displaceScale}
          chromaticScale={LG_THUMB.chromaticScale}
        />
      </defs>
    </svg>
  );
}
