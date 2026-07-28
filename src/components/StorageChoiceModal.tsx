import React from "react";
import { motion } from "motion/react";
import { FolderOpen, Database, ShieldCheck, Zap } from "lucide-react";

export type StorageChoice = "saf" | "virtual";

interface StorageChoiceModalProps {
  onChoose: (mode: StorageChoice) => void;
}

/**
 * First-run storage choice for the Kora APK.
 *  - "saf": new way — pick a real device folder (Kora/) via the system picker.
 *  - "virtual": old way — app-managed internal storage (no system picker).
 */
export default function StorageChoiceModal({ onChoose }: StorageChoiceModalProps) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 kora-safe-top">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md bg-kindle-bg border border-kindle-border rounded-3xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-bold text-kindle-text flex items-center gap-2">
            <Database className="w-5 h-5 text-kindle-accent" /> Choose where Kora stores files
          </h2>
          <p className="text-xs text-kindle-text-muted mt-1.5 leading-relaxed">
            Pick how Kora saves your books, audiobooks, news, and data. You can change this later in Settings.
          </p>
        </div>

        <div className="p-5 space-y-3">
          <button
            type="button"
            onClick={() => onChoose("saf")}
            className="w-full text-left p-4 rounded-2xl border border-kindle-border bg-kindle-card hover:border-kindle-accent transition cursor-pointer"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-kindle-accent/10 border border-kindle-accent/25 flex items-center justify-center shrink-0">
                <FolderOpen className="w-5 h-5 text-kindle-accent" />
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-sm font-bold text-kindle-text">
                  Device Folder <Zap className="w-3.5 h-3.5 text-kindle-accent" />
                </div>
                <p className="text-[11px] text-kindle-text-muted mt-1 leading-relaxed">
                  Pick a real folder on your device/storage. Files show up in your system Files app and survive reinstalls.
                </p>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onChoose("virtual")}
            className="w-full text-left p-4 rounded-2xl border border-kindle-border bg-kindle-card hover:border-kindle-accent transition cursor-pointer"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-kindle-accent/10 border border-kindle-accent/25 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-kindle-accent" />
              </div>
              <div>
                <div className="text-sm font-bold text-kindle-text">App Storage</div>
                <p className="text-[11px] text-kindle-text-muted mt-1 leading-relaxed">
                  Let Kora manage its own storage. No system picker, fewer permissions — the most stable option if the folder picker crashes.
                </p>
              </div>
            </div>
          </button>
        </div>

        <div className="px-6 py-4 border-t border-kindle-border text-[10px] text-kindle-text-muted">
          Tip: if the device-folder picker ever misbehaves on your device, switch to App Storage in Settings.
        </div>
      </motion.div>
    </div>
  );
}
