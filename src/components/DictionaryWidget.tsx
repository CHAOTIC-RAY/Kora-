import React, { useEffect, useMemo, useState } from "react";
import { Search, X, BookA } from "lucide-react";
import { getAllDictionaryEntries, DictionaryEntry } from "../lib/dictionary";

interface DictionaryWidgetProps {
  onClose?: () => void;
}

export default function DictionaryWidget({ onClose }: DictionaryWidgetProps) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);

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

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 12);
    return entries
      .filter(
        (e) =>
          e.word.toLowerCase().includes(q) ||
          (e.definition || "").toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [query, entries]);

  const decode = (s: string) =>
    s.replace(/&#\d+;/g, (m) => String.fromCodePoint(parseInt(m.slice(2, -1), 10)));

  return (
    <div className="flex flex-col h-full w-full bg-kindle-bg text-kindle-text">
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

      <div className="px-4 py-3 border-b border-kindle-border">
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
                <span className="font-bold text-sm">{entry.word}</span>
                {entry.partOfSpeech && (
                  <span className="text-[10px] uppercase tracking-wider text-kindle-accent">
                    {entry.partOfSpeech}
                  </span>
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
