import React, { useState, useEffect } from "react";
import { User } from "firebase/auth";
import {
  Moon, Sun, Monitor,
  User as UserIcon, ShieldCheck, BookOpen,
  Clock, LogIn, Type, AlignLeft, AlignCenter, Baseline,
  Database, Trash2, Search as SearchIcon, Globe, Layout,
  Sparkles, Info, Download, HardDrive, Bell, Volume2, Plus, BookMarked, HelpCircle
} from "lucide-react";
import { getAllDictionaryEntries, addDictionaryEntry, deleteDictionaryEntry, DictionaryEntry } from "../lib/dictionary";

interface ReaderPrefs {
  fontSize: number;
  lineSpacing: number;
  fontFamily: string;
  theme: string;
  marginSize: string;
  isContinuous: boolean;
  brightness: number;
}

interface SearchPrefs {
  defaultSource: string;
  autoCacheDownloads: boolean;
  openInNewTab: boolean;
}

interface SettingsViewProps {
  user: User | null;
  grayscaleCovers: boolean;
  displayTheme: string;
  onToggleGrayscale: () => void;
  onChangeTheme: (theme: string) => void;
  onSignOut: () => void;
  onSignIn: () => void;
  readerPrefs: ReaderPrefs;
  onReaderPrefsChange: (prefs: ReaderPrefs) => void;
  searchPrefs: SearchPrefs;
  onSearchPrefsChange: (prefs: SearchPrefs) => void;
  bookCount: number;
  cachedCount: number;
  onClearDeviceCache: () => void;
  onClearRecentSearches: () => void;
}

function getRemainingGuestDays(user: User | null): number {
  if (!user || !user.metadata.creationTime) return 30;
  try {
    const creationTime = new Date(user.metadata.creationTime).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const elapsedMs = Date.now() - creationTime;
    const remainingMs = Math.max(0, thirtyDaysMs - elapsedMs);
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    return Math.min(30, remainingDays);
  } catch (e) {
    return 30;
  }
}

// Reusable toggle switch
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${on ? "bg-kindle-accent" : "bg-neutral-300"}`}
      aria-pressed={on}
    >
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${on ? "translate-x-5.5" : "translate-x-0.5"}`} />
    </button>
  );
}

// Reusable setting row
function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <h4 className="text-xs font-bold">{title}</h4>
        {desc && <p className="text-[10px] text-kindle-text-muted">{desc}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-2">{children}</div>
    </div>
  );
}

export default function SettingsView({
  user,
  grayscaleCovers,
  displayTheme,
  onToggleGrayscale,
  onChangeTheme,
  onSignOut,
  onSignIn,
  readerPrefs,
  onReaderPrefsChange,
  searchPrefs,
  onSearchPrefsChange,
  bookCount,
  cachedCount,
  onClearDeviceCache,
  onClearRecentSearches
}: SettingsViewProps) {
  const setRP = (patch: Partial<ReaderPrefs>) => onReaderPrefsChange({ ...readerPrefs, ...patch });
  const setSP = (patch: Partial<SearchPrefs>) => onSearchPrefsChange({ ...searchPrefs, ...patch });

  const [dictEntries, setDictEntries] = useState<DictionaryEntry[]>([]);
  const [dictSearch, setDictSearch] = useState<string>("");
  const [showAddWordForm, setShowAddWordForm] = useState<boolean>(false);
  const [newWord, setNewWord] = useState<string>("");
  const [newDef, setNewDef] = useState<string>("");
  const [newPos, setNewPos] = useState<string>("noun");
  const [newEx, setNewEx] = useState<string>("");

  useEffect(() => {
    setDictEntries(getAllDictionaryEntries());
  }, []);

  const handleAddWord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWord.trim() || !newDef.trim()) return;
    addDictionaryEntry({
      word: newWord.trim(),
      definition: newDef.trim(),
      partOfSpeech: newPos,
      example: newEx.trim() || undefined,
      isCustom: true
    });
    setDictEntries(getAllDictionaryEntries());
    setNewWord("");
    setNewDef("");
    setNewPos("noun");
    setNewEx("");
    setShowAddWordForm(false);
  };

  const handleDeleteWord = (word: string) => {
    deleteDictionaryEntry(word);
    setDictEntries(getAllDictionaryEntries());
  };

  const fontOptions = [
    { id: "font-serif", label: "Serif" },
    { id: "font-sans", label: "Sans" },
    { id: "font-mono", label: "Mono" }
  ];
  const readerThemes = [
    { id: "light", label: "Light", bg: "bg-white", ring: "ring-neutral-300" },
    { id: "sepia", label: "Sepia", bg: "bg-[#f4ecd8]", ring: "ring-[#cbb994]" },
    { id: "dark", label: "Dark", bg: "bg-[#1a1a1a]", ring: "ring-neutral-600" },
    { id: "green", label: "Green", bg: "bg-[#c7edcc]", ring: "ring-[#7fb987]" }
  ];
  const marginOptions = [
    { id: "max-w-xl px-4", label: "Narrow" },
    { id: "max-w-2xl px-6", label: "Medium" },
    { id: "max-w-4xl px-8", label: "Wide" }
  ];
  const sources = [
    { id: "all", label: "All Sources" },
    { id: "annas", label: "Anna's Archive" },
    { id: "libgen", label: "LibGen" },
    { id: "zlib", label: "Z-Library" },
    { id: "ia", label: "Archive.org" },
    { id: "openlibrary", label: "Open Library" }
  ];

  return (
    <div className="max-w-xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="space-y-1.5 text-center">
        <h2 className="text-2xl font-bold font-lexend tracking-tight text-kindle-text">Settings</h2>
        <p className="text-[10px] text-kindle-text-muted uppercase tracking-widest font-bold">Preferences & Cloud Sync</p>
      </header>

      <div className="space-y-6">
        {/* Appearance */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
            <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
              <Monitor className="w-4 h-4 text-kindle-text" />
            </div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Appearance</h3>
          </div>

          <Row title="Grayscale Covers" desc="Classic e-ink aesthetic for book covers">
            <Toggle on={grayscaleCovers} onClick={onToggleGrayscale} />
          </Row>

          <div className="space-y-2.5">
            <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Display Theme</h4>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onChangeTheme("theme-light-white")}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition cursor-pointer ${displayTheme === 'theme-light-white' ? 'bg-kindle-card border-kindle-accent shadow-xs ring-1 ring-kindle-accent/30' : 'border-kindle-border hover:bg-kindle-card opacity-65'}`}
              >
                <Sun className="w-4 h-4" />
                <span className="text-[9px] font-bold uppercase tracking-widest">White</span>
              </button>
              <button
                onClick={() => onChangeTheme("theme-light-yellow")}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition cursor-pointer ${displayTheme === 'theme-light-yellow' ? 'bg-[#f7f3e3] border-[#6b6459] shadow-xs ring-1 ring-[#6b6459]/30' : 'border-[#d6d2c3] hover:bg-[#f7f3e3] opacity-65'}`}
              >
                <Sun className="w-4 h-4 text-yellow-700" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-yellow-900">Yellow</span>
              </button>
              <button
                onClick={() => onChangeTheme("theme-dark-grey")}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition bg-[#18181b] cursor-pointer ${displayTheme === 'theme-dark-grey' ? 'border-[#f4f4f5] shadow-xs ring-1 ring-[#f4f4f5]/30' : 'border-[#3f3f46] hover:bg-[#27272a] opacity-65'}`}
              >
                <Moon className="w-4 h-4 text-[#f4f4f5]" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-[#f4f4f5]">Grey</span>
              </button>
              <button
                onClick={() => onChangeTheme("theme-dark-blue")}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition bg-[#0b1120] cursor-pointer ${displayTheme === 'theme-dark-blue' ? 'border-[#38bdf8] shadow-xs ring-1 ring-[#38bdf8]/30' : 'border-[#1e3a5f] hover:bg-[#0f1f38] opacity-65'}`}
              >
                <Moon className="w-4 h-4 text-[#38bdf8]" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-[#38bdf8]">Blue</span>
              </button>
            </div>
          </div>
        </section>

        {/* Reading */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
            <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
              <Type className="w-4 h-4 text-kindle-text" />
            </div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Reading</h3>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold">Font Size</h4>
              <span className="text-[10px] font-mono text-kindle-text-muted">{readerPrefs.fontSize}px</span>
            </div>
            <input
              type="range" min={12} max={32} step={1} value={readerPrefs.fontSize}
              onChange={(e) => setRP({ fontSize: Number(e.target.value) })}
              className="w-full accent-kindle-accent cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold">Line Spacing</h4>
              <span className="text-[10px] font-mono text-kindle-text-muted">{readerPrefs.lineSpacing.toFixed(1)}</span>
            </div>
            <input
              type="range" min={1.2} max={2.4} step={0.1} value={readerPrefs.lineSpacing}
              onChange={(e) => setRP({ lineSpacing: Number(e.target.value) })}
              className="w-full accent-kindle-accent cursor-pointer"
            />
          </div>

          <div className="space-y-2.5">
            <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Font Family</h4>
            <div className="flex gap-2">
              {fontOptions.map(f => (
                <button key={f.id} onClick={() => setRP({ fontFamily: f.id })}
                  className={`flex-1 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition ${readerPrefs.fontFamily === f.id ? 'bg-kindle-text text-kindle-bg border-kindle-text' : 'border-kindle-border text-kindle-text-muted hover:bg-kindle-bg'}`}>
                  <span className={f.id}>{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Reader Theme</h4>
            <div className="grid grid-cols-4 gap-2">
              {readerThemes.map(t => (
                <button key={t.id} onClick={() => setRP({ theme: t.id })}
                  className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition ${readerPrefs.theme === t.id ? 'border-kindle-accent ring-1 ring-kindle-accent/30' : 'border-kindle-border hover:bg-kindle-bg'}`}>
                  <div className={`w-6 h-6 rounded-md ${t.bg} ring-1 ${t.ring}`} />
                  <span className="text-[8px] font-bold uppercase tracking-widest">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Page Width</h4>
            <div className="flex gap-2">
              {marginOptions.map(m => (
                <button key={m.id} onClick={() => setRP({ marginSize: m.id })}
                  className={`flex-1 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition ${readerPrefs.marginSize === m.id ? 'bg-kindle-text text-kindle-bg border-kindle-text' : 'border-kindle-border text-kindle-text-muted hover:bg-kindle-bg'}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <Row title="Continuous Scroll" desc="Scroll chapters as one long page">
            <Toggle on={readerPrefs.isContinuous} onClick={() => setRP({ isContinuous: !readerPrefs.isContinuous })} />
          </Row>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold">Brightness</h4>
              <span className="text-[10px] font-mono text-kindle-text-muted">{readerPrefs.brightness}%</span>
            </div>
            <input
              type="range" min={40} max={100} step={5} value={readerPrefs.brightness}
              onChange={(e) => setRP({ brightness: Number(e.target.value) })}
              className="w-full accent-kindle-accent cursor-pointer"
            />
          </div>
        </section>

        {/* Search & Discovery */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
            <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
              <SearchIcon className="w-4 h-4 text-kindle-text" />
            </div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Search & Discovery</h3>
          </div>

          <div className="space-y-2.5">
            <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Default Source</h4>
            <div className="grid grid-cols-2 gap-2">
              {sources.map(s => (
                <button key={s.id} onClick={() => setSP({ defaultSource: s.id })}
                  className={`py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition ${searchPrefs.defaultSource === s.id ? 'bg-kindle-text text-kindle-bg border-kindle-text' : 'border-kindle-border text-kindle-text-muted hover:bg-kindle-bg'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <Row title="Auto-cache Downloads" desc="Save opened books to this device automatically">
            <Toggle on={searchPrefs.autoCacheDownloads} onClick={() => setSP({ autoCacheDownloads: !searchPrefs.autoCacheDownloads })} />
          </Row>
          <Row title="Open Results in New Tab" desc="Open the in-app browser in a separate tab">
            <Toggle on={searchPrefs.openInNewTab} onClick={() => setSP({ openInNewTab: !searchPrefs.openInNewTab })} />
          </Row>
        </section>

        {/* Personal Dictionary Section */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-kindle-border pb-3">
            <div className="flex items-center gap-3">
              <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
                <BookMarked className="w-4 h-4 text-kindle-text" />
              </div>
              <div>
                <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Personal Dictionary</h3>
                <p className="text-[10px] text-kindle-text-muted">Definitions used inside book readers</p>
              </div>
            </div>
            <button
              onClick={() => setShowAddWordForm(!showAddWordForm)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-kindle-text text-kindle-bg hover:bg-kindle-accent rounded-xl text-[9px] font-bold uppercase tracking-widest transition"
            >
              <Plus className="w-3 h-3" /> {showAddWordForm ? "Cancel" : "Add Word"}
            </button>
          </div>

          {showAddWordForm && (
            <form onSubmit={handleAddWord} className="p-4 bg-kindle-bg border border-kindle-border rounded-xl space-y-3.5 animate-in slide-in-from-top duration-200">
              <h4 className="text-[10px] uppercase tracking-widest font-bold text-kindle-text-muted">Define Custom Word</h4>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] uppercase tracking-wider font-bold text-kindle-text-muted mb-1">Word</label>
                  <input
                    type="text"
                    required
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    placeholder="e.g. Ephemeral"
                    className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase tracking-wider font-bold text-kindle-text-muted mb-1">Part of Speech</label>
                  <select
                    value={newPos}
                    onChange={(e) => setNewPos(e.target.value)}
                    className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none"
                  >
                    <option value="noun">Noun</option>
                    <option value="verb">Verb</option>
                    <option value="adjective">Adjective</option>
                    <option value="adverb">Adverb</option>
                    <option value="other">Other/Mix</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[9px] uppercase tracking-wider font-bold text-kindle-text-muted mb-1">Definition</label>
                <textarea
                  required
                  rows={2}
                  value={newDef}
                  onChange={(e) => setNewDef(e.target.value)}
                  placeholder="The meaning of the word..."
                  className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase tracking-wider font-bold text-kindle-text-muted mb-1">Example Usage (Optional)</label>
                <input
                  type="text"
                  value={newEx}
                  onChange={(e) => setNewEx(e.target.value)}
                  placeholder="Sentence using the word..."
                  className="w-full p-2 bg-kindle-card border border-kindle-border rounded-lg text-xs focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-kindle-text text-kindle-bg hover:bg-kindle-accent rounded-lg text-[10px] font-bold uppercase tracking-widest transition"
              >
                Save Word Definition
              </button>
            </form>
          )}

          <div className="space-y-3">
            <div className="relative">
              <SearchIcon className="w-3.5 h-3.5 text-kindle-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search words in dictionary..."
                value={dictSearch}
                onChange={(e) => setDictSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-xs outline-none"
              />
            </div>

            <div className="max-h-60 overflow-y-auto border border-kindle-border rounded-xl divide-y divide-kindle-border bg-kindle-bg scrollbar-hide">
              {dictEntries
                .filter(entry => entry.word.toLowerCase().includes(dictSearch.toLowerCase()))
                .map((entry) => (
                  <div key={entry.word} className="p-3.5 flex items-start justify-between gap-3 bg-kindle-card">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold font-serif text-sm">{entry.word}</span>
                        {entry.partOfSpeech && (
                          <span className="text-[8px] uppercase tracking-wider font-mono font-bold text-kindle-text-muted/70 bg-neutral-150 px-1 py-0.5 rounded">
                            {entry.partOfSpeech}
                          </span>
                        )}
                        {entry.isCustom && (
                          <span className="text-[7px] uppercase tracking-widest font-bold bg-kindle-accent/15 text-kindle-accent px-1.5 py-0.5 rounded-full">
                            Personal
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-kindle-text leading-relaxed font-sans">{entry.definition}</p>
                      {entry.example && (
                        <p className="text-[10px] italic text-kindle-text-muted font-sans font-medium">"{entry.example}"</p>
                      )}
                    </div>
                    {entry.isCustom && (
                      <button
                        onClick={() => handleDeleteWord(entry.word)}
                        className="p-1.5 text-kindle-text-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Delete Definition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}

              {dictEntries.filter(entry => entry.word.toLowerCase().includes(dictSearch.toLowerCase())).length === 0 && (
                <div className="p-8 text-center text-xs text-kindle-text-muted italic">
                  No words matching your search
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Data & Storage */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
            <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
              <Database className="w-4 h-4 text-kindle-text" />
            </div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Data & Storage</h3>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border">
              <p className="text-lg font-bold font-lexend">{bookCount}</p>
              <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">Books in Library</p>
            </div>
            <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border">
              <p className="text-lg font-bold font-lexend text-kindle-accent">{cachedCount}</p>
              <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">Cached On Device</p>
            </div>
          </div>

          <button
            onClick={onClearDeviceCache}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-bg transition cursor-pointer"
          >
            <HardDrive className="w-3.5 h-3.5" /> Clear Cached Book Files
          </button>
          <button
            onClick={onClearRecentSearches}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-bg transition cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear Recent Searches
          </button>
        </section>

        {/* Account & Sync */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
            <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
              <UserIcon className="w-4 h-4 text-kindle-text" />
            </div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Account</h3>
          </div>

          {user && !user.isAnonymous ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/35 rounded-xl">
                <div className="w-9 h-9 bg-emerald-600 rounded-full flex items-center justify-center text-white font-bold shrink-0">
                  {user.email?.[0].toUpperCase()}
                </div>
                <div className="overflow-hidden">
                  <p className="text-xs font-bold truncate">{user.email}</p>
                  <p className="text-[9px] text-emerald-700 dark:text-emerald-400 uppercase tracking-widest flex items-center gap-1 font-semibold">
                    <ShieldCheck className="w-3 h-3" />
                    Cloud Sync Active
                  </p>
                </div>
              </div>
              <button
                onClick={onSignOut}
                className="w-full py-2 border border-red-200 text-red-600 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-50 dark:hover:bg-red-950/10 transition cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {user && user.isAnonymous && (
                <div className="p-3 bg-amber-50/50 border border-amber-200/50 dark:bg-amber-950/10 dark:border-amber-900/35 rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="text-[9px] font-bold uppercase tracking-widest">Guest Account Active</span>
                  </div>
                  <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80 leading-relaxed font-sans font-medium">
                    Your guest workspace is saved locally. It will automatically reset in {getRemainingGuestDays(user)} days.
                  </p>
                </div>
              )}
              <p className="text-xs text-kindle-text-muted leading-relaxed">
                Sign in with Google or create an account to secure your library forever and sync across all your devices.
              </p>
              <button
                onClick={onSignIn}
                className="w-full py-2.5 bg-kindle-text text-kindle-bg rounded-xl text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition shadow-xs cursor-pointer flex items-center justify-center gap-2"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In / Create Account
              </button>
            </div>
          )}
        </section>

        {/* About */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-3">
          <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
            <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
              <Info className="w-4 h-4 text-kindle-text" />
            </div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">About</h3>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-kindle-text-muted">Version</span>
            <span className="font-mono font-bold">Kora 1.0.0</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-kindle-text-muted">Powered by</span>
            <span className="font-bold flex items-center gap-1"><Sparkles className="w-3 h-3 text-kindle-accent" /> Rave Engine</span>
          </div>
        </section>
      </div>

      <footer className="pt-8 border-t border-kindle-border flex flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-1.5 text-kindle-text-muted">
          <BookOpen className="w-3.5 h-3.5" />
          <span className="text-[9px] font-bold uppercase tracking-widest">Kora • Stable Release</span>
        </div>
        <p className="text-[9px] text-kindle-text-muted max-w-sm leading-relaxed">
          Crafted for high-performance reading and digital sovereignty. Secure cloud sync and private locally cached reader environment.
        </p>
      </footer>
    </div>
  );
}
