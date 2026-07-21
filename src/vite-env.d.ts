/// <reference types="vite/client" />

declare const __KORA_BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_APP_CHANNEL?: "production" | "beta";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
