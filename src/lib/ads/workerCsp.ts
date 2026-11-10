import { buildKoraAdsContentSecurityPolicy } from "./cspPolicy";

export interface AdsCspEnv {
  KORA_ADS_ENABLED?: string;
  VITE_ADS_PROVIDER?: string;
  VITE_ADS_CSP_EXTRA?: string;
}

export function parseAdsCspExtra(raw: string | undefined): string[] {
  return (raw || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function workerAdsContentSecurityPolicy(env: AdsCspEnv): string | null {
  if ((env.KORA_ADS_ENABLED || "").trim().toLowerCase() !== "true") return null;
  return buildKoraAdsContentSecurityPolicy({
    provider: env.VITE_ADS_PROVIDER,
    extraOrigins: parseAdsCspExtra(env.VITE_ADS_CSP_EXTRA),
  });
}

export function applyWorkerAdsCsp(headers: Headers, env: AdsCspEnv): void {
  const csp = workerAdsContentSecurityPolicy(env);
  if (csp) headers.set("Content-Security-Policy", csp);
}
