import React, { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Highlighter, StickyNote, BookMarked, ChevronRight, Quote } from "lucide-react";
import {
  BookMetadata,
  BookHighlight,
  ChapterNote,
  loadBookHighlights,
  loadChapterNotes,
} from "../lib/firebase";

type AnnotationPreview = {
  id: string;
  kind: "highlight" | "note";
  text: string;
  book: BookMetadata;
  color?: BookHighlight["color"];
  chapterTitle?: string;
  at: number;
};

type LoungeNotesWidgetProps = {
  books: BookMetadata[];
  userId: string;
  onOpenAnnotations?: () => void;
  onOpenBook?: (book: BookMetadata) => void;
};

const COLOR_DOT: Record<BookHighlight["color"], string> = {
  yellow: "bg-yellow-400",
  green: "bg-emerald-400",
  blue: "bg-sky-400",
  pink: "bg-pink-400",
};

export default function LoungeNotesWidget({
  books,
  userId,
  onOpenAnnotations,
  onOpenBook,
}: LoungeNotesWidgetProps) {
  const reduceMotion = useReducedMotion();
  const [items, setItems] = useState<AnnotationPreview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const readable = books
        .filter((b) => b.extension?.toLowerCase() !== "audiobook")
        .slice()
        .sort((a, b) => {
          const ta = a.progress?.lastReadTime || a.dateModified || a.dateAdded || 0;
          const tb = b.progress?.lastReadTime || b.dateModified || b.dateAdded || 0;
          return tb - ta;
        })
        .slice(0, 12);

      const collected: AnnotationPreview[] = [];
      for (const book of readable) {
        try {
          const [highlights, notesRecord] = await Promise.all([
            loadBookHighlights(userId, book.id),
            loadChapterNotes(userId, book.id),
          ]);
          for (const h of highlights || []) {
            if (!h.text?.trim()) continue;
            collected.push({
              id: `h-${book.id}-${h.id}`,
              kind: "highlight",
              text: h.text.trim(),
              book,
              color: h.color,
              chapterTitle: h.chapterTitle,
              at: h.createdAt || 0,
            });
          }
          for (const n of Object.values(notesRecord || {})) {
            if (!n.noteText?.trim()) continue;
            collected.push({
              id: `n-${book.id}-${n.chapterIdx}`,
              kind: "note",
              text: n.noteText.trim(),
              book,
              chapterTitle: n.chapterTitle,
              at: n.updatedAt || 0,
            });
          }
        } catch {
          /* skip */
        }
      }
      collected.sort((a, b) => b.at - a.at);
      if (!cancelled) {
        setItems(collected.slice(0, 3));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [books, userId]);

  const counts = useMemo(() => {
    let highlights = 0;
    let notes = 0;
    for (const i of items) {
      if (i.kind === "highlight") highlights += 1;
      else notes += 1;
    }
    return { highlights, notes };
  }, [items]);

  const openHub = () => onOpenAnnotations?.();

  return (
    <div className="h-full flex flex-col gap-3 min-h-0" aria-label="Notes and annotations">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-kindle-accent/15 flex items-center justify-center shrink-0">
            <BookMarked className="w-3.5 h-3.5 text-kindle-accent" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text">
              Annotate & notes
            </h3>
            <p className="text-[10px] text-kindle-text-muted truncate">
              {loading
                ? "Loading…"
                : items.length
                  ? `${counts.highlights} highlights · ${counts.notes} notes`
                  : "Highlights & chapter notes"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openHub}
          className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition shrink-0"
        >
          Hub →
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading ? (
          <div className="flex-1 rounded-2xl border border-kindle-border/60 bg-kindle-bg/40 animate-pulse min-h-[6rem]" />
        ) : items.length ? (
          items.map((item, i) => (
            <motion.button
              key={item.id}
              type="button"
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i, duration: 0.25 }}
              onClick={() => {
                if (onOpenBook) onOpenBook(item.book);
                else openHub();
              }}
              className="w-full text-left rounded-2xl border border-kindle-border/70 bg-kindle-bg/70 hover:border-kindle-accent/35 hover:bg-kindle-bg transition p-3 flex gap-2.5"
            >
              <div className="shrink-0 mt-0.5">
                {item.kind === "highlight" ? (
                  <span
                    className={`inline-flex w-2 h-2 rounded-full ${COLOR_DOT[item.color || "yellow"]}`}
                    aria-hidden
                  />
                ) : (
                  <StickyNote className="w-3.5 h-3.5 text-kindle-accent" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                  {item.kind === "highlight" ? (
                    <Highlighter className="w-3 h-3 text-kindle-text-muted shrink-0" />
                  ) : (
                    <Quote className="w-3 h-3 text-kindle-text-muted shrink-0" />
                  )}
                  <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted truncate">
                    {item.book.title}
                    {item.chapterTitle ? ` · ${item.chapterTitle}` : ""}
                  </p>
                </div>
                <p className="text-[12px] text-kindle-text leading-snug line-clamp-2">
                  {item.kind === "highlight" ? `“${item.text}”` : item.text}
                </p>
              </div>
            </motion.button>
          ))
        ) : (
          <button
            type="button"
            onClick={openHub}
            className="flex-1 flex flex-col items-center justify-center text-center px-4 py-6 gap-2 rounded-2xl border border-dashed border-kindle-border/70 bg-kindle-bg/40 hover:border-kindle-accent/30 transition min-h-[8rem]"
          >
            <Highlighter className="w-5 h-5 text-kindle-text-muted opacity-45" />
            <p className="text-xs text-kindle-text-muted leading-relaxed max-w-[16rem]">
              Select text in a book to highlight, or add a chapter note. They&apos;ll show up here.
            </p>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-kindle-accent mt-1">
              Open annotations hub <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </button>
        )}
      </div>

      {items.length > 0 && (
        <button
          type="button"
          onClick={openHub}
          className="shrink-0 self-start inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-accent transition"
        >
          View all annotations <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
