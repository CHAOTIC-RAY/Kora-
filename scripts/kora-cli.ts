#!/usr/bin/env node
/**
 * `kora` — a deliberately partial command-line client.
 *
 * WHAT EXISTS: `kora plugin validate <manifest.json>`
 * WHAT DOES NOT: library management, relay control, an SDK, publishing.
 *
 * That boundary is printed in `--help` and repeated in the command banner.
 * A partial CLI labelled as partial is useful — it catches a broken manifest
 * before anyone ships it. A partial CLI that implies a fuller toolchain is a
 * trap, because a pipeline gets written against a capability that is not
 * there.
 *
 * Exit codes, chosen so this is usable in a pre-commit hook:
 *   0  valid
 *   1  validation failed
 *   2  bad usage / unreadable file
 *
 * Run with: `npx tsx scripts/kora-cli.ts plugin validate ./source.json`
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { validateManifest } from "../src/lib/formats/pluginManifest";

const USAGE = `
kora — partial CLI for Kora plugin manifests

USAGE
  kora plugin validate <manifest.json>   Structural check on one manifest.

AVAILABLE COMMANDS
  plugin validate    Check id/name/version/category, and the endpoint or
                     theme requirements that match the plugin's category.

NOT AVAILABLE YET
  kora plugin library    manage a local library     (does not exist)
  kora plugin relay      configure a relay          (does not exist)
  kora publish           publish a plugin           (does not exist)
  SDK for embedding Kora                         (does not exist)

WHAT VALIDATE CHECKS
  Themes are checked with the app's own validateThemeTokens, so a manifest
  that passes here is one the app also accepts. It is a static check: it does
  not fetch URLs, run selectors, or install anything.

EXIT CODES
  0 valid   1 invalid   2 usage error
`.trim();

function fail(message: string): never {
  console.error(`kora: ${message}`);
  process.exit(2);
}

function main(argv: string[]): void {
  const [maybeGroup, maybeCmd, ...rest] = argv;

  if (!maybeGroup || maybeGroup === "--help" || maybeGroup === "-h" || maybeGroup === "help") {
    console.log(USAGE);
    process.exit(maybeGroup ? 0 : 2);
  }

  if (maybeGroup !== "plugin") {
    fail(`unknown command "${maybeGroup}". Run \`kora --help\` for what exists.`);
  }

  if (maybeCmd === "--help" || maybeCmd === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  if (maybeCmd !== "validate") {
    fail(
      `unknown plugin command "${maybeCmd ?? ""}". Only \`plugin validate\` exists — ` +
        "library, relay and publish are not implemented."
    );
  }

  const target = rest[0];
  if (!target) fail("plugin validate needs a manifest path. Usage: kora plugin validate <manifest.json>");
  if (rest.length > 1) fail("plugin validate takes exactly one manifest path.");

  const resolved = path.resolve(process.cwd(), target);
  let text: string;
  try {
    text = fs.readFileSync(resolved, "utf-8");
  } catch (e) {
    fail(`cannot read ${resolved}: ${(e as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    fail(`${target} is not valid JSON: ${(e as Error).message}`);
  }

  const report = validateManifest(parsed);

  if (report.summary) {
    const s = report.summary;
    console.log(`${s.name} (${s.id}) v${s.version} — ${s.category}`);
  } else {
    console.log(`${target}`);
  }

  const errors = report.findings.filter((f) => f.severity === "error");
  const warnings = report.findings.filter((f) => f.severity === "warning");

  for (const f of report.findings) {
    const tag = f.severity === "error" ? "error" : "warn ";
    console.log(`  ${tag}  ${f.path}: ${f.message}`);
  }

  if (report.ok && warnings.length === 0) {
    console.log("  ok    manifest is valid");
  } else if (report.ok) {
    console.log(`  ok    manifest is valid (${warnings.length} warning${warnings.length > 1 ? "s" : ""})`);
  } else {
    console.log(`\ninvalid: ${errors.length} error${errors.length > 1 ? "s" : ""}`);
  }

  process.exit(report.ok ? 0 : 1);
}

main(process.argv.slice(2));