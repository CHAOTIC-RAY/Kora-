/**
 * The Kora-Sources -> Kora-Plugins rename, pinned.
 *
 * A renamed registry repo is a genuinely dangerous change, because the URL is
 * baked into every existing user's localStorage. Getting this wrong does not
 * throw — it silently loads ZERO plugins for everyone, with no error the user
 * can act on. So each of the three ways it can go wrong gets a test here:
 *
 *   1. The old URL is not purged  -> the app keeps requesting a dead registry.
 *   2. The new URL is purged too  -> the default is deleted on every read and
 *                                    the hub is permanently empty.
 *   3. The trust exemption is lost -> every user gets a "trust this
 *                                    third-party repo?" modal about Kora's OWN
 *                                    registry. This is the one that hits
 *                                    literally every install, which is why it
 *                                    is asserted for BOTH names.
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

const { getRepos, addRepo, DEFAULT_REPO, LEGACY_DEFAULT_REPO } = await import("../store");
const { isKoraDefaultRepoUrl } = await import("../../../components/TrustRepoModal");

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

/* the shipped default points at the renamed registry */
check(
  "DEFAULT_REPO is the Kora-Plugins registry",
  DEFAULT_REPO.includes("Kora-Plugins"),
  DEFAULT_REPO
);
check("DEFAULT_REPO is a raw index.json URL", /index\.json$/.test(DEFAULT_REPO), DEFAULT_REPO);
check(
  "the legacy URL is retained for migration, not for use",
  LEGACY_DEFAULT_REPO.includes("Kora-Sources"),
  LEGACY_DEFAULT_REPO
);

/* (1) the OLD url is purged from a device that still carries it */
mem.clear();
mem.set(LS_REPOS, JSON.stringify([LEGACY_DEFAULT_REPO]));
const migrated = getRepos();
check(
  "the pre-rename registry is purged from stored repos",
  !migrated.some((r) => r.includes("Kora-Sources")),
  migrated
);
check(
  "it is gone from storage, not just filtered from the response",
  !JSON.parse(mem.get(LS_REPOS) || "[]").some((r: string) => r.includes("Kora-Sources")),
  mem.get(LS_REPOS)
);

/* (2) the NEW url is NEVER purged — this is the zero-plugins failure mode */
mem.clear();
mem.set(LS_REPOS, JSON.stringify([DEFAULT_REPO]));
const kept = getRepos();
check(
  "the renamed registry is NOT purged",
  kept.includes(DEFAULT_REPO),
  kept
);
check(
  "the renamed registry is still in storage after a read",
  JSON.parse(mem.get(LS_REPOS) || "[]").includes(DEFAULT_REPO),
  mem.get(LS_REPOS)
);
// A fresh device that never had the old entry must also keep the new one.
mem.clear();
addRepo("https://example.com/keep.json");
const fresh = getRepos();
check("a fresh device keeps the default", fresh.includes(DEFAULT_REPO), fresh);

/* a genuine third-party repo is untouched by the purge */
mem.clear();
mem.set(
  LS_REPOS,
  JSON.stringify([
    LEGACY_DEFAULT_REPO,
    "https://example.com/my-registry.json",
    "https://raw.githubusercontent.com/someone/Kora-Sources/main/index.json",
  ])
);
const mixed = getRepos();
check("a user's own registry survives", mixed.includes("https://example.com/my-registry.json"), mixed);
check(
  "a third-party repo merely NAMED Kora-Sources survives (the pattern is owner-scoped)",
  mixed.includes("https://raw.githubusercontent.com/someone/Kora-Sources/main/index.json"),
  mixed
);

/* (3) the trust exemption — the highest-consequence assertion here */
check(
  "the renamed registry is exempt from the trust prompt",
  isKoraDefaultRepoUrl(DEFAULT_REPO)
);
check(
  "the pre-rename registry is ALSO exempt (users mid-migration)",
  isKoraDefaultRepoUrl(LEGACY_DEFAULT_REPO)
);
check(
  "an unrelated repo still gets the trust prompt",
  !isKoraDefaultRepoUrl("https://example.com/my-registry.json")
);
check(
  "a lookalike on another host is not exempt",
  !isKoraDefaultRepoUrl("https://evil.example.com/Kora-Plugins/main/index.json")
);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
