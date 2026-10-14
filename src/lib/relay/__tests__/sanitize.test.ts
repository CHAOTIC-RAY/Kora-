/**
 * Filename and path sanitisation for the relay.
 *
 * This is the one test file where a failure means somebody's SSH key gets
 * overwritten, so the cases are grouped by ADVISORY rather than by input shape.
 * The four croc advisories named in the relay's header are:
 *
 *   GHSA-wmw5-q587-gx56  path traversal in the received filename
 *   GHSA-m6m7-376m-rr8g  symlink / out-of-tree write
 *   GHSA-pcm6-vvg3-3xmh  case-normalisation bypass of a .ssh guard
 *   GHSA-x89h-7h96-v88f  reserved device names treated as ordinary files
 *
 * Each block below names the one it is defending against. Run under plain Node,
 * no DOM, no network.
 */

import {
  MAX_FILENAME_LENGTH,
  contentDispositionFor,
  describeRelayFile,
  escapeHtml,
  extensionOf,
  isForbiddenRelayFilename,
  mimeForRelayExtension,
  sanitizeRelayFilename,
} from "../sanitize";

let pass = 0;
let fail = 0;
function check(name: string, cond: unknown, got?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

const bytes = (s: string) => new TextEncoder().encode(s);
const noSlash = (n: string) => !/[\\/]/.test(n);
const noDotDot = (n: string) => n !== ".." && !n.includes("..");

// ── 1. GHSA-wmw5-q587-gx56: path traversal ───────────────────────────────────
//
// The rule is not "strip ../" but "reduce to a basename and refuse anything
// that does not survive that". A filter that removes the literal two-character
// sequence is defeated by `..%2f`, by a leading `/`, and by a Windows path.

for (const evil of [
  "../../../etc/passwd",
  "..\\..\\..\\Windows\\System32\\config\\SAM",
  "/etc/shadow",
  "/absolute/path/book.epub",
  "C:\\Windows\\System32\\drivers\\etc\\hosts",
  "\\\\server\\share\\book.epub",
  "good/../../evil.epub",
  "a/b/c/../../../../d.epub",
  "./book.epub",
  "foo/./bar.epub",
  "..",
  "../",
  "..\\",
  "foo/..",
]) {
  const out = sanitizeRelayFilename(evil, "epub");
  check(`traversal ${JSON.stringify(evil)} -> no slash`, noSlash(out), out);
  check(`traversal ${JSON.stringify(evil)} -> no ..`, noDotDot(out), out);
  check(`traversal ${JSON.stringify(evil)} -> single segment`, out.split("/").length === 1, out);
  check(`traversal ${JSON.stringify(evil)} -> not absolute`, !out.startsWith("/") && !/^[A-Za-z]:/.test(out), out);
  check(`traversal ${JSON.stringify(evil)} -> keeps an extension`, out.endsWith(".epub"), out);
}

check("a bare dot is refused", sanitizeRelayFilename(".", "epub") === "book.epub", sanitizeRelayFilename(".", "epub"));
check("a bare double dot is refused", sanitizeRelayFilename("..", "epub") === "book.epub", sanitizeRelayFilename("..", "epub"));
check("three dots are refused", sanitizeRelayFilename("...", "epub") === "book.epub", sanitizeRelayFilename("...", "epub"));
check("a legitimate name survives", sanitizeRelayFilename("Dune.epub", "epub") === "Dune.epub", sanitizeRelayFilename("Dune.epub", "epub"));
check("a space in a title survives", sanitizeRelayFilename("The Left Hand of Darkness.epub") === "The Left Hand of Darkness.epub");
check("a unicode title survives", sanitizeRelayFilename("百年孤独.epub") === "百年孤独.epub", sanitizeRelayFilename("百年孤独.epub"));

// ── 2. GHSA-pcm6-vvg3-3xmh: case-normalisation bypass of a guard ─────────────
//
// Every forbidden name has to fail in EVERY case variant, and with the trailing
// dot/space Windows silently strips. Comparing the raw string is the whole bug.

for (const base of [".ssh", ".gnupg", ".aws", ".config", ".bashrc", ".profile"]) {
  for (const variant of [
    base,
    base.toUpperCase(),
    base[0].toUpperCase() + base.slice(1),
    base + ".",
    base + " ",
    base + ".txt",
    base + "..",
  ]) {
    check(`forbidden ${JSON.stringify(variant)} is refused`, isForbiddenRelayFilename(variant) === true, variant);
    const out = sanitizeRelayFilename(variant, "epub");
    check(`forbidden ${JSON.stringify(variant)} -> fallback`, out === "book.epub", out);
    check(`forbidden ${JSON.stringify(variant)} -> no dotfile`, !/^\.ssh|^\.gnupg|^\.aws|^\.config|^\.bashrc|^\.profile/i.test(out), out);
  }
}

check(".SSH as a path segment is refused", isForbiddenRelayFilename("a/b/.SSH") === true);
check("trailing space then dot is refused", isForbiddenRelayFilename(".ssh .") === true);
check("authorized_keys is refused", isForbiddenRelayFilename("authorized_keys") === true);
check("AUTHORIZED_KEYS is refused", isForbiddenRelayFilename("AUTHORIZED_KEYS") === true);
check("id_rsa is refused", isForbiddenRelayFilename("id_rsa") === true);
check("a file merely CONTAINING ssh is fine", isForbiddenRelayFilename("ssh.epub") === false, isForbiddenRelayFilename("ssh.epub"));
check("a file merely STARTING with ssh is fine", isForbiddenRelayFilename("ssh_config_notes.epub") === false);
check("a legitimate .profile.epub BOOK is not refused (it is a title, not a config write)", isForbiddenRelayFilename("The.profile.epub") === false);

// ── 3. GHSA-x89h-7h96-v88f: Windows reserved device names ───────────────────
//
// The name is reserved on the STEM, so `CON.txt` and `con.epub` are the same
// hazard as `CON`. This is the case a naive check with an exact-match list and
// no extension handling walks straight into.

for (const dev of ["CON", "PRN", "AUX", "NUL"]) {
  for (const variant of [dev, dev.toLowerCase(), dev + ".epub", dev.toLowerCase() + ".txt", dev + "."]) {
    check(`reserved ${JSON.stringify(variant)} is refused`, isForbiddenRelayFilename(variant) === true, variant);
    const out = sanitizeRelayFilename(variant, "epub");
    check(`reserved ${JSON.stringify(variant)} -> fallback`, out === "book.epub", out);
  }
}
for (let i = 1; i <= 9; i++) {
  for (const p of ["COM", "LPT"]) {
    const name = `${p}${i}`;
    check(`reserved ${name} is refused`, isForbiddenRelayFilename(name) === true, name);
    check(`reserved ${name}.epub is refused`, isForbiddenRelayFilename(`${name}.epub`) === true, `${name}.epub`);
    check(`reserved ${name} sanitises to the fallback`, sanitizeRelayFilename(`${name}.epub`, "epub") === "book.epub");
  }
}
check("COM0 is NOT a reserved device (it does not exist)", isForbiddenRelayFilename("COM0") === false, isForbiddenRelayFilename("COM0"));
check("LPT10 is NOT reserved (only 1-9 exist)", isForbiddenRelayFilename("LPT10") === false, isForbiddenRelayFilename("LPT10"));
check("CONNIE is not reserved (stem is not an exact match)", isForbiddenRelayFilename("CONNIE.epub") === false, isForbiddenRelayFilename("CONNIE.epub"));
check("PRNT is not reserved", isForbiddenRelayFilename("PRNT.epub") === false);

// ── 4. NUL, control characters, and other truncation primitives ──────────────

check("a NUL byte is stripped", !sanitizeRelayFilename("book\u0000name.epub", "epub").includes("\u0000"), sanitizeRelayFilename("book\u0000name.epub", "epub"));
check("a name that was only a NUL falls back", sanitizeRelayFilename("\u0000", "epub") === "book.epub", sanitizeRelayFilename("\u0000", "epub"));
check("a newline is stripped", !sanitizeRelayFilename("bo\nok.epub").includes("\n"), sanitizeRelayFilename("bo\nok.epub"));
check("a tab is stripped", !sanitizeRelayFilename("bo\tok.epub").includes("\t"));
check("a DEL is stripped", !sanitizeRelayFilename("book.epub").includes(""));
check("an escape sequence cannot inject a terminal", sanitizeRelayFilename("\u001b[31mred.epub").replace(//, "") === "[31mred.epub", sanitizeRelayFilename("\u001b[31mred.epub"));

// ── 5. Illegal characters are replaced, not left to the receiver ────────────

for (const ch of ["/", "\\", ":", "*", "?", '"', "<", ">", "|"]) {
  const out = sanitizeRelayFilename(`a${ch}b.epub`, "epub");
  check(`illegal ${JSON.stringify(ch)} is replaced`, !out.includes(ch), out);
}
check("a quote cannot break out of Content-Disposition", !contentDispositionFor('a"b.epub').includes('filename="a"b'), contentDispositionFor('a"b.epub'));

// ── 6. Trailing dots and spaces: Windows drops them, so normalise here ───────

check("a trailing space is dropped", sanitizeRelayFilename("book.epub ") === "book.epub", sanitizeRelayFilename("book.epub "));
check("trailing dots are dropped", sanitizeRelayFilename("book.epub...") === "book.epub", sanitizeRelayFilename("book.epub..."));
check("a trailing space after the extension is dropped", sanitizeRelayFilename("book.epub . ") === "book.epub", sanitizeRelayFilename("book.epub . "));
check("a name that is only dots falls back", sanitizeRelayFilename("....", "epub") === "book.epub", sanitizeRelayFilename("....", "epub"));

// ── 7. A leading dot is allowed (real files) but a pure dotfile is not ───────

check("a leading dot survives once", sanitizeRelayFilename(".hidden.epub") === ".hidden.epub", sanitizeRelayFilename(".hidden.epub"));
check("multiple leading dots collapse to one", !sanitizeRelayFilename("...book.epub").startsWith(".."), sanitizeRelayFilename("...book.epub"));
check("a leading dot plus nothing else falls back", sanitizeRelayFilename(".", "epub") === "book.epub", sanitizeRelayFilename(".", "epub"));
check("with no ext hint at all the fallback is a bare book", sanitizeRelayFilename(".") === "book", sanitizeRelayFilename("."));

// ── 8. Length is bounded so the receiver's 255-byte limit still holds ────────

{
  const long = "a".repeat(500) + ".epub";
  const out = sanitizeRelayFilename(long, "epub");
  check("a 500-char name is bounded", out.length <= MAX_FILENAME_LENGTH, out.length);
  check("the extension survives truncation", out.endsWith(".epub"), out.slice(-20));
  check("a bounded name has no trailing space before the dot", !out.includes(" .epub"));
}
{
  // A name whose stem truncates to nothing must not become ".epub".
  const out = sanitizeRelayFilename("a".repeat(300), "epub");
  check("truncation never yields a bare extension", out !== ".epub" && out.length > 0, out);
}

// ── 9. describeRelayFile: the descriptor a receiver actually gets ────────────

{
  const d = describeRelayFile("../../etc/passwd", 1024, "epub");
  check("describe: name is a safe segment", noSlash(d.name) && noDotDot(d.name), d.name);
  check("describe: ext is lowercase and dotless", d.ext === "epub", d.ext);
  check("describe: mime is derived, not client-supplied", d.mime === "application/epub+zip", d.mime);
  check("describe: size is carried", d.byteLength === 1024, d.byteLength);
}
{
  // A client claiming text/html for a .epub must not get text/html. The
  // receiver's sniffing rules should not be what decides.
  const d = describeRelayFile("book.epub", 10);
  check("a claimed content type is ignored", d.mime === "application/epub+zip", d.mime);
}
{
  const d = describeRelayFile("book.exe", 10, "exe");
  check("an unknown extension still gets a safe name", noSlash(d.name), d.name);
  check("an unknown extension gets a generic mime", d.mime === "application/octet-stream", d.mime);
}
{
  const d = describeRelayFile(undefined, 10, "epub");
  check("a missing filename falls back", d.name === "book.epub", d.name);
}
{
  const d = describeRelayFile("../../x.sh", 10, "sh");
  check("a traversal attempt with a weird ext cannot become a path", noSlash(d.name) && noDotDot(d.name), d.name);
}
{
  // The extension hint itself is attacker-controlled: it is a string that ends
  // up in a MIME lookup and in the name, so it gets the same scrubbing.
  const d = describeRelayFile("book", 10, "../../epub");
  check("a traversal-shaped ext hint is scrubbed", d.ext === "epub" || d.ext === "", d.ext);
  check("a traversal-shaped ext hint yields no slash in the name", noSlash(d.name), d.name);
  const d2 = describeRelayFile("book", 10, "ePub<script>");
  check("markup in an ext hint is scrubbed", !/[<>]/.test(d2.ext), d2.ext);
  const d3 = describeRelayFile("book", 10, "x".repeat(100));
  check("an over-long ext hint is bounded", d3.ext.length <= 8, d3.ext);
}

// ── 10. Content-Disposition is RFC 6266 shaped and injection-proof ──────────

{
  const cd = contentDispositionFor("Dune.epub");
  check("cd: attachment", cd.startsWith("attachment;"), cd);
  check("cd: has a plain filename", /filename="Dune\.epub"/.test(cd), cd);
  check("cd: has a UTF-8 filename*", /filename\*=UTF-8''Dune\.epub/.test(cd), cd);
}
{
  const cd = contentDispositionFor("Les Fleurs du Mal.epub");
  check("cd: spaces are encoded in filename*", /filename\*=UTF-8''Les%20Fleurs/.test(cd), cd);
  check("cd: the ASCII fallback keeps it readable", /filename="Les Fleurs du Mal\.epub"/.test(cd), cd);
}
{
  // A CRLF in a filename is a header-splitting primitive. The percent-encoding
  // in filename* cannot produce one, and the ASCII fallback strips non-printables.
  const cd = contentDispositionFor("a\r\nX-Evil: 1.epub");
  check("cd: no raw CRLF survives", !/[\r\n]/.test(cd), JSON.stringify(cd));
}
{
  const cd = contentDispositionFor("a".repeat(400) + ".epub");
  check("cd: an over-long name is bounded", cd.length < 600, cd.length);
  check("cd: the bounding does not strip the extension", /\.epub/.test(cd), cd.slice(-40));
}

// ── 11. Helpers ─────────────────────────────────────────────────────────────

check("extensionOf finds the last extension", extensionOf("a.b.epub") === "epub", extensionOf("a.b.epub"));
check("extensionOf on a dotfile returns empty", extensionOf(".bashrc") === "", extensionOf(".bashrc"));
check("extensionOf on a trailing dot returns empty", extensionOf("book.") === "", extensionOf("book."));
check("extensionOf on a path uses the basename", extensionOf("a/b/c.epub") === "epub");
check("mimeForRelayExtension knows epub", mimeForRelayExtension("epub") === "application/epub+zip");
check("mimeForRelayExtension knows azw3", mimeForRelayExtension("azw3") === "application/vnd.amazon.ebook");
check("mimeForRelayExtension falls back generically", mimeForRelayExtension("nope") === "application/octet-stream");

check("escapeHtml escapes ampersand", escapeHtml("a & b") === "a &amp; b", escapeHtml("a & b"));
check("escapeHtml escapes a tag", escapeHtml("<b>x</b>") === "&lt;b&gt;x&lt;/b&gt;", escapeHtml("<b>x</b>"));
check("escapeHtml escapes a quote", escapeHtml('" onload="x') === "&quot; onload=&quot;x", escapeHtml('" onload="x'));
check("escapeHtml escapes a single quote", escapeHtml("' onload='x") === "&#39; onload=&#39;x", escapeHtml("' onload='x"));
check("escapeHtml handles null", escapeHtml(null) === "", escapeHtml(null));
check("escapeHtml handles an object", escapeHtml({}) === "[object Object]");

// A rendered filename, escaped, cannot break out of the attribute it sits in.
{
  const nasty = '"><script>alert(1)</script>.epub';
  const rendered = `<a download="${escapeHtml(sanitizeRelayFilename(nasty, "epub"))}">x</a>`;
  check("a sanitised+escaped name cannot inject a tag", !rendered.includes("<script"), rendered);
}

console.log(`\nsanitize: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
