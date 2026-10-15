import React, { useEffect, useMemo, useState } from "react";
import { BookMarked, Download, FileText, X } from "lucide-react";
import { BookMetadata, BookHighlight, ChapterNote, loadBookHighlights, loadChapterNotes } from "../lib/firebase";
import { downloadMarkdown, highlightsToMarkdown } from "../lib/annotationsExport";

interface AnnotationsHubProps {
  books: BookMetadata[];
  userId: string;
  onClose: () => void;
  onOpenBook?: (book: BookMetadata) => void;
}

interface BookAnnotations {
  book: BookMetadata;
  highlights: BookHighlight[];
  notes: ChapterNote[];
}

export default function AnnotationsHub({ books, userId, onClose, onOpenBook }: AnnotationsHubProps) {
  const [rows, setRows] = useState<BookAnnotations[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const readable = books.filter((b) => b.extension?.toLowerCase() !== "audiobook");
      const collected: BookAnnotations[] = [];
      for (const book of readable) {
        try {
          const [highlights, notesRecord] = await Promise.all([
            loadBookHighlights(userId, book.id),
            loadChapterNotes(userId, book.id),
          ]);
          const notes = Object.values(notesRecord || {});
          if ((highlights?.length || 0) > 0 || notes.some((n) => n.noteText?.trim())) {
            collected.push({ book, highlights: highlights || [], notes });
          }
        } catch {
          /* skip book */
        }
      }
      if (!cancelled) {
        setRows(collected);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [books, userId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows
      .map((row) => ({
        ...row,
        highlights: row.highlights.filter(
          (h) =>
            h.text.toLowerCase().includes(q) ||
            row.book.title.toLowerCase().includes(q) ||
            (h.note || "").toLowerCase().includes(q)
        ),
        notes: row.notes.filter(
          (n) =>
            (n.noteText || "").toLowerCase().includes(q) ||
            row.book.title.toLowerCase().includes(q) ||
            (n.chapterTitle || "").toLowerCase().includes(q)
        ),
      }))
      .filter((row) => row.highlights.length > 0 || row.notes.some((n) => n.noteText?.trim()));
  }, [rows, query]);

  const exportBook = (row: BookAnnotations) => {
    const md = highlightsToMarkdown({
      book: row.book,
      highlights: row.highlights,
      notes: row.notes,
    });
    downloadMarkdown(`${row.book.title} — annotations.md`, md);
  };

  const exportAll = () => {
    const chunks = filtered.map((row) =>
      highlightsToMarkdown({ book: row.book, highlights: row.highlights, notes: row.notes })
    );
    downloadMarkdown(`Kora annotations — ${new Date().toISOString().slice(0, 10)}.md`, chunks.join("\n\n---\n\n"));
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center p-0 md:p-6" role="dialog" aria-modal="true" aria-label="Annotations hub">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full md:max-w-2xl max-h-[88vh] bg-kindle-card text-kindle-text border border-kindle-border rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-kindle-border">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-kindle-accent" />
              <h2 className="font-bold text-sm">Annotations Hub</h2>
            </div>
            <p className="text-[10px] text-kindle-text-muted mt-0.5">Highlights & notes across your library</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={exportAll}
              disabled={!filtered.length}
              className="px-2.5 py-1.5 rounded-lg border border-kindle-border text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              Export MD
            </button>
            <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-black/5" aria-label="Close annotations hub">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-kindle-border">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search highlights and notes…"
            className="w-full px-3 py-2 rounded-xl border border-kindle-border bg-transparent text-sm outline-none focus:ring-1 focus:ring-kindle-accent"
            aria-label="Search annotations"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && <p className="text-xs text-kindle-text-muted text-center py-8">Loading annotations…</p>}
          {!loading && !filtered.length && (
            <p className="text-xs text-kindle-text-muted text-center py-8">No highlights or notes yet.</p>
          )}
          {filtered.map((row) => (
            <section key={row.book.id} className="rounded-xl border border-kindle-border p-3.5 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-serif font-bold text-sm truncate">{row.book.title}</h3>
                  <p className="text-[10px] text-kindle-text-muted">
                    {row.highlights.length} highlight{row.highlights.length === 1 ? "" : "s"}
                    {row.notes.filter((n) => n.noteText?.trim()).length
                      ? ` · ${row.notes.filter((n) => n.noteText?.trim()).length} note(s)`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => exportBook(row)}
                    className="p-1.5 rounded-lg border border-kindle-border"
                    title="Export Markdown"
                    aria-label={`Export annotations for ${row.book.title}`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </button>
                  {onOpenBook && (
                    <button
                      type="button"
                      onClick={() => onOpenBook(row.book)}
                      className="px-2 py-1 rounded-lg bg-kindle-accent/15 text-kindle-accent text-[10px] font-bold uppercase"
                    >
                      Open
                    </button>
                  )}
                </div>
              </div>
              <ul className="space-y-2">
                {row.highlights.slice(0, 8).map((h) => (
                  <li key={h.id} className="text-xs leading-relaxed border-l-2 border-amber-400/70 pl-2.5 opacity-90">
                    {h.text}
                  </li>
                ))}
                {row.highlights.length > 8 && (
                  <li className="text-[10px] text-kindle-text-muted">+{row.highlights.length - 8} more…</li>
                )}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
