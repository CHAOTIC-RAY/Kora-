import React from "react";
import { User } from "firebase/auth";
import { 
  Moon, Sun, Monitor, 
  User as UserIcon, ShieldCheck, BookOpen,
  Clock, LogIn
} from "lucide-react";

interface SettingsViewProps {
  user: User | null;
  grayscaleCovers: boolean;
  displayTheme: string;
  onToggleGrayscale: () => void;
  onChangeTheme: (theme: string) => void;
  onSignOut: () => void;
  onSignIn: () => void;
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

export default function SettingsView({ 
  user, 
  grayscaleCovers,
  displayTheme,
  onToggleGrayscale, 
  onChangeTheme,
  onSignOut, 
  onSignIn
}: SettingsViewProps) {
  return (
    <div className="max-w-xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="space-y-1.5 text-center">
        <h2 className="text-2xl font-bold font-lexend tracking-tight text-kindle-text">Settings</h2>
        <p className="text-[10px] text-kindle-text-muted uppercase tracking-widest font-bold">Preferences & Cloud Sync</p>
      </header>

      <div className="space-y-6">
        {/* Appearance Section */}
        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
            <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
              <Monitor className="w-4 h-4 text-kindle-text" />
            </div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">Appearance</h3>
          </div>
          
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold">Grayscale Covers</h4>
                <p className="text-[10px] text-kindle-text-muted">Classic e-ink aesthetic for book covers</p>
              </div>
              <button 
                onClick={onToggleGrayscale}
                className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${grayscaleCovers ? "bg-kindle-accent" : "bg-neutral-300"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${grayscaleCovers ? "translate-x-5.5" : "translate-x-0.5"}`} />
              </button>
            </div>

            <div className="space-y-2.5">
              <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">Display Theme</h4>
              <div className="grid grid-cols-2 gap-2">
                {/* White / Light */}
                <button 
                  onClick={() => onChangeTheme("theme-light-white")}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition cursor-pointer ${displayTheme === 'theme-light-white' ? 'bg-kindle-card border-kindle-accent shadow-xs ring-1 ring-kindle-accent/30' : 'border-kindle-border hover:bg-kindle-card opacity-65'}`}
                >
                  <Sun className="w-4 h-4" />
                  <span className="text-[9px] font-bold uppercase tracking-widest">White</span>
                </button>
                {/* Yellow / Sepia */}
                <button 
                  onClick={() => onChangeTheme("theme-light-yellow")}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition cursor-pointer ${displayTheme === 'theme-light-yellow' ? 'bg-[#f7f3e3] border-[#6b6459] shadow-xs ring-1 ring-[#6b6459]/30' : 'border-[#d6d2c3] hover:bg-[#f7f3e3] opacity-65'}`}
                >
                  <Sun className="w-4 h-4 text-yellow-700" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-yellow-900">Yellow</span>
                </button>
                {/* Dark Grey */}
                <button 
                  onClick={() => onChangeTheme("theme-dark-grey")}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition bg-[#18181b] cursor-pointer ${displayTheme === 'theme-dark-grey' ? 'border-[#f4f4f5] shadow-xs ring-1 ring-[#f4f4f5]/30' : 'border-[#3f3f46] hover:bg-[#27272a] opacity-65'}`}
                >
                  <Moon className="w-4 h-4 text-[#f4f4f5]" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[#f4f4f5]">Grey</span>
                </button>
                {/* Dark Blue */}
                <button 
                  onClick={() => onChangeTheme("theme-dark-blue")}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition bg-[#0b1120] cursor-pointer ${displayTheme === 'theme-dark-blue' ? 'border-[#38bdf8] shadow-xs ring-1 ring-[#38bdf8]/30' : 'border-[#1e3a5f] hover:bg-[#0f1f38] opacity-65'}`}
                >
                  <Moon className="w-4 h-4 text-[#38bdf8]" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[#38bdf8]">Blue</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Account & Sync Section */}
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
