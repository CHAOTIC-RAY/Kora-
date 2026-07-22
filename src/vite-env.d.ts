/// <reference types="vite/client" />

declare const __KORA_BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_APP_CHANNEL?: "production" | "beta";
  /** Cloudflare Worker origin used by the Capacitor APK for /api calls */
  readonly VITE_API_BASE_URL?: string;
  /** Android versionName baked into APK web assets (e.g. 1.0.123) */
  readonly VITE_APK_VERSION?: string;
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
