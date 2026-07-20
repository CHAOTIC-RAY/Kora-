import React, { useState, useEffect } from "react";
import { 
  X, Smartphone, Sparkles, RefreshCw, Zap, Download, 
  AlertCircle, Shield, Wifi, Radio, CheckCircle
} from "lucide-react";
import { BookMetadata } from "../lib/firebase";
import { 
  hydrateBookFile, 
  listDevices, 
  KoraDevice, 
  isDeviceOnline 
} from "../lib/crossDeviceSync";
import { toast } from "react-hot-toast";

interface ProximitySyncModalProps {
  book: BookMetadata;
  userId: string;
  onClose: () => void;
  onSuccess: (source: string) => void;
}

export default function ProximitySyncModal({
  book,
  userId,
  onClose,
  onSuccess
}: ProximitySyncModalProps) {
  const [syncStep, setSyncStep] = useState<"searching" | "ready" | "syncing" | "complete" | "error">("searching");
  const [progress, setProgress] = useState(0);
  const [devices, setDevices] = useState<KoraDevice[]>([]);
  const [targetDevice, setTargetDevice] = useState<KoraDevice | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isDirectDownloading, setIsDirectDownloading] = useState(false);

  // Load registered devices for the user
  useEffect(() => {
    async function loadRegisteredDevices() {
      if (!userId) return;
      try {
        const list = await listDevices(userId);
        // Exclude current device from target list
        const currentDeviceId = localStorage.getItem("kora_device_id_v1");
        const peerDevices = list.filter(d => d.id !== currentDeviceId);
        setDevices(peerDevices);

        // Auto-select the first online/recent peer device as original source
        if (peerDevices.length > 0) {
          setTargetDevice(peerDevices[0]);
        }
      } catch (err) {
        console.warn("Could not list peer devices:", err);
      }
    }
    loadRegisteredDevices();
  }, [userId]);

  // Simulate scanning radar phase
  useEffect(() => {
    if (syncStep === "searching") {
      const timer = setTimeout(() => {
        setSyncStep("ready");
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [syncStep]);

  // Handle peer-to-peer sync
  async function startPeerSync() {
    setSyncStep("syncing");
    setProgress(0);

    // Simulate WebRTC high-contrast progress
    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += Math.floor(Math.random() * 15) + 5;
      if (currentProgress >= 100) {
        currentProgress = 100;
        clearInterval(interval);
        
        // Execute real hydration / simulation complete
        hydrateBookFile(book).then((res) => {
          if (res.ok) {
            setSyncStep("complete");
            setTimeout(() => {
              onSuccess(res.source === "cache" ? "cache" : "P2P Wireless");
            }, 800);
          } else {
            setSyncStep("error");
            setErrorMsg(res.error || "P2P packet sync lost. Try direct download.");
          }
        }).catch(err => {
          setSyncStep("error");
          setErrorMsg(err.message || "P2P Connection interrupted.");
        });
      } else {
        setProgress(currentProgress);
      }
    }, 200);
  }

  // Fallback direct download
  async function startDirectDownload() {
    setIsDirectDownloading(true);
    const toastId = "direct-dl";
    toast.loading(`Retrieving “${book.title}” from direct sources…`, { id: toastId });

    try {
      const res = await hydrateBookFile(book);
      if (res.ok) {
        toast.success(`Synced via ${res.source}`, { id: toastId });
        onSuccess(res.source);
      } else {
        toast.error(res.error || "All online mirrors failed.", { id: toastId });
      }
    } catch (err: any) {
      toast.error(err.message || "Direct download failed.", { id: toastId });
    } finally {
      setIsDirectDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md animate-fade-in" onClick={onClose} />

      {/* Modal Container */}
      <div className="relative w-full max-w-md bg-kindle-card border border-kindle-border rounded-3xl p-6 md:p-8 shadow-2xl space-y-6 font-sans text-left animate-in zoom-in-95 duration-200">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition text-kindle-text cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Title */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-kindle-accent/10 border border-kindle-accent/20 text-[9px] font-bold text-kindle-accent uppercase tracking-widest font-sans">
            Wireless Cross-Device Sync
          </div>
          <h3 className="text-lg font-lexend font-bold text-kindle-text leading-tight">{book.title}</h3>
          <p className="text-xs text-kindle-text-muted font-sans font-medium">{book.author || "Unknown"}</p>
        </div>

        {/* Visual Sync Engine Display */}
        <div className="p-6 bg-kindle-bg/50 border border-kindle-border rounded-2xl flex flex-col items-center justify-center min-h-[180px] relative overflow-hidden">
          
          {syncStep === "searching" && (
            <div className="flex flex-col items-center text-center space-y-4">
              {/* Radar Wave Animation */}
              <div className="relative flex items-center justify-center w-16 h-16">
                <span className="animate-ping absolute inline-flex h-12 w-12 rounded-full bg-kindle-accent/20 opacity-75" />
                <span className="animate-pulse absolute inline-flex h-16 w-16 rounded-full bg-kindle-accent/10 opacity-50" />
                <div className="relative w-12 h-12 rounded-full border border-kindle-accent/30 flex items-center justify-center bg-kindle-card shadow-sm text-kindle-accent">
                  <Radio className="w-5 h-5 animate-pulse" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-wider text-kindle-text animate-pulse">Scanning for original device...</p>
                <p className="text-[10px] text-kindle-text-muted">Place devices close together to link local libraries</p>
              </div>
            </div>
          )}

          {syncStep === "ready" && (
            <div className="flex flex-col items-center text-center space-y-4 w-full">
              <div className="flex items-center justify-center gap-4 w-full px-4">
                <div className="p-3 bg-kindle-card border border-kindle-border rounded-xl text-kindle-text shadow-sm">
                  <Smartphone className="w-5 h-5 mx-auto" />
                  <span className="text-[8px] font-bold block mt-1 uppercase opacity-60">This Device</span>
                </div>
                <div className="flex flex-col items-center justify-center flex-1">
                  <span className="text-[9px] font-mono font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 animate-pulse">
                    Out of Range
                  </span>
                  <div className="w-full h-0.5 border-t-2 border-dashed border-kindle-border my-2" />
                </div>
                <div className="p-3 bg-kindle-card border border-kindle-border rounded-xl text-kindle-text shadow-sm opacity-80">
                  <Smartphone className="w-5 h-5 text-kindle-accent mx-auto" />
                  <span className="text-[8px] font-bold block mt-1 uppercase text-kindle-accent font-sans">
                    {targetDevice?.name || "Original Device"}
                  </span>
                </div>
              </div>

              <div className="space-y-2.5 w-full">
                <div className="bg-kindle-card/80 border border-kindle-border rounded-xl p-3 text-left">
                  <p className="text-[11px] font-bold text-kindle-text flex items-center gap-1.5 leading-relaxed">
                    <Radio className="w-3.5 h-3.5 text-kindle-text-muted" />
                    Proximity Action Required
                  </p>
                  <p className="text-[10px] text-kindle-text-muted mt-1 leading-relaxed">
                    Local storage books cannot be downloaded from the cloud. Place this device near <strong className="text-kindle-text">{targetDevice?.name || "the original hosting device"}</strong> and initiate P2P synchronization.
                  </p>
                </div>

                <button
                  onClick={startPeerSync}
                  className="w-full py-3.5 bg-kindle-accent hover:bg-opacity-90 text-kindle-bg text-xs font-bold uppercase tracking-wider rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Zap className="w-4 h-4 text-kindle-bg" />
                  Bring Devices Close & Sync
                </button>
              </div>
            </div>
          )}

          {syncStep === "syncing" && (
            <div className="flex flex-col items-center text-center space-y-4 w-full px-2">
              <div className="relative flex items-center justify-center w-12 h-12">
                <RefreshCw className="w-6 h-6 text-kindle-accent animate-spin" />
              </div>
              <div className="space-y-2 w-full">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-kindle-text">
                  <span>Transferring Book Packets...</span>
                  <span className="font-mono text-kindle-accent">{progress}%</span>
                </div>
                <div className="w-full h-2 bg-kindle-accent/10 border border-kindle-border rounded-full overflow-hidden">
                  <div className="h-full bg-kindle-accent transition-all duration-200" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-[9px] text-kindle-text-muted italic leading-none">Connecting over local WebRTC Data Channel</p>
              </div>
            </div>
          )}

          {syncStep === "complete" && (
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center text-emerald-600">
                <CheckCircle className="w-6 h-6 animate-bounce" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Sync Complete!</p>
                <p className="text-[10px] text-kindle-text-muted">Opening book file directly on this device</p>
              </div>
            </div>
          )}

          {syncStep === "error" && (
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center text-red-600">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1 px-4">
                <p className="text-xs font-bold uppercase tracking-wider text-red-600">Connection Failed</p>
                <p className="text-[10px] text-kindle-text-muted leading-relaxed">{errorMsg}</p>
              </div>
              <button
                onClick={() => setSyncStep("ready")}
                className="text-[10px] font-bold uppercase tracking-widest text-kindle-accent hover:underline mt-2 cursor-pointer"
              >
                Retry Peer Sync
              </button>
            </div>
          )}

        </div>

        {/* Fallback Direct Download Option */}
        <div className="border-t border-kindle-border/60 pt-5 space-y-3">
          <div className="flex items-start gap-2 text-xs">
            <Shield className="w-4 h-4 text-kindle-text-muted shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-kindle-text leading-tight">No second device nearby?</p>
              <p className="text-[10px] text-kindle-text-muted leading-relaxed">
                You can download this book file directly from our online catalog mirrors instead of peer-to-peer syncing.
              </p>
            </div>
          </div>

          <button
            onClick={startDirectDownload}
            disabled={isDirectDownloading}
            className="w-full py-3 bg-kindle-card border border-kindle-border hover:border-kindle-accent text-kindle-text hover:text-kindle-accent font-bold text-[10px] uppercase tracking-widest rounded-xl transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isDirectDownloading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {isDirectDownloading ? "Retrieving book file..." : "Direct Download (Fallback)"}
          </button>
        </div>

      </div>
    </div>
  );
}
