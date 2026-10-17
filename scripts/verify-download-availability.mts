import assert from "node:assert/strict";
import { hasDirectFile, hasDownloadableSource, filterDownloadableBooks } from "../src/lib/bookAvailability";

const pseudo = "54f2e7e36fe67f3189182621277f92b29a17715bc2d586487918457306333345";
const realMd5 = "54f2e7e36fe67f3189182621277f92b2";

assert.equal(
  hasDirectFile({ title: "Master of the Game", md5: pseudo, downloadUrl: "https://openlibrary.org/works/OL123W" }),
  false,
  "a locally generated SHA-256 plus a catalog page must not be treated as a direct file"
);
assert.equal(
  hasDirectFile({ title: "Master of the Game", md5: pseudo, downloadUrl: "https://archive.org/details/masterofthegame" }),
  false,
  "an Archive details page is not a downloadable file"
);
assert.equal(
  hasDirectFile({ title: "Master of the Game", md5: realMd5, downloadUrl: "https://royallib.com/book/example.html" }),
  false,
  "a provider ID cannot make a reader HTML page downloadable"
);
assert.equal(
  hasDirectFile({ title: "Legitimate EPUB", md5: realMd5, downloadUrl: "https://libgen.li/get.php?md5=" + realMd5 }),
  true,
  "a real provider MD5 and file endpoint remain available"
);
assert.equal(
  hasDownloadableSource({ title: "Master of the Game", source: "Open Library (catalogue)", md5: pseudo, downloadUrl: "https://openlibrary.org/works/OL123W" }),
  false,
  "catalog-only rows are not advertised as downloadable"
);
const mixed = filterDownloadableBooks([
  { title: "Catalog only", md5: pseudo, downloadUrl: "https://openlibrary.org/works/OL123W" },
  { title: "Real EPUB", md5: realMd5, downloadUrl: "https://libgen.li/get.php?md5=" + realMd5 },
]);
assert.deepEqual(mixed.map((b) => b.title), ["Real EPUB"]);

console.log("PASS: catalog pages and pseudo-hashes are not direct downloads; real file endpoints remain available.");
