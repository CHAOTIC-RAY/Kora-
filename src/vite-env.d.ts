/// <reference types="vite/client" />

declare const __KORA_BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_APP_CHANNEL?: "production" | "beta";
  /** Cloudflare Worker origin used by the Capacitor APK for /api calls */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
