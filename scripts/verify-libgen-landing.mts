/**
 * Two fixes, one class of bug: a LibGen landing page must never be offered as a
 * "Direct Download", and must never be waited on.
 *
 *  1. isLibgenLandingPage() — distinguishes `ads.php?md5=` (ad page, 200 with
 *     ~20KB of text/html) from `get.php?md5=…&key=…` (real file, 307 to CDN).
 *     Rave returns the former shape; it was being marked isDirect.
 *  2. looksLikeHtmlPage() — the client-side first-chunk sniff that turns the
 *     ~103s stall into an immediate failure so the mirror ladder advances.
 *
 * Real 2026-10-03 values are used as fixtures.
 */
import { isLibgenLandingPage } from "../src/lib/libgenSigned";

// ── 1. landing page detection ──
let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

const ADS = "https://libgen.la/ads.php?md5=649CBEEEC91055459C251E1D0AC65440";
const SIGNED =
  "https://libgen.li/get.php?md5=649CBEEEC91055459C251E1D0AC65440&key=JHUZHJRLTH2RPMJT";
const BARE = "https://libgen.li/get.php?md5=649CBEEEC91055459C251E1D0AC65440";
const WRAPPED =
  "/api/proxy-file?url=" + encodeURIComponent(ADS);

check("ads.php is a landing page", isLibgenLandingPage(ADS));
check("bare get.php?md5 (no key) is a landing page", isLibgenLandingPage(BARE));
check("proxy-wrapped ads.php still detected", isLibgenLandingPage(WRAPPED), "decoded");
check("SIGNED get.php is NOT a landing page", !isLibgenLandingPage(SIGNED));
check("null is not a landing page", !isLibgenLandingPage(null));
check(
  "non-libgen URL is not a landing page",
  !isLibgenLandingPage("https://archive.org/download/x/x.epub")
);

// ── 2. first-chunk sniff (mirrors App.tsx) ──
function looksLikeHtmlPage(chunk: Uint8Array, contentType?: string | null): boolean {
  if (contentType && /text\/html|application\/xhtml/i.test(contentType)) return true;
  const b = (i: number) => (i < chunk.length ? chunk[i] : 0);
  if (b(0) === 0x50 && b(1) === 0x4b) return false;
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44) return false;
  if (b(0) === 0x7b && b(1) === 0x5c) return false;
  if (b(0) === 0x37 && b(1) === 0x7a && b(2) === 0xbc) return false;
  if (b(0) === 0x52 && b(1) === 0x61 && b(2) === 0x72) return false;
  const n = Math.min(chunk.length, 512);
  let head = "";
  for (let i = 0; i < n; i++) head += String.fromCharCode(chunk[i]);
  head = head.trimStart().toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<?xml") ||
    head.startsWith("<!--") ||
    /<head|<body|<title|<meta\s/i.test(head)
  );
}

const enc = (s: string) => new TextEncoder().encode(s);
// The exact first bytes of the real ad page fetched during this session.
const AD_PAGE = enc(
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n<html xmlns="http://www.w3.org/1999/xhtml">'
);

console.log("");
check("real ad page is caught by bytes", looksLikeHtmlPage(AD_PAGE));
check("real ad page caught by content-type", looksLikeHtmlPage(enc("binaryish"), "text/html; charset=UTF-8"));
check("EPUB (PK\\x03\\x04) passes", !looksLikeHtmlPage(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x0a])));
check("PDF (%PDF) passes", !looksLikeHtmlPage(enc("%PDF-1.7\n...")));
check("Rar passes", !looksLikeHtmlPage(new Uint8Array([0x52, 0x61, 0x72, 0x21])));
check("7z passes", !looksLikeHtmlPage(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])));
check("binary blob passes", !looksLikeHtmlPage(new Uint8Array([0x00, 0xff, 0x10, 0x42])));
check("bare <html> caught", looksLikeHtmlPage(enc("<html><head></head></html>")));
check("XHTML prefix caught", looksLikeHtmlPage(enc("<?xml version='1.0'?><html>")));
check("empty chunk is not HTML", !looksLikeHtmlPage(new Uint8Array(0)));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);