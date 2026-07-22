import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config for the Kora Android APK.
 * Web assets are built into ./dist, then synced into the Android project.
 * API calls to /api/* are rewritten at runtime to VITE_API_BASE_URL (production Worker).
 */
const config: CapacitorConfig = {
  appId: "app.kora.reader",
  appName: "Kora",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // Allow navigation to the production API host and auth providers.
    allowNavigation: [
      "*.workers.dev",
      "accounts.google.com",
      "*.googleapis.com",
      "*.firebaseapp.com",
      "*.firebaseio.com",
      "www.netgalley.com",
      "covers.bksh.co",
      "openlibrary.org",
      "covers.openlibrary.org",
      "github.com",
      "api.github.com",
      "*.githubusercontent.com",
    ],
  },
  android: {
    allowMixedContent: true,
    backgroundColor: "#18181B",
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 400,
      launchAutoHide: true,
      backgroundColor: "#18181B",
      showSpinner: false,
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#18181B",
    },
    LocalNotifications: {
      smallIcon: "ic_stat_kora",
      iconColor: "#C4A574",
      sound: "default",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
    FirebaseAuthentication: {
      // JS SDK remains canonical; native layer only obtains the Google credential.
      skipNativeAuth: true,
      providers: ["google.com"],
    },
  },
};

export default config;
