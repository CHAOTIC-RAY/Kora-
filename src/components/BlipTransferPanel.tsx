import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  Copy,
  Download,
  Loader2,
  Radio,
  Send,
  Shield,
  Wifi,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { signInAnonymously } from "firebase/auth";
import { auth, isRealFirebase } from "../lib/firebase";
import {
  BlipSession,
  connectionModeLabel,
  formatBytes,
  normalizeBlipCode,
  type BlipSessionState,
} from "../lib/blipTransfer";

interface BlipTransferPanelProps {
  open: boolean;
  onClose: () => void;
}

function ProgressRow({
  name,
  current,
  total,
  direction,
}: {
  name: string;
  current: number;
  total: number;
  direction: "send" | "receive";
}) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-kindle-text font-medium">
          {direction === "send" ? "↑" : "↓"} {name}
        </span>
        <span className="shrink-0 text-kindle-text-muted tabular-nums">
          {formatBytes(current)} / {formatBytes(total)} · {pct}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-kindle-border overflow-hidden">
        <div
          className="h-full rounded-full bg-kindle-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BlipTransferPanel({ open, onClose }: BlipTransferPanelProps) {
  const sessionRef = useRef<BlipSession | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<BlipSessionState>(() => new BlipSession().getSnapshot());
  const [joinCode, setJoinCode] = useState("");
  const [received, setReceived] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const session = new BlipSession();
    sessionRef.current = session;
    const unsub = session.subscribe(setState);
    session.onReceive((file) => {
      setReceived((prev) => [...prev, file]);
      toast.success(`Received ${file.name}`);
    });
    return () => {
      unsub();
      void session.close(true);
      sessionRef.current = null;
    };
  }, [open]);

  const ensureAuth = async () => {
    if (!isRealFirebase || !auth) {
      throw new Error("Blip needs a network connection for room signaling");
    }
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
  };

  const handleCreate = async () => {
    setBusy(true);
    setReceived([]);
    try {
      await ensureAuth();
      const code = await sessionRef.current!.createRoom();
      toast.success(`Room ${code} ready — share this code`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create room");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    setBusy(true);
    setReceived([]);
    try {
      await ensureAuth();
      await sessionRef.current!.joinRoom(joinCode);
      toast.success("Connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not join room");
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      await sessionRef.current!.sendFiles(files);
      toast.success(`Sent ${files.length} file${files.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const copyCode = async () => {
    if (!state.code) return;
    try {
      await navigator.clipboard.writeText(state.code);
      toast.success("Code copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const downloadReceived = (file: File) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const ready = state.phase === "ready" || state.phase === "transferring";
  const modeHint = useMemo(() => connectionModeLabel(state.connectionMode), [state.connectionMode]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          aria-label="Close"
          onClick={onClose}
        />
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-kindle-bg border border-kindle-border shadow-2xl"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b border-kindle-border bg-kindle-bg/95 backdrop-blur-md">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-kindle-card border border-kindle-border">
                <Radio className="w-4 h-4 text-kindle-accent" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold uppercase tracking-widest text-kindle-text">
                  Blip Transfer
                </h2>
                <p className="text-[10px] text-kindle-text-muted truncate">
                  Peer-to-peer · no cloud storage
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-kindle-text"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-5 py-5 space-y-5">
            <div className="rounded-2xl border border-kindle-border bg-kindle-card/40 p-4 space-y-2">
              <div className="flex items-start gap-2 text-[11px] text-kindle-text-muted leading-relaxed">
                <Wifi className="w-4 h-4 shrink-0 mt-0.5 text-kindle-accent" />
                <p>
                  Connects over local Wi‑Fi or the internet. Uses an{" "}
                  <span className="text-kindle-text font-medium">encrypted relay</span> only when a
                  direct path cannot be established. Files stream concurrently — nothing is uploaded
                  to cloud storage.
                </p>
              </div>
              <div className="flex items-start gap-2 text-[11px] text-kindle-text-muted leading-relaxed">
                <Shield className="w-4 h-4 shrink-0 mt-0.5 text-kindle-accent" />
                <p>
                  Chunks are AES‑GCM encrypted with a key derived from your room code, on top of
                  WebRTC DTLS.
                </p>
              </div>
            </div>

            {state.phase === "idle" || state.phase === "error" ? (
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleCreate()}
                  className="w-full py-3.5 rounded-2xl bg-kindle-text text-kindle-bg font-bold text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Create room & send
                </button>

                <div className="flex gap-2">
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(normalizeBlipCode(e.target.value))}
                    placeholder="Enter code"
                    maxLength={8}
                    className="flex-1 bg-kindle-card border border-kindle-border rounded-xl px-4 py-3 text-sm tracking-[0.2em] uppercase font-mono focus:outline-none focus:border-kindle-accent"
                  />
                  <button
                    type="button"
                    disabled={busy || joinCode.length < 6}
                    onClick={() => void handleJoin()}
                    className="px-4 rounded-xl border border-kindle-border font-bold text-[10px] uppercase tracking-widest text-kindle-text hover:bg-kindle-card disabled:opacity-40"
                  >
                    Join
                  </button>
                </div>
                {state.error && (
                  <p className="text-[11px] text-red-500">{state.error}</p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {state.code && (
                  <div className="rounded-2xl border border-kindle-border bg-kindle-card p-4 text-center space-y-2">
                    <p className="text-[10px] uppercase tracking-widest text-kindle-text-muted font-bold">
                      Room code
                    </p>
                    <p className="text-3xl font-mono font-bold tracking-[0.35em] text-kindle-text">
                      {state.code}
                    </p>
                    <button
                      type="button"
                      onClick={() => void copyCode()}
                      className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-kindle-accent"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest font-bold">
                  <span className="px-2.5 py-1 rounded-lg bg-kindle-card border border-kindle-border text-kindle-text">
                    {state.phase}
                  </span>
                  {ready && (
                    <span className="px-2.5 py-1 rounded-lg bg-kindle-card border border-kindle-border text-kindle-accent inline-flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      {modeHint}
                    </span>
                  )}
                  {state.peerName && (
                    <span className="px-2.5 py-1 rounded-lg bg-kindle-card border border-kindle-border text-kindle-text-muted">
                      Peer · {state.peerName}
                    </span>
                  )}
                </div>

                {state.phase === "waiting" && (
                  <p className="text-[12px] text-kindle-text-muted text-center">
                    Waiting for the other device to enter this code…
                  </p>
                )}

                {ready && (
                  <div className="space-y-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleSend(e.target.files)}
                    />
                    <button
                      type="button"
                      disabled={busy || state.phase === "transferring"}
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-3.5 rounded-2xl bg-kindle-text text-kindle-bg font-bold text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      Send files
                    </button>
                  </div>
                )}

                {state.progress.length > 0 && (
                  <div className="space-y-3 rounded-2xl border border-kindle-border p-4">
                    {state.progress.map((p) => (
                      <ProgressRow
                        key={p.fileId}
                        name={p.fileName}
                        current={p.direction === "send" ? p.sent : p.received}
                        total={p.total}
                        direction={p.direction}
                      />
                    ))}
                  </div>
                )}

                {received.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                      Received
                    </p>
                    {received.map((file, i) => (
                      <button
                        key={`${file.name}-${i}`}
                        type="button"
                        onClick={() => downloadReceived(file)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-kindle-border bg-kindle-card/50 text-left hover:border-kindle-accent transition"
                      >
                        <Download className="w-4 h-4 text-kindle-accent shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-sm text-kindle-text">
                          {file.name}
                        </span>
                        <span className="text-[10px] text-kindle-text-muted tabular-nums">
                          {formatBytes(file.size)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    void sessionRef.current?.close(true);
                    setReceived([]);
                    setJoinCode("");
                  }}
                  className="w-full py-2.5 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted hover:text-kindle-text"
                >
                  End session
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
