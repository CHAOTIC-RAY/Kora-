/**
 * Ensure only verified open-access provider file URLs are treated as direct.
 */
import { isRaveDirectUpstreamUrl } from "../src/lib/raveDownloadOptions";

let failures = 0;
const check = (label: string, got: boolean, want: boolean) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        got ${got}, want ${want}`);
};

check("Internet Archive confirmed download path", isRaveDirectUpstreamUrl("https://archive.org/download/book-id/book.epub"), true);
check("Project Gutenberg EPUB direct URL", isRaveDirectUpstreamUrl("https://www.gutenberg.org/ebooks/1342.epub3.images"), true);
check("Project Gutenberg TXT direct URL", isRaveDirectUpstreamUrl("https://www.gutenberg.org/ebooks/1342.txt.utf-8"), true);
check("Internet Archive item page is not a file", isRaveDirectUpstreamUrl("https://archive.org/details/book-id"), false);
check("Anna's Archive URL is not treated as a direct file", isRaveDirectUpstreamUrl("https://annas-archive.org/dl/example"), false);
check("Anna's Archive slow-download URL is not direct", isRaveDirectUpstreamUrl("https://annas-archive.org/slow_download/example"), false);
check("LibGen signed endpoint is not treated as open-access direct", isRaveDirectUpstreamUrl("https://libgen.li/get.php?md5=abc&key=K"), false);
check("booksdl mirror is not treated as open-access direct", isRaveDirectUpstreamUrl("https://booksdl.lc/get.php?md5=abc&key=K"), false);
check("Rave homepage is not a file", isRaveDirectUpstreamUrl("https://ravebooksearch.com"), false);
check("HTTP is rejected", isRaveDirectUpstreamUrl("http://archive.org/download/book-id/book.epub"), false);
check("malformed URL is rejected", isRaveDirectUpstreamUrl("not a url"), false);
check("empty URL is rejected", isRaveDirectUpstreamUrl(""), false);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
