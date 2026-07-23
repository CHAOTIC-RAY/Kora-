/**
 * Unified TTS bridge — Android uses native TextToSpeech via Capacitor;
 * web/desktop keeps the Web Speech API.
 */

import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid } from "./capacitorNative";

export interface KoraVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
  /** Index into Android TextToSpeech.getVoices() list */
  nativeIndex?: number;
}

interface NativeVoiceRow {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
  index?: number;
  voiceURI?: string;
}

interface KoraTtsPluginApi {
  ensureReady(): Promise<{ ready: boolean; engine?: string; error?: string }>;
  getVoices(): Promise<{
    voices: NativeVoiceRow[];
    ready?: boolean;
    engine?: string;
    error?: string;
  }>;
  speak(options: {
    text: string;
    lang?: string;
    rate?: number;
    pitch?: number;
    voiceIndex?: number;
    voiceName?: string;
  }): Promise<void>;
  stop(): Promise<void>;
  isSpeaking(): Promise<{ speaking: boolean }>;
  openInstall(): Promise<void>;
}

const KoraTtsNative = registerPlugin<KoraTtsPluginApi>("KoraTts");

let nativeVoiceCache: KoraVoice[] = [];
let nativeReady: boolean | null = null;
let nativeError: string | null = null;
let nativeEngine: string | null = null;

export function usesNativeTts(): boolean {
  return isNativeAndroid();
}

export function getNativeTtsStatus(): {
  ready: boolean | null;
  error: string | null;
  engine: string | null;
} {
  return { ready: nativeReady, error: nativeError, engine: nativeEngine };
}

export function getCachedNativeVoices(): KoraVoice[] {
  return nativeVoiceCache.slice();
}

function mapNativeVoices(rows: NativeVoiceRow[]): KoraVoice[] {
  return (rows || []).map((row, i) => ({
    name: row.name || `Voice ${i + 1}`,
    lang: row.lang || "und",
    voiceURI: row.voiceURI || row.name || `native-${i}`,
    localService: row.localService !== false,
    default: !!row.default,
    nativeIndex: typeof row.index === "number" ? row.index : i,
  }));
}

/** Load / refresh Android system TTS voices into the JS cache. */
export async function refreshNativeVoices(): Promise<KoraVoice[]> {
  if (!usesNativeTts()) return [];
  try {
    const ready = await KoraTtsNative.ensureReady();
    nativeReady = !!ready.ready;
    nativeError = ready.error || null;
    nativeEngine = ready.engine || null;

    const result = await KoraTtsNative.getVoices();
    nativeReady = result.ready ?? nativeReady;
    nativeError = result.error || nativeError;
    nativeEngine = result.engine || nativeEngine;
    nativeVoiceCache = mapNativeVoices(result.voices || []);
    return nativeVoiceCache.slice();
  } catch (err) {
    nativeReady = false;
    nativeError = (err as Error)?.message || "Native TTS unavailable";
    nativeVoiceCache = [];
    return [];
  }
}

export async function openNativeTtsInstall(): Promise<void> {
  if (!usesNativeTts()) return;
  await KoraTtsNative.openInstall();
}

export async function stopNativeSpeech(): Promise<void> {
  if (!usesNativeTts()) return;
  try {
    await KoraTtsNative.stop();
  } catch {
    /* ignore */
  }
}

export async function isNativeSpeaking(): Promise<boolean> {
  if (!usesNativeTts()) return false;
  try {
    const { speaking } = await KoraTtsNative.isSpeaking();
    return !!speaking;
  } catch {
    return false;
  }
}

export interface SpeakTextOptions {
  rate?: number;
  pitch?: number;
  voiceName?: string;
  voiceLang?: string;
  voiceIndex?: number;
  /** Abort if another speak starts (web only via cancel). */
  signal?: { aborted?: boolean };
}

/**
 * Speak text with the best available engine.
 * Resolves when the utterance finishes (or is interrupted/stopped).
 */
export async function speakText(text: string, opts: SpeakTextOptions = {}): Promise<void> {
  const trimmed = (text || "").trim();
  if (!trimmed) return;

  if (usesNativeTts()) {
    if (!nativeVoiceCache.length) {
      await refreshNativeVoices();
    }
    let voiceIndex = opts.voiceIndex;
    if (voiceIndex == null && opts.voiceName) {
      const match = nativeVoiceCache.find((v) => v.name === opts.voiceName);
      if (match && typeof match.nativeIndex === "number") voiceIndex = match.nativeIndex;
    }
    try {
      await KoraTtsNative.speak({
        text: trimmed,
        lang: opts.voiceLang || "en-US",
        rate: opts.rate ?? 1,
        pitch: opts.pitch ?? 1,
        voiceIndex,
        voiceName: opts.voiceName,
      });
    } catch (err) {
      // Interrupted / stopped resolves as success for queue flow; real errors throw.
      const message = (err as Error)?.message || String(err);
      if (/interrupt|cancel|stop/i.test(message)) return;
      throw err instanceof Error ? err : new Error(message);
    }
    return;
  }

  if (typeof window === "undefined" || !window.speechSynthesis) {
    throw new Error("Text-to-speech is not supported in this browser.");
  }

  await new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.rate = opts.rate ?? 1;
    utterance.pitch = opts.pitch ?? 1;
    if (opts.voiceLang) utterance.lang = opts.voiceLang;

    if (opts.voiceName) {
      const voices = window.speechSynthesis.getVoices();
      const match =
        voices.find((v) => v.name === opts.voiceName) ||
        voices.find((v) => opts.voiceLang && v.lang === opts.voiceLang);
      if (match) utterance.voice = match;
    }

    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") resolve();
      else reject(new Error(event.error || "Speech failed"));
    };
    window.speechSynthesis.speak(utterance);
  });
}

export async function cancelSpeech(): Promise<void> {
  if (usesNativeTts()) {
    await stopNativeSpeech();
    return;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
