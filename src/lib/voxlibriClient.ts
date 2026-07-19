const STORAGE_KEY = "kora_voxlibri_url";
const DEFAULT_URL = "http://localhost:7861";

export interface VoxLibriHealth {
  ok: boolean;
  detail?: string;
  device?: string;
}

export interface VoxLibriJob {
  jobId: string;
  status: "queued" | "running" | "done" | "failed" | string;
  progress: number;
  message: string;
  trackCount?: number;
  error?: string;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getVoxLibriUrl(): string {
  try {
    return normalizeBaseUrl(localStorage.getItem(STORAGE_KEY) || DEFAULT_URL);
  } catch {
    return DEFAULT_URL;
  }
}

export function setVoxLibriUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, normalizeBaseUrl(url));
}

function apiUrl(base: string, path: string): string {
  return `${normalizeBaseUrl(base)}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function checkVoxLibriHealth(baseUrl = getVoxLibriUrl()): Promise<VoxLibriHealth> {
  try {
    const res = await fetch(apiUrl(baseUrl, "/api/health"), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, detail: `VoxLibri responded with ${res.status}` };
    const data = (await res.json()) as { ok?: boolean; device?: string };
    return { ok: !!data.ok, device: data.device, detail: "Connected" };
  } catch (err) {
    const msg = (err as Error).message || "Connection failed";
    const isCors = msg.toLowerCase().includes("failed to fetch");
    return {
      ok: false,
      detail: isCors
        ? "Cannot reach VoxLibri. Run the local API wrapper and try /voxlibri-api in dev."
        : msg,
    };
  }
}

export async function startVoxLibriConversion(opts: {
  file: Blob;
  fileName: string;
  language?: string;
  ttsEngine?: "xtts" | "fairseq";
  outputFormat?: "mp3" | "m4b";
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const form = new FormData();
  form.append("file", opts.file, opts.fileName);
  form.append("language", opts.language || "eng");
  form.append("tts_engine", opts.ttsEngine || "xtts");
  form.append("output_format", opts.outputFormat || "mp3");

  const res = await fetch(apiUrl(opts.baseUrl || getVoxLibriUrl(), "/api/convert"), {
    method: "POST",
    body: form,
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Upload failed (${res.status})`);
  }
  const data = (await res.json()) as { jobId: string };
  return data.jobId;
}

export async function getVoxLibriJob(jobId: string, baseUrl = getVoxLibriUrl()): Promise<VoxLibriJob> {
  const res = await fetch(apiUrl(baseUrl, `/api/jobs/${encodeURIComponent(jobId)}`));
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  return res.json() as Promise<VoxLibriJob>;
}

export async function downloadVoxLibriJob(jobId: string, baseUrl = getVoxLibriUrl()): Promise<Blob> {
  const res = await fetch(apiUrl(baseUrl, `/api/jobs/${encodeURIComponent(jobId)}/download`));
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return res.blob();
}
