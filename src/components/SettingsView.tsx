import React, { useState, useEffect } from "react";
import { User } from "firebase/auth";
import { 
  Settings as SettingsIcon, Moon, Sun, Monitor, 
  User as UserIcon, LogOut, Cloud, HardDrive, 
  Cpu, Database, Globe, Key, ShieldCheck, Sparkles,
  RefreshCw, CheckCircle2, BookMarked
} from "lucide-react";
import FingerprintJS from "@fingerprintjs/fingerprintjs";

interface SettingsViewProps {
  user: User | null;
  grayscaleCovers: boolean;
  displayTheme: string;
  onToggleGrayscale: () => void;
  onChangeTheme: (theme: string) => void;
  onSignOut: () => void;
  onSignIn: () => void;
  connectors: Record<string, boolean>;
  onConnectorsChange: (connectors: Record<string, boolean>) => void;
  zlibConfig: any;
  onZlibConfigChange: (config: any) => void;
}

export default function SettingsView({ 
  user, 
  grayscaleCovers,
  displayTheme,
  onToggleGrayscale, 
  onChangeTheme,
  onSignOut, 
  onSignIn,
  connectors,
  onConnectorsChange,
  zlibConfig,
  onZlibConfigChange
}: SettingsViewProps) {
  const [fingerprint, setFingerprint] = useState("");

  useEffect(() => {
    FingerprintJS.load()
      .then(fp => fp.get())
      .then(result => {
        setFingerprint(result.visitorId);
      })
      .catch(err => {
        console.error("FingerprintJS load failed:", err);
      });
  }, []);

  // AI state — only custom endpoint, no built-in Gemini
  const [aiConfig, setAiConfig] = useState(() => {
    const saved = localStorage.getItem("kora_ai_config");
    return saved ? JSON.parse(saved) : {
      useCustom: false,
      customEndpoint: "",
      customKey: ""
    };
  });

  useEffect(() => {
    localStorage.setItem("kora_ai_config", JSON.stringify(aiConfig));
  }, [aiConfig]);

  return (
    <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="space-y-2">
        <h2 className="text-2xl font-bold font-sans tracking-tight">Settings</h2>
        <p className="text-xs text-kindle-text-muted uppercase tracking-widest font-bold">Preferences & Connectivity</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Appearance & Account */}
        <div className="space-y-8">
          <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-sm space-y-6">
            <div className="flex items-center gap-3 border-b border-kindle-border pb-4">
              <div className="p-2 bg-kindle-bg/50 rounded-lg">
                <Monitor className="w-5 h-5 text-kindle-text" />
              </div>
              <h3 className="font-bold text-sm">Appearance</h3>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold">Grayscale Covers</h4>
                  <p className="text-[10px] text-kindle-text-muted">Classic e-ink aesthetic for book covers</p>
                </div>
                <button 
                  onClick={onToggleGrayscale}
                  className={`w-10 h-5 rounded-full transition-colors relative ${grayscaleCovers ? "bg-kindle-accent" : "bg-neutral-300"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${grayscaleCovers ? "translate-x-5.5" : "translate-x-0.5"}`} />
                </button>
              </div>

              <div className="space-y-3">
                <h4 className="text-[10px] uppercase tracking-widest font-bold text-kindle-text-muted">Display Theme</h4>
                <div className="grid grid-cols-2 gap-2">
                  {/* White / Light */}
                  <button 
                    onClick={() => onChangeTheme("theme-light-white")}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition ${displayTheme === 'theme-light-white' ? 'bg-kindle-card border-kindle-accent shadow-sm ring-1 ring-kindle-accent/30' : 'border-kindle-border hover:bg-kindle-card opacity-60'}`}
                  >
                    <Sun className="w-4 h-4" />
                    <span className="text-[9px] font-bold uppercase tracking-widest">White</span>
                  </button>
                  {/* Yellow / Sepia */}
                  <button 
                    onClick={() => onChangeTheme("theme-light-yellow")}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition ${displayTheme === 'theme-light-yellow' ? 'bg-[#f7f3e3] border-[#6b6459] shadow-sm ring-1 ring-[#6b6459]/30' : 'border-[#d6d2c3] hover:bg-[#f7f3e3] opacity-60'}`}
                  >
                    <Sun className="w-4 h-4 text-yellow-700" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-yellow-900">Yellow</span>
                  </button>
                  {/* Dark Grey */}
                  <button 
                    onClick={() => onChangeTheme("theme-dark-grey")}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition bg-[#18181b] ${displayTheme === 'theme-dark-grey' ? 'border-[#f4f4f5] shadow-sm ring-1 ring-[#f4f4f5]/30' : 'border-[#3f3f46] hover:bg-[#27272a] opacity-60'}`}
                  >
                    <Moon className="w-4 h-4 text-[#f4f4f5]" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#f4f4f5]">Grey</span>
                  </button>
                  {/* Dark Blue */}
                  <button 
                    onClick={() => onChangeTheme("theme-dark-blue")}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition bg-[#0b1120] ${displayTheme === 'theme-dark-blue' ? 'border-[#38bdf8] shadow-sm ring-1 ring-[#38bdf8]/30' : 'border-[#1e3a5f] hover:bg-[#0f1f38] opacity-60'}`}
                  >
                    <Moon className="w-4 h-4 text-[#38bdf8]" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#38bdf8]">Blue</span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-sm space-y-6">
            <div className="flex items-center gap-3 border-b border-kindle-border pb-4">
              <div className="p-2 bg-kindle-bg/50 rounded-lg">
                <UserIcon className="w-5 h-5 text-kindle-text" />
              </div>
              <h3 className="font-bold text-sm">Account</h3>
            </div>

            {user && !user.isAnonymous ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                  <div className="w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center text-white font-bold">
                    {user.email?.[0].toUpperCase()}
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-xs font-bold truncate">{user.email}</p>
                    <p className="text-[9px] text-emerald-700 uppercase tracking-widest flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      Cloud Sync Active
                    </p>
                  </div>
                </div>
                <button 
                  onClick={onSignOut}
                  className="w-full py-2.5 border border-red-100 text-red-600 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-50 transition"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-kindle-text-muted leading-relaxed">
                  Sign in to Kora Cloud to sync your library, progress, and tags across all your devices.
                </p>
                <button 
                  onClick={onSignIn}
                  className="w-full py-3 bg-kindle-text text-kindle-bg rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-kindle-accent transition shadow-lg"
                >
                  Sign In / Create Account
                </button>
              </div>
            )}

            {/* Browser / Device Fingerprint display */}
            <div className="pt-4 border-t border-kindle-border">
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="w-4 h-4 text-kindle-text-muted" />
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Device Fingerprint</h4>
              </div>
              <div className="bg-kindle-bg border border-kindle-border rounded-xl p-3 flex flex-col gap-1">
                <p className="text-[9px] text-kindle-text-muted uppercase tracking-widest font-semibold leading-none mb-1">Unique Browser Identifier</p>
                <code className="text-xs font-mono select-all text-kindle-text break-all">
                  {fingerprint || "Calculating..."}
                </code>
              </div>
            </div>
          </section>
        </div>

        {/* Connectors & AI */}
        <div className="space-y-8">
          <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-sm space-y-6">
            <div className="flex items-center gap-3 border-b border-kindle-border pb-4">
              <div className="p-2 bg-kindle-bg/50 rounded-lg">
                <Database className="w-5 h-5 text-kindle-text" />
              </div>
              <h3 className="font-bold text-sm">Connectors</h3>
            </div>

            <div className="space-y-5">
              {[
                { id: "annas", name: "Anna's Archive", desc: "Mirror-based global search indexing", icon: <Globe className="w-4 h-4 text-blue-500" /> },
                { id: "mangadex", name: "MangaDex", desc: "Direct Manga API integration", icon: <Sparkles className="w-4 h-4 text-orange-500" /> },
                { id: "comicvine", name: "ComicVine", desc: "Comic book metadata and archives", icon: <BookMarked className="w-4 h-4 text-red-500" /> },
                { id: "zlib", name: "Z-Library", desc: "Shadow library direct integration", icon: <Database className="w-4 h-4 text-indigo-500" /> },
                { id: "openslum", name: "Open Slum Directory", desc: "Links to independent shadow libraries", icon: <ShieldCheck className="w-4 h-4 text-emerald-500" /> }
              ].map(c => (
                <div key={c.id} className="space-y-3">
                  <div className="flex items-center justify-between p-3 border border-kindle-border rounded-xl hover:bg-kindle-bg transition group">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-kindle-bg/50 rounded-lg group-hover:bg-kindle-card transition">{c.icon}</div>
                      <div>
                        <h4 className="text-xs font-bold">{c.name}</h4>
                        <p className="text-[9px] text-kindle-text-muted uppercase tracking-widest">{c.desc}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => onConnectorsChange({ ...connectors, [c.id]: !connectors[c.id] })}
                      className={`w-9 h-5 rounded-full transition-colors relative ${connectors[c.id] ? "bg-kindle-accent" : "bg-kindle-border"}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-kindle-bg rounded-full transition-transform ${connectors[c.id] ? "translate-x-4.5" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                  
                  {c.id === "zlib" && connectors["zlib"] && (
                    <div className="pl-14 pr-3 space-y-3 animate-in fade-in zoom-in duration-200">
                      <div>
                        <label className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted block mb-1">Base URL</label>
                        <input 
                          type="text" 
                          value={zlibConfig.baseUrl}
                          onChange={(e) => onZlibConfigChange({ ...zlibConfig, baseUrl: e.target.value })}
                          placeholder="https://z-library.rs"
                          className="w-full px-3 py-2 bg-kindle-bg border border-kindle-border rounded-lg text-xs font-mono focus:outline-none focus:border-kindle-accent"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted block mb-1">Email / Username</label>
                          <input 
                            type="text" 
                            value={zlibConfig.email}
                            onChange={(e) => onZlibConfigChange({ ...zlibConfig, email: e.target.value })}
                            className="w-full px-3 py-2 bg-kindle-bg border border-kindle-border rounded-lg text-xs font-mono focus:outline-none focus:border-kindle-accent"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted block mb-1">Password</label>
                          <input 
                            type="password" 
                            value={zlibConfig.password}
                            onChange={(e) => onZlibConfigChange({ ...zlibConfig, password: e.target.value })}
                            className="w-full px-3 py-2 bg-kindle-bg border border-kindle-border rounded-lg text-xs font-mono focus:outline-none focus:border-kindle-accent"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">Auto-discover Base URL</span>
                        <button 
                          onClick={() => onZlibConfigChange({ ...zlibConfig, autoDiscover: !zlibConfig.autoDiscover })}
                          className={`w-7 h-4 rounded-full transition-colors relative ${zlibConfig.autoDiscover ? "bg-kindle-accent" : "bg-kindle-border"}`}
                        >
                          <div className={`absolute top-0.5 w-3 h-3 bg-kindle-bg rounded-full transition-transform ${zlibConfig.autoDiscover ? "translate-x-3.5" : "translate-x-0.5"}`} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-sm space-y-6">
            <div className="flex items-center gap-3 border-b border-kindle-border pb-4">
              <div className="p-2 bg-kindle-bg/50 rounded-lg">
                <Cpu className="w-5 h-5 text-kindle-text" />
              </div>
              <h3 className="font-bold text-sm">AI Reading Companion</h3>
            </div>

            <div className="space-y-4">
              {/* Offline AI info */}
              <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-800 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold mb-0.5">Offline AI Companion Active</p>
                  <p className="text-[10px] text-emerald-700 leading-relaxed">Kora's built-in AI reader companion uses local extractive analysis and Wikipedia lookups — no API key required.</p>
                </div>
              </div>

              <div className="pt-2 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold">Custom AI Engine</h4>
                    <p className="text-[9px] text-kindle-text-muted uppercase tracking-widest">Connect your own OpenAI/Anthropic API</p>
                  </div>
                  <button 
                    onClick={() => setAiConfig({ ...aiConfig, useCustom: !aiConfig.useCustom })}
                    className={`w-9 h-5 rounded-full transition-colors relative ${aiConfig.useCustom ? "bg-kindle-accent" : "bg-kindle-border"}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-kindle-bg rounded-full transition-transform ${aiConfig.useCustom ? "translate-x-4.5" : "translate-x-0.5"}`} />
                  </button>
                </div>

                {aiConfig.useCustom && (
                  <div className="space-y-3 animate-in fade-in zoom-in duration-200">
                    <div>
                      <label className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted block mb-1">API Endpoint</label>
                      <input 
                        type="text" 
                        value={aiConfig.customEndpoint}
                        onChange={(e) => setAiConfig({ ...aiConfig, customEndpoint: e.target.value })}
                        placeholder="https://api.openai.com/v1"
                        className="w-full px-3 py-2 bg-kindle-bg border border-kindle-border rounded-lg text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted block mb-1">API Key</label>
                      <div className="relative">
                        <input 
                          type="password" 
                          value={aiConfig.customKey}
                          onChange={(e) => setAiConfig({ ...aiConfig, customKey: e.target.value })}
                          placeholder="sk-..."
                          className="w-full pl-9 pr-3 py-2 bg-kindle-bg border border-kindle-border rounded-lg text-xs font-mono"
                        />
                        <Key className="w-3.5 h-3.5 text-kindle-text-muted absolute left-3 top-2.5" />
                      </div>
                    </div>
                    <p className="text-[9px] text-amber-600 bg-amber-50 p-2 rounded border border-amber-100 flex items-start gap-1.5">
                      <ShieldCheck className="w-3 h-3 mt-0.5" />
                      Custom keys are stored locally in your browser and never sent to our servers.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      <footer className="pt-12 border-t border-kindle-border flex flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-kindle-accent" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Kora v2.5.0 • Stable Release</span>
        </div>
        <p className="text-[9px] text-kindle-text-muted max-w-sm">
          Crafted for high-performance reading and digital sovereignty. Open-source philosophy with secure cloud backup.
        </p>
      </footer>
    </div>
  );
}
