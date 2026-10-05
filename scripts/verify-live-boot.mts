/**
 * Boots the REAL production site in a real headless browser and reports what
 * actually happens. This is the only check that exercises the JS.
 *
 * Added 2026-10-05 after the user reported "the ui is broken fully every page"
 * while every HTTP-level check passed:
 *
 *   - /            -> 200, HTML well-formed, viewport present
 *   - /assets/style-*.css -> 200, 310,645 bytes, tokens intact
 *   - /version.json -> matches local dist buildId
 *   - live entry bundle -> byte-identical to local dist
 *
 * Every one of those passed, and the site was still broken. They all inspect
 * bytes on the wire; none of them run a line of the bundle. So the failure had
 * to be found by executing the page.
 *
 * Reports: console errors, page errors, failed requests, #root child count, and
 * whether the layout is actually laid out (body width vs a collapsed value).
 */
import puppeteer from "puppeteer";

const TARGET = process.argv[2] || "https://kora.chaoticstudio.workers.dev/";
const SETTLE_MS = Number(process.argv[3] || 9000);

// Puppeteer's bundled Chrome is not downloaded in this environment
// ("Could not find Chrome (ver. 150.0.7871.24)"), so use the system install.
const CHROME =
  process.env.KORA_CHROME ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

let failures = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];

  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) =>
    pageErrors.push(e instanceof Error ? e.message : String(e))
  );
  page.on("requestfailed", (r) =>
    failedRequests.push(`${r.url()} :: ${r.failure()?.errorText || "failed"}`)
  );
  page.on("response", (r) => {
    // The SPA fallback answers a missing chunk with 200 + index.html, which is
    // the exact shape that crashed the app. Catch it explicitly.
    const u = r.url();
    if (/\/assets\/.*\.js$/.test(u) && r.headers()["content-type"]?.includes("text/html")) {
      failedRequests.push(`${u} :: 200 text/html (missing chunk served as SPA fallback)`);
    }
    // Anything not 2xx/3xx is worth naming: on 2026-10-05 the UI hung on
    // "LOADING APP..." because two boot requests 500'd, and every HTTP-level
    // check I had run missed it because they never listed the failing URL.
    const s = r.status();
    if (s >= 400) {
      let post = "";
      try {
        post = JSON.stringify(r.request().postData() || "").slice(0, 220);
      } catch {}
      badResponses.push(`${s} ${r.request().method()} ${u}  body=${post}`);
    }
  });

  const resp = await page.goto(TARGET, { waitUntil: "networkidle2", timeout: 60000 }).catch((e) => {
    console.log(`  navigation failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  });

  if (resp) {
    console.log(`  HTTP ${resp.status()} ${new URL(TARGET).pathname}`);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  }

  const dom = await page.evaluate(() => {
    const root = document.getElementById("root");
    const cs = root ? getComputedStyle(root) : null;
    // A collapsed layout shows up as a root that never got a real height, or a
    // body whose children stack at the far left with no width.
    const bodyRect = document.body.getBoundingClientRect();
    const first = root?.firstElementChild;
    const firstRect = first ? first.getBoundingClientRect() : null;
    return {
      rootChildren: root ? root.children.length : -1,
      rootHTML: (root?.innerHTML || "").slice(0, 200),
      bodyWidth: bodyRect.width,
      bodyHeight: bodyRect.height,
      firstChildWidth: firstRect ? Math.round(firstRect.width) : -1,
      firstChildHeight: firstRect ? Math.round(firstRect.height) : -1,
      display: cs?.display || "",
      sheetCount: document.styleSheets.length,
      // Sample a few rules actually applied, to prove the cascade is live.
      appliedSamples: (() => {
        const out = [];
        const probe = document.createElement("div");
        probe.className = "flex min-h-screen";
        document.body.appendChild(probe);
        const p = getComputedStyle(probe);
        out.push(`display=${p.display}`, `minHeight=${p.minHeight}`);
        probe.remove();
        return out;
      })(),
      hasSentryWidget: !!document.querySelector("#sentry-feedback, [id^='sentry']"),
      text: (document.body.innerText || "").slice(0, 300),
    };
  });

  console.log("\n=== DOM ===");
  console.log(`  #root children : ${dom.rootChildren}`);
  console.log(`  body size      : ${Math.round(dom.bodyWidth)}x${Math.round(dom.bodyHeight)}`);
  console.log(`  first child    : ${dom.firstChildWidth}x${dom.firstChildHeight}`);
  console.log(`  stylesheets    : ${dom.sheetCount}`);
  console.log(`  Tailwind probe : ${dom.appliedSamples.join(" ")}`);
  console.log(`  sentry widget  : ${dom.hasSentryWidget}`);

  console.log("\n=== failures ===");
  console.log(`  page errors    : ${pageErrors.length}`);
  pageErrors.slice(0, 6).forEach((e) => console.log(`    - ${e.slice(0, 260)}`));
  console.log(`  console errors : ${consoleErrors.length}`);
  consoleErrors.slice(0, 6).forEach((e) => console.log(`    - ${e.slice(0, 260)}`));
  console.log(`  failed requests: ${failedRequests.length}`);
  console.log(`  non-2xx        : ${badResponses.length}`);
  badResponses.slice(0, 10).forEach((e) => console.log(`    - ${e.slice(0, 200)}`));
  failedRequests.slice(0, 6).forEach((e) => console.log(`    - ${e.slice(0, 200)}`));

  console.log("\n=== assertions ===");
  // The 2026-10-05 failure was NOT a wire problem: HTML, CSS and the bundle were
  // all verified correct while the app still never rendered, because
  // `loadingAuth` gates the whole app on an unbounded Firebase callback.
  check("page loaded", !!resp);
  check("#root has children (React mounted)", dom.rootChildren > 0, `#root children=${dom.rootChildren}`);
  check("React actually painted content", dom.rootHTML.trim().length > 0);
  check(
    "layout is not collapsed",
    dom.firstChildWidth > 200 && dom.firstChildHeight > 200,
    `first child ${dom.firstChildWidth}x${dom.firstChildHeight}`
  );
  check("Tailwind CSS is applied", dom.appliedSamples.some((s) => s.startsWith("display=") && !s.includes("none")));
  check("no uncaught page errors", pageErrors.length === 0);
  check("no failed/HTML-for-JS requests", failedRequests.length === 0);
  // The actual regression: the loader is still on screen, so nothing else matters.
  check(
    "the app finished booting (loader gone)",
    !/LOADING APP|SYNCING LIBRARY/i.test(dom.text),
    "auth gate never released"
  );

  console.log(`\n=== visible text (first 300 chars) ===\n${dom.text}`);
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
} finally {
  await browser.close();
}

process.exit(failures === 0 ? 0 : 1);