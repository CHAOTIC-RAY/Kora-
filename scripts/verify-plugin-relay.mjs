#!/usr/bin/env node
/**
 * Smoke-test /api/source-fetch against a running server (default :5000).
 */
import { spawnSync } from "node:child_process";

const base = process.env.KORA_TEST_ORIGIN || "http://127.0.0.1:5000";
const u = encodeURIComponent("https://gutendex.com/books/?search=pride");
const b = encodeURIComponent("https://gutendex.com");
const url = `${base}/api/source-fetch?u=${u}&b=${b}`;

let res;
try {
  res = await fetch(url);
} catch (e) {
  console.error("plugin relay smoke: server not reachable at", base, e);
  process.exit(1);
}
const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  console.error("plugin relay smoke: non-JSON response", res.status, text.slice(0, 200));
  process.exit(1);
}
if (!res.ok || !json.ok) {
  console.error("plugin relay smoke failed", res.status, json);
  process.exit(1);
}
if (!json.body || json.body.length < 20) {
  console.error("plugin relay smoke: empty body");
  process.exit(1);
}
console.log("plugin relay smoke: ok", json.status, "bytes", json.body.length);
process.exit(0);
