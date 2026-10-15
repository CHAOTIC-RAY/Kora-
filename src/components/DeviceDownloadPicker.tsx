import React, { useMemo, useState } from "react";
import { BookMetadata } from "../lib/firebase";
import { canHydrateBook, hydrateCapabilityLabel, hydrateBookFile } from "../lib/crossDeviceSync";
import { enqueueAudiobookDownload } from "../lib/audiobookSyncQueue";
import { BookOpen, Check, Download, Headphones, X } from "lucide-react";
import toast from "react-hot-toast";
import { resolveCoverImageSrc } from "../lib/coverImage";

interface DeviceDownloadPickerProps {
  books: BookMetadata[];
  cachedBookIds: Set<string>;
  userId: string;
  onClose: () => void;
  onCachedIdsChanged: () => void;
}

export default function DeviceDownloadPicker({
  books,
  cachedBookIds,
  userId,
  onClose,
  onCachedIdsChanged,
}: DeviceDownloadPickerProps) {
  const candidates = useMemo(
    () =>
      books.filter(
        (book) =>
          !cachedBookIds.has(book.id) &&
          (canHydrateBook(book) ||
            (book.extension?.toLowerCase() === "audiobook" && book.audiobookTracks?.length))
      ),
    [books, cachedBookIds]
  );

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(candidates.map((b) => b.id))
  );
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(candidates.map((b) => b.id)));
  const selectNone = () => setSelected(new Set());

  const handleDownload = async () => {
    const chosen = candidates.filter((b) => selected.has(b.id));
    if (!chosen.length) {
      onClose();
      return;
    }
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const book of chosen) {
      try {
        if (book.extension?.toLowerCase() === "audiobook" && book.audiobookTracks?.length) {
          await enqueueAudiobookDownload(book.id, book.title, book.audiobookTracks);
          ok++;
          continue;
        }
        const result = await hydrateBookFile(book, {
          onProgress: (label) => toast.loading(`${book.title}: ${label}`, { id: `hydrate-${book.id}` }),
        });
        toast.dismiss(`hydrate-${book.id}`);
        if (result.ok) ok++;
        else {
          fail++;
          toast.error(result.error || `Couldn't download ${book.title}`);
        }
      } catch (err) {
        fail++;
        toast.dismiss(`hydrate-${book.id}`);
        toast.error(err instanceof Error ? err.message : `Couldn't download ${book.title}`);
      }
    }
    onCachedIdsChanged();
    setBusy(false);
    if (ok) toast.success(ok === 1 ? "1 book ready on this device" : `${ok} books ready on this device`);
    if (!fail) onClose();
  };

  if (!candidates.length) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-lg max-h-[min(92dvh,40rem)] flex flex-col bg-kindle-bg border border-kindle-border rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        <header className="px-5 pt-5 pb-3 border-b border-kindle-border shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-kindle-accent">This device</p>
              <h2 className="text-lg font-lexend font-bold text-kindle-text mt-0.5">
                Choose books to download
              </h2>
              <p className="text-xs text-kindle-text-muted mt-1 leading-relaxed">
                Your library is synced. Pick what to keep offline on this device.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="p-2 rounded-xl text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-card transition"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={selectAll}
              className="text-[10px] font-bold uppercase tracking-wider text-kindle-accent hover:underline"
            >
              Select all
            </button>
            <span className="text-kindle-border">·</span>
            <button
              type="button"
              onClick={selectNone}
              className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-text"
            >
              None
            </button>
            <span className="ml-auto text-[10px] font-mono text-kindle-text-muted">
              {selected.size} of {candidates.length}
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {candidates.map((book) => {
            const checked = selected.has(book.id);
            const isAudio = book.extension?.toLowerCase() === "audiobook";
            return (
              <button
                key={book.id}
                type="button"
                onClick={() => toggle(book.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition border ${
                  checked
                    ? "bg-kindle-accent/10 border-kindle-accent/30"
                    : "bg-kindle-card/40 border-transparent hover:border-kindle-border"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                    checked
                      ? "bg-kindle-accent border-kindle-accent text-kindle-bg"
                      : "border-kindle-border text-transparent"
                  }`}
                >
                  <Check className="w-3 h-3" />
                </div>
                <div className="w-10 h-14 rounded-md overflow-hidden bg-kindle-card border border-kindle-border shrink-0">
                  {book.coverUrl ? (
                    <img
                      src={resolveCoverImageSrc(book.coverUrl) || book.coverUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {isAudio ? (
                        <Headphones className="w-4 h-4 text-kindle-text-muted" />
                      ) : (
                        <BookOpen className="w-4 h-4 text-kindle-text-muted" />
                      )}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-kindle-text truncate">{book.title}</p>
                  <p className="text-[11px] text-kindle-text-muted truncate">{book.author || "Unknown"}</p>
                  <p className="text-[9px] uppercase tracking-wider text-kindle-text-muted/80 mt-0.5">
                    {hydrateCapabilityLabel(book, false)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <footer className="p-4 border-t border-kindle-border flex gap-2 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl border border-kindle-border text-[11px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text transition"
          >
            Skip for now
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => void handleDownload()}
            className="flex-[1.4] py-3 rounded-2xl bg-kindle-text text-kindle-bg text-[11px] font-bold uppercase tracking-widest hover:bg-kindle-accent transition disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            {busy ? "Downloading…" : `Download ${selected.size || ""}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
