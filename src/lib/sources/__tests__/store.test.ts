/**
 * Install-validation tests.
 *
 * Regression: a Madara source declares no `endpoints` because the shared
 * engine supplies them, and the validator used to reject exactly that — so
 * every themed plugin failed to install with "has no endpoints".
 */

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

const FIXTURES: Record<string, unknown> = {
  "/madara.json": {
    id: "kora-manga-s2read",
    name: "S2Read",
    lang: "en",
    version: 1,
    nsfw: false,
    piracy: true,
    kind: "manga",
    theme: "madara",
    baseUrl: "https://s2read.com",
    endpoints: {},
  },
  "/json.json": {
    id: "kora-legal-openlibrary",
    name: "Open Library",
    lang: "en",
    version: 1,
    nsfw: false,
    piracy: false,
    baseUrl: "https://openlibrary.org",
    endpoints: { json: { search: { url: "/s", path: "docs" } } },
  },
  "/broken.json": { id: "x", name: "X", baseUrl: "https://x.com", endpoints: {} },
  "/notjson.json": "<html>404</html>",
  "/noid.json": { name: "No Id", baseUrl: "https://x.com", endpoints: { a: 1 } },
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  const path = String(url).replace("https://kora.test", "");
  if (!(path in FIXTURES)) {
    return { ok: false, status: 404 } as any;
  }
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(FIXTURES[path])) } as any;
}) as any;

const { fetchPluginDefinition } = await import("../store");

// The bug.
const madara = await fetchPluginDefinition("https://kora.test/madara.json");
check("madara source installs", !!madara, madara && "null returned");
check("madara keeps its theme", madara?.theme === "madara", madara?.theme);
check("madara keeps piracy flag", madara?.piracy === true, madara?.piracy);
check("madara keeps its id", madara?.id === "kora-manga-s2read", madara?.id);

// Endpoints-based source still works.
const json = await fetchPluginDefinition("https://kora.test/json.json");
check("json source installs", !!json);
check("json source has no theme", !json?.theme, json?.theme);

// Genuinely broken sources are still rejected.
try {
  await fetchPluginDefinition("https://kora.test/broken.json");
  check("no endpoints + no theme -> rejected", false, "was accepted");
} catch (e: any) {
  check("no endpoints + no theme -> rejected", /no endpoints/i.test(e.message), e.message);
}

try {
  await fetchPluginDefinition("https://kora.test/noid.json");
  check("missing id -> rejected", false, "was accepted");
} catch (e: any) {
  check("missing id -> rejected", /malformed/i.test(e.message), e.message);
}

check("empty url -> null, no throw", (await fetchPluginDefinition("")) === null);

try {
  const r = await fetchPluginDefinition("https://kora.test/missing.json");
  check("404 -> throws", false, r);
} catch (e: any) {
  check("404 -> throws", /404/.test(e.message), e.message);
}

globalThis.fetch = realFetch;

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
