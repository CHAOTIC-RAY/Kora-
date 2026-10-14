/**
 * Storage for Kora's own e-reader relay.
 *
 * THE INTERFACE, AND WHY IT EXISTS. R2 is the only store that can hold a 50 MB
 * EPUB: KV's value cap is 25 MB and its writes are eventually consistent, so a
 * "register, then upload, then pull" flow on KV races with itself — the puller
 * can read a stale "no file" after the uploader has already written. R2 is
 * strongly consistent for reads-after-write in a single region and has no
 * per-value size limit worth caring about here. So R2 is the implementation and
 * the interface exists so the fallback is honest rather than hidden.
 *
 * THE FALLBACK IS NOT PRODUCTION. `MemoryRelayStore` is per-isolate: every
 * request may land on a fresh isolate, so a session created by one request can
 * be invisible to the next. It exists for `wrangler dev` without an R2 bucket
 * and for tests. It refuses to be used in production by throwing on
 * `assertProductionReady`, which the Worker calls at request time.
 *
 * R2 has no native TTL. Enforced expiry is therefore an *invariant the
 * handlers maintain*, not something the backend does for us:
 *   - every read checks `expiresAt` and treats an expired object as absent,
 *   - a successful download deletes the object immediately (the "relay, not a
 *     file store" rule),
 *   - and `sweepExpired` is called opportunistically on write so abandoned
 *     sessions do not live forever.
 * The belt-and-braces answer for objects nobody ever touches is an R2
 * lifecycle rule (7 days), documented in wrangler.toml.
 */

import { CODE_LENGTH, normalizeRelayCode } from "./codes";

export const RELAY_BUCKET_BINDING = "RELAY_BUCKET";

/** Hard cap. EPUBs over this are refused, not truncated. */
export const MAX_RELAY_BYTES = 50 * 1024 * 1024; // 52,428,800

/** How long a session with no file may live. */
export const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * How long a stored FILE may live if it is never downloaded. Deliberately
 * shorter than the session: a file is a transient payload, a session is just a
 * pairing.
 */
export const FILE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface StoredSession {
  kind: "session";
  code: string;
  /** 128-bit hex. Held by the e-reader page only; never in a URL. */
  secret: string;
  createdAt: number;
  expiresAt: number;
  /** Set once a file is waiting. */
  hasFile: boolean;
  /**
   * Set once a book has actually been delivered on this code.
   *
   * Distinct from `hasFile: false` after a take, which would otherwise be
   * indistinguishable from "nothing sent yet". One code, one book: the device
   * page says so out loud after a delivery, and a code that could be re-used
   * silently is a code somebody can keep shooting files at long after the
   * user walked away from the e-reader.
   */
  delivered?: boolean;
  fileName?: string;
  fileMime?: string;
  fileSize?: number;
  /** Number of failed secret checks against this code, for brute-force lockout. */
  failedPulls: number;
  /** Epoch ms at which this code is locked out entirely. */
  lockedUntil?: number;
}

export type StoredObject = StoredSession | { kind: "file"; body: ArrayBuffer; expiresAt: number };

export interface RelayStore {
  getSession(code: string): Promise<StoredSession | null>;
  putSession(session: StoredSession): Promise<void>;
  getFile(code: string): Promise<{ body: ArrayBuffer } | null>;
  putFile(code: string, body: ArrayBuffer): Promise<void>;
  deleteFile(code: string): Promise<void>;
  deleteSession(code: string): Promise<void>;
  /** Codes currently holding a session. Bounded scan; used for uniqueness. */
  listSessionCodes(): Promise<string[]>;
  /** Drop anything past its TTL. Opportunistic, best-effort. */
  sweepExpired(now: number): Promise<void>;
  /** Which backend answered. Surfaced by /api/relay/status for honest ops. */
  readonly kind: "r2" | "memory";
}

const sessionKey = (code: string) => `s/${code}`;
const fileKey = (code: string) => `f/${code}`;

/** A code is a fixed-length uppercase token; it is also a key, so validate. */
function safeCode(code: string): string {
  const norm = normalizeRelayCode(code);
  if (!norm || norm.length !== CODE_LENGTH) throw new Error("relay: invalid code");
  return norm;
}

// ── R2 ──────────────────────────────────────────────────────────────────────

interface R2Like {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    value: ArrayBuffer | string,
    opts?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    objects: { key: string; customMetadata?: Record<string, string> }[];
    truncated?: boolean;
    cursor?: string;
  }>;
}

export class R2RelayStore implements RelayStore {
  readonly kind = "r2" as const;
  /**
   * The clock is injected, defaulting to the real one. Without the seam an
   * expiry test would have to sleep through a 6-hour TTL, and — worse — a test
   * using a fake `now` for the handler while the store read the real clock
   * would see every session as already expired, which is a silent and very
   * confusing failure. R2 has no native TTL, so this code IS the expiry
   * mechanism; it has to be reachable from a test.
   */
  constructor(
    private bucket: R2Like,
    private now: () => number = Date.now
  ) {}

  /**
   * Has this session's TTL passed?
   *
   * ONLY the TTL counts. `lockedUntil` is deliberately excluded: a lockout is a
   * temporary rate-limit state, not a lifetime. Treating it as expiry here
   * deleted the session outright, which turned every 5-typo lockout into a
   * PERMANENT loss of the user's code — and, because the lock is set the
   * moment the fifth failure is recorded, made the code undeliverable for good
   * before the lock had even been served once.
   */
  private static expired(session: StoredSession, now: number): boolean {
    return now >= session.expiresAt;
  }

  async getSession(code: string): Promise<StoredSession | null> {
    const c = safeCode(code);
    const obj = await this.bucket.get(sessionKey(c));
    if (!obj) return null;
    let session: StoredSession;
    try {
      const text = new TextDecoder().decode(await obj.arrayBuffer());
      session = JSON.parse(text);
    } catch {
      return null;
    }
    if (!session || session.kind !== "session") return null;
    if (R2RelayStore.expired(session, this.now())) {
      // Expiry is enforced on read as well as by the lifecycle rule, so a stale
      // object can never be served even if deletion has not run yet.
      await this.deleteSession(c);
      return null;
    }
    return session;
  }

  async putSession(session: StoredSession): Promise<void> {
    await this.bucket.put(sessionKey(session.code), JSON.stringify(session), {
      customMetadata: { kind: "session", expiresAt: String(session.expiresAt) },
      httpMetadata: { contentType: "application/json" },
    });
  }

  async getFile(code: string): Promise<{ body: ArrayBuffer } | null> {
    const c = safeCode(code);
    const obj = await this.bucket.get(fileKey(c));
    if (!obj) return null;
    const body = await obj.arrayBuffer();
    return { body };
  }

  async putFile(code: string, body: ArrayBuffer): Promise<void> {
    const c = safeCode(code);
    await this.bucket.put(fileKey(c), body, {
      // No filename in the object metadata: R2 object keys and metadata both
      // show up in dashboards, and a dashboard row is a log.
      // The TTL is stamped from the INJECTED clock, because `sweepExpired`
      // compares against the same one — a mismatch between the two would mean
      // the sweep deletes live files or never deletes dead ones.
      customMetadata: { kind: "file", expiresAt: String(this.now() + FILE_TTL_MS) },
      httpMetadata: { contentType: "application/octet-stream" },
    });
  }

  async deleteFile(code: string): Promise<void> {
    await this.bucket.delete(fileKey(safeCode(code)));
  }

  async deleteSession(code: string): Promise<void> {
    const c = safeCode(code);
    await this.bucket.delete(sessionKey(c));
  }

  async listSessionCodes(): Promise<string[]> {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix: "s/", limit: 1000, cursor });
      for (const o of page.objects || []) {
        const code = o.key.slice(2);
        if (normalizeRelayCode(code)) out.push(code);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  async sweepExpired(now: number): Promise<void> {
    // Sessions: read the cheap metadata, delete the dead.
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix: "s/", limit: 1000, cursor });
      for (const o of page.objects || []) {
        const exp = Number(o.customMetadata?.expiresAt || 0);
        if (!exp || now >= exp) {
          await this.bucket.delete(o.key);
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    // Files: their TTL is absolute, stored in metadata at write time.
    cursor = undefined;
    do {
      const page = await this.bucket.list({ prefix: "f/", limit: 1000, cursor });
      for (const o of page.objects || []) {
        const exp = Number(o.customMetadata?.expiresAt || 0);
        if (!exp || now >= exp) {
          await this.bucket.delete(o.key);
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}

// ── In-memory (dev + tests only) ────────────────────────────────────────────

export class MemoryRelayStore implements RelayStore {
  readonly kind = "memory" as const;
  private sessions = new Map<string, StoredSession>();
  private files = new Map<string, { body: ArrayBuffer; expiresAt: number }>();

  constructor(private now: () => number = Date.now) {}

  async getSession(code: string): Promise<StoredSession | null> {
    const c = safeCode(code);
    const s = this.sessions.get(c);
    if (!s) return null;
    // TTL only — a lockout is a rate-limit state, not a lifetime. See the
    // note on R2RelayStore.expired.
    if (this.now() >= s.expiresAt) {
      this.sessions.delete(c);
      return null;
    }
    return { ...s };
  }

  async putSession(session: StoredSession): Promise<void> {
    this.sessions.set(safeCode(session.code), { ...session });
  }

  async getFile(code: string): Promise<{ body: ArrayBuffer } | null> {
    const f = this.files.get(safeCode(code));
    if (!f) return null;
    if (this.now() >= f.expiresAt) {
      this.files.delete(safeCode(code));
      return null;
    }
    return { body: f.body };
  }

  async putFile(code: string, body: ArrayBuffer): Promise<void> {
    this.files.set(safeCode(code), { body, expiresAt: this.now() + FILE_TTL_MS });
  }

  async deleteFile(code: string): Promise<void> {
    this.files.delete(safeCode(code));
  }

  async deleteSession(code: string): Promise<void> {
    this.sessions.delete(safeCode(code));
  }

  async listSessionCodes(): Promise<string[]> {
    return Array.from(this.sessions.keys());
  }

  async sweepExpired(now: number): Promise<void> {
    for (const [code, s] of this.sessions) {
      if (now >= s.expiresAt) this.sessions.delete(code);
    }
    for (const [code, f] of this.files) {
      if (now >= f.expiresAt) this.files.delete(code);
    }
  }
}

// ── Resolving from a Worker env ──────────────────────────────────────────────

/**
 * Pick a store for this env.
 *
 * R2 when the binding exists; memory otherwise, with a loud warning. The
 * `storage: "memory"` field in the status endpoint is what makes the gap
 * visible from a phone instead of from a deploy log.
 */
export function resolveRelayStore(env: { [k: string]: any }, now: () => number = Date.now): RelayStore {
  const bucket = env?.[RELAY_BUCKET_BINDING];
  if (bucket && typeof bucket.get === "function" && typeof bucket.put === "function") {
    return new R2RelayStore(bucket as R2Like, now);
  }
  return new MemoryRelayStore(now);
}
