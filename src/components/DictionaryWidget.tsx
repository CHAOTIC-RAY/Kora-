import React, { useEffect, useMemo, useState } from "react";
import { Search, X, BookA, Trash2 } from "lucide-react";
import {
  getAllDictionaryEntries,
  addDictionaryEntry,
  deleteDictionaryEntry,
  DictionaryEntry,
} from "../lib/dictionary";

interface DictionaryWidgetProps {
  onClose?: () => void;
  /**
   * Drop the internal header and frame. Used when the widget is already
   * inside a titled sheet — otherwise the title and close button appear
   * twice, once nested inside the other.
   */
  bare?: boolean;
}

export default function DictionaryWidget({ onClose, bare = false }: DictionaryWidgetProps) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [query, setQuery] = useState("");
  // Debounced: filtering 7.8k entries on every keystroke is what makes a
  // long definition feel laggy to type into.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState({ word: "", definition: "" });
  const [saving, setSaving] = useState(false);

  const refresh = () => {
    getAllDictionaryEntries().then((all) => {
      setEntries(all);
      setReady(true);
    });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const word = draft.word.trim();
    const definition = draft.definition.trim();
    if (!word || !definition || saving) return;
    setSaving(true);
    try {
      await addDictionaryEntry({ word, definition, isCustom: true });
      setDraft({ word: "", definition: "" });
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (word: string) => {
    deleteDictionaryEntry(word);
    refresh();
  };

  useEffect(() => {
    let alive = true;
    getAllDictionaryEntries().then((all) => {
      if (!alive) return;
      setEntries(all);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 160);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return entries.slice(0, 12);
    return entries
      .filter(
        (e) =>
          e.word.toLowerCase().includes(q) ||
          (e.definition || "").toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [debouncedQuery, entries]);

  const decode = (s: string) =>
    s.replace(/&#\d+;/g, (m) => String.fromCodePoint(parseInt(m.slice(2, -1), 10)));

  return (
    <div className="flex flex-col h-full w-full text-kindle-text">
      {/* Header only when unframed: a titled sheet already provides one,
          and two stacked headers is the nested-box the user reported. */}
      {!bare && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-kindle-border">
          <div className="flex items-center gap-2">
            <BookA className="w-4 h-4 text-kindle-accent" />
            <span className="text-sm font-bold">Searchable Dictionary</span>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-kindle-text-muted hover:text-kindle-text cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

      <div className={`${bare ? "pt-0" : ""} px-4 py-3 border-b border-kindle-border`}>
        <div className="flex items-center gap-2 bg-kindle-card border border-kindle-border rounded-xl px-3 py-2">
          <Search className="w-4 h-4 text-kindle-text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Look up a word…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-kindle-text-muted"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-kindle-text-muted hover:text-kindle-text cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-kindle-text-muted mt-2">
          {ready ? `${entries.length.toLocaleString()} entries loaded` : "Loading dictionary…"}
        </p>

        {/* Add form — this panel is the only dictionary editor now that the
            Settings copy is gone, so it needs to be able to add as well as
            read. */}
        <form
          onSubmit={handleAdd}
          className="mt-3 flex flex-wrap gap-2 items-start"
        >
          <input
            value={draft.word}
            onChange={(e) => setDraft((d) => ({ ...d, word: e.target.value }))}
            placeholder="word"
            className="w-28 bg-kindle-card border border-kindle-border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-kindle-accent/50"
          />
          <input
            value={draft.definition}
            onChange={(e) => setDraft((d) => ({ ...d, definition: e.target.value }))}
            placeholder="definition"
            className="flex-1 min-w-[10rem] bg-kindle-card border border-kindle-border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-kindle-accent/50"
          />
          <button
            type="submit"
            disabled={!draft.word.trim() || !draft.definition.trim() || saving}
            className="px-3 py-1.5 rounded-lg bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-widest disabled:opacity-40 cursor-pointer"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {results.length === 0 ? (
          <p className="text-center text-xs text-kindle-text-muted py-10">
            No matches for “{query}”.
          </p>
        ) : (
          results.map((entry, i) => (
            <div
              key={`${entry.word}-${i}`}
              className="bg-kindle-card border border-kindle-border rounded-xl p-3 space-y-1"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-bold text-sm flex-1">{entry.word}</span>
                {entry.partOfSpeech && (
                  <span className="text-[10px] uppercase tracking-wider text-kindle-accent">
                    {entry.partOfSpeech}
                  </span>
                )}
                {/* Only words the reader added are removable; the bundled
                    dictionary ships with the app. */}
                {entry.isCustom && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(entry.word)}
                    title={`Remove “${entry.word}”`}
                    className="p-0.5 text-kindle-text-muted hover:text-red-500 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-xs text-kindle-text-muted leading-relaxed">
                {decode(entry.definition || "")}
              </p>
              {entry.example && (
                <p className="text-[11px] italic text-kindle-text-muted/80">
                  “{decode(entry.example)}”
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
