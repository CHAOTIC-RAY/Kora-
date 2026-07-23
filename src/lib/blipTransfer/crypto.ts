/**
 * Ephemeral AES-GCM room keys derived from the share code.
 * Extra application-layer encryption on top of WebRTC DTLS.
 */

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function deriveRoomKey(code: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(`kora-blip-v1:${code.toUpperCase().trim()}`),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("kora-blip-salt"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptChunk(
  key: CryptoKey,
  plain: ArrayBuffer
): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  const out = new Uint8Array(iv.byteLength + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), iv.byteLength);
  return out.buffer;
}

export async function decryptChunk(
  key: CryptoKey,
  packed: ArrayBuffer
): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(packed);
  const iv = bytes.slice(0, 12);
  const data = bytes.slice(12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
}

export function encodeJson(obj: unknown): string {
  return JSON.stringify(obj);
}

export { bytesToBase64, base64ToBytes };
