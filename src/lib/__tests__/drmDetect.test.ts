/**
 * DRM detection — EPUB and Kindle.
 *
 * THE THING UNDER TEST IS THE DETECTION, NOT ANY WORKAROUND
 * -------------------------------------------------------
 * There is deliberately no decryption here and none is planned. What these
 * tests prove is that Kora recognises a protected file, refuses it with a
 * sentence that helps, and never mangles it into something that looks like a
 * reader bug. Several assertions below are specifically about NOT saying
 * things: no tool names, no "how to remove", no promise that it can be opened.
 *
 * ── FIXTURES ───────────────────────────────────────────────────────────
 *   fixtures/drm.epub    a REAL zip written with Python's `zipfile`, containing
 *                        a genuine META-INF/encryption.xml (OCF encryption
 *                        descriptor naming the IDPF embedded-font obfuscation
 *                        algorithm) plus a normal OPF/XHTML structure.
 *   fixtures/clean.epub  the same book WITHOUT the encryption descriptor, as a
 *                        control. It must not be flagged.
 *
 * Both are real EPUB-shaped archives. Neither is a hand-rolled blob: `zipfile`
 * wrote them, and the entry names below are the ones actually present on disk.
 *
 * The Kindle side uses the two real Gutenberg MOBI files, with the DRM flag
 * set at the documented offset — see `mobiReader.test.ts`, which covers the
 * same refusal from the reader's side.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectEpubDrm,
  detectKindleDrm,
  drmMessage,
  drmSummary,
  isFontObfuscationOnly,
} from "../formats/drm";

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

/** Read the real ZIP central directory, so entry names come from the file. */
function zipEntryNames(file: string): string[] {
  const buf = fs.readFileSync(path.join(FIX, file));
  // Locate the End Of Central Directory record, then walk backwards for the
  // central directory. This is the file's own index, not a hardcoded list.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${file}: no end-of-central-directory record`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + nameLen).toString("utf-8"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/* ══════════════════════════════════════════════════ 1. the real fixtures ═══ */

const drmNames = zipEntryNames("drm.epub");
const cleanNames = zipEntryNames("clean.epub");

{
  // Confirm we are really testing what the file says it contains. If the
  // fixture changed, these fail loudly instead of the assertions below quietly
  // testing nothing.
  check("drm.epub really contains META-INF/encryption.xml", drmNames.includes("META-INF/encryption.xml"), drmNames.join(", "));
  check("drm.epub is a real EPUB with content", drmNames.includes("OEBPS/chapter1.xhtml"));
  check("clean.epub really has no encryption descriptor", !cleanNames.includes("META-INF/encryption.xml"), cleanNames.join(", "));
  check("clean.epub still has content", cleanNames.includes("OEBPS/chapter1.xhtml"));
}

{
  const drm = detectEpubDrm(drmNames);
  check("an encrypted EPUB is detected", drm.drm);
  eq("the reason is the encryption descriptor", drm.reason, "epub-encryption");
  check("a message is provided", typeof drm.message === "string" && drm.message.length > 0);

  const clean = detectEpubDrm(cleanNames);
  check("a normal EPUB is NOT flagged", !clean.drm);
  check("a normal EPUB has no message", clean.message === undefined);
  eq("drmSummary is empty for a clean EPUB", drmSummary(clean), "");
}

/* ═══════════════════════════════════════ 2. the message says the right thing ═══ */

{
  for (const reason of ["epub-encryption", "epub-rights", "kindle-drm"] as const) {
    const msg = drmMessage(reason, "EPUB");

    // Helpful: names the problem and points at a conversion the user can do.
    check(`${reason}: names the protection`, /protected|encrypted|rights/i.test(msg), msg);
    check(`${reason}: suggests a DRM-free export`, /export|convert/i.test(msg), msg);
    check(`${reason}: names a format Kora can open`, /EPUB|PDF/i.test(msg), msg);

    // The restraint checks. These are the assertions that matter most: a
    // refusal that grows into a workaround notice is how a reader ends up
    // shipping circumvention instructions.
    check(`${reason}: names no tool`, !/calibre|deDRM|kindleunpack|obok|plugin/i.test(msg), msg);
    check(`${reason}: gives no removal instructions`, !/how to (remove|strip|decrypt)/i.test(msg), msg);
    check(`${reason}: promises no workaround`, !/workaround|bypass|we can (open|decrypt)/i.test(msg), msg);
    check(`${reason}: claims nothing about cracking it`, !/crack|keygen|unlock/i.test(msg), msg);
  }

  // The Kindle refusal must tell the user their own purchase is not wasted.
  const kindle = drmMessage("kindle-drm", "Kindle book");
  check("the Kindle refusal reassures about ownership", /if you own/i.test(kindle), kindle);
}

/* ═══════════════════════════════════════ 3. rights.xml, case, edge cases ═══ */

{
  eq("rights.xml is detected", detectEpubDrm(["META-INF/rights.xml"]).reason, "epub-rights");

  // Real EPUBs are inconsistent about case; the ZIP spec does not require a
  // canonical form, so a case-sensitive check would miss real files.
  eq(
    "detection is case-insensitive",
    detectEpubDrm(["meta-inf/ENCRYPTION.XML"]).reason,
    "epub-encryption"
  );

  // A leading slash or backslash must not hide the descriptor.
  eq("a leading slash does not hide it", detectEpubDrm(["/META-INF/encryption.xml"]).reason, "epub-encryption");
  eq("backslashes do not hide it", detectEpubDrm(["META-INF\\encryption.xml"]).reason, "epub-encryption");

  // Must not fire on things that merely look similar.
  eq("a non-META-INF path does not fire", detectEpubDrm(["OEBPS/encryption.xml"]).drm, false);
  eq("an unrelated name does not fire", detectEpubDrm(["encryption.xml"]).drm, false);
  eq("a cover image does not fire", detectEpubDrm(["OEBPS/cover.png"]).drm, false);
  eq("an empty list does not fire", detectEpubDrm([]).drm, false);
}

/* ═══════════════════════════════════ 4. font obfuscation is not DRM ═══ */

{
  // Some publishers obfuscate FONTS with the IDPF scheme and nothing else.
  // The text is readable, so refusing the book would be a fake limitation.
  const fontsOnly = `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
            xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://ns.adobe.com/pdf/enc#RC"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/fonts/Brand.otf"/></enc:CipherData>
  </enc:EncryptedData>
  <enc:EncryptedData>
    <enc:CipherData><enc:CipherReference URI="OEBPS/fonts/Body.ttf"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`;
  check("a fonts-only descriptor is recognised", isFontObfuscationOnly(fontsOnly));

  // Content encryption is different and must NOT be mistaken for fonts.
  const contentEnc = fontsOnly.replace(/OEBPS\/fonts\/Brand\.otf/, "OEBPS/chapter1.xhtml");
  check("content encryption is not mistaken for fonts", !isFontObfuscationOnly(contentEnc));

  check("an empty descriptor is not fonts-only", !isFontObfuscationOnly(""));
  check("a descriptor with no references is not fonts-only", !isFontObfuscationOnly("<encryption/>"));
}

/* ═══════════════════════════════════════════════ 5. the Kindle DRM flag ═══ */

{
  // The flag is a big-endian u32 at offset 12 of MOBI record 0. Built from the
  // real pg1661 header with only that field changed.
  const real = new Uint8Array(fs.readFileSync(path.join(FIX, "pg1661.mobi")));
  const numRecords = (real[76] << 8) | real[77];
  const rec0 = (real[78] << 24) | (real[79] << 16) | (real[80] << 8) | real[81];
  check("the fixture has a sane record count", numRecords > 1, `${numRecords}`);

  const clean = detectKindleDrm(real.subarray(rec0, rec0 + 32));
  check("a real, unmodified MOBI is not flagged as DRM", !clean.drm);

  const drmmed = new Uint8Array(real.subarray(rec0, rec0 + 32));
  drmmed[12] = 0x00;
  drmmed[13] = 0x00;
  drmmed[14] = 0x01; // encryption type 1 = legacy MobiPocket DRM
  drmmed[15] = 0x00;
  const flagged = detectKindleDrm(drmmed);
  check("a set DRM flag is detected", flagged.drm);
  eq("the Kindle reason is named", flagged.reason, "kindle-drm");

  const azw = new Uint8Array(drmmed);
  azw[15] = 0x02; // the other DRM encryption type
  check("the second DRM type is detected too", detectKindleDrm(azw).drm);

  // A truncated header must not read past its own bounds.
  check("a short header does not flag", !detectKindleDrm(new Uint8Array(4)).drm);
  check("an empty header does not flag", !detectKindleDrm(new Uint8Array(0)).drm);
}

console.log(`${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);