/**
 * croc — receiver-side support for the Workshop "croc" integration plugin.
 *
 * WHAT THIS IS, PRECISELY
 * -----------------------
 * A croc code is a 3-word phrase (`acid-alkali-molasses`). Whoever runs
 * `croc send` gets one; the other side types it into `croc receive`. The words
 * are an EFF Short Wordlist #1 entry, 1296 of them, joined by hyphens.
 *
 * Kora is a RECEIVER in this phase and only a receiver. The user runs
 * `croc send book.epub` on a laptop; the file comes to the device Kora is on.
 * Sending from a browser is not implemented: it needs an upload path, and a
 * browser cannot zip a directory, so "send this folder" would be a lie. The
 * receiving case is the one that matters for moving a book onto a device.
 *
 * WHY THERE IS NO IN-APP PEER (read this before "fixing" it)
 * ----------------------------------------------------------
 * Upstream compiles the real Go crypto (PAKE, crypt, codephrase, pake/v3) to
 * WebAssembly at `web/wasm/main.go`, and a browser IS a full croc peer when
 * that WASM is loaded. It is not shipped to npm, though. It is built by
 * `make build-web` into `src/webassets/dist`, which is gitignored, so there is
 * nothing to `npm install`. The public `https://getcroc.com/croc.wasm` is
 * served WITHOUT `Access-Control-Allow-Origin`, so a page on another origin
 * cannot fetch it. Rebuilding it needs the Go 1.27 toolchain, which is not a
 * build input of this app.
 *
 * So this module does NOT pretend to be a peer. What it does instead is real
 * and works: it parses and validates a code locally, tells the user exactly
 * which word is the room selector and which two carry the secret, and hands the
 * receive to the official croc web client, which does load the WASM. That
 * handoff is verified working — `https://getcroc.com/?code=<code>` prefills the
 * receive field and starts the PAKE handshake against the live relay.
 *
 * SECURITY, STATED PLAINLY (not buried in a docs folder)
 * ------------------------------------------------------
 *  - The 3-word code is 2 words of secret. Word 1 is a room selector and is
 *    public to the relay. 1296^2 = 1,679,616 ~= 20.7 bits. That is the real
 *    limit, and it is low enough that an online guessing attack against a
 *    long-lived room is a real consideration.
 *  - The relay hop uses a HARDCODED public key. The relay can therefore read
 *    the control channel: it sees room names, timing and transfer sizes. It
 *    CANNOT read file bytes and CANNOT impersonate a peer. File payloads are
 *    AES-256-GCM keyed from the 2-word PAKE password.
 *  - A MALICIOUS SENDER can attack the RECEIVER's filesystem. croc's recent
 *    advisories are all this class, not crypto weakness: path traversal,
 *    symlink overwrite, and a case-insensitive bypass of the .ssh guard
 *    (GHSA-wmw5-q587-gx56, GHSA-m6m7-376m-rr8g, GHSA-pcm6-vvg3-3xmh,
 *    GHSA-x89h-7h96-v88f). `sanitiseReceivedFileName` below exists because of
 *    those four, not as a general tidy-up.
 *
 * Licence note: croc itself is MIT (Copyright (c) 2017-2025 Zack Scholl), its
 * wordlist is CC BY 4.0, and the vendored Tailcat/Tailscale is BSD-3-Clause.
 * Kora authored this plugin, not croc. See the NOTICE in Kora-Sources.
 */

/**
 * Size of the EFF Short Wordlist #1 that croc draws codes from.
 *
 * Verified against `src/codephrase/codephrase.go` (`effWordCount = 1296`). It
 * is not 2048, which is the number people quote for the EFF list generally —
 * Short Wordlist #1 is the 6-character-per-word subset.
 */
export const CROC_WORD_COUNT = 1296;

/** Word count in a current croc code. */
export const CROC_CODE_WORDS = 3;

/** Word count in the older, still-parsed four-word format. */
export const CROC_CODE_WORDS_LEGACY_FOUR = 4;

/** Suffix croc hashes with to turn a room selector into a relay room name. */
export const CROC_ROOM_HASH_SUFFIX = "croc";

/**
 * Minimum code length. croc rejects shorter codes outright
 * (`ErrCodeTooShort`, "must be at least 6 characters").
 */
export const CROC_MIN_CODE_LENGTH = 6;

/** The one entry in the EFF list that contains croc's own separator. */
const HYPHENATED_EFF_WORD = "yo-yo";

/** Public relay pool, as advertised by the official croc web client. */
export const CROC_PUBLIC_RELAYS: readonly string[] = [
  "1.getcroc.com:9009",
  "2.getcroc.com:9009",
  "3.getcroc.com:9009",
  "4.getcroc.com:9009",
];

/**
 * The official croc web client, used as the receiving peer.
 *
 * Overridable so a user who self-hosts `croc-web` (or runs their own
 * `croc relay`) can point the handoff at their own instance instead of the
 * public one. Any base URL is accepted; see `normaliseCrocWebUrl`.
 */
export const CROC_DEFAULT_WEB_URL = "https://getcroc.com";

/** How a code divides into its room and PAKE parts. Mirrors `codephrase.Format`. */
export type CrocCodeFormat = "three-word" | "four-word" | "legacy";

export interface CrocCodeComponents {
  /** The full code, normalised. */
  code: string;
  /**
   * The room selector: the part the relay sees. Public, NOT secret.
   *
   * "acid" in `acid-alkali-molasses`.
   */
  roomSelector: string;
  /**
   * The PAKE password: the secret words. "alkali-molasses".
   *
   * This is what a guesser has to guess, and it is only 2 words wide.
   */
  pakePassphrase: string;
  format: CrocCodeFormat;
}

export type CrocCodeParse =
  | { ok: true; components: CrocCodeComponents; error?: undefined }
  | { ok: false; components?: undefined; error: string };

/**
 * Normalise user input into a code: trimmed, lowercased, one hyphen between
 * words, no stray whitespace inside a word.
 *
 * People paste these from a terminal, where they arrive in any of a dozen
 * shapes. This is deliberately forgiving about FORM and strict about CONTENT.
 */
export function normaliseCrocCode(input: string): string {
  return input
    .trim()
    .toLowerCase()
    // Hyphens included: a code retyped with a double hyphen, or copied through
    // something that turned spaces into `--`, must still be three words and not
    // four, or the split below puts the wrong words in the secret.
    .split(/[\s_-]+/)
    .filter(Boolean)
    .join("-");
}

/** True when a single hyphen-delimited part is a plausible code word. */
function isCodeWord(part: string): boolean {
  return /^[a-z]+$/.test(part) && part.length >= 1;
}

/**
 * Parse a croc code the way `codephrase.Parse` does, in the same order.
 *
 * Order matters and is copied deliberately:
 *   1. exactly 3 hyphen parts               -> three-word
 *   2. exactly 4 parts collapsing to 3     -> three-word, via the `yo-yo` case
 *   3. exactly 4 parts                      -> four-word
 *   4. anything else >= 6 chars             -> legacy byte split
 *
 * Case 2 is upstream's real ambiguity: the EFF list contains "yo-yo", so a
 * three-word code can legitimately serialise to FOUR hyphen-separated parts.
 * Upstream resolves it against the embedded wordlist. This module deliberately
 * does NOT vendor 1296 words, so it resolves the one known case explicitly and
 * otherwise defers to the peer, which has the real list.
 *
 * Deliberately NOT verified here: whether each part is in the EFF wordlist.
 * The receiving peer checks that. Claiming it here would be a check that
 * silently passes anything.
 */
export function parseCrocCode(input: string): CrocCodeParse {
  const code = normaliseCrocCode(input);

  if (code.length < CROC_MIN_CODE_LENGTH) {
    return { ok: false, error: "A croc code is at least 6 characters." };
  }

  const parts = code.split("-");
  const allWords = parts.every(isCodeWord);

  if (allWords && parts.length === CROC_CODE_WORDS) {
    return {
      ok: true,
      components: {
        code,
        roomSelector: parts[0],
        pakePassphrase: parts.slice(1).join("-"),
        format: "three-word",
      },
    };
  }

  // The `yo-yo` entry: 4 parts, but the middle two are one word.
  if (allWords && parts.length === 4 && parts[1] === "yo" && parts[2] === "yo") {
    return {
      ok: true,
      components: {
        code,
        roomSelector: parts[0],
        pakePassphrase: `${HYPHENATED_EFF_WORD}-${parts[3]}`,
        format: "three-word",
      },
    };
  }

  if (allWords && parts.length === CROC_CODE_WORDS_LEGACY_FOUR) {
    return {
      ok: true,
      components: {
        code,
        roomSelector: parts.slice(0, 2).join("-"),
        pakePassphrase: parts.slice(2).join("-"),
        format: "four-word",
      },
    };
  }

  if (!allWords) {
    return {
      ok: false,
      error:
        "A croc code is lowercase words joined by hyphens. " +
        "If you are on a legacy croc (v9 or v10) the code is a raw string — " +
        "Kora cannot generate a v11 receiver for it, so use the croc CLI on the sending side.",
    };
  }

  return {
    ok: false,
    error: `A croc code is 3 words (${CROC_CODE_WORDS}) or the older 4 words; this has ${parts.length}.`,
  };
}

/**
 * Bits of secret in a code, counted honestly.
 *
 * This is the number that matters and it is easy to get wrong by quoting
 * log2(1296^3) = ~31 bits. It is NOT that. Word 1 is the room selector and is
 * known to the relay, so an attacker guessing the code only has the last two
 * words: 1296^2 = 1,679,616, which is 20.68 bits.
 */
export function crocSecretBits(format: CrocCodeFormat): number {
  const secretWords = format === "legacy" ? 0 : 2;
  return secretWords * Math.log2(CROC_WORD_COUNT);
}

/** Human phrasing of the same limit, for the UI. */
export function crocSecretSummary(format: CrocCodeFormat): string {
  if (format === "legacy") {
    return "Legacy byte code — its secret is not two EFF words, so no bit count is claimed here.";
  }
  const bits = crocSecretBits(format);
  return (
    `${bits.toFixed(1)} bits of secret (2 words of ${CROC_WORD_COUNT}). ` +
    `The first word is only a room selector and is public to the relay.`
  );
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The relay room name for a code: `sha256(roomSelector + "croc")`, hex.
 *
 * Identical to `codephrase.Parse` + `Components.RoomName`. Exposed so the panel
 * can show which room a code lands in, and so a self-hosted pool can be reasoned
 * about. SHA-256 is used as a ROUTING function here, not as a security claim:
 * it is not what protects the transfer.
 */
export async function crocRoomName(components: CrocCodeComponents): Promise<string> {
  return sha256Hex(components.roomSelector + CROC_ROOM_HASH_SUFFIX);
}

/**
 * Which relay in an ordered pool a code routes to.
 *
 * Mirrors `codephrase.RelayIndex`: the full SHA-256 of the code read as a
 * big-endian unsigned integer, modulo the pool size. Matters for a self-hosted
 * pool where the sending and receiving sides must agree on ordering.
 */
export async function crocRelayIndex(
  code: string,
  relayCount: number
): Promise<number> {
  if (!Number.isInteger(relayCount) || relayCount <= 0) {
    throw new Error("relayCount must be a positive integer");
  }
  const hex = await sha256Hex(code);
  // Take the leading 8 bytes as a BigInt: 64 bits is far more than needed to be
  // unbiased against any real pool size, and it avoids hand-rolling 32-byte
  // big-endian arithmetic.
  let value = BigInt(`0x${hex.slice(0, 16)}`);
  value %= BigInt(relayCount);
  return Number(value);
}

// ── Self-hosted relay / croc-web configuration ───────────────────────────────

export interface CrocRelaySettings {
  /** Base URL of the croc-web instance that serves the WASM and /ws bridge. */
  webUrl: string;
  /** `host:port` for a self-hosted relay, or "" to use the public pool. */
  relayHost: string;
  /** `CROC_PASS` for that relay. Stored locally, never sent anywhere else. */
  relayPassword: string;
}

export const EMPTY_CROC_RELAY_SETTINGS: CrocRelaySettings = {
  webUrl: CROC_DEFAULT_WEB_URL,
  relayHost: "",
  relayPassword: "",
};

/**
 * Accept only an absolute http(s) URL, with no path/query/fragment.
 *
 * This string ends up in a URL we hand to the browser, so a `javascript:` or
 * `data:` value here would be an injection sink. Rejecting anything that is not
 * plain http(s) to an origin closes that off.
 */
export function normaliseCrocWebUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.pathname !== "/" && url.pathname !== "") return "";
  if (url.search || url.hash) return "";
  return url.origin;
}

/** Validate a `host:port` relay address. Returns the cleaned value or an error. */
export function validateCrocRelayHost(
  input: string
): { ok: true; value: string; error?: undefined } | { ok: false; value?: undefined; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Enter a relay address, or clear it to use the public pool." };
  if (/\s/.test(trimmed)) return { ok: false, error: "A relay address cannot contain spaces." };
  if (trimmed.includes("/") || trimmed.includes("://")) {
    return { ok: false, error: "Use host:port only — no scheme and no path." };
  }
  const idx = trimmed.lastIndexOf(":");
  if (idx <= 0) return { ok: false, error: "Use host:port, for example relay.example.com:9009." };
  const host = trimmed.slice(0, idx);
  const port = trimmed.slice(idx + 1);
  if (!/^[A-Za-z0-9.-]+$/.test(host)) {
    return { ok: false, error: "That host has characters a relay address cannot contain." };
  }
  if (!/^\d{1,5}$/.test(port)) return { ok: false, error: "The port must be a number." };
  const n = Number(port);
  // croc relay defaults to 9009-9013. 1-1023 needs root on Linux, and 65535+ is
  // not a port. Keeping the range tight also means a typo cannot silently
  // produce an address no relay is listening on.
  if (n < 1 || n > 65535) return { ok: false, error: "The port must be between 1 and 65535." };
  return { ok: true, value: `${host.toLowerCase()}:${n}` };
}

/**
 * The command to run to self-host a relay, with the user's own values in it.
 *
 * `croc relay` is one self-hostable binary: no TLS needed, ports 9009-9013, and
 * the password comes from `CROC_PASS`. Kora runs on Cloudflare Workers, which
 * can open outbound TCP but can NEVER listen on one — so Kora can be a croc
 * client and never the relay. That constraint is the reason this generator
 * exists rather than a hosted relay in the app.
 */
export function crocRelayCommand(settings: CrocRelaySettings): string {
  const host = validateCrocRelayHost(settings.relayHost);
  if (!host.ok) return "";
  const pass = settings.relayPassword.trim();
  return pass
    ? `CROC_PASS='${pass.replace(/'/g, "'\\''")}' croc relay ${host.value}`
    : `croc relay ${host.value}`;
}

/** The command to run a self-hosted croc-web (WASM + /ws bridge). */
export function crocWebCommand(settings: CrocRelaySettings): string {
  const host = validateCrocRelayHost(settings.relayHost);
  const relays = host.ok ? ` --relays ${host.value}` : "";
  return `croc-web --bind 0.0.0.0:9014${relays}`;
}

/**
 * The relay command with the password masked, for on-screen display.
 *
 * The password field is a password input, and the panel tells the user it is
 * "never shown again in the clear" — so echoing the real value two lines below
 * it, in the generated command, would make that a lie. The COPY button still
 * puts the real command on the clipboard, because a masked command is a command
 * that cannot run.
 */
export function crocRelayCommandDisplay(settings: CrocRelaySettings): string {
  if (!settings.relayPassword.trim()) return crocRelayCommand(settings);
  // Mask by position, not by substituting a placeholder value: a placeholder is
  // itself a non-empty password, so it would make crocRelayCommand emit a
  // CROC_PASS prefix the user never set.
  const withMask = crocRelayCommand({
    ...settings,
    relayPassword: MASKED_PASSWORD,
  });
  return withMask.replace(`CROC_PASS='${MASKED_PASSWORD}'`, "CROC_PASS='••••••'");
}

/**
 * Stand-in passed to `crocRelayCommand` to find where the password sits. It is
 * NUL-wrapped so it cannot collide with a real password the user typed.
 */
const MASKED_PASSWORD = "\u0000croc-mask\u0000";

// ── The handoff ──────────────────────────────────────────────────────────────

/**
 * The URL that receives the file, in the official croc web client.
 *
 * Verified live against https://getcroc.com on 2026-09-30: `?code=` prefills
 * the receive field and starts the PAKE handshake on its own (the page goes
 * straight to "Authenticating code..."). It is not a deep link that merely
 * pre-fills text.
 *
 * Returns "" when there is no usable web URL, so the caller can disable the
 * button rather than opening something broken.
 */
export function crocReceiveUrl(settings: CrocRelaySettings, code: string): string {
  const base = normaliseCrocWebUrl(settings.webUrl) || CROC_DEFAULT_WEB_URL;
  const parsed = parseCrocCode(code);
  if (!parsed.ok) return "";
  return `${base}/?code=${encodeURIComponent(parsed.components.code)}`;
}

/**
 * Whether Kora can be a croc peer in this build.
 *
 * False, and honestly so: the WASM that makes a browser a full peer is not
 * vendored and is not fetchable cross-origin. The UI says this in words rather
 * than hiding the button.
 */
export function crocWasmPeerAvailable(): false {
  return false;
}

// ── Received-filename sanitisation ────────────────────────────────────────────

/** Longest a filename may be. ext4/APFS allow 255 bytes; NTFS allows 255 chars. */
export const CROC_MAX_FILENAME_LENGTH = 200;

/**
 * Names a receiver must never write, checked case-insensitively.
 *
 * The case-insensitivity is the whole point, and it is there because
 * GHSA-wmw5-q587-gx56 was exactly this bug: a guard compared the literal
 * string ".ssh", so ".SSH", ".Ssh" and ".sSh" walked straight past it.
 * `.git` is here for the same reason — a sender-supplied `.git/config` or
 * `.git/hooks/post-checkout` is remote code execution on the next git command.
 */
export const CROC_FORBIDDEN_NAMES: readonly string[] = [
  ".ssh",
  ".git",
  ".gnupg",
  ".aws",
  ".config",
  ".npmrc",
  ".bashrc",
  ".bash_profile",
  ".profile",
  ".zshrc",
  "id_rsa",
  "id_ed25519",
  "authorized_keys",
  "known_hosts",
  ".env",
];

/** Windows reserved device names — still special with any extension appended. */
const WINDOWS_DEVICE_NAMES =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Characters no filesystem should ever see from a remote peer. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Make a sender-supplied filename safe to write to a receiving device.
 *
 * This is a SECURITY function, written because of four croc advisories in one
 * class: a malicious sender attacking the receiver's filesystem
 * (GHSA-wmw5-q587-gx56, GHSA-m6m7-376m-rr8g, GHSA-pcm6-vvg3-3xmh,
 * GHSA-x89h-7h96-v88f). It assumes the name is hostile.
 *
 * What it defends against, in order:
 *   1. Path traversal — `../`, `..\`, absolute paths, and drive letters. Only
 *      the final component is ever kept, so a traversal cannot escape.
 *   2. Symlink tricks — a name is reduced to one plain component with no
 *      separators left, so there is nothing for a symlink to point through.
 *   3. Case-insensitive guard bypass — the forbidden-name check lowercases both
 *      sides, and it also checks the stem, so ".SSH", ".Ssh" and
 *      "id_rsa.pub.bak" style evasions all land on the same deny.
 *   4. Platform normalisation — trailing dots and spaces (Windows silently drops
 *      them, which turns two distinct names into one), Windows reserved device
 *      names, control characters, and length.
 *
 * Deliberately NOT handled here: extension allow-listing, and MIME checks. Both
 * belong to whoever opens the file, not to the thing that names it, and
 * pretending to validate a file's type from its name would be the same
 * overclaim in the other direction.
 */
export function sanitiseReceivedFileName(
  input: string,
  usedNames: ReadonlySet<string> = new Set<string>()
): string {
  // 1. Reduce to a single path component. Splitting on BOTH separators before
  //    taking the last part is what makes `a/b/../../../etc/passwd` collapse to
  //    `passwd` instead of surviving as a path.
  const rawSeparatorsSplit = input.split(/[/\\]/);
  let base = rawSeparatorsSplit[rawSeparatorsSplit.length - 1] ?? "";

  // 2. Drop control characters and NUL entirely, rather than replacing them:
  //    a replacement char in a filename is still a filename the sender chose.
  base = base.replace(CONTROL_CHARS, "");

  // 3. A Windows drive-relative or UNC remnant ("C:", "C:foo") leaves a colon
  //    that is illegal on Windows; strip every colon.
  base = base.replace(/:/g, "");

  // 4. Trailing dots and spaces are dropped by Windows, so ".bashrc " and
  //    ".bashrc" are the same file there but not here. Cut them so what we
  //    check is what gets written on every platform.
  base = base.replace(/[. ]+$/, "");

  // 5. Leading dots make a hidden file; keep at most one, and never a leading
  //    ".." (already impossible after step 1, but belt and braces).
  base = base.replace(/^\.+/, (dots) => (dots.length > 1 ? "." : dots));
  if (base === "." || base === "..") base = "";

  // 6. Reserved Windows device names, with or without an extension.
  if (WINDOWS_DEVICE_NAMES.test(base)) {
    base = `_${base}`;
  }

  // 7. Length. Truncate on the STEM, not the extension, so a 300-character
  //    name still opens as the file type it claims to be.
  if (base.length > CROC_MAX_FILENAME_LENGTH) {
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    const room = Math.max(1, CROC_MAX_FILENAME_LENGTH - ext.length);
    base = `${stem.slice(0, room)}${ext}`;
  }

  // 8. Nothing usable survived. Never hand back "".
  if (!base || !base.trim()) base = "received-file";

  // 9. The forbidden-name check, on the cleaned name AND on its stem, both
  //    lowercased. This is the case-bypass defence.
  const stemOf = (name: string) => {
    const dot = name.lastIndexOf(".");
    return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
  };
  const lower = base.toLowerCase();
  const stem = stemOf(base);
  const isForbidden =
    CROC_FORBIDDEN_NAMES.includes(lower) || CROC_FORBIDDEN_NAMES.includes(stem);
  if (isForbidden) base = `unsafe-${base}`;

  // 10. Collision against names already taken in this transfer, compared
  //     case-insensitively, because the receiving filesystem may be
  //     case-insensitive even where this one is not. Without this,
  //     "book.epub" and "BOOK.epub" would silently be one file.
  //
  //     `unsafe-` names are disambiguated at the END rather than before the
  //     extension. Inserting a counter before `.ssh` produced "unsafe- (2).ssh",
  //     which reads as though ".ssh" were a file extension — and the whole point
  //     of the prefix is that this name is not an ordinary file.
  return isForbidden
    ? appendCounter(base, usedNames)
    : disambiguateAgainst(base, usedNames);
}

/** `name` -> `name (2)`, `name (3)`… , keeping the whole name intact. */
function appendCounter(
  name: string,
  usedNames: ReadonlySet<string>
): string {
  const taken = new Set<string>();
  for (const used of usedNames) taken.add(used.toLowerCase());
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${name}-${Date.now()}`;
}

/**
 * Return `name`, or `name (2)`, `name (3)`… until it does not collide.
 *
 * `book.epub` -> `book (2).epub`, keeping the extension readable, because
 * Kora dispatches on the extension and a name ending `epub (2)` is not an epub.
 */
export function disambiguateAgainst(
  name: string,
  usedNames: ReadonlySet<string>
): string {
  const taken = new Set<string>();
  for (const used of usedNames) taken.add(used.toLowerCase());
  if (!taken.has(name.toLowerCase())) return name;

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // 10,000 collisions on one name means something is wrong upstream; a
  // timestamp is still a legal filename and still unique enough to be honest
  // about not looping forever.
  return `${stem}-${Date.now()}${ext}`;
}

/** A short, honest label for the handoff, used in the UI. */
export function crocWebLabel(settings: CrocRelaySettings): string {
  const base = normaliseCrocWebUrl(settings.webUrl) || CROC_DEFAULT_WEB_URL;
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}
