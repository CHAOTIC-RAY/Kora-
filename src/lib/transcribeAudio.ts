import { GoogleGenAI } from "@google/genai";

export async function transcribeAudioBase64(
  base64: string,
  mimeType: string,
  apiKey: string,
  previousContext?: string
): Promise<string> {
  if (!apiKey) {
    throw new Error("Transcription service is not configured.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const contextHint = previousContext?.trim()
    ? `The previous transcript ended with: "${previousContext.trim().slice(-180)}"\n`
    : "";

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || "audio/webm",
              data: base64,
            },
          },
          {
            text: `${contextHint}Transcribe every spoken word in this audiobook audio clip exactly as heard. Return only the transcript text with normal punctuation. Do not add labels, timestamps, or commentary.`,
          },
        ],
      },
    ],
  });

  const text = response.text?.trim() || "";
  return text.replace(/^["'`]+|["'`]+$/g, "").trim();
}

export function mergeTranscriptSegments(previous: string, next: string): string {
  const cleanedNext = next.replace(/\s+/g, " ").trim();
  if (!cleanedNext) return previous;
  if (!previous) return cleanedNext;

  const prevWords = previous.split(/\s+/);
  const nextWords = cleanedNext.split(/\s+/);

  let overlap = 0;
  const maxOverlap = Math.min(8, prevWords.length, nextWords.length);
  for (let size = maxOverlap; size > 0; size--) {
    const tail = prevWords.slice(-size).join(" ").toLowerCase();
    const head = nextWords.slice(0, size).join(" ").toLowerCase();
    if (tail && tail === head) {
      overlap = size;
      break;
    }
  }

  const appended = overlap > 0 ? nextWords.slice(overlap).join(" ") : cleanedNext;
  if (!appended) return previous;

  const combined = `${previous} ${appended}`.replace(/\s+/g, " ").trim();
  const sentences = combined.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [combined];
  return sentences.slice(-3).join(" ").trim();
}
