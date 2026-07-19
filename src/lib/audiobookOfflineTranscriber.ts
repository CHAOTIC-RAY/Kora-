/**
 * On-device audiobook transcription (no Gemini / no cloud API).
 * Uses local Whisper via @xenova/transformers after a track is downloaded.
 */

import { getAudiobookTrack } from "./audiobookStorage";
import {
  getAudiobookTranscript,
  saveAudiobookTranscript,
  type TranscriptCue,
} from "./audiobookTranscriptStorage";

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 28;
const MAX_TRACK_SECONDS = 45 * 60; // safety cap per track for device CPU

type ProgressCb = (progress: number, message?: string) => void;

let whisperPipeline: any = null;
let whisperLoading: Promise<any> | null = null;

async function getWhisper() {
  if (whisperPipeline) return whisperPipeline;
  if (!whisperLoading) {
    whisperLoading = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      // Cache models in browser cache; run fully on-device.
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      return pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
        quantized: true,
      });
    })().catch((error) => {
      whisperLoading = null;
      throw error;
    });
  }
  whisperPipeline = await whisperLoading;
  return whisperPipeline;
}

function downsampleTo16k(channelData: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === TARGET_SAMPLE_RATE) return channelData;
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const newLength = Math.floor(channelData.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const start = Math.floor(i * ratio);
    result[i] = channelData[start] || 0;
  }
  return result;
}

async function decodeTrackToMono16k(blob: Blob): Promise<{ samples: Float32Array; duration: number }> {
  const buffer = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, TARGET_SAMPLE_RATE, TARGET_SAMPLE_RATE);
  const decoded = await ctx.decodeAudioData(buffer.slice(0));
  const channel = decoded.numberOfChannels > 0 ? decoded.getChannelData(0) : new Float32Array();
  const samples = downsampleTo16k(channel, decoded.sampleRate);
  const duration = samples.length / TARGET_SAMPLE_RATE;
  return { samples, duration };
}

function sliceSamples(samples: Float32Array, startSec: number, endSec: number): Float32Array {
  const start = Math.floor(startSec * TARGET_SAMPLE_RATE);
  const end = Math.min(samples.length, Math.floor(endSec * TARGET_SAMPLE_RATE));
  return samples.subarray(start, Math.max(start, end));
}

export async function transcribeDownloadedTrack(
  bookId: string,
  trackIndex: number,
  trackTitle: string,
  onProgress?: ProgressCb
): Promise<StoredResult> {
  const existing = await getAudiobookTranscript(bookId, trackIndex);
  if (existing?.status === "ready" && existing.cues.length) {
    return { ok: true, cues: existing.cues, fullText: existing.fullText };
  }

  await saveAudiobookTranscript({
    bookId,
    trackIndex,
    trackTitle,
    status: "processing",
    progress: 2,
    cues: existing?.cues || [],
    fullText: existing?.fullText || "",
  });
  onProgress?.(2, "Loading on-device speech model…");

  const track = await getAudiobookTrack(bookId, trackIndex);
  if (!track?.blob) {
    await saveAudiobookTranscript({
      bookId,
      trackIndex,
      trackTitle,
      status: "error",
      progress: 0,
      cues: [],
      fullText: "",
      error: "Track file missing",
    });
    return { ok: false, cues: [], fullText: "", error: "Track file missing" };
  }

  try {
    const asr = await getWhisper();
    onProgress?.(8, "Decoding audio…");
    const { samples, duration } = await decodeTrackToMono16k(track.blob);
    const usableDuration = Math.min(duration, MAX_TRACK_SECONDS);
    const cues: TranscriptCue[] = [];
    const chunkCount = Math.max(1, Math.ceil(usableDuration / CHUNK_SECONDS));

    for (let i = 0; i < chunkCount; i++) {
      const start = i * CHUNK_SECONDS;
      const end = Math.min(usableDuration, start + CHUNK_SECONDS);
      const chunk = sliceSamples(samples, start, end);
      if (chunk.length < TARGET_SAMPLE_RATE * 0.4) continue;

      const result = await asr(chunk, {
        return_timestamps: true,
        chunk_length_s: CHUNK_SECONDS,
        stride_length_s: 4,
      });

      const text = typeof result?.text === "string" ? result.text.trim() : "";
      const chunks = Array.isArray(result?.chunks) ? result.chunks : null;

      if (chunks?.length) {
        for (const part of chunks) {
          const partText = String(part?.text || "").trim();
          if (!partText) continue;
          const ts = part.timestamp || [0, end - start];
          const localStart = typeof ts[0] === "number" ? ts[0] : 0;
          const localEnd = typeof ts[1] === "number" ? ts[1] : end - start;
          cues.push({
            start: start + Math.max(0, localStart),
            end: start + Math.max(localStart + 0.4, localEnd),
            text: partText,
          });
        }
      } else if (text) {
        cues.push({ start, end, text });
      }

      const progress = Math.min(99, Math.round(10 + ((i + 1) / chunkCount) * 88));
      const fullText = cues.map((cue) => cue.text).join(" ").replace(/\s+/g, " ").trim();
      await saveAudiobookTranscript({
        bookId,
        trackIndex,
        trackTitle,
        status: "processing",
        progress,
        cues,
        fullText,
      });
      onProgress?.(progress, `Transcribing ${Math.round(end)}s / ${Math.round(usableDuration)}s`);
    }

    const fullText = cues.map((cue) => cue.text).join(" ").replace(/\s+/g, " ").trim();
    await saveAudiobookTranscript({
      bookId,
      trackIndex,
      trackTitle,
      status: cues.length ? "ready" : "error",
      progress: cues.length ? 100 : 0,
      cues,
      fullText,
      error: cues.length ? undefined : "No speech detected",
    });
    onProgress?.(100, cues.length ? "Transcript ready" : "No speech detected");
    return { ok: cues.length > 0, cues, fullText };
  } catch (error) {
    const message = (error as Error).message || "Transcription failed";
    await saveAudiobookTranscript({
      bookId,
      trackIndex,
      trackTitle,
      status: "error",
      progress: 0,
      cues: [],
      fullText: "",
      error: message,
    });
    onProgress?.(0, message);
    return { ok: false, cues: [], fullText: "", error: message };
  }
}

interface StoredResult {
  ok: boolean;
  cues: TranscriptCue[];
  fullText: string;
  error?: string;
}
