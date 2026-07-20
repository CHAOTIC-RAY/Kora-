import type { BookHighlight, BookMetadata, ChapterNote } from "./firebase";

export function highlightsToMarkdown(opts: {
  book: BookMetadata;
  highlights: BookHighlight[];
  notes?: ChapterNote[];
}): string {
  const { book, highlights, notes = [] } = opts;
  const lines: string[] = [
    `# ${book.title}`,
    "",
    `*Author:* ${book.author || "Unknown"}`,
    `*Exported from Kora:* ${new Date().toISOString().slice(0, 10)}`,
    "",
  ];

  if (highlights.length) {
    lines.push("## Highlights", "");
    const sorted = [...highlights].sort((a, b) => (a.chapterIdx ?? 0) - (b.chapterIdx ?? 0));
    for (const h of sorted) {
      const color = h.color || "yellow";
      const ch = typeof h.chapterIdx === "number" ? `Ch. ${h.chapterIdx + 1}` : "Highlight";
      lines.push(`> ${h.text.trim()}`, "");
      lines.push(`— *${ch}* · ${color}${h.note ? ` · ${h.note}` : ""}`, "");
    }
  }

  if (notes.length) {
    lines.push("## Notes", "");
    const sortedNotes = [...notes].sort((a, b) => (a.chapterIdx ?? 0) - (b.chapterIdx ?? 0));
    for (const n of sortedNotes) {
      if (!n.noteText?.trim()) continue;
      lines.push(`### ${n.chapterTitle || `Chapter ${(n.chapterIdx ?? 0) + 1}`}`, "");
      lines.push(n.noteText.trim(), "");
    }
  }

  if (!highlights.length && !notes.some((n) => n.noteText?.trim())) {
    lines.push("_No highlights or notes yet._", "");
  }

  return lines.join("\n");
}

export async function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const safe = filename.replace(/[^\w.\- ]+/g, "_");
  try {
    const { shareOrDownloadBlob } = await import("./iosPwa");
    await shareOrDownloadBlob(blob, safe.endsWith(".md") ? safe : `${safe}.md`, "Kora notes");
  } catch {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safe;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
