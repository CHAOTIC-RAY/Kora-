/**
 * Send to Kobo/Kindle — the panel behind the Workshop tile.
 *
 * The primary route is now Kora's OWN relay. It used to be send.djazz.se, a
 * third party that stood between a reader and their own library: every book
 * passed through a server that is not ours, under a retention policy that is
 * not ours, with an uptime that is not ours. The relay in `src/lib/relay/`
 * replaces it and runs in Kora's Worker — the book goes from this page to the
 * device and is deleted the moment the device takes it.
 *
 * There are two routes now, not three:
 *
 *  1. SEND VIA KORA'S RELAY (primary) — open `/send` on the e-reader, read the
 *     4-character code off the screen, type it here, send. Nothing is stored on
 *     this computer, and no third party sees the file.
 *  2. AMAZON'S SEND TO KINDLE (official, kept as asked) — the alternative that
 *     needs no Kora page at all. On Android it opens the system share sheet; on
 *     desktop it saves the file and opens Amazon's page. Labelled as the
 *     alternative it is, and it says out loud when it saved locally.
 *
 * KindleDrop was REMOVED rather than kept as manual-only. `api.kdrop.me` does
 * not resolve and the site is behind a Turnstile human check, so it could only
 * ever be a manual "go open this page yourself" route — a worse version of the
 * Amazon route that also happened to be a third-party dependency the user asked
 * to be rid of. Carrying it forward would have preserved a dependency for no
 * capability. The test file asserts its absence.
 *
 * WHY THE PROGRESS BAR AND THE CANCEL BUTTON. A 40 MB EPUB over a phone
 * connection is the case where "still nothing" and "it broke" look identical
 * without a byte count, and the case where a user taps Send twice. So: real
 * progress, and a cancel that reports a cancellation rather than a failure.
 *
 * NO ROUTE DEGRADES. Every button names the path it takes, and every result
 * toast names the path that actually ran. `report()` refuses to render a
 * success without a `method` — that is the whole anti-"it just downloaded the
 * book" mechanism, kept from the previous version of this file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  AMAZON_SEND_URL,
  EREADER_ACCEPT,
  EREADER_KEY_LENGTH,
  EREADER_URL,
  KOBO_KINDLE_LABEL,
  KINDLE_NATIVE_EXTENSIONS,
  isKindleNativeExtension,
  normalizeEreaderKey,
  shareOrDownloadForAmazon,
  uploadToEreader,
  type EreaderResult,
} from "../lib/sources/koboKindleSender";
import { fetchRelayStatus } from "../lib/sources/koraRelaySender";
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

/**
 * One toast per result, so the route that ran is always named.
 *
 * A success with no `method` is refused: that combination is what produced the
 * "send to kindle just downloads the book" report, and the check lives here
 * rather than in the panel's callers so a new call site cannot forget it.
 */
function report(result: EreaderResult) {
  if (result.cancelled) {
    // The user changed their mind. Not an error, and not a success.
    toast(result.reason, { icon: "🚫" });
    return;
  }
  if (result.ok && !result.method) {
    // Defensive, and worth the lines: an unnamed success is the bug class.
    console.error("[Kora/Ereader] a success came back without a method", result);
    toast.error(
      "That send finished but I cannot say which path it took. Nothing was assumed to have been delivered."
    );
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
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [storage, setStorage] = useState<"r2" | "memory" | "unknown">("unknown");
  // A ref, not state: an AbortSignal must not cause a re-render, and the cancel
  // button needs the live handle while the upload is in flight.
  const abortRef = useRef<AbortController | null>(null);

  // Normalised live so the button can be disabled before the tap, rather than
  // failing after it. A short code is the normal state, not an error.
  const key = useMemo(() => normalizeEreaderKey(rawKey), [rawKey]);
  const keyLooksWrong = rawKey.trim().length > 0 && !key;

  // Which storage answered. Shown because "the relay is on memory" is a
  // deployment mistake, and finding that out from a failed send is worse than
  // being told at the top of the panel.
  useEffect(() => {
    let live = true;
    void fetchRelayStatus().then((s) => {
      if (!live) return;
      setStorage(s.ok && s.storage === "r2" ? "r2" : s.ok && s.storage === "memory" ? "memory" : "unknown");
    });
    return () => {
      live = false;
    };
  }, []);

  // "idle" | "done" | "failed" — a distinct failed state exists so the
  // button never claims "Copied" when the clipboard was actually blocked.
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  const sendPage = useMemo(() => {
    if (typeof window === "undefined") return EREADER_URL;
    return `${window.location.origin}${EREADER_URL}`;
  }, []);

  async function copySendPage() {
    // navigator.clipboard is unavailable on insecure origins and can be
    // blocked inside the Capacitor WebView, and this app runs as an APK. A
    // silent no-op here would look exactly like a broken button, so fall
    // back to a hidden textarea + execCommand, and only report success when
    // something actually reached the clipboard.
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sendPage);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = sendPage;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setCopied(ok ? "done" : "failed");
    window.setTimeout(() => setCopied("idle"), 2000);
  }

  async function handleUpload(book: CachedBook) {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusyId(book.id);
    setProgress(null);
    try {
      const result = await uploadToEreader(book.id, {
        key: rawKey,
        title: book.id,
        extension: book.extension,
        getCachedFile: readCachedBlob,
        abortSignal: controller.signal,
        onProgress: (loaded, total) => setProgress({ loaded, total }),
      });
      report(result);
    } catch (err) {
      console.error("[Kora/Ereader] upload failed", err);
      toast.error("Could not start the upload.");
    } finally {
      abortRef.current = null;
      setBusyId(null);
      setProgress(null);
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

  const pct =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;

  return (
    <div className="space-y-4 rounded-xl border border-kindle-border p-4">
      <header>
        <h3 className="font-semibold text-kindle-text">{KOBO_KINDLE_LABEL}</h3>
        <p className="mt-0.5 text-xs text-kindle-text-muted">
          Sends a book straight to your Kobo or Kindle through Kora&apos;s own server. No
          account, no API key, no third party.
        </p>
      </header>

      {storage === "memory" && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-300">
          The relay is running on temporary in-memory storage, so sends may not survive
          long enough to arrive. The Cloudflare R2 bucket needs creating — see
          <code className="mx-1">wrangler.toml</code>.
        </p>
      )}

      {/* ── Route 1: the real upload, via Kora's own relay ─────────────── */}
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
        <p className="text-xs font-medium text-emerald-400">1. Send via Kora&apos;s relay</p>
        <p className="mt-2 text-xs leading-relaxed text-kindle-text-muted">
          Open Kora&apos;s Send page in your e-reader&apos;s own browser. It shows a{" "}
          {EREADER_KEY_LENGTH}-character code and waits there. Type that code below and the
          book goes straight across to the device — it is never saved on this computer, and
          it is deleted from the server the moment the device takes it.
        </p>

        <ol className="mt-2 space-y-1 text-[11px] leading-relaxed text-kindle-text-muted/90">
          <li>1. On the e-reader, open its browser and go to the Send page.</li>
          <li>2. It displays a {EREADER_KEY_LENGTH}-character code — put it below.</li>
          <li>3. Tap Send on the book you want. Leave the device on that page.</li>
        </ol>

        <div className="mt-3 flex items-start gap-3">
          {/*
            A hand-rolled QR encoder was removed here rather than shipped. Its
            decoder tests still failed 13 assertions, including on the relay's
            own ASCII URLs — a QR that scans to the wrong link is far worse than
            no QR, because the user has no way to tell. The URL is shown as
            selectable text next to this instead: typeable by hand on an
            e-reader, and the link itself is still one tap to open.
          */}
          <div className="min-w-0 flex-1">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                Device code
              </span>
              <input
                value={rawKey}
                onChange={(e) => setRawKey(e.target.value.slice(0, 8))}
                placeholder="A7K2"
                autoComplete="off"
                autoCapitalize="characters"
                inputMode="text"
                spellCheck={false}
                aria-label={`${EREADER_KEY_LENGTH}-character code shown on your e-reader`}
                className="mt-1 w-full rounded-lg border border-kindle-border bg-kindle-bg px-2.5 py-2 font-mono text-sm uppercase tracking-[0.3em] text-kindle-text placeholder:text-kindle-text-muted/50 focus:border-kindle-accent focus:outline-none"
              />
            </label>
            {keyLooksWrong && (
              <p className="mt-1 text-[10px] text-amber-500">
                Exactly {EREADER_KEY_LENGTH} characters, letters and digits only.
              </p>
            )}
            <p className="mt-1 text-[10px] text-kindle-text-muted/70">
              Codes skip the letters O, I and L and the digits 0 and 1, so they read
              clearly on an E-Ink screen.
            </p>
            {/* The URL is only reachable by following a link, so an e-reader
                            browser or a second device cannot be sent there. Showing it as
                            text with a copy button is what makes the step transferable:
                            the user can paste it into a Kindle browser, a message, or a
                            note, instead of having to open a tab they then cannot use. */}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <code className="min-w-0 flex-1 truncate rounded-lg bg-kindle-bg border border-kindle-border px-2 py-1.5 font-mono text-[10px] text-kindle-text-muted">
                            {sendPage}
                          </code>
                          <button
                            type="button"
                            onClick={() => copySendPage()}
                            className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-kindle-text px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-kindle-bg hover:opacity-90 transition"
                          >
                            {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy link"}
                          </button>
                          <a
                            href={sendPage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-[10px] underline hover:text-kindle-text"
                          >
                            Open in new tab
                          </a>
                        </div>
                      </div>
                    </div>

        {progress && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-kindle-border">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-[10px] text-kindle-text-muted">
              {pct}% · {Math.round(progress.loaded / 1024 / 1024)} of{" "}
              {Math.round(progress.total / 1024 / 1024)} MB
            </p>
          </div>
        )}

        {busyId && (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-kindle-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:border-amber-500/60 hover:text-amber-400 transition"
          >
            Cancel this send
          </button>
        )}

        <p className="mt-2 text-[10px] text-kindle-text-muted/70">
          Accepts {EREADER_ACCEPT}, up to 50 MB. Kindle-native formats (
          {KINDLE_NATIVE_EXTENSIONS.join(", ")}) are the ones Amazon&apos;s own apps open
          without a conversion step.
        </p>
      </div>

      {/* ── Route 2: Amazon, kept as the official alternative ───────────── */}
      <div className="rounded-lg border border-kindle-border bg-kindle-card/40 p-3">
        <p className="text-xs font-medium text-kindle-text">
          2. Amazon&rsquo;s Send to Kindle (official)
        </p>
        <p className="mt-2 text-xs leading-relaxed text-kindle-text-muted">
          Amazon offers no third-party upload API, so this alternative uses your own
          account. On Android it opens the system share sheet with your own Send to
          Kindle app; on desktop it saves the file to your downloads and opens
          Amazon&apos;s page for a drag-and-drop. It never uses Kora&apos;s relay, and it
          says so when it saves locally.
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
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-kindle-text" title={book.fileName}>
                      {book.fileName}
                    </span>
                    {isKindleNativeExtension(book.extension) && (
                      <span className="text-[10px] text-kindle-text-muted/70">
                        Kindle-native format — a Kobo will want a different one
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleUpload(book)}
                      disabled={busy || !key}
                      title={
                        key
                          ? "Send to your e-reader through Kora's own relay"
                          : `Enter the ${EREADER_KEY_LENGTH}-character code from your e-reader first`
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
        Nothing here asks for, stores, or sends an Amazon or Kobo account. A book sent
        through the relay is deleted from the server as soon as the e-reader downloads
        it, and any send left uncollected expires on its own.
      </p>
    </div>
  );
}
