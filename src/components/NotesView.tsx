import React, { useState, useEffect } from "react";
import { BookMetadata, loadBookHighlights, loadChapterNotes, BookHighlight, ChapterNote } from "../lib/firebase";
import { FileText, Highlighter, BookOpen, ChevronLeft, Trash2 } from "lucide-react";

export default function NotesView({ books, userId, onBack }: { books: BookMetadata[], userId: string, onBack: () => void }) {
  const [highlights, setHighlights] = useState<(BookHighlight & { bookTitle: string, bookId: string })[]>([]);
  const [notes, setNotes] = useState<(ChapterNote & { bookTitle: string, bookId: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      const allHighlights: (BookHighlight & { bookTitle: string, bookId: string })[] = [];
      const allNotes: (ChapterNote & { bookTitle: string, bookId: string })[] = [];

      for (const book of books) {
        try {
          const bookHighlights = await loadBookHighlights(userId, book.id);
          const bookNotes = await loadChapterNotes(userId, book.id);
          
          allHighlights.push(...bookHighlights.map(h => ({ ...h, bookTitle: book.title, bookId: book.id })));
          
          Object.values(bookNotes).forEach(n => {
            if (n.noteText && n.noteText.trim().length > 0) {
              allNotes.push({ ...n, bookTitle: book.title, bookId: book.id });
            }
          });
        } catch (e) {
          console.error("Failed to load for book", book.id, e);
        }
      }

      setHighlights(allHighlights.sort((a, b) => b.createdAt - a.createdAt));
      setNotes(allNotes.sort((a, b) => b.updatedAt - a.updatedAt));
      setLoading(false);
    }
    fetchAll();
  }, [books, userId]);

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 font-sans space-y-12">
      <header className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 bg-kindle-card rounded-full hover:bg-kindle-border transition text-kindle-text border border-kindle-border shadow-sm">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div>
          <h1 className="text-3xl font-serif font-bold text-kindle-text flex items-center gap-3">
            <FileText className="w-8 h-8 text-amber-500" />
            My Journal
          </h1>
          <p className="text-kindle-text-muted mt-1 text-sm">All your highlights and chapter notes</p>
        </div>
      </header>

      {loading ? (
        <div className="text-center py-20 animate-pulse text-kindle-text-muted font-medium text-sm">Loading your notes...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Notes */}
          <div className="space-y-6">
            <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-2 border-b border-kindle-border pb-2">
              <BookOpen className="w-4 h-4" />
              Chapter Notes ({notes.length})
            </h2>
            {notes.length === 0 && <p className="text-xs italic text-kindle-text-muted">No notes yet.</p>}
            {notes.map((n, i) => (
              <div key={`note-${i}`} className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-3 shadow-sm">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h3 className="font-bold text-sm text-kindle-text">{n.bookTitle}</h3>
                    <p className="text-xs text-kindle-text-muted">{n.chapterTitle}</p>
                  </div>
                </div>
                <p className="text-sm text-kindle-text whitespace-pre-wrap leading-relaxed">{n.noteText}</p>
                <div className="text-[10px] text-kindle-text-muted font-mono">{new Date(n.updatedAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>

          {/* Highlights */}
          <div className="space-y-6">
            <h2 className="text-sm font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400 flex items-center gap-2 border-b border-kindle-border pb-2">
              <Highlighter className="w-4 h-4" />
              Highlights ({highlights.length})
            </h2>
            {highlights.length === 0 && <p className="text-xs italic text-kindle-text-muted">No highlights yet.</p>}
            {highlights.map((h, i) => (
              <div key={h.id} className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-3 relative group shadow-sm">
                <div>
                  <h3 className="font-bold text-sm text-kindle-text">{h.bookTitle}</h3>
                  <p className="text-[10px] text-kindle-text-muted mt-0.5">{h.chapterTitle}</p>
                </div>
                <p className={`text-sm italic leading-relaxed text-kindle-text border-l-[3px] pl-3 ${
                  h.color === 'yellow' ? 'border-yellow-400' :
                  h.color === 'green' ? 'border-emerald-400' :
                  h.color === 'blue' ? 'border-blue-400' :
                  'border-pink-400'
                }`}>
                  "{h.text}"
                </p>
                <div className="text-[10px] text-kindle-text-muted font-mono">{new Date(h.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
