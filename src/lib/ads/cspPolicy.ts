/**
 * Content-Security-Policy helpers for optional display ads.
 * Applied only when ads are enabled at build / deploy time.
 */

const ADSTERRA_DEFAULT_ORIGINS = [
  "https://www.highperformanceformat.com",
  "https://*.highperformanceformat.com",
  "https://*.effectivegatecpm.com",
  "https://*.ploffs.com",
  "https://*.rewindads.com",
];

export function defaultAdScriptOrigins(provider: string | undefined, extra: string[] = []): string[] {
  const list = [...extra];
  const p = (provider || "adsterra").toLowerCase();
  if (p === "adsterra" || p === "custom" || p === "placeholder") {
    for (const o of ADSTERRA_DEFAULT_ORIGINS) {
      if (!list.includes(o)) list.push(o);
    }
  }
  return list;
}

/** Full CSP header value when display ads are enabled (otherwise return null = omit CSP). */
export function buildKoraAdsContentSecurityPolicy(options: {
  provider?: string;
  extraOrigins?: string[];
}): string {
  const adOrigins = defaultAdScriptOrigins(options.provider, options.extraOrigins || []);
  const adSrc = adOrigins.join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${adSrc} https:`,
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https: wss:",
    `frame-src 'self' data: blob: https: ${adSrc}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
