/**
 * Does a real Madara details page actually yield a synopsis?
 *
 * The user reported the manga detail view shows no description. The
 * selector exists in madara.ts, so either the site uses different markup
 * or the value is being dropped between fetch and render. This fetches a
 * live page and prints what is present, rather than assuming.
 */
const url = process.argv[2] || "https://mangazin.org/manga/beauty-and-the-beasts/";

const r = await fetch(
  "https://kora.chaoticstudio.workers.dev/api/source-fetch?u=" + encodeURIComponent(url)
);
const body = (await r.json()).body || "";
console.log("url:", url);
console.log("bytes:", body.length);

const probes = [
  "description-summary",
  "summary__content",
  'class="description',
  "Description",
  "summary-content",
  "post-content",
];
for (const p of probes) {
  const i = body.indexOf(p);
  console.log(" ", p.padEnd(20), i >= 0 ? `FOUND@${i}` : "absent");
}

// Print the neighbourhood of whatever description-ish node exists.
const anchor = body.search(/description-summary|summary__content|class="description/i);
if (anchor >= 0) {
  const chunk = body.slice(Math.max(0, anchor - 200), anchor + 900);
  console.log("\n--- markup around the description node ---");
  console.log(chunk.replace(/></g, ">\n<").slice(0, 1400));
  const text = chunk
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  console.log("\n--- text ---\n" + text.slice(0, 400));
} else {
  console.log("\nNo description markup found at all.");
}
