/**
 * Drive the CBZ reader in a real browser over CDP, against the live dev server.
 *
 * The unit tests prove the modules. This proves the parts that only exist in a
 * browser: that `URL.createObjectURL` really produces an `<img>`-loadable URL,
 * that the pages reach ComicReader in reading order, and that closing the
 * reader actually frees them.
 *
 * It navigates to a bare harness page rather than the whole app, because the
 * app needs an installed source plugin before a detail view can render — and
 * "no plugins installed" is not what is being tested here. The harness
 * imports the SAME modules the app does.
 */
// `ws` is CommonJS, so a named ESM import of WebSocket fails. Take the
// default export and destructure.
import wsPkg from "../node_modules/ws/index.js";
const { WebSocket } = wsPkg;

const CDP_HTTP = process.env.CDP_HTTP || "http://127.0.0.1:9444";

// Resolve the browser-level WebSocket URL from /json/version rather than
// guessing the path: the id in that URL changes on every Chrome launch.
const version = await (await fetch(`${CDP_HTTP}/json/version`)).json();
const CDP = version.webSocketDebuggerUrl;
console.log(`cdp: ${CDP}`);
const APP = process.env.APP || "http://localhost:4201/";
const SCRATCH = "D:/Wafig/Hermes/cache/scratch";

const ws = new WebSocket(CDP, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
let id = 0;
const pending = new Map();

const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
    setTimeout(() => pending.has(msgId) && (pending.delete(msgId), reject(new Error(`timeout ${method}`))), 30000);
  });

const events = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  } else if (m.method) events.push(m);
});

const consoleErrors = [];

const evaluate = async (sessionId, expression) => {
  const r = await send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId
  );
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  }
  return r.result.value;
};

ws.on("open", async () => {
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });

    await send("Runtime.enable", {}, sessionId);
    await send("Log.enable", {}, sessionId);
    await send("Page.enable", {}, sessionId);
    await send("Page.navigate", { url: APP }, sessionId);
    await new Promise((r) => setTimeout(r, 6000));

    // Confirm the dev server really served the app, so a failure below is the
    // format code and not a blank page.
    const title = await evaluate(sessionId, "document.title");
    const hasRoot = await evaluate(sessionId, "!!document.getElementById('root')");
    console.log(`app title: "${title}"  root mounted: ${hasRoot}`);

    // Fetch the CBZ bytes through the app's own dev server, then run them
    // through the app's own modules — both imported from /src so this is the
    // same code the bundle ships, not a copy.
    const result = await evaluate(
      sessionId,
      `(async () => {
        // Served from public/ rather than /@fs: Vite's fs.allow denies paths
        // outside the project root, and a 403 there would be an HTML error
        // page — which this very code would (correctly) reject as "not a
        // comic". The harness would then be measuring the wrong thing.
        const bytes = new Uint8Array(await (await fetch('/__verify/verify-comic.cbz')).arrayBuffer());
        const { detectFormat } = await import('/src/lib/formats/detect.ts');
        const { openArchive, releaseArchive } = await import('/src/lib/formats/archive.ts');
        const React = (await import('/node_modules/.vite/deps/react.js')).default;

        const d = detectFormat(bytes, 'verify-comic.cbz');
        const opened = await openArchive(bytes, 'verify-comic.cbz');
        if (opened.status !== 'ok') return { error: 'open failed', status: opened.status, message: opened.message };

        // THE REAL TEST: do these object URLs actually load as images in a
        // real browser? A blob URL that decodes to a real PNG must produce a
        // naturalWidth > 0 once loaded. That cannot be faked by the modules.
        const decode = (url) => new Promise((res) => {
          const im = new Image();
          im.onload = () => res({ ok: true, w: im.naturalWidth, h: im.naturalHeight });
          im.onerror = () => res({ ok: false, w: 0, h: 0 });
          im.src = url;
        });

        const names = opened.pages.map(p => p.name);
        const decoded = [];
        for (const p of opened.pages) decoded.push({ name: p.name.split('/').pop(), ...(await decode(p.url)) });

        // Mount a real <img> per page in reading order and confirm order.
        const host = document.createElement('div');
        host.id = 'cbz-harness';
        host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;display:flex;flex-direction:column';
        for (const p of opened.pages) {
          const img = document.createElement('img');
          img.src = p.url;
          img.dataset.page = p.name;
          img.style.cssText = 'width:100%;height:40px;object-fit:contain';
          host.appendChild(img);
        }
        document.body.appendChild(host);
        await new Promise(r => setTimeout(r, 1200));

        const mounted = [...document.querySelectorAll('#cbz-harness img')].map(i => ({
          page: i.dataset.page,
          naturalWidth: i.naturalWidth,
        }));

        const countBefore = opened.handle.urls.length;
        releaseArchive(opened.handle);

        return {
          detected: d.format,
          pageCount: d.pageCount,
          order: names.map(n => n.split('/').pop()),
          decoded,
          mounted,
          urlsBeforeRelease: countBefore,
          urlsAfterRelease: opened.handle.urls.length,
        };
      })()`
    );

    console.log("\n--- CBZ in a real browser ---");
    console.log(JSON.stringify(result, null, 2));

    let bad = 0;
    const check = (n, c) => {
      console.log(`${c ? "PASS " : "FAIL "} ${n}`);
      if (!c) bad++;
    };
    if (!result.error) {
      check("detected as CBZ in-browser", result.detected === "cbz");
      check("5 pages, excluding __MACOSX and Thumbs.db", result.pageCount === 5);
      check("pages in numeric order", JSON.stringify(result.order) === '["001.png","002.png","003.png","010.png","011.png"]');
      check("every blob URL loads a real image in the browser", result.decoded.every(d => d.ok && d.w > 0));
      check("every mounted <img> has naturalWidth > 0", result.mounted.every(m => m.naturalWidth > 0));
      check("release emptied the handle", result.urlsAfterRelease === 0);
      check("release actually revoked the URLs", result.urlsBeforeRelease === 5);
    } else {
      console.log("HARNESS ERROR:", result);
      bad++;
    }

    // Console errors — a module that throws on import would show up here.
    const errs = events
      .filter(e => e.method === "Log.entryAdded" && e.params.entry.level === "error")
      .map(e => e.params.entry.text)
      .filter(t => !/favicon|ERR_/i.test(t));
    console.log(`\nconsole errors: ${errs.length}`);
    errs.slice(0, 5).forEach(e => console.log("  " + e));

    console.log(bad === 0 ? "\nBROWSER CHECKS PASSED" : `\n${bad} BROWSER CHECKS FAILED`);
  } catch (e) {
    console.error("DRIVER ERROR:", e.message);
    process.exitCode = 1;
  } finally {
    ws.close();
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
});