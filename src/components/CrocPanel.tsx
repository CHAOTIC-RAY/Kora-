/**
 * croc — the Workshop panel for the "croc" integration plugin.
 *
 * WHAT THIS PANEL DOES, AND WHY IT IS NOT MORE
 * -------------------------------------------
 * It receives. The user runs `croc send book.epub` on a laptop, gets a code
 * like `acid-alkali-molasses`, types it here, and the file comes to the device
 * Kora is on. Sending from Kora is not implemented in this phase: it needs an
 * upload path, and a browser cannot zip a directory, so "send this folder" would
 * be a button that cannot do what it says.
 *
 * The receive hands off to the official croc web client, which is a full croc
 * peer running the real Go crypto compiled to WASM. Kora cannot be that peer
 * itself: the WASM is not published to npm, is built into a gitignored directory
 * by `make build-web`, and the public copy at getcroc.com is served without
 * `Access-Control-Allow-Origin` so another origin cannot load it. This panel
 * says that in the UI rather than showing a button that quietly does nothing.
 *
 * The security facts are on screen, not in a docs folder, because they change
 * what a user should do: 20.7 bits of secret, a relay that can see room names
 * and timing, and a sender that can try to attack the receiving filesystem.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Radio,
  Server,
  Shield,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  CROC_PUBLIC_RELAYS,
  crocReceiveUrl,
  crocRelayCommand,
  crocRelayCommandDisplay,
  crocSecretSummary,
  crocWasmPeerAvailable,
  crocWebCommand,
  normaliseCrocCode,
  parseCrocCode,
  type CrocRelaySettings,
} from "../lib/croc/client";
import {
  clearCrocSettings,
  getCrocSettings,
  saveCrocSettings,
  validateCrocSettings,
} from "../lib/croc/settings";

type SaveState =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "error"; text: string };

const inputClass =
  "w-full px-3 py-2 rounded-xl bg-kindle-bg border border-kindle-border " +
  "text-sm text-kindle-text focus:outline-none focus:border-kindle-accent";

const labelClass =
  "block text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted mb-1.5";

export default function CrocPanel({ onClose }: { onClose?: () => void }) {
  const [code, setCode] = useState("");
  const [settings, setSettings] = useState<CrocRelaySettings>(() => getCrocSettings());
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Parse on every keystroke. Cheap, and it means the security readout and the
  // button state can never disagree with what is in the field.
  const parsed = useMemo(() => parseCrocCode(code), [code]);
  const normalised = useMemo(() => normaliseCrocCode(code), [code]);
  const receiveUrl = useMemo(
    () => (parsed.ok ? crocReceiveUrl(settings, normalised) : ""),
    [parsed, settings, normalised]
  );

  const persist = useCallback(
    (next: CrocRelaySettings) => {
      const result = validateCrocSettings(next);
      if (!result.ok) {
        setSave({ kind: "error", text: result.error });
        return;
      }
      setSettings(result.value);
      saveCrocSettings(result.value);
      setSave({ kind: "saved" });
    },
    []
  );

  // Clear the "Saved" tick so it does not sit there claiming something stale.
  useEffect(() => {
    if (save.kind !== "saved") return;
    const t = setTimeout(() => setSave({ kind: "idle" }), 2500);
    return () => clearTimeout(t);
  }, [save]);

  const copy = useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Could not copy — select the text and copy it manually.");
    }
  }, []);

  const startReceive = useCallback(() => {
    if (!receiveUrl) return;
    window.open(receiveUrl, "_blank", "noopener,noreferrer");
  }, [receiveUrl]);

  return (
    <div className="space-y-5">
      {/* ── What this is ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 rounded-xl border border-kindle-border bg-kindle-bg/50 px-3 py-2.5">
        <Shield className="w-4 h-4 shrink-0 mt-0.5 text-kindle-accent" />
        <p className="text-[11px] leading-relaxed text-kindle-text-muted">
          <span className="text-kindle-text font-semibold">croc</span> is an open-source
          command-line file transfer tool by Zack Scholl, used here to{" "}
          <span className="text-kindle-text font-semibold">receive</span> a file. This plugin
          was written by Kora; croc itself is MIT-licensed and is not bundled into the app.
        </p>
      </div>

      {/* ── Receive ──────────────────────────────────────────────────────── */}
      <section className="space-y-2.5">
        <h4 className="text-xs font-bold uppercase tracking-widest text-kindle-text flex items-center gap-2">
          <Radio className="w-4 h-4 text-kindle-accent" />
          Receive a file
        </h4>
        <p className="text-[11px] leading-relaxed text-kindle-text-muted">
          On the other machine run{" "}
          <code className="px-1 py-0.5 rounded bg-kindle-card text-kindle-text text-[10px]">
            croc send book.epub
          </code>
          . It prints a three-word code. Type it here.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="acid-alkali-molasses"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          aria-label="croc code"
          className={inputClass}
        />

        {code.trim() !== "" &&
          (parsed.ok ? (
            <div className="rounded-xl border border-kindle-border bg-kindle-card/40 px-3 py-2.5 space-y-1.5">
              <p className="text-[11px] text-kindle-text flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-kindle-accent shrink-0" />
                <span className="font-semibold">{parsed.components.format} code</span>
                <span className="text-kindle-text-muted">· room {parsed.components.roomSelector}</span>
              </p>
              <p className="text-[10px] leading-relaxed text-kindle-text-muted">
                {crocSecretSummary(parsed.components.format)}
              </p>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-kindle-accent flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {parsed.error}
            </p>
          ))}

        <button
          type="button"
          onClick={startReceive}
          disabled={!receiveUrl}
          className="w-full py-3 rounded-2xl bg-kindle-text text-kindle-bg font-bold text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <ExternalLink className="w-4 h-4" />
          Receive in the croc client
        </button>
        <p className="text-[10px] leading-relaxed text-kindle-text-muted">
          Opens croc&apos;s own web client with the code already filled in and the transfer
          starting. Kora cannot run the transfer in this tab — see the note below.
        </p>
      </section>

      {/* ── Honest capability state ──────────────────────────────────────── */}
      {!crocWasmPeerAvailable() && (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 space-y-1.5">
          <p className="text-[11px] font-bold text-kindle-text flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            In-app WASM peer support: not yet available
          </p>
          <p className="text-[10px] leading-relaxed text-kindle-text-muted">
            croc&apos;s browser peer is the real Go cryptography (PAKE, AES-GCM) compiled to
            WebAssembly. That build is not published to npm, and the public copy is served
            without cross-origin permission, so Kora cannot load it. The button above hands
            the receive to croc&apos;s official client instead, which does. Sending from Kora is
            also not implemented — a browser cannot bundle a folder into a single file.
          </p>
        </section>
      )}

      {/* ── Security ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-kindle-border bg-kindle-card/30 px-3 py-2.5 space-y-2">
        <p className="text-[11px] font-bold text-kindle-text flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-kindle-accent" />
          Before you use this
        </p>
        <ul className="space-y-1.5 text-[10px] leading-relaxed text-kindle-text-muted">
          <li>
            <span className="text-kindle-text font-semibold">The code is short by design.</span>{" "}
            Only the last two of the three words are secret — roughly 20.7 bits. The first word
            is a room name the relay can see. Do not reuse a code, and treat a code as
            something you would type into a public terminal.
          </li>
          <li>
            <span className="text-kindle-text font-semibold">The relay can see metadata.</span>{" "}
            The relay connection uses a hardcoded public key, so the relay operator can read
            which rooms exist, when, and how big the transfers are. It cannot read file
            contents and cannot pose as the other peer. File data is AES-256-GCM encrypted
            with a key derived from the two secret words.
          </li>
          <li>
            <span className="text-kindle-text font-semibold">The sender can attack this device.</span>{" "}
            A malicious sender has tried to abuse the receiving filesystem — path traversal,
            symlink overwrite, and a case-insensitive bypass of the{" "}
            <code className="text-[9px]">.ssh</code> guard (GHSA-wmw5-q587-gx56,
            GHSA-m6m7-376m-rr8g, GHSA-pcm6-vvg3-3xmh, GHSA-x89h-7h96-v88f). Only accept codes
            from someone you trust, the same way you would only open an attachment from a
            sender you know.
          </li>
        </ul>
      </section>

      {/* ── Advanced: your own relay ─────────────────────────────────────── */}
      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[10px] font-bold uppercase tracking-widest text-kindle-accent hover:underline"
        >
          {showAdvanced ? "Hide" : "Show"} your own relay
        </button>

        {showAdvanced && (
          <div className="space-y-3 rounded-xl border border-kindle-border bg-kindle-bg/40 p-3">
            <p className="text-[10px] leading-relaxed text-kindle-text-muted">
              Kora runs on Cloudflare Workers, which can open outbound connections but can never
              listen on one. So Kora can be a croc client but never the relay. To keep croc off
              the public pool, run a relay yourself — it is a single binary, no TLS needed, and
              the password comes from <code className="text-[9px]">CROC_PASS</code>.
            </p>

            <div>
              <label className={labelClass} htmlFor="croc-web-url">
                croc-web address
              </label>
              <input
                id="croc-web-url"
                value={settings.webUrl}
                onChange={(e) => {
                  setSettings({ ...settings, webUrl: e.target.value });
                  setSave({ kind: "idle" });
                }}
                onBlur={() => persist(settings)}
                placeholder="https://getcroc.com"
                className={inputClass}
              />
              <p className="mt-1 text-[10px] text-kindle-text-muted">
                Leave this alone to use croc&apos;s official client. Change it to your own
                croc-web if you run one.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="croc-relay-host">
                Relay address (optional)
              </label>
              <input
                id="croc-relay-host"
                value={settings.relayHost}
                onChange={(e) => {
                  setSettings({ ...settings, relayHost: e.target.value });
                  setSave({ kind: "idle" });
                }}
                onBlur={() => persist(settings)}
                placeholder="relay.example.com:9009"
                className={inputClass}
              />
              <p className="mt-1 text-[10px] text-kindle-text-muted">
                Leave empty to use the public pool:{" "}
                {CROC_PUBLIC_RELAYS.join(", ")}.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="croc-relay-pass">
                Relay password (CROC_PASS)
              </label>
              <input
                id="croc-relay-pass"
                type="password"
                value={settings.relayPassword}
                onChange={(e) => {
                  setSettings({ ...settings, relayPassword: e.target.value });
                  setSave({ kind: "idle" });
                }}
                onBlur={() => persist(settings)}
                className={inputClass}
                autoComplete="off"
              />
              <p className="mt-1 text-[10px] text-kindle-text-muted">
                Stored on this device only, and never shown again in the clear. Kora does not
                connect to a relay, so it has nowhere to send it.
              </p>
            </div>

            {save.kind === "error" && (
              <p className="text-[10px] text-amber-500 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {save.text}
              </p>
            )}
            {save.kind === "saved" && (
              <p className="text-[10px] text-kindle-text-muted flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-kindle-accent" /> Saved on this device
              </p>
            )}

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-2">
                <code className="text-[10px] text-kindle-text-muted break-all">
                  {crocRelayCommandDisplay(settings)}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    // The clipboard gets the real password even though the
                    // on-screen preview does not: the command is for the
                    // user's own terminal, and masking it in the copy would
                    // hand them a command that cannot work.
                    const cmd = crocRelayCommand(settings);
                    if (cmd) void copy(cmd, "Command");
                  }}
                  className="shrink-0 p-1.5 rounded-lg hover:bg-kindle-card text-kindle-text-muted"
                  aria-label="Copy relay command"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <code className="text-[10px] text-kindle-text-muted break-all">
                  {crocWebCommand(settings)}
                </code>
                <button
                  type="button"
                  onClick={() => void copy(crocWebCommand(settings), "Command")}
                  className="shrink-0 p-1.5 rounded-lg hover:bg-kindle-card text-kindle-text-muted"
                  aria-label="Copy croc-web command"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  persist(settings);
                  toast.success("Settings saved");
                }}
                className="flex-1 py-2 rounded-xl bg-kindle-text text-kindle-bg font-bold text-[10px] uppercase tracking-widest"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  clearCrocSettings();
                  setSettings(getCrocSettings());
                  setSave({ kind: "idle" });
                  toast.success("Reset to the public pool");
                }}
                className="flex-1 py-2 rounded-xl border border-kindle-border text-kindle-text-muted font-bold text-[10px] uppercase tracking-widest"
              >
                Reset
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Attribution ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-kindle-border bg-kindle-bg/40 px-3 py-2.5 space-y-1">
        <p className="text-[10px] font-bold text-kindle-text flex items-center gap-1.5">
          <Server className="w-3.5 h-3.5 text-kindle-accent" />
          Licences
        </p>
        <p className="text-[10px] leading-relaxed text-kindle-text-muted">
          This plugin is by Kora. croc is MIT (Copyright (c) 2017-2025 Zack Scholl) and includes
          the EFF Short Wordlist #1 under CC BY 4.0 and vendored Tailcat under BSD-3-Clause.
          Kora vendors none of croc&apos;s code. Full notices are in the Kora Plugins repository.
        </p>
        <a
          href="https://github.com/schollz/croc"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-kindle-accent hover:underline"
        >
          <ExternalLink className="w-3.5 h-3.5" /> croc on GitHub
        </a>
      </section>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 rounded-xl border border-kindle-border text-kindle-text-muted font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-1.5"
        >
          <X className="w-3.5 h-3.5" /> Close
        </button>
      )}
    </div>
  );
}
