/**
 * Kora's own e-reader relay client.
 *
 * REPLACES send.djazz.se. Nothing here contacts a third party: the pairing code
 * is minted by Kora's Worker, the bytes go to Kora's Worker, and the file comes
 * back out of Kora's Worker. djazz is gone from the app entirely, not just
 * hidden behind a flag — the whole point was to stop depending on someone
 * else's server for a feature a reader uses weekly.
 *
 * THE CONTRACT, unchanged from the sender it replaces, because the panel and
 * the tests both depend on it:
 *
 *  - `result.status === "ok"` means the file is ON the device's relay slot. It
 *    never means "the fetch resolved" and it never means "we fell back to a
 *    local download".
 *  - A cancelled upload returns `{ status: "cancelled" }` and throws nothing
 *    that could be mistaken for success. `requestFileWithProgress` is given an
 *    AbortSignal, and an abort is a first-class outcome.
 *  - `method` is always reported. A path that silently degraded to a plain
 *    download would tell the user the wrong thing happened; the toast names the
 *    method that actually ran.
 *
 * WHY raw fetch and not FormData-with-progress: XHR is the only upload path
 * that reports real progress bytes, and the send is a 20-50 MB EPUB over a
 * phone connection where "how much longer" is the whole question.
 */

import { normalizeRelayCode } from "../relay/codes";

export type SendToDeviceMethod = "kora-relay" | "local-download";

export type SendToDeviceResult =
  | { status: "ok"; method: SendToDeviceMethod; fileName: string; message: string }
  | { status: "cancelled" }
  | { status: "error"; error: string };

/** Same-origin by default. The Worker serves the SPA, so no CORS in the app. */
export const DEFAULT_RELAY_BASE = "";

/** 50 MB, matching the Worker's cap, so we fail before spending the bandwidth. */
export const RELAY_MAX_BYTES = 50 * 1024 * 1024;

const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

/**
 * The code is typed by hand on a phone from a 4-character string on an e-ink
 * screen, so this normalises generously (case, spaces, dashes) and then refuses
 * anything with an ambiguous glyph rather than guessing which one was meant.
 */
export function normalizeDeviceCode(input: string): string | null {
  const n = normalizeRelayCode(input);
  return n && CODE_RE.test(n) ? n : null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Absolute URL of the page the e-reader opens. Shown as a QR. */
export function relayPageUrl(relayBase: string = DEFAULT_RELAY_BASE): string {
  if (typeof window === "undefined") return "/send";
  return `${window.location.origin}${relayBase}/send`;
}

export interface RelayUploadOptions {
  code: string;
  fileName: string;
  fileBlob: Blob;
  relayBase?: string;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * The server's own failure text, when there is one.
 *
 * The Worker's messages are written to be shown to a person ("No e-reader is
 * waiting for that code…"), and a generic "upload failed" in their place is
 * strictly less useful. Unparseable responses fall back to the status code.
 */
async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (data && typeof data.error === "string" && data.error) return data.error;
  } catch {
    // Body was not our JSON. Fall through.
  }
  if (response.status === 413) return "That file is larger than the 50 MB relay limit.";
  if (response.status === 404) return "No e-reader is waiting for that code. Open the Send page on the device and try again.";
  if (response.status === 429) return "Too many attempts. Wait a minute and try again.";
  return `The relay returned ${response.status}.`;
}

async function fileToBlob(
  file: File | Blob,
  fileName: string
): Promise<{ blob: Blob; name: string; isFile: boolean }> {
  if (typeof File !== "undefined" && file instanceof File) {
    return { blob: file, name: file.name || fileName, isFile: true };
  }
  // React Native / Capacitor WebView sometimes hands back a Blob that is not a
  // File. The name is then the only source, and the Worker sanitises it anyway.
  return { blob: file, name: fileName, isFile: false };
}

/**
 * POST the file to Kora's Worker, tagged with the device's code.
 *
 * Progress via XHR because it is the only browser API that reports upload bytes
 * for a Blob without buffering a second copy in JS.
 */
export function uploadToRelay(opts: RelayUploadOptions): Promise<SendToDeviceResult> {
  const { code, fileName, fileBlob, relayBase = DEFAULT_RELAY_BASE, signal, onProgress } = opts;
  const url = `${relayBase}/api/relay/upload`;

  return new Promise<SendToDeviceResult>((resolve) => {
    // An already-aborted signal must not fire a request at all.
    if (signal?.aborted) return resolve({ status: "cancelled" });

    const xhr = new XMLHttpRequest();
    let settled = false;
    const settle = (r: SendToDeviceResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        // Already finished; the response handler will settle instead.
      }
      // Cancellation is reported as cancellation. Never as a success, and
      // never by throwing into the panel's catch as an error the user must
      // decode.
      settle({ status: "cancelled" });
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    xhr.open("POST", url, true);
    xhr.responseType = "text";

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }

    xhr.onload = async () => {
      signal?.removeEventListener("abort", onAbort);
      if (xhr.status < 200 || xhr.status >= 300) {
        // `xhr.response` is a string here (responseType = "text"), so this is
        // synchronous and safe; readError is only awaited in the fetch path.
        let message = `The relay returned ${xhr.status}.`;
        try {
          const parsed = JSON.parse(String(xhr.response || ""));
          if (parsed && typeof parsed.error === "string" && parsed.error) message = parsed.error;
        } catch {
          // Keep the status-code message.
        }
        if (xhr.status === 413) message = "That file is larger than the 50 MB relay limit.";
        if (xhr.status === 404) {
          message = "No e-reader is waiting for that code. Open the Send page on the device and try again.";
        }
        return settle({ status: "error", error: message });
      }
      let sentName = fileName;
      let bytes = 0;
      try {
        const parsed = JSON.parse(String(xhr.response || "{}"));
        if (parsed && typeof parsed.name === "string") sentName = parsed.name;
        if (parsed && typeof parsed.bytes === "number") bytes = parsed.bytes;
      } catch {
        // 2xx with an unparseable body: the Worker said OK and the file is
        // staged. Report the name we sent, and do not invent a failure.
      }
      settle({
        status: "ok",
        method: "kora-relay",
        fileName: sentName,
        message: `Sent to your e-reader via Kora's relay (${formatBytes(bytes || fileBlob.size)}). The device has to be on the Send page.`,
      });
    };

    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      settle({ status: "error", error: "Could not reach the relay. Check your connection." });
    };

    xhr.ontimeout = () => {
      signal?.removeEventListener("abort", onAbort);
      settle({ status: "error", error: "The relay timed out." });
    };

    const body = new FormData();
    fileToBlob(fileBlob, fileName).then(({ blob, name, isFile }) => {
      if (settled) return;
      body.append("code", code);
      if (isFile) {
        body.append("file", blob as File, name);
      } else {
        body.append("file", new Blob([blob], { type: blob.type || "application/octet-stream" }), name);
      }
      if (signal?.aborted) return onAbort();
      xhr.send(body);
    });
  });
}

/**
 * Put a file in front of an e-reader through Kora's own relay.
 *
 * A code that is not four legal characters is refused BEFORE any network call,
 * with a message about the code — not a generic failure, because "that code
 * can't be right" is the actual problem in almost every real case of this.
 */
export async function sendToDeviceViaRelay(
  file: File | Blob,
  fileName: string,
  code: string,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void
): Promise<SendToDeviceResult> {
  const normalized = normalizeDeviceCode(code);
  if (!normalized) {
    return {
      status: "error",
      error: "That code isn't 4 characters. Read it off the Send page on your e-reader.",
    };
  }
  if (!file || (file as Blob).size === 0) {
    return { status: "error", error: "That file is empty." };
  }
  if ((file as Blob).size > RELAY_MAX_BYTES) {
    return { status: "error", error: "That file is larger than the 50 MB relay limit." };
  }
  return uploadToRelay({ code: normalized, fileName, fileBlob: file, signal, onProgress });
}

/** Fetch the relay's self-report, including which storage answered. */
export async function fetchRelayStatus(
  relayBase: string = DEFAULT_RELAY_BASE
): Promise<{ ok: boolean; storage?: string; maxBytes?: number; page?: string; error?: string }> {
  try {
    const res = await fetch(`${relayBase}/api/relay/status`, { headers: { Accept: "application/json" } });
    if (!res.ok) return { ok: false, error: `status ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { ok: false, error: e?.message || "unreachable" };
  }
}
