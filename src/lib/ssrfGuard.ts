/**
 * SSRF guard for endpoints that fetch a caller-supplied URL.
 *
 * WHY THIS EXISTS AS A SHARED MODULE
 * `/api/proxy-image` previously blocked exactly four hostnames
 * (`169.254.169.254`, `metadata.google.internal`, `localhost`, `127.0.0.1`).
 * That is not a denylist, it is four examples: `10.0.0.1`, `192.168.1.1`,
 * `172.16.0.1`, `[::1]`, `0.0.0.0`, and the whole 127.0.0.0/8 block all pass
 * it. Any unauthenticated endpoint that fetches a caller-supplied URL can
 * therefore be aimed at the internal network, where it can read the cloud
 * metadata service for credentials.
 *
 * The new mirror-probe endpoint must be NO MORE PERMISSIVE than the proxy it
 * sits beside, so both now call the same guard. That is why the change to
 * `proxy-image` is in scope here: reusing the weak check and extending it
 * locally would leave the weaker of the two endpoints in the codebase.
 *
 * The check is deliberately layered:
 *   1. Scheme must be http/https — no `file:`, `gopher:`, `data:`.
 *   2. Literal IP hosts are range-checked (v4 and v6), since there is no DNS
 *      to consult and the address is unambiguous.
 *   3. Obvious internal names are refused.
 *   4. Redirects are NOT re-validated against a hostname here, because
 *      `fetch` follows them internally; callers that must be strict should
 *      use `redirect: "manual"` and validate each hop. The mirror probe does
 *      exactly that (see `probeMirrorUrl`), which is why it is safe to fetch
 *      with redirects on there.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "169.254.169.254",
  "metadata",
  "0.0.0.0",
  "::",
  "::1",
  "[::1]",
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = parseInt(p, 10);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** True for loopback, RFC1918, link-local, CGNAT, and reserved v4 ranges. */
export function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base);
    if (b === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange("0.0.0.0", 8) ||        // "this network"
    inRange("10.0.0.0", 8) ||       // RFC1918
    inRange("100.64.0.0", 10) ||    // CGNAT
    inRange("127.0.0.0", 8) ||      // loopback
    inRange("169.254.0.0", 16) ||   // link-local, incl. 169.254.169.254
    inRange("172.16.0.0", 12) ||     // RFC1918
    inRange("192.0.0.0", 24) ||      // IETF protocol assignments
    inRange("192.168.0.0", 16) ||    // RFC1918
    inRange("198.18.0.0", 15) ||     // benchmarking
    inRange("224.0.0.0", 4) ||       // multicast
    inRange("240.0.0.0", 4)          // reserved, incl. 255.255.255.255
  );
}

export function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (addr === "::1" || addr === "::") return true;
  if (addr.startsWith("fe80")) return true;      // link-local
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // ULA
  if (addr.startsWith("fec") || addr.startsWith("fed") || addr.startsWith("fee") || addr.startsWith("fef")) {
    return true;                                 // site-local (deprecated)
  }
  // IPv4-mapped IPv6 MUST be caught here, or the v6 check is a trivial bypass
  // of the v4 one. Both spellings matter, because `new URL()` normalizes
  // `[::ffff:10.0.0.1]` to the compressed HEX form `[::ffff:a00:1]` — a dotted
  // -quad regex alone matches nothing and the whole guard is defeated.
  const mappedDotted = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);

  const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const dotted = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join(".");
    return isPrivateIPv4(dotted);
  }
  return false;
}

export interface GuardResult {
  ok: boolean;
  /** Short, safe to show a caller. Never echoes the blocked address. */
  reason?: string;
  parsed?: URL;
}

/**
 * Validate a caller-supplied fetch target.
 *
 * On failure the reason never contains the resolved address, so the endpoint
 * cannot be used as an internal port-scanner by reading the error text.
 */
export function assertSafeFetchTarget(raw: string): GuardResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Only http and https URLs can be fetched." };
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: "That address is not allowed." };
  }
  if (isPrivateIPv4(host)) {
    return { ok: false, reason: "That address is not allowed." };
  }
  if (host.includes(":") && isPrivateIPv6(host)) {
    return { ok: false, reason: "That address is not allowed." };
  }
  // A bare label with no dot cannot be a public FQDN; it would only resolve
  // via a local search domain.
  if (!host.includes(".") && !host.includes(":")) {
    return { ok: false, reason: "That hostname is not allowed." };
  }
  return { ok: true, parsed };
}