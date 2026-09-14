import { inferBookTags } from '../src/lib/tagsHelper.ts';
import { mergeReadingProgress } from '../src/lib/progressMerge.ts';
import { titlesRoughlyMatch } from '../src/lib/audiobookScraper.ts';
import { isLibgenUrl, buildLibgenDownloadUrl, LIBGEN_MIRRORS } from '../src/lib/libgenProxy.ts';

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

console.log('\n=============================================');
console.log(`LOGIC TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
console.log('=============================================\n');

if (failed > 0) process.exit(1);
