/**
 * The audiobook source registry must match reality.
 *
 * The user supplied 15 hosts. Six of them turned out to be unreachable, and two
 * of the rest needed a different integration than "scrape the search page". This
 * verifier pins the decisions, and — importantly — pins that the unreachable
 * hosts are never requested, because a dead host in a search fan-out costs a
 * full timeout on every single search.
 *
 * Live findings (2026-10-05) that these assertions encode:
 *   - bigaudiobooks.net / appaudiobooks.net / audiobooksbee.com /
 *     goldenaudiobook.net  -> TLS cert "CN=Fortiguard SDNS Blocked Page"
 *   - anyaudiobook.net     -> NXDOMAIN
 *   - forum.mobilism.org   -> HTTP 522
 *   - librivox.org         -> documented JSON API, `^title` prefix match,
 *                            `extended=1` returns real archive.org MP3 sections
 *   - storynory.com        -> search returns editorial links only, browse-only
 *   - audiobookbay.lu      -> magnet/torrent index, not direct MP3, browse-only
 */
import fs from "node:fs";
import {
  ALL_AUDIOBOOK_SOURCES,
  AUDIOBOOK_SOURCES,
  BROWSE_AUDIOBOOK_SOURCES,
  LEGACY_AUDIOBOOK_SOURCES,
  SEARCHABLE_AUDIOBOOK_SOURCES,
  UNREACHABLE_AUDIOBOOK_HOSTS,
  audiobookSearchUrl,
  parseLibrivoxJson,
} from "../src/lib/audiobookSources";
import { sourceNameForUrl } from "../src/lib/audiobookScraper";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

console.log("=== the two original sources still work ===");
check("fulllengthaudiobooks retained", LEGACY_AUDIOBOOK_SOURCES.some((s) => s.name === "fulllengthaudiobooks"));
check("hdaudiobooks retained", LEGACY_AUDIOBOOK_SOURCES.some((s) => s.name === "hdaudiobooks"));
check("legacy sources are searchable", LEGACY_AUDIOBOOK_SOURCES.every((s) => SEARCHABLE_AUDIOBOOK_SOURCES.includes(s)));

console.log("\n=== new sources registered ===");
for (const want of ["librivox", "hotaudiobooks", "hdaudiobooks_net", "audiobooks4soul", "audiozaic", "audiobookbay", "learnoutloud", "storynory"]) {
  check(`${want} registered`, AUDIOBOOK_SOURCES.some((s) => s.name === want));
}
console.log(`     total sources: ${ALL_AUDIOBOOK_SOURCES.length}`);

console.log("\n=== unreachable hosts are never requested ===");
const requestedHosts = SEARCHABLE_AUDIOBOOK_SOURCES.map((s) => s.base);
for (const dead of UNREACHABLE_AUDIOBOOK_HOSTS) {
  check(
    `${dead} not in the search set`,
    !requestedHosts.some((h) => h.includes(dead)),
    "would cost a timeout on every search"
  );
}
check(
  "unreachable list covers all 6 verified-dead hosts",
  UNREACHABLE_AUDIOBOOK_HOSTS.length === 6,
  `${UNREACHABLE_AUDIOBOOK_HOSTS.length}`
);
check(
  "no dead host is in BROWSE either",
  !UNREACHABLE_AUDIOBOOK_HOSTS.some((d) => BROWSE_AUDIOBOOK_SOURCES.some((s) => s.base.includes(d)))
);

console.log("\n=== search URLs are well-formed ===");
let bad = 0;
for (const s of SEARCHABLE_AUDIOBOOK_SOURCES) {
  const u = audiobookSearchUrl(s, "atomic habits");
  if (!u || !u.startsWith("https://") || u.includes("{q}")) {
    bad++;
    console.log(`     BAD: ${s.name} -> ${u}`);
  }
}
check("every searchable source yields a concrete https URL", bad === 0, `${bad} bad`);

const lv = AUDIOBOOK_SOURCES.find((s) => s.name === "librivox");
const lvUrl = lv ? audiobookSearchUrl(lv, "alice") || "" : "";
check("LibriVox uses the JSON API, not HTML", lv?.kind === "api" && lvUrl.includes("/api/feed/audiobooks/"));
check("LibriVox uses ^ prefix matching", lvUrl.includes("title=%5Ealice") || lvUrl.includes("^alice"));
check("LibriVox requests extended data for file URLs", lvUrl.includes("extended=1"));

console.log("\n=== browse-only sources are excluded from keyword search ===");
for (const b of ["audiobookbay", "storynory"]) {
  const s = AUDIOBOOK_SOURCES.find((x) => x.name === b);
  check(`${b} is browseOnly`, s?.browseOnly === true);
  check(`${b} not in SEARCHABLE`, !SEARCHABLE_AUDIOBOOK_SOURCES.some((x) => x.name === b));
}
check(
  "browse set is larger than the search set",
  BROWSE_AUDIOBOOK_SOURCES.length > SEARCHABLE_AUDIOBOOK_SOURCES.length,
  `${BROWSE_AUDIOBOOK_SOURCES.length} vs ${SEARCHABLE_AUDIOBOOK_SOURCES.length}`
);

console.log("\n=== LibriVox JSON parser handles a REAL response ===");
// Trimmed but structurally exact shape of a live `extended=1` response.
const realJson = JSON.stringify({
  books: [
    {
      id: "2400",
      title: "Alice's Adventures in Wonderland",
      url_librivox: "https://librivox.org/alices-adventures-in-wonderland-by-lewis-carroll/",
      authors: [{ id: "1", first_name: "Lewis", last_name: "Carroll" }],
      readers: [{ id: "9", name: "Read by Ann Lee" }],
      genres: [{ name: "Children's Fiction" }, { name: "Fantastic Fiction" }],
      sections: [
        { title: "Down the Rabbit-Hole", listen_url: "https://www.archive.org/download/alice_in_wonderland_librivox/wonderland_ch_01_64kb.mp3" },
        { title: "The Pool of Tears", listen_url: "https://www.archive.org/download/alice_in_wonderland_librivox/wonderland_ch_02_64kb.mp3" },
      ],
    },
  ],
});
const parsed = parseLibrivoxJson(realJson);
check("one book parsed", parsed.length === 1);
check("title preserved", parsed[0]?.title === "Alice's Adventures in Wonderland");
check("author joined from first/last", parsed[0]?.author === "Lewis Carroll");
check("narrator from readers", parsed[0]?.narrator === "Read by Ann Lee");
check("genres flattened", parsed[0]?.genres.length === 2);
check("both MP3 sections captured", parsed[0]?.sections.length === 2);
check(
  "section URLs are real archive.org files",
  (parsed[0]?.sections[0]?.url || "").endsWith("wonderland_ch_01_64kb.mp3")
);

console.log("\n=== the parser cannot be crashed by a bad payload ===");
check("malformed JSON returns []", parseLibrivoxJson("{not json").length === 0);
check("empty books returns []", parseLibrivoxJson('{"books":[]}').length === 0);
check("null returns []", parseLibrivoxJson("null").length === 0);
check(
  "a book with no sections still parses",
  parseLibrivoxJson('{"books":[{"title":"X","url_librivox":"https://librivox.org/x/"}]}').length === 1
);
check(
  "a book with no url is dropped",
  parseLibrivoxJson('{"books":[{"title":"X"}]}').length === 0
);

console.log("\n=== detail pages are attributed to the right source ===");
// Was a `fulllengthaudiobooks ? ... : "hdaudiobooks"` ternary, so every other
// host was reported as hdaudiobooks and all eight new sources would have been
// silently mislabelled.
const attribution: [string, string][] = [
  ["https://hdaudiobooks.com/dune-audiobook/", "hdaudiobooks"],
  ["https://fulllengthaudiobooks.com/book/x/", "fulllengthaudiobooks"],
  ["https://librivox.org/alices-adventures/", "librivox"],
  ["https://www.librivox.org/alices-adventures/", "librivox"],
  // Longest-host-first, so .net must not be shadowed by .com
  ["https://hdaudiobooks.net/some-book/", "hdaudiobooks_net"],
  ["https://audiozaic.com/book/x/", "audiozaic"],
  ["https://audiobooks4soul.com/book/x/", "audiobooks4soul"],
  ["https://learnoutloud.com/book/x/", "learnoutloud"],
];
let attrBad = 0;
for (const [url, want] of attribution) {
  const got = sourceNameForUrl(url);
  if (got !== want) {
    attrBad++;
    console.log(`     ${url} -> ${got} (want ${want})`);
  }
}
check("every detail URL resolves to its own source", attrBad === 0, `${attribution.length} URLs`);

console.log("\n=== detail resolution can reach the new sources ===");
for (const f of ["src/lib/audiobookServer.ts", "src/lib/audiobookDetailClient.ts"]) {
  const short = f.split("/").pop()!;
  const body = fs.readFileSync(f, "utf8");
  check(
    `${short} derives probe URLs from the registry`,
    body.includes("SEARCHABLE_AUDIOBOOK_SOURCES") && body.includes("audiobookSearchUrl"),
    "not a hardcoded two-host list"
  );
  check(
    `${short} no longer hardcodes a two-host probe`,
    !body.includes("fulllengthaudiobooks.com/?s=${encodeURIComponent")
  );
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);