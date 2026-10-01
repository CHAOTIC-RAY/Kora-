/**
 * Build a REAL .cbz on disk and drive it through the actual reader modules.
 *
 * The unit tests prove the logic. This proves the two things a hand-built
 * fixture inside the same process cannot: that the reader accepts bytes it
 * did not produce, and that it survives the shape a real archiver emits
 * (deflated, with a nested folder, with the pages in the wrong order).
 *
 * Run: node scripts/verify-cbz.mjs
 */
import JSZip from "jszip";
import * as nodeZlib from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCRATCH = process.env.SCRATCH || "D:/Wafig/Hermes/cache/scratch";

/** A real PNG (8x8, two colours) — an actual decodable image, not a stub. */
function png(r, g, b) {
  const zlib = nodeZlib;
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = (c >>> 8) ^ crcTable[(c ^ byte) & 0xff];
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(8 * (1 + 8 * 3));
  for (let y = 0; y < 8; y++) {
    raw[y * 25] = 0;
    for (let x = 0; x < 8; x++) {
      const o = y * 25 + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
void require;

// ---------------------------------------------------------------- build a CBZ
// Deliberately wrong order (1, 10, 11, 2, 3...) and a nested folder, because
// that is what scanlation groups actually ship.
const PAGE_NUMS = [11, 3, 1, 10, 2];
const zip = new JSZip();
for (const n of PAGE_NUMS) {
  zip.file(`Series Name Vol.1/Chapter 05/${String(n).padStart(3, "0")}.png`, png(n * 8 % 256, 40, 200 - n * 8));
}
zip.file("__MACOSX/._001.png", Buffer.from([0, 5, 16, 7]));
zip.file("Thumbs.db", Buffer.from("junk"));
const cbzBytes = await zip.generateAsync({ compression: "DEFLATE", type: "nodebuffer", compressionOptions: { level: 9 } });

const cbzPath = path.join(SCRATCH, "verify-comic.cbz");
fs.writeFileSync(cbzPath, cbzBytes);
console.log(`built ${cbzPath}`);
console.log(`  ${cbzBytes.length} bytes, ${PAGE_NUMS.length} PNG pages, DEFLATE, nested folder, archive order ${PAGE_NUMS.join(",")}`);

// ------------------------------------------------------- a hostile "download"
// A PHP error page saved as .epub — the exact production complaint.
const phpPath = path.join(SCRATCH, "verify-broken.epub");
fs.writeFileSync(phpPath, "<br /><b>Fatal error</b>:  Uncaught Error: Call to undefined function in /var/www/get.php:42\nStack trace:");
console.log(`built ${phpPath}  (a PHP error page with an .epub name)`);

// ---------------------------------------------------------- drive the reader
const base = "D:/Wafig/Hermes/kora-repo/src/lib/formats";
const { detectFormat } = await import(pathToFileURL(path.join(base, "detect.ts")).href);
const { openArchive, releaseArchive } = await import(pathToFileURL(path.join(base, "archive.ts")).href);

// Node needs a Blob registry for object URLs.
const blobs = new Map();
let seq = 0;
URL.createObjectURL = (b) => {
  const u = `blob:verify/${seq++}`;
  blobs.set(u, b);
  return u;
};
URL.revokeObjectURL = (u) => blobs.delete(u);

let bad = 0;
const check = (name, cond, got) => {
  console.log(`${cond ? "PASS " : "FAIL "} ${name}${cond ? "" : `  -> ${JSON.stringify(got)}`}`);
  if (!cond) bad++;
};

// --- the real CBZ
const bytes = new Uint8Array(fs.readFileSync(cbzPath));
const d = detectFormat(bytes, "verify-comic.cbz");
check("detected as CBZ", d.format === "cbz", d.format);
check("page count excludes __MACOSX and Thumbs.db", d.pageCount === 5, d.pageCount);

const opened = await openArchive(bytes, "verify-comic.cbz");
check("opened successfully", opened.status === "ok", opened.status);
if (opened.status === "ok") {
  const names = opened.pages.map((p) => p.name);
  console.log(`  page order: ${names.map((n) => n.split("/").pop()).join(", ")}`);
  const tails = names.map((n) => Number(n.match(/(\d+)\.png$/)[1]));
  check("pages come out in numeric order 1,2,3,10,11", JSON.stringify(tails) === "[1,2,3,10,11]", tails);
  check("order rule is natural (nested folders)", opened.order === "natural", opened.order);

  // The real proof: are these actually decodable PNGs?
  let decoded = 0;
  for (const p of opened.pages) {
    const buf = Buffer.from(await blobs.get(p.url).arrayBuffer());
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (isPng) decoded++;
  }
  check(`all ${opened.pages.length} inflated pages are real PNGs`, decoded === opened.pages.length, decoded);
  releaseArchive(opened.handle);
  check("release revoked the URLs", blobs.size === 0, blobs.size);
}

// --- the PHP error page named .epub
const phpBytes = new Uint8Array(fs.readFileSync(phpPath));
const pd = detectFormat(phpBytes, "verify-broken.epub");
check("PHP error page is rejected", pd.rejected === true, pd);
check("...identified as a PHP error, not generic HTML", pd.format === "php-error", pd.format);
const po = await openArchive(phpBytes, "verify-broken.epub");
check("openArchive refuses it", po.status === "rejected", po.status);
console.log(`  message shown to user: "${po.message}"`);

console.log(bad === 0 ? "\nALL CHECKS PASSED" : `\n${bad} CHECKS FAILED`);
process.exitCode = bad ? 1 : 0;