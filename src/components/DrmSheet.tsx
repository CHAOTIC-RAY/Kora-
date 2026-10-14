/**
 * DRM refusal sheet.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────
 * Kora detects DRM and refuses. It does not decrypt, and this component is the
 * place where that refusal is explained — because "the file did not open" with
 * no explanation is indistinguishable from a bug, and a user who paid for a
 * book deserves to be told what is actually wrong with it.
 *
 * The value here is the same value as anywhere else in this feature: a clear
 * sentence at the right moment. The sheet exists so the refusal is a designed
 * outcome rather than a dead end, and so it can be reviewed in one place for
 * anything that drifts toward promising a workaround.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────
 * It names no tool, gives no removal steps, and does not claim Kora could open
 * the file with some other configuration. Those constraints are asserted in
 * `src/lib/__tests__/drmDetect.test.ts`, against every message this component
 * can be handed — so a future edit that adds a tool name fails the suite rather
 * than shipping.
 */

import React from "react";
import { AlertTriangle, ShieldOff, X } from "lucide-react";

export interface DrmSheetProps {
  open: boolean;
  /** The sentence from `drmSummary(detection)`, or any equivalent. */
  message: string | null | undefined;
  /** Book title, when known. */
  title?: string;
  onClose: () => void;
  /** Shown when known, e.g. "Kindle book" or "EPUB". */
  formatLabel?: string;
}

export default function DrmSheet({ open, message, title, onClose, formatLabel }: DrmSheetProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kora-drm-title"
    >
      <div className="w-full max-w-sm rounded-2xl border border-kindle-border bg-kindle-card shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 p-5 pb-3">
          <div className="shrink-0 mt-0.5 w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <ShieldOff className="w-4.5 h-4.5 text-amber-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="kora-drm-title" className="text-sm font-bold text-kindle-text">
              {title ? `“${title}” is protected` : "This book is protected"}
            </h2>
            {formatLabel && (
              <p className="text-[11px] text-kindle-text-muted mt-0.5">{formatLabel}</p>
            )}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 text-kindle-text-muted hover:text-kindle-text transition"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-4 space-y-3">
          <p className="text-xs leading-relaxed text-kindle-text-muted">
            {message ||
              "This file is protected and cannot be opened. If you own the book, export a DRM-free copy to EPUB or PDF with the tools you already use, then import that."}
          </p>

          <div className="rounded-xl border border-kindle-border bg-kindle-bg/50 px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-kindle-text-muted" />
            <p className="text-[10px] leading-relaxed text-kindle-text-muted">
              Kora checks for this so a protected book is named as protected, instead of
              opening as blank pages and looking like a broken file.
            </p>
          </div>
        </div>

        <div className="p-4 pt-0">
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-kindle-text px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-kindle-bg hover:opacity-90 transition"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}