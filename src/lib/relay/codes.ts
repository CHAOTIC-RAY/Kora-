/**
 * Device codes and secrets for Kora's own e-reader relay.
 *
 * WHY THE ALPHABET IS 31 CHARACTERS, NOT 36. A code is read off an e-ink
 * screen and typed on a phone, so it must avoid glyphs that are ambiguous
 * under E-Ink: `O`/`0`, `I`/`1`/`l`, and `L`. Excluding them is not
 * decoration — every one of them is a case where a mistyped code silently
 * becomes a *different valid* code, and with an unauthenticated endpoint a
 * wrong code is a wrong file or no file at all. 8 digits + 23 letters = 31.
 *
 * 31^4 = 923,521 possible codes. That is deliberately NOT treated as a
 * secret on its own: see `rateLimit.ts`. Four characters is a pairing code for
 * one transfer between two devices the user is standing next to each other,
 * not an account credential.
 *
 * THE REAL SECRET IS `generateRelaySecret()`. The e-reader page holds the
 * secret; the phone only ever sees the four characters. So guessing a code
 * (bounded by the rate limits) can at worst *inject* a file into a session —
 * and the first upload wins, so it is a spam nuisance, not a read. Reading a
 * file back out needs code + secret, and the secret is 128 bits of
 * `crypto.getRandomValues`. That split is what makes a 4-character code an
 * acceptable design instead of a liability.
 */

export const CODE_LENGTH = 4;

/** No 0/O, 1/I/L. Sorted for easy eyeballing. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** How many codes exist. Quoted in the UI so the number is not folklore. */
export const CODE_SPACE = Math.pow(CODE_ALPHABET.length, CODE_LENGTH); // 923,521

const CODE_SET = new Set(CODE_ALPHABET.split(""));

/**
 * Normalise a typed code: upcase, strip separators, and reject anything that
 * is not exactly CODE_LENGTH legal characters.
 *
 * Note it does NOT map `0`->`O`. Silently correcting a look-alike means the
 * code the user thinks they typed is not the code we act on, and for an
 * unauthenticated fetch endpoint that ambiguity is the bug.
 */
export function normalizeRelayCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.toUpperCase().replace(/[\s-]/g, "");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!CODE_SET.has(ch)) return null;
  }
  return cleaned;
}

export function isValidRelayCode(raw: unknown): boolean {
  return normalizeRelayCode(raw) !== null;
}

export type RandomSource = () => number;

/** A fresh code. `random` is injectable so collision handling is testable. */
export function generateRelayCode(random: RandomSource = Math.random): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    const idx = Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length;
    out += CODE_ALPHABET[idx];
  }
  return out;
}

/** 128 bits, hex. Never logged, never in a URL — header or in-memory only. */
export function generateRelaySecret(random: RandomSource = Math.random): string {
  const cryptoObj = (globalThis as any).crypto;
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint8Array(16);
    cryptoObj.getRandomValues(buf);
    return Array.from(buf, (b: number) => b.toString(16).padStart(2, "0")).join("");
  }
  // Node/older engines. Only reached where WebCrypto is absent, which in
  // practice means a test or a legacy e-ink browser — never a claim of
  // cryptographic strength, so it is flagged rather than hidden.
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += Math.floor(random() * 16).toString(16);
  }
  return out;
}

/**
 * Pick a code that is not already taken.
 *
 * `taken` is consulted per candidate rather than once, because a generator
 * with a stubbed `random` (tests) or a weak entropy source can repeat. Bound
 * the attempts so a fully-saturated space fails loudly instead of hanging.
 */
export function generateUniqueRelayCode(
  isTaken: (code: string) => boolean | Promise<boolean>,
  random: RandomSource = Math.random,
  maxAttempts = 50
): Promise<string> {
  return (async () => {
    for (let i = 0; i < maxAttempts; i++) {
      const code = generateRelayCode(random);
      if (!(await isTaken(code))) return code;
    }
    throw new Error("relay: no free device code after " + maxAttempts + " attempts");
  })();
}
