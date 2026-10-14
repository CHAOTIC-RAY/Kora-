/**
 * Download-link classification tests.
 *
 * The bug: a Mobilism forum link rendered as
 *   "Rave Direct Download"  [Direct]
 *   "Mobilism Forum link (requires external browser login)"
 * — a direct download that requires an external login, on one row.
 *
 * These assert the *classifier's* output AND the invariant that actually
 * matters: the badge, the title and the subtext can never contradict each
 * other, whatever nonsense the upstream label says.
 */
import { classifyDownloadLink } from "../downloadLinkKind";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, got?: unknown) => {
  if (c) { pass++; console.log("PASS ", n); }
  else { fail++; console.log("FAIL ", n, got === undefined ? "" : `-> ${JSON.stringify(got)}`); }
};

/* ------------------------------------------- the exact reported row */

const MOBILISM = classifyDownloadLink({
  url: "https://mobilism.org/showthread.php?t=98765",
  // the upstream label that caused the contradiction
  label: "Rave Direct Download",
  isDirect: true,
});
ok("mobilism forum URL classifies as forum-login", MOBILISM.kind === "forum-login", MOBILISM.kind);
ok("mobilism is NOT direct, even when isDirect:true", MOBILISM.isDirect === false, MOBILISM.isDirect);
ok("mobilism never gets the Direct badge", MOBILISM.badge !== "Direct", MOBILISM.badge);
ok("mobilism badge says Login", MOBILISM.badge === "Login", MOBILISM.badge);
ok("mobilism title does not claim a direct download", !/rave direct/i.test(MOBILISM.title), MOBILISM.title);
ok("mobilism title does not contain the word direct", !/\bdirect\b/i.test(MOBILISM.title), MOBILISM.title);
// A login warning is specifically "you will need to log in" — the word
// "login" also appears in the reassuring "no login needed".
const NEEDS_LOGIN = /need to log ?in|requires external/i;
ok("mobilism subtext warns about the login", NEEDS_LOGIN.test(MOBILISM.subtext), MOBILISM.subtext);

/* ---------------------------------------------------- signed direct links */

const LIBGEN = classifyDownloadLink({
  url: "https://libgen.is/get.php?md5=1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D7&title=Some+Book",
  label: "Rave Direct Download",
  isDirect: true,
});
ok("libgen get.php?md5= is direct", LIBGEN.kind === "direct", LIBGEN.kind);
ok("libgen gets the Direct badge", LIBGEN.badge === "Direct", LIBGEN.badge);
ok("libgen subtext does NOT claim a login is REQUIRED", !/you will need to log ?in/i.test(LIBGEN.subtext), LIBGEN.subtext);
ok("libgen subtext says no login is needed", /no login/i.test(LIBGEN.subtext), LIBGEN.subtext);
ok("libgen keeps the upstream label", LIBGEN.title === "Rave Direct Download", LIBGEN.title);
ok("direct tone is emerald", LIBGEN.tone === "emerald", LIBGEN.tone);

const ARCHIVE = classifyDownloadLink({
  url: "https://archive.org/download/somebook/somebook.epub",
  isDirect: true,
});
ok("archive.org file is direct", ARCHIVE.kind === "direct", ARCHIVE.kind);
ok("archive.org gets Direct", ARCHIVE.badge === "Direct", ARCHIVE.badge);

const BOOKSDL = classifyDownloadLink({
  url: "https://booksdl.lc/download/12345/Book_Title.pdf",
  isDirect: true,
});
ok("booksdl.lc file is direct", BOOKSDL.kind === "direct", BOOKSDL.kind);
ok("booksdl.lc gets Direct", BOOKSDL.badge === "Direct", BOOKSDL.badge);

ok(
  "a bare libgen search page is NOT a file",
  classifyDownloadLink({ url: "https://libgen.is/search.php?req=some+book" }).kind !== "direct"
);
ok(
  "a bare archive.org/details page is NOT a file",
  classifyDownloadLink({ url: "https://archive.org/details/somebook" }).kind !== "direct"
);

/* ---------------------------------------------------------- search links */

const SEARCH = classifyDownloadLink({
  url: "https://duckduckgo.com/?q=some+book+epub",
  label: "Search for this title",
});
ok("a duckduckgo link is search", SEARCH.kind === "search", SEARCH.kind);
ok("search badge says Search", SEARCH.badge === "Search", SEARCH.badge);
ok("search is not direct", SEARCH.isDirect === false);

/* -------------------------------------------------------- other externals */

const EXT = classifyDownloadLink({ url: "https://example.test/some/page", label: "Example" });
ok("an unknown host is external", EXT.kind === "external", EXT.kind);
ok("external is not direct", EXT.isDirect === false);
ok("external badge says External", EXT.badge === "External", EXT.badge);

/* ------------------------------------------------ the invariant itself */

const CASES = [
  MOBILISM, LIBGEN, ARCHIVE, BOOKSDL, SEARCH, EXT,
  // a forum URL arriving with every misleading flag set
  classifyDownloadLink({ url: "https://mobilism.net/thread.x", label: "Rave Direct Download", isDirect: true }),
  // a direct URL arriving with a forum-flavoured label
  classifyDownloadLink({ url: "https://libgen.rs/get.php?md5=ABCDEF0123456789ABCDEF0123456789", label: "Mobilism Forum Mirror", isDirect: true }),
  // no url at all
  classifyDownloadLink({ label: "Something", isDirect: true }),
  classifyDownloadLink(null),
  classifyDownloadLink(undefined),
];

ok(
  "only kind 'direct' ever shows the Direct badge",
  CASES.every(c => (c.badge === "Direct") === (c.kind === "direct"))
);
ok(
  "only kind 'direct' is flagged isDirect",
  CASES.every(c => c.isDirect === (c.kind === "direct"))
);
ok(
  "a Direct badge never comes with a login warning",
  CASES.every(c => !(c.badge === "Direct" && NEEDS_LOGIN.test(c.subtext)))
);
ok(
  "a login warning never comes with a Direct badge",
  CASES.every(c => !(NEEDS_LOGIN.test(c.subtext) && c.badge === "Direct"))
);
ok(
  "a title claiming a direct download implies the link IS direct",
  CASES.every(c => !/rave direct|\bdirect download\b/i.test(c.title) || c.kind === "direct")
);
ok(
  "no non-direct link borrows a direct-sounding title",
  CASES.every(c => c.kind === "direct" || !/\bdirect\b/i.test(c.title))
);
ok("every case yields a non-empty title", CASES.every(c => !!c.title));
ok("every case yields a non-empty subtext", CASES.every(c => !!c.subtext));
ok(
  "the two surfaces would render identically for the same link",
  (() => {
    const m = { url: "https://mobilism.org/showthread.php?t=1", label: "Rave Direct Download", isDirect: true };
    const a = classifyDownloadLink(m);
    const b = classifyDownloadLink(m);
    return a.title === b.title && a.badge === b.badge && a.subtext === b.subtext && a.tone === b.tone;
  })()
);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exitCode = 1;
