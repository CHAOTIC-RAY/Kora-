import React, { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_DISMISS_KEY = "kora_pwa_install_dismissed_at";
const UPDATE_DISMISS_KEY = "kora_pwa_update_snooze_until";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export default function PwaLifecycleBanner() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [showUpdate, setShowUpdate] = useState(false);

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
    let refreshing = false;

    const checkWaiting = async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (cancelled || !reg) return;
      if (reg.waiting) {
        const snoozeUntil = Number(localStorage.getItem(UPDATE_DISMISS_KEY) || 0);
        if (Date.now() > snoozeUntil) {
          setWaitingWorker(reg.waiting);
          setShowUpdate(true);
        }
      }
    };

    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void checkWaiting();
    navigator.serviceWorker.ready.then((reg) => {
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            setWaitingWorker(reg.waiting || worker);
            setShowUpdate(true);
          }
        });
      });
      // Periodic update checks
      const interval = window.setInterval(() => {
        void reg.update().then(() => checkWaiting());
      }, 5 * 60 * 1000);
      return () => window.clearInterval(interval);
    });

    // Check on focus / visibility
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void navigator.serviceWorker.getRegistration().then((reg) => reg?.update().then(() => checkWaiting()));
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Auto-apply shortly after detection so the PWA refreshes itself.
  useEffect(() => {
    if (!showUpdate || !waitingWorker) return;
    const t = window.setTimeout(() => {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    }, 2500);
    return () => window.clearTimeout(t);
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

  const applyUpdate = () => {
    const worker = waitingWorker;
    if (!worker) {
      window.location.reload();
      return;
    }
    worker.postMessage({ type: "SKIP_WAITING" });
    // Fallback reload if controllerchange is slow
    setTimeout(() => window.location.reload(), 800);
  };

  const snoozeUpdate = () => {
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
          <RefreshCw className="w-5 h-5 text-kindle-accent shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Update available</p>
            <p className="text-[11px] text-kindle-text-muted mt-0.5 leading-relaxed">
              A newer version of Kora is ready. Reload to apply it.
            </p>
            <div className="flex gap-2 mt-2.5">
              <button
                type="button"
                onClick={applyUpdate}
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
