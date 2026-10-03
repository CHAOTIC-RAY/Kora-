/**
 * Is a mirror's result actually about the book the user searched for?
 *
 * Rave aggregates loosely. Searching "Capture or Kill" (a Vince Flynn thriller)
 * returned 51 hits of which the LibreTexts bucket held neuroscience textbooks
 * and RoyalLib held books with "Capture" in the title — all matching on the
 * word "capture" alone, none of them the requested book.
 *
 * The app then promoted those to "LibreTexts Direct Download", so tapping the
 * book offered a PDF of a neuroscience textbook as the thriller's download.
 *
 * A keyword engine will always return loosely-related hits, so the fix is not
 * to trust the ranking but to require corroboration: a title match, or failing
 * that, at least an author match. Anything else is noise and must not become a
 * downloadable mirror.
 */
import { titlesRoughlyMatch } from "./audiobookScraper";

export interface RelevanceInput {
  /** The title the user asked for. */
  query?: string | null;
  /** The book the mirrors are attached to — often more specific than the query. */
  bookTitle?: string | null;
  bookAuthor?: string | null;
  /** The candidate mirror's own title. */
  candidateTitle?: string | null;
  candidateAuthor?: string | null;
}

/** Normalised, comparable form: lowercase, alphanumeric only. */
function norm(s?: string | null): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * True when the candidate plausibly IS the requested book.
 *
 * Uses the same fuzzy matcher the rest of the app uses for editions, so a
 * subtitle or a series suffix does not disqualify a genuine match.
 */
export function isRelevantMirrorResult(input: RelevanceInput): boolean {
  const candidate = input.candidateTitle;
  if (!candidate) return false;

  // No query context at all: nothing to contradict, so do not block.
  const target = input.bookTitle || input.query;
  if (!target) return true;

  const query = norm(input.query);
  const bookTitle = norm(input.bookTitle);
  const cand = norm(candidate);
  if (!cand) return false;

  // 0. Author veto, before anything else can rescue a candidate.
  //
  //    Titles are not unique across authors: Agatha Christie's "Capture or
  //    Cerberus" and Vince Flynn's "Capture or Kill" are different books, and a
  //    same-title result under a different author is the strongest signal that
  //    a keyword engine returned the wrong thing. Placing this after the fuzzy
  //    title match let an identical title through, which is exactly the case
  //    worth catching.
  const candAuthor = norm(input.candidateAuthor);
  const wantAuthor = norm(input.bookAuthor);
  const authorDisagrees =
    Boolean(candAuthor && wantAuthor) && !candAuthor.includes(wantAuthor);
  if (authorDisagrees) return false;

  // 1. Strong: the candidate matches the book we are actually opening.
  if (input.bookTitle && titlesRoughlyMatch(input.bookTitle, candidate, input.bookAuthor || undefined)) {
    return true;
  }

  // 2. Strong: matches the raw search phrase.
  if (input.query && titlesRoughlyMatch(input.query, candidate, undefined)) {
    return true;
  }

  // 3. Weak but useful: author match. "Capture or Kill" + "Vince Flynn" against
  //    a result by Vince Flynn is almost certainly right even if the title
  //    differs between editions ("Capture or Kill" vs "Kill or Capture").
  if (norm(input.candidateAuthor) && norm(input.bookAuthor)
      && norm(input.candidateAuthor).includes(norm(input.bookAuthor))) {
    return true;
  }

  // 4. Last resort: the candidate title contains the bulk of the query, which
  //    catches a reformatting difference without accepting a single shared word.
  //    This is the guard that rejects "Computational Cognitive Neuroscience"
  //    for the query "capture or kill".
  //
  //    Only when no author is known on either side. If we know the author and
  //    the candidate's author disagrees, word overlap must NOT rescue it:
  //    "Capture or Kill" by Agatha Christie shares every word with the query and
  //    is still a different book.
  if (query) {
    const words = query.split(" ").filter((w) => w.length > 3);
    const strong = words.filter((w) => cand.includes(w));
    // "At least half the meaningful words, and more than one" was too strict for
    // a ONE-word query: "dune" yields words.length === 1, so the rule could
    // never fire and every single-word title returned no downloads at all
    // (reported 2026-10-03). For a single-word query the only meaningful signal
    // IS that word, so require the whole title to be that word, optionally with
    // extra words around it — "dune" must match "Dune" and "Dune Encyclopedia",
    // but must not match "Dune: The Movie Art" being a different edition? It
    // should — series and subtitle variants are wanted.
    //
    // So: for one word, require an exact-or-prefix title match. For several,
    // keep the "half of them AND more than one" rule that rejects a lone shared
    // word like "capture".
    if (words.length === 1) {
      const w = words[0];
      // Match on WORD BOUNDARIES, not substrings. `cand.includes(w)` would
      // accept "MicroDune" and "Dune Enviroment" for the query "dune", which
      // are different books. The word must stand alone as a token.
      if (cand === w) return true;
      const tokens = cand.split(" ");
      if (tokens.includes(w)) return true;
      // Also allow the query to be a phrase inside a longer title only when
      // every token of the query matches a token of the candidate.
          } else if (words.length >= 2 && strong.length >= 2 && strong.length / words.length >= 0.5) {
      return true;
    }
    }

  return false;
}

/**
 * Author-aware strict match for an edition list.
 *
 * The bug this fixes: the edition filter called
 * `titlesRoughlyMatch(title, b.title, author)` and passed only the BOOK's
 * author, never the CANDIDATE's. `titlesRoughlyMatch` treats "expected author
 * present but not found in the actual text" as an author mismatch and demands
 * 60% title-word overlap. Since the actual string passed in was only a title,
 * that mismatch fired on EVERY result.
 *
 * For "Vince Flynn Capture or Kill" (author "Don Bentley") against a real LibGen
 * edition "Capture or Kill" by "Vince Flynn; Don Bentley":
 *
 *   expected words = [vince, flynn, capture, kill]   (4)
 *   actual words   = [capture, kill]                 (2)
 *   overlap 2, required ceil(4 * 0.6) = 3           -> REJECTED
 *
 * so all three genuine EPUBs were discarded and the modal fell through to a
 * RoyalLib HTML page. Two things are wrong and both are handled here:
 *
 *  1. The candidate's own author must be compared. When it corroborates the
 *     book's author (co-author, "X; Y" forms), there is no mismatch and the
 *     title is compared on its own — no penalty.
 *  2. When the book title itself contains the author's name ("Vince Flynn
 *     Capture or Kill"), those words can never appear in a published title, so
 *     they must not count toward the overlap requirement.
 */
export function matchesEditionStrictly(input: {
  title?: string | null;
  author?: string | null;
  candidateTitle?: string | null;
  candidateAuthor?: string | null;
}): boolean {
  const { title, author, candidateTitle, candidateAuthor } = input;
  if (!candidateTitle) return false;
  if (!title) return true;

  // Remove author words from BOTH sides before comparing.
  //
  // The stored title is "Vince Flynn Capture or Kill" — the series author is
  // part of it — while every published edition is titled "Capture or Kill …".
  // Those words can never appear in a real title, so leaving them in makes the
  // overlap ratio unreachable and rejects the genuine editions. Strip author
  // names from both sides first, then compare titles alone.
  const authorWords = new Set<string>();
  for (const source of [author, candidateAuthor]) {
    for (const w of norm(source).split(" ")) {
      if (w.length > 2) authorWords.add(w);
    }
  }
  const stripAuthors = (s: string): string => {
    let out = s;
    for (const w of authorWords) {
      out = out.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
    }
    return out.replace(/\s+/g, " ").trim();
  };

  const bareTitle = stripAuthors(title);
  const bareCandidate = stripAuthors(candidateTitle);
  // If stripping leaves nothing (the title IS the author's name), fall back.
  const ref = bareTitle || title;
  const cand = bareCandidate || candidateTitle;

  const nAuthor = norm(author);
  const nCandAuthor = norm(candidateAuthor);
  const authorsDisagree =
    Boolean(nAuthor && nCandAuthor) &&
    !(nCandAuthor.includes(nAuthor) || nAuthor.includes(nCandAuthor));

  if (authorsDisagree) {
    // A genuinely different author writing the same title is the classic case
    // worth rejecting ("Capture or Kill" by Agatha Christie).
    return false;
  }

  return titlesRoughlyMatch(ref, cand);
}