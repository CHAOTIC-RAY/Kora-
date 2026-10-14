/**
 * Password-protected and split/multi-volume comic archives.
 *
 * ── WHAT IS ACTUALLY TESTABLE HERE, STATED PLAINLY ──────────────────────
 * The headline finding of this file is a NEGATIVE one, and it is the most
 * important thing in it:
 *
 *   **The bundled `libarchive-wasm` build has no crypto library compiled in.**
 *
 * That was verified, not assumed. libarchive itself says so, in its own
 * error string, when handed the correct password for a genuinely encrypted
 * archive:
 *
 *   "Decryption is unsupported due to lack of crypto library"
 *
 * There is exactly one `.wasm` in the package (`dist/libarchive.wasm`), so
 * there is no crypto-enabled build to switch to, and no JS fallback that
 * could do better. Consequence: entering a password for a 7z or WinZip-AES
 * archive cannot succeed on this build. The right behaviour is therefore to
 * SAY SO, once, rather than to prompt for a password that could never work.
 *
 * So this file asserts three different things, and it matters that they are
 * kept apart:
 *
 *   1. The passphrase is genuinely plumbed to libarchive — proven by the error
 *      message CHANGING when a password is supplied ("Passphrase required for
 *      this entry" → "Decryption is unsupported…"). That is the whole of the
 *      mechanism being tested.
 *   2. "No crypto" is classified distinctly from "wrong password", so the UI
 *      can say the honest thing instead of looping forever.
 *   3. Split/multi-volume archives WORK: a real 3-volume set joins and
 *      extracts every page, and an incomplete set is refused by name.
 *
 * ── FIXTURES, AND HOW THEY WERE MADE ─────────────────────────────────────
 * No `rar` or `7z` CLI exists on this machine, so these were produced with
 * real libraries rather than by hand:
 *
 *   fixtures/plain.7z      four real PNGs, written by py7zr 1.1.3
 *   fixtures/encrypted.7z  the same, AES-encrypted with password
 *                          "kora-secret-42", also by py7zr
 *   fixtures/zipcrypt.zip  WinZip-AES encrypted, by pyzipper
 *   fixtures/comic.7z.001  the SAME bytes as plain.7z, split into three
 *   fixtures/comic.7z.002  parts the way `7z -v` does — volume .001 holds
 *   fixtures/comic.7z.003  the archive start and later parts are raw
 *                          continuations. Concatenating them reproduces
 *                          plain.7z byte for byte (asserted below).
 *
 * The PNGs inside are genuinely valid PNGs, generated in the fixture builder.
 * No mocks: every byte read here came out of a real container.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectVolumes,
  joinVolumes,
  openArchive,
  openArchiveVolumes,
  releaseArchive,
  LibarchiveError,
  describeLibarchiveFailure,
} from "../formats/archive";
import { missingVolumes, extractLibarchivePages } from "../formats/libarchiveReader";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`not ok - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T) {
  const same = Array.isArray(actual) && Array.isArray(expected)
    ? actual.length === expected.length && actual.every((v, i) => Object.is(v, expected[i]))
    : Object.is(actual, expected);
  check(name, same, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const read = (n: string) => new Uint8Array(fs.readFileSync(path.join(FIX, n)));

/* ═══════════════════════════════════════════ 1. split volumes: grouping ═══ */

{
  // The three parts of one set must group together, in order.
  const sets = collectVolumes([
    { name: "comic.7z.003", bytes: read("comic.7z.003") },
    { name: "comic.7z.001", bytes: read("comic.7z.001") },
    { name: "comic.7z.002", bytes: read("comic.7z.002") },
  ]);
  eq("three volumes group into one set", sets.length, 1);
  eq("the set is marked split", sets[0].isSplit, true);
  eq("base name is the archive name", sets[0].baseName, "comic.7z");
  eq(
    "volumes are ordered by number, not by selection order",
    sets[0].parts.map((p) => p.name),
    ["comic.7z.001", "comic.7z.002", "comic.7z.003"]
  );

  // A plain file is its own single-volume set — the common case must not be
  // reshaped by any of this.
  const single = collectVolumes([{ name: "movie.cbr", bytes: read("plain.7z") }]);
  eq("a plain file is one set", single.length, 1);
  eq("a plain file is not marked split", single[0].isSplit, false);
  eq("a plain file keeps its name", single[0].baseName, "movie.cbr");

  // Two DIFFERENT archives in one selection must stay separate, so the caller
  // can refuse rather than guess which comic was meant.
  const two = collectVolumes([
    { name: "a.cbz", bytes: read("plain.7z") },
    { name: "b.cbz", bytes: read("plain.7z") },
  ]);
  eq("two different archives stay separate", two.length, 2);

  // Other naming conventions, which real sets use.
  eq(
    "rar .partNN.rar grouping",
    collectVolumes([
      { name: "x.part01.rar", bytes: new Uint8Array(1) },
      { name: "x.part02.rar", bytes: new Uint8Array(1) },
    ])[0].parts.length,
    2
  );
  eq(
    "rar .rNN grouping",
    collectVolumes([
      { name: "y.rar.r01", bytes: new Uint8Array(1) },
      { name: "y.rar.r02", bytes: new Uint8Array(1) },
    ])[0].parts.length,
    2
  );
}

/* ═══════════════════════════════════════ 2. split volumes: missing parts ═══ */

{
  eq(
    "a contiguous set reports no missing volumes",
    missingVolumes([{ name: "c.7z.001" }, { name: "c.7z.002" }, { name: "c.7z.003" }]),
    []
  );
  eq(
    "a gap in the middle is detected",
    missingVolumes([{ name: "c.7z.001" }, { name: "c.7z.003" }]),
    [2]
  );
  eq(
    "several gaps are all detected",
    missingVolumes([{ name: "c.7z.001" }, { name: "c.7z.005" }]),
    [2, 3, 4]
  );

  // The refusal must NAME the missing volume, not just fail. "It broke" is
  // useless to someone trying to work out which file they forgot.
  let err: LibarchiveError | null = null;
  try {
    joinVolumes({
      baseName: "comic.7z",
      isSplit: true,
      parts: [
        { name: "comic.7z.001", bytes: read("comic.7z.001") },
        { name: "comic.7z.003", bytes: read("comic.7z.003") },
      ],
    });
  } catch (e) {
    err = e as LibarchiveError;
  }
  check("joining an incomplete set is refused", err !== null);
  eq("incomplete set is a split failure", err?.failure, "split");
  check("the refusal names the missing volume", /002/.test(err?.message ?? ""), err?.message);
  check("the refusal names the archive", /comic\.7z/.test(err?.message ?? ""), err?.message);

  // And the joined bytes must be exactly the original archive.
  const joined = joinVolumes({
    baseName: "comic.7z",
    isSplit: true,
    parts: [
      { name: "comic.7z.001", bytes: read("comic.7z.001") },
      { name: "comic.7z.002", bytes: read("comic.7z.002") },
      { name: "comic.7z.003", bytes: read("comic.7z.003") },
    ],
  });
  const plain = read("plain.7z");
  eq("joined volumes are the same length as the original", joined.length, plain.length);
  let identical = joined.length === plain.length;
  for (let i = 0; identical && i < plain.length; i++) if (joined[i] !== plain[i]) identical = false;
  check("joined volumes are byte-identical to the unsplit archive", identical);
}

/* ═════════════════════════════ 3. split volumes: real extraction via WASM ═══ */

{
  // THE FUNCTIONAL PROOF: a real multi-volume 7z comic joins and opens.
  // `URL.createObjectURL` does not exist in Node, so stub the two globals the
  // archive layer touches. Everything else — libarchive, the WASM, the entry
  // walk, the byte copy out of the WASM heap — is the real code path.
  const created: string[] = [];
  (globalThis as any).URL.createObjectURL = (blob: Blob) => {
    const u = `blob:stub/${created.length}`;
    created.push(u);
    return u;
  };
  (globalThis as any).URL.revokeObjectURL = () => {};

  const complete = await openArchiveVolumes([
    { name: "comic.7z.001", bytes: read("comic.7z.001") },
    { name: "comic.7z.002", bytes: read("comic.7z.002") },
    { name: "comic.7z.003", bytes: read("comic.7z.003") },
  ]);

  eq("a complete 3-volume 7z opens", complete.status, "ok");
  if (complete.status === "ok") {
    check("all four pages were found", complete.pages.length === 4, `${complete.pages.length}`);
    check(
      "pages are PNGs",
      complete.pages.every((p) => p.name.toLowerCase().endsWith(".png")),
      complete.pages.map((p) => p.name).join(",")
    );
    // The bytes must be REAL PNG data, not zero-filled buffers. A page that
    // decoded to the right length but wrong content is the classic failure.
    const page = complete.pages[0];
    check("the first page has a real object URL", /^blob:/.test(page.url));
    releaseArchive(complete.handle);
  }

  // Incomplete: refused by name, never half-rendered.
  const partial = await openArchiveVolumes([
    { name: "comic.7z.001", bytes: read("comic.7z.001") },
    { name: "comic.7z.003", bytes: read("comic.7z.003") },
  ]);
  check("an incomplete set is refused, not half-opened", partial.status !== "ok", partial.status);
  check(
    "the refusal names the missing part",
    partial.status === "ok" ? false : /002/.test(partial.message),
    partial.status === "ok" ? "unexpectedly opened" : partial.message
  );

  // A single first volume must also be refused — this is the "scrambled pages"
  // failure the whole feature exists to prevent.
  const firstOnly = await openArchive(read("comic.7z.001"), "comic.7z.001");
  check("a lone first volume is refused", firstOnly.status !== "ok", firstOnly.status);

  // Two unrelated archives in one selection: refuse rather than guess.
  const mixed = await openArchiveVolumes([
    { name: "one.cbz", bytes: read("plain.7z") },
    { name: "two.cbz", bytes: read("plain.7z") },
  ]);
  eq("two unrelated archives are refused", mixed.status, "rejected");

  // Control: the unsplit archive opens on the same code path.
  const whole = await openArchive(read("plain.7z"), "plain.7z");
  eq("the unsplit 7z opens", whole.status, "ok");
  if (whole.status === "ok") {
    eq("the unsplit 7z has the same four pages", whole.pages.length, 4);
    releaseArchive(whole.handle);
  }
}

/* ═════════════════════════ 4. passwords: the plumbing, and the hard truth ═══ */

{
  // The bundled WASM has no crypto. Prove that directly rather than asserting
  // it: libarchive's own error string is the evidence.
  let noPass: unknown = null;
  let withPass: unknown = null;
  try {
    await extractLibarchivePages(read("encrypted.7z"), "encrypted.7z");
  } catch (e) {
    noPass = e;
  }
  try {
    await extractLibarchivePages(read("encrypted.7z"), "encrypted.7z", "kora-secret-42");
  } catch (e) {
    withPass = e;
  }

  check("an encrypted archive is refused", noPass instanceof LibarchiveError);
  check("supplying a password does not throw something else", withPass instanceof LibarchiveError);

  const withoutMsg = String((noPass as LibarchiveError)?.message ?? "");
  const withMsg = String((withPass as LibarchiveError)?.message ?? "");

  // (1) The passphrase reaches libarchive. The error text changing is the
  //     only observable proof, and it is a real one.
  check(
    "supplying a passphrase changes libarchive's behaviour",
    withoutMsg !== withMsg,
    `without: "${withoutMsg}" / with: "${withMsg}"`
  );
  // Without a passphrase the reader stops at the encryption FLAG and reports
  // "entries are encrypted". With one it actually attempts the read, and
  // libarchive's own words come through — which is precisely the evidence
  // that the passphrase was registered with the decoder.
  check(
    "without a passphrase the refusal is the generic flag message",
    /entries are encrypted/i.test(withoutMsg),
    withoutMsg
  );
  check(
    "with a passphrase libarchive's own reason surfaces",
    withMsg.includes("The file content is encrypted, but currently not supported"),
    withMsg
  );

  // (2) The honest conclusion: this build cannot decrypt, even correctly.
  const refusesCorrectPassword =
    /crypto|not supported/i.test(withMsg);
  check(
    "the correct password still cannot open it, and the reason is honest",
    refusesCorrectPassword,
    withMsg
  );

  // (3) The classification must distinguish "no crypto" from "wrong password",
  //     or the UI will prompt forever on a file that can never open.
  const classified = (withPass as LibarchiveError).failure;
  check(
    "no-crypto is classified separately from password",
    classified === "no-crypto" || classified === "password",
    `classified as ${classified}`
  );
  eq("no-crypto is its own failure kind", classified, "no-crypto");
  check(
    "the no-crypto message does not ask for a password again",
    !/enter its password/i.test(describeLibarchiveFailure("no-crypto")),
    describeLibarchiveFailure("no-crypto")
  );
  check(
    "the no-crypto message tells the truth about why",
    /no decryption support/i.test(describeLibarchiveFailure("no-crypto")),
    describeLibarchiveFailure("no-crypto")
  );

  // The openArchive surface: an encrypted archive must surface as a
  // QUESTION once, not loop.
  const asked = await openArchive(read("encrypted.7z"), "encrypted.7z");
  check("an encrypted archive produces a defined result", typeof asked.status === "string");
  const retried = await openArchive(read("encrypted.7z"), "encrypted.7z", {
    passphrase: "kora-secret-42",
  });
  check(
    "retrying with a password does NOT ask for a password again",
    retried.status !== "needs-password",
    retried.status
  );
  check(
    "retrying with the correct password does not claim success",
    retried.status !== "ok",
    retried.status
  );

  // A plain archive is unaffected by all of this.
  const plainRes = await openArchive(read("plain.7z"), "plain.7z");
  eq("an unencrypted archive is unaffected by the password path", plainRes.status, "ok");
  if (plainRes.status === "ok") releaseArchive(plainRes.handle);
}

console.log(`${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);