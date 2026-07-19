/**
 * BYO WebDAV client for optional personal file archive.
 * Uses /api/webdav-proxy to avoid browser CORS limits.
 */

import type { BookMetadata } from "../firebase";
import type { WebDavConfig } from "./syncPrefs";

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function joinUrl(base: string, ...parts: string[]): string {
  const root = trimSlash(base);
  const rest = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return `${root}/${rest}`;
}

function remoteBookUrl(cfg: WebDavConfig, book: BookMetadata): string {
  const ext = (book.extension || "epub").replace(/^\./, "");
  const safeId = book.id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return joinUrl(cfg.baseUrl, cfg.remotePath || "kora-books", `${safeId}.${ext}`);
}

function folderUrl(cfg: WebDavConfig): string {
  return joinUrl(cfg.baseUrl, cfg.remotePath || "kora-books");
}

function authQuery(cfg: WebDavConfig, targetUrl: string, method: string): string {
  const qs = new URLSearchParams({
    url: targetUrl,
    method,
    username: cfg.username || "",
    password: cfg.password || "",
  });
  return `/api/webdav-proxy?${qs.toString()}`;
}

export async function webdavTestConnection(cfg: WebDavConfig): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.baseUrl?.trim()) return { ok: false, error: "Base URL required" };
  try {
    const folder = folderUrl(cfg);
    const res = await fetch(authQuery(cfg, folder, "PROPFIND"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        depth: "0",
        bodyText: `<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>`,
      }),
    });
    const data = await res.json().catch(() => ({ status: res.status }));
    const status = Number(data.status || res.status);
    if (status === 401) return { ok: false, error: "Unauthorized — check username/password" };
    if (status === 404) {
      const mk = await fetch(authQuery(cfg, folder, "MKCOL"), { method: "POST", body: "{}" });
      const mkData = await mk.json().catch(() => ({ status: mk.status }));
      const mkStatus = Number(mkData.status || mk.status);
      if ([200, 201, 204, 405, 409, 301].includes(mkStatus)) return { ok: true };
      return { ok: false, error: `Cannot create folder (${mkStatus})` };
    }
    if (status === 207 || (status >= 200 && status < 300)) return { ok: true };
    return { ok: false, error: data.error || `WebDAV responded ${status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function webdavUploadBook(
  cfg: WebDavConfig,
  book: BookMetadata,
  blob: Blob
): Promise<void> {
  if (!cfg.enabled || !cfg.baseUrl) return;
  const folder = folderUrl(cfg);
  try {
    await fetch(authQuery(cfg, folder, "MKCOL"), { method: "POST", body: "{}" });
  } catch {
    /* may exist */
  }
  const url = remoteBookUrl(cfg, book);
  const res = await fetch(authQuery(cfg, url, "PUT"), {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WebDAV upload failed (${res.status}) ${text.slice(0, 120)}`);
  }
}

export async function webdavDownloadBook(
  cfg: WebDavConfig,
  book: BookMetadata,
  signal?: AbortSignal
): Promise<Blob | null> {
  if (!cfg.enabled || !cfg.baseUrl) return null;
  const url = remoteBookUrl(cfg, book);
  const res = await fetch(authQuery(cfg, url, "GET"), { method: "GET", signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`WebDAV download failed (${res.status})`);
  const blob = await res.blob();
  return blob.size ? blob : null;
}
