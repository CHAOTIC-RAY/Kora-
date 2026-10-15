/* Kora service worker
 * - Keeps book + audiobook downloads alive in the background
 * - Resumes partial downloads after the SW is killed
 * - Daily news-brief notifications via Periodic Background Sync
 */

const DB_NAME = "kora_sw_downloads";
const STORE = "files";
const PREFS_STORE = "prefs";
const SHELL_CACHE = "kora-shell-v6";
const API_CACHE = "kora-api-v6";
const COVER_CACHE = "kora-covers-v1";
const DATA_CACHE = "kora-data-v1"; // perf plan 3.2: bundled dictionary shards (immutable)
// Do NOT cache sw.js / version.json — those must always hit the network so
// redeploys are detected without a manual hard refresh.
const SHELL_ASSETS = ["/", "/index.html", "/manifest.json", "/favicon.svg", "/fonts/opendyslexic-regular.woff2", "/fonts/opendyslexic-bold.woff2"];
const WARM_API_PATHS = ["/api/audiobooks/popular", "/api/nytimes/overview"];
const PERIODIC_SYNC_TAG = "kora-daily-brief";
const DOWNLOAD_SYNC_TAG = "kora-retry-downloads";
const PARTIAL_FLUSH_BYTES = 512 * 1024;

/** Active streaming downloads that can be aborted via bgf-cancel */
const activeBookDownloads = new Map(); // downloadId -> { abortController, reader }

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

async function warmDataCache() {
  // Perf plan 3.2: precache the immutable dictionary shards so offline lookups
  // never hit the network. The exact shards that exist are listed in index.json
  // (hash-bucketed, ~32 max), so we precache precisely those — no 404 guesses.
  const cache = await caches.open(DATA_CACHE);
  let shards = ["index.json"];
  try {
    const idxRes = await fetch("/data/dict/index.json");
    if (idxRes.ok) {
      const idx = (await idxRes.json());
      if (idx && Array.isArray(idx.shards)) shards = ["index.json", ...idx.shards];
    }
  } catch {
    /* fall back to index.json only */
  }
  await Promise.allSettled(
    shards.map((f) =>
      fetch(`/data/dict/${f}`).then((res) => {
        if (res.ok) return cache.put(`/data/dict/${f}`, res);
      }).catch(() => {})
    )
  );
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {})),
      warmApiCache(),
      warmDataCache(),
    ])
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const keep = new Set([SHELL_CACHE, API_CACHE, COVER_CACHE, DATA_CACHE]);
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
      await resumePdfConversions();
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
  const partials = (all || []).filter(
    (r) => r && r.partial && !r.bgf && (r.payload || r.audiobook)
  );
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
    if (cancelled) {
      await delDB(partialId);
      await delDB(downloadId);
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
          tag: "kora-dl-" + downloadId,
          data: { downloadId, error: true },
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


/* ---------- Embedded PDF → EPUB conversion engine ----------
 * Deliberately runs in this service worker, keeps job state in IndexedDB,
 * and never opens a reader automatically. Text-bearing PDFs are supported.
 * Scanned/image-only PDFs are reported as OCR-required: browsers do not expose
 * the Worker() constructor inside ServiceWorkerGlobalScope, so a dependable
 * Tesseract worker cannot be started here.
 */
const PDF_CONVERSION_VERSION = 1;
const PDF_CONVERSION_JOB_PREFIX = "pdf-conversion-job:";
const PDF_CONVERSION_OUTPUT_PREFIX = "pdf-conversion-output:";
const activePdfConversions = new Set();

function conversionJobId(downloadId) {
  return PDF_CONVERSION_JOB_PREFIX + downloadId;
}
function conversionOutputId(downloadId) {
  return PDF_CONVERSION_OUTPUT_PREFIX + downloadId;
}
function pdfLooksLikePdf(payload, blob) {
  const extension = String(payload && (payload.fileExtension || payload.extension || payload.format) || "").toLowerCase();
  if (extension === "pdf" || extension === ".pdf") return true;
  if (/application\/pdf/i.test(String(blob && blob.type || ""))) return true;
  const url = String(payload && (payload.fileUrl || payload.downloadUrl || payload.directUrl || payload.proxyUrl) || "");
  if (/\.pdf(?:[?#]|$)/i.test(url)) return true;
  return blob && blob.size >= 5
    ? blob.slice(0, 5).text().then((magic) => magic === "%PDF-")
    : false;
}
function swXmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function bytesToPdfText(bytes) {
  if (!bytes || !bytes.length) return "";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let result = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) result += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return result;
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    let result = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) result += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    return result;
  }
  if (bytes.length >= 8 && bytes.length % 2 === 0) {
    let zeroes = 0;
    for (let i = 0; i < bytes.length; i += 2) if (bytes[i] === 0) zeroes++;
    if (zeroes / (bytes.length / 2) > 0.3) {
      let result = "";
      for (let i = 0; i + 1 < bytes.length; i += 2) result += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      return result;
    }
  }
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch (e) {
    let result = "";
    for (let i = 0; i < bytes.length; i++) result += String.fromCharCode(bytes[i]);
    return result;
  }
}
function decodePdfStringToken(token) {
  if (!token) return "";
  if (token[0] === "<") {
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    const normalized = hex.length % 2 ? hex + "0" : hex;
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16) || 0;
    return bytesToPdfText(bytes);
  }
  const source = token.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch !== "\\") {
      bytes.push(source.charCodeAt(i) & 255);
      continue;
    }
    if (i + 1 >= source.length) break;
    const next = source[++i];
    if (next === "\r" || next === "\n") {
      if (next === "\r" && source[i + 1] === "\n") i++;
      continue;
    }
    const simple = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    if (Object.prototype.hasOwnProperty.call(simple, next)) {
      bytes.push(simple[next]);
    } else if (/[0-7]/.test(next)) {
      let octal = next;
      for (let count = 0; count < 2 && /[0-7]/.test(source[i + 1] || ""); count++) octal += source[++i];
      bytes.push(parseInt(octal, 8) & 255);
    } else {
      bytes.push(next.charCodeAt(0) & 255);
    }
  }
  return bytesToPdfText(new Uint8Array(bytes));
}
function extractTextFromPdfContent(content) {
  const sections = content.match(/\bBT\b[\s\S]*?\bET\b/g) || [];
  const parts = [];
  const operation = /(\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]+>)\s*Tj\b|\[((?:\\[\s\S]|[^\]])*)\]\s*TJ\b|T\*|[-+]?(?:\d+\.?\d*|\.\d+)\s+[-+]?(?:\d+\.?\d*|\.\d+)\s+(?:Td|TD)\b/g;
  for (const section of sections) {
    let match;
    operation.lastIndex = 0;
    while ((match = operation.exec(section))) {
      if (match[1]) {
        parts.push(decodePdfStringToken(match[1]));
      } else if (match[2] !== undefined) {
        const tokenPattern = /\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g;
        let token;
        while ((token = tokenPattern.exec(match[2]))) parts.push(decodePdfStringToken(token[0]));
      } else {
        parts.push("\n");
      }
    }
    parts.push("\n\n");
  }
  return parts.join(" ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
async function inflatePdfStream(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("PDF_DEFLATE_UNAVAILABLE: this browser cannot decompress PDF text streams in the service worker.");
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (error) {
    throw new Error("PDF_TEXT_DECOMPRESSION_FAILED: a PDF stream could not be decompressed.");
  }
}
async function extractPdfText(blob, onProgress) {
  const buffer = await blob.arrayBuffer();
  const raw = new TextDecoder("latin1").decode(buffer);
  if (!raw.startsWith("%PDF-")) throw new Error("INVALID_PDF: the downloaded file is not a PDF.");
  const totalPages = (raw.match(/\/Type\s*\/Page\b/g) || []).length;
  const streams = [];
  const streamPattern = /\bstream\r?\n/g;
  let match;
  while ((match = streamPattern.exec(raw))) {
    const end = raw.indexOf("endstream", streamPattern.lastIndex);
    if (end < 0) break;
    let dataEnd = end;
    if (raw[dataEnd - 1] === "\n") dataEnd--;
    if (raw[dataEnd - 1] === "\r") dataEnd--;
    const previousEnd = raw.lastIndexOf("endobj", match.index);
    const dictionary = raw.slice(previousEnd >= 0 ? previousEnd + 6 : Math.max(0, match.index - 4096), match.index);
    const start = streamPattern.lastIndex;
    const streamBytes = new Uint8Array(buffer.slice(start, dataEnd));
    if (!/\/Subtype\s*\/Image\b/i.test(dictionary)) {
      streams.push({ bytes: streamBytes, flate: /\/FlateDecode\b/.test(dictionary), dictionary });
    }
    streamPattern.lastIndex = end + 9;
  }
  if (!streams.length) throw new Error("PDF_TEXT_NOT_FOUND: no readable PDF content streams were found.");
  const pieces = [];
  let processed = 0;
  for (const stream of streams) {
    let bytes = stream.bytes;
    if (stream.flate) bytes = await inflatePdfStream(bytes);
    const content = new TextDecoder("latin1").decode(bytes);
    const text = extractTextFromPdfContent(content);
    if (text) pieces.push(text);
    processed++;
    if (onProgress) await onProgress(processed, streams.length, totalPages);
  }
  const text = pieces.join("\n\n").replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const meaningful = text.replace(/[^\p{L}\p{N}]/gu, "");
  if (meaningful.length < 80) {
    throw new Error("PDF_OCR_REQUIRED: this PDF appears scanned or uses a text encoding this service-worker extractor cannot read. OCR needs a dedicated worker, which browsers do not permit service workers to create.");
  }
  return { text, totalPages: totalPages || streams.length };
}
function splitPdfTextIntoChapters(text, title) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((line) => line.trim());
  const heading = /^(chapter|part|section)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b.*$|^(introduction|preface|prologue|epilogue|conclusion|appendix|afterword|foreword)\b.*$/i;
  const chapters = [];
  let currentTitle = title || "Book";
  let currentLines = [];
  const flush = () => {
    const value = currentLines.join("\n").trim();
    if (value.length > 40) chapters.push({ title: currentTitle, text: value });
    currentLines = [];
  };
  for (const line of lines) {
    if (heading.test(line) && currentLines.join("\n").length > 350) {
      flush();
      currentTitle = line.slice(0, 120);
    } else {
      currentLines.push(line);
    }
  }
  flush();
  if (!chapters.length) chapters.push({ title: title || "Book", text: String(text || "").trim() });
  const bounded = [];
  for (const chapter of chapters) {
    let remaining = chapter.text;
    let part = 1;
    while (remaining.length > 14000) {
      let cut = remaining.lastIndexOf("\n\n", 14000);
      if (cut < 4000) cut = remaining.lastIndexOf(". ", 14000);
      if (cut < 4000) cut = remaining.lastIndexOf(" ", 14000);
      if (cut < 4000) cut = 14000;
      bounded.push({ title: chapters.length === 1 ? (part === 1 ? chapter.title : chapter.title + " (continued " + part + ")") : chapter.title + " (part " + part + ")", text: remaining.slice(0, cut).trim() });
      remaining = remaining.slice(cut).trim();
      part++;
    }
    if (remaining) bounded.push({ title: part === 1 ? chapter.title : chapter.title + " (continued " + part + ")", text: remaining });
  }
  return bounded;
}
function xhtmlParagraphs(text) {
  const blocks = String(text || "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const paragraphs = [];
  for (const block of blocks) {
    if (block.length <= 2400) {
      paragraphs.push(block);
      continue;
    }
    const sentences = block.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [block];
    let current = "";
    for (const sentence of sentences) {
      if (current.length + sentence.length > 1700 && current) {
        paragraphs.push(current.trim());
        current = "";
      }
      current += sentence + " ";
    }
    if (current.trim()) paragraphs.push(current.trim());
  }
  return paragraphs.map((paragraph) => "<p>" + swXmlEscape(paragraph).replace(/\n/g, "<br />") + "</p>").join("\n");
}
function epubEntryText(path, text) {
  return { name: path, data: new TextEncoder().encode(text) };
}
function zipU16(bytes, offset, value) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
}
function zipU32(bytes, offset, value) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
  bytes[offset + 2] = (value >>> 16) & 255;
  bytes[offset + 3] = (value >>> 24) & 255;
}
function swCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function concatByteArrays(parts, totalLength) {
  const result = new Uint8Array(totalLength == null ? parts.reduce((sum, part) => sum + part.length, 0) : totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let centralLength = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new TextEncoder().encode(String(entry.data));
    const crc = swCrc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    zipU32(local, 0, 0x04034b50);
    zipU16(local, 4, 20);
    zipU16(local, 6, 0x0800);
    zipU16(local, 8, 0);
    zipU16(local, 10, 0);
    zipU16(local, 12, 0x21);
    zipU32(local, 14, crc);
    zipU32(local, 18, data.length);
    zipU32(local, 22, data.length);
    zipU16(local, 26, name.length);
    zipU16(local, 28, 0);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    localParts.push(local);
    const central = new Uint8Array(46 + name.length);
    zipU32(central, 0, 0x02014b50);
    zipU16(central, 4, 20);
    zipU16(central, 6, 20);
    zipU16(central, 8, 0x0800);
    zipU16(central, 10, 0);
    zipU16(central, 12, 0);
    zipU16(central, 14, 0x21);
    zipU32(central, 16, crc);
    zipU32(central, 20, data.length);
    zipU32(central, 24, data.length);
    zipU16(central, 28, name.length);
    zipU16(central, 30, 0);
    zipU16(central, 32, 0);
    zipU16(central, 34, 0);
    zipU16(central, 36, 0);
    zipU32(central, 38, 0);
    zipU32(central, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length;
    centralLength += central.length;
  }
  const centralOffset = localOffset;
  const end = new Uint8Array(22);
  zipU32(end, 0, 0x06054b50);
  zipU16(end, 4, 0);
  zipU16(end, 6, 0);
  zipU16(end, 8, entries.length);
  zipU16(end, 10, entries.length);
  zipU32(end, 12, centralLength);
  zipU32(end, 16, centralOffset);
  zipU16(end, 20, 0);
  return new Blob([concatByteArrays(localParts), concatByteArrays(centralParts), end], { type: "application/epub+zip" });
}
function createEpubEntries(opts) {
  const title = String(opts.title || "Untitled");
  const creator = String(opts.author || "Unknown");
  const language = String(opts.language || "en").slice(0, 16);
  const chapters = opts.chapters || [];
  const entries = [
    { name: "mimetype", data: new TextEncoder().encode("application/epub+zip") },
    epubEntryText("META-INF/container.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    epubEntryText("OEBPS/styles/style.css", "body{font-family:serif;line-height:1.65;margin:5%;max-width:42em}h1{font-size:1.4em;line-height:1.25}p{margin:0 0 1em;text-indent:0}"),
  ];
  const chapterFiles = [];
  const navItems = [];
  chapters.forEach((chapter, index) => {
    const id = "chapter-" + (index + 1);
    const href = "text/" + id + ".xhtml";
    const chapterTitle = chapter.title || ("Chapter " + (index + 1));
    const html = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' + swXmlEscape(language) + '" lang="' + swXmlEscape(language) + '"><head><meta charset="UTF-8"/><title>' + swXmlEscape(chapterTitle) + '</title><link rel="stylesheet" type="text/css" href="../styles/style.css"/></head><body><h1>' + swXmlEscape(chapterTitle) + '</h1>' + xhtmlParagraphs(chapter.text) + '</body></html>';
    chapterFiles.push({ id, href });
    navItems.push('<li><a href="' + href + '">' + swXmlEscape(chapterTitle) + '</a></li>');
    entries.push(epubEntryText("OEBPS/" + href, html));
  });
  entries.push(epubEntryText("OEBPS/nav.xhtml", '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="' + swXmlEscape(language) + '" lang="' + swXmlEscape(language) + '"><head><meta charset="UTF-8"/><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>' + navItems.join("") + '</ol></nav></body></html>'));
  const manifest = ['<item id="css" href="styles/style.css" media-type="text/css"/>','<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>']
    .concat(chapterFiles.map((chapter) => '<item id="' + chapter.id + '" href="' + chapter.href + '" media-type="application/xhtml+xml"/>')).join("");
  const spine = chapterFiles.map((chapter) => '<itemref idref="' + chapter.id + '"/>').join("");
  const identifier = "urn:kora:pdf-conversion:" + String(opts.downloadId || Date.now()).replace(/[^A-Za-z0-9._:-]/g, "-");
  entries.push(epubEntryText("OEBPS/content.opf", '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="BookId">' + swXmlEscape(identifier) + '</dc:identifier><dc:title>' + swXmlEscape(title) + '</dc:title><dc:creator>' + swXmlEscape(creator) + '</dc:creator><dc:language>' + swXmlEscape(language) + '</dc:language><meta property="dcterms:modified">' + new Date().toISOString().replace(/\.\d{3}Z$/, "Z") + '</meta></metadata><manifest>' + manifest + '</manifest><spine>' + spine + '</spine></package>'));
  return entries;
}
async function buildAndValidateEpub(opts) {
  const entries = createEpubEntries(opts);
  if (!entries.length || entries[0].name !== "mimetype" || new TextDecoder().decode(entries[0].data) !== "application/epub+zip") {
    throw new Error("EPUB_VALIDATION_FAILED: the required mimetype entry is missing.");
  }
  const blob = makeStoredZip(entries);
  if (blob.size < 100) throw new Error("EPUB_VALIDATION_FAILED: generated EPUB is unexpectedly small.");
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const firstName = await blob.slice(30, 38).text();
  const mime = await blob.slice(38, 58).text();
  if (signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 0x03 || signature[3] !== 0x04 || firstName !== "mimetype" || mime !== "application/epub+zip") {
    throw new Error("EPUB_VALIDATION_FAILED: EPUB ZIP header/mimetype validation failed.");
  }
  return blob;
}
async function setPdfConversionState(downloadId, payload, status, progress, extra) {
  const id = conversionJobId(downloadId);
  const old = await getDB(id) || {};
  const job = {
    ...old,
    id,
    conversionJob: true,
    pipelineVersion: PDF_CONVERSION_VERSION,
    downloadId,
    title: (payload && payload.title) || old.title || "Untitled",
    author: (payload && payload.author) || old.author || "Unknown",
    status,
    progress: Math.max(0, Math.min(100, Number(progress) || 0)),
    updatedAt: Date.now(),
    ...(extra || {}),
  };
  if (!old.createdAt) job.createdAt = Date.now();
  await putDB(id, job);
  if (status !== "failed" && status !== "completed") {
    await postToClients({
      type: "conversion-progress",
      downloadId,
      title: job.title,
      author: job.author,
      status,
      stage: status,
      percent: job.progress,
      pagesProcessed: job.pagesProcessed || 0,
      pagesTotal: job.pagesTotal || 0,
    });
  }
  return job;
}
async function runPdfConversion(downloadId, payload, sourceBlob, force) {
  if (activePdfConversions.has(downloadId)) return;
  activePdfConversions.add(downloadId);
  const sourceRecord = await getDB(downloadId) || {};
  const outputId = conversionOutputId(downloadId);
  try {
    const oldJob = await getDB(conversionJobId(downloadId));
    const oldOutput = await getDB(outputId);
    if (!force && oldJob && oldJob.status === "failed") return;
    if (oldJob && oldJob.pipelineVersion === PDF_CONVERSION_VERSION && oldJob.status === "completed" && oldOutput && oldOutput.blob) {
      await postToClients({ type: "conversion-complete", downloadId, title: oldOutput.title, author: oldOutput.author, size: formatBytes(oldOutput.blob.size), outputId });
      return;
    }
    await setPdfConversionState(downloadId, payload, "extracting", 3, { error: null, errorCode: null });
    let lastPercent = 3;
    const extracted = await extractPdfText(sourceBlob, async (processed, count, pagesTotal) => {
      const percent = Math.min(58, 5 + Math.round((processed / Math.max(1, count)) * 53));
      if (percent !== lastPercent) {
        lastPercent = percent;
        await setPdfConversionState(downloadId, payload, "extracting", percent, {
          pagesProcessed: Math.min(processed, pagesTotal || processed),
          pagesTotal: pagesTotal || count,
        });
      }
    });
    await setPdfConversionState(downloadId, payload, "building", 65, {
      pagesProcessed: extracted.totalPages,
      pagesTotal: extracted.totalPages,
      extractedCharacters: extracted.text.length,
    });
    const title = (payload && payload.title) || "Untitled";
    const author = (payload && payload.author) || "Unknown";
    const chapters = splitPdfTextIntoChapters(extracted.text, title);
    const epub = await buildAndValidateEpub({
      title,
      author,
      language: (payload && payload.language) || "en",
      chapters,
      downloadId,
    });
    await setPdfConversionState(downloadId, payload, "validating", 92, { chapterCount: chapters.length });
    await putDB(outputId, {
      id: outputId,
      blob: epub,
      conversionOutput: true,
      sourceDownloadId: downloadId,
      title,
      author,
      language: (payload && payload.language) || "en",
      fileName: title.replace(/[\\/:*?"<>|]+/g, "_") + ".epub",
      createdAt: Date.now(),
      saved: false,
    });
    await setPdfConversionState(downloadId, payload, "completed", 100, {
      outputId,
      chapterCount: chapters.length,
      outputSize: epub.size,
      error: null,
      errorCode: null,
    });
    await postToClients({
      type: "conversion-complete",
      downloadId,
      title,
      author,
      size: formatBytes(epub.size),
      outputId,
    });
    try {
      if (self.registration && self.registration.showNotification) {
        await self.registration.showNotification('"' + title + '" converted to EPUB', {
          body: "The EPUB is ready in your Kora Library. Open it when you are ready.",
          tag: "kora-conversion-" + downloadId,
          silent: true,
          data: { downloadId, conversion: true },
        });
      }
    } catch (e) {}
  } catch (error) {
    const message = String(error && error.message || error || "PDF conversion failed");
    const codeMatch = message.match(/^([A-Z_]+):/);
    await setPdfConversionState(downloadId, payload, "failed", 0, {
      error: message,
      errorCode: codeMatch ? codeMatch[1] : "PDF_CONVERSION_FAILED",
      failedAt: Date.now(),
    });
    await postToClients({
      type: "conversion-error",
      downloadId,
      title: (payload && payload.title) || "Downloaded PDF",
      error: message,
      errorCode: codeMatch ? codeMatch[1] : "PDF_CONVERSION_FAILED",
    });
  } finally {
    activePdfConversions.delete(downloadId);
    const latestSource = await getDB(downloadId);
    if (latestSource) {
      const job = await getDB(conversionJobId(downloadId));
      const terminal = job && (job.status === "completed" || job.status === "failed");
      if (terminal) {
        if (latestSource.sourcePickedUp) {
          await delDB(downloadId);
        } else {
          await putDB(downloadId, { ...latestSource, conversionPending: false });
        }
      }
    }
  }
}
async function resumePdfConversions() {
  const all = await getAllDB();
  const resumable = all.filter((record) => record && record.conversionJob &&
    ["queued", "extracting", "building", "validating"].includes(record.status));
  for (const job of resumable) {
    const source = await getDB(job.downloadId);
    if (!source || !source.blob) {
      await setPdfConversionState(job.downloadId, job, "failed", 0, {
        error: "PDF_SOURCE_MISSING: the original download is no longer available to resume conversion.",
        errorCode: "PDF_SOURCE_MISSING",
        failedAt: Date.now(),
      });
      continue;
    }
    await runPdfConversion(job.downloadId, source.payload || job, source.blob, true);
  }
}

async function finishDownload(payload, fileBlob) {
  const downloadId = payload.downloadId;
  const isPdf = await pdfLooksLikePdf(payload, fileBlob);
  if (isPdf) {
    const current = await getDB(downloadId) || {};
    await putDB(downloadId, { ...current, blob: fileBlob, payload, conversionPending: true, sourceFormat: "pdf", sourcePickedUp: false });
    await setPdfConversionState(downloadId, payload, "queued", 0, { error: null, errorCode: null });
  }
  await postToClients({
    type: "download-complete",
    downloadId,
    title: payload.title,
    size: formatBytes(fileBlob.size),
    conversionExpected: isPdf,
  });
  if (isPdf) {
    const current = await getDB(downloadId);
    try {
      await runPdfConversion(downloadId, payload, fileBlob, false);
    } catch (error) {
      console.warn("[SW PDF conversion] failed", error);
    }
    const source = await getDB(downloadId);
    if (source && source.sourcePickedUp) await delDB(downloadId);
  }
  if (self.registration && self.registration.showNotification) {
    try {
      await self.registration.showNotification('"' + (payload.title || "Book") + '" downloaded', {
        body: isPdf ? "PDF saved. EPUB conversion status is available in Downloads." : "Ready in your library.",
        tag: "kora-dl-" + downloadId,
        silent: false,
        data: { downloadId, done: true },
        actions: [{ action: "open", title: "Open" }],
      });
      setTimeout(() => {
        self.registration.getNotifications({ tag: "kora-dl-" + downloadId }).then((ns) => ns.forEach((n) => n.close()));
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
    event.waitUntil((async () => {
      const id = data.downloadId || data.jobId;
      const record = id ? await getDB(id) : null;
      if (record && record.conversionPending) {
        await putDB(id, { ...record, sourcePickedUp: true });
      } else if (id) {
        await delDB(id);
      }
    })());
  } else if (data.type === "conversion-pickup-complete") {
    event.waitUntil((async () => {
      const downloadId = data.downloadId;
      if (downloadId) await delDB(conversionOutputId(downloadId));
    })());
  } else if (data.type === "retry-pdf-conversion") {
    event.waitUntil((async () => {
      const downloadId = data.downloadId;
      const source = downloadId ? await getDB(downloadId) : null;
      if (!source || !source.blob) {
        await postToClients({ type: "conversion-error", downloadId, error: "PDF_SOURCE_MISSING: original PDF is not available for retry.", errorCode: "PDF_SOURCE_MISSING" });
        return;
      }
      await runPdfConversion(downloadId, source.payload || {}, source.blob, true);
    })());
  } else if (data.type === "bgf-cancel") {
    event.waitUntil((async () => {
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
    event.waitUntil((async () => { await resumePartialDownloads(); await resumePdfConversions(); })());
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

  if (url.pathname === "/__kora_sw_conversion_pickup__") {
    const id = url.searchParams.get("id");
    event.respondWith((async () => {
      if (!id) return new Response("missing id", { status: 400 });
      const record = await getDB(conversionOutputId(id));
      if (!record || !record.blob) return new Response("not found", { status: 404 });
      return new Response(record.blob, {
        headers: {
          "Content-Type": "application/epub+zip",
          "Content-Disposition": 'attachment; filename="' + String(record.fileName || "converted.epub").replace(/["\r\n]/g, "_") + '"',
        },
      });
    })());
    return;
  }

  if (url.pathname === "/__kora_sw_conversion_list__") {
    event.respondWith((async () => {
      const all = await getAllDB();
      const pending = all.filter((record) => record && record.conversionOutput && record.blob).map((record) => ({
        downloadId: record.sourceDownloadId,
        title: record.title,
        author: record.author,
        size: record.blob.size,
      }));
      return new Response(JSON.stringify(pending), { headers: { "Content-Type": "application/json" } });
    })());
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
                    (req.result || [])
                      .filter((r) => r && !r.bgf && !r.partial && !r.audiobook && !r.conversionOutput && !r.conversionJob && r.blob)
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

  // Perf plan 3.2: bundled, immutable dictionary shards — cache-first, served
  // offline. These live under /data/ and never change between deploys.
  if (event.request.method === "GET" && url.pathname.startsWith("/data/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(DATA_CACHE);
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
