/** Debounced / selective persistence for the downloads log (avoid stringify every progress tick). */

const LOG_KEY = "kora_downloads_log";
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingList: unknown[] | null = null;

export function persistDownloadsLogNow(list: unknown[]): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  pendingList = null;
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
}

export function schedulePersistDownloadsLog(list: unknown[], delayMs = 1500): void {
  pendingList = list;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (pendingList) {
      try {
        localStorage.setItem(LOG_KEY, JSON.stringify(pendingList));
      } catch {
        /* quota */
      }
      pendingList = null;
    }
  }, delayMs);
}

export function loadDownloadsLog(): any[] {
  try {
    const saved = localStorage.getItem(LOG_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}
