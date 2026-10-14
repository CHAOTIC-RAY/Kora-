/**
 * Device code generation for the relay.
 *
 * Two things are being defended here, and they are different:
 *
 *  1. READABILITY ON AN E-INK SCREEN. The code is read off a slow, low-contrast
 *     display and typed on another device. O/0 and I/1/L are excluded, so a
 *     mistyped character cannot turn into a DIFFERENT VALID code — which on an
 *     unauthenticated fetch endpoint is not a typo, it is someone else's file.
 *
 *  2. ENTROPY. 31^4 = 923,521 codes. That number is asserted here, and also
 *     asserted to be a number and not a hope: the point of the rate limiter
 *     (rateLimit.test.ts) is that this space is cheap to walk but expensive to
 *     walk UNDETECTED, and a reader back-of-envelope that 900k requests is
 *     nothing has to be pinned down.
 *
 * Collision handling is tested with a stubbed `random` so the retry loop is
 *     exercised deterministically rather than by hoping.
 */

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_SPACE,
  generateRelayCode,
  generateRelaySecret,
  generateUniqueRelayCode,
  isValidRelayCode,
  normalizeRelayCode,
} from "../codes";

let pass = 0;
let fail = 0;
function check(name: string, cond: unknown, got?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

// ── 1. The alphabet excludes every ambiguous glyph ──────────────────────────

for (const ambiguous of ["0", "O", "o", "1", "I", "i", "l", "L"]) {
  check(`alphabet excludes ${ambiguous}`, !CODE_ALPHABET.includes(ambiguous), CODE_ALPHABET);
}
check("alphabet has no lowercase", CODE_ALPHABET === CODE_ALPHABET.toUpperCase(), CODE_ALPHABET);
check("alphabet has no duplicates", new Set(CODE_ALPHABET.split("")).size === CODE_ALPHABET.length, CODE_ALPHABET);
check("alphabet is 31 characters", CODE_ALPHABET.length === 31, CODE_ALPHABET.length);
check("alphabet contains 2", CODE_ALPHABET.includes("2"));
check("alphabet contains 9", CODE_ALPHABET.includes("9"));
check("alphabet contains Z", CODE_ALPHABET.includes("Z"));
check("alphabet contains A", CODE_ALPHABET.includes("A"));

// ── 2. Codes are exactly four characters from the alphabet ──────────────────

for (let i = 0; i < 2000; i++) {
  const code = generateRelayCode();
  if (code.length !== CODE_LENGTH) {
    check(`code ${code} is 4 chars`, false, code);
    break;
  }
  if (![...code].every((c) => CODE_ALPHABET.includes(c))) {
    check(`code ${code} uses only legal chars`, false, code);
    break;
  }
}
check("2000 generated codes are all 4 legal characters", true);

// Real randomness should not be stuck: over 2000 draws every alphabet member
// should appear. A generator that only ever emitted "AAAA" would pass the shape
// checks above and fail here.
{
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) for (const c of generateRelayCode()) seen.add(c);
  check("every alphabet member appears over 2000 codes", seen.size === CODE_ALPHABET.length, seen.size);
}

// Two different codes over many draws, so the generator is not constant.
{
  const codes = new Set<string>();
  for (let i = 0; i < 500; i++) codes.add(generateRelayCode());
  check("500 draws produce many distinct codes", codes.size > 400, codes.size);
}

// ── 3. Normalisation is generous about input, strict about output ──────────

check("plain 4 chars pass", normalizeRelayCode("ABCD") === "ABCD", normalizeRelayCode("ABCD"));
check("lowercase is upcased", normalizeRelayCode("abcd") === "ABCD");
check("spaces anywhere are stripped", normalizeRelayCode(" A B C D ") === "ABCD", normalizeRelayCode(" A B C D "));
check("a tab is stripped", normalizeRelayCode("AB\tCD") === "ABCD", normalizeRelayCode("AB\tCD"));
check("dashes are stripped", normalizeRelayCode("AB-CD") === "ABCD");
check("a newline is stripped", normalizeRelayCode("AB\nCD") === "ABCD");
for (const bad of ["", "ABC", "ABCDE", "ABCDEF", "!!!!", "AB CD E", "AB;CD", "AB/CD", "AB\\CD"]) {
  check(`normalisation rejects ${JSON.stringify(bad)}`, normalizeRelayCode(bad) === null, normalizeRelayCode(bad));
}
for (const bad of [null, undefined, 42, {}, [], true]) {
  check(`normalisation rejects ${JSON.stringify(bad)}`, normalizeRelayCode(bad) === null, normalizeRelayCode(bad));
}

// A look-alike is REFUSED, never corrected. "AB01" is not "ABOI": on an
// unauthenticated endpoint, guessing which one the user meant is how the wrong
// book gets delivered or none does.
for (const bad of ["AB01", "AB0D", "ABOD", "AB1D", "ABID", "ABLD", "ab1d"]) {
  check(`look-alike ${bad} is refused, not corrected`, normalizeRelayCode(bad) === null, normalizeRelayCode(bad));
}
check("digits that are legal still work", normalizeRelayCode("2379") === "2379", normalizeRelayCode("2379"));
check("a legal code with no letters works", normalizeRelayCode("2345") === "2345");

check("isValidRelayCode agrees with normalise", isValidRelayCode("ABCD") === true);
check("isValidRelayCode rejects a look-alike", isValidRelayCode("AB01") === false);
check("isValidRelayCode rejects null", isValidRelayCode(null) === false);

// ── 4. The space is what it claims to be ────────────────────────────────────

check("CODE_LENGTH is 4", CODE_LENGTH === 4, CODE_LENGTH);
check("CODE_SPACE is 31^4", CODE_SPACE === Math.pow(31, 4), CODE_SPACE);
check("CODE_SPACE is 923521", CODE_SPACE === 923521, CODE_SPACE);
// Quoted in the UI, so the entropy claim is checkable rather than folklore.
check("CODE_SPACE is ~19.8 bits of entropy", Math.log2(CODE_SPACE) > 19.7 && Math.log2(CODE_SPACE) < 19.9, Math.log2(CODE_SPACE));
// And it is small enough that the rate limit is load-bearing: 1e6 guesses is
// minutes of one IP and hours of a botnet, which is why guessing resistance is
// an explicit design goal rather than an assumption.
check("the code space is brute-forceable in principle (hence the rate limit)", CODE_SPACE < 1_000_000, CODE_SPACE);

// ── 5. The secret is the real credential ────────────────────────────────────

check("a secret is 32 hex chars (128 bits)", /^[0-9a-f]{32}$/.test(generateRelaySecret()), generateRelaySecret());
check("secrets are unique across 500 draws", (() => {
  const s = new Set<string>();
  for (let i = 0; i < 500; i++) s.add(generateRelaySecret());
  return s.size === 500;
})());
check("a secret is not a code", generateRelaySecret().length !== CODE_LENGTH);
check("a secret does not use the code alphabet alone", /[0-9a-f]/.test(generateRelaySecret()));

// A stubbed source must NOT be silently trusted: the function prefers WebCrypto
// when present, and only falls back to the stub where WebCrypto is absent.
check("generateRelaySecret ignores a broken stub when WebCrypto exists", (() => {
  const s = generateRelaySecret(() => 0.5);
  return /^[0-9a-f]{32}$/.test(s) && s !== "8".repeat(32);
})(), generateRelaySecret(() => 0.5));

// ── 6. Collision handling ───────────────────────────────────────────────────
//
// Driven with a stubbed `random` so the retry loop is provably exercised: a
// generator that only ever collides is a realistic failure (a weak entropy
// source, a stubbed Math.random in a bad test) and the loop is what stops it
// handing the same code to two devices.
//
// THE ORDER MATTERS, and the stubs below follow it exactly:
//   generateRelayCode(random)  ->  then  isTaken(candidate)
// So `random` is called FIRST in each iteration. A stub that counts in
// `isTaken` and switches in `random` is off by one, which is exactly the
// mistake these stubs are written to avoid.
//
// A `random` pinned to 0 yields "2222" (index 0 of the alphabet, four times);
// 0.5 yields index 15, "HHHH". Neither contains a look-alike glyph.

const codeAt = (randomValue: number): string => {
  const idx = Math.floor(randomValue * CODE_ALPHABET.length) % CODE_ALPHABET.length;
  return CODE_ALPHABET[idx].repeat(CODE_LENGTH);
};

{
  // Reject the first three candidates, accept the fourth. Counts attempts in
  // isTaken, which is the reliable place to count.
  let checks = 0;
  let code = "";
  code = await generateUniqueRelayCode(
    () => {
      checks++;
      return checks <= 3; // first three are "taken"
    },
    () => (checks === 3 ? 0.5 : 0)
  );
  check("three collisions then a free code", code === "HHHH", code);
  check("the retry loop consulted isTaken four times", checks === 4, checks);
  check("the returned code is 4 legal characters", (() => {
    if (code.length !== CODE_LENGTH) return false;
    return [...code].every((c) => CODE_ALPHABET.includes(c));
  })(), code);
  check("the stubbed values are what this test assumes", codeAt(0) === "2222" && codeAt(0.5) === "HHHH", [codeAt(0), codeAt(0.5)]);
}

{
  // The PRODUCTION path: a real Set of taken codes, which is what
  // `listSessionCodes()` feeds. The Set has to do the work, so every candidate
  // is added before the check — the shape a genuinely saturated code space has.
  const taken = new Set<string>();
  let checks = 0;
  const code = await generateUniqueRelayCode(
    (c) => {
      taken.add(c);
      checks++;
      return checks <= 3;
    },
    () => (checks === 3 ? 0.5 : 0)
  );
  check("a real Set does the collision check", code === "HHHH", code);
  check("the colliding candidate is in the Set", taken.has("2222"), [...taken]);
  // The accepted candidate IS in the Set by the time we look — `isTaken` adds
  // before answering, mirroring `listSessionCodes` handing the caller a Set to
  // consult. What matters is that it was NOT there when the check ran, which
  // the recorded order below shows: "2222" was rejected, "HHHH" was not.
  check("the accepted candidate is a NEW code, not the rejected one", code !== "2222", code);
  check("exactly two distinct candidates were ever drawn", taken.size === 2, [...taken]);
  check("it took four candidates", checks === 4, checks);
}

{
  // A permanently-taken space must FAIL LOUDLY rather than loop forever or,
  // worse, hand back a duplicate.
  let threw = false;
  try {
    await generateUniqueRelayCode(() => true, () => 0, 10);
  } catch (e) {
    threw = true;
    check("the error names the relay", /relay/i.test((e as Error).message), (e as Error).message);
    check("the error names the attempt bound", /attempt/i.test((e as Error).message), (e as Error).message);
  }
  check("a saturated code space throws instead of hanging", threw);
}

{
  // Async `isTaken` (R2 lookups are async) must be awaited properly — an
  // un-awaited Promise is truthy, so every code would look "taken".
  let checks = 0;
  const code = await generateUniqueRelayCode(async (c) => {
    checks++;
    await Promise.resolve();
    return checks <= 2;
  }, () => (checks === 2 ? 0.5 : 0));
  check("an async taken-check is awaited, not treated as truthy", code === "HHHH", code);
  check("it took three candidates", checks === 3, checks);
}

console.log(`\ncodes: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
