/* Kora service worker
 * - Keeps book + audiobook downloads alive in the background
 * - Resumes partial downloads after the SW is killed
 * - Daily news-brief notifications via Periodic Background Sync
 */

const DB_NAME = "kora_sw_downloads";
const STORE = "files";
const PREFS_STORE = "prefs";
const SHELL_CACHE = "kora-shell-v8";
const API_CACHE = "kora-api-v8";
const COVER_CACHE = "kora-covers-v1";
// Do NOT cache sw.js / version.json — those must always hit the network so
// redeploys are detected without a manual hard refresh.
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/fonts/opendyslexic-regular.woff2",
  "/fonts/opendyslexic-bold.woff2",
];
const WARM_API_PATHS = ["/api/audiobooks/popular", "/api/nytimes/overview"];
const PERIODIC_SYNC_TAG = "kora-daily-brief";
const DOWNLOAD_SYNC_TAG = "kora-retry-downloads";
const PARTIAL_FLUSH_BYTES = 512 * 1024;

/** Active streaming downloads that can be aborted via bgf-cancel / bgf-pause */
const activeBookDownloads = new Map(); // downloadId -> { abortController, reader }
/** Ids currently being paused (keep partials, do not treat as cancel) */
const pausingDownloadIds = new Set();
/** Live progress snapshot for the grouped "Kora Downloads" notification */
const downloadProgressSnapshot = new Map(); // downloadId -> { title, percent, transferred, status }

async function warmApiCache() {
  const cache = await caches.open(API_CACHE);
  await Promise.allSettled(
    WARM_API_PATHS.map((path) =>
      fetch(path).then((res) => {
        if (res.ok) return cache.put(path, res);
      })
    )
  );
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {})),
      warmApiCache(),
    ])
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const keep = new Set([SHELL_CACHE, API_CACHE, COVER_CACHE]);
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
      // Tell open tabs a new worker is live so they can reload onto the new build.
      try {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: "SW_ACTIVATED", cache: SHELL_CACHE });
        }
      } catch (e) {}
      warmApiCache();
      await resumePartialDownloads();
    })()
  );
});

/* ---------- IndexedDB ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PREFS_STORE)) db.createObjectStore(PREFS_STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putDB(id, record) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ ...record, id });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function getDB(id) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).get(id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      })
  );
}

function delDB(id) {
  return openDB().then(
    (db) =>
      new Promise((resolve) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      })
  );
}

function getAllDB() {
  return openDB().then(
    (db) =>
      new Promise((resolve) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      })
  );
}

function putPrefs(key, value) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(PREFS_STORE, "readwrite");
        tx.objectStore(PREFS_STORE).put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function getPrefs(key) {
  return openDB().then(
    (db) =>
      new Promise((resolve) => {
        const tx = db.transaction(PREFS_STORE, "readonly");
        const req = tx.objectStore(PREFS_STORE).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
      })
  );
}

async function postToClients(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((c) => c.postMessage(msg));
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function absoluteUrl(url) {
  try {
    return new URL(url, self.location.origin).href;
  } catch (e) {
    return url;
  }
}

async function showProgressNotif(payload, percent, transferred, opts = {}) {
  if (!self.registration || !self.registration.showNotification) return;
  const downloadId = payload.downloadId || payload.jobId;
  const title = payload.title || payload.bookTitle || payload.trackTitle || "file";

  if (downloadId) {
    downloadProgressSnapshot.set(downloadId, {
      title,
      percent: percent == null ? null : Math.max(0, Math.min(100, percent)),
      transferred: transferred || "",
      status: opts.status || "downloading",
    });
  }

  await refreshGroupedDownloadNotification();
}

async function refreshGroupedDownloadNotification() {
  if (!self.registration || !self.registration.showNotification) return;

  const entries = [...downloadProgressSnapshot.entries()];
  const active = entries.filter(([, e]) => e.status === "downloading" || e.status === "paused");

  // Close any leftover per-download tags so the tray stays grouped.
  try {
    const all = await self.registration.getNotifications();
    for (const n of all) {
      const tag = n.tag || "";
      if (tag.startsWith("kora-dl-") && tag !== "kora-dl-group") {
        n.close();
      }
    }
  } catch (e) {}

  if (active.length === 0) {
    try {
      const group = await self.registration.getNotifications({ tag: "kora-dl-group" });
      group.forEach((n) => n.close());
    } catch (e) {}
    return;
  }

  const downloading = active.filter(([, e]) => e.status === "downloading");
  const paused = active.filter(([, e]) => e.status === "paused");
  const primaryId = downloading[0]?.[0] || paused[0]?.[0];
  const lines = active.slice(0, 4).map(([, e]) => {
    const pct = e.percent != null ? `${e.percent}%` : "…";
    const state = e.status === "paused" ? "paused" : pct;
    return `${e.title} — ${state}`;
  });
  if (active.length > 4) lines.push(`+${active.length - 4} more`);

  const avg =
    downloading.length > 0
      ? Math.round(
          downloading.reduce((s, [, e]) => s + (e.percent || 0), 0) / downloading.length
        )
      : null;

  let title;
  if (downloading.length && paused.length) {
    title = `Kora · ${downloading.length} downloading, ${paused.length} paused`;
  } else if (paused.length && !downloading.length) {
    title = paused.length === 1 ? `Kora · Paused “${paused[0][1].title}”` : `Kora · ${paused.length} downloads paused`;
  } else if (downloading.length === 1) {
    title = `Kora · Downloading “${downloading[0][1].title}”`;
  } else {
    title = `Kora · ${downloading.length} downloads`;
  }

  const actions = [];
  if (downloading.length) {
    actions.push({ action: "pause", title: "Pause" });
    actions.push({ action: "cancel", title: "Cancel" });
  } else if (paused.length) {
    actions.push({ action: "resume", title: "Resume" });
    actions.push({ action: "cancel", title: "Cancel" });
  }
  actions.push({ action: "open", title: "Open" });

  try {
    await self.registration.showNotification(title, {
      body: lines.join("\n"),
      tag: "kora-dl-group",
      renotify: true,
      silent: true,
      data: {
        downloadId: primaryId,
        group: true,
        downloadIds: active.map(([id]) => id),
      },
      ...(avg != null ? { progress: avg } : {}),
      actions: actions.slice(0, 2),
    });
  } catch (e) {
    /* notification may be blocked */
  }
}

async function clearDownloadFromGroup(downloadId) {
  downloadProgressSnapshot.delete(downloadId);
  await refreshGroupedDownloadNotification();
}

function chunksToBlob(chunks, type) {
  return new Blob(chunks, { type: type || "application/octet-stream" });
}

/* ---------- Resumable streaming download ---------- */
async function savePartialState(id, state) {
  await putDB(id, { id, ...state, partial: true });
}

async function resumePartialDownloads() {
  const all = await getAllDB();
  const partials = all.filter((r) => r.partial && !r.bgf && (r.payload || r.audiobook));
  for (const rec of partials) {
    if (rec.audiobook) {
      downloadAudiobookTrack(rec.audiobook, rec.received || 0, rec.chunks || [], rec.contentType || "audio/mpeg");
    } else if (rec.payload) {
      downloadBook(rec.payload, rec.received || 0, rec.chunks || [], rec.contentType || "");
    }
  }
}

async function downloadBook(payload, resumeFrom = 0, existingChunks = [], knownContentType = "") {
  const { downloadId } = payload;
  const proxyUrls = Array.isArray(payload.proxyUrls) && payload.proxyUrls.length
    ? payload.proxyUrls
    : [payload.proxyUrl];
  const partialId = "partial-" + downloadId;
  const abortController = new AbortController();
  activeBookDownloads.set(downloadId, { abortController, reader: null });

  let chunks = existingChunks.slice();
  let received = resumeFrom;
  let contentType = knownContentType || "";
  let lastError = null;
  const maxStreamRetries = 3;

  try {
    for (let urlIdx = 0; urlIdx < proxyUrls.length; urlIdx++) {
      const proxyUrl = proxyUrls[urlIdx];
      for (let attempt = 0; attempt < maxStreamRetries; attempt++) {
        if (abortController.signal.aborted) {
          throw new DOMException("Cancelled", "AbortError");
        }
        try {
          const headers = received > 0 ? { Range: `bytes=${received}-` } : {};
          const response = await fetch(absoluteUrl(proxyUrl), {
            headers,
            signal: abortController.signal,
          });
          if (!response.ok && response.status !== 206) {
            throw new Error(`Mirror unresponsive (HTTP ${response.status}).`);
          }

          // Server ignored Range and resent the whole file — restart accumulation.
          if (received > 0 && response.status === 200) {
            chunks = [];
            received = 0;
          }

          contentType = contentType || response.headers.get("content-type") || "";
          if (contentType.toLowerCase().includes("text/html")) {
            throw new Error("Mirror returned a webpage instead of a book file.");
          }

          const contentLengthHeader = response.headers.get("Content-Length");
          const contentRange = response.headers.get("Content-Range");
          let totalSize = +(contentLengthHeader || 0);
          if (contentRange) {
            const match = contentRange.match(/\/(\d+)$/);
            if (match) totalSize = +match[1];
          } else if (received > 0 && totalSize > 0) {
            totalSize = received + totalSize;
          }

          const reader = response.body.getReader();
          const active = activeBookDownloads.get(downloadId);
          if (active) active.reader = reader;
          const startTime = Date.now();
          let lastNotif = 0;
          let lastFlush = received;

          while (true) {
            if (abortController.signal.aborted) {
              try { await reader.cancel(); } catch (e) {}
              throw new DOMException("Cancelled", "AbortError");
            }
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;

            const percent = totalSize > 0 ? Math.round((received / totalSize) * 100) : null;
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? received / elapsed : 0;
            const transferred = totalSize > 0
              ? `${formatBytes(received)} of ${formatBytes(totalSize)}`
              : formatBytes(received);

            const now = Date.now();
            if (now - lastNotif > 400 || percent === 100) {
              lastNotif = now;
              await postToClients({
                type: "download-progress",
                downloadId,
                percent,
                transferred,
                speed: speed > 0 ? `${formatBytes(speed)}/s` : "",
              });
              await showProgressNotif(payload, percent, transferred);
            }

            if (received - lastFlush >= PARTIAL_FLUSH_BYTES) {
              lastFlush = received;
              await savePartialState(partialId, {
                payload: { ...payload, proxyUrl, proxyUrls },
                received,
                chunks,
                contentType,
                contentLength: totalSize,
              });
            }
          }

          const fileBlob = chunksToBlob(chunks, contentType || "application/octet-stream");
          await delDB(partialId);
          await putDB(downloadId, { id: downloadId, blob: fileBlob, payload, saved: false });
          await finishDownload(payload, fileBlob);
          return;
        } catch (err) {
          lastError = err;
          const cancelled =
            err?.name === "AbortError" ||
            /abort|cancel/i.test(String(err?.message || ""));
          if (cancelled) throw err;

          // Persist progress so a mid-stream "network error" near 99% can resume.
          if (received > 0 && chunks.length) {
            try {
              await savePartialState(partialId, {
                payload: { ...payload, proxyUrl, proxyUrls },
                received,
                chunks,
                contentType,
              });
            } catch (e) {}
          }

          const retriable = /network|fetch|Failed to fetch|Load failed|timeout|HTTP 5/i.test(
            String(err?.message || err || "")
          );
          if (retriable && attempt < maxStreamRetries - 1 && received > 0) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
          // Try next mirror URL (keep bytes if Range will work; else next attempt resets on 200).
          break;
        }
      }
    }

    throw lastError || new Error("Download failed");
  } catch (err) {
    const cancelled =
      err?.name === "AbortError" ||
      /abort|cancel/i.test(String(err?.message || ""));
    const wasPaused = pausingDownloadIds.has(downloadId);
    if (wasPaused) pausingDownloadIds.delete(downloadId);

    if (cancelled && wasPaused) {
      // Keep partial bytes so the user can resume later.
      downloadProgressSnapshot.set(downloadId, {
        title: payload.title || "book",
        percent: downloadProgressSnapshot.get(downloadId)?.percent ?? null,
        transferred: downloadProgressSnapshot.get(downloadId)?.transferred || "Paused",
        status: "paused",
      });
      await refreshGroupedDownloadNotification();
      await postToClients({ type: "download-paused", downloadId });
      return;
    }

    if (cancelled) {
      await delDB(partialId);
      await delDB(downloadId);
      await clearDownloadFromGroup(downloadId);
    }
    // Keep partials on non-cancel failures so background sync / foreground fallback can resume.
    await postToClients({
      type: "download-error",
      downloadId,
      error: cancelled ? "Cancelled" : (err.message || "Download failed"),
    });
    if (!cancelled && self.registration && self.registration.showNotification) {
      try {
        await self.registration.showNotification(`Download failed: "${payload.title}"`, {
          body: err.message || "Please try again.",
          tag: "kora-dl-group",
          data: { downloadId, error: true, group: true },
          actions: [{ action: "retry", title: "Retry" }],
        });
      } catch (e) {}
    }
    if (!cancelled) {
      try {
        if (self.registration && self.registration.sync) {
          await self.registration.sync.register(DOWNLOAD_SYNC_TAG);
        }
      } catch (e) {}
    }
  } finally {
    activeBookDownloads.delete(downloadId);
  }
}

async function finishDownload(payload, fileBlob) {
  await clearDownloadFromGroup(payload.downloadId);
  await postToClients({
    type: "download-complete",
    downloadId: payload.downloadId,
    title: payload.title,
    size: formatBytes(fileBlob.size),
  });
  if (self.registration && self.registration.showNotification) {
    try {
      await self.registration.showNotification(`"${payload.title}" downloaded`, {
        body: "Ready in your library.",
        tag: "kora-dl-done-" + payload.downloadId,
        silent: false,
        data: { downloadId: payload.downloadId, done: true },
        actions: [{ action: "open", title: "Open" }],
      });
      setTimeout(() => {
        self.registration.getNotifications({ tag: "kora-dl-done-" + payload.downloadId }).then((ns) => ns.forEach((n) => n.close()));
      }, 4000);
    } catch (e) {}
  }
}

async function finishAudiobookDownload(payload, fileBlob) {
  await postToClients({
    type: "audiobook-track-complete",
    jobId: payload.jobId,
    bookId: payload.bookId,
    bookTitle: payload.bookTitle,
    trackIndex: payload.trackIndex,
    trackTitle: payload.trackTitle,
    size: formatBytes(fileBlob.size),
  });
}

async function downloadAudiobookTrack(payload, resumeFrom = 0, existingChunks = [], knownContentType = "audio/mpeg") {
  const partialId = "partial-ab-" + payload.jobId;
  try {
    const headers = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {};
    const response = await fetch(absoluteUrl(payload.proxyUrl), { headers });
    if (!response.ok && response.status !== 206) throw new Error(`Track download failed (HTTP ${response.status}).`);

    const contentType = knownContentType || response.headers.get("content-type") || "audio/mpeg";
    const contentLengthHeader = response.headers.get("Content-Length");
    const contentRange = response.headers.get("Content-Range");
    let totalSize = +(contentLengthHeader || 0);
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match) totalSize = +match[1];
    }

    const reader = response.body.getReader();
    const chunks = existingChunks.slice();
    let received = resumeFrom;
    let lastNotif = 0;
    let lastFlush = received;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      const percent = totalSize > 0 ? Math.round((received / totalSize) * 100) : null;
      const transferred = totalSize > 0
        ? `${formatBytes(received)} of ${formatBytes(totalSize)}`
        : formatBytes(received);

      const now = Date.now();
      if (now - lastNotif > 500) {
        lastNotif = now;
        await postToClients({
          type: "audiobook-track-progress",
          jobId: payload.jobId,
          bookId: payload.bookId,
          percent,
          transferred,
        });
        await showProgressNotif(payload, percent, transferred, {
          title: `Downloading "${payload.bookTitle}"`,
        });
      }

      if (received - lastFlush >= PARTIAL_FLUSH_BYTES) {
        lastFlush = received;
        await savePartialState(partialId, {
          audiobook: payload,
          received,
          chunks,
          contentType,
          contentLength: totalSize,
        });
      }
    }

    const fileBlob = chunksToBlob(chunks, contentType);
    await delDB(partialId);
    await putDB(payload.jobId, { id: payload.jobId, blob: fileBlob, audiobook: payload, saved: false });
    await finishAudiobookDownload(payload, fileBlob);
  } catch (err) {
    await postToClients({
      type: "audiobook-track-error",
      jobId: payload.jobId,
      bookId: payload.bookId,
      error: err.message || "Download failed",
    });
    try {
      if (self.registration && self.registration.sync) {
        await self.registration.sync.register(DOWNLOAD_SYNC_TAG);
      }
    } catch (e) {}
  }
}

/* ---------- Background Fetch ---------- */
async function downloadBookBGF(payload) {
  const bgfId = "kora-bgf-" + payload.downloadId;
  const proxyUrl = absoluteUrl(payload.proxyUrl);
  try {
    await putDB(bgfId, { id: bgfId, payload: { ...payload, proxyUrl }, proxyUrl, saved: false, bgf: true });
    const bgf = await self.registration.backgroundFetch.fetch(bgfId, [proxyUrl], {
      title: `Downloading "${payload.title}"`,
      downloadTotal: 0,
      icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    });
    await postToClients({
      type: "download-progress",
      downloadId: payload.downloadId,
      percent: null,
      transferred: "downloading in background…",
      speed: "",
    });
    if (bgf && bgf.failureReason && bgf.failureReason !== "aborted") {
      throw new Error("Background fetch rejected: " + bgf.failureReason);
    }
  } catch (err) {
    console.warn("[SW] Background Fetch failed, falling back to streaming:", err);
    await delDB(bgfId);
    await downloadBook({ ...payload, proxyUrl });
  }
}

/* ---------- Daily news brief ---------- */
function isNewsBriefItem(item) {
  const haystack = `${item.title || ""} ${item.link || ""} ${item.summary || ""}`.toLowerCase();
  if (item.category && /brief|roundup|digest/i.test(item.category)) return true;
  if (/\/news-in-brief\//i.test(item.link || "")) return true;
  if (/news[-\s]?in[-\s]?brief/i.test(haystack)) return true;
  if (/\b(daily|evening)\s+(brief|roundup|digest)\b/i.test(haystack)) return true;
  if (/\bnews roundup\b/i.test(haystack)) return true;
  return false;
}

async function fetchFeedBriefs(subscriptions) {
  const briefs = [];
  const syntheticBySourceDay = new Map();

  for (const sub of subscriptions || []) {
    try {
      const res = await fetch("/api/feed/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedUrl: sub.feedUrl }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const item of data.items || []) {
        if (isNewsBriefItem(item)) {
          briefs.push({
            title: item.title,
            source: sub.title,
            link: item.link,
            publishedAt: item.publishedAt || Date.now(),
          });
          continue;
        }

        const d = new Date(item.publishedAt || Date.now());
        const dayKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        const groupKey = `${sub.id}:${dayKey}`;
        const list = syntheticBySourceDay.get(groupKey) || [];
        list.push({
          title: item.title,
          source: sub.title,
          link: item.link,
          publishedAt: item.publishedAt || Date.now(),
        });
        syntheticBySourceDay.set(groupKey, list);
      }
    } catch (e) {
      /* try next feed */
    }
  }

  for (const [, articles] of syntheticBySourceDay) {
    if (articles.length < 2) continue;
    articles.sort((a, b) => b.publishedAt - a.publishedAt);
    const top = articles[0];
    briefs.push({
      title: `Daily Brief — ${top.source}`,
      source: top.source,
      link: top.link,
      publishedAt: top.publishedAt,
    });
  }

  briefs.sort((a, b) => b.publishedAt - a.publishedAt);
  return briefs;
}

async function maybeShowDailyBriefNotification(force = false) {
  const prefs = (await getPrefs("app")) || {};
  if (!prefs.dailyNewsBrief) return;

  const today = new Date().toDateString();
  if (!force && prefs.lastBriefNotified === today) return;

  const briefs = await fetchFeedBriefs(prefs.subscriptions || []);
  if (!briefs.length) return;

  const headlines = briefs.slice(0, 3).map((b) => `• ${b.source}: ${b.title}`).join("\n");
  if (self.registration && self.registration.showNotification) {
    await self.registration.showNotification("Your daily news brief", {
      body: headlines,
      tag: "kora-daily-brief",
      data: { brief: true },
      actions: [{ action: "open-feed", title: "Read briefs" }],
    });
    await putPrefs("app", { ...prefs, lastBriefNotified: today });
    await postToClients({ type: "brief-notification-shown", date: today });
  }
}

/* ---------- Message handling ---------- */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "skip-waiting" || data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "sync-prefs") {
    event.waitUntil(putPrefs("app", data.prefs || {}));
    return;
  }
  if (data.type === "check-daily-brief") {
    event.waitUntil(maybeShowDailyBriefNotification(true));
    return;
  }
  if (data.type === "download-book") {
    // ACK immediately so the page knows the SW is alive (prevents stuck 0% UI).
    try {
      const port = event.ports && event.ports[0];
      if (port) {
        port.postMessage({
          type: "download-accepted",
          downloadId: data.payload && data.payload.downloadId,
        });
      }
    } catch (e) {}
    // Use streaming download — Background Fetch often registers then never
    // reports progress on desktop / flaky SW updates, leaving UI at 0%.
    event.waitUntil(
      (async () => {
        await postToClients({
          type: "download-progress",
          downloadId: data.payload.downloadId,
          percent: 0,
          transferred: "Starting…",
          speed: "",
        });
        await downloadBook(data.payload);
      })()
    );
  } else if (data.type === "download-audiobook-track") {
    event.waitUntil(downloadAudiobookTrack(data.payload));
  } else if (data.type === "pickup-complete") {
    event.waitUntil(delDB(data.downloadId || data.jobId));
  } else if (data.type === "bgf-cancel") {
    event.waitUntil((async () => {
      pausingDownloadIds.delete(data.downloadId);
      try {
        await self.registration.backgroundFetch.get("kora-bgf-" + data.downloadId)?.abort();
      } catch (e) {}
      const active = activeBookDownloads.get(data.downloadId);
      if (active) {
        try { active.abortController.abort(); } catch (e) {}
        try { await active.reader?.cancel(); } catch (e) {}
        activeBookDownloads.delete(data.downloadId);
      }
      await delDB("kora-bgf-" + data.downloadId);
      await delDB(data.downloadId);
      await delDB("partial-" + data.downloadId);
      await clearDownloadFromGroup(data.downloadId);
      await postToClients({ type: "download-error", downloadId: data.downloadId, error: "Cancelled" });
    })());
  } else if (data.type === "bgf-pause") {
    event.waitUntil((async () => {
      if (!data.downloadId) return;
      pausingDownloadIds.add(data.downloadId);
      const active = activeBookDownloads.get(data.downloadId);
      if (active) {
        try { active.abortController.abort(); } catch (e) {}
        try { await active.reader?.cancel(); } catch (e) {}
      } else {
        // Already idle — mark paused from snapshot if present
        const snap = downloadProgressSnapshot.get(data.downloadId);
        if (snap) {
          downloadProgressSnapshot.set(data.downloadId, { ...snap, status: "paused" });
          await refreshGroupedDownloadNotification();
          await postToClients({ type: "download-paused", downloadId: data.downloadId });
        }
      }
    })());
  } else if (data.type === "bgf-resume") {
    event.waitUntil((async () => {
      if (!data.downloadId) return;
      pausingDownloadIds.delete(data.downloadId);
      if (activeBookDownloads.has(data.downloadId)) return;
      const partial = await getDB("partial-" + data.downloadId);
      if (partial?.payload) {
        downloadProgressSnapshot.set(data.downloadId, {
          title: partial.payload.title || "book",
          percent: downloadProgressSnapshot.get(data.downloadId)?.percent ?? null,
          transferred: "Resuming…",
          status: "downloading",
        });
        await refreshGroupedDownloadNotification();
        await postToClients({ type: "download-progress", downloadId: data.downloadId, percent: downloadProgressSnapshot.get(data.downloadId)?.percent ?? 0, transferred: "Resuming…", speed: "" });
        await downloadBook(partial.payload, partial.received || 0, partial.chunks || [], partial.contentType || "");
        return;
      }
      // Fall back to client retry if no partial exists
      await postToClients({ type: "bgf-retry", downloadId: data.downloadId });
    })());
  } else if (data.type === "sw-ready") {
    event.waitUntil(postToClients({ type: "sw-ready-ack" }));
  }
});

/* ---------- Background Fetch lifecycle ---------- */
self.addEventListener("backgroundfetchsuccess", (event) => {
  event.waitUntil(
    (async () => {
      const bgfId = event.registration.id;
      const rec = await getDB(bgfId);
      if (!rec) return;
      try {
        const proxyUrl = rec.proxyUrl || rec.payload?.proxyUrl;
        const match = proxyUrl ? await event.registration.match(proxyUrl) : null;
        const response = match || (await event.registration.matchAll())[0];
        if (!response || !response.response) throw new Error("No downloaded response");
        const blob = await response.response.blob();
        if (blob.size === 0) throw new Error("Empty file");
        await putDB(rec.payload.downloadId, { id: rec.payload.downloadId, blob, payload: rec.payload, saved: false });
        await delDB(bgfId);
        await finishDownload(rec.payload, blob);
      } catch (err) {
        await delDB(bgfId);
        await postToClients({ type: "download-error", downloadId: rec.payload.downloadId, error: err.message });
      }
    })()
  );
});

self.addEventListener("backgroundfetchfail", (event) => {
  event.waitUntil(
    (async () => {
      const rec = await getDB(event.registration.id);
      await delDB(event.registration.id);
      if (rec && rec.payload) {
        await downloadBook(rec.payload);
      } else if (rec) {
        await postToClients({ type: "download-error", downloadId: rec.payload?.downloadId, error: "Download failed" });
      }
    })()
  );
});

self.addEventListener("backgroundfetchabort", (event) => {
  event.waitUntil(
    (async () => {
      const rec = await getDB(event.registration.id);
      await delDB(event.registration.id);
      if (rec && rec.payload) {
        await postToClients({ type: "download-error", downloadId: rec.payload.downloadId, error: "Cancelled" });
      }
    })()
  );
});

self.addEventListener("backgroundfetchclick", (event) => {
  event.waitUntil(
    (async () => {
      const rec = await getDB(event.registration.id);
      const dlId = rec ? rec.payload.downloadId : null;
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (clients[0]) {
        clients[0].focus();
        if (dlId) clients[0].postMessage({ type: "open-downloads", downloadId: dlId });
      } else {
        await self.clients.openWindow("/");
      }
    })()
  );
});

/* ---------- Periodic sync + background sync ---------- */
self.addEventListener("periodicsync", (event) => {
  if (event.tag === PERIODIC_SYNC_TAG) {
    event.waitUntil(maybeShowDailyBriefNotification());
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === DOWNLOAD_SYNC_TAG) {
    event.waitUntil(resumePartialDownloads());
  }
});

/* ---------- Notification clicks ---------- */
self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const action = event.action;
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const focus = () => (clients[0] ? clients[0].focus() : self.clients.openWindow("/"));
      const targetIds = Array.isArray(data.downloadIds) && data.downloadIds.length
        ? data.downloadIds
        : data.downloadId
          ? [data.downloadId]
          : [];

      if (action === "pause") {
        for (const id of targetIds) {
          pausingDownloadIds.add(id);
          const active = activeBookDownloads.get(id);
          if (active) {
            try { active.abortController.abort(); } catch (e) {}
            try { await active.reader?.cancel(); } catch (e) {}
          }
        }
        return;
      }
      if (action === "resume") {
        for (const id of targetIds) {
          pausingDownloadIds.delete(id);
          if (activeBookDownloads.has(id)) continue;
          const partial = await getDB("partial-" + id);
          if (partial?.payload) {
            downloadProgressSnapshot.set(id, {
              title: partial.payload.title || "book",
              percent: downloadProgressSnapshot.get(id)?.percent ?? null,
              transferred: "Resuming…",
              status: "downloading",
            });
            await postToClients({ type: "download-progress", downloadId: id, percent: downloadProgressSnapshot.get(id)?.percent ?? 0, transferred: "Resuming…", speed: "" });
            // Fire without awaiting so multiple can resume
            downloadBook(partial.payload, partial.received || 0, partial.chunks || [], partial.contentType || "");
          } else {
            await postToClients({ type: "bgf-retry", downloadId: id });
          }
        }
        await refreshGroupedDownloadNotification();
        await focus();
        return;
      }
      if (action === "cancel") {
        for (const id of targetIds) {
          pausingDownloadIds.delete(id);
          await postToClients({ type: "bgf-cancel", downloadId: id });
          try { await self.registration.backgroundFetch.get("kora-bgf-" + id)?.abort(); } catch (e) {}
          const active = activeBookDownloads.get(id);
          if (active) {
            try { active.abortController.abort(); } catch (e) {}
            try { await active.reader?.cancel(); } catch (e) {}
            activeBookDownloads.delete(id);
          }
          await delDB("kora-bgf-" + id);
          await delDB(id);
          await delDB("partial-" + id);
          await clearDownloadFromGroup(id);
        }
        return;
      }
      if (action === "retry" && data.downloadId) {
        await postToClients({ type: "bgf-retry", downloadId: data.downloadId });
        await focus();
        return;
      }
      if (action === "open-feed" || data.brief) {
        if (clients[0]) {
          clients[0].focus();
          clients[0].postMessage({ type: "open-feed-briefs" });
        } else {
          await self.clients.openWindow("/?tab=feed&briefs=1");
        }
        return;
      }
      if (data.downloadId || data.group) await postToClients({ type: "open-downloads", downloadId: data.downloadId });
      await focus();
    })()
  );
});

/* ---------- Fetch handling ---------- */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Always bypass the SW for update probes and the worker script itself.
  if (
    url.pathname === "/sw.js" ||
    url.pathname === "/version.json" ||
    url.pathname.startsWith("/version.json")
  ) {
    return;
  }

  if (url.pathname === "/__kora_sw_pickup__") {
    const id = url.searchParams.get("id");
    event.respondWith(
      (async () => {
        if (!id) return new Response("missing id", { status: 400 });
        // Brief retry — blob may still be committing to IndexedDB.
        for (let attempt = 0; attempt < 5; attempt++) {
          const rec = await getDB(id);
          if (rec?.blob) {
            return new Response(rec.blob, {
              headers: { "Content-Type": rec.blob.type || "application/octet-stream" },
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
        }
        return new Response("not found", { status: 404 });
      })()
    );
    return;
  }

  if (url.pathname === "/__kora_sw_list__") {
    event.respondWith(
      openDB().then(
        (db) =>
          new Promise((resolve) => {
            const tx = db.transaction(STORE, "readonly");
            const req = tx.objectStore(STORE).getAll();
            req.onsuccess = () =>
              resolve(
                new Response(
                  JSON.stringify(
                    req.result
                      .filter((r) => !r.bgf && !r.partial && !r.audiobook && r.blob)
                      .map((r) => r.id)
                  ),
                  {
                  headers: { "Content-Type": "application/json" },
                  }
                )
              );
            req.onerror = () => resolve(new Response("[]", { headers: { "Content-Type": "application/json" } }));
          })
      )
    );
    return;
  }

  if (event.request.method === "GET" && WARM_API_PATHS.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);
        const cached = await cache.match(event.request);
        const network = fetch(event.request)
          .then((res) => {
            if (res && res.ok) cache.put(event.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })()
    );
    return;
  }

  if (url.pathname.startsWith("/api/proxy-image")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(COVER_CACHE);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const res = await fetch(event.request);
          if (res && res.ok) cache.put(event.request, res.clone());
          return res;
        } catch (e) {
          return cached || new Response("", { status: 504 });
        }
      })()
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first so redeploys show up without a hard refresh.
  if (event.request.method === "GET" && event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const res = await fetch(event.request);
          if (res && res.status === 200) {
            cache.put("/index.html", res.clone());
            cache.put("/", res.clone());
          }
          return res;
        } catch (e) {
          return (
            (await cache.match(event.request)) ||
            (await cache.match("/index.html")) ||
            (await cache.match("/")) ||
            new Response("Offline", { status: 503, statusText: "Offline" })
          );
        }
      })()
    );
    return;
  }

  // Hashed /assets/* are immutable — cache-first is safe.
  // Other shell assets: network-first with cache fallback.
  if (
    event.request.method === "GET" &&
    (url.pathname.startsWith("/assets/") || SHELL_ASSETS.includes(url.pathname))
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(event.request);

        if (url.pathname.startsWith("/assets/") && cached) {
          return cached;
        }

        try {
          const res = await fetch(event.request);
          if (res && res.status === 200) {
            cache.put(event.request, res.clone());
          }
          return res;
        } catch (e) {
          return cached || new Response("", { status: 504 });
        }
      })()
    );
  }
});
