/// <reference types="vite/client" />

declare const __KORA_BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_APP_CHANNEL?: "production" | "beta";
  /** Cloudflare Worker origin used by the Capacitor APK for /api calls */
  readonly VITE_API_BASE_URL?: string;
  /** Android versionName baked into APK web assets (e.g. 1.0.123) */
  readonly VITE_APK_VERSION?: string;
  readonly VITE_APP_VERSION?: string;
  /** Display banners (off unless "true") */
  readonly VITE_ADS_ENABLED?: string;
  readonly VITE_ADS_PROVIDER?: "adsterra" | "placeholder" | "custom";
  readonly VITE_ADS_ZONE_MOBILE?: string;
  readonly VITE_ADS_ZONE_DESKTOP?: string;
  readonly VITE_ADS_DESKTOP_SIZE?: "728x90" | "468x60";
  readonly VITE_ADS_SCRIPT_ORIGIN?: string;
  readonly VITE_ADS_ALLOW_NATIVE?: string;
  readonly VITE_ADS_CSP_EXTRA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
