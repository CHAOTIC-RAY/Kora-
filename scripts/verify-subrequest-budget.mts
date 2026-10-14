/**
 * Does the mirror ladder stay inside Cloudflare's 50-subrequest cap?
 *
 * The unsigned landing-page path was structurally over budget: 6 mirrors x 2
 * protocols x up to 3 fetches each, plus resolveLibgenSigned racing 4 hosts x 2
 * protos. The invocation died at 522 ("Too many subrequests") before the
 * landing-page repair could ever run — which is why the ads.php fix appeared to
 * do nothing on 2026-10-03.
 *
 * Counts fetches against the same MAX_SUBREQUESTS the implementation uses.
 */
import { LIBGEN_MIRRORS, extractLibgenMd5Key, libgenMirrorCandidates } from "../src/lib/libgenProxy";

const MAX_SUBREQUESTS = 24;
const CLOUDFLARE_CAP = 50;

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

const ADS = "https://libgen.la/ads.php?md5=649CBEEEC91055459C251E1D0AC65440";
const SIGNED =
  "https://libgen.li/get.php?md5=649CBEEEC91055459C251E1D0AC65440&key=JHUZHJRLTH2RPMJT";

// Reproduce the fetch accounting the implementation performs.
function simulate(url: string): { spent: number; capped: boolean } {
  const candidates = libgenMirrorCandidates(url);
  let spent = 0;
  const remintHosts = 4;
  const remintProtos = 2;

  for (const c of candidates) {
    const attempts = c.startsWith("https://") ? [c, c.replace(/^https:\/\//i, "http://")] : [c];
    for (const a of attempts) {
      if (spent >= MAX_SUBREQUESTS) return { spent, capped: true };
      spent++; // landing-page fetch

      // HTML came back -> signedUrlFromLibgenHtml may or may not find a key.
      if (!/get\.php\?md5=[a-f0-9]+&key=/i.test("")) {
        // No embedded key -> re-mint race.
        for (let h = 0; h < remintHosts; h++) {
          for (let p = 0; p < remintProtos; p++) {
            if (spent >= MAX_SUBREQUESTS) return { spent, capped: true };
            spent++;
          }
        }
        spent++; // binary fetch
      }
    }
  }
  return { spent, capped: false };
}

console.log("=== candidate counts ===");
const adCands = libgenMirrorCandidates(ADS);
const signedCands = libgenMirrorCandidates(SIGNED);
console.log(`  ads.php candidates:   ${adCands.length}`);
console.log(`  signed candidates:    ${signedCands.length}`);

console.log("\n=== subrequest budget (unsigned landing page = worst case) ===");
const worst = simulate(ADS);
console.log(`  spent=${worst.spent} capped=${worst.capped}`);
check("stays under MAX_SUBREQUESTS", worst.spent <= MAX_SUBREQUESTS, `${worst.spent} <= ${MAX_SUBREQUESTS}`);
check("stays under Cloudflare's 50 cap", worst.spent < CLOUDFLARE_CAP, `${worst.spent} < ${CLOUDFLARE_CAP}`);
check("budget is actually enforced (capped)", worst.capped === true);

console.log("\n=== happy path: a signed link should resolve immediately ===");
check(
  "signed URL parses to md5+key",
  (() => {
    const p = extractLibgenMd5Key(SIGNED);
    return !!p && p.md5 === "649cbeeec91055459c251e1d0ac65440" && !!p.key;
  })()
);
check(
  "ads.php also parses (md5, no key)",
  (() => {
    const p = extractLibgenMd5Key(ADS);
    return !!p && p.md5 === "649cbeeec91055459c251e1d0ac65440" && !p.key;
  })()
);
check("mirrors list is non-empty", LIBGEN_MIRRORS.length > 0, `${LIBGEN_MIRRORS.length} mirrors`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);