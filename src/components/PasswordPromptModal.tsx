/**
 * Password prompt for an encrypted comic archive.
 *
 * ── WHY THIS PROMPT IS SHAPED THE WAY IT IS ────────────────────────────
 *
 * **The password is never stored.** Not in localStorage, not in the
 * preferences layer, not in a module-level variable that outlives the reader.
 * A reader's job is to open the file the user just picked; keeping a copy of a
 * credential afterwards is a liability with no benefit, because the next time
 * the user opens the same archive they will have to type it again and the
 * prompt is right there.
 *
 * **It is shown only once per open.** The archive layer returns a
 * `needs-password` result, the caller prompts, and the result of a wrong
 * password is a refusal — never another `needs-password`. That is what stops a
 * user from being trapped re-typing a password the decoder cannot accept.
 *
 * **It says plainly when the password cannot help.** If the bundled decoder has
 * no crypto support, the caller passes `canDecrypt={false}` and this dialog
 * says so instead of collecting a secret that will be discarded. Asking for a
 * password you already know you cannot use is worse than not asking.
 */

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Eye, EyeOff, KeyRound, X } from "lucide-react";

export interface PasswordPromptModalProps {
  open: boolean;
  /** Archive filename, shown so the user knows what they are unlocking. */
  fileName?: string;
  /**
   * False when the decoder provably cannot decrypt even with the right
   * password. The confirm button is then disabled and the reason is shown.
   */
  canDecrypt?: boolean;
  /** Shown when `canDecrypt` is false. */
  unsupportedReason?: string;
  /** Shown after a wrong password, so the user knows their entry was rejected. */
  error?: string | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
  busy?: boolean;
}

export default function PasswordPromptModal({
  open,
  fileName,
  canDecrypt = true,
  unsupportedReason,
  error,
  onSubmit,
  onCancel,
  busy = false,
}: PasswordPromptModalProps) {
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Never carry a password across opens: a stale value in the field is both a
  // small disclosure risk and a confusing "why is it already filled in".
  useEffect(() => {
    if (open) {
      setPassword("");
      setReveal(false);
      // Focus after paint so the keyboard does not fight the dialog animation.
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const submit = () => {
    // An empty password is never a real archive password, and submitting it
    // produces a confusing error instead of a useful one.
    if (!password || !canDecrypt || busy) return;
    onSubmit(password);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kora-archive-password-title"
    >
      <div className="w-full max-w-sm rounded-2xl border border-kindle-border bg-kindle-card shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 p-5 pb-3">
          <div className="shrink-0 mt-0.5 w-9 h-9 rounded-xl bg-kindle-accent/15 border border-kindle-accent/30 flex items-center justify-center">
            <KeyRound className="w-4.5 h-4.5 text-kindle-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="kora-archive-password-title" className="text-sm font-bold text-kindle-text">
              This archive is password-protected
            </h2>
            {fileName && (
              <p className="text-[11px] text-kindle-text-muted mt-0.5 truncate font-mono">
                {fileName}
              </p>
            )}
            <button
              onClick={onCancel}
              className="absolute top-3 right-3 text-kindle-text-muted hover:text-kindle-text transition"
              aria-label="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-4 space-y-3">
          {canDecrypt ? (
            <>
              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted mb-1.5">
                  Password
                </span>
                <div className="relative">
                  <input
                    ref={inputRef}
                    type={reveal ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submit();
                    }}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="Archive password"
                    className="w-full rounded-xl border border-kindle-border bg-kindle-bg px-3 py-2.5 pr-10 text-sm text-kindle-text placeholder:text-kindle-text-muted/50 focus:border-kindle-accent/50 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-kindle-text-muted hover:text-kindle-text transition"
                    aria-label={reveal ? "Hide password" : "Show password"}
                  >
                    {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>

              {error && (
                <p className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/5 px-3 py-2 text-[11px] text-red-600">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </p>
              )}
            </>
          ) : (
            // The honest case: the decoder cannot decrypt. Say so instead of
            // collecting a credential that would be thrown away.
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
              <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                {unsupportedReason ??
                  "The archive decoder bundled with this build cannot decrypt archives, so a password will not help."}
              </p>
            </div>
          )}

          <p className="text-[10px] leading-relaxed text-kindle-text-muted/70">
            Kora keeps the password in memory only while this dialog is open. It is never
            written to storage.
          </p>
        </div>

        <div className="flex gap-2 p-4 pt-0">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-kindle-border px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text transition"
          >
            Cancel
          </button>
          {canDecrypt && (
            <button
              onClick={submit}
              disabled={!password || busy}
              className="flex-1 rounded-xl bg-kindle-accent px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-white transition enabled:hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? "Opening…" : "Open"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}