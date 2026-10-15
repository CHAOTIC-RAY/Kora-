import { scoreScrabbleCpuWord } from "../src/lib/scrabbleScoring";

let failures = 0;
function check(name: string, actual: number, expected: number) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: expected ${expected}, received ${actual}`);
  if (!pass) failures++;
}

const values = { A: 1, C: 3, E: 1, G: 2, I: 1, L: 1, N: 1, R: 1, T: 1, D: 2 };
const noPremium = () => null;
const repeatedLetter = scoreScrabbleCpuWord(
  "EEL",
  [{ r: 7, c: 7, letter: "E" }],
  values,
  (r, c) => r === 7 && c === 7 ? "TWS" : null
);
check("repeated letters remain in the base word score", repeatedLetter.baseWordScore, 3);
check("word premium applies to the completed word", repeatedLetter.total, 9);

const doubleLetter = scoreScrabbleCpuWord(
  "CAT",
  [{ r: 0, c: 0, letter: "C" }],
  values,
  (r, c) => r === 0 && c === 0 ? "DLS" : null
);
check("letter premium applies only to a newly placed tile", doubleLetter.total, 8);

const bingo = scoreScrabbleCpuWord(
  "READING",
  Array.from("READING", (letter, index) => ({ r: 7, c: index, letter })),
  values,
  noPremium
);
check("seven newly placed tiles earn the bingo bonus", bingo.total, 59);

if (failures) {
  console.error(`\n${failures} Scrabble scoring regression test(s) failed.`);
  process.exit(1);
}
console.log("\nALL PASS");
