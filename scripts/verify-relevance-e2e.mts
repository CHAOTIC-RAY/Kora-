/**
 * End-to-end proof against the REAL Rave response captured on 2026-10-03.
 *
 * Reproduces the exact selection logic DiscoverView now uses (strict title
 * match, then the relevance-gated fallback) over the real 51-result payload for
 * "capture or kill", and reports what a user would be offered.
 */
import { titlesRoughlyMatch } from "../src/lib/audiobookScraper";
import { isRelevantMirrorResult } from "../src/lib/mirrorRelevance";
import { classifyDownloadLink } from "../src/lib/downloadLinkKind";

const rawBooks: any[] = [
  {
    "s": "Library Genesis",
    "t": "EDGE- Task Force Delta 4 · Kill or Capture",
    "u": "https://libgen.li/ads.php?md5=68ADFCEFF0977F014172570195BC9B4B",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Kill or Capture",
    "u": "https://libgen.li/ads.php?md5=905EA610921BBE55B2159526E1BD819A",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Kill or capture: the war on terror and the soul of the Obama presidency",
    "u": "https://libgen.li/ads.php?md5=D6B5CC78814BF7D317185B0D4D13721F",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Brannigan's Blackhearts 7 · Kill or Capture",
    "u": "https://libgen.li/ads.php?md5=512A051E0F9D1A4C6C83AF60D6EB8815",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Kill or Capture: How a Special Operations Task Force Took Down a Notorious Al Qaeda Terrorist",
    "u": "https://libgen.li/ads.php?md5=15CFC11DFC8994806FF22FB41B9CB347",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Titanium Alpha 3 · Kill or Capture",
    "u": "https://libgen.li/ads.php?md5=B675426F130537672EE17451588FB062",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Kill or Capture",
    "u": "https://libgen.li/ads.php?md5=2AFA3A573B5BA9969BBC12EDAFEC61E8",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Kill or Capture How a Special Operations Task Force Took Down a Notorious al Qaeda Terrorist",
    "u": "https://libgen.li/ads.php?md5=E79F23BE0C3868A46DFDDAC821CBACCD",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Capture or Kill",
    "u": "https://libgen.li/ads.php?md5=50ADC516E3F0F0BD8CB1028ECD6B0557",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Capture or Kill",
    "u": "https://libgen.li/ads.php?md5=863603C2117B0A786F83144BBB40D7B9",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Brannigan's Blackhearts 7 · Kill or Capture",
    "u": "https://libgen.li/ads.php?md5=2804D7D3878094DACF51E87710978D9A",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Capture or Kill: The Pursuit of the 9/11 Masterminds and the Killing of Osama bin Laden",
    "u": "https://libgen.li/ads.php?md5=CAB2BD1F5C3F03EA04213194CA3D99AF",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Capture or Kill: A Mitch Rapp Novel",
    "u": "https://libgen.li/ads.php?md5=649CBEEEC91055459C251E1D0AC65440",
    "r": null
  },
  {
    "s": "Library Genesis",
    "t": "Capture Or Kill Mitch Rapp 23",
    "u": "https://libgen.li/ads.php?md5=3A07E6DC86B2196CFFBE7FE10FD5CC19",
    "r": null
  },
  {
    "s": "Internet Archive",
    "t": "The 3 Kingdoms, The Water Margin, & the Plum in the Golden Vase",
    "u": "https://archive.org/details/The3Kingdoms",
    "r": null
  },
  {
    "s": "Internet Archive",
    "t": "King Arthur & his Noble Knights of the Round Table",
    "u": "https://archive.org/details/TheDeathofArthur",
    "r": null
  },
  {
    "s": "Internet Archive",
    "t": "Galatea, The Ingenious Don Quixote of La Mancha, Persiles & Sigismunda, & the Exemplary Novellas",
    "u": "https://archive.org/details/TheIngeniousGentlemanDonQuixoteOfLaMancha",
    "r": null
  },
  {
    "s": "Internet Archive",
    "t": "Batman: Knightfall (Volumes 1-3)",
    "u": "https://archive.org/details/batman-knightfall",
    "r": null
  },
  {
    "s": "Internet Archive",
    "t": "AMSCO AP World History",
    "u": "https://archive.org/details/amsco-ap-world-history",
    "r": null
  },
  {
    "s": "Internet Archive",
    "t": "The Franklin Cover-up by Former Green Beret John DeCamp",
    "u": "https://archive.org/details/TheFranklinCover-upByFormerGreenBeretJohnDecamp",
    "r": null
  },
  {
    "s": "LibreTexts",
    "t": "Computational Cognitive Neuroscience",
    "u": "https://downloads.libretexts.org/api/v1/download/med-12554/pdf",
    "r": true
  },
  {
    "s": "LibreTexts",
    "t": "Statistical Thinking for the 21st Century",
    "u": "https://downloads.libretexts.org/api/v1/download/stats-7637/pdf",
    "r": true
  },
  {
    "s": "LibreTexts",
    "t": "Laboratory Manual - Computer Programming with Python, Multisim and TINA/4E",
    "u": "https://downloads.libretexts.org/api/v1/download/eng-26326/pdf",
    "r": true
  },
  {
    "s": "LibreTexts",
    "t": "The Politics of Sports",
    "u": "https://downloads.libretexts.org/api/v1/download/med-89751/pdf",
    "r": true
  },
  {
    "s": "LibreTexts",
    "t": "The American LGBTQ Rights Movement - An Introduction",
    "u": "https://downloads.libretexts.org/api/v1/download/human-68317/pdf",
    "r": true
  },
  {
    "s": "LibreTexts",
    "t": "Thermal Imaging - Level 1",
    "u": "https://downloads.libretexts.org/api/v1/download/workforce-57775/pdf",
    "r": true
  },
  {
    "s": "LibreTexts",
    "t": "Introduction to Communication",
    "u": "https://downloads.libretexts.org/api/v1/download/socialsci-42819/pdf",
    "r": true
  },
  {
    "s": "RoyalLib",
    "t": "Capture the Saint",
    "u": "https://royallib.com/book/Charteris_Leslie/capture_the_saint.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "The Capture of Cerberus",
    "u": "https://royallib.com/book/Christie_Agatha/The_Capture_of_Cerberus.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "I Capture the Castle",
    "u": "https://royallib.com/book/Smith_Dodie/i_capture_the_castle.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "Quake II - Capture the Flag",
    "u": "https://royallib.com/book/puchkov_dmitriy/Quake_II___Capture_the_Flag.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "I Come to Kill You",
    "u": "https://royallib.com/book/Halliday_Brett/i_come_to_kill_you.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "Kill Me If You Can",
    "u": "https://royallib.com/book/Patterson_James/Kill_Me_If_You_Can.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "A Necessary Kill",
    "u": "https://royallib.com/book/Sumner_James/a_necessary_kill.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "All You Need Is Kill",
    "u": "https://royallib.com/book/Sakurazaka_Hiroshi/All_You_Need_Is_Kill.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "Kill You Last",
    "u": "https://royallib.com/book/Strasser_Todd/Kill_You_Last.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "Kill Them All",
    "u": "https://royallib.com/book/Shannon_Harry/Kill_Them_All.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "Mr. Kill",
    "u": "https://royallib.com/book/Limon_Martin/Mr_Kill.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "Kill Me If You Can",
    "u": "https://royallib.com/book/Young_Nicole/Kill_Me_If_You_Can.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "Fit to kill",
    "u": "https://royallib.com/book/Heneghan_James/Fit_to_kill.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "First to Kill",
    "u": "https://royallib.com/book/Peterson_Andrew/First_to_Kill.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "The Kill-Off",
    "u": "https://royallib.com/book/Thompson_Jim/the_killoff.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "And Kill Them All",
    "u": "https://royallib.com/book/Butts_J/and_kill_them_all.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "Kill Her Again",
    "u": "https://royallib.com/book/Browne_Robert/Kill_Her_Again.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "The Big Kill",
    "u": "https://royallib.com/book/Spillane_Mickey/the_big_kill.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "The Kill",
    "u": "https://royallib.com/book/Saul_Jonas/The_Kill.html",
    "r": null
  },
  {
    "s": "RoyalLib",
    "t": "In for the Kill",
    "u": "https://royallib.com/book/Rowson_Pauline/in_for_the_kill.html",
    "r": null
  },
  {
    "s": "Internet Archive",
    "t": "ShmooCon 2010 Slides",
    "u": "https://archive.org/details/shmoocon2010slides",
    "r": null
  },
  {
    "s": "Internet Archive",
    "t": "ShmooCon 2007 Slides",
    "u": "https://archive.org/details/shmoocon2007slides",
    "r": null
  },
  {
    "s": "Internet Archive",
    "t": "game list",
    "u": "https://archive.org/details/game-list",
    "r": null
  },
  {
    "s": "Internet Archive",
    "t": "CIA and Project Monarch Full History Ron Patton",
    "u": "https://archive.org/details/CIAandProjectMonarchFullHistoryRonPatton",
    "r": null
  }
].map((r: any) => ({
  source: r.s, title: r.t, downloadUrl: r.u, directReady: r.r,
}));

const TITLE = "The Atlantis Gene";
const AUTHOR = "A thr Reun";
const QUERY = "the atlantis gene";

console.log(`Rave returned ${rawBooks.length} results for "${QUERY}" (${TITLE} / ${AUTHOR})\n`);

const bySource = new Map<string, number>();
for (const b of rawBooks) bySource.set(b.source, (bySource.get(b.source) || 0) + 1);
console.log("buckets:", Object.fromEntries(bySource));

// ── OLD behaviour: strict match, else re-admit everything ──
const oldStrict = rawBooks.filter((b) => titlesRoughlyMatch(TITLE, b.title || "", AUTHOR));
const oldKept = oldStrict.length > 0 ? oldStrict : rawBooks;

// ── NEW behaviour: strict match, else the relevance-gated fallback ──
const strictMatches = rawBooks.filter((b) => titlesRoughlyMatch(TITLE, b.title || "", AUTHOR));
const relaxedMatches = rawBooks.filter((b) =>
  isRelevantMirrorResult({
    query: QUERY, bookTitle: TITLE, bookAuthor: AUTHOR,
    candidateTitle: b.title, candidateAuthor: b.author,
  })
);
const newKept = strictMatches.length > 0 ? strictMatches : relaxedMatches;

console.log(`\nOLD kept: ${oldKept.length}   NEW kept: ${newKept.length}`);

const junkKeptByOld = oldKept.filter((b) =>
  !isRelevantMirrorResult({ query: QUERY, bookTitle: TITLE, bookAuthor: AUTHOR, candidateTitle: b.title, candidateAuthor: b.author })
);
console.log(`Junk OLD kept: ${junkKeptByOld.length}`);
console.log(`Junk NEW kept: ${newKept.filter((b) => junkKeptByOld.includes(b)).length}`);

console.log("\n--- what OLD offered (the bug the screenshot showed) ---");
const oldLibre = oldKept.filter((b) => b.source === "LibreTexts");
for (const b of oldLibre) {
  const c = classifyDownloadLink(b.downloadUrl || "");
  console.log(`  [${b.source}] "${(b.title || "").slice(0, 46)}" -> ${c.badge}`);
}
console.log(`  LibreTexts offered by OLD: ${oldLibre.length}`);

console.log("\n--- what NEW offers ---");
for (const b of newKept) {
  const c = classifyDownloadLink(b.downloadUrl || "");
  console.log(`  [${b.source}] "${(b.title || "").slice(0, 46)}" -> ${c.badge}`);
}
const newLibre = newKept.filter((b) => b.source === "LibreTexts");
console.log(`  LibreTexts offered by NEW: ${newLibre.length}`);

// Assertions: the gate must remove every LibreTexts/RoyalLib keyword
// coincidence that the old unfiltered fallback re-admitted.
const newLibre2 = newKept.filter((b) => b.source === "LibreTexts");
const leaked = oldKept.filter((b) => junkKeptByOld.includes(b) && newKept.includes(b));
const ok =
  oldKept.some((b) => b.source === "LibreTexts") &&   // old path DID leak it
  newLibre2.length === 0 &&                            // new path does not
  leaked.length === 0 &&                               // nothing leaked through
  newKept.every((b) =>
    isRelevantMirrorResult({
      query: QUERY, bookTitle: TITLE, bookAuthor: AUTHOR,
      candidateTitle: b.title, candidateAuthor: b.author,
    })
  );

console.log(`  old leaked LibreTexts: ${oldKept.filter((b) => b.source === "LibreTexts").length}`);
console.log(`  new leaked LibreTexts: ${newLibre2.length}`);
console.log(`  leaked into new set:   ${leaked.length}`);
console.log(`  every new result passes the gate: ${newKept.length === 0 || ok}`);

process.exit(ok ? 0 : 1);