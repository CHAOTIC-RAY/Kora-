import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initAndroidGestureNavigation } from "./lib/androidGestures";
import { initIosTouchGuards } from "./lib/iosPwa";
import { APP_BUILD_ID, fetchRemoteVersion, isNewerBuild } from "./lib/appVersion";

initAndroidGestureNavigation();
initIosTouchGuards();

// Register the service worker that keeps downloads alive in the background
// and shows progress notifications. Updates are detected by PwaLifecycleBanner
// which prompts (and can auto-apply) a reload — avoid blind reload loops here.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        const ping = () => {
          void reg.update().catch(() => {});
        };
        ping();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") ping();
        });
      })
      .catch((err) => {
        console.warn("[SW] registration failed:", err);
      });

    // Early version probe — if deploy landed while this tab was open/cached,
    // kick a reload before the React tree mounts deeply. Guarded against loops.
    void fetchRemoteVersion().then((remote) => {
      if (!isNewerBuild(remote)) return;
      const last = Number(sessionStorage.getItem("kora_pwa_last_reload_at") || 0);
      if (Date.now() - last < 12_000) return;
      sessionStorage.setItem("kora_pwa_last_reload_at", String(Date.now()));
      console.info("[PWA] New build detected on load", remote?.buildId, "local", APP_BUILD_ID);
      window.location.reload();
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
