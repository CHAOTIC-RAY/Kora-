/**
 * Trust confirmation before a third-party plugin registry is added.
 *
 * WHY THIS IS A CONTROL AND NOT A FORMALITY
 * ----------------------------------------
 * A Kora source plugin is not passive data. It carries the CSS selectors and
 * request shapes used to scrape a site, and Kora will run those selectors
 * against whatever URL the plugin names, on every refresh, with the user's
 * network access. A registry is therefore a pointer to code that will
 * execute-ish in the user's browsing context. Adding one silently means any
 * URL pasted — or autofilled, or arrived at by redirect — becomes trusted with
 * one tap and no indication that anything changed.
 *
 * So: adding a THIRD-PARTY registry requires an explicit confirmation that
 * names the host and says what is being trusted. Kora's own default registry
 * is NOT gated, because it ships with the app, is already trusted by the
 * install itself, and prompting about it every session would train users to
 * click through exactly the dialog that matters.
 *
 * WHAT THE DIALOG DOES NOT DO
 * ---------------------------
 * It does not claim to have verified anything. It cannot: the registry's
 * contents are fetched after this point, and a manifest can change between the
 * moment a user trusts a URL and the moment a plugin is installed. It shows the
 * host so the user can recognise it, and it is honest that this is a trust
 * decision rather than a safety guarantee.
 */

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, ShieldAlert, X } from "lucide-react";

/**
 * Kora's own registry. Trusted without a prompt — see the module note.
 *
 * BOTH repo names are listed deliberately. The registry was renamed
 * Kora-Sources -> Kora-Plugins, and users in the wild still hold the old URL
 * in localStorage until `purgeRetiredRepos` runs. Keeping the old name exempt
 * means a user mid-migration is never shown a "trust this third-party repo?"
 * warning about Kora's OWN registry.
 *
 * The check is anchored to the OFFICIAL host and owner, not a bare substring.
 * A substring test would let any URL that merely contains "Kora-Plugins" —
 * `https://evil.example.com/Kora-Plugins/main/index.json` — skip the trust
 * prompt entirely, which is precisely the attack this dialog exists to stop.
 * So the URL must be on github/githubusercontent, owned by CHAOTIC-RAY, and
 * name one of the two real registry repos.
 *
 * A regression here is user-visible for EVERY install, so it is covered by
 * tests in src/lib/sources/__tests__/trustRepoRename.test.ts.
 */
const DEFAULT_REPO_HOST_FRAGMENTS = ["Kora-Plugins", "Kora-Sources"];
const OFFICIAL_OWNER = "chaotic-ray";
const OFFICIAL_HOSTS = ["raw.githubusercontent.com", "github.com"];

/**
 * The hostname of a repository URL, for display.
 *
 * Returns the input unchanged when `URL` cannot parse it, so the dialog can
 * still show the user what they typed rather than an empty host. Callers must
 * validate before trusting; this is presentation only.
 */
export function repoHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Is this Kora's own shipped registry?
 *
 * True for the current Kora-Plugins URL and for the pre-rename Kora-Sources
 * URL, but ONLY when both live on an official GitHub host under the official
 * owner. Falls back to a substring test only for URLs `URL` cannot parse,
 * which in practice means the user typed something that is not a URL at all —
 * it is rejected as a repo before it ever reaches this function.
 */
export function isKoraDefaultRepoUrl(url: string): boolean {
  const names = DEFAULT_REPO_HOST_FRAGMENTS.map((n) => n.toLowerCase());
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    /* fall through to the unanchored check below */
  }
  if (!parsed) {
    const lower = url.toLowerCase();
    return names.some((n) => lower.includes(n));
  }
  const host = parsed.hostname.toLowerCase();
  if (!OFFICIAL_HOSTS.includes(host)) return false;
  // Path must be <owner>/<repo>… and the owner must be the official one.
  const segments = parsed.pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());
  if (segments.length < 2) return false;
  if (segments[0] !== OFFICIAL_OWNER) return false;
  return names.includes(segments[1]);
}

export interface TrustRepoModalProps {
  /** The URL about to be added, or null when the dialog is closed. */
  url: string | null;
  onConfirm: (url: string) => void;
  onCancel: () => void;
}

export default function TrustRepoModal({ url, onConfirm, onCancel }: TrustRepoModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Reset the acknowledgement whenever a NEW url is proposed, so a previous
  // "yes" cannot carry over to a different host.
  useEffect(() => {
    setAcknowledged(false);
    if (url) confirmRef.current?.focus();
  }, [url]);

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url, onCancel]);

  if (!url) return null;

  const host = repoHost(url);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kora-trust-repo-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-kindle-border bg-kindle-card shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 p-5 pb-3">
          <div className="shrink-0 mt-0.5 w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <ShieldAlert className="w-4.5 h-4.5 text-amber-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="kora-trust-repo-title" className="text-sm font-bold text-kindle-text">
              Trust this plugin registry?
            </h2>
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
          <p className="text-xs leading-relaxed text-kindle-text-muted">
            Plugins from this registry run their own selectors against external
            sites, using your connection. Only continue if you trust the person
            or project behind it.
          </p>

          <div className="rounded-xl border border-kindle-border bg-kindle-bg/60 px-3 py-2.5 space-y-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">
              Host
            </p>
            <p className="text-[11px] font-mono text-kindle-text break-all">{host}</p>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-kindle-border bg-kindle-bg accent-kindle-accent shrink-0"
            />
            <span className="text-[11px] leading-relaxed text-kindle-text-muted">
              I trust{" "}
              <span className="font-mono text-kindle-text break-all">{host}</span> and
              understand it can add sources, themes and integrations to my library.
            </span>
          </label>
        </div>

        <div className="flex gap-2 p-4 pt-0">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-kindle-border px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text transition"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            disabled={!acknowledged}
            onClick={() => {
              onConfirm(url);
            }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-white transition enabled:hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Trust &amp; add
          </button>
        </div>
      </div>
    </div>
  );
}