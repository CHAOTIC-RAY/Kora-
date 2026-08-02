// Phase 3.5 (adapted from 3.1): split the 2 MB dictionary-data.json into fixed
// buckets so the reader only ever fetches the one shard a tapped word belongs to
// (instead of parsing the whole file on the main thread at startup).
//
// Sharding is by a STABLE HASH of the word into N buckets. We emit index.json
// listing the exact shard filenames that exist, so the loader (and the service
// worker) never guess/404. This also keeps any single shard small even when the
// source dictionary is dominated by one initial letter (it is — ~5.2k entries
// start with "a").
//
// Run automatically by `npm run build`.

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'public', 'dictionary-data.json');
const outDir = path.join(root, 'public', 'data', 'dict');

if (!fs.existsSync(src)) {
  console.warn('[build-data-bundle] public/dictionary-data.json missing — skipping.');
  process.exit(0);
}

const entries = JSON.parse(fs.readFileSync(src, 'utf-8'));
console.log(`[build-data-bundle] ${entries.length} dictionary entries`);

fs.mkdirSync(outDir, { recursive: true });

// Stable bucket for a word. Must match the loader's bucketFor() in src/lib/dictionary.ts.
const BUCKET_COUNT = 32;
function bucketFor(word) {
  const w = (word || '').toLowerCase();
  let h = 0;
  for (let i = 0; i < w.length; i++) {
    h = (Math.imul(h, 31) + w.charCodeAt(i)) >>> 0;
  }
  return h % BUCKET_COUNT;
}

const buckets = new Map();
for (const e of entries) {
  const b = bucketFor(e.word);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(e);
}

let written = 0;
const shardFiles = [];
for (const [b, list] of buckets) {
  const file = path.join(outDir, `${b}.json`);
  fs.writeFileSync(file, JSON.stringify(list));
  shardFiles.push(`${b}.json`);
  written++;
}

// Index lists the exact shards that exist so the loader/SW never 404.
const index = {
  total: entries.length,
  bucketCount: BUCKET_COUNT,
  shards: shardFiles.sort(),
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));

console.log(`[build-data-bundle] wrote ${written} shards to public/data/dict/`);
