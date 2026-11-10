import fs from "fs";
import path from "path";

function adsEnabledFromEnv(env) {
  const v = (env.VITE_ADS_ENABLED || process.env.VITE_ADS_ENABLED || "").trim().toLowerCase();
  return v === "true" || v === "1";
}

function parseExtras(env) {
  const raw = env.VITE_ADS_CSP_EXTRA || process.env.VITE_ADS_CSP_EXTRA || "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Vite plugin: inject CSP + dist/_headers when display ads are enabled at build time. */
export default function viteAdsCspPlugin() {
  return {
    name: "kora-ads-csp",
    config() {
      // Allow importing CSP builder without TS in this script — duplicate minimal inline below.
    },
    transformIndexHtml(html) {
        if (!adsEnabledFromEnv(process.env)) return html;
        const provider = process.env.VITE_ADS_PROVIDER || "adsterra";
        const extra = parseExtras(process.env);
        const { buildKoraAdsContentSecurityPolicy: build } = getCspBuilder();
        const csp = build({ provider, extraOrigins: extra });
        const tag = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}" />`;
        return html.replace("</head>", `    ${tag}\n  </head>`);
    },
    writeBundle(options) {
      if (!adsEnabledFromEnv(process.env)) return;
      const outDir = options.dir || path.resolve("dist");
      const headersPath = path.join(outDir, "_headers");
      const provider = process.env.VITE_ADS_PROVIDER || "adsterra";
      const { buildKoraAdsContentSecurityPolicy: build } = getCspBuilder();
      const csp = build({ provider, extraOrigins: parseExtras(process.env) });
      const block = `\n/index.html\n  Content-Security-Policy: ${csp}\n`;
      fs.mkdirSync(outDir, { recursive: true });
      fs.appendFileSync(headersPath, block);
    },
  };
}

function getCspBuilder() {
  // Inline CSP builder (keeps plugin self-contained for Node without TS compile step).
  const ADSTERRA_DEFAULT_ORIGINS = [
    "https://www.highperformanceformat.com",
    "https://*.highperformanceformat.com",
    "https://*.effectivegatecpm.com",
    "https://*.ploffs.com",
    "https://*.rewindads.com",
  ];
  function defaultAdScriptOrigins(provider, extra = []) {
    const list = [...extra];
    const p = (provider || "adsterra").toLowerCase();
    if (p === "adsterra" || p === "custom" || p === "placeholder") {
      for (const o of ADSTERRA_DEFAULT_ORIGINS) {
        if (!list.includes(o)) list.push(o);
      }
    }
    return list;
  }
  function buildKoraAdsContentSecurityPolicy(options) {
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
  return { buildKoraAdsContentSecurityPolicy };
}
