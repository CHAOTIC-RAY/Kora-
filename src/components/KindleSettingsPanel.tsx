/**
 * Send to Kobo/Kindle — the panel behind the Workshop tile.
 *
 * What changed and why. This used to download the book and open Amazon's page,
 * which the user reported as "send to kindle just downloads the book". That was
 * not a bug in the download; it was the whole implementation. Amazon offers no
 * third-party upload API (see `koboKindleSender.ts`), so the panel now offers
 * the senders that genuinely upload, plus Amazon's official page kept as an
 * explicitly-labelled alternative.
 *
 * The routes are shown as what they are, side by side:
 *
 *  1. SEND TO KOBO/KINDLE via send.djazz.se — a real multipart upload from this
 *     page. No account in Kora, no credential. Needs the 4-character code the
 *     device's own browser displays.
 *  2. KINDLEDROP (kdrop.me) — opens their page for the user to drop the file in.
 *     Cannot be automated: the site is behind a Cloudflare Turnstile human check
 *     and its `api.kdrop.me` host does not resolve. Stated in the UI, not hidden.
 *  3. AMAZON'S SEND TO KINDLE — the official page, kept as an alternative, and
 *     still the right answer on Android where the system's own Send to Kindle
 *     app is one tap away.
 *
 * No route ever silently degrades into another: every button says which path it
 * takes and the result toast names the path that actually ran. A cancelled
 * share is reported as cancelled — never as a failure, never as success — per
 * the convention at the top of `koboKindleSender.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AMAZON_SEND_URL,
  EREADER_ACCEPT,
  EREADER_KEY_LENGTH,
  EREADER_URL,
  KDROP_URL,
  KOBO_KINDLE_LABEL,
  normalizeEreaderKey,
  openManualSender,
  shareOrDownloadForAmazon,
  uploadToEreader,
  type EreaderResult,
} from "../lib/sources/koboKindleSender";
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
      console.warn("[Kora/Ereader] could not list cached books", err);
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

/** The bytes, straight out of the cache the download already wrote. */
async function readCachedBlob(bookId: string) {
  const rec = await getBookFile(bookId);
  if (!rec) return null;
  return { blob: rec.blob, fileName: rec.fileName, extension: rec.extension };
}

/** One toast per result, so the route that ran is always named. */
function report(result: EreaderResult) {
  if (result.cancelled) {
    // The user changed their mind. Not an error, and not a success.
    toast(result.reason, { icon: "🚫" });
    return;
  }
  if (result.ok) {
    toast.success(result.reason);
    return;
  }
  toast.error(result.reason);
}

export default function KindleSettingsPanel() {
  const { books, loading, failed } = useCachedBooks();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rawKey, setRawKey] = useState("");
  const [kepubify, setKepubify] = useState(true);
  const [kindlegen, setKindlegen] = useState(false);

  // Normalised live so the button can be disabled before the tap, rather than
  // failing after it. A short code is the normal state, not an error.
  const key = useMemo(() => normalizeEreaderKey(rawKey), [rawKey]);
  const keyLooksShort = rawKey.trim().length > 0 && !key;

  async function handleUpload(book: CachedBook) {
    setBusyId(book.id);
    try {
      const result = await uploadToEreader(book.id, {
        key: rawKey,
        title: book.id,
        extension: book.extension,
        kepubify,
        kindlegen,
        getCachedFile: readCachedBlob,
      });
      report(result);
    } catch (err) {
      console.error("[Kora/Ereader] upload failed", err);
      toast.error("Could not start the upload.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleAmazon(book: CachedBook) {
    setBusyId(book.id);
    try {
      const result = await shareOrDownloadForAmazon(book.id, {
        title: book.id,
        extension: book.extension,
        getCachedFile: readCachedBlob,
        createObjectUrl:
          typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
            ? (blob: Blob) => URL.createObjectURL(blob)
            : undefined,
        revokeObjectUrl:
          typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function"
            ? (url: string) => URL.revokeObjectURL(url)
            : undefined,
      });
      report(result);
    } catch (err) {
      console.error("[Kora/Ereader] amazon handoff failed", err);
      toast.error("Could not hand this book to Amazon.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-kindle-border p-4">
      <header>
        <h3 className="font-semibold text-kindle-text">{KOBO_KINDLE_LABEL}</h3>
        <p className="mt-0.5 text-xs text-kindle-text-muted">
          Actually uploads a book to your Kobo or Kindle. No account, no API key.
        </p>
      </header>

      {/* ── Route 1: the real upload ───────────────────────────────────── */}
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
        <p className="text-xs font-medium text-emerald-400">1. Upload straight to your device</p>
        <p className="mt-2 text-xs leading-relaxed text-kindle-text-muted">
          Kora uploads the file to{" "}
          <a
            href={EREADER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-kindle-text"
          >
            send.djazz.se
          </a>
          , which hands it to your Kobo or Kindle. The device shows a{" "}
          {EREADER_KEY_LENGTH}-character code in its own browser — type that code here
          and the book goes straight across, with nothing saved to your computer first.
        </p>

        <ol className="mt-2 space-y-1 text-[11px] leading-relaxed text-kindle-text-muted/90">
          <li>1. On the e-reader, open its browser and go to send.djazz.se.</li>
          <li>
            2. It displays a {EREADER_KEY_LENGTH}-character code — put it below.
          </li>
          <li>3. Tap Send on the book you want.</li>
        </ol>

        <label className="mt-3 block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
            Device code
          </span>
          <input
            value={rawKey}
            onChange={(e) => setRawKey(e.target.value.slice(0, 8))}
            placeholder="ABCD"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label={`${EREADER_KEY_LENGTH}-character code shown on your device`}
            className="mt-1 w-full rounded-lg border border-kindle-border bg-kindle-bg px-2.5 py-2 font-mono text-sm uppercase tracking-[0.3em] text-kindle-text placeholder:text-kindle-text-muted/50 focus:border-kindle-accent focus:outline-none"
          />
        </label>
        {keyLooksShort && (
          <p className="mt-1 text-[10px] text-amber-500">
            That needs to be exactly {EREADER_KEY_LENGTH} characters.
          </p>
        )}

        <label className="mt-2 flex items-center gap-2 text-[11px] text-kindle-text-muted">
          <input
            type="checkbox"
            checked={kepubify}
            onChange={(e) => setKepubify(e.target.checked)}
            className="accent-kindle-accent"
          />
          Fix up EPUBs for Kobo (Kepubify)
        </label>
        <label className="mt-1 flex items-center gap-2 text-[11px] text-kindle-text-muted">
          <input
            type="checkbox"
            checked={kindlegen}
            onChange={(e) => setKindlegen(e.target.checked)}
            className="accent-kindle-accent"
          />
          Convert for older Kindle (kindlegen)
        </label>

        <p className="mt-2 text-[10px] text-kindle-text-muted/70">
          Accepts {EREADER_ACCEPT}. The sender&apos;s reply opens in a tab — read it to
          confirm the book arrived.
        </p>
      </div>

      {/* ── Route 2: KindleDrop ────────────────────────────────────────── */}
      <div className="rounded-lg border border-kindle-border bg-kindle-card/40 p-3">
        <p className="text-xs font-medium text-kindle-text">2. KindleDrop</p>
        <p className="mt-2 text-xs leading-relaxed text-kindle-text-muted">
          Opens{" "}
          <a
            href={KDROP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-kindle-text"
          >
            kdrop.me
          </a>{" "}
          and you drop the file in yourself. Kora cannot upload to it directly: the
          page sits behind a human anti-bot check. Use this if you would rather not
          hand Kora the device code.
        </p>
        <button
          type="button"
          onClick={() => report(openManualSender("kdrop-manual"))}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-kindle-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:border-kindle-accent transition"
        >
          Open KindleDrop
        </button>
      </div>

      {/* ── Route 3: Amazon, kept as the official alternative ───────────── */}
      <div className="rounded-lg border border-kindle-border bg-kindle-card/40 p-3">
        <p className="text-xs font-medium text-kindle-text">
          3. Amazon&rsquo;s Send to Kindle (official)
        </p>
        <p className="mt-2 text-xs leading-relaxed text-kindle-text-muted">
          Amazon does not offer a third-party upload API, so this route uses your own
          account: on Android it opens the system share sheet with your own Send to
          Kindle app, and on desktop it saves the file and opens Amazon&apos;s page for
          a drag-and-drop.
        </p>
        <a
          href={AMAZON_SEND_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-[11px] underline hover:text-kindle-text"
        >
          Open Amazon&rsquo;s Send to Kindle page
        </a>
      </div>

      {/* ── The books ──────────────────────────────────────────────────── */}
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
            Couldn&apos;t read the local book cache. Try reloading.
          </p>
        ) : books.length === 0 ? (
          <p className="mt-2 text-xs text-kindle-text-muted">
            No books are downloaded on this device yet. Download one first, then come
            back.
          </p>
        ) : (
          <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {books.map((book) => {
              const busy = busyId === book.id;
              return (
                <li
                  key={book.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-kindle-border/60 px-2.5 py-2"
                >
                  <span
                    className="min-w-0 flex-1 truncate text-xs text-kindle-text"
                    title={book.fileName}
                  >
                    {book.fileName}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleUpload(book)}
                      disabled={busy || !key}
                      title={
                        key
                          ? "Upload to your device via send.djazz.se"
                          : `Enter the ${EREADER_KEY_LENGTH}-character code from your device first`
                      }
                      className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
                    >
                      {busy ? "Sending…" : "Send"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAmazon(book)}
                      disabled={busy}
                      title="Use Amazon's own Send to Kindle instead"
                      className="rounded-md border border-kindle-border px-2.5 py-1 text-[11px] font-medium text-kindle-text-muted transition-colors hover:border-kindle-accent/50 hover:text-kindle-text disabled:opacity-40"
                    >
                      Amazon
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-kindle-text-muted/70">
        Nothing here asks for, stores, or sends an Amazon or Kobo account.
      </p>
    </div>
  );
}
