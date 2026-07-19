const STORAGE_KEY = "kora_vocalbook_url";
const DEFAULT_URL = "http://localhost:7862";

export interface VocalbookHealth {
  ok: boolean;
  detail?: string;
  configCount?: number;
}

export interface VocalbookJob {
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

export function getVocalbookUrl(): string {
  try {
    return normalizeBaseUrl(localStorage.getItem(STORAGE_KEY) || DEFAULT_URL);
  } catch {
    return DEFAULT_URL;
  }
}

export function setVocalbookUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, normalizeBaseUrl(url));
}

function apiUrl(base: string, path: string): string {
  return `${normalizeBaseUrl(base)}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function checkVocalbookHealth(baseUrl = getVocalbookUrl()): Promise<VocalbookHealth> {
  try {
    const res = await fetch(apiUrl(baseUrl, "/api/health"), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, detail: `VocalBook responded with ${res.status}` };
    const data = (await res.json()) as { ok?: boolean; configCount?: number };
    return { ok: !!data.ok, configCount: data.configCount, detail: "Connected" };
  } catch (err) {
    const msg = (err as Error).message || "Connection failed";
    const isCors = msg.toLowerCase().includes("failed to fetch");
    return {
      ok: false,
      detail: isCors
        ? "Cannot reach VocalBook. Run the local API wrapper and try /vocalbook-api in dev."
        : msg,
    };
  }
}

export async function listVocalbookConfigs(baseUrl = getVocalbookUrl()): Promise<Record<string, unknown>> {
  const res = await fetch(apiUrl(baseUrl, "/api/configs"));
  if (!res.ok) return {};
  const data = (await res.json()) as { configs?: Record<string, unknown> };
  return data.configs || {};
}

export async function startVocalbookConversion(opts: {
  file: Blob;
  fileName: string;
  configName?: string;
  ttsModel?: "edge" | "coqui";
  ttsVoice?: string;
  rvcModel?: string;
  batchSize?: number;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const form = new FormData();
  form.append("file", opts.file, opts.fileName);
  if (opts.configName) form.append("config_name", opts.configName);
  form.append("tts_model", opts.ttsModel || "edge");
  form.append("tts_voice", opts.ttsVoice || "en-US-GuyNeural");
  form.append("rvc_model", opts.rvcModel || "");
  form.append("batch_size", String(opts.batchSize ?? 5));

  const res = await fetch(apiUrl(opts.baseUrl || getVocalbookUrl(), "/api/convert"), {
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

export async function getVocalbookJob(jobId: string, baseUrl = getVocalbookUrl()): Promise<VocalbookJob> {
  const res = await fetch(apiUrl(baseUrl, `/api/jobs/${encodeURIComponent(jobId)}`));
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  return res.json() as Promise<VocalbookJob>;
}

export async function downloadVocalbookJob(jobId: string, baseUrl = getVocalbookUrl()): Promise<Blob> {
  const res = await fetch(apiUrl(baseUrl, `/api/jobs/${encodeURIComponent(jobId)}/download`));
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return res.blob();
}
