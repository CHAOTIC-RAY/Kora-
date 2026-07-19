/* Kora service worker
 * - Keeps book + audiobook downloads alive in the background
 * - Resumes partial downloads after the SW is killed
 * - Daily news-brief notifications via Periodic Background Sync
 */

const DB_NAME = "kora_sw_downloads";
const STORE = "files";
const PREFS_STORE = "prefs";
const SHELL_CACHE = "kora-shell-v1";
const API_CACHE = "kora-api-v1";
const SHELL_ASSETS = ["/", "/index.html", "/manifest.json", "/sw.js", "/favicon.svg"];
const WARM_API_PATHS = ["/api/audiobooks/popular", "/api/nytimes/overview"];
const PERIODIC_SYNC_TAG = "kora-daily-brief";
const DOWNLOAD_SYNC_TAG = "kora-retry-downloads";
const PARTIAL_FLUSH_BYTES = 512 * 1024;

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
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
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
  const title = opts.title || `Downloading "${payload.title || payload.trackTitle || "file"}"`;
  const body = percent == null ? transferred : `${percent}%  •  ${transferred}`;
  const downloadId = payload.downloadId || payload.jobId;
  try {
    await self.registration.showNotification(title, {
      body,
      tag: "kora-dl-" + downloadId,
      silent: true,
      data: { downloadId, jobId: payload.jobId },
      ...(percent != null ? { progress: Math.max(0, Math.min(100, percent)) } : {}),
      actions: [
        { action: "open", title: "Open" },
        { action: "cancel", title: "Cancel" },
      ],
      ...opts.extra,
    });
  } catch (e) {
    /* notification may be blocked */
  }
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
  const { downloadId, proxyUrl } = payload;
  const partialId = "partial-" + downloadId;
  try {
    const headers = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {};
    const response = await fetch(absoluteUrl(proxyUrl), { headers });
    if (!response.ok && response.status !== 206) throw new Error(`Mirror unresponsive (HTTP ${response.status}).`);

    const contentType = knownContentType || response.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("text/html"))
      throw new Error("Mirror returned a webpage instead of a book file.");

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
    const startTime = Date.now();
    let lastNotif = 0;
    let lastFlush = received;

    while (true) {
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
        await postToClients({ type: "download-progress", downloadId, percent, transferred, speed: speed > 0 ? `${formatBytes(speed)}/s` : "" });
        await showProgressNotif(payload, percent, transferred);
      }

      if (received - lastFlush >= PARTIAL_FLUSH_BYTES) {
        lastFlush = received;
        await savePartialState(partialId, {
          payload,
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
  } catch (err) {
    await delDB(partialId);
    await delDB(downloadId);
    await postToClients({ type: "download-error", downloadId, error: err.message || "Download failed" });
    if (self.registration && self.registration.showNotification) {
      try {
        await self.registration.showNotification(`Download failed: "${payload.title}"`, {
          body: err.message || "Please try again.",
          tag: "kora-dl-" + downloadId,
          data: { downloadId, error: true },
          actions: [{ action: "retry", title: "Retry" }],
        });
      } catch (e) {}
    }
    try {
      if (self.registration && self.registration.sync) {
        await self.registration.sync.register(DOWNLOAD_SYNC_TAG);
      }
    } catch (e) {}
  }
}

async function finishDownload(payload, fileBlob) {
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
        tag: "kora-dl-" + payload.downloadId,
        silent: false,
        data: { downloadId: payload.downloadId, done: true },
        actions: [{ action: "open", title: "Open" }],
      });
      setTimeout(() => {
        self.registration.getNotifications({ tag: "kora-dl-" + payload.downloadId }).then((ns) => ns.forEach((n) => n.close()));
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
      icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
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
        if (!isNewsBriefItem(item)) continue;
        briefs.push({
          title: item.title,
          source: sub.title,
          link: item.link,
          publishedAt: item.publishedAt || Date.now(),
        });
      }
    } catch (e) {
      /* try next feed */
    }
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
  if (data.type === "skip-waiting") {
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
    const canBGF = !!(self.registration && self.registration.backgroundFetch);
    event.waitUntil(canBGF ? downloadBookBGF(data.payload) : downloadBook(data.payload));
  } else if (data.type === "download-audiobook-track") {
    event.waitUntil(downloadAudiobookTrack(data.payload));
  } else if (data.type === "pickup-complete") {
    event.waitUntil(delDB(data.downloadId || data.jobId));
  } else if (data.type === "bgf-cancel") {
    event.waitUntil((async () => {
      try {
        await self.registration.backgroundFetch.get("kora-bgf-" + data.downloadId)?.abort();
      } catch (e) {}
      await delDB("kora-bgf-" + data.downloadId);
      await delDB(data.downloadId);
      await delDB("partial-" + data.downloadId);
      await postToClients({ type: "download-error", downloadId: data.downloadId, error: "Cancelled" });
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
      if (action === "cancel") {
        if (data.downloadId) {
          await postToClients({ type: "bgf-cancel", downloadId: data.downloadId });
          try { await self.registration.backgroundFetch.get("kora-bgf-" + data.downloadId)?.abort(); } catch (e) {}
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
      if (data.downloadId) await postToClients({ type: "open-downloads", downloadId: data.downloadId });
      await focus();
    })()
  );
});

/* ---------- Fetch handling ---------- */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === "/__kora_sw_pickup__") {
    const id = url.searchParams.get("id");
    event.respondWith(
      getDB(id).then((rec) => {
        if (!rec) return new Response("not found", { status: 404 });
        return new Response(rec.blob, { headers: { "Content-Type": rec.blob.type || "application/octet-stream" } });
      })
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
                new Response(JSON.stringify(req.result.filter((r) => !r.bgf && !r.partial && r.blob).map((r) => r.id)), {
                  headers: { "Content-Type": "application/json" },
                })
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

  if (url.pathname.startsWith("/api/")) return;

  if (event.request.method === "GET" && (event.request.mode === "navigate" || url.pathname.startsWith("/assets/") || SHELL_ASSETS.includes(url.pathname))) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(event.request);
        const network = fetch(event.request)
          .then((res) => {
            if (res && res.status === 200 && (url.pathname.startsWith("/assets/") || SHELL_ASSETS.includes(url.pathname))) {
              cache.put(event.request, res.clone());
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })()
    );
  }
});
