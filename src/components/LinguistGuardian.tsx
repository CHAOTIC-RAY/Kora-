import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Swords, BookOpen, ScrollText, Brain, Crown, X, Share2, Copy, Check, Wifi, Cpu, Users, Maximize2, Minimize2, Trophy } from "lucide-react";
import { DictionaryEntry } from "../lib/dictionary";
import { db, auth, isRealFirebase } from "../lib/firebase";
import { gameViewVariant } from "../lib/canHover";
import {
  doc,
  onSnapshot,
  updateDoc,
  setDoc,
  deleteDoc,
  getDoc,
} from "firebase/firestore";

/* ── Linguist Guardian ──────────────────────────────────────────────
   2D-sprite word-battle (Tuxemon spirit). Three match types:
     • solo  — you vs "The Forgetting" (practice; shareable via link)
     • local — free-for-all, hot-seat, 2–3 players, any seats can be CPU
     • online— free-for-all over Firestore rooms (needs rules published)
   FFA rule: a correct answer splashes ALL opponents; a wrong answer
   damages YOU. Last fighter standing wins.
   ─────────────────────────────────────────────────────────────────── */

type Mode = "definer" | "cloze" | "sage";
type Phase = "menu" | "play" | "win" | "lose";
type MatchType = "solo" | "local" | "online";
type Sprite = "guardian" | "rival" | "boss";
type SlotKind = "you" | "cpu" | "remote";

interface ArsenalWord extends DictionaryEntry {
  mastery: number;
}
interface Q {
  prompt: string;
  answer: string;
  options: string[];
  type: "choice" | "type";
}

const MODES: { id: Mode; label: string; blurb: string; icon: typeof Swords }[] = [
  { id: "definer", label: "The Definer", blurb: "Memory · read the definition, strike with the word", icon: BookOpen },
  { id: "cloze", label: "The Cloze", blurb: "Application · fill the missing word in your sentence", icon: ScrollText },
  { id: "sage", label: "The Sage", blurb: "Strategy · pick the word that fits the nuance", icon: Brain },
];

const SHARED_POOL: ArsenalWord[] = [
  { word: "ephemeral", definition: "Lasting a very short time; transient.", example: "The beauty of the sunset was ephemeral.", isCustom: true, mastery: 0 },
  { word: "lucid", definition: "Expressed clearly; easy to understand.", example: "He gave a lucid explanation of the motif.", isCustom: true, mastery: 0 },
  { word: "resilient", definition: "Able to recover quickly from difficulties.", example: "The resilient hero endured the trial.", isCustom: true, mastery: 0 },
  { word: "somber", definition: "Gloomy; depressing; serious.", example: "The mood was somber but hopeful.", isCustom: true, mastery: 0 },
  { word: "aesthetic", definition: "Concerned with beauty or appreciation of beauty.", example: "The paperwhite has a minimalist aesthetic.", isCustom: true, mastery: 0 },
  { word: "sovereign", definition: "Supreme power or authority; self-governing.", example: "Kora guarantees digital sovereignty.", isCustom: true, mastery: 0 },
  { word: "candid", definition: "Truthful and straightforward; frank.", example: "She gave a candid account of the trip.", isCustom: true, mastery: 0 },
  { word: "nuance", definition: "A subtle difference in meaning or expression.", example: "The translator captured every nuance.", isCustom: true, mastery: 0 },
  { word: "tedious", definition: "Too long, slow, or dull; tiresome.", example: "The lecture was tedious but necessary.", isCustom: true, mastery: 0 },
  { word: "profound", definition: "Very great or intense; showing deep insight.", example: "The book offered a profound reflection on time.", isCustom: true, mastery: 0 },
  { word: "eloquent", definition: "Fluent and persuasive in speech or writing.", example: "Her eloquent plea moved the council.", isCustom: true, mastery: 0 },
  { word: "tenuous", definition: "Very weak or slight; barely connected.", example: "The peace held by a tenuous thread.", isCustom: true, mastery: 0 },
  { word: "pragmatic", definition: "Dealing with things sensibly and realistically.", example: "A pragmatic fix beat a perfect theory.", isCustom: true, mastery: 0 },
  { word: "whimsical", definition: "Playfully quaint or fanciful.", example: "The garden had a whimsical, drifting charm.", isCustom: true, mastery: 0 },
  { word: "scrupulous", definition: "Diligent, thorough, and attentive to detail.", example: "She kept scrupulous records of every coin.", isCustom: true, mastery: 0 },
  { word: "gregarious", definition: "Fond of company; sociable.", example: "The gregarious host knew every guest.", isCustom: true, mastery: 0 },
  { word: "meticulous", definition: "Very careful and precise about details.", example: "His meticulous notes saved the project.", isCustom: true, mastery: 0 },
  { word: "ambiguous", definition: "Open to more than one interpretation; unclear.", example: "The ambiguous clause sparked a dispute.", isCustom: true, mastery: 0 },
  { word: "verbose", definition: "Using more words than needed; long-winded.", example: "The verbose memo buried the key point.", isCustom: true, mastery: 0 },
  { word: "serene", definition: "Calm, peaceful, and untroubled.", example: "The lake was serene at dawn.", isCustom: true, mastery: 0 },
  { word: "diligent", definition: "Having or showing care and conscientiousness.", example: "A diligent student revises nightly.", isCustom: true, mastery: 0 },
  { word: "poignant", definition: "Evoking a keen sense of sadness or regret.", example: "The finale was poignant yet hopeful.", isCustom: true, mastery: 0 },
  { word: "urbane", definition: "Courteous and refined in manner.", example: "His urbane wit eased the room.", isCustom: true, mastery: 0 },
  { word: "fallible", definition: "Capable of making mistakes; not infallible.", example: "Even experts are fallible.", isCustom: true, mastery: 0 },
];

const KEY = "kora_arsenal_mastery";
function loadMastery(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}
function saveMastery(m: Record<string, number>) {
  localStorage.setItem(KEY, JSON.stringify(m));
}
function buildArsenal(): ArsenalWord[] {
  // Gameplay always draws from the curated, verified SHARED_POOL so that every
  // definition is guaranteed to pair with its own word. Custom dictionaries are
  // used by the lookup feature, not the battle quiz, to avoid misaligned pairs.
  const mastery = loadMastery();
  return SHARED_POOL.map((e) => ({ ...e, mastery: mastery[e.word.toLowerCase()] || 0 }));
}
function blankWord(sentence?: string, word?: string): string {
  if (!sentence || !word) return "";
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return sentence.replace(re, "______");
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pure question builder (deterministic given pool + rng).
function buildQuestion(m: Mode, pool: ArsenalWord[], rnd: () => number): Q {
  const usable = pool.filter((w) => w.word && w.definition);
  const target = usable[Math.floor(rnd() * usable.length)];
  if (m === "definer") {
    const others = shuffle(usable.filter((w) => w.word !== target.word), rnd).slice(0, 3);
    return { prompt: `DEFINITION — ${target.definition}`, answer: target.word, options: shuffle([...others.map((w) => w.word), target.word], rnd), type: "choice" };
  }
  if (m === "cloze") {
    return { prompt: `CLOZE — ${blankWord(target.example, target.word) || "Definition: " + target.definition}`, answer: target.word, options: [], type: "type" };
  }
  const others = shuffle(usable.filter((w) => w.word !== target.word), rnd).slice(0, 2);
  const mood =
    target.word === "somber"
      ? "The mood is heavy and downbeat but not without hope — which Arsenal word fits the nuance?"
      : `Two fighters trade blows; the passage needs a word for the ${target.definition.includes("power") || target.definition.includes("authority") ? "governing force" : "prevailing tone"}. Which Arsenal word lands it?`;
  return { prompt: `SAGE — ${mood}`, answer: target.word, options: shuffle([...others.map((w) => w.word), target.word], rnd), type: "choice" };
}
function buildQueue(m: Mode, pool: ArsenalWord[], seed: number, count = 80): Q[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, () => buildQuestion(m, pool, rnd));
}

// ── Detailed 2D monster sprites (cel-shaded, openmon/Tuxemon spirit) ──
type SpriteKind = "guardian" | "rival" | "boss";

function MonSprite({ kind, scale = 1 }: { kind: SpriteKind; scale?: number }) {
  const S = (n: number) => n * scale;
  if (kind === "guardian") {
    // owl-scholar defender — soft feathers, big eyes, book-ish brow
    return (
      <svg width={S(120)} height={S(120)} viewBox="0 0 120 120" style={{ display: "block" }} aria-hidden>
        <defs>
          <radialGradient id="gw" cx="42%" cy="38%" r="70%">
            <stop offset="0%" stopColor="#fff7e6" />
            <stop offset="100%" stopColor="#e4d4b2" />
          </radialGradient>
          <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c98f4e" />
            <stop offset="100%" stopColor="#9c6a34" />
          </linearGradient>
        </defs>
        <ellipse cx="60" cy="112" rx="34" ry="6" fill="#000" opacity="0.18" />
        <path d="M28 56c0-22 14-40 32-40s32 18 32 40c0 26-16 46-32 46S28 82 28 56z" fill="url(#gw)" stroke="#2a2113" strokeWidth="3" />
        <path d="M40 40c8-10 32-10 40 0 4-12-6-22-20-22S36 28 40 40z" fill="url(#gb)" stroke="#2a2113" strokeWidth="2.5" />
        <path d="M52 36c-7-2-12 4-12 4M68 36c7-2 12 4 12 4" stroke="#2a2113" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="46" cy="58" r="15" fill="#fdfcf7" stroke="#2a2113" strokeWidth="2.5" />
        <circle cx="74" cy="58" r="15" fill="#fdfcf7" stroke="#2a2113" strokeWidth="2.5" />
        <circle cx="48" cy="60" r="6.5" fill="#1a1510" />
        <circle cx="72" cy="60" r="6.5" fill="#1a1510" />
        <circle cx="50.5" cy="57.5" r="2" fill="#fff" />
        <circle cx="74.5" cy="57.5" r="2" fill="#fff" />
        <path d="M60 66l-7 9h14z" fill="url(#gb)" stroke="#2a2113" strokeWidth="2" />
        <path d="M60 75v5" stroke="#2a2113" strokeWidth="2" />
        <path d="M44 78c-6 6-12 6-16 2 4 8 14 10 20 4M76 78c6 6 12 6 16 2-4 8-14 10-20 4" fill="#e4d4b2" stroke="#2a2113" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M34 70c-8 2-12 10-10 16 2-8 8-12 14-12M86 70c8 2 12 10 10 16-2-8-8-12-14-12" fill="#cdb892" stroke="#2a2113" strokeWidth="2" />
      </svg>
    );
  }
  if (kind === "rival") {
    // green fox-ish trickster
    return (
      <svg width={S(120)} height={S(120)} viewBox="0 0 120 120" style={{ display: "block" }} aria-hidden>
        <defs>
          <radialGradient id="rw" cx="42%" cy="36%" r="72%">
            <stop offset="0%" stopColor="#a6e07a" />
            <stop offset="100%" stopColor="#5f9e44" />
          </radialGradient>
        </defs>
        <ellipse cx="60" cy="112" rx="32" ry="6" fill="#000" opacity="0.18" />
        <path d="M30 44c0-18 12-30 30-30s30 12 30 30c0 14-6 26-14 34 8 4 14 10 14 18 0 12-12 18-30 18s-30-8-30-20c0-8 6-14 14-18-10-8-14-20-14-32z" fill="url(#rw)" stroke="#16331a" strokeWidth="3" />
        <path d="M34 26l8 20 14-12zM86 26l-8 20-14-12z" fill="#7fae5a" stroke="#16331a" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx="48" cy="54" r="12" fill="#fdfcf7" stroke="#16331a" strokeWidth="2.5" />
        <circle cx="72" cy="54" r="12" fill="#fdfcf7" stroke="#16331a" strokeWidth="2.5" />
        <circle cx="49" cy="55" r="5.5" fill="#16331a" />
        <circle cx="73" cy="55" r="5.5" fill="#16331a" />
        <circle cx="51" cy="53" r="1.8" fill="#fff" />
        <circle cx="75" cy="53" r="1.8" fill="#fff" />
        <path d="M56 66q4 4 8 0" stroke="#16331a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M60 66l-5 7h10z" fill="#234d2a" stroke="#16331a" strokeWidth="2" />
        <path d="M40 78c-8 4-14 12-12 20 6-6 12-8 18-8M80 78c8 4 14 12 12 20-6-6-12-8-18-8" fill="#7fae5a" stroke="#16331a" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
    );
  }
  // boss — amethyst ink-blob with eyes and drips
  return (
    <svg width={S(120)} height={S(120)} viewBox="0 0 120 120" style={{ display: "block" }} aria-hidden>
      <defs>
        <radialGradient id="bw" cx="44%" cy="34%" r="74%">
          <stop offset="0%" stopColor="#a07fd0" />
          <stop offset="100%" stopColor="#5b3a8e" />
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="112" rx="36" ry="6" fill="#000" opacity="0.2" />
      <path d="M24 60c0-22 16-38 36-38s36 16 36 38c0 20-10 34-20 40 6 6 6 14-2 18-4-10-12-12-18-10-4-8-12-10-16-2-10-4-16-16-16-34z" fill="url(#bw)" stroke="#1c0f2e" strokeWidth="3" />
      <path d="M30 48c-6-4-14-2-16 4 8 0 12 2 16 6M90 48c6-4 14-2 16 4-8 0-12 2-16 6" fill="#5b3a8e" stroke="#1c0f2e" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="48" cy="56" r="14" fill="#fdfcf7" stroke="#1c0f2e" strokeWidth="2.5" />
      <circle cx="72" cy="56" r="14" fill="#fdfcf7" stroke="#1c0f2e" strokeWidth="2.5" />
      <circle cx="50" cy="58" r="6" fill="#1c0f2e" />
      <circle cx="70" cy="58" r="6" fill="#1c0f2e" />
      <circle cx="52.5" cy="55.5" r="2" fill="#fff" />
      <circle cx="72.5" cy="55.5" r="2" fill="#fff" />
      <path d="M60 64c-5 5-11 5-16 2M60 64c5 5 11 5 16 2" stroke="#1c0f2e" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M52 76q8 8 16 0" stroke="#1c0f2e" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M40 86c-3 8-3 14 2 18-2-8 0-14 2-18M80 86c3 8 3 14-2 18 2-8 0-14-2-18" fill="#5b3a8e" stroke="#1c0f2e" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

const HP_COLORS = ["#6fbf73", "#e0b341", "#c0504d"];

interface Fighter {
  id: string;
  name: string;
  kind: SlotKind;
  sprite: Sprite;
  hp: number;
  alive: boolean;
}

// ── Online helpers ─────────────────────────────────────────────────
function myUid(): string {
  try {
    let u = localStorage.getItem("kora_uid");
    if (!u) {
      u = "u_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("kora_uid", u);
    }
    return u;
  } catch {
    return "u_" + Math.random().toString(36).slice(2, 10);
  }
}
function genCode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint32Array(6));
  return Array.from(b, (x) => a[x % a.length]).join("");
}

export default function LinguistGuardian({ open, onClose, onOpenScores }: { open: boolean; onClose: () => void; onOpenScores?: () => void }) {
  const [phase, setPhase] = useState<Phase>("menu");
  const [matchType, setMatchType] = useState<MatchType>("solo");
  const [mode, setMode] = useState<Mode>("definer");
  const [size, setSize] = useState<2 | 3>(2);
  const [cpuCount, setCpuCount] = useState(1);
  const [fighters, setFighters] = useState<Fighter[]>([]);
  const [turnIdx, setTurnIdx] = useState(0);
  const [qIndex, setQIndex] = useState(0);
  const [question, setQuestion] = useState<Q | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [flash, setFlash] = useState<{ idx: number; kind: "hit" | "strike" } | null>(null);
  const [seed, setSeed] = useState(0);
  const [shared, setShared] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [roomStatus, setRoomStatus] = useState<"lobby" | "playing" | "done">("lobby");
  const [roomMsg, setRoomMsg] = useState("");
  const [roomBlocked, setRoomBlocked] = useState(false);
  const [v, setV] = useState<"fullscreen" | "popup">(gameViewVariant());
  const queueRef = useRef<Q[]>([]);
  const flashTimer = useRef<number | undefined>(undefined);
  const cpuTimer = useRef<number | undefined>(undefined);
  const unsubRef = useRef<(() => void) | null>(null);
  const bossLevelRef = useRef(1); // boss gets HARDER as it wins, easier after it misses

  const logMsg = (m: string) => setLog((l) => [`> ${m}`, ...l].slice(0, 40));
  const doFlash = (idx: number, kind: "hit" | "strike") => {
    setFlash({ idx, kind });
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 520);
  };

  const aliveCount = fighters.filter((f) => f.alive).length;
  const active = fighters[turnIdx];
  const isMyTurn =
    !!active &&
    phase === "play" &&
    active.alive &&
    (matchType === "online"
      ? active.id === (auth?.currentUser?.uid || myUid())
      : matchType === "local"
      ? active.kind !== "cpu"
      : active.kind === "you");

  // ── Begin a battle ──
  const beginBattle = (cfg: {
    match: MatchType;
    m: Mode;
    pool: ArsenalWord[];
    fighters: Fighter[];
    sd: number;
    sharedMode?: boolean;
  }) => {
    const q = buildQueue(cfg.m, cfg.pool, cfg.sd);
    queueRef.current = q;
    setSeed(cfg.sd);
    setShared(!!cfg.sharedMode);
    setFighters(cfg.fighters);
    setTurnIdx(0);
    setQIndex(0);
    setQuestion(q[0]);
    setLog([]);
    setTyped("");
    bossLevelRef.current = 1;
    setPhase("play");
    const names = cfg.fighters.map((f) => f.name).join(" vs ");
    logMsg(`Battle begun · ${MODES.find((x) => x.id === cfg.m)?.label} · ${names}`);
  };

  const startSolo = (m: Mode, withSeed?: number) => {
    setMatchType("solo");
    const sd = withSeed ?? Math.floor(Math.random() * 0xffffff);
    const you: Fighter = { id: "you", name: "Linguist", kind: "you", sprite: "guardian", hp: 100, alive: true };
    const boss: Fighter = { id: "boss", name: "The Forgetting", kind: "cpu", sprite: "boss", hp: 100, alive: true };
    beginBattle({ match: "solo", m, pool: withSeed ? SHARED_POOL : buildArsenal(), fighters: [you, boss], sd });
  };

  const startLocal = (m: Mode) => {
    setMatchType("local");
    const sd = Math.floor(Math.random() * 0xffffff);
    const fighters: Fighter[] = [
      { id: "you", name: "You", kind: "you", sprite: "guardian", hp: 100, alive: true },
    ];
    const kinds: { sprite: Sprite; name: string }[] = [
      { sprite: "rival", name: "Rival" },
      { sprite: "boss", name: "The Forgetting" },
    ];
    let cpuLeft = cpuCount;
    let humanLeft = size - 1 - cpuCount;
    for (let i = 0; i < size - 1; i++) {
      const k = kinds[i];
      if (humanLeft > 0) {
        fighters.push({ id: `p${i + 1}`, name: `Player ${i + 1}`, kind: "you", sprite: k.sprite, hp: 100, alive: true });
        humanLeft--;
      } else if (cpuLeft > 0) {
        fighters.push({ id: `cpu${i}`, name: `CPU ${k.name}`, kind: "cpu", sprite: k.sprite, hp: 100, alive: true });
        cpuLeft--;
      } else {
        // extra human seat if neither cpu nor human budget consumed it
        fighters.push({ id: `p${i + 1}`, name: `Player ${i + 1}`, kind: "you", sprite: k.sprite, hp: 100, alive: true });
      }
    }
    beginBattle({ match: "local", m, pool: SHARED_POOL, fighters, sd });
  };

  // ── Resolve a move (offline local/solo) ──
  const resolveOffline = (guess: string) => {
    if (!question || !active) return;
    const correct = guess.trim().toLowerCase() === question.answer.toLowerCase();
    setFighters((prev) => {
      const fs = prev.map((f) => ({ ...f }));
      const ai = fs.findIndex((f) => f.id === active.id);
      if (correct) {
        const dmg = 18 + Math.floor(Math.random() * 10);
        fs.forEach((f, i) => {
          if (i !== ai && f.alive) {
            f.hp = Math.max(0, f.hp - dmg);
            if (f.hp <= 0) f.alive = false;
          }
        });
        logMsg(`✦ ${active.name} splashes ${dmg} to all foes`);
        doFlash(ai, "strike");
        awardMastery(question.answer);
      } else {
        const back = 12 + Math.floor(Math.random() * 8);
        fs[ai].hp = Math.max(0, fs[ai].hp - back);
        if (fs[ai].hp <= 0) fs[ai].alive = false;
        logMsg(`✗ ${active.name} misses — takes ${back}`);
        doFlash(ai, "hit");
      }
      const alive = fs.filter((f) => f.alive);
      setTyped("");
      if (alive.length <= 1) {
        const winner = alive[0];
        if (winner?.id === "you") {
          setPhase("win");
          logMsg(`VICTORY — ${winner.name}`);
        } else {
          setPhase("lose");
          logMsg(`DEFEAT — ${winner ? winner.name + " wins" : "nobody stands"}`);
        }
        return fs;
      }
      // advance turn
      let ni = ai;
      for (let s = 0; s < fs.length; s++) {
        ni = (ni + 1) % fs.length;
        if (fs[ni].alive) break;
      }
      setTurnIdx(ni);
      setQIndex((q) => {
        const next = q + 1;
        setQuestion(queueRef.current[next % queueRef.current.length]);
        return next;
      });
      return fs;
    });
  };

  const awardMastery = (word: string) => {
    const mastery = loadMastery();
    const key = word.toLowerCase();
    mastery[key] = (mastery[key] || 0) + 1;
    saveMastery(mastery);
  };

  // CPU auto-play — boss accuracy scales with its level so it's beatable:
  // higher level = more likely to miss; occasional jitter keeps it from feeling
  // robotic. Level rises when it answers right, drops after a miss.
  useEffect(() => {
    window.clearTimeout(cpuTimer.current);
    if (phase !== "play" || matchType === "online") return;
    if (active && active.kind === "cpu" && active.alive) {
      cpuTimer.current = window.setTimeout(() => {
        const q = queueRef.current[qIndex % queueRef.current.length];
        const lvl = bossLevelRef.current;
        // base 0.90 at level 1, -0.05 per level, clamped to a floor of 0.45,
        // plus a little per-turn jitter so it isn't a perfect machine.
        let acc = 0.9 - (lvl - 1) * 0.05 + (Math.random() - 0.5) * 0.12;
        acc = Math.max(0.45, Math.min(0.92, acc));
        const correct = Math.random() < acc;
        if (correct) bossLevelRef.current = Math.min(12, lvl + 1);
        else bossLevelRef.current = Math.max(1, lvl - 2);
        const guess = correct ? q.answer : q.options.find((o) => o !== q.answer) || q.answer;
        resolveOffline(guess);
      }, 950);
    }
    return () => window.clearTimeout(cpuTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, phase, matchType, qIndex]);

  // ── Online FFA ──
  const roomRef = (code: string) => doc(db, "battleRooms", code.toUpperCase());
  const startOnline = async (m: Mode, create: boolean, code?: string) => {
    if (!isRealFirebase || !db) {
      setRoomMsg("Online needs Firebase (publish battleRooms rules).");
      return;
    }
    const uid = auth?.currentUser?.uid || myUid();
    const sd = Math.floor(Math.random() * 0xffffff);
    const code_ = code || genCode();
    setRoomCode(code_);
    setRoomBlocked(false);
    setRoomMsg("");
    setMatchType("online");
    setMode(m);
    try {
      if (create) {
        await setDoc(roomRef(code_), {
          mode: m,
          seed: sd,
          status: "lobby",
          turnIdx: 0,
          qIndex: 0,
          createdAt: Date.now(),
          players: [{ id: uid, name: "You", kind: "you", sprite: "guardian", hp: 100, alive: true }],
          log: [`Room ${code_} created`],
          winner: null,
        });
      } else {
        const snap = await getDoc(roomRef(code_));
        if (!snap.exists()) {
          setRoomMsg("Room not found.");
          return;
        }
        const data = snap.data() as any;
        if (data.players.length >= 3) {
          setRoomMsg("Room full.");
          return;
        }
        const sprite: Sprite = data.players.length === 1 ? "rival" : "boss";
        await updateDoc(roomRef(code_), {
          players: [...data.players, { id: uid, name: "You", kind: "you", sprite, hp: 100, alive: true }],
        });
      }
      setPhase("play");
      setRoomStatus("lobby");
      watchRoom(code_);
    } catch (e) {
      setRoomMsg("Online error: " + (e as Error).message);
    }
  };

  const watchRoom = (code: string) => {
    if (!db) return;
    unsubRef.current?.();
    setRoomBlocked(false);
    unsubRef.current = onSnapshot(
      roomRef(code),
      (snap) => {
        const data = snap.data() as any;
        if (!data) return;
        const fs: Fighter[] = data.players;
        setFighters(fs);
        setTurnIdx(data.turnIdx ?? 0);
        setQIndex(data.qIndex ?? 0);
        setLog(data.log ?? []);
        setRoomStatus(data.status);
        const q = buildQueue(data.mode, SHARED_POOL, data.seed)[(data.qIndex ?? 0) % 80];
        setQuestion(q);
        if (data.status === "done") {
          const winner = fs.find((f: Fighter) => f.id === data.winner);
          if (winner?.id === (auth?.currentUser?.uid || myUid())) setPhase("win");
          else setPhase("lose");
        }
      },
      (err: any) => {
        const msg = String(err?.message || err || "");
        // Firestore long-poll blocked by an ad-blocker / privacy extension / network policy.
        if (/blocked|net::|channel|permission|interrupted/i.test(msg)) {
          setRoomBlocked(true);
          setRoomMsg(
            "Can't reach Firebase — the Firestore connection was blocked (ad-blocker, privacy extension, or network policy). Disable it for this site, or play Local / Solo instead."
          );
        } else {
          setRoomMsg("Sync error: " + msg);
        }
      }
    );
  };

  const submitOnlineMove = (guess: string) => {
    if (!db || !question || !active) return;
    const uid = auth?.currentUser?.uid || myUid();
    if (active.id !== uid) return;
    const correct = guess.trim().toLowerCase() === question.answer.toLowerCase();
    const fs = fighters.map((f) => ({ ...f }));
    const ai = fs.findIndex((f) => f.id === uid);
    let dmg = 0;
    let back = 0;
    if (correct) {
      dmg = 18 + Math.floor(Math.random() * 10);
      fs.forEach((f, i) => {
        if (i !== ai && f.alive) {
          f.hp = Math.max(0, f.hp - dmg);
          if (f.hp <= 0) f.alive = false;
        }
      });
      logMsg(`✦ You splash ${dmg} to all foes`);
      awardMastery(question.answer);
    } else {
      back = 12 + Math.floor(Math.random() * 8);
      fs[ai].hp = Math.max(0, fs[ai].hp - back);
      if (fs[ai].hp <= 0) fs[ai].alive = false;
      logMsg(`✗ You miss — take ${back}`);
    }
    const alive = fs.filter((f) => f.alive);
    let ni = ai;
    for (let s = 0; s < fs.length; s++) {
      ni = (ni + 1) % fs.length;
      if (fs[ni].alive) break;
    }
    const done = alive.length <= 1;
    const line = correct ? `✦ You splashed ${dmg} to all foes` : `✗ You miss — took ${back}`;
    updateDoc(roomRef(roomCode), {
      players: fs,
      turnIdx: ni,
      qIndex: qIndex + 1,
      log: [line, ...log].slice(0, 40),
      status: done ? "done" : "playing",
      winner: done ? alive[0]?.id ?? null : null,
    }).catch((e) => setRoomMsg("Sync error: " + (e as Error).message));
    setTyped("");
  };

  const forfeit = () => {
    if (matchType === "online") {
      const uid = auth?.currentUser?.uid || myUid();
      const fs = fighters.map((f) => (f.id === uid ? { ...f, hp: 0, alive: false } : f));
      const alive = fs.filter((f) => f.alive);
      let ni = fs.findIndex((f) => f.id === uid);
      for (let s = 0; s < fs.length; s++) {
        ni = (ni + 1) % fs.length;
        if (fs[ni].alive) break;
      }
      if (db) updateDoc(roomRef(roomCode), { players: fs, turnIdx: ni, status: alive.length <= 1 ? "done" : "playing", winner: alive.length <= 1 ? alive[0]?.id ?? null : null });
    } else {
      setFighters((prev) => {
        const fs = prev.map((f) => (f.id === "you" ? { ...f, hp: 0, alive: false } : f));
        const alive = fs.filter((f) => f.alive);
        setPhase("lose");
        logMsg("You forfeited");
        return fs;
      });
    }
  };

  // cleanup
  useEffect(() => {
    return () => {
      window.clearTimeout(flashTimer.current);
      window.clearTimeout(cpuTimer.current);
      unsubRef.current?.();
    };
  }, []);

  // reset on open
  useEffect(() => {
    if (open) {
      setPhase("menu");
      setFighters([]);
      setQuestion(null);
      setLog([]);
      setRoomMsg("");
      setRoomBlocked(false);
      setShareCode("");
      unsubRef.current?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Share link (solo)
  const mintShare = () => {
    const sd = Math.floor(Math.random() * 0xffffff);
    const code = `${mode[0]}${sd.toString(36)}`.toUpperCase();
    setShareCode(code);
    startSolo(mode, sd);
    const url = `${location.origin}${location.pathname}?guardian=${code}`;
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {}
    );
  };

  // open shared solo battle
  useEffect(() => {
    if (!open) return;
    const code = new URLSearchParams(location.search).get("guardian");
    if (!code || code.length < 2) return;
    const map: Record<string, Mode> = { d: "definer", c: "cloze", s: "sage" };
    const m = map[code[0]];
    const sd = parseInt(code.slice(1), 36);
    if (m && !isNaN(sd)) {
      setShareCode(code.toUpperCase());
      startSolo(m, sd);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const popup = (
    <motion.div
      className={
        v === "fullscreen"
          ? "fixed inset-0 z-[80] flex flex-col bg-[#0f0d09] text-[#e9e2d0]"
          : "fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md"
      }
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={
          v === "fullscreen"
            ? "relative w-full h-full flex flex-col shadow-2xl border-2 border-[#3a3527]"
            : "relative w-full max-w-2xl max-h-[94vh] bg-[#0f0d09] text-[#e9e2d0] rounded-3xl overflow-hidden flex flex-col shadow-2xl border-2 border-[#3a3527]"
        }
        initial={{ scale: v === "fullscreen" ? 1 : 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: v === "fullscreen" ? 1 : 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Linguist Guardian"
      >
        <header className="flex items-center justify-between px-4 py-2.5 border-b-2 border-[#3a3527] bg-[#1d1a13] kora-safe-top">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#d4a574]/15 border border-[#d4a574]/25">
              <Swords className="w-4 h-4 text-[#d4a574]" />
            </div>
            <div>
              <h2 className="font-serif text-base font-bold tracking-tight leading-none">Linguist Guardian</h2>
              <p className="text-[9px] uppercase tracking-widest opacity-50">{matchType === "solo" ? "Practice" : matchType === "local" ? "Local Free-For-All" : "Online Free-For-All"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onOpenScores && (
              <button onClick={onOpenScores} className="p-1.5 rounded-full border border-white/10 hover:bg-white/5" aria-label="Open score tracker" title="Score Tracker">
                <Trophy className="w-4 h-4 text-[#d4a574]" />
              </button>
            )}
            <button onClick={() => setV(v === "fullscreen" ? "popup" : "fullscreen")} className="p-1.5 rounded-full border border-white/10 hover:bg-white/5" aria-label={v === "fullscreen" ? "Shrink to popup" : "Expand to fullscreen"} title={v === "fullscreen" ? "Popup" : "Fullscreen"}>
              {v === "fullscreen" ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-full border border-white/10 hover:bg-white/5" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {phase === "menu" && (
            <div className="space-y-4">
              {/* Match type */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: "solo", label: "Practice", icon: Swords },
                  { id: "local", label: "Local FFA", icon: Users },
                  { id: "online", label: "Online FFA", icon: Wifi },
                ] as const).map((t) => (
                  <button key={t.id} onClick={() => setMatchType(t.id)} className={`rounded-2xl border-2 p-3 flex flex-col items-center gap-1 transition ${matchType === t.id ? "border-[#d4a574]/60 bg-[#1d1a13]" : "border-[#3a3527] bg-[#16140f]"}`}>
                    <t.icon className="w-5 h-5 text-[#d4a574]" />
                    <span className="text-[11px] font-bold">{t.label}</span>
                  </button>
                ))}
              </div>

              {/* Mode */}
              <div className="grid gap-2">
                {MODES.map((m) => (
                  <button key={m.id} onClick={() => setMode(m.id)} className={`rounded-2xl border-2 p-3 text-left transition flex items-center gap-3 ${mode === m.id ? "border-[#d4a574]/60 bg-[#1d1a13]" : "border-[#3a3527] bg-[#16140f]"}`}>
                    <m.icon className="w-5 h-5 text-[#d4a574]" />
                    <div>
                      <p className="font-serif font-bold">{m.label}</p>
                      <p className="text-[10px] opacity-55 mt-0.5">{m.blurb}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Local config */}
              {matchType === "local" && (
                <div className="rounded-2xl border-2 border-[#3a3527] p-3 space-y-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold uppercase tracking-widest text-[#d4a574]">Players</span>
                    <div className="flex gap-1">
                      {([2, 3] as const).map((n) => (
                        <button key={n} onClick={() => { setSize(n); setCpuCount(Math.min(cpuCount, n - 1)); }} className={`px-3 py-1 rounded-lg border ${size === n ? "border-[#d4a574]/60 bg-[#1d1a13]" : "border-[#3a3527]"}`}>{n}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold uppercase tracking-widest text-[#d4a574] flex items-center gap-1"><Cpu className="w-3.5 h-3.5" /> CPU seats</span>
                    <div className="flex gap-1">
                      {Array.from({ length: size }, (_, i) => (
                        <button key={i} onClick={() => setCpuCount(i)} className={`px-3 py-1 rounded-lg border ${cpuCount === i ? "border-[#d4a574]/60 bg-[#1d1a13]" : "border-[#3a3527]"}`}>{i}</button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] opacity-50">You + {size - 1 - cpuCount} human seat(s) + {cpuCount} CPU. Hot-seat: pass the device each turn.</p>
                </div>
              )}

              {/* Online config */}
              {matchType === "online" && (
                <div className="rounded-2xl border-2 border-dashed border-[#3a3527] p-3 space-y-2">
                  <p className="text-[10px] opacity-60 leading-relaxed">
                    Create a room (get a code) or join with a friend's code. Up to 3 fighters, synced over Firebase. Publish <code>battleRooms</code> rules in the Firebase Console to enable.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => startOnline(mode, true)} className="px-3 py-2 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider">Create Room</button>
                    <input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="CODE" className="w-28 bg-[#16140f] border-2 border-[#3a3527] rounded-xl px-2 py-2 text-sm outline-none focus:border-[#d4a574]/60 uppercase font-mono" />
                    <button onClick={() => startOnline(mode, false, roomCode)} className="px-3 py-2 rounded-xl border-2 border-[#3a3527] hover:border-[#d4a574]/50 text-[10px] font-bold uppercase tracking-wider">Join</button>
                  </div>
                  {roomMsg && <p className="text-[10px] text-[#c0504d]">{roomMsg}</p>}
                </div>
              )}

              {/* Start / share */}
              <button
                onClick={() => (matchType === "solo" ? startSolo(mode) : matchType === "local" ? startLocal(mode) : startOnline(mode, true))}
                className="w-full px-4 py-3 rounded-2xl bg-[#d4a574] text-[#1a1510] text-xs font-bold uppercase tracking-wider active:scale-95"
              >
                {matchType === "solo" ? "Start Practice" : matchType === "local" ? `Start Local FFA (${size}P)` : "Create Online Room"}
              </button>

              {matchType === "solo" && (
                <button onClick={mintShare} className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#3a3527] hover:border-[#d4a574]/50 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5">
                  <Share2 className="w-3.5 h-3.5" /> Share Battle Link
                </button>
              )}
            </div>
          )}

          {phase === "play" && question && (
            <div className="space-y-3">
              {roomMsg && (
                <div className={`rounded-xl border px-3 py-2 text-[11px] leading-snug ${roomBlocked ? "border-[#d4a574]/40 bg-[#d4a574]/10 text-[#e6c79a]" : "border-[#c0504d]/40 bg-[#c0504d]/10 text-[#e89b99]"}`}>
                  {roomMsg}
                </div>
              )}
              {/* Stage */}
              <div className="relative rounded-2xl border-2 border-[#3a3527] overflow-hidden bg-gradient-to-b from-[#2a3a2e] via-[#243024] to-[#1a241b] p-4">
                <div className="absolute bottom-0 inset-x-0 h-1/3 bg-[#1c241a]" />
                <div className="relative flex items-end justify-center gap-6 flex-wrap">
                  {fighters.map((f, i) => {
                    const isActive = i === turnIdx && f.alive;
                    return (
                      <div key={f.id} className={`flex flex-col items-center gap-1 ${!f.alive ? "opacity-30 grayscale" : ""}`}>
                        <div className="text-[9px] font-bold uppercase tracking-wide opacity-70">{f.name}{f.kind === "cpu" ? " · CPU" : ""}</div>
                        <motion.div
                          animate={
                            flash?.idx === i && flash.kind === "hit"
                              ? { x: [0, 8, -8, 6, -6, 0], filter: ["brightness(1)", "brightness(2.4)", "brightness(1)"] }
                              : flash?.idx === i && flash.kind === "strike"
                              ? { x: [0, (i < turnIdx ? 14 : -14), 0] }
                              : isActive
                              ? { y: [0, -6, 0] }
                              : { y: 0 }
                          }
                          transition={{ duration: flash ? 0.5 : isActive ? 1.8 : 0.2, repeat: flash || !isActive ? 0 : Infinity, ease: "easeInOut" }}
                          className="drop-shadow-[0_8px_10px_rgba(0,0,0,0.45)]"
                        >
                          <MonSprite kind={f.sprite} scale={1.1} />
                        </motion.div>
                        <div className="w-24">
                          <div className="h-2 rounded-full bg-[#0f0d09] overflow-hidden border border-[#3a3527]">
                            <motion.div className="h-full rounded-full" style={{ background: HP_COLORS[f.hp > 50 ? 0 : f.hp > 20 ? 1 : 2] }} animate={{ width: `${f.hp}%` }} transition={{ duration: 0.4 }} />
                          </div>
                          <div className="text-[8px] text-center opacity-60 mt-0.5">{f.hp}%</div>
                        </div>
                        {isActive && <div className="text-[8px] text-[#d4a574] font-bold animate-pulse">▶ TURN</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Turn banner */}
              <div className="text-center text-[11px] font-bold uppercase tracking-widest">
                {matchType === "online" && roomStatus === "lobby" ? (
                  <span className="text-[#d4a574]">Lobby · {fighters.length}/3 joined — waiting for host to start</span>
                ) : active ? (
                  isMyTurn ? (
                    <span className="text-[#6fbf73]">Your turn</span>
                  ) : (
                    <span className="opacity-70">{active.name}'s turn…</span>
                  )
                ) : null}
              </div>

              {/* Prompt */}
              <div className="rounded-2xl border-2 border-[#3a3527] bg-[#16140f] p-3 min-h-[60px] flex items-center">
                <p className="text-sm font-mono leading-relaxed">{question.prompt}</p>
              </div>

              {/* Input */}
              {isMyTurn ? (
                question.type === "choice" ? (
                  <div className="grid grid-cols-2 gap-2">
                    {question.options.map((o) => (
                      <button key={o} onClick={() => (matchType === "online" ? submitOnlineMove(o) : resolveOffline(o))} className="rounded-xl border-2 border-[#3a3527] hover:border-[#d4a574]/60 bg-[#1d1a13] px-3 py-2.5 text-left text-sm transition capitalize active:scale-95">
                        {o}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (matchType === "online" ? submitOnlineMove(typed) : resolveOffline(typed))} placeholder="type the missing word…" className="flex-1 bg-[#16140f] border-2 border-[#3a3527] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#d4a574]/60" />
                    <button onClick={() => (matchType === "online" ? submitOnlineMove(typed) : resolveOffline(typed))} className="px-4 py-2.5 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider active:scale-95">Strike</button>
                  </div>
                )
              ) : (
                <div className="text-center text-[11px] opacity-50 py-2">Waiting for {active?.name}…</div>
              )}

              <button onClick={forfeit} className="w-full px-3 py-2 rounded-xl border-2 border-[#3a3527] text-[10px] font-bold uppercase tracking-wider opacity-60 hover:opacity-100">Forfeit</button>
            </div>
          )}

          {(phase === "win" || phase === "lose") && (
            <div className="text-center space-y-3 py-4">
              <Crown className="w-10 h-10 text-[#d4a574] mx-auto" />
              <h3 className="font-serif text-2xl font-bold">{phase === "win" ? "Victory" : "Defeated"}</h3>
              <p className="text-[11px] opacity-60">{phase === "win" ? "Last word standing." : "The archive is lost — sharpen your Arsenal."}</p>
              <button onClick={() => setPhase("menu")} className="px-4 py-2 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider">Return to Menu</button>
            </div>
          )}

          {log.length > 0 && (
            <div className="rounded-xl border-2 border-[#3a3527] bg-black/40 p-3 h-28 overflow-y-auto font-mono text-[10px] leading-relaxed opacity-80">
              {log.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );

  return <AnimatePresence>{open && popup}</AnimatePresence>;
}
