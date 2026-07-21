import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  Cloud,
  Download,
  HardDrive,
  Info,
  Laptop,
  Loader2,
  RefreshCw,
  Share2,
  Smartphone,
  Trash2,
  Wifi,
} from "lucide-react";
import type { BookMetadata } from "../lib/firebase";
import {
  getDeviceId,
  getDeviceName,
  setDeviceName,
  isDeviceOnline,
  isPeerSharingOn,
  listDevices,
  registerThisDevice,
  removeDevice,
  subscribeDevices,
  type KoraDevice,
  loadSyncPrefs,
  saveSyncPrefs,
  type CrossDeviceSyncPrefs,
  webdavTestConnection,
  requestBookFromPeer,
} from "../lib/crossDeviceSync";
import { checkBookFileCached } from "../db/indexedDB";
import { toast } from "react-hot-toast";

interface DevicesSyncPanelProps {
  userId: string;
  books: BookMetadata[];
  onCachedIdsChanged?: () => void;
}

function Toggle({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={`w-11 h-6 rounded-full relative shrink-0 transition-colors ${
        on ? "bg-kindle-text" : "bg-kindle-border"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow-sm transition-transform ${
          on ? "translate-x-5 bg-kindle-bg" : "translate-x-0 bg-kindle-text/50"
        }`}
      />
    </button>
  );
}

function PrefRow({
  title,
  hint,
  on,
  onToggle,
}: {
  title: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 pr-2">
        <p className="text-sm font-semibold text-kindle-text leading-snug">{title}</p>
        <p className="text-[11px] text-kindle-text-muted mt-0.5 leading-relaxed">{hint}</p>
      </div>
      <Toggle on={on} label={title} onToggle={onToggle} />
    </div>
  );
}

export default function DevicesSyncPanel({
  userId,
  books,
  onCachedIdsChanged,
}: DevicesSyncPanelProps) {
  const [prefs, setPrefs] = useState<CrossDeviceSyncPrefs>(() => loadSyncPrefs());
  const [devices, setDevices] = useState<KoraDevice[]>([]);
  const [deviceName, setDeviceNameState] = useState(getDeviceName());
  const [testingWebDav, setTestingWebDav] = useState(false);
  const [pullingFrom, setPullingFrom] = useState<string | null>(null);
  const [showWebDavAdvanced, setShowWebDavAdvanced] = useState(false);
  const myId = useMemo(() => getDeviceId(), []);

  useEffect(() => {
    if (!userId) return;
    void registerThisDevice(userId, prefs.peerSharingEnabled);
    return subscribeDevices(userId, setDevices);
  }, [userId, prefs.peerSharingEnabled]);

  useEffect(() => {
    if (!userId) return;
    const tick = () => void registerThisDevice(userId, prefs.peerSharingEnabled);
    const id = window.setInterval(tick, 45_000);
    return () => window.clearInterval(id);
  }, [userId, prefs.peerSharingEnabled]);

  useEffect(() => {
    if (prefs.webdav.enabled || prefs.webdav.baseUrl) setShowWebDavAdvanced(true);
  }, [prefs.webdav.enabled, prefs.webdav.baseUrl]);

  const patchPrefs = (patch: Partial<CrossDeviceSyncPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveSyncPrefs(next);
      if (userId && "peerSharingEnabled" in patch) {
        void registerThisDevice(userId, !!next.peerSharingEnabled).then(() => {
          toast.success(
            next.peerSharingEnabled
              ? "Sharing on — other devices can pull from this one"
              : "Sharing off on this device"
          );
        });
      }
      return next;
    });
  };

  const patchWebDav = (patch: Partial<CrossDeviceSyncPrefs["webdav"]>) => {
    setPrefs((prev) => {
      const next = { ...prev, webdav: { ...prev.webdav, ...patch } };
      saveSyncPrefs(next);
      return next;
    });
  };

  const onlineOthers = devices.filter(
    (d) => d.id !== myId && isPeerSharingOn(d) && isDeviceOnline(d)
  );
  const otherCount = devices.filter((d) => d.id !== myId).length;
  const onlineCount = devices.filter((d) => isDeviceOnline(d)).length;

  const handleTestWebDav = async () => {
    setTestingWebDav(true);
    const result = await webdavTestConnection(prefs.webdav);
    setTestingWebDav(false);
    if (result.ok) toast.success("WebDAV connected");
    else toast.error(result.error || "WebDAV test failed");
  };

  const pullMissingFromDevice = async (provider: KoraDevice) => {
    if (!userId) {
      toast.error("Sign in to transfer between devices");
      return;
    }
    setPullingFrom(provider.id);
    let pulled = 0;
    let failed = 0;
    try {
      for (const book of books) {
        if (book.extension?.toLowerCase() === "audiobook") continue;
        if (await checkBookFileCached(book.id)) continue;
        try {
          toast.loading(`Pulling “${book.title}”…`, { id: "peer-pull" });
          await requestBookFromPeer(userId, provider.id, book);
          pulled += 1;
          onCachedIdsChanged?.();
        } catch (err) {
          failed += 1;
          console.warn("Peer pull failed for", book.title, err);
        }
      }
      toast.dismiss("peer-pull");
      if (pulled) toast.success(`Pulled ${pulled} book${pulled === 1 ? "" : "s"} from ${provider.name}`);
      else if (failed) toast.error("Could not pull files — other device may not have them cached");
      else toast("Nothing missing to pull");
    } finally {
      setPullingFrom(null);
    }
  };

  const PlatformIcon = ({ platform }: { platform: string }) => {
    if (/android|ios|iphone|ipad/i.test(platform)) return <Smartphone className="w-4 h-4" />;
    return <Laptop className="w-4 h-4" />;
  };

  return (
    <section className="bg-kindle-card border border-kindle-border rounded-3xl overflow-hidden shadow-xs">
      <div className="px-5 pt-5 pb-4 border-b border-kindle-border/70 bg-kindle-bg/30">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-kindle-text text-kindle-bg flex items-center justify-center shrink-0">
            <Wifi className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-lexend font-bold text-base text-kindle-text tracking-tight">
              Devices & Sync
            </h3>
            <p className="text-[12px] text-kindle-text-muted mt-1 leading-relaxed">
              Your shelf list syncs in the cloud. Book files stay on your devices — share them
              peer-to-peer or via your own WebDAV.
            </p>
          </div>
        </div>

        {userId ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-kindle-bg border border-kindle-border text-[10px] font-bold uppercase tracking-wider text-kindle-text">
              <HardDrive className="w-3 h-3 text-kindle-accent" />
              {devices.length || 1} device{devices.length === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-kindle-bg border border-kindle-border text-[10px] font-bold uppercase tracking-wider text-kindle-text">
              <span
                className={`w-1.5 h-1.5 rounded-full ${onlineCount ? "bg-emerald-500" : "bg-kindle-text-muted"}`}
              />
              {onlineCount} online
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-kindle-bg border border-kindle-border text-[10px] font-bold uppercase tracking-wider text-kindle-text">
              <Share2 className="w-3 h-3 text-kindle-accent" />
              Sharing {prefs.peerSharingEnabled ? "on" : "off"}
            </span>
          </div>
        ) : null}
      </div>

      <div className="p-5 space-y-5">
        {!userId ? (
          <div className="rounded-2xl border border-dashed border-kindle-border bg-kindle-bg/40 px-4 py-6 text-center space-y-2">
            <Info className="w-5 h-5 text-kindle-text-muted mx-auto opacity-60" />
            <p className="text-sm font-semibold text-kindle-text">Sign in to sync devices</p>
            <p className="text-xs text-kindle-text-muted leading-relaxed max-w-sm mx-auto">
              Guest mode keeps everything on this device. Sign in to see your other phones and
              computers here.
            </p>
          </div>
        ) : (
          <>
            {/* This device */}
            <div className="rounded-2xl border border-kindle-border/80 bg-kindle-bg/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Laptop className="w-3.5 h-3.5 text-kindle-accent" />
                <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text">
                  This device
                </h4>
              </div>
              <p className="text-[11px] text-kindle-text-muted leading-relaxed">
                Give this device a clear name so you can tell it apart when sharing files.
              </p>
              <div className="flex gap-2">
                <input
                  value={deviceName}
                  onChange={(e) => setDeviceNameState(e.target.value)}
                  placeholder="e.g. Phone · Kora"
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-kindle-border bg-kindle-card text-sm text-kindle-text placeholder:text-kindle-text-muted/60"
                />
                <button
                  type="button"
                  onClick={() => {
                    setDeviceName(deviceName);
                    void registerThisDevice(userId, prefs.peerSharingEnabled);
                    toast.success("Device name saved");
                  }}
                  className="px-4 py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[11px] font-bold uppercase tracking-wider hover:opacity-90 transition shrink-0"
                >
                  Save
                </button>
              </div>
            </div>

            {/* How files move */}
            <div className="rounded-2xl border border-kindle-border/80 bg-kindle-card p-4">
              <div className="flex items-center gap-2 mb-1">
                <Download className="w-3.5 h-3.5 text-kindle-accent" />
                <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text">
                  How files move
                </h4>
              </div>
              <p className="text-[11px] text-kindle-text-muted mb-3 leading-relaxed">
                Library metadata always syncs. These switches control where the actual book files come
                from.
              </p>
              <div className="divide-y divide-kindle-border/60">
                <PrefRow
                  title="Auto-download missing books"
                  hint="When you open a title that’s only on another device or mirror, fetch it here automatically."
                  on={!!prefs.autoHydrateLibrary}
                  onToggle={() => patchPrefs({ autoHydrateLibrary: !prefs.autoHydrateLibrary })}
                />
                <PrefRow
                  title="Share with my other devices"
                  hint="Let phones/computers on your account pull cached files from this device (P2P)."
                  on={!!prefs.peerSharingEnabled}
                  onToggle={() => patchPrefs({ peerSharingEnabled: !prefs.peerSharingEnabled })}
                />
                <PrefRow
                  title="Prefer my WebDAV first"
                  hint="Try your personal archive before public download mirrors."
                  on={!!prefs.preferWebDav}
                  onToggle={() => patchPrefs({ preferWebDav: !prefs.preferWebDav })}
                />
                <PrefRow
                  title="Back up new downloads to WebDAV"
                  hint="Copy newly cached books into your WebDAV folder for safekeeping."
                  on={!!prefs.pushToWebDav}
                  onToggle={() => patchPrefs({ pushToWebDav: !prefs.pushToWebDav })}
                />
              </div>
            </div>

            {/* Device list */}
            <div className="rounded-2xl border border-kindle-border/80 overflow-hidden">
              <div className="px-4 py-3 bg-kindle-bg/40 border-b border-kindle-border/70 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <HardDrive className="w-3.5 h-3.5 text-kindle-accent shrink-0" />
                  <div className="min-w-0">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text">
                      Your devices
                    </h4>
                    <p className="text-[10px] text-kindle-text-muted truncate">
                      {otherCount
                        ? `${otherCount} other · turn sharing on both sides to pull files`
                        : "Only this device so far"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void listDevices(userId).then(setDevices)}
                  className="p-2 rounded-xl border border-kindle-border hover:bg-kindle-card transition"
                  title="Refresh devices"
                  aria-label="Refresh devices"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              <ul className="divide-y divide-kindle-border/60">
                {devices.length === 0 ? (
                  <li className="px-4 py-5 text-[12px] text-kindle-text-muted italic">
                    No devices registered yet — open Kora while signed in on another phone or computer.
                  </li>
                ) : (
                  devices.map((device) => {
                    const online = isDeviceOnline(device);
                    const isMe = device.id === myId;
                    const sharingOn = isMe ? !!prefs.peerSharingEnabled : isPeerSharingOn(device);
                    return (
                      <li key={device.id} className="px-4 py-3.5 flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                            online
                              ? "bg-kindle-text text-kindle-bg border-kindle-text"
                              : "bg-kindle-bg border-kindle-border text-kindle-text-muted"
                          }`}
                        >
                          <PlatformIcon platform={device.platform} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-kindle-text truncate">
                            {device.name}
                            {isMe ? (
                              <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-kindle-accent">
                                You
                              </span>
                            ) : null}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-[10px] text-kindle-text-muted">{device.platform}</span>
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${
                                online
                                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                  : "bg-kindle-bg text-kindle-text-muted"
                              }`}
                            >
                              <span
                                className={`w-1 h-1 rounded-full ${online ? "bg-emerald-500" : "bg-kindle-text-muted"}`}
                              />
                              {online ? "Online" : "Offline"}
                            </span>
                            <span
                              className={`inline-flex px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${
                                sharingOn
                                  ? "bg-kindle-accent/15 text-kindle-accent"
                                  : "bg-kindle-bg text-kindle-text-muted"
                              }`}
                            >
                              {sharingOn ? "Sharing" : "Not sharing"}
                            </span>
                          </div>
                        </div>
                        {!isMe && online && (
                          <button
                            type="button"
                            disabled={pullingFrom === device.id || !sharingOn}
                            onClick={() => void pullMissingFromDevice(device)}
                            title={
                              sharingOn
                                ? "Pull cached books from this device"
                                : "Sharing is off on that device — enable it there first"
                            }
                            className="px-2.5 py-2 rounded-xl bg-kindle-text text-kindle-bg text-[9px] font-bold uppercase tracking-wider disabled:opacity-40 shrink-0"
                          >
                            {pullingFrom === device.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              "Pull missing"
                            )}
                          </button>
                        )}
                        {!isMe && (
                          <button
                            type="button"
                            onClick={() =>
                              void removeDevice(userId, device.id).then(() =>
                                toast.success("Device removed")
                              )
                            }
                            className="p-2 rounded-xl text-kindle-text-muted hover:text-red-500 hover:bg-red-500/10 transition shrink-0"
                            title="Remove device"
                            aria-label={`Remove ${device.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })
                )}
              </ul>

              {onlineOthers.length === 0 && otherCount > 0 && (
                <div className="px-4 py-3 bg-kindle-bg/50 border-t border-kindle-border/60 text-[11px] text-kindle-text-muted leading-relaxed">
                  {devices.some((d) => d.id !== myId && isDeviceOnline(d) && !isPeerSharingOn(d))
                    ? "Another device is online but sharing is off — turn on “Share with my other devices” there."
                    : "Tip: enable sharing on both devices, open Kora on each, then tap Pull missing."}
                </div>
              )}
            </div>

            {/* WebDAV */}
            <div className="rounded-2xl border border-kindle-border/80 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowWebDavAdvanced((v) => !v)}
                className="w-full px-4 py-3.5 flex items-start gap-3 text-left hover:bg-kindle-bg/40 transition"
              >
                <div className="w-9 h-9 rounded-xl bg-kindle-bg border border-kindle-border flex items-center justify-center shrink-0">
                  <Cloud className="w-4 h-4 text-kindle-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-kindle-text">Personal WebDAV archive</h4>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">
                      {showWebDavAdvanced ? "Hide" : "Optional"}
                    </span>
                  </div>
                  <p className="text-[11px] text-kindle-text-muted mt-0.5 leading-relaxed">
                    Nextcloud, ownCloud, or any WebDAV — Kora never uploads books to Firebase Storage.
                  </p>
                </div>
              </button>

              {showWebDavAdvanced && (
                <form
                  className="px-4 pb-4 space-y-3 border-t border-kindle-border/60 pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleTestWebDav();
                  }}
                >
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-kindle-bg/50 border border-kindle-border/70 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-kindle-text">Enable WebDAV</p>
                      <p className="text-[11px] text-kindle-text-muted">Use your own cloud folder for files</p>
                    </div>
                    <Toggle
                      on={!!prefs.webdav.enabled}
                      label="Enable WebDAV"
                      onToggle={() => patchWebDav({ enabled: !prefs.webdav.enabled })}
                    />
                  </div>
                  <input
                    placeholder="https://cloud.example.com/remote.php/dav/files/you"
                    value={prefs.webdav.baseUrl}
                    onChange={(e) => patchWebDav({ baseUrl: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-kindle-border bg-kindle-bg text-sm"
                  />
                  <input
                    placeholder="Remote folder (e.g. /kora-books)"
                    value={prefs.webdav.remotePath}
                    onChange={(e) => patchWebDav({ remotePath: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-kindle-border bg-kindle-bg text-sm"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      placeholder="Username"
                      value={prefs.webdav.username}
                      onChange={(e) => patchWebDav({ username: e.target.value })}
                      className="px-3.5 py-2.5 rounded-xl border border-kindle-border bg-kindle-bg text-sm"
                      autoComplete="username"
                    />
                    <input
                      type="password"
                      placeholder="Password / app token"
                      value={prefs.webdav.password}
                      onChange={(e) => patchWebDav({ password: e.target.value })}
                      className="px-3.5 py-2.5 rounded-xl border border-kindle-border bg-kindle-bg text-sm"
                      autoComplete="current-password"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={testingWebDav || !prefs.webdav.baseUrl}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-kindle-text text-kindle-bg text-[11px] font-bold uppercase tracking-wider disabled:opacity-40 hover:opacity-90 transition"
                  >
                    {testingWebDav ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    Test connection
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
