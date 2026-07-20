import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  Cloud,
  HardDrive,
  Laptop,
  Loader2,
  RefreshCw,
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

  const savePrefs = (next: CrossDeviceSyncPrefs) => {
    setPrefs(next);
    saveSyncPrefs(next);
  };

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
    <section className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-5">
      <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
        <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
          <Wifi className="w-4 h-4 text-kindle-text" />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">
            Devices & Sync
          </h3>
          <p className="text-[10px] text-kindle-text-muted mt-0.5">
            Metadata in Firestore · files via mirrors, WebDAV, or device-to-device
          </p>
        </div>
      </div>

      {!userId ? (
        <p className="text-xs text-kindle-text-muted">
          Sign in to sync your library across devices and enable peer transfer.
        </p>
      ) : (
        <>
          <div className="space-y-3">
            <label className="block text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">
              This device name
            </label>
            <div className="flex gap-2">
              <input
                value={deviceName}
                onChange={(e) => setDeviceNameState(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl border border-kindle-border bg-kindle-bg text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  setDeviceName(deviceName);
                  void registerThisDevice(userId, prefs.peerSharingEnabled);
                  toast.success("Device name saved");
                }}
                className="px-3 py-2 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-wider hover:bg-kindle-bg"
              >
                Save
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            {(
              [
                ["autoHydrateLibrary", "Auto-download missing books on this device"],
                ["peerSharingEnabled", "Share cached files with my other devices (P2P)"],
                ["preferWebDav", "Prefer WebDAV archive before public mirrors"],
                ["pushToWebDav", "Back up newly cached files to WebDAV"],
              ] as const
            ).map(([key, label]) => {
              const on = !!prefs[key];
              return (
                // Use div (not label>button) — label+button double-fires on mobile and
                // immediately toggles sharing back off, so both devices stayed "sharing off".
                <div key={key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-kindle-text min-w-0">{label}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={label}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      patchPrefs({ [key]: !on });
                    }}
                    className={`w-11 h-6 rounded-full relative shrink-0 transition-colors ${
                      on ? "bg-kindle-accent" : "bg-kindle-accent/25"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow-sm transition-transform ${
                        on
                          ? "translate-x-5 bg-kindle-bg"
                          : "translate-x-0 bg-kindle-text/70"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="border-t border-kindle-border/50 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" /> Your devices
              </h4>
              <button
                type="button"
                onClick={() => void listDevices(userId).then(setDevices)}
                className="p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-bg"
                title="Refresh"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <ul className="space-y-2">
              {devices.length === 0 ? (
                <li className="text-[11px] text-kindle-text-muted italic">No devices registered yet.</li>
              ) : (
                devices.map((device) => {
                  const online = isDeviceOnline(device);
                  const isMe = device.id === myId;
                  // Prefer local toggle for this device so UI matches the switch above.
                  const sharingOn = isMe ? !!prefs.peerSharingEnabled : isPeerSharingOn(device);
                  return (
                    <li
                      key={device.id}
                      className="flex items-center gap-3 p-2.5 rounded-xl border border-kindle-border bg-kindle-bg/50"
                    >
                      <PlatformIcon platform={device.platform} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">
                          {device.name}
                          {isMe ? " (this device)" : ""}
                        </p>
                        <p className="text-[10px] text-kindle-text-muted">
                          {device.platform} · {online ? "Online" : "Offline"}
                          {sharingOn ? " · sharing on" : " · sharing off"}
                        </p>
                      </div>
                      {!isMe && online && (
                        <button
                          type="button"
                          disabled={pullingFrom === device.id || !sharingOn}
                          onClick={() => void pullMissingFromDevice(device)}
                          title={
                            sharingOn
                              ? "Pull cached books from this device"
                              : "Sharing is off on that device — enable P2P there first"
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-kindle-border text-[9px] font-bold uppercase tracking-wider hover:bg-kindle-card disabled:opacity-50"
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
                          onClick={() => void removeDevice(userId, device.id).then(() => toast.success("Device removed"))}
                          className="p-1.5 text-kindle-text-muted hover:text-red-500"
                          title="Remove device"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
            {onlineOthers.length === 0 && (
              <p className="text-[10px] text-kindle-text-muted">
                {devices.some((d) => d.id !== myId && isDeviceOnline(d) && !isPeerSharingOn(d))
                  ? "Another device is online but sharing is off — turn on “Share cached files” on that device."
                  : "Turn on “Share cached files” on both devices, then use Pull missing."}
              </p>
            )}
          </div>

          <form
            className="border-t border-kindle-border/50 pt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleTestWebDav();
            }}
          >
            <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted flex items-center gap-1.5">
              <Cloud className="w-3.5 h-3.5" /> BYO WebDAV archive
            </h4>
            <p className="text-[10px] text-kindle-text-muted leading-relaxed">
              Optional personal storage (Nextcloud, ownCloud, etc.). Kora never uploads your books to Firebase Storage.
            </p>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span>Enable WebDAV</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!prefs.webdav.enabled}
                aria-label="Enable WebDAV"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  patchWebDav({ enabled: !prefs.webdav.enabled });
                }}
                 className={`w-11 h-6 rounded-full relative shrink-0 transition-colors ${
                  prefs.webdav.enabled ? "bg-kindle-accent" : "bg-kindle-accent/25"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow-sm transition-transform ${
                    prefs.webdav.enabled
                      ? "translate-x-5 bg-kindle-bg"
                      : "translate-x-0 bg-kindle-text/70"
                  }`}
                />
              </button>
            </div>
            <input
              placeholder="https://cloud.example.com/remote.php/dav/files/you"
              value={prefs.webdav.baseUrl}
              onChange={(e) => patchWebDav({ baseUrl: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-kindle-border bg-kindle-bg text-xs"
            />
            <input
              placeholder="Remote folder (e.g. /kora-books)"
              value={prefs.webdav.remotePath}
              onChange={(e) => patchWebDav({ remotePath: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-kindle-border bg-kindle-bg text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Username"
                value={prefs.webdav.username}
                onChange={(e) => patchWebDav({ username: e.target.value })}
                className="px-3 py-2 rounded-xl border border-kindle-border bg-kindle-bg text-xs"
              />
              <input
                type="password"
                placeholder="Password / app token"
                value={prefs.webdav.password}
                onChange={(e) => patchWebDav({ password: e.target.value })}
                className="px-3 py-2 rounded-xl border border-kindle-border bg-kindle-bg text-xs"
              />
            </div>
            <button
              type="submit"
              disabled={testingWebDav || !prefs.webdav.baseUrl}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-kindle-bg disabled:opacity-50"
            >
              {testingWebDav ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Test WebDAV connection
            </button>
          </form>
        </>
      )}
    </section>
  );
}
