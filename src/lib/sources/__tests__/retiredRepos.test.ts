/**
 * The retired-registry purge.
 *
 * A test registry was left in the configured repository list during
 * development. The file was deleted, but the entry lives in each device's
 * localStorage, so every install that ran that build kept requesting a dead
 * path and the hub showed a raw parser error instead of a message. Deleting
 * the file could not fix it — only the stored entry can.
 *
 * These tests pin the purge so a device that once carried the entry is
 * cleaned the next time the hub reads the list, without touching the
 * repositories a user actually added.
 */

// Minimal localStorage, since the store reads it directly.
const mem = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  get length() {
    return mem.size;
  },
  key: (i: number) => [...mem.keys()][i] ?? null,
  clear: () => mem.clear(),
};
(globalThis as { localStorage?: unknown }).localStorage = fakeStorage;

const { getRepos, addRepo, DEFAULT_REPO } = await import("../store");

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

const LS_REPOS = "kora.sourceRepos.v1";
const DEAD = "https://kora.chaoticstudio.workers.dev/data/test-registry.json";

/* the dead entry is dropped on read */
mem.clear();
mem.set(LS_REPOS, JSON.stringify([DEAD]));
const afterDead = getRepos();
check(
  "retired test registry is not offered",
  !afterDead.some((r) => /test-registry/i.test(r)),
  afterDead
);
check(
  "the default registry is still offered",
  // The default is now the Kora-Plugins registry. This assertion is a canary:
  // if DEFAULT_REPO were ever emptied or left pointing at a retired URL, the
  // plugin hub would load ZERO plugins for every user with no visible error.
  afterDead.includes(DEFAULT_REPO),
  afterDead
);
check(
  "it is gone from storage, not just from the response",
  !JSON.parse(mem.get(LS_REPOS) || "[]").some((r: string) => /test-registry/i.test(r)),
  mem.get(LS_REPOS)
);

/* a user's own repositories survive */
mem.clear();
addRepo("https://example.com/my-registry.json");
mem.set(
  LS_REPOS,
  JSON.stringify([DEAD, "https://example.com/my-registry.json"])
);
const mixed = getRepos();
check(
  "a real custom registry is kept",
  mixed.includes("https://example.com/my-registry.json"),
  mixed
);
check("the dead one is still dropped", !mixed.some((r) => /test-registry/i.test(r)), mixed);

/* purging is idempotent — reading twice must not throw or churn storage */
mem.clear();
mem.set(LS_REPOS, JSON.stringify([DEAD]));
getRepos();
const firstWrite = mem.get(LS_REPOS);
getRepos();
check("purging twice is stable", mem.get(LS_REPOS) === firstWrite, {
  firstWrite,
  now: mem.get(LS_REPOS),
});

/* a device that never had the entry is untouched */
mem.clear();
addRepo("https://example.com/keep.json");
const before = mem.get(LS_REPOS);
getRepos();
check("an unaffected device is not rewritten", mem.get(LS_REPOS) === before, {
  before,
  now: mem.get(LS_REPOS),
});

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
