import type { AdBannerRuntimeConfig, AdViewport } from "./adConfig";
import { adSlotDimensions } from "./adConfig";

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Build isolated iframe document (no parent DOM access). */
export function buildAdIframeSrcdoc(
  config: AdBannerRuntimeConfig,
  viewport: AdViewport,
  zoneKey: string,
): string {
  const { width, height } = adSlotDimensions(viewport, config.desktopSize);
  const label = escapeHtmlAttr(zoneKey === "placeholder" ? "Sponsored" : "Advertisement");

  if (config.provider === "placeholder" || zoneKey === "placeholder") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#e4e4e7;color:#52525b;font:600 10px/1.2 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;display:flex;align-items:center;justify-content:center;width:${width}px;height:${height}px;box-sizing:border-box;border:1px dashed #a1a1aa;">${label}</body></html>`;
  }

  if (!zoneKey) {
    return `<!DOCTYPE html><html><body style="margin:0;height:${height}px"></body></html>`;
  }

  const origin = escapeHtmlAttr(config.scriptOrigin);
  const key = escapeHtmlAttr(zoneKey);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank"></head><body style="margin:0;padding:0;overflow:hidden;width:${width}px;height:${height}px;background:transparent"><script type="text/javascript">var atOptions={"key":"${key}","format":"iframe","height":${height},"width":${width},"params":{}};</script><script type="text/javascript" src="${origin}/${key}/invoke.js"></script></body></html>`;
}

/** Milliseconds to wait before collapsing an empty slot (ad blocker / network failure). */
export const AD_IFRAME_FAIL_MS = 12_000;
