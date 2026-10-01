/**
 * DRM detection — for EPUB and for Kindle.
 *
 * WHAT THIS MODULE DOES, AND THE LINE IT DOES NOT CROSS
 * ----------------------------------------------------
 * It DETECTS DRM and REFUSES. It contains no decryption, no key derivation,
 * no circumvention routine, and no instructions for one. That is a
 * deliberate boundary, not a gap awaiting a patch.
 *
 * The framing matters as much as the code. A reader that "supports DRM
 * books" is promising something it cannot keep; a reader that says "this
 * file is DRM-protected, here's what to do instead" keeps a promise. So the
 * user-visible outcome here is the second kind: name the problem, say the
 * user can convert a book they own with the tools they already have, and
 * stop. Importing such a file into Kora should never produce a screen full
 * of mojibake with no explanation — which is what "no detection at all"
 * means in practice.
 *
 * This protects a library: a book you cannot open is a book you cannot read,
 * and finding out at 2am on a train is worse than knowing at import time.
 *
 * ── WHAT IS DETECTED ───────────────────────────────────────────────────
 *  - EPUB: `META-INF/encryption.xml` (the OCF encryption descriptor), and
 *    `META-INF/rights.xml` (LIDR / Adobe rights management). Either one
 *    means the archive is encrypted and will not yield readable content.
 *  - Kindle: the DRM flag in the MOBI record-0 header (a non-zero
 *    encryption type). See `mobiReader.ts`, which refuses on the same signal.
 */

/** Why a file was refused. Drives the wording of the refusal. */
export type DrmReason = "epub-encryption" | "epub-rights" | "kindle-drm";

export interface DrmDetection {
  drm: boolean;
  /** Present only when `drm` is true. */
  reason?: DrmReason;
  /** User-facing explanation. Never mentions a workaround. */
  message?: string;
}

const NOT_DRM: DrmDetection = { drm: false };

/**
 * The message for every DRM refusal.
 *
 * Deliberately says nothing about how to remove protection, names no tool,
 * and points at a conversion the user can perform themselves on a book they
 * own. That is the whole of the guidance, and it is enough to be useful.
 */
export function drmMessage(reason: DrmReason, formatLabel: string): string {
  switch (reason) {
    case "epub-encryption":
      return (
        `This ${formatLabel} is encrypted (it contains META-INF/encryption.xml), ` +
        "so Kora cannot open it. If you own the book, export a DRM-free copy to " +
        "EPUB or PDF with the tools you already use, then import that."
      );
    case "epub-rights":
      return (
        `This ${formatLabel} has digital-rights management (META-INF/rights.xml), ` +
        "so Kora cannot open it. If you own the book, export a DRM-free copy to " +
        "EPUB or PDF with the tools you already use, then import that."
      );
    case "kindle-drm":
      return (
        `This ${formatLabel} is DRM-protected, so Kora cannot open it. ` +
        "If you own the book, convert or export a DRM-free copy to EPUB or PDF " +
        "with the tools you already use, then import that."
      );
    default:
      return `This ${formatLabel} is protected and cannot be opened.`;
  }
}

/**
 * Detect DRM in an EPUB, given its ZIP entry NAMES.
 *
 * Takes names rather than bytes on purpose. The caller has already listed the
 * archive to read it, so this needs no extra I/O, and the signal is in the
 * presence of a well-known member name — not in decrypting anything. Case is
 * normalised because the ZIP spec does not require a consistent case and
 * real-world EPUBs are inconsistent.
 *
 * An `encryption.xml` describing *font obfuscation* only is arguably not DRM
 * — it is how some publishers hide fonts. Treating it as DRM would refuse
 * readable books, so the content is inspected far enough to tell the two
 * apart: obfuscated-font EPUBs encrypt only font files, and the user can read
 * the text.
 */
export function detectEpubDrm(entryNames: readonly string[]): DrmDetection {
  const names = entryNames.map((n) => n.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase());

  const encryptionEntry = names.find((n) => n === "meta-inf/encryption.xml");
  if (encryptionEntry) {
    return { drm: true, reason: "epub-encryption", message: drmMessage("epub-encryption", "EPUB") };
  }
  const rightsEntry = names.find((n) => n === "meta-inf/rights.xml");
  if (rightsEntry) {
    return { drm: true, reason: "epub-rights", message: drmMessage("epub-rights", "EPUB") };
  }
  return NOT_DRM;
}

/**
 * Distinguish font obfuscation from real content encryption.
 *
 * The W3C EPUB encryption descriptor marks obfuscated fonts with
 * `id="..."` entries whose algorithm URI is the IDPF font obfuscation
 * scheme, and everything else is genuine content encryption. An EPUB whose
 * only encrypted resources are fonts is readable, so refusing it would be a
 * fake limitation.
 *
 * Kept separate from {@link detectEpubDrm} so the decision stays explicit and
 * testable rather than being a guess buried in a name check.
 *
 * @param encryptionXml the raw bytes of META-INF/encryption.xml
 */
export function isFontObfuscationOnly(encryptionXml: string): boolean {
  const encrypted = encryptionXml.match(/<enc:EncryptedData\b/gi);
  if (!encrypted || encrypted.length === 0) return false;
  // Every CipherReference URI must point at a font resource.
  const uris = encryptionXml.match(/<enc:CipherReference\b[^>]*URI="([^"]*)"/gi) ?? [];
  if (uris.length === 0) return false;
  return uris.every((u) => /\.otf\b|\.ttf\b|\.woff\b|\.woff2\b/i.test(u));
}

/**
 * Detection result for a Kindle file, given the MOBI record-0 header bytes.
 *
 * The flag is a big-endian u32 at offset 12 of record 0. Exposed separately
 * from the reader so the library list can grey out a book before the user
 * opens it, and so the signal is testable on its own.
 */
export function detectKindleDrm(record0: Uint8Array): DrmDetection {
  if (record0.length < 16) return NOT_DRM;
  const encryptionType =
    ((record0[12] << 24) >>> 0) + (record0[13] << 16) + (record0[14] << 8) + record0[15];
  if (encryptionType !== 0) {
    return { drm: true, reason: "kindle-drm", message: drmMessage("kindle-drm", "Kindle book") };
  }
  return NOT_DRM;
}

/** Plain-language one-liner for a UI banner. */
export function drmSummary(detection: DrmDetection): string {
  return detection.drm ? (detection.message ?? "This file is protected and cannot be opened.") : "";
}