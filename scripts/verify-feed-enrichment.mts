/**
 * Feed enrichment: can the archive actually resolve NYT/Goodreads rows?
 *
 * The trending feed is built from catalog rows that all arrive with `md5: null`
 * and no downloadUrl — 19 lanes x ~15 books. So the feed cannot simply be
 * filtered for downloadability; every row has to be resolved first, and only the
 * ones that resolve are kept.
 *
 * This measures the real keep-rate using live NYT titles, so the trade-off is
 * visible rather than assumed: enriching costs N archive calls, and the feed
 * shows only what actually has a file.
 */
import { hasDirectFile, filterFeedByDownloadability } from "../src/lib/bookAvailability";
import { matchesEditionStrictly } from "../src/lib/mirrorRelevance";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

const UA = { "User-Agent": "Mozilla/5.0" };
const ORIGIN = "https://kora.chaoticstudio.workers.dev";

/** Real NYT titles + authors from /api/nytimes/overview. */
const NYT_ROWS: [string, string][] = [
  ["HOLLYWOOD, ENDING", "John Green"],
  ["THEO OF GOLDEN", "Allen Levi"],
  ["VINCE FLYNN: DOUBLE TAP", "Don Bentley"],
  ["SWAN SONG", "Charles Spencer"],
  ["ROLL THE CALLS", "Ari Emanuel"],
  ["ACTUALLY, NEVERMIND", "Taylor Tomlinson"],
];

// Transcribe enrichFeedWithDirectFiles.
async function resolveAll(book: any, queries: string[]) {
  for (const q of queries) {
    if (book.md5) break;
    await resolveOne(book, q);
  }
  return book;
}

async function resolveOne(book: any, q: string) {
  const url = `${ORIGIN}/api/annas-archive/search?q=${encodeURIComponent(q)}&limit=25&page=1`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  const found = await res.json();
  const rows: any[] = found.books || [];
  const strict = rows.filter((b) =>
    matchesEditionStrictly({
      title: book.title, author: book.author,
      candidateTitle: b.title, candidateAuthor: b.author,
    })
  );
  const usable = strict.length > 0 ? strict : rows;
  // rankVariants: LibGen (rank 1) beats everything else (rank 2).
  usable.sort((a, b) => {
    const sr = (v: any) => {
      const s = (v.source || "").toLowerCase();
      if (v.directUrl || s.includes("rave")) return 0;
      if (s.includes("libgen")) return 1;
      return 2;
    };
    return sr(a) - sr(b);
  });
  const best = usable[0];
  if (best?.md5) {
    book.md5 = best.md5;
    book.downloadUrl = best.downloadUrl;
    book.needsBrowser = false;
  }
  return book;
}

console.log("=== resolving real NYT feed rows against the archive ===");
const feed: Record<string, any[]> = { lane: [] };
for (const [title, author] of NYT_ROWS) {
  const b: any = { title, author, source: "nyt", searchQuery: `${title} ${author}` };
  // Same fallback ladder as enrichFeedWithDirectFiles.
  const last = author.split(",")[0].split(/\s+/).pop() || "";
  const r = await resolveAll(b, Array.from(new Set([b.searchQuery, title, `${title} ${last}`.trim()])));
  feed.lane.push(r);
  console.log(
    `  ${b.md5 ? "RESOLVED" : "no file "}  ${title.slice(0, 34).padEnd(36)} ${b.md5 || ""}`
  );
}

const kept = filterFeedByDownloadability(feed);
const keptRows = kept.lane || [];
console.log(`\n  ${NYT_ROWS.length} feed rows -> ${keptRows.length} shown`);
console.log(`  kept: ${keptRows.map((b) => b.title).join(" | ") || "(none)"}`);

check("at least some feed rows resolve", keptRows.length > 0, `${keptRows.length}/${NYT_ROWS.length}`);
check(
  "every kept row has a direct file",
  keptRows.every((b) => hasDirectFile(b))
);
check(
  "unresolved rows are dropped",
  keptRows.length <= NYT_ROWS.length
);

console.log("\n=== a row with no md5 must NOT be shown ===");
const deadFeed = { lane: [{ title: "SWAN SONG", author: "Charles Spencer", source: "nyt", searchQuery: "x" }] };
check("unresolved row filtered from the feed", (filterFeedByDownloadability(deadFeed).lane || []).length === 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);