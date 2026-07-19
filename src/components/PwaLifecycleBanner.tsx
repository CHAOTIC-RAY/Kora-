import React, { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { APP_BUILD_ID, fetchRemoteVersion, isNewerBuild } from "../lib/appVersion";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_DISMISS_KEY = "kora_pwa_install_dismissed_at";
const UPDATE_DISMISS_KEY = "kora_pwa_update_snooze_until";
const RELOAD_GUARD_KEY = "kora_pwa_last_reload_at";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function safeReload(reason: string) {
  const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
  if (Date.now() - last < 12_000) {
    console.info("[PWA] Skipping reload (guard):", reason);
    return;
  }
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  console.info("[PWA] Reloading for update:", reason, "build", APP_BUILD_ID);
  window.location.reload();
}

export default function PwaLifecycleBanner() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [showUpdate, setShowUpdate] = useState(false);
  const [updateReason, setUpdateReason] = useState<string>("A newer version of Kora is ready.");
  const refreshingRef = useRef(false);
  const updateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isStandalone()) return;

    const dismissedAt = Number(localStorage.getItem(INSTALL_DISMISS_KEY) || 0);
    const coolDownMs = 7 * 24 * 60 * 60 * 1000;

    const onBip = (e: Event) => {
      e.preventDefault();
      const evt = e as BeforeInstallPromptEvent;
      setInstallEvent(evt);
      if (!dismissedAt || Date.now() - dismissedAt > coolDownMs) {
        setShowInstall(true);
      }
    };

    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let pollInterval = 0;
    let updateInterval = 0;

    const markUpdate = (worker: ServiceWorker | null, reason: string) => {
      if (cancelled) return;
      const snoozeUntil = Number(localStorage.getItem(UPDATE_DISMISS_KEY) || 0);
      if (Date.now() < snoozeUntil) return;
      setWaitingWorker(worker);
      setUpdateReason(reason);
      setShowUpdate(true);
    };

    const checkWaiting = async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (cancelled || !reg) return;
      if (reg.waiting) {
        markUpdate(reg.waiting, "A newer version of Kora is ready. Reload to apply it.");
      }
    };

    const checkRemoteVersion = async () => {
      const remote = await fetchRemoteVersion();
      if (cancelled || !isNewerBuild(remote)) return;
      markUpdate(
        (await navigator.serviceWorker.getRegistration())?.waiting || null,
        "A new deploy is available. Reload to get the latest Kora."
      );
    };

    const onControllerChange = () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      safeReload("controllerchange");
    };

    const onSwMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (type === "SW_ACTIVATED") {
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        safeReload("SW_ACTIVATED");
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker.addEventListener("message", onSwMessage);

    void checkWaiting();
    void checkRemoteVersion();

    navigator.serviceWorker.ready.then((reg) => {
      if (cancelled) return;

      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            markUpdate(reg.waiting || worker, "A newer version of Kora is ready. Reload to apply it.");
          }
        });
      });

      // Ask the browser to fetch a fresh sw.js periodically.
      updateInterval = window.setInterval(() => {
        void reg.update().then(() => checkWaiting()).catch(() => {});
      }, 60 * 1000);
    });

    // Poll version.json so asset-only deploys (unchanged sw.js logic) still notify.
    pollInterval = window.setInterval(() => {
      void checkRemoteVersion();
    }, 45 * 1000);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void navigator.serviceWorker.getRegistration().then((reg) =>
        reg?.update().then(() => checkWaiting()).catch(() => {})
      );
      void checkRemoteVersion();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      navigator.serviceWorker.removeEventListener("message", onSwMessage);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (pollInterval) window.clearInterval(pollInterval);
      if (updateInterval) window.clearInterval(updateInterval);
    };
  }, []);

  // Auto-apply shortly after detection so installed PWAs refresh themselves.
  useEffect(() => {
    if (!showUpdate) return;
    if (updateTimerRef.current) window.clearTimeout(updateTimerRef.current);
    updateTimerRef.current = window.setTimeout(() => {
      applyUpdate(true);
    }, 1800);
    return () => {
      if (updateTimerRef.current) window.clearTimeout(updateTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUpdate, waitingWorker]);

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setShowInstall(false);
    setInstallEvent(null);
  };

  const dismissInstall = () => {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    setShowInstall(false);
  };

  const applyUpdate = (fromAuto = false) => {
    if (updateTimerRef.current) {
      window.clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    localStorage.removeItem(UPDATE_DISMISS_KEY);
    const worker = waitingWorker;
    if (worker) {
      try {
        worker.postMessage({ type: "SKIP_WAITING" });
        worker.postMessage({ type: "skip-waiting" });
      } catch {
        /* ignore */
      }
      // Fallback reload if controllerchange is slow
      window.setTimeout(() => safeReload(fromAuto ? "auto-skipWaiting" : "manual-skipWaiting"), 900);
      return;
    }
    // Version mismatch without a waiting worker — hard reload is enough
    // (network-first navigation + cache bust will pull the new shell).
    safeReload(fromAuto ? "auto-version" : "manual-version");
  };

  const snoozeUpdate = () => {
    if (updateTimerRef.current) {
      window.clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    localStorage.setItem(UPDATE_DISMISS_KEY, String(Date.now() + 4 * 60 * 60 * 1000));
    setShowUpdate(false);
  };

  if (!showInstall && !showUpdate) return null;

  return (
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-3 right-3 z-[90] flex flex-col gap-2 pointer-events-none md:left-auto md:right-6 md:w-[360px]">
      {showUpdate && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto rounded-2xl border border-kindle-border bg-kindle-card text-kindle-text shadow-xl p-3.5 flex items-start gap-3"
        >
          <RefreshCw className="w-5 h-5 text-kindle-accent shrink-0 mt-0.5 animate-spin" aria-hidden style={{ animationDuration: "2.4s" }} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Update available</p>
            <p className="text-[11px] text-kindle-text-muted mt-0.5 leading-relaxed">
              {updateReason} Reloading automatically…
            </p>
            <div className="flex gap-2 mt-2.5">
              <button
                type="button"
                onClick={() => applyUpdate(false)}
                className="px-3 py-1.5 rounded-lg bg-kindle-accent text-white text-[11px] font-bold uppercase tracking-wider"
              >
                Update now
              </button>
              <button
                type="button"
                onClick={snoozeUpdate}
                className="px-3 py-1.5 rounded-lg border border-kindle-border text-[11px] font-semibold"
              >
                Later
              </button>
            </div>
          </div>
          <button type="button" onClick={snoozeUpdate} className="p-1 rounded-lg hover:bg-black/5" aria-label="Dismiss update">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {showInstall && (
        <div
          role="dialog"
          aria-label="Install Kora"
          className="pointer-events-auto rounded-2xl border border-kindle-border bg-kindle-card text-kindle-text shadow-xl p-3.5 flex items-start gap-3"
        >
          <Download className="w-5 h-5 text-kindle-accent shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Install Kora</p>
            <p className="text-[11px] text-kindle-text-muted mt-0.5 leading-relaxed">
              Add to your home screen for offline reading and a full-screen experience.
            </p>
            <div className="flex gap-2 mt-2.5">
              <button
                type="button"
                onClick={handleInstall}
                className="px-3 py-1.5 rounded-lg bg-kindle-accent text-white text-[11px] font-bold uppercase tracking-wider"
              >
                Install
              </button>
              <button
                type="button"
                onClick={dismissInstall}
                className="px-3 py-1.5 rounded-lg border border-kindle-border text-[11px] font-semibold"
              >
                Not now
              </button>
            </div>
          </div>
          <button type="button" onClick={dismissInstall} className="p-1 rounded-lg hover:bg-black/5" aria-label="Dismiss install prompt">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
