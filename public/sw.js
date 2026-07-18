/* Kora service worker — keeps book downloads alive in the background and
 * shows an Android notification with live progress.
 *
 * Flow:
 *   page  --postMessage {type:'download-book', payload}-->  SW
 *   SW    fetches /api/proxy-file?url=..., streams bytes, writes the blob to a
 *         dedicated IndexedDB store (kora_sw_downloads), and posts progress
 *         messages back to clients + updates a persistent notification.
 *   page  receives {type:'download-complete'} -> pulls the blob from the SW
 *         store, calls storeBookFile(), then deletes it.
 *
 * Because the fetch runs in the SW context, it keeps going even if the page
 * or tab is closed (Chrome keeps the SW alive for in-flight fetches), which
 * fixes "download fails after exiting the app".
 */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const DB_NAME = "kora_sw_downloads";
const STORE = "files";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
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

async function showProgressNotif(payload, percent, transferred) {
  if (!self.registration || !self.registration.showNotification) return;
  const title = `Downloading “${payload.title}”`;
  const body = percent == null ? transferred : `${percent}%  •  ${transferred}`;
  try {
    await self.registration.showNotification(title, {
      body,
      tag: "kora-dl-" + payload.downloadId,
      silent: true,
      data: { downloadId: payload.downloadId },
      // Android: a "determinate" progress bar when percent is known
      ...(percent != null ? { progress: Math.max(0, Math.min(100, percent)) } : {}),
    });
  } catch (e) {
    /* notification may be blocked; ignore */
  }
}

async function downloadBook(payload) {
  const { downloadId, proxyUrl } = payload;
  try {
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Mirror unresponsive (HTTP ${response.status}).`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("text/html")) {
      throw new Error("Mirror returned a webpage instead of a book file.");
    }
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
        await postToClients({
          type: "download-progress",
          downloadId,
          percent,
          transferred,
          speed: speed > 0 ? `${formatBytes(speed)}/s` : "",
        });
        await showProgressNotif(payload, percent, transferred);
      }
    }

    const fileBlob = new Blob(chunks, { type: contentType || "application/octet-stream" });
    await putDB(downloadId, { id: downloadId, blob: fileBlob, payload, saved: false });

    await postToClients({
      type: "download-complete",
      downloadId,
      title: payload.title,
      size: formatBytes(fileBlob.size),
    });

    if (self.registration && self.registration.showNotification) {
      try {
        await self.registration.showNotification(`“${payload.title}” downloaded`, {
          body: "Ready in your library.",
          tag: "kora-dl-" + downloadId,
          silent: false,
          data: { downloadId, done: true },
        });
        // Auto-dismiss the completion notification after a few seconds
        setTimeout(() => {
          self.registration.getNotifications({ tag: "kora-dl-" + downloadId }).then((ns) => ns.forEach((n) => n.close()));
        }, 4000);
      } catch (e) {}
    }
  } catch (err) {
    await delDB(downloadId);
    await postToClients({
      type: "download-error",
      downloadId,
      error: err.message || "Download failed",
    });
    if (self.registration && self.registration.showNotification) {
      try {
        await self.registration.showNotification(`Download failed: “${payload.title}”`, {
          body: err.message || "Please try again.",
          tag: "kora-dl-" + downloadId,
          data: { downloadId, error: true },
        });
      } catch (e) {}
    }
  }
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "download-book") {
    event.waitUntil(downloadBook(data.payload));
  } else if (data.type === "pickup-complete") {
    // page finished storing the file; safe to delete the SW copy
    event.waitUntil(delDB(data.downloadId));
  } else if (data.type === "sw-ready") {
    event.waitUntil(postToClients({ type: "sw-ready-ack" }));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      if (cs[0]) return cs[0].focus();
      return self.clients.openWindow("/");
    })
  );
});

// Allow the page to fetch the finished blob directly from the SW store
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
  }
});
