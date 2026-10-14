import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookMetadata } from "../lib/firebase";
import { getBookFile } from "../db/indexedDB";
import { openArchive, releaseArchive, describeArchive, type ArchiveHandle } from "../lib/formats/archive";
import ComicReader from "./ComicReader";

export interface BookReaderComicProps {
  book: BookMetadata;
  userId: string;
  onClose: () => void;
  onProgressUpdate?: (updatedBook: BookMetadata) => void;
}

export default function BookReaderComic({ book, userId, onClose, onProgressUpdate }: BookReaderComicProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [formatLabel, setFormatLabel] = useState<string | undefined>(undefined);
  const handleRef = useRef<ArchiveHandle | null>(null);

  const chapter = useMemo<{ url: string; name: string }>(
    () => ({ url: book.id, name: book.title }),
    [book.id, book.title],
  );

  const close = useCallback(() => {
    if (handleRef.current) {
      releaseArchive(handleRef.current);
      handleRef.current = null;
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const fileData = await getBookFile(book.id);
        if (!fileData?.blob) {
          throw new Error(
            "This comic is not cached locally. Re-import it from the Workshop.",
          );
        }
        const bytes = new Uint8Array(await fileData.blob.arrayBuffer());
        const result = await openArchive(bytes, fileData.fileName || book.filename || book.title);
        if (cancelled) {
          if (result.status === "ok" && result.handle) releaseArchive(result.handle);
          return;
        }
        if (result.status !== "ok") {
          throw new Error(result.message);
        }
        handleRef.current = result.handle ?? null;
        setFormatLabel(describeArchive(result.detection));
        setPages(result.pages.map((p) => p.url));
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to open comic.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (handleRef.current) {
        releaseArchive(handleRef.current);
        handleRef.current = null;
      }
    };
  }, [book.id, book.filename, book.title]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] bg-kindle-bg flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-kindle-accent border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-kindle-text-muted">Opening comic…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-kindle-bg z-[100] flex flex-col items-center justify-center p-8 text-center">
        <div className="max-w-md space-y-4 bg-kindle-card p-8 rounded-3xl border border-kindle-border shadow-2xl">
          <p className="text-sm text-kindle-text font-medium">{error}</p>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-widest hover:bg-kindle-bg transition"
          >
            Return to Library
          </button>
        </div>
      </div>
    );
  }

  return (
    <ComicReader
      pages={pages.map((url) => ({ url }))}
      chapter={chapter}
      seriesTitle={book.title}
      formatLabel={formatLabel}
      rtl={true}
      onClose={close}
      onIndexChange={(i) => {
        // Persist position so ComicDetailView-style resume can read it later.
        onProgressUpdate?.({ ...book, progress: { percent: 0, lastReadTime: Date.now(), pageNumber: i + 1, totalPages: pages.length } });
      }}
    />
  );
}
