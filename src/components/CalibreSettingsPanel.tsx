/**
 * Calibre settings panel.
 *
 * A real setup flow for a server the user runs themselves: address,
 * credentials, a Test button that hits `/ajax/library-info` for real, and a
 * browse list that calls the actual search/book endpoints.
 *
 * The password field is a password input, stored locally, and never rendered
 * back in the clear. Nothing here contacts anything except the server the
 * user typed in.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CalibreError,
  bookDownloadUrl,
  coverUrl,
  getBook,
  listBooks,
  listLibraries,
  normaliseBook,
  searchBooks,
  testConnection,
  type CalibreBook,
  type CalibreLibrary,
} from "../lib/sources/calibreClient";
import {
  clearCalibreSettings,
  getCalibreSettings,
  saveCalibreSettings,
  validateCalibreSettings,
  type CalibreSettings,
} from "../lib/sources/integrationSettings";

type Status =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string };

export default function CalibreSettingsPanel({
  onClose,
}: {
  onClose?: () => void;
}) {
  const [settings, setSettings] = useState<CalibreSettings>(() => getCalibreSettings());
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [libraries, setLibraries] = useState<CalibreLibrary[]>([]);
  const [books, setBooks] = useState<CalibreBook[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const cfg = {
    serverUrl: settings.serverUrl,
    username: settings.username,
    password: settings.password,
  };

  const persist = useCallback((next: CalibreSettings) => {
    setSettings(next);
    saveCalibreSettings(next);
  }, []);

  const onTest = useCallback(async () => {
    const check = validateCalibreSettings(settings);
    if (!check.ok) {
      setStatus({ kind: "error", text: check.error });
      return;
    }
    setStatus({ kind: "testing" });
    setBusy(true);
    const res = await testConnection(cfg);
    setBusy(false);
    if (res.ok) {
      setLibraries(res.libraries);
      const count = res.libraries.length;
      setStatus({
        kind: "ok",
        text:
          count > 0
            ? `Connected. ${count} librar${count === 1 ? "y" : "ies"} available.`
            : "Connected, but this server reports no libraries.",
      });
      persist({ ...check.value, configured: true });
    } else {
      setLibraries([]);
      setStatus({ kind: "error", text: res.error.message });
    }
  }, [cfg, persist, settings]);

  // Pick the library the server says is the default, unless one is already chosen.
  useEffect(() => {
    if (!libraries.length || settings.libraryId) return;
    const first = libraries[0];
    if (first) persist({ ...settings, libraryId: first.libraryId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraries]);

  const onSearch = useCallback(async () => {
    const check = validateCalibreSettings(settings);
    if (!check.ok) {
      setStatus({ kind: "error", text: check.error });
      return;
    }
    const libraryId = settings.libraryId;
    if (!libraryId) {
      setStatus({ kind: "error", text: "Choose a library first." });
      return;
    }
    setBusy(true);
    setStatus({ kind: "testing" });
    try {
      const found = await searchBooks(cfg, libraryId, query, { num: 50 });
      const details = await listBooks(cfg, libraryId, found.bookIds);
      setBooks(details);
      setStatus({
        kind: "ok",
        text: details.length
          ? `${details.length} of ${found.total} book${found.total === 1 ? "" : "s"} loaded.`
          : "No books matched.",
      });
    } catch (err) {
      const e = err as CalibreError;
      setStatus({ kind: "error", text: e.message });
      setBooks([]);
    } finally {
      setBusy(false);
    }
  }, [cfg, query, settings]);

  const openBook = useCallback(
    async (book: CalibreBook) => {
      const libraryId = settings.libraryId;
      if (!libraryId) return;
      setBusy(true);
      try {
        // Round-trip the single-book endpoint so the detail view is real data.
        const full = (await getBook(cfg, libraryId, book.id)) ?? normaliseBook(book);
        if (full?.main_format) {
          const [fmt] = Object.keys(full.main_format);
          window.open(bookDownloadUrl(cfg, libraryId, full.id, fmt), "_blank", "noopener");
        } else {
          setStatus({
            kind: "error",
            text: `"${full?.title ?? book.title}" has no downloadable format on the server.`,
          });
        }
      } catch (err) {
        setStatus({ kind: "error", text: (err as CalibreError).message });
      } finally {
        setBusy(false);
      }
    },
    [cfg, settings.libraryId]
  );

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-kindle-text">Calibre</h3>
          <p className="text-xs text-kindle-text-muted mt-0.5">
            Connect to a Calibre Content Server to browse and download your library.
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-sm text-kindle-text-muted hover:text-kindle-text px-2 py-1">
            Close
          </button>
        )}
      </header>

      {/* Credentials */}
      <div className="space-y-3 rounded-xl border border-kindle-border p-4">
        <label className="block">
          <span className="text-xs font-medium text-kindle-text-muted">Server address</span>
          <input
            value={settings.serverUrl}
            onChange={(e) => setSettings((s) => ({ ...s, serverUrl: e.target.value }))}
            placeholder="192.168.1.20:8080"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            className="mt-1 w-full rounded-lg border border-kindle-border bg-kindle-bg px-3 py-2 text-sm text-kindle-text outline-none focus:border-kindle-accent"
          />
          <span className="mt-1 block text-[11px] text-kindle-text-muted">
            Start Calibre, then in Calibre choose Share → Share over your local network.
            The port shown there is the one to use.
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-kindle-text-muted">Username</span>
            <input
              value={settings.username}
              onChange={(e) => setSettings((s) => ({ ...s, username: e.target.value }))}
              placeholder="calibre"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-kindle-border bg-kindle-bg px-3 py-2 text-sm text-kindle-text outline-none focus:border-kindle-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-kindle-text-muted">Password</span>
            <input
              type="password"
              value={settings.password}
              onChange={(e) => setSettings((s) => ({ ...s, password: e.target.value }))}
              placeholder="your Calibre password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-kindle-border bg-kindle-bg px-3 py-2 text-sm text-kindle-text outline-none focus:border-kindle-accent"
            />
          </label>
        </div>

        <p className="text-[11px] text-kindle-text-muted">
          Stored only on this device, sent only to the address above, and never to Kora
          or anyone else. Use a Calibre account you are happy to expose on your network.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onTest}
            disabled={busy}
            className="rounded-lg bg-kindle-accent px-3 py-2 text-sm font-medium text-kindle-bg disabled:opacity-50"
          >
            {status.kind === "testing" ? "Testing…" : "Test connection"}
          </button>
          <button
            onClick={() => persist({ ...settings, configured: true })}
            className="rounded-lg border border-kindle-border px-3 py-2 text-sm text-kindle-text"
          >
            Save
          </button>
          <button
            onClick={() => {
              clearCalibreSettings();
              setSettings({ serverUrl: "", username: "", password: "" });
              setLibraries([]);
              setBooks([]);
              setStatus({ kind: "idle" });
            }}
            className="rounded-lg border border-kindle-border px-3 py-2 text-sm text-kindle-text-muted"
          >
            Forget server
          </button>
        </div>

        {status.kind === "error" && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 whitespace-pre-line">
            {status.text}
          </p>
        )}
        {status.kind === "ok" && (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
            {status.text}
          </p>
        )}
      </div>

      {/* Library browser */}
      {libraries.length > 0 && (
        <div className="space-y-3 rounded-xl border border-kindle-border p-4">
          <label className="block">
            <span className="text-xs font-medium text-kindle-text-muted">Library</span>
            <select
              value={settings.libraryId ?? ""}
              onChange={(e) => persist({ ...settings, libraryId: e.target.value })}
              className="mt-1 w-full rounded-lg border border-kindle-border bg-kindle-bg px-3 py-2 text-sm text-kindle-text outline-none"
            >
              {libraries.map((l) => (
                <option key={l.libraryId} value={l.libraryId}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSearch();
              }}
              placeholder="Search your Calibre library"
              className="flex-1 rounded-lg border border-kindle-border bg-kindle-bg px-3 py-2 text-sm text-kindle-text outline-none focus:border-kindle-accent"
            />
            <button
              onClick={onSearch}
              disabled={busy}
              className="rounded-lg bg-kindle-accent px-3 py-2 text-sm font-medium text-kindle-bg disabled:opacity-50"
            >
              Search
            </button>
          </div>
          <p className="text-[11px] text-kindle-text-muted">
            Uses Calibre's own search syntax. Leave it empty to list everything.
          </p>

          {books.length > 0 && (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {books.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => openBook(b)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-kindle-card"
                  >
                    {b.cover && (
                      <img
                        src={coverUrl(cfg, b.cover)}
                        alt=""
                        className="h-12 w-9 shrink-0 rounded object-cover"
                        loading="lazy"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-kindle-text">{b.title}</span>
                      <span className="block truncate text-xs text-kindle-text-muted">
                        {b.authors.join(", ") || "Unknown author"}
                        {b.formats.length ? ` · ${b.formats.join(", ")}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
