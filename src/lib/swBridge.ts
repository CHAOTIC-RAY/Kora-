import { getFeedSubscriptions } from "./feedStorage";

const PREFS_SYNC_KEY = "kora_sw_prefs";
const NEWS_BRIEF_KEY = "kora_daily_news_brief";
const PERIODIC_SYNC_TAG = "kora-daily-brief";
const DOWNLOAD_SYNC_TAG = "kora-retry-downloads";

export function isDailyNewsBriefEnabled(): boolean {
  return localStorage.getItem(NEWS_BRIEF_KEY) === "true";
}

export function setDailyNewsBriefEnabled(enabled: boolean) {
  localStorage.setItem(NEWS_BRIEF_KEY, String(enabled));
}

export async function ensureServiceWorkerReady(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    if (!navigator.serviceWorker.controller) {
      const waiting = registration.waiting;
      const installing = registration.installing;
      if (waiting) {
        waiting.postMessage({ type: "skip-waiting" });
      } else if (installing) {
        await new Promise<void>((resolve) => {
          installing.addEventListener("statechange", () => {
            if (installing.state === "activated") resolve();
          });
        });
      }
      if (!navigator.serviceWorker.controller && registration.active) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    return registration;
  } catch (error) {
    console.warn("[SW] ensureServiceWorkerReady failed:", error);
    return null;
  }
}

export async function syncServiceWorkerPrefs(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await ensureServiceWorkerReady();
  const controller = navigator.serviceWorker.controller || registration?.active;
  if (!controller) return;

  const subscriptions = getFeedSubscriptions().map((sub) => ({
    id: sub.id,
    title: sub.title,
    feedUrl: sub.feedUrl,
  }));

  controller.postMessage({
    type: "sync-prefs",
    prefs: {
      dailyNewsBrief: isDailyNewsBriefEnabled(),
      subscriptions,
      lastBriefNotified: localStorage.getItem("kora_last_brief_notification") || "",
    },
  });
}

export async function registerBackgroundCapabilities(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await ensureServiceWorkerReady();
  if (!registration) return;

  if (isDailyNewsBriefEnabled()) {
    if ("Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // ignore
      }
    }

    if ("periodicSync" in registration) {
      try {
        await (registration as ServiceWorkerRegistration & {
          periodicSync: { register: (tag: string, options: { minInterval: number }) => Promise<void> };
        }).periodicSync.register(PERIODIC_SYNC_TAG, {
          minInterval: 24 * 60 * 60 * 1000,
        });
      } catch (error) {
        console.warn("[SW] periodicSync registration failed:", error);
      }
    }
  }

  if ("sync" in registration) {
    try {
      await (registration as ServiceWorkerRegistration & {
        sync: { register: (tag: string) => Promise<void> };
      }).sync.register(DOWNLOAD_SYNC_TAG);
    } catch {
      // Background Sync may be unavailable
    }
  }
}

export async function handoffBookDownload(payload: {
  downloadId: string;
  title: string;
  author: string;
  coverUrl: string;
  md5?: string;
  fileExtension: string;
  proxyUrl: string;
}): Promise<boolean> {
  const registration = await ensureServiceWorkerReady();
  const controller = navigator.serviceWorker.controller || registration?.active;
  if (!controller) return false;

  const absoluteProxyUrl = payload.proxyUrl.startsWith("http")
    ? payload.proxyUrl
    : `${window.location.origin}${payload.proxyUrl}`;

  controller.postMessage({
    type: "download-book",
    payload: {
      ...payload,
      proxyUrl: absoluteProxyUrl,
    },
  });
  return true;
}

export async function handoffAudiobookTrackDownload(payload: {
  jobId: string;
  bookId: string;
  bookTitle: string;
  trackIndex: number;
  trackTitle: string;
  proxyUrl: string;
}): Promise<boolean> {
  const registration = await ensureServiceWorkerReady();
  const controller = navigator.serviceWorker.controller || registration?.active;
  if (!controller) return false;

  const absoluteProxyUrl = payload.proxyUrl.startsWith("http")
    ? payload.proxyUrl
    : `${window.location.origin}${payload.proxyUrl}`;

  controller.postMessage({
    type: "download-audiobook-track",
    payload: {
      ...payload,
      proxyUrl: absoluteProxyUrl,
    },
  });
  return true;
}

export function markBriefNotificationShown() {
  localStorage.setItem("kora_last_brief_notification", new Date().toDateString());
}
