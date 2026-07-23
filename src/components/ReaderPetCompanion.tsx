import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  getPetById,
  getPetMoodFrames,
  moodLabel,
  PetId,
  PetMood,
  pickDominantMood,
  scoreTextMoods,
  SPRITE_SIZE,
} from "../lib/readerPet";

interface ReaderPetCompanionProps {
  enabled: boolean;
  petId: PetId;
  /** Visible page / chapter text for lexicon mood. */
  pageText: string;
  /** Bumps on page or chapter change to trigger hop. */
  pageSignal: number;
  /** Corner placement */
  corner?: "br" | "bl";
}

const PIXEL = 4; // CSS px per sprite pixel → 16*4 = 64px sprite
const DISPLAY = SPRITE_SIZE * PIXEL;

const FRAME_MS: Record<PetMood, number> = {
  idle: 520,
  sleepy: 900,
  happy: 280,
  sad: 700,
  scared: 220,
  angry: 200,
  love: 320,
  curious: 400,
  pageTurn: 140,
};

export default function ReaderPetCompanion({
  enabled,
  petId,
  pageText,
  pageSignal,
  corner = "br",
}: ReaderPetCompanionProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastInteractRef = useRef(Date.now());
  const [mood, setMood] = useState<PetMood>("idle");
  const [frameIdx, setFrameIdx] = useState(0);
  const [hop, setHop] = useState(false);
  const [awakeBoostUntil, setAwakeBoostUntil] = useState(0);

  const pet = useMemo(() => getPetById(petId), [petId]);
  const frames = useMemo(() => getPetMoodFrames(petId, mood), [petId, mood]);

  // Track reading activity / page turns
  useEffect(() => {
    if (!enabled) return;
    lastInteractRef.current = Date.now();
    setHop(true);
    setMood("pageTurn");
    const t = window.setTimeout(() => setHop(false), 480);
    return () => window.clearTimeout(t);
  }, [pageSignal, enabled]);

  // Lexicon mood + sleepy idle clock
  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      const now = Date.now();
      if (now < awakeBoostUntil) {
        setMood((prev) => (prev === "sleepy" ? "idle" : prev));
        return;
      }
      const idleMs = now - lastInteractRef.current;
      const scores = scoreTextMoods(pageText || "");
      const next = pickDominantMood(scores, {
        idleMs,
        hour: new Date().getHours(),
        forcePageTurn: hop,
      });
      setMood((prev) => (prev === "pageTurn" && hop ? "pageTurn" : next));
    };

    tick();
    const id = window.setInterval(tick, 1200);
    return () => window.clearInterval(id);
  }, [enabled, pageText, hop, awakeBoostUntil]);

  // Frame advance
  useEffect(() => {
    if (!enabled) return;
    setFrameIdx(0);
    const ms = FRAME_MS[mood] || 500;
    const id = window.setInterval(() => {
      setFrameIdx((i) => (i + 1) % Math.max(1, frames.length));
    }, ms);
    return () => window.clearInterval(id);
  }, [mood, enabled, frames, petId]);

  // Draw sprite
  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const frame = frames[frameIdx % frames.length];
    if (!frame) return;
    const size = frame.length;
    canvas.width = size;
    canvas.height = size;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);

    for (let y = 0; y < size; y++) {
      const row = frame[y];
      if (!row) continue;
      for (let x = 0; x < size; x++) {
        const idx = row[x];
        if (!idx) continue;
        const color = pet.palette[idx] || pet.palette[2];
        if (!color || color === "transparent") continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, [enabled, mood, frameIdx, pet, frames]);

  if (!enabled) return null;

  const cornerClass =
    corner === "bl"
      ? "left-3 md:left-6"
      : "right-3 md:right-6";

  return (
    <div
      className={`pointer-events-auto fixed z-[45] ${cornerClass}`}
      style={{ bottom: "max(4.75rem, calc(var(--kora-safe-bottom) + 3.75rem))" }}
      data-kora-pet-companion
    >
      <button
        type="button"
        onClick={() => {
          lastInteractRef.current = Date.now();
          setAwakeBoostUntil(Date.now() + 20_000);
          setMood("happy");
          setHop(true);
          window.setTimeout(() => setHop(false), 400);
        }}
        className="group relative flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-black/35 backdrop-blur-md px-2.5 pt-2 pb-1.5 shadow-lg shadow-black/30 hover:bg-black/45 transition"
        title={`${pet.name} — tap to wake`}
        aria-label={`${pet.name}, ${moodLabel(mood)}. Tap to interact.`}
      >
        <div
          className={`relative ${hop ? "kora-pet-hop" : mood === "sleepy" ? "kora-pet-breathe" : "kora-pet-float"}`}
          style={{ width: DISPLAY, height: DISPLAY }}
        >
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ imageRendering: "pixelated", width: DISPLAY, height: DISPLAY }}
          />
          {mood === "sleepy" ? (
            <span className="absolute -top-1 -right-0.5 text-[10px] opacity-80 kora-pet-zzz" aria-hidden>
              z
            </span>
          ) : null}
        </div>
        <span
          className="text-[8px] font-mono uppercase tracking-wider opacity-70 max-w-[4.5rem] truncate"
          style={{ color: pet.accent }}
        >
          {pet.name}
        </span>
        <span className="text-[8px] font-sans opacity-50 max-w-[5rem] truncate leading-none pb-0.5">
          {moodLabel(mood)}
        </span>
      </button>

      <style>{`
        @keyframes kora-pet-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @keyframes kora-pet-hop {
          0% { transform: translateY(0) scale(1); }
          35% { transform: translateY(-10px) scale(1.05); }
          70% { transform: translateY(-2px) scale(0.98); }
          100% { transform: translateY(0) scale(1); }
        }
        @keyframes kora-pet-breathe {
          0%, 100% { transform: translateY(2px) scale(1, 0.96); }
          50% { transform: translateY(0) scale(1, 1); }
        }
        @keyframes kora-pet-zzz {
          0% { opacity: 0.2; transform: translate(0, 0); }
          50% { opacity: 0.9; transform: translate(2px, -4px); }
          100% { opacity: 0.2; transform: translate(0, -8px); }
        }
        .kora-pet-float { animation: kora-pet-float 2.4s ease-in-out infinite; }
        .kora-pet-hop { animation: kora-pet-hop 0.45s ease-out; }
        .kora-pet-breathe { animation: kora-pet-breathe 2.8s ease-in-out infinite; }
        .kora-pet-zzz { animation: kora-pet-zzz 1.8s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

/** Tiny static preview for the settings pet picker. */
export function PetSpriteThumb({
  petId,
  sizePx = 28,
}: {
  petId: PetId;
  sizePx?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pet = useMemo(() => getPetById(petId), [petId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const frame = getPetMoodFrames(petId, "idle")[0];
    if (!frame) return;
    const size = frame.length;
    canvas.width = size;
    canvas.height = size;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      const row = frame[y];
      if (!row) continue;
      for (let x = 0; x < size; x++) {
        const idx = row[x];
        if (!idx) continue;
        const color = pet.palette[idx] || pet.palette[2];
        if (!color || color === "transparent") continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, [petId, pet]);

  return (
    <canvas
      ref={canvasRef}
      className="shrink-0"
      style={{
        width: sizePx,
        height: sizePx,
        imageRendering: "pixelated",
      }}
      aria-hidden
    />
  );
}
