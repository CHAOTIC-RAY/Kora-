/**
 * Source detail sheet.
 *
 * A source is a trust decision, and a card three lines tall cannot carry the
 * information that decision needs: what the site is, whether it is a shadow
 * library, what it actually fetches, where the code came from. This is where
 * that lives, so the choice is made with the facts on screen rather than
 * from a name in a list.
 */

import { X, ExternalLink, ShieldAlert, Download, Check, Trash2, Puzzle, Globe, Info, Loader2 } from "lucide-react";
import type { SourcePlugin } from "../lib/sources/types";

export interface SourceDetailProps {
  plugin: SourcePlugin;
  installed: boolean;
  active: boolean;
  busy?: boolean;
  repoName?: string;
  onInstall: () => void;
  onUninstall: () => void;
  onToggleAllow: () => void;
  onClose: () => void;
}

/** Human summary of what a source reaches for, derived from its shape. */
function capabilities(p: SourcePlugin): string[] {
  const out: string[] = [];
  if (p.theme === "madara") out.push("Listing, details, chapters and page images");
  else if (p.api === "json") out.push("Search and details");
  else {
    if (p.endpoints?.popular) out.push("Browse a catalogue");
    if (p.endpoints?.latest) out.push("Newest releases");
    if (p.endpoints?.search) out.push("Search");
    if (p.endpoints?.details) out.push("Title details");
    if (p.endpoints?.chapters) out.push("Chapter list");
    if (p.endpoints?.pages) out.push("Page images");
  }
  return out.length ? out : ["Listing and search"];
}

export function SourceDetail({
  plugin,
  installed,
  active,
  busy,
  repoName,
  onInstall,
  onUninstall,
  onToggleAllow,
  onClose,
}: SourceDetailProps) {
  const restricted = plugin.piracy || plugin.nsfw;
  const host = (() => {
    const u = plugin.gen2?.homeUrl || plugin.baseUrl || "";
    return u.replace(/^https?:\/\//, "").replace(/\/$/, "");
  })();

  return (
    <div
      // Above the onboarding wizard and mobile footer (both z-50). Sharing a
      // stacking level with them means whichever mounts last wins, and a
      // first-run user would see the wizard instead of the source they asked
      // about.
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${plugin.name} details`}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
      />

      <div className="relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-kindle-border bg-kindle-card shadow-2xl">
        {/* Banner — a tinted header so a restricted source is unmistakable
            the moment the sheet opens, not just in the list. */}
        <div
          className={`relative h-28 sm:h-32 flex items-end p-5 ${
            restricted
              ? "bg-gradient-to-br from-amber-600/25 via-amber-500/10 to-red-600/20"
              : "bg-gradient-to-br from-kindle-accent/20 via-kindle-accent/10 to-transparent"
          }`}
        >
          {plugin.icon && (
            <img
              src={plugin.icon}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-20"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          )}

          <div className="relative flex items-end gap-4 w-full">
            <div className="w-16 h-16 shrink-0 rounded-2xl border border-kindle-border bg-kindle-bg overflow-hidden flex items-center justify-center shadow-sm">
              {plugin.icon ? (
                <img
                  src={plugin.icon}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                    e.currentTarget.nextElementSibling?.classList.remove("hidden");
                  }}
                />
              ) : null}
              <Puzzle className={`w-6 h-6 text-kindle-text-muted ${plugin.icon ? "hidden" : ""}`} />
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <h2 className="text-lg font-bold text-kindle-text leading-tight truncate">
                {plugin.name}
              </h2>
              <p className="text-[10px] uppercase tracking-widest text-kindle-text-muted">
                {plugin.lang}
                {plugin.kind ? ` · ${plugin.kind}` : ""}
                {plugin.theme ? ` · ${plugin.theme}` : ""}
              </p>
            </div>

            <button
              onClick={onClose}
              aria-label="Close details"
              className="shrink-0 w-8 h-8 rounded-full border border-kindle-border bg-kindle-bg/80 flex items-center justify-center hover:opacity-70 transition"
            >
              <X className="w-4 h-4 text-kindle-text" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Status row */}
          <div className="flex flex-wrap items-center gap-2">
            {restricted && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-amber-700">
                <ShieldAlert className="w-3 h-3" />
                {plugin.piracy ? "Shadow library" : "Adult content"}
              </span>
            )}
            {!restricted && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-700">
                <Check className="w-3 h-3" /> Open content
              </span>
            )}

            {installed && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-kindle-border px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">
                Installed
              </span>
            )}
            {active && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-700">
                <Check className="w-3 h-3" /> Active
              </span>
            )}
            {repoName && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-kindle-border px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted">
                <Globe className="w-3 h-3" /> {repoName}
              </span>
            )}
          </div>

          {restricted && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-3 text-[11px] leading-relaxed text-kindle-text-muted">
              This source points at a site that hosts material it has no clear
              right to distribute. Kora does not host or mirror it — it reads
              pages from the origin site and shows them to you. Nothing is
              fetched until you enable it, and the choice is remembered on this
              device.
            </p>
          )}

          {/* What it does */}
          <section>
            <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted mb-2">
              <Info className="w-3.5 h-3.5" /> What it does
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {capabilities(plugin).map((c) => (
                <li
                  key={c}
                  className="rounded-lg border border-kindle-border bg-kindle-bg px-2.5 py-1 text-[10px] text-kindle-text-muted"
                >
                  {c}
                </li>
              ))}
            </ul>
          </section>

          {/* Facts */}
          <section className="space-y-2 text-[11px]">
            {host && (
              <Row label="Website">
                <a
                  href={plugin.gen2?.homeUrl || plugin.baseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-kindle-accent hover:underline break-all"
                >
                  {host} <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </Row>
            )}
            <Row label="Source id">
              <span className="font-mono text-kindle-text-muted break-all">{plugin.id}</span>
            </Row>
            {plugin.gen2?.packageName && (
              <Row label="Package">
                <span className="font-mono text-kindle-text-muted break-all">
                  {plugin.gen2.packageName}
                </span>
              </Row>
            )}
            {plugin.gen2?.versionName && (
              <Row label="Version">
                <span className="font-mono text-kindle-text-muted">
                  {plugin.gen2.versionName}
                  {plugin.gen2.versionCode ? ` (${plugin.gen2.versionCode})` : ""}
                </span>
              </Row>
            )}
            {plugin.madara?.mangaSubString && (
              <Row label="Listing at">
                <span className="font-mono text-kindle-text-muted">
                  /{plugin.madara.mangaSubString}/
                </span>
              </Row>
            )}
          </section>

          <p className="text-[10px] leading-relaxed text-kindle-text-muted/70 border-t border-kindle-border pt-3">
            A source is a set of rules — selectors and urls — not code. Kora
            never runs anything it downloads, so a source cannot do more than
            make the requests its own definition describes.
          </p>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {installed ? (
              <>
                <button
                  onClick={onUninstall}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-kindle-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-red-500 hover:border-red-500/40 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
                {restricted && !active && (
                  <button
                    onClick={onToggleAllow}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white hover:opacity-90 transition"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" /> Enable this source
                  </button>
                )}
                {active && !restricted && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                    <Check className="w-3.5 h-3.5" /> Searching in Discover
                  </span>
                )}
              </>
            ) : (
              <button
                onClick={onInstall}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-kindle-text px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-kindle-bg hover:opacity-90 transition disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {busy ? "Installing…" : "Install"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-24 shrink-0 text-[10px] uppercase tracking-widest text-kindle-text-muted/70 pt-px">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
