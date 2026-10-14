/**
 * The one place a mirror download is judged and its outcome recorded.
 *
 * Every download path in Kora — the foreground loop in App.tsx, the
 * service-worker background download, and DiscoverView's auto-download and
 * single-mirror taps — funnels through `judgeMirrorDownload`. That is
 * deliberate: the reliability percentage is only meaningful if every attempt
 * lands in the same tally, and it was only meaningless before because the
 * paths disagreed about whether to report at all.
 *
 * The definition of the recorded percentage lives in mirrorReliability.ts and
 * is quoted here so the two files cannot drift:
 *
 *   percent = validated real books / all counted attempts * 100
 *
 * A wrong-book delivery is a FAILURE, not a success and not a shrug.
 */

import { verifyDownloadedBook } from "./bookIdentity";
import { recordMirrorOutcome, type MirrorVerdict } from "./mirrorReliability";
import { reportMirrorOutcome } from "./mirrorHealthClient";

export interface JudgeInput {
  /** The mirror URL the bytes came from. */
  mirrorUrl: string;
  /** What actually arrived, or null when the transfer itself failed. */
  bytes: Uint8Array | null;
  /** The title the user asked for. Drives the identity check. */
  requestedTitle?: string | null;
  claimedExtension?: string | null;
  /** Set when the fetch failed before any bytes were validated. */
  transportFailure?: "unreachable" | "rate-limited" | "interrupted" | "empty" | null;
  /** Set when the caller already knows the content-type was text/html. */
  sawHtmlContentType?: boolean;
}

export interface JudgeResult {
  /** The verdict fed into the local tally. */
  verdict: MirrorVerdict;
  /** True only for a validated, correctly-identified book. */
  ok: boolean;
  /** True when the file is a real book of the WRONG title. */
  mismatched: boolean;
  /** Safe to show the user. */
  detail: string;
  deliveredTitle: string;
}

/**
 * Judge delivered bytes and record the attempt against the host.
 *
 * Returns the verdict so the caller can decide whether to keep the file. A
 * `mismatched` result must NOT be saved: serving the wrong book is worse than
 * failing to download.
 */
export async function judgeMirrorDownload(input: JudgeInput): Promise<JudgeResult> {
  const { mirrorUrl, bytes, requestedTitle, claimedExtension } = input;

  const record = (verdict: MirrorVerdict, detail: string, extra?: {
    mismatched?: boolean;
    deliveredTitle?: string;
  }): JudgeResult => {
    recordMirrorOutcome(
      mirrorUrl,
      verdict,
      extra?.mismatched
        ? { requested: requestedTitle || "", delivered: extra.deliveredTitle || "" }
        : null
    );
    // Also tell the Worker, which powers aggregate probing and the RANKING
    // weights. Best-effort: never let reporting break a download.
    //
    // A wrong book is reported upstream as "corrupt" because that is the
    // closest verdict the server's vocabulary has; the WRONGNESS is preserved
    // in the local ledger, which is what the sheet orders and labels by.
    const serverVerdict = extra?.mismatched
      ? "corrupt"
      : verdict === "real-book"
        ? "real-book"
        : (["html-page", "php-error", "corrupt", "too-small", "empty", "unreachable", "rate-limited", "interrupted"] as const).find(
            (v) => v === verdict
          ) ?? "corrupt";
    reportMirrorOutcome(mirrorUrl, serverVerdict);
    return {
      verdict,
      ok: verdict === "real-book",
      mismatched: !!extra?.mismatched,
      detail,
      deliveredTitle: extra?.deliveredTitle || "",
    };
  };

  if (input.transportFailure) {
    return record(input.transportFailure, `The mirror could not be reached (${input.transportFailure}).`);
  }

  if (input.sawHtmlContentType) {
    return record("html-page", "The mirror returned a web page instead of a book file.");
  }

  if (!bytes || bytes.length === 0) {
    return record("empty", "The mirror returned zero bytes.");
  }

  const identity = await verifyDownloadedBook(bytes, requestedTitle, claimedExtension);

  if (identity.verdict === "not-a-book") {
    return record("html-page", identity.detail);
  }
  if (identity.verdict === "mismatch") {
    return record("identity-mismatch", identity.detail, {
      mismatched: true,
      deliveredTitle: identity.deliveredTitle,
    });
  }
  if (identity.verdict === "unverifiable") {
    // A real book whose title we cannot read. That is a usable file, so it
    // counts as a success, but we say plainly that it was not identity-checked
    // rather than implying we verified it.
    return record("real-book", identity.detail, { deliveredTitle: identity.deliveredTitle });
  }
  return record("real-book", identity.detail, { deliveredTitle: identity.deliveredTitle });
}
