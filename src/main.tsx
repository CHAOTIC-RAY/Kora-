import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initAndroidGestureNavigation } from "./lib/androidGestures";

initAndroidGestureNavigation();

// Register the service worker that keeps downloads alive in the background
// and shows progress notifications (fixes "download fails after exiting app").
// No auto-reload on activate — that caused infinite reload loops on workers.dev.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[SW] registration failed:", err);
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
