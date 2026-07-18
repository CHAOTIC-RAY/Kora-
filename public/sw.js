/* Kora service worker
 * - Keeps book downloads alive in the background and shows an Android
 *   notification with live progress (streaming fetch).
 * - Uses the Background Fetch API when available (true OS-level download that
 *   survives the SW/process being killed, with a system notification + pause).
 * - Caches the app shell so the reader loads offline (D10).
 *
 * Flow (streaming):
 *   page --postMessage {type:'download-book'}--> SW
 *   SW   fetches /api/proxy-file, streams bytes, writes blob to IndexedDB
 *         (kora_sw_downloads), posts progress + a persistent notification.
 *   page  receives download-complete -> picks up blob via /__kora_sw_pickup__
 *         -> storeBookFile() -> deletes SW copy.
 *
 * Flow (Background Fetch):
 *   page --postMessage {type:'download-book'}--> SW
 *   SW   registration.backgroundFetch.fetch(id, [{request:proxyUrl}])
 *   OS   downloads in the system download manager; SW gets
 *         backgroundfetchsuccess -> stores blob -> posts download-complete.
 */

const DB_NAME = "kora_sw_downloads";
const STORE = "files";
const SHELL_CACHE = "kora-shell-v1";
const SHELL_ASSETS = ["/", "/index.html", "/manifest.json", "/sw.js", "/favicon.svg"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

/* ---------- IndexedDB for finished blobs ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function putDB(id, record) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(record);
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

async function showProgressNotif(payload, percent, transferred, opts = {}) {
  if (!self.registration || !self.registration.showNotification) return;
  const title = opts.title || `Downloading "${payload.title}"`;
  const body = percent == null ? transferred : `${percent}%  •  ${transferred}`;
  try {
    await self.registration.showNotification(title, {
      body,
      tag: "kora-dl-" + payload.downloadId,
      silent: true,
      data: { downloadId: payload.downloadId },
      ...(percent != null ? { progress: Math.max(0, Math.min(100, percent)) } : {}),
      actions: [
        { action: "open", title: "Open" },
        { action: "cancel", title: "Cancel" },
      ],
      ...opts.extra,
    });
  } catch (e) {
    /* notification may be blocked; ignore */
  }
}

/* ---------- Streaming download (fallback / when BGF unavailable) ---------- */
async function downloadBook(payload) {
  const { downloadId, proxyUrl } = payload;
  try {
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error(`Mirror unresponsive (HTTP ${response.status}).`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("text/html"))
      throw new Error("Mirror returned a webpage instead of a book file.");

    const contentLength = +(response.headers.get("Content-Length") || 0);
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    const startTime = Date.now();
    let lastNotif = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      const percent = contentLength > 0 ? Math.round((received / contentLength) * 100) : null;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? received / elapsed : 0;
      const transferred = contentLength > 0
        ? `${formatBytes(received)} of ${formatBytes(contentLength)}`
        : formatBytes(received);

      const now = Date.now();
      if (now - lastNotif > 400 || percent === 100) {
        lastNotif = now;
        await postToClients({ type: "download-progress", downloadId, percent, transferred, speed: speed > 0 ? `${formatBytes(speed)}/s` : "" });
        await showProgressNotif(payload, percent, transferred);
      }
    }

    const fileBlob = new Blob(chunks, { type: contentType || "application/octet-stream" });
    await putDB(downloadId, { id: downloadId, blob: fileBlob, payload, saved: false });
    await finishDownload(payload, fileBlob);
  } catch (err) {
    await delDB(downloadId);
    await postToClients({ type: "download-error", downloadId, error: err.message || "Download failed" });
    if (self.registration && self.registration.showNotification) {
      try {
        await self.registration.showNotification(`Download failed: "${payload.title}"`, {
          body: err.message || "Please try again.",
          tag: "kora-dl-" + payload.downloadId,
          data: { downloadId, error: true },
          actions: [{ action: "retry", title: "Retry" }],
        });
      } catch (e) {}
    }
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

/* ---------- Background Fetch (true OS-level background download) ---------- */
async function downloadBookBGF(payload) {
  const bgfId = "kora-bgf-" + payload.downloadId;
  try {
    // Persist the payload + proxyUrl so the success handler can resolve it.
    await putDB(bgfId, { id: bgfId, payload, proxyUrl: payload.proxyUrl, saved: false, bgf: true });
    const bgf = await self.registration.backgroundFetch.fetch(bgfId, [
      { request: payload.proxyUrl, method: "GET" },
    ], {
      title: `Downloading "${payload.title}"`,
      downloadTotal: 0,
      icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
    });
    // Optimistically tell the page we started (progress comes from the OS).
    await postToClients({ type: "download-progress", downloadId: payload.downloadId, percent: null, transferred: "starting…", speed: "" });
    if (bgf && bgf.failureReason && bgf.failureReason !== "aborted") {
      throw new Error("Background fetch rejected: " + bgf.failureReason);
    }
  } catch (err) {
    // BGF unavailable or rejected — fall back to the streaming path.
    console.warn("[SW] Background Fetch failed, falling back to streaming:", err);
    await delDB(bgfId);
    await downloadBook(payload);
  }
}

/* ---------- Message handling ---------- */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "download-book") {
    const canBGF = !!(self.registration && self.registration.backgroundFetch);
    event.waitUntil(canBGF ? downloadBookBGF(data.payload) : downloadBook(data.payload));
  } else if (data.type === "pickup-complete") {
    event.waitUntil(delDB(data.downloadId));
  } else if (data.type === "bgf-cancel") {
    event.waitUntil((async () => {
      try {
        await self.registration.backgroundFetch.get("kora-bgf-" + data.downloadId)?.abort();
      } catch (e) {}
      await delDB("kora-bgf-" + data.downloadId);
      await delDB(data.downloadId);
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
        const match = await event.registration.match(rec.proxyUrl);
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
      if (rec) await postToClients({ type: "download-error", downloadId: rec.payload.downloadId, error: "Download failed" });
    })()
  );
});

self.addEventListener("backgroundfetchabort", (event) => {
  event.waitUntil(
    (async () => {
      const rec = await getDB(event.registration.id);
      await delDB(event.registration.id);
      if (rec) await postToClients({ type: "download-error", downloadId: rec.payload.downloadId, error: "Cancelled" });
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
      event.registration.matchAll().then(() => {});
    })()
  );
});

/* ---------- Notification clicks (Open / Cancel / Retry) ---------- */
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
      // Open / default
      if (data.downloadId) await postToClients({ type: "open-downloads", downloadId: data.downloadId });
      await focus();
    })()
  );
});

/* ---------- Fetch handling: blob pickup + offline app shell ---------- */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Blob pickup from the SW store
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

  // 1b. List finished blobs still waiting to be ingested (C7 sweep)
  if (url.pathname === "/__kora_sw_list__") {
    event.respondWith(
      openDB().then(
        (db) =>
          new Promise((resolve) => {
            const tx = db.transaction(STORE, "readonly");
            const req = tx.objectStore(STORE).getAll();
            req.onsuccess = () =>
              resolve(
                new Response(JSON.stringify(req.result.filter((r) => !r.bgf).map((r) => r.id)), {
                  headers: { "Content-Type": "application/json" },
                })
              );
            req.onerror = () => resolve(new Response("[]", { headers: { "Content-Type": "application/json" } }));
          })
      )
    );
    return;
  }

  // 2. Don't intercept API or background-fetch network requests
  if (url.pathname.startsWith("/api/")) return;

  // 3. Navigation / same-origin asset: stale-while-revalidate from the shell cache
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
