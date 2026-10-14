import { inferBookTags } from '../src/lib/tagsHelper.ts';
import { mergeReadingProgress } from '../src/lib/progressMerge.ts';
import { titlesRoughlyMatch } from '../src/lib/audiobookScraper.ts';
import { isLibgenUrl, buildLibgenDownloadUrl, LIBGEN_MIRRORS } from '../src/lib/libgenProxy.ts';
import {
  hasDownloadableSource,
  filterDownloadableBooks,
  pickBooksWithWorkingCovers,
  hasCoverCandidate,
} from '../src/lib/bookAvailability.ts';
import { buildBookDeepLink, parseBookLink, buildBookPromoText } from '../src/lib/bookShare.ts';

console.log('--- KORA CORE BUSINESS LOGIC TESTS ---');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`[PASS] ${message}`);
  } else {
    failed++;
    console.error(`[FAIL] ${message}`);
  }
}

// 1. Tag Inference Tests
const tagsPdf = inferBookTags('Introduction to Machine Learning with Python', 'Alice', 'pdf');
assert(tagsPdf.includes('PDF') && tagsPdf.includes('Technology') && tagsPdf.includes('Programming'), 'inferBookTags detects PDF and Tech/Programming');

const tagsEpub = inferBookTags('A Game of Thrones: A Song of Ice and Fire', 'George R.R. Martin', 'epub');
assert(tagsEpub.includes('Ebook') && tagsEpub.includes('Fantasy') && tagsEpub.includes('Fiction'), 'inferBookTags detects EPUB, Fantasy, and Fiction');

const tagsFallback = inferBookTags('Random Unrecognized Word', 'Unknown', 'txt');
assert(tagsFallback.includes('Research') || tagsFallback.includes('Fiction'), 'inferBookTags returns fallback tag');

// 2. Reading Progress Merge Tests
const now = Date.now();
const localStale = { percent: 20, chapterIndex: 2, lastReadTime: now - 50000 };
const remoteFresh = { percent: 50, chapterIndex: 5, lastReadTime: now };
const merge1 = mergeReadingProgress(localStale, remoteFresh);
assert(merge1.progress.percent === 50 && merge1.progress.chapterIndex === 5, 'mergeReadingProgress prefers fresher remote timestamp');
assert(merge1.conflict?.chosen === 'remote', 'mergeReadingProgress flags conflict metadata with chosen remote');

const localIdentical = { percent: 40, chapterIndex: 3, lastReadTime: now };
const remoteIdentical = { percent: 45, chapterIndex: 4, lastReadTime: now + 500 };
const merge2 = mergeReadingProgress(localIdentical, remoteIdentical);
assert(merge2.progress.percent === 45 && merge2.progress.chapterIndex === 4, 'mergeReadingProgress merges close timestamps by highest progress');

const emptyLocal = mergeReadingProgress(null, remoteFresh);
assert(emptyLocal.progress.percent === 50, 'mergeReadingProgress handles null local state');

// 3. Audiobook title fuzzy matching
assert(titlesRoughlyMatch('The Hobbit', 'The Hobbit: Illustrated Edition') === true, 'titlesRoughlyMatch matches subtitle variation');
assert(titlesRoughlyMatch('Dune', 'Harry Potter') === false, 'titlesRoughlyMatch rejects completely different titles');
assert(titlesRoughlyMatch('1984', 'Nineteen Eighty-Four') === false, 'titlesRoughlyMatch rejects non-fuzzy number names as expected');

// 4. Libgen URL Proxy detection
assert(isLibgenUrl('https://libgen.is/book/index.php?md5=ABC123') === true, 'isLibgenUrl detects libgen.is');
assert(isLibgenUrl('https://libgen.rs/book/index.php?md5=DEF456') === true, 'isLibgenUrl detects libgen.rs');
assert(isLibgenUrl('https://example.com/somefile.epub') === false, 'isLibgenUrl ignores non-libgen URLs');

// 5. Book availability — cover + download filters
assert(hasDownloadableSource({ downloadUrl: 'https://cdn.example.com/a.epub' }) === true, 'hasDownloadableSource accepts a direct download URL');
assert(hasDownloadableSource({ md5: 'ABC123' }) === true, 'hasDownloadableSource accepts a libgen md5 row');
assert(hasDownloadableSource({ title: 'Orphan' }) === false, 'hasDownloadableSource rejects a book with no resolvable source');
assert(hasDownloadableSource({ source: 'nyt', title: 'Bestseller' }) === true, 'hasDownloadableSource accepts archive-searchable catalog rows');
assert(hasDownloadableSource({ searchQuery: 'dune frank herbert' }) === true, 'hasDownloadableSource accepts a book carrying a searchQuery');
assert(hasDownloadableSource({ title: 'Grouped', variants: [{ md5: 'XYZ' }] }) === true, 'hasDownloadableSource accepts a grouped book whose variant resolves');
assert(hasDownloadableSource({ title: 'Grouped', variants: [{ title: 'no source' }] }) === false, 'hasDownloadableSource rejects a grouped book with no resolvable variant');
assert(hasDownloadableSource({ downloadUrl: '   ' }) === false, 'hasDownloadableSource rejects a blank download URL');
assert(hasDownloadableSource(null) === false, 'hasDownloadableSource handles null');

const mixedFeed = [
  { title: 'Has Link', downloadUrl: 'https://cdn.example.com/a.epub' },
  { title: 'No Link' },
  { title: 'Libgen', md5: 'DEAD' },
];
const filteredFeed = filterDownloadableBooks(mixedFeed as any);
assert(filteredFeed.length === 2, 'filterDownloadableBooks drops books with no valid download link');
assert(filteredFeed.every((b: any) => b.title !== 'No Link'), 'filterDownloadableBooks keeps only resolvable books');

assert(hasCoverCandidate({ coverUrl: 'https://img/c.jpg' }) === true, 'hasCoverCandidate reads coverUrl');
assert(hasCoverCandidate({ book_image: 'https://img/c.jpg' }) === true, 'hasCoverCandidate falls back to book_image');
assert(hasCoverCandidate({ coverUrl: '   ' }) === false, 'hasCoverCandidate rejects a blank cover URL');
assert(hasCoverCandidate({}) === false, 'hasCoverCandidate rejects a book with no cover field');

const coverPool = [
  { title: 'No Cover' },
  { title: 'Good Cover', coverUrl: 'https://img/good.jpg' },
  { title: 'Dead Cover', coverUrl: 'https://img/dead.jpg' },
  { title: 'Backup Cover', coverUrl: 'https://img/backup.jpg' },
];
const pickedCovers = pickBooksWithWorkingCovers(coverPool as any, {
  limit: 2,
  isBroken: (b) => b.title === 'Dead Cover',
});
assert(pickedCovers.length === 2, 'pickBooksWithWorkingCovers backfills the list up to the limit');
assert(
  pickedCovers[0].title === 'Good Cover' && pickedCovers[1].title === 'Backup Cover',
  'pickBooksWithWorkingCovers skips coverless and known-broken books'
);

const dedupedCovers = pickBooksWithWorkingCovers([
  { title: 'Same', coverUrl: 'https://img/a.jpg' },
  { title: 'Same', coverUrl: 'https://img/b.jpg' },
] as any);
assert(dedupedCovers.length === 1, 'pickBooksWithWorkingCovers dedupes by title');

// 6. Shareable book links
const linkBook = { id: 'abc123', title: 'The New Mind', author: 'J Krishnamurti' };
const deepLink = buildBookDeepLink(linkBook as any);
assert(deepLink.startsWith('https://kora.chaoticstudio.workers.dev/book?'), 'buildBookDeepLink targets the /book route');
assert(deepLink.includes('id=abc123'), 'buildBookDeepLink carries the book id');
// Title and author must travel separately, otherwise the receiver has to
// guess where the title ends and can land on the wrong book.
assert(deepLink.includes('t=The+New+Mind'), 'buildBookDeepLink carries the title as t');
assert(deepLink.includes('a=J+Krishnamurti'), 'buildBookDeepLink carries the author as a');

const parsedLink = parseBookLink(deepLink);
assert(parsedLink !== null && parsedLink.id === 'abc123', 'parseBookLink round-trips the id');
assert(parsedLink !== null && parsedLink.title === 'The New Mind', 'parseBookLink recovers the title verbatim');
assert(parsedLink !== null && parsedLink.author === 'J Krishnamurti', 'parseBookLink recovers the author verbatim');
assert(parsedLink !== null && parsedLink.query === 'The New Mind J Krishnamurti', 'parseBookLink recovers the title+author query');

// A title with an ampersand / comma must not corrupt the round-trip.
const ampLink = parseBookLink(buildBookDeepLink({ title: 'Salt & Pepper', author: 'A. Baker' } as any));
assert(ampLink !== null && ampLink.title === 'Salt & Pepper', 'parseBookLink survives punctuation in the title');
assert(ampLink !== null && ampLink.author === 'A. Baker', 'parseBookLink survives punctuation in the author');

const md5Link = parseBookLink(buildBookDeepLink({ md5: 'MD5HASH', title: 'Fallback Book' } as any));
assert(md5Link !== null && md5Link.id === 'MD5HASH', 'buildBookDeepLink falls back to md5 for the id');

// Older links shipped only ?id=&q=; they must still resolve to something.
const legacyLink = parseBookLink('https://kora.chaoticstudio.workers.dev/book?id=old1&q=Legacy+Book+Someone');
assert(legacyLink !== null && legacyLink.id === 'old1', 'parseBookLink handles legacy id+q links');
assert(legacyLink !== null && legacyLink.title === '' && legacyLink.query === 'Legacy Book Someone', 'legacy links leave title empty so the caller falls back to q');

assert(parseBookLink('https://kora.chaoticstudio.workers.dev/library') === null, 'parseBookLink ignores non-book routes');
assert(parseBookLink('https://kora.chaoticstudio.workers.dev/book') === null, 'parseBookLink ignores a book route with no id, title or query');

const promoText = buildBookPromoText(linkBook as any);
assert(promoText.includes('The New Mind') && promoText.includes('J Krishnamurti'), 'buildBookPromoText names the book and author');
assert(promoText.includes(deepLink), 'buildBookPromoText embeds the deep link for the receiver');

console.log('\n=============================================');
console.log(`LOGIC TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
console.log('=============================================\n');

if (failed > 0) process.exit(1);
