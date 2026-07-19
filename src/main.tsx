import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initAndroidGestureNavigation } from "./lib/androidGestures";

initAndroidGestureNavigation();

// Register the service worker that keeps downloads alive in the background
// and shows progress notifications. Updates are detected by PwaLifecycleBanner
// which prompts (and can auto-apply) a reload — avoid blind reload loops here.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      // Check for updates on load and when the tab becomes visible again
      const ping = () => {
        void reg.update().catch(() => {});
      };
      ping();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") ping();
      });
    }).catch((err) => {
      console.warn("[SW] registration failed:", err);
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
