/**
 * Regression: a JSON-API source must actually reach the JSON runtime.
 *
 * `createJsonClient` existed and had 28 passing tests, but nothing ever
 * constructed one — `createSourceClient` only ever built a Madara or HTML
 * client. So every `api: "json"` source (Open Library, Gutenberg) returned
 * zero results while its own unit tests stayed green. This asserts the
 * dispatch, which the JSON client's own tests could not.
 */
import { createSourceClient } from "../client";
import type { SourcePlugin } from "../types";

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log("PASS ", name);
  } catch (e) {
    fail++;
    console.log("FAIL ", name, "—", e instanceof Error ? e.message : e);
  }
}

function eq(a: unknown, b: unknown, m = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const GUTENBERG = {
  id: "kora-legal-gutenberg",
  name: "Gutenberg",
  baseUrl: "https://gutendex.com",
  version: 1,
  lang: "en",
  api: "json",
  kind: "book",
  piracy: false,
  enabled: false,
  icon: "",
  website: "",
  endpoints: {
    json: {
      search: {
        url: "/books?search={query}",
        path: "results",
        title: "title",
        url_: "id",
        author: "authors[].name",
        thumb: "formats.image/jpeg",
        limit: 20,
      },
      details: {
        url: "/books?ids={mangaId}",
        path: "results",
        title: "title",
        author: "authors[].name",
        description: "summaries[]",
      },
    },
  },
} as unknown as SourcePlugin;

/** Minimal stand-in for the Gutendex search response. */
const PAYLOAD = {
  count: 2,
  results: [
    {
      id: 1342,
      title: "Pride and Prejudice",
      authors: [{ name: "Austen, Jane" }],
      summaries: ['"Pride and Prejudice" by Jane Austen is a novel from 1813.'],
      formats: { "image/jpeg": "https://example.test/pg1342.jpg" },
    },
    {
      id: 1,
      title: "The Declaration of Independence",
      authors: [{ name: "Jefferson, Thomas" }],
      summaries: ["A transcript of the declaration."],
      formats: {},
    },
  ],
};

const requested: string[] = [];
const real = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  requested.push(url);
  // The relay wraps the upstream body as a JSON *string* inside an envelope.
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: 200, ok: true, body: JSON.stringify(PAYLOAD), finalUrl: url }),
  } as any;
}) as typeof fetch;

const page = await createSourceClient(GUTENBERG).search("dune", 1);
globalThis.fetch = real;

check("a json source returns parsed results", () => {
  eq(page.mangas.length, 2, "result count");
  eq(page.mangas[0]!.title, "Pride and Prejudice", "first title");
});
check("nested author field is unwrapped", () => {
  eq(page.mangas[0]!.author, "Austen, Jane");
});
check("nested thumb field is resolved", () => {
  eq(page.mangas[0]!.thumbnailUrl, "https://example.test/pg1342.jpg");
});
check("the search term reaches the url", () => {
  // The relay wraps the target url, so it arrives percent-encoded.
  ok(
    requested.some((u) => decodeURIComponent(u).includes("search=dune")),
    `no query in ${requested.map(decodeURIComponent).join(", ")}`
  );
});
check("a source with no api:json still builds an html client", () => {
  const html = { ...GUTENBERG, api: undefined } as SourcePlugin;
  const c = createSourceClient(html);
  ok(typeof c.search === "function", "html client not built");
});

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
