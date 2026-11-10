#!/usr/bin/env node
/**
 * Lightweight synthetic checks for core HTTP APIs (dev server on :5000).
 */
const base = process.env.KORA_TEST_ORIGIN || "http://127.0.0.1:5000";

const checks = [
  { name: "google-books", path: "/api/google-books/search?q=test&maxResults=1" },
  { name: "nytimes-overview", path: "/api/nytimes/overview" },
  {
    name: "source-fetch",
    path: `/api/source-fetch?u=${encodeURIComponent("https://raw.githubusercontent.com/CHAOTIC-RAY/Kora-Plugins/main/index.json")}&b=${encodeURIComponent("https://raw.githubusercontent.com")}`,
  },
];

let failed = 0;
for (const { name, path } of checks) {
  try {
    const res = await fetch(`${base}${path}`);
    const ok = res.status < 500;
    if (!ok) {
      console.error(`[health] ${name}: HTTP ${res.status}`);
      failed++;
    } else {
      console.log(`[health] ${name}: ok (${res.status})`);
    }
  } catch (e) {
    console.error(`[health] ${name}: unreachable`, e.message);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
