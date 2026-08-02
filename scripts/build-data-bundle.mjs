// Phase 3.5 (adapted from 3.1): shard the 2 MB dictionary-data.json into
// per-initial-letter JSON files under public/data/dict/ so the reader only ever
// fetches the one shard a tapped word belongs to (instead of parsing the whole
// file on the main thread at startup).
//
// The web host / Capacitor APK serves these as static assets; they are also
// precached + cache-firsted by the service worker (Phase 3.2), so lookups work
// fully offline. Run automatically by `npm run build`.

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

// Bucket by first alphanumeric character (lowercased). Non-letter first chars
// (symbols, digits) collapse into "#".
function bucket(word) {
  const w = (word || '').trim().toLowerCase();
  const c = w[0] || '#';
  if (/[a-z]/.test(c)) return c;
  if (/[0-9]/.test(c)) return '0'; // digits
  return '#';
}

const buckets = new Map();
for (const e of entries) {
  const b = bucket(e.word);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(e);
}

let written = 0;
for (const [letter, list] of buckets) {
  const file = path.join(outDir, `${letter}.json`);
  fs.writeFileSync(file, JSON.stringify(list));
  written++;
}
// Index file: letter -> count, lets the loader know what shards exist.
const index = { total: entries.length, shards: written, generatedAt: new Date().toISOString() };
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));

console.log(`[build-data-bundle] wrote ${written} shards to public/data/dict/`);
