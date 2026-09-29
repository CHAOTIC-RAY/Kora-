/**
 * Onboarding topic-country wiring: the country must actually change the
 * feeds, not just the label.
 *
 * A picker that shows the right name while still loading the Maldives list
 * would look correct and be wrong, so the URLs are asserted too.
 */
import { TOPIC_FEED_GROUPS } from "../../lib/feedStorage";
import { feedsForCountry, countryName, COUNTRY_OPTIONS, COUNTRY_FEEDS } from "../../lib/countryFeeds";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log("PASS ", name);
  } catch (e) {
    fail++;
    console.log("FAIL ", name, "—", e instanceof Error ? e.message : e);
  }
}
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq(a: unknown, b: unknown, m = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** Mirrors OnboardingModal's selectedFeedUrls for the local topic. */
function localFeeds(country: string) {
  return feedsForCountry(country).map((f) => f.feedUrl);
}

test("the topic is labelled just 'Local'", () => {
  const g = TOPIC_FEED_GROUPS.find((x) => x.id === "local");
  ok(g, "no local topic");
  eq(g!.label, "Local");
});

test("no topic is called 'Local & Updates' any more", () => {
  ok(
    !TOPIC_FEED_GROUPS.some((g) => /Local\s*&\s*Updates/i.test(g.label)),
    "old label still present"
  );
});

test("16 countries are offered", () => {
  eq(COUNTRY_OPTIONS.length, 16);
});

test("country codes are unique", () => {
  const codes = COUNTRY_FEEDS.map((c) => c.code);
  eq(codes.length, new Set(codes).size, "duplicate country code");
});

test("every feed has a title, site and url", () => {
  for (const c of COUNTRY_FEEDS) {
    for (const f of c.feeds) {
      ok(f.title?.trim(), `${c.code}: feed with no title`);
      ok(f.feedUrl?.trim(), `${c.code}/${f.title}: no feedUrl`);
      ok(f.siteUrl?.trim(), `${c.code}/${f.title}: no siteUrl`);
    }
  }
});

test("changing country changes the feeds", () => {
  const mv = localFeeds("MV");
  const us = localFeeds("US");
  ok(mv.length > 0 && us.length > 0, "a country resolved to no feeds");
  ok(
    !mv.some((u) => us.includes(u)),
    "Maldives and US resolve to the same feed list"
  );
});

test("Maldives is no longer the default for an unset country", () => {
  const none = localFeeds("");
  const mv = localFeeds("MV");
  ok(
    !mv.some((u) => none.includes(u)),
    "unset country falls back to Maldives"
  );
});

test("an uncurated country falls back to worldwide", () => {
  const zz = localFeeds("ZZ");
  const ww = localFeeds("");
  eq(zz, ww);
});

test("country codes are case-insensitive", () => {
  eq(localFeeds("mv"), localFeeds("MV"));
});

test("every curated country has at least one feed", () => {
  for (const c of COUNTRY_FEEDS) {
    ok(c.feeds.length > 0, `${c.code} has no feeds`);
  }
});

test("countryName only names curated countries", () => {
  eq(countryName("MV"), "Maldives");
  eq(countryName("ZZ"), "");
});

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
