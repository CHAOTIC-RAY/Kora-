/**
 * Do retries actually advance down the mirror ladder?
 *
 * This is the load-bearing claim behind "try the next link easily". The retry
 * handler re-derives a mirror list and starts again; if it re-hits the host that
 * just failed, the user sees an identical failure and the ladder is decorative.
 *
 * `untriedMirrors` and `markMirrorTried` are plain module functions in App.tsx,
 * which cannot be imported here without the whole Worker/browser environment, so
 * the logic is reproduced exactly and pinned. If App.tsx changes its filter, this
 * file must change with it — see the assertion comments.
 */
import { proxyUrlForMirror } from "../src/lib/downloadProxy";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

// ── Mirror: mirrors UNtriedMirrors + markMirrorTried from App.tsx ──
type Tried = Map<string, Set<string>>;
function untriedMirrors(triedRef: Tried, downloadId: string, mirrors: any[]) {
  const tried = triedRef.get(downloadId);
  if (!tried || tried.size === 0) return mirrors;
  const fresh = mirrors.filter((m) => !tried.has(m?.url));
  return fresh.length > 0 ? fresh : mirrors;
}
function markMirrorTried(triedRef: Tried, downloadId: string, url: string) {
  if (!url) return;
  let set = triedRef.get(downloadId);
  if (!set) {
    set = new Set<string>();
    triedRef.set(downloadId, set);
  }
  set.add(url);
}

// A realistic ladder: a dead host first, a live one second.
const MIRRORS = [
  { url: "/api/proxy-file?url=https%3A%2F%2Flibgen.li%2Fx", label: "Libgen" },
  { url: "/api/proxy-file?url=https%3A%2F%2Flibgen.vg%2Fx", label: "Libgen vg" },
  { url: "https://archive.org/download/id/f.epub", label: "Archive.org" },
];

// 1. First attempt: nothing tried yet, so the full list is offered.
const t1: Tried = new Map();
check(
  "first attempt offers every mirror",
  untriedMirrors(t1, "dl1", MIRRORS).length === 3
);

// 2. Mirror 1 fails and is marked tried.
markMirrorTried(t1, "dl1", MIRRORS[0].url);
const after1 = untriedMirrors(t1, "dl1", MIRRORS);
check("failed mirror is excluded on retry", !after1.some((m) => m.url === MIRRORS[0].url), `now: ${after1.map((m) => m.label).join(", ")}`);
check("remaining mirrors are preserved", after1.length === 2);

// 3. Mirror 2 fails too — now only Archive.org is left.
markMirrorTried(t1, "dl1", MIRRORS[1].url);
const after2 = untriedMirrors(t1, "dl1", MIRRORS);
check("second failure also excluded", after2.length === 1 && after2[0].label === "Archive.org", after2[0]?.label);

// 4. Exhausted: must fall back to the full list rather than handing back nothing,
//    otherwise retry silently stops working with no way to recover.
markMirrorTried(t1, "dl1", MIRRORS[2].url);
const exhausted = untriedMirrors(t1, "dl1", MIRRORS);
check("all mirrors tried falls back to the full list", exhausted.length === 3, `${exhausted.length} offered`);

// 5. Tries are scoped per download, so one book's failures do not poison another's.
markMirrorTried(t1, "dl1", MIRRORS[0].url);
const other = untriedMirrors(t1, "dl2", MIRRORS);
check("a different download is unaffected", other.length === 3, `${other.length} offered`);

// 6. A retry never hands back a proxy-of-a-proxy (the double-wrap 502).
const retryUrls = after2.map((m) => proxyUrlForMirror(m.url));
check(
  "retry list contains no nested proxy URLs",
  retryUrls.every((u) => !/\/api\/proxy-file\?url=%2Fapi%2F/i.test(u))
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);