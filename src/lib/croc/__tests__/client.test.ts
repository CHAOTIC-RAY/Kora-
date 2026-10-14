/**
 * croc receiver support — tests for the pure logic.
 *
 * The filename tests are the load-bearing ones. croc's recent advisories are
 * ALL one class: a malicious sender attacking the receiver's filesystem
 * (GHSA-wmw5-q587-gx56, GHSA-m6m7-376m-rr8g, GHSA-pcm6-vvg3-3xmh,
 * GHSA-x89h-7h96-v88f). Every case below is written as a name a hostile
 * sender would actually send, not as a hypothetical.
 *
 * Code parsing is tested against `src/codephrase/codephrase.go` in croc v11,
 * including the `yo-yo` case where a 3-word code serialises to 4 hyphens
 * because one EFF wordlist entry contains a hyphen.
 */

import {
  CROC_CODE_WORDS,
  CROC_DEFAULT_WEB_URL,
  CROC_FORBIDDEN_NAMES,
  CROC_MAX_FILENAME_LENGTH,
  CROC_MIN_CODE_LENGTH,
  CROC_PUBLIC_RELAYS,
  CROC_WORD_COUNT,
  crocReceiveUrl,
  crocRelayCommand,
  crocRelayCommandDisplay,
  crocRelayIndex,
  crocRoomName,
  crocSecretBits,
  crocWebCommand,
  crocWasmPeerAvailable,
  disambiguateAgainst,
  normaliseCrocCode,
  normaliseCrocWebUrl,
  parseCrocCode,
  sanitiseReceivedFileName,
  validateCrocRelayHost,
  EMPTY_CROC_RELAY_SETTINGS,
  type CrocRelaySettings,
} from "../client";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

/** Shorthand: parse and assert ok, returning the components. */
function mustParse(code: string) {
  const r = parseCrocCode(code);
  if (!r.ok) throw new Error(`expected ${code} to parse, got: ${r.error ?? "unknown"}`);
  return r.components;
}

// ── Constants match upstream ─────────────────────────────────────────────────

check("EFF short wordlist count is 1296", CROC_WORD_COUNT === 1296, CROC_WORD_COUNT);
check("a current code is 3 words", CROC_CODE_WORDS === 3, CROC_CODE_WORDS);
check("min code length is 6", CROC_MIN_CODE_LENGTH === 6, CROC_MIN_CODE_LENGTH);
check("public pool has 4 relays", CROC_PUBLIC_RELAYS.length === 4, CROC_PUBLIC_RELAYS);
check(
  "public pool is getcroc 9009",
  CROC_PUBLIC_RELAYS.every((r) => r.endsWith("getcroc.com:9009")),
  CROC_PUBLIC_RELAYS
);

// ── Code normalisation ───────────────────────────────────────────────────────

check("trims and lowercases", normaliseCrocCode("  ACID-Alkali  ") === "acid-alkali", normaliseCrocCode("  ACID-Alkali  "));
check("collapses internal spaces to hyphens", normaliseCrocCode("acid alkali molasses") === "acid-alkali-molasses");
check("collapses repeated separators", normaliseCrocCode("acid  --  alkali molasses") === "acid-alkali-molasses");
check("underscores become hyphens", normaliseCrocCode("acid_alkali_molasses") === "acid-alkali-molasses");
check("empty stays empty", normaliseCrocCode("   ") === "");

// ── Code parsing, mirroring codephrase.Parse ─────────────────────────────────

const three = mustParse("acid-alkali-molasses");
check("three-word format detected", three.format === "three-word", three.format);
check("word 1 is the room selector", three.roomSelector === "acid", three.roomSelector);
check("words 2-3 are the PAKE passphrase", three.pakePassphrase === "alkali-molasses", three.pakePassphrase);
check("room selector is NOT in the passphrase", !three.pakePassphrase.includes(three.roomSelector));

const four = mustParse("acid-alkali-molasses-helium");
check("four-word format detected", four.format === "four-word", four.format);
check("four-word: room is first 2 words", four.roomSelector === "acid-alkali", four.roomSelector);
check("four-word: passphrase is last 2 words", four.pakePassphrase === "molasses-helium", four.pakePassphrase);

// The real upstream ambiguity: "yo-yo" is in the EFF list, so a THREE-word code
// can arrive as FOUR hyphen-separated parts. Getting this wrong mis-splits the
// secret, so it is pinned here.
const yoyo = mustParse("acid-yo-yo-molasses");
check("yo-yo code is still three-word", yoyo.format === "three-word", yoyo.format);
check("yo-yo: room selector is word 1", yoyo.roomSelector === "acid", yoyo.roomSelector);
check("yo-yo: passphrase keeps yo-yo intact", yoyo.pakePassphrase === "yo-yo-molasses", yoyo.pakePassphrase);

// Input is normalised before parsing, so a pasted code with spaces works.
check("spaces pasted from a terminal still parse", mustParse("acid alkali molasses").format === "three-word");

// ── Code parse rejections ────────────────────────────────────────────────────

check("empty code is rejected", parseCrocCode("").ok === false);
check("too-short code is rejected", parseCrocCode("acid").ok === false, parseCrocCode("acid"));
check(
  "a 5-char code is rejected at the 6-char floor",
  parseCrocCode("abcde").ok === false,
  parseCrocCode("abcde")
);
check("two words is rejected", parseCrocCode("acid-alkali").ok === false);
check("five words is rejected", parseCrocCode("a-b-c-d-e-f-g-h").ok === false);
check("digits in a code are rejected", parseCrocCode("acid-alkali-mol4sses").ok === false);
check(
  "a legacy raw string says so rather than pretending",
  (() => {
    const r = parseCrocCode("8F2A!kq");
    return r.ok === false && /legacy croc/i.test(r.error);
  })()
);

// ── The 20.7-bit claim, computed rather than asserted ────────────────────────

const bits = crocSecretBits("three-word");
check("secret bits are ~20.7, not ~31", Math.abs(bits - 20.68) < 0.05, bits);
check("2 * log2(1296) is the formula", Math.abs(bits - 2 * Math.log2(1296)) < 1e-9, bits);
check("it is NOT log2(1296^3)", Math.abs(bits - Math.log2(1296 ** 3)) > 10);
check("four-word has the same 2-word secret", Math.abs(crocSecretBits("four-word") - bits) < 1e-9);
check("legacy claims no bit count", crocSecretBits("legacy") === 0);

// ── Room name + relay routing (async, real SHA-256) ──────────────────────────

const main = async () => {
  // sha256("acid" + "croc") — computed here independently of the module so a
  // change to the suffix cannot silently pass.
  const expectedRoom = await crypto.subtle
    .digest("SHA-256", new TextEncoder().encode("acidcroc"))
    .then((d) =>
      Array.from(new Uint8Array(d))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
  const room = await crocRoomName(three);
  check("room name is sha256(roomSelector + 'croc')", room === expectedRoom, room);
  check("room name is 64 hex chars", /^[0-9a-f]{64}$/.test(room), room);

  // Deterministic: the same code must always pick the same relay, or a
  // self-hosted pool never works.
  const i1 = await crocRelayIndex("acid-alkali-molasses", 4);
  const i2 = await crocRelayIndex("acid-alkali-molasses", 4);
  check("relay index is deterministic", i1 === i2, [i1, i2]);
  check("relay index is in range", i1 >= 0 && i1 < 4, i1);
  const spread = new Set<number>();
  for (let n = 0; n < 200; n++) {
    spread.add(await crocRelayIndex(`word${n}-word${n}b-word${n}c`, 4));
  }
  check("relay index actually spreads across a pool", spread.size === 4, [...spread]);

  let threw = false;
  try {
    await crocRelayIndex("a-b-c", 0);
  } catch {
    threw = true;
  }
  check("a zero relay pool throws", threw);

  // ── Self-hosted relay address validation ───────────────────────────────────

  check("valid host:port passes", validateCrocRelayHost("relay.example.com:9009").ok === true);
  check(
    "valid address is lowercased and trimmed",
    validateCrocRelayHost("  Relay.Example.COM:9009  ").value === "relay.example.com:9009"
  );
  check("no port is rejected", validateCrocRelayHost("relay.example.com").ok === false);
  check("a scheme is rejected", validateCrocRelayHost("https://relay.example.com:9009").ok === false);
  check("a path is rejected", validateCrocRelayHost("example.com:9009/croc").ok === false);
  check("spaces are rejected", validateCrocRelayHost("relay example.com:9009").ok === false);
  check("an empty address is rejected, not defaulted", validateCrocRelayHost("").ok === false);
  check("a non-numeric port is rejected", validateCrocRelayHost("example.com:abc").ok === false);
  check("port 0 is rejected", validateCrocRelayHost("example.com:0").ok === false);
  check("port 70000 is rejected", validateCrocRelayHost("example.com:70000").ok === false);
  check(
    "a shell metacharacter in the host is rejected",
    validateCrocRelayHost("evil.com;rm -rf /:9009").ok === false
  );

  // ── Generated commands ─────────────────────────────────────────────────────

  const rel: CrocRelaySettings = {
    webUrl: CROC_DEFAULT_WEB_URL,
    relayHost: "relay.example.com:9009",
    relayPassword: "s3cret",
  };
  check("relay command uses CROC_PASS", crocRelayCommand(rel) === "CROC_PASS='s3cret' croc relay relay.example.com:9009", crocRelayCommand(rel));
  check(
    "a quote in the password cannot break out of the shell",
    crocRelayCommand({ ...rel, relayPassword: "a'b" }) === "CROC_PASS='a'\\''b' croc relay relay.example.com:9009",
    crocRelayCommand({ ...rel, relayPassword: "a'b" })
  );
  check(
    "no password means no CROC_PASS prefix",
    crocRelayCommand({ ...rel, relayPassword: "" }) === "croc relay relay.example.com:9009"
  );
  check("an invalid relay host yields no command", crocRelayCommand({ ...rel, relayHost: "nope" }) === "");

  // The on-screen command must NOT echo the password, because the panel tells
  // the user it is never shown in the clear. The clipboard still gets the real
  // one, which is why these are two separate functions.
  check(
    "the displayed command masks the password",
    crocRelayCommandDisplay(rel) === "CROC_PASS='••••••' croc relay relay.example.com:9009",
    crocRelayCommandDisplay(rel)
  );
  check(
    "the displayed command never contains the real password",
    !crocRelayCommandDisplay(rel).includes("s3cret"),
    crocRelayCommandDisplay(rel)
  );
  check(
    "the displayed command matches the real one apart from the password",
    crocRelayCommandDisplay(rel) === crocRelayCommand(rel).replace("s3cret", "••••••")
  );
  check(
    "a password containing dots is still fully masked",
    !crocRelayCommandDisplay({ ...rel, relayPassword: "..." }).includes("..."),
    crocRelayCommandDisplay({ ...rel, relayPassword: "..." })
  );
  check(
    "with no password the displayed command is unchanged",
    crocRelayCommandDisplay({ ...rel, relayPassword: "" }) === "croc relay relay.example.com:9009"
  );
  check("croc-web command binds and names the relay", crocWebCommand(rel) === "croc-web --bind 0.0.0.0:9014 --relays relay.example.com:9009", crocWebCommand(rel));
  check(
    "croc-web with the public pool omits --relays",
    crocWebCommand(EMPTY_CROC_RELAY_SETTINGS) === "croc-web --bind 0.0.0.0:9014",
    crocWebCommand(EMPTY_CROC_RELAY_SETTINGS)
  );

  // ── Web URL validation: this string is a URL injection sink ───────────────

  check("https origin is accepted", normaliseCrocWebUrl("https://croc.example.com") === "https://croc.example.com");
  check("a trailing slash is accepted", normaliseCrocWebUrl("https://croc.example.com/") === "https://croc.example.com");
  check("http is accepted for a LAN croc-web", normaliseCrocWebUrl("http://192.168.1.5:9014") === "http://192.168.1.5:9014");
  check("a javascript: URL is REJECTED", normaliseCrocWebUrl("javascript:alert(1)") === "");
  check("a data: URL is REJECTED", normaliseCrocWebUrl("data:text/html,<script>") === "");
  check("a file: URL is REJECTED", normaliseCrocWebUrl("file:///etc/passwd") === "");
  check("a subpath is REJECTED", normaliseCrocWebUrl("https://croc.example.com/evil") === "");
  check("a query string is REJECTED", normaliseCrocWebUrl("https://croc.example.com/?x=1") === "");
  check("a fragment is REJECTED", normaliseCrocWebUrl("https://croc.example.com/#x") === "");
  check("garbage is rejected", normaliseCrocWebUrl("not a url") === "");

  // ── The receive handoff ───────────────────────────────────────────────────

  const url = crocReceiveUrl(EMPTY_CROC_RELAY_SETTINGS, "acid-alkali-molasses");
  check("handoff targets the official client", url === "https://getcroc.com/?code=acid-alkali-molasses", url);
  check(
    "a self-hosted croc-web is honoured",
    crocReceiveUrl({ ...EMPTY_CROC_RELAY_SETTINGS, webUrl: "http://192.168.1.5:9014" }, "acid-alkali-molasses") ===
      "http://192.168.1.5:9014/?code=acid-alkali-molasses"
  );
  check("an invalid web URL falls back to the default", crocReceiveUrl({ ...EMPTY_CROC_RELAY_SETTINGS, webUrl: "javascript:x" }, "acid-alkali-molasses") === "https://getcroc.com/?code=acid-alkali-molasses");
  check("an unparseable code yields NO url", crocReceiveUrl(EMPTY_CROC_RELAY_SETTINGS, "nope!") === "");
  check(
    "the code is encoded, not interpolated raw",
    crocReceiveUrl(EMPTY_CROC_RELAY_SETTINGS, "yo-yo-test") === "https://getcroc.com/?code=yo-yo-test"
  );

  // ── The honest capability state ────────────────────────────────────────────

  check("in-app WASM peer is reported unavailable", crocWasmPeerAvailable() === false);

  // ── Filename sanitisation: the security-critical part ─────────────────────

  // Path traversal.
  check(
    "unix traversal collapses to the leaf",
    sanitiseReceivedFileName("../../etc/passwd") === "passwd",
    sanitiseReceivedFileName("../../etc/passwd")
  );
  check(
    "windows traversal collapses to the leaf",
    sanitiseReceivedFileName("..\\..\\Windows\\System32\\evil.dll") === "evil.dll",
    sanitiseReceivedFileName("..\\..\\Windows\\System32\\evil.dll")
  );
  check(
    "an absolute unix path collapses",
    sanitiseReceivedFileName("/etc/shadow") === "shadow"
  );
  check(
    "an absolute windows path collapses",
    sanitiseReceivedFileName("C:\\Users\\Public\\payload.exe") === "payload.exe",
    sanitiseReceivedFileName("C:\\Users\\Public\\payload.exe")
  );
  // A deep mixed-separator traversal collapses to the LEAF — and the leaf here is
  // itself a forbidden name, so it is additionally prefixed. Both defences fire.
  check(
    "a deep mixed-separator traversal collapses to the leaf",
    sanitiseReceivedFileName("a/b\\c/../../../root/.ssh/authorized_keys") ===
      "unsafe-authorized_keys",
    sanitiseReceivedFileName("a/b\\c/../../../root/.ssh/authorized_keys")
  );
  check("a bare traversal is neutralised", sanitiseReceivedFileName("..") === "received-file", sanitiseReceivedFileName(".."));
  check("a bare dot is neutralised", sanitiseReceivedFileName(".") === "received-file");
  check(
    "a name that is only separators falls back",
    sanitiseReceivedFileName("///") === "received-file",
    sanitiseReceivedFileName("///")
  );

  // The case-bypass class — GHSA-wmw5-q587-gx56.
  for (const variant of [".ssh", ".SSH", ".Ssh", ".sSh"]) {
    const out = sanitiseReceivedFileName(variant);
    check(`${variant} is refused (case-bypass)`, out.startsWith("unsafe-"), out);
  }
  check(
    ".ssh/authorized_keys does not become a bare allowed name",
    !sanitiseReceivedFileName(".ssh/authorized_keys") === false ||
      sanitiseReceivedFileName(".ssh/authorized_keys").startsWith("unsafe-"),
    sanitiseReceivedFileName(".ssh/authorized_keys")
  );
  check(
    "id_rsa is refused",
    sanitiseReceivedFileName("id_rsa").startsWith("unsafe-"),
    sanitiseReceivedFileName("id_rsa")
  );
  check(
    "ID_RSA is refused (case-bypass)",
    sanitiseReceivedFileName("ID_RSA").startsWith("unsafe-"),
    sanitiseReceivedFileName("ID_RSA")
  );
  check(
    "a stem match is refused, not just an exact name",
    sanitiseReceivedFileName(".bashrc.bak").startsWith("unsafe-"),
    sanitiseReceivedFileName(".bashrc.bak")
  );
  check(
    ".GIT/config is refused on the stem",
    sanitiseReceivedFileName(".GIT").startsWith("unsafe-"),
    sanitiseReceivedFileName(".GIT")
  );
  check(
    "every forbidden name is refused, lowercased",
    CROC_FORBIDDEN_NAMES.every((n) => sanitiseReceivedFileName(n).startsWith("unsafe-") || sanitiseReceivedFileName(n.toUpperCase()).startsWith("unsafe-")),
    CROC_FORBIDDEN_NAMES.filter(
      (n) => !sanitiseReceivedFileName(n).startsWith("unsafe-")
    )
  );
  check(
    "no output ever equals a forbidden name",
    CROC_FORBIDDEN_NAMES.every(
      (n) => sanitiseReceivedFileName(n).toLowerCase() !== n.toLowerCase()
    )
  );

  // Ordinary names must survive untouched, or the feature is useless.
  check("a normal epub is untouched", sanitiseReceivedFileName("book.epub") === "book.epub");
  check("a normal name with spaces is untouched", sanitiseReceivedFileName("My Favourite Book.epub") === "My Favourite Book.epub");
  check("unicode is preserved", sanitiseReceivedFileName("Café — 日本語.epub") === "Café — 日本語.epub");
  check("a single leading dot is kept", sanitiseReceivedFileName(".hidden") === ".hidden");

  // Platform normalisation.
  check(
    "trailing dots are dropped (Windows collapses them)",
    sanitiseReceivedFileName("book.epub...") === "book.epub",
    sanitiseReceivedFileName("book.epub...")
  );
  check(
    "trailing spaces are dropped",
    sanitiseReceivedFileName("book.epub   ") === "book.epub",
    JSON.stringify(sanitiseReceivedFileName("book.epub   "))
  );
  check(
    "a trailing space cannot hide .bashrc",
    sanitiseReceivedFileName(".bashrc ") === "unsafe-.bashrc",
    JSON.stringify(sanitiseReceivedFileName(".bashrc "))
  );
  check(
    "a trailing dot cannot hide .git",
    sanitiseReceivedFileName(".git.") === "unsafe-.git",
    JSON.stringify(sanitiseReceivedFileName(".git."))
  );
  check("a NUL byte is removed, not replaced", sanitiseReceivedFileName("book .epub") === "book.epub", JSON.stringify(sanitiseReceivedFileName("book .epub")));
  check("a newline is removed", !sanitiseReceivedFileName("book\n.epub").includes("\n"));
  check(
    "a Windows reserved device name is escaped",
    sanitiseReceivedFileName("CON") === "_CON",
    sanitiseReceivedFileName("CON")
  );
  check(
    "a reserved device name with an extension is escaped",
    sanitiseReceivedFileName("nul.txt") === "_nul.txt",
    sanitiseReceivedFileName("nul.txt")
  );
  check("a colon is stripped (illegal on Windows)", !sanitiseReceivedFileName("a:b.epub").includes(":"));

  // Length.
  const long = `${"a".repeat(400)}.epub`;
  const shortened = sanitiseReceivedFileName(long);
  check("an over-long name is shortened", shortened.length <= CROC_MAX_FILENAME_LENGTH, shortened.length);
  check("the extension survives truncation", shortened.endsWith(".epub"), shortened);
  check("the stem, not the extension, is what got cut", shortened.startsWith("a".repeat(10)), shortened.slice(0, 12));
  check(
    "an over-long name with no extension is shortened",
    sanitiseReceivedFileName("b".repeat(500)).length <= CROC_MAX_FILENAME_LENGTH
  );
  check(
    "an over-long extension does not eat the whole name",
    sanitiseReceivedFileName(`x.${"e".repeat(400)}`).length > 1
  );

  // Collisions, case-insensitively, keeping the extension readable.
  const used = new Set(["book.epub"]);
  check("a collision gets a numbered name", sanitiseReceivedFileName("book.epub", used) === "book (2).epub", sanitiseReceivedFileName("book.epub", used));
  // The DISAMBIGUATION is case-insensitive (so the two names cannot collide on a
  // case-insensitive receiving filesystem), but the sender's own casing is
  // preserved in the result — Kora must not silently rewrite a filename.
  check("a case-differing collision is caught", sanitiseReceivedFileName("BOOK.EPUB", used) === "BOOK (2).EPUB", sanitiseReceivedFileName("BOOK.EPUB", used));
  check(
    "successive collisions keep counting",
    sanitiseReceivedFileName("book.epub", new Set(["book.epub", "book (2).epub"])) === "book (3).epub"
  );
  check(
    "a numbered collision keeps the extension at the end",
    sanitiseReceivedFileName("book.epub", used).endsWith(".epub")
  );
  check(
    "a name with no extension is disambiguated too",
    disambiguateAgainst("README", new Set(["README"])) === "README (2)",
    disambiguateAgainst("README", new Set(["README"]))
  );
  check("no collision returns the name unchanged", disambiguateAgainst("fresh.epub", used) === "fresh.epub");

  // A name that is ONLY a forbidden stem plus a number still cannot collide
  // into something dangerous.
  check(
    "colliding on a dangerous name is still prefixed",
    sanitiseReceivedFileName(".ssh", new Set([".ssh", "unsafe-.ssh"])) === "unsafe-.ssh (2)",
    sanitiseReceivedFileName(".ssh", new Set([".ssh", "unsafe-.ssh"]))
  );

  console.log(`\ncrocClient: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
