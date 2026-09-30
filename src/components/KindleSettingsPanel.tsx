/**
 * Kindle settings panel — Send to Kindle, no credentials.
 *
 * This panel contains no credential fields, and never will. Send to Kindle
 * here works by handing the book file to the operating system: on Android
 * that is the system share sheet (where the user's own Send to Kindle app
 * appears), and on desktop it is a download plus Amazon's upload page opened
 * for a manual drag-and-drop.
 *
 * The copy here is deliberately specific about which path will run, because
 * the two paths are genuinely different and the user should know before they
 * tap, not after.
 */

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  SEND_TO_KINDLE_URL,
  canShareFiles,
  sendToKindle,
  type KindleSendMethod,
} from "../lib/sources/kindleClient";
import { listCachedBookIds, getBookFile } from "../db/indexedDB";

interface CachedBook {
  id: string;
  fileName: string;
  extension: string;
}

function useCachedBooks(): { books: CachedBook[]; loading: boolean; failed: boolean } {
  const [books, setBooks] = useState<CachedBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ids = await listCachedBookIds();
      const rows = await Promise.all(
        ids.map(async (id) => {
          try {
            const rec = await getBookFile(id);
            if (!rec) return null;
            return { id, fileName: rec.fileName, extension: rec.extension } as CachedBook;
          } catch {
            return null;
          }
        })
      );
      setBooks(rows.filter((r): r is CachedBook => r !== null));
      setFailed(false);
    } catch (err) {
      console.warn("[Kora/Kindle] could not list cached books", err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { books, loading, failed };
}

export default function KindleSettingsPanel() {
  const { books, loading, failed } = useCachedBooks();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [method, setMethod] = useState<KindleSendMethod | null>(null);

  // Probe the runtime after mount so first paint can't disagree with the browser.
  useEffect(() => {
    setMethod(canShareFiles() ? "share" : "download");
  }, []);

  const share = method === "share";

  async function handleSend(book: CachedBook) {
    setBusyId(book.id);
    try {
      const result = await sendToKindle(book.id, undefined, book.extension);
      if (result.cancelled) {
        // The user backed out of the share sheet. Not an error, not a success.
        return;
      }
      if (!result.ok) {
        toast.error(result.reason || "Could not hand this book to Send to Kindle.");
        return;
      }
      if (result.method === "share") {
        toast.success(`Opened the share sheet for ${result.fileName} — tap "Send to Kindle".`);
      } else {
        toast.success(
          `Saved ${result.fileName}. Amazon's upload page is open — drag the file onto it to finish.`
        );
      }
    } catch (err) {
      console.error("[Kora/Kindle] send failed", err);
      toast.error("Could not hand this book to Send to Kindle.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-kindle-border p-4">
      <header>
        <h3 className="font-semibold text-kindle-text">Send to Kindle</h3>
        <p className="mt-0.5 text-xs text-kindle-text-muted">
          Hand a downloaded book to your Kindle. No account or API key needed.
        </p>
      </header>

      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
        <p className="text-xs font-medium text-emerald-400">How this works</p>
        <p className="mt-2 text-xs leading-relaxed text-kindle-text-muted whitespace-pre-line">
          {share
            ? "This device supports file sharing, so Kora opens the system share sheet with the book attached. Tap “Send to Kindle” there — Amazon's own app does the upload using your existing sign-in.\n\nKora never contacts Amazon and never asks for a password or key."
            : "This device can't share files to other apps, so Kora saves the book to your downloads folder and opens Amazon's upload page. Drag the downloaded file onto Amazon's drop zone to finish.\n\nThat drag is a manual step — Kora does not upload the file itself, and does not pretend to."}
        </p>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium text-kindle-text-muted">Downloaded books</p>
          {!loading && !failed && (
            <p className="text-[11px] text-kindle-text-muted">
              {books.length} {books.length === 1 ? "book" : "books"}
            </p>
          )}
        </div>

        {loading ? (
          <p className="mt-2 text-xs text-kindle-text-muted">Reading your library…</p>
        ) : failed ? (
          <p className="mt-2 text-xs text-kindle-text-muted">
            Couldn't read the local book cache. Try reloading.
          </p>
        ) : books.length === 0 ? (
          <p className="mt-2 text-xs text-kindle-text-muted">
            No books are downloaded on this device yet. Download one first, then come back.
          </p>
        ) : (
          <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {books.map((book) => (
              <li
                key={book.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-kindle-border/60 px-2.5 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-kindle-text" title={book.fileName}>
                  {book.fileName}
                </span>
                <button
                  type="button"
                  onClick={() => void handleSend(book)}
                  disabled={busyId === book.id}
                  className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {busyId === book.id ? "Opening…" : "Send"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <a
        href={SEND_TO_KINDLE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-[11px] text-kindle-text-muted underline hover:text-kindle-text"
      >
        Open Amazon&rsquo;s Send to Kindle page
      </a>
    </div>
  );
}
