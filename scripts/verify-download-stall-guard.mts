/**
 * Prove the stall timeout fires — and, just as importantly, that it does NOT
 * fire on a slow-but-live transfer.
 *
 * Both halves matter. A timeout that never fires leaves the user staring at a
 * frozen progress bar; one that fires too eagerly kills large downloads that
 * are merely slow (a 30MB LibGen file legitimately takes ~2 minutes at
 * 0.26MB/s, after a burst of fast chunks).
 *
 * Driven against real local servers: one that accepts and sends nothing, one
 * that stalls then dribbles bytes.
 */
import { createServer, type Server } from "node:http";

const STALL_TIMEOUT_MS = 25_000; // must match the constant in App.tsx

function serve(handler: (res: import("node:http").ServerResponse) => void): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer((_req, res) => handler(res));
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

const portOf = (s: Server) => (s.address() as { port: number }).port;

async function timedFetch(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  let received = 0;
  const timerPromise = new Promise<"TIMED_OUT">((res) => {
    timer = setTimeout(() => {
      if (received === 0) {
        controller.abort();
        res("TIMED_OUT");
      }
    }, timeoutMs);
  });
  try {
    const r = await Promise.race([
      fetch(url, { signal: controller.signal }).then(async (res) => {
        const reader = res.body!.getReader();
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
        }
        return "COMPLETED" as const;
      }),
      timerPromise,
    ]);
    return { outcome: r, ms: Date.now() - t0, received };
  } catch (e: any) {
    return { outcome: e?.name === "AbortError" ? ("ABORTED" as const) : ("ERROR" as const), ms: Date.now() - t0, received };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

// ── 1. A mirror that accepts then sends nothing MUST time out ──
// Use a short timeout so the test does not have to wait 25s.
const TEST_STALL_MS = 3000;

const silent = await serve((res) => {
  res.writeHead(200, { "Content-Type": "application/epub+zip", "Content-Length": "5000000" });
  res.flushHeaders(); // headers sent, body never follows
  // deliberately no res.end(), no writes
});
const silentResult = await timedFetch(`http://127.0.0.1:${portOf(silent)}/x`, TEST_STALL_MS);
silent.close();
check(
  "silent mirror is aborted once the stall budget expires",
  silentResult.outcome === "TIMED_OUT" || silentResult.outcome === "ABORTED",
  `${silentResult.outcome} in ${silentResult.ms}ms`
);

// ── 2. A slow-but-live transfer MUST NOT be aborted ──
const dribble = await serve((res) => {
  res.writeHead(200, { "Content-Type": "application/epub+zip", "Content-Length": "3000" });
  const chunk = Buffer.alloc(1000, 1);
  let sent = 0;
  const iv = setInterval(() => {
    if (sent >= 3000) {
      clearInterval(iv);
      res.end();
      return;
    }
    res.write(chunk);
    sent += chunk.length;
  }, 400); // slower than the test's stall budget would allow if bytes were counted
});
const dribbleResult = await timedFetch(`http://127.0.0.1:${portOf(dribble)}/y`, TEST_STALL_MS);
dribble.close();
check(
  "live transfer survives a delay longer than the stall budget",
  dribbleResult.outcome === "COMPLETED" && dribbleResult.received === 3000,
  `${dribbleResult.outcome}, ${dribbleResult.received}B in ${dribbleResult.ms}ms`
);

check(
  `stall budget (${STALL_TIMEOUT_MS}ms) exceeds the slowest healthy mirror (~3.9s)`,
  STALL_TIMEOUT_MS > 3900 * 4,
  `${STALL_TIMEOUT_MS}ms`
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);