export type AppChannel = "production" | "beta";

/** Baked in at build time via VITE_APP_CHANNEL. */
export const APP_CHANNEL: AppChannel =
  import.meta.env.VITE_APP_CHANNEL === "beta" ? "beta" : "production";

export const IS_BETA_CHANNEL = APP_CHANNEL === "beta";
