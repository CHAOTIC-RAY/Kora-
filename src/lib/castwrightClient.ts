/**
 * Client for a local Castwright instance (https://github.com/dudarenok-maker/Castwright).
 * Kora talks to Castwright over HTTP — Castwright must be running on the user's machine.
 */

import JSZip from "jszip";

const STORAGE_KEY = "kora_castwright_url";
const DEFAULT_URL = "http://localhost:8080";

export type CastwrightModelKey =
  | "kokoro-v1"
  | "qwen3-tts-0.6b"
  | "qwen3-tts-1.7b"
  | "coqui-xtts-v2"
  | "gemini-2.5-flash"
  | "gemini-3.1-flash";

export interface CastwrightHealth {
  ok: boolean;
  sidecarReachable?: boolean;
  detail?: string;
}

export interface ImportCandidate {
  title?: string;
  author?: string;
  series?: string;
  language?: string;
  chapters?: { id: number; title: string; slug?: string; isLikelyFrontMatter?: boolean }[];
}

export interface ImportResponse {
  tempId: string;
  candidate: ImportCandidate;
}

export interface ConfirmBookResponse {
  bookId: string;
  manuscriptId: string;
  title: string;
}

export interface CastwrightCharacter {
  id: string;
  name: string;
  aliases?: string[];
  gender?: string;
  ageRange?: string;
  attributes?: string[];
  voiceId?: string;
  matchedFrom?: {
    bookId?: string;
    characterId?: string;
    bookTitle?: string;
    confidence?: number;
  };
  voiceState?: string;
}

export interface AnalyseResponse {
  bookId: string;
  manuscriptId: string;
  title: string;
  characters: CastwrightCharacter[];
  chapters: { id: number; title: string; slug?: string }[];
}

export interface VoiceMatchCandidate {
  voiceId: string;
  fromBookId?: string;
  fromBookTitle?: string;
  fromCharacterId?: string;
  score: number;
}

export interface VoiceMatchResponse {
  bookId: string;
  matches: { characterId: string; candidates: VoiceMatchCandidate[] }[];
}

export interface BookExportJob {
  id: string;
  bookId: string;
  format: string;
  destination: string;
  status: "queued" | "in_progress" | "done" | "failed" | "cancelled";
  filename: string;
  progress?: number | null;
  downloadUrl?: string | null;
  errorReason?: string | null;
}

export type ConversionStage =
  | "idle"
  | "importing"
  | "confirming"
  | "analysing"
  | "matching"
  | "generating"
  | "exporting"
  | "importing-to-library"
  | "done"
  | "error";

export interface ConversionProgress {
  stage: ConversionStage;
  message: string;
  percent: number;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getCastwrightUrl(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return normalizeBaseUrl(saved || DEFAULT_URL);
  } catch {
    return DEFAULT_URL;
  }
}

export function setCastwrightUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, normalizeBaseUrl(url));
}

function apiUrl(base: string, path: string): string {
  const root = normalizeBaseUrl(base);
  if (path.startsWith("/")) return `${root}${path}`;
  return `${root}/${path}`;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function consumeSse<T>(
  res: Response,
  onEvent: (payload: Record<string, unknown>) => void
): Promise<T | null> {
  if (!res.body) throw new Error("No response body for SSE stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLines = raw
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6));
      if (!dataLines.length) continue;
      const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      onEvent(payload);
      if (payload.kind === "result" && payload.response) {
        result = payload.response as T;
      } else if (payload.kind === "error") {
        throw new Error(String(payload.message || "Stream failed"));
      }
      if (payload.type === "idle") {
        return result;
      }
    }
  }
  return result;
}

export async function checkCastwrightHealth(baseUrl = getCastwrightUrl()): Promise<CastwrightHealth> {
  try {
    const res = await fetch(apiUrl(baseUrl, "/api/sidecar/health"), {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, detail: `Castwright responded with ${res.status}` };
    }
    const data = (await res.json()) as { reachable?: boolean; status?: string };
    return {
      ok: true,
      sidecarReachable: data.reachable ?? data.status === "ok",
      detail: data.status,
    };
  } catch (err) {
    const msg = (err as Error).message || "Connection failed";
    const isCors = msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("network");
    return {
      ok: false,
      detail: isCors
        ? "Cannot reach Castwright. Ensure it is running locally and CORS allows this origin (try the /castwright-api dev proxy)."
        : msg,
    };
  }
}

export async function importManuscript(
  file: Blob,
  fileName: string,
  baseUrl = getCastwrightUrl()
): Promise<ImportResponse> {
  const form = new FormData();
  form.append("file", file, fileName);
  const res = await fetch(apiUrl(baseUrl, "/api/import"), { method: "POST", body: form });
  return parseJson<ImportResponse>(res);
}

export async function confirmBook(
  body: {
    tempId: string;
    author: string;
    title: string;
    isStandalone: boolean;
    language?: string;
    excludedSlugs?: string[];
  },
  baseUrl = getCastwrightUrl()
): Promise<ConfirmBookResponse> {
  const res = await fetch(apiUrl(baseUrl, "/api/books"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    const err = (await res.json().catch(() => ({}))) as { suggestedTitle?: string };
    throw new Error(`slug_collision:${err.suggestedTitle || `${body.title} (2)`}`);
  }
  return parseJson<ConfirmBookResponse>(res);
}

export async function analyseManuscript(
  manuscriptId: string,
  onProgress?: (label: string, percent: number) => void,
  signal?: AbortSignal,
  baseUrl = getCastwrightUrl()
): Promise<AnalyseResponse> {
  const res = await fetch(apiUrl(baseUrl, `/api/manuscripts/${encodeURIComponent(manuscriptId)}/analysis`), {
    method: "POST",
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Analysis failed (${res.status})`);

  let lastPercent = 0;
  const result = await consumeSse<AnalyseResponse>(res, (payload) => {
    if (payload.kind === "phase" && typeof payload.progress === "number") {
      const pct = Math.round(payload.progress * 100);
      lastPercent = pct;
      onProgress?.(String(payload.label || "Analysing manuscript…"), pct);
    }
  });
  if (!result) throw new Error("Analysis ended without a result");
  onProgress?.("Analysis complete", 100);
  return result;
}

export async function matchVoices(
  bookId: string,
  characters: CastwrightCharacter[],
  baseUrl = getCastwrightUrl()
): Promise<VoiceMatchResponse> {
  const payload = characters.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    gender: c.gender,
    ageRange: c.ageRange,
    attributes: c.attributes || [],
  }));
  const res = await fetch(apiUrl(baseUrl, `/api/books/${encodeURIComponent(bookId)}/voice-match`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characters: payload }),
  });
  return parseJson<VoiceMatchResponse>(res);
}

export function applyVoiceMatches(
  characters: CastwrightCharacter[],
  matchResponse: VoiceMatchResponse
): CastwrightCharacter[] {
  const byId = Object.fromEntries((matchResponse.matches || []).map((m) => [m.characterId, m]));
  return characters.map((c) => {
    const m = byId[c.id];
    if (!m?.candidates?.length) return c;
    const top = m.candidates[0];
    return {
      ...c,
      voiceId: top.voiceId,
      matchedFrom: {
        bookId: top.fromBookId,
        characterId: top.fromCharacterId,
        bookTitle: top.fromBookTitle,
        confidence: top.score,
      },
      voiceState: "reused",
    };
  });
}

export async function putBookState(
  bookId: string,
  slice: "cast" | "state",
  patch: Record<string, unknown>,
  baseUrl = getCastwrightUrl()
): Promise<void> {
  const res = await fetch(apiUrl(baseUrl, `/api/books/${encodeURIComponent(bookId)}/state`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slice, patch }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `State update failed (${res.status})`);
  }
}

export async function streamGeneration(
  bookId: string,
  modelKey: CastwrightModelKey,
  onProgress: (message: string, percent: number) => void,
  signal?: AbortSignal,
  baseUrl = getCastwrightUrl()
): Promise<void> {
  const res = await fetch(apiUrl(baseUrl, `/api/books/${encodeURIComponent(bookId)}/generation`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelKey }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Generation failed (${res.status})`);

  const chapters = new Set<number>();
  let totalChapters = 0;

  await consumeSse<null>(res, (payload) => {
    if (payload.type === "resume_from" && Array.isArray(payload.completedChapterIds)) {
      for (const id of payload.completedChapterIds as number[]) chapters.add(id);
    }
    if (typeof payload.chapterId === "number") {
      totalChapters = Math.max(totalChapters, (payload.chapterId as number) + 1);
    }
    if (payload.type === "chapter_complete" && typeof payload.chapterId === "number") {
      chapters.add(payload.chapterId as number);
      const done = chapters.size;
      const total = Math.max(totalChapters, done, 1);
      onProgress(`Generated chapter ${done} of ${total}`, Math.round((done / total) * 100));
    } else if (payload.type === "progress" && typeof payload.progress === "number") {
      onProgress("Synthesising audio…", Math.round((payload.progress as number) * 100));
    } else if (payload.type === "chapter_failed") {
      throw new Error(String(payload.errorReason || "Chapter generation failed"));
    }
  });
  onProgress("Generation complete", 100);
}

export async function createExport(
  bookId: string,
  baseUrl = getCastwrightUrl()
): Promise<BookExportJob> {
  const res = await fetch(apiUrl(baseUrl, `/api/books/${encodeURIComponent(bookId)}/exports`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "mp3-zip", destination: "download" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Export request failed (${res.status})`);
  }
  return res.json() as Promise<BookExportJob>;
}

export async function pollExport(
  bookId: string,
  exportId: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  baseUrl = getCastwrightUrl()
): Promise<BookExportJob> {
  while (true) {
    if (signal?.aborted) throw new Error("Cancelled");
    const res = await fetch(
      apiUrl(baseUrl, `/api/books/${encodeURIComponent(bookId)}/exports/${encodeURIComponent(exportId)}`),
      { signal }
    );
    const job = await parseJson<BookExportJob>(res);
    if (job.status === "done") return job;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(job.errorReason || `Export ${job.status}`);
    }
    onProgress?.(Math.round((job.progress ?? 0) * 100));
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function downloadExport(
  bookId: string,
  exportId: string,
  baseUrl = getCastwrightUrl()
): Promise<Blob> {
  const res = await fetch(
    apiUrl(baseUrl, `/api/books/${encodeURIComponent(bookId)}/exports/${encodeURIComponent(exportId)}/download`)
  );
  if (!res.ok) throw new Error(`Export download failed (${res.status})`);
  return res.blob();
}

export interface ConvertedTrack {
  index: number;
  title: string;
  blob: Blob;
}

export interface ConvertBookOptions {
  file: Blob;
  fileName: string;
  title: string;
  author: string;
  modelKey?: CastwrightModelKey;
  baseUrl?: string;
  signal?: AbortSignal;
  onProgress?: (progress: ConversionProgress) => void;
}

export async function convertBookWithCastwright(opts: ConvertBookOptions): Promise<{
  tracks: ConvertedTrack[];
  castwrightBookId: string;
}> {
  const baseUrl = opts.baseUrl || getCastwrightUrl();
  const modelKey = opts.modelKey || "kokoro-v1";
  const report = (stage: ConversionStage, message: string, percent: number) => {
    opts.onProgress?.({ stage, message, percent });
  };

  report("importing", "Uploading manuscript to Castwright…", 5);
  const imported = await importManuscript(opts.file, opts.fileName, baseUrl);

  report("confirming", "Confirming book metadata…", 10);
  let title = opts.title;
  let confirmBody = {
    tempId: imported.tempId,
    author: opts.author || imported.candidate.author || "Unknown",
    title,
    isStandalone: true,
    language: imported.candidate.language || "en",
    excludedSlugs: (imported.candidate.chapters || [])
      .filter((ch) => ch.isLikelyFrontMatter)
      .map((ch) => ch.slug || String(ch.id)),
  };

  let confirmed: ConfirmBookResponse;
  try {
    confirmed = await confirmBook(confirmBody, baseUrl);
  } catch (err) {
    const msg = (err as Error).message || "";
    if (msg.startsWith("slug_collision:")) {
      title = msg.slice("slug_collision:".length);
      confirmBody = { ...confirmBody, title };
      confirmed = await confirmBook(confirmBody, baseUrl);
    } else {
      throw err;
    }
  }

  const analysis = await analyseManuscript(
    confirmed.manuscriptId,
    (message, percent) => report("analysing", message, 10 + Math.round(percent * 0.25)),
    opts.signal,
    baseUrl
  );

  report("matching", "Matching voices to cast…", 38);
  const voiceMatches = await matchVoices(confirmed.bookId, analysis.characters, baseUrl);
  const castWithVoices = applyVoiceMatches(analysis.characters, voiceMatches);
  await putBookState(confirmed.bookId, "cast", { characters: castWithVoices }, baseUrl);
  await putBookState(confirmed.bookId, "state", { castConfirmed: true }, baseUrl);

  await streamGeneration(
    confirmed.bookId,
    modelKey,
    (message, percent) => report("generating", message, 40 + Math.round(percent * 0.45)),
    opts.signal,
    baseUrl
  );

  report("exporting", "Packaging MP3 chapters…", 88);
  const exportJob = await createExport(confirmed.bookId, baseUrl);
  const doneJob = await pollExport(
    confirmed.bookId,
    exportJob.id,
    (pct) => report("exporting", "Building audiobook archive…", 88 + Math.round(pct * 0.08)),
    opts.signal,
    baseUrl
  );

  report("importing-to-library", "Downloading converted audio…", 97);
  const zipBlob = await downloadExport(confirmed.bookId, doneJob.id, baseUrl);
  const tracks = await extractMp3TracksFromZip(zipBlob);
  if (!tracks.length) throw new Error("Export contained no MP3 tracks");

  report("done", `Converted ${tracks.length} chapters`, 100);
  return { tracks, castwrightBookId: confirmed.bookId };
}

export async function extractMp3TracksFromZip(zipBlob: Blob): Promise<ConvertedTrack[]> {
  const zip = await JSZip.loadAsync(zipBlob);
  const entries = Object.entries(zip.files)
    .filter(([, f]) => !f.dir && /\.mp3$/i.test(f.name))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  const tracks: ConvertedTrack[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [name, file] = entries[i];
    const blob = await file.async("blob");
    const title = name
      .split("/")
      .pop()!
      .replace(/^\d+[-_.\s]*/, "")
      .replace(/\.mp3$/i, "")
      .trim();
    tracks.push({ index: i + 1, title: title || `Chapter ${i + 1}`, blob });
  }
  return tracks;
}
