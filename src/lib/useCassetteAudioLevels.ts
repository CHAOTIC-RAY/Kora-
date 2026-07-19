import { useEffect, useRef, useState } from "react";

const audioGraphs = new WeakMap<HTMLAudioElement, { ctx: AudioContext; analyser: AnalyserNode }>();

function getAnalyser(audio: HTMLAudioElement): AnalyserNode | null {
  if (typeof window === "undefined") return null;
  try {
    let graph = audioGraphs.get(audio);
    if (!graph) {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      graph = { ctx, analyser };
      audioGraphs.set(audio, graph);
    }
    if (graph.ctx.state === "suspended") {
      void graph.ctx.resume();
    }
    return graph.analyser;
  } catch {
    return null;
  }
}

export function useCassetteAudioLevels(
  playing: boolean,
  getAudioElement?: () => HTMLAudioElement | null,
  voiceMode = false,
  barCount = 24
): number[] {
  const [levels, setLevels] = useState<number[]>(() => Array(barCount).fill(0));
  const frameRef = useRef<number>(0);
  const phaseRef = useRef(0);

  useEffect(() => {
    if (!playing) {
      setLevels(Array(barCount).fill(0));
      return;
    }

    const data = new Uint8Array(barCount);

    const tick = () => {
      const audio = getAudioElement?.() ?? null;
      const analyser = audio && !voiceMode ? getAnalyser(audio) : null;

      if (analyser) {
        analyser.getByteFrequencyData(data);
        setLevels(Array.from(data, (v) => v / 255));
      } else {
        phaseRef.current += 0.11;
        const t = phaseRef.current;
        setLevels(
          Array.from({ length: barCount }, (_, i) => {
            const wave =
              Math.abs(Math.sin(t * 2.4 + i * 0.55)) *
              Math.abs(Math.sin(t * 5.1 + i * 0.18));
            const burst = Math.max(0, Math.sin(t * 0.7 + i * 0.08)) * 0.35;
            return Math.min(1, 0.12 + wave * 0.72 + burst);
          })
        );
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [barCount, getAudioElement, playing, voiceMode]);

  return levels;
}
