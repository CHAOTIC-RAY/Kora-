// Phase 0 of the perf plan: print raw + gzip + brotli totals per chunk so every
// later change is provable against a baseline. Run via `npm run size`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dist = path.resolve(process.cwd(), 'dist', 'assets');
if (!fs.existsSync(dist)) {
  console.error('No dist/assets found — run `vite build` first.');
  process.exit(1);
}

function sizeOf(p) {
  const buf = fs.readFileSync(p);
  const gz = zlib.gzipSync(buf, { level: 9 }).length;
  const br = zlib.brotliCompressSync(buf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  return { raw: buf.length, gz, br };
}

const groups = {};
for (const f of fs.readdirSync(dist)) {
  const m = f.match(/^(.*?)(?:-[A-Za-z0-9_-]+)?\.(js|css)$/);
  if (!m) continue;
  const base = m[1] === 'index' ? 'app' : m[1];
  const kind = m[2];
  const s = sizeOf(path.join(dist, f));
  groups[base] = groups[base] || { js: { raw: 0, gz: 0, br: 0 }, css: { raw: 0, gz: 0, br: 0 } };
  groups[base][kind].raw += s.raw;
  groups[base][kind].gz += s.gz;
  groups[base][kind].br += s.br;
}

let totRaw = 0, totGz = 0, totBr = 0;
const fmt = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log('\n=== Kora bundle sizes (raw / gzip / brotli) ===');
for (const [name, g] of Object.entries(groups).sort((a, b) => b[1].js.raw - a[1].js.raw)) {
  const { raw, gz, br } = g.js;
  totRaw += raw; totGz += gz; totBr += br;
  console.log(`${name.padEnd(22)} js  ${fmt(raw).padStart(10)} / ${fmt(gz).padStart(9)} / ${fmt(br).padStart(9)}`);
  if (g.css.raw) {
    console.log(`${''.padEnd(22)} css ${fmt(g.css.raw).padStart(10)} / ${fmt(g.css.gz).padStart(9)} / ${fmt(g.css.br).padStart(9)}`);
    totRaw += g.css.raw; totGz += g.css.gz; totBr += g.css.br;
  }
}
console.log('─'.repeat(56));
console.log(`TOTAL                 ${fmt(totRaw).padStart(10)} / ${fmt(totGz).padStart(9)} / ${fmt(totBr).padStart(9)}`);
console.log('');
