/**
 * Mirror health storage — where the tallies live.
 *
 * ── PRIVACY (hard rule, do not soften) ──────────────────────────────────────
 * This store accepts a MIRROR HOST and a VERDICT. Nothing else. No title, no
 * author, no filename, no ISBN, no size, no user id. That is not minimalism,
 * it is a privacy boundary: `title` + `mirrorHost` + a timestamp is a log of
 * what a specific person read, and "which mirrors does this reader use" is
 * identifying once you have a handful of records. The verdict carries no
 * identifying content because the verdict is computed by the CLIENT from its
 * own bytes and describes only the FORMAT of those bytes ("epub" / "html"),
 * never the work. Anything not in this list is dropped on the floor.
 *
 * ── Why untrusted input can be counted ──────────────────────────────────────
 * The endpoint is unauthenticated and write-shaped, so a hostile caller could
 * otherwise bury a good mirror under fake failures or prop up a dead one with
 * fake successes. Two defences, both implemented here:
 *   1. PER-IP CLAMP — one IP's decayed contribution to a single host is capped
 *      at RANKING.spamBurstCap reports per RANKING.spamWindowHours. Reports
 *      past the cap are recorded as ignored, not counted. A spam burst
 *      therefore cannot move a score past the cap no matter how many requests
 *      it sends.
 *   2. FREE-FORM FIELDS IGNORED — the caller may send whatever it likes;
 *      `readOutcomePayload` reads only `host` and `verdict` and returns null
 *      for everything else, so a caller cannot smuggle a weight, a timestamp,
 *      or a per-IP cap override in.
 *
 * ── Storage: in-memory with a KV TODO ──────────────────────────────────────
 * Cloudflare Workers isolates are ephemeral and per-colo, so today the tallies
 * do NOT survive and are NOT consistent between users. That is acceptable for
 * ranking (it degrades to probe-only, never to a fake score) but it is not the
 * intended end state.
 *
 * TODO(KV): add to wrangler.toml in all three environments (top-level,
 *   [env.production], [env.beta]):
 *     [[kv_namespaces]]
 *     binding = "MIRROR_HEALTH"
 *     id = "<create with: npx wrangler kv namespace create MIRROR_HEALTH>"
 *   Then implement `KvMirrorStore` below against `env.MIRROR_HEALTH` and pick
 *   it in `resolveMirrorStore(env)` — the interface is already KV-shaped
 *   (`get`/`put` with an expirationTtl) precisely so that swap is ~15 lines.
 *   One key per host: `mh:v1:<host>` -> JSON record.
 */
import {
  addOutcome,
  emptyTally,
  isReportableVerdict,
  normalizeHost,
  RANKING,
  type MirrorHealthRecord,
  type MirrorVerdict,
} from "./mirrorHealth";

/** KV-shaped so a real KV binding is a drop-in, not a rewrite. */
export interface MirrorStore {
  get(host: string): Promise<MirrorHealthRecord | null>;
  put(host: string, record: MirrorHealthRecord): Promise<void>;
}

export function newRecord(host: string): MirrorHealthRecord {
  return { host, user: emptyTally(), probe: emptyTally() };
}

/**
 * In-memory store. Ephemeral and per-isolate — see the KV TODO above.
 */
export class MemoryMirrorStore implements MirrorStore {
  private map = new Map<string, MirrorHealthRecord>();

  async get(host: string): Promise<MirrorHealthRecord | null> {
    return this.map.get(host) ?? null;
  }

  async put(host: string, record: MirrorHealthRecord): Promise<void> {
    this.map.set(host, record);
  }
}

let singleton: MemoryMirrorStore | null = null;
export function memoryMirrorStore(): MemoryMirrorStore {
  if (!singleton) singleton = new MemoryMirrorStore();
  return singleton;
}

export function resolveMirrorStore(env: any): MirrorStore {
  // TODO(KV): `if (env?.MIRROR_HEALTH) return new KvMirrorStore(env.MIRROR_HEALTH);`
  void env;
  return memoryMirrorStore();
}

/* ──────────────────────────────── payload ───────────────────────────────── */

/** The ONLY two fields that survive parsing. */
export interface OutcomePayload {
  host: string;
  verdict: MirrorVerdict;
}

/**
 * Parse a client-reported outcome. Returns null unless the payload is a valid
 * `{host, verdict}` pair. Every other field is ignored — including anything
 * that looks like a weight, a count, a timestamp, or a client-supplied cap.
 */
export function readOutcomePayload(raw: unknown): OutcomePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // `normalizeHost` returns "" for anything that is not a valid public
  // hostname — including the `..` that `../../etc/passwd` collapses to, which
  // would otherwise become a storage key aimed at a traversal path.
  const host = normalizeHost(typeof o.host === "string" ? o.host : "");
  if (!host) return null;
  if (!isReportableVerdict(o.verdict)) return null;
  return { host, verdict: o.verdict };
}

/* ─────────────────────────── spam containment ──────────────────────────── */

export interface IpAllowance {
  /** Report timestamps inside the current window for this ip+host pair. */
  stamps: number[];
}

export interface RecordResult {
  accepted: boolean;
  /** True when the report was valid but beyond this IP's burst cap. */
  capped: boolean;
  record: MirrorHealthRecord;
}

/**
 * Record a user-reported outcome, enforcing the per-IP burst cap.
 *
 * The cap is keyed on ip+host, so a spammer is limited per mirror and cannot
 * rotate through hosts to inflate one aggregate; and it is enforced BEFORE the
 * tally is mutated, so a rejected report has no effect on the score at all.
 */
export async function recordUserOutcome(
  store: MirrorStore,
  allowances: Map<string, IpAllowance>,
  payload: OutcomePayload,
  ip: string,
  now: number,
  probeVerdictOf?: (host: string) => Promise<MirrorVerdict | null>
): Promise<RecordResult> {
  const key = `${ip}|${payload.host}`;
  const windowMs = RANKING.spamWindowHours * 3_600_000;

  let allow = allowances.get(key);
  if (!allow) {
    allow = { stamps: [] };
    allowances.set(key, allow);
  }
  // Drop stamps that fell out of the window before counting the new one.
  allow.stamps = allow.stamps.filter((t) => now - t < windowMs);

  const existing = (await store.get(payload.host)) ?? newRecord(payload.host);

  if (allow.stamps.length >= RANKING.spamBurstCap) {
    return { accepted: false, capped: true, record: existing };
  }

  allow.stamps.push(now);

  // Free-form override, if a caller ever adds one. Not part of the payload
  // contract — recorded here so an accidental future field is visible.
  void probeVerdictOf;

  const record: MirrorHealthRecord = {
    ...existing,
    host: payload.host,
    user: addOutcome(existing.user, payload.verdict, now, RANKING.userHalfLifeDays, now),
  };
  await store.put(payload.host, record);
  return { accepted: true, capped: false, record };
}

/** Record OUR OWN probe result. Not rate limited — we control the caller. */
export async function recordProbeOutcome(
  store: MirrorStore,
  host: string,
  verdict: MirrorVerdict,
  reason: string,
  now: number
): Promise<MirrorHealthRecord> {
  const existing = (await store.get(host)) ?? newRecord(host);
  // `unverified` and transport-level "we could not tell" states must not count
  // against a mirror: a probe that failed to run is not a mirror failure.
  if (verdict === "unverified") {
    const record = { ...existing, host, lastProbeVerdict: verdict, lastProbeReason: reason, lastProbeAt: now };
    await store.put(host, record);
    return record;
  }
  const record: MirrorHealthRecord = {
    ...existing,
    host,
    probe: addOutcome(existing.probe, verdict, now, RANKING.probeHalfLifeDays, now),
    lastProbeVerdict: verdict,
    lastProbeReason: reason,
    lastProbeAt: now,
  };
  await store.put(host, record);
  return record;
}