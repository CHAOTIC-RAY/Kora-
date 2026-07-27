import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Swords, BookOpen, ScrollText, Brain, Crown, X, Share2, Copy, Check } from "lucide-react";
import { getCustomDictionary, DictionaryEntry } from "../lib/dictionary";

/* ── Linguist Guardian ──────────────────────────────────────────────
   2D-sprite word-battle in the spirit of Tuxemon / classic monster
   RPGs. You command the Linguist (pixel owl-scholar); the boss is
   "The Forgetting" (a purple ink-blob). Damage = correct answers.

   • Single-player runs off your Reader Arsenal (words you highlight).
   • "Share Battle" mints a link encoding the mode + a seed. Opening
     the link starts the SAME battle from a fixed shared pool, so it
     works fully offline — no Firestore needed for the shared challenge.
   • Live 1v1 sync (battleRooms) still needs Firestore rules published.
   ─────────────────────────────────────────────────────────────────── */

type Mode = "definer" | "cloze" | "sage";
type Phase = "menu" | "play" | "win" | "lose";
type Anim = "idle" | "playerStrike" | "bossHit" | "playerHit" | "bossStrike";

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

// Fixed pool used for shared (link) battles so both players face identical words.
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
];

const MASTERY_TO_LEVEL = (m: number) => Math.floor(m / 3) + 1;
const PRESTIGE_AT = 9;
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
  const custom = getCustomDictionary();
  const base: ArsenalWord[] =
    custom.length > 0
      ? custom.map((e) => ({ ...e, mastery: 0 }))
      : SHARED_POOL;
  const mastery = loadMastery();
  return base.map((e) => ({ ...e, mastery: mastery[e.word.toLowerCase()] || 0 }));
}
function blankWord(sentence?: string, word?: string): string {
  if (!sentence || !word) return "";
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return sentence.replace(re, "______");
}

// Seeded RNG (mulberry32) so a shared battle is reproducible.
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

// ── Pixel sprites (16×16 char grids) ──────────────────────────────
type Palette = Record<string, string>;
function PixelSprite({ grid, palette, scale = 7 }: { grid: string[]; palette: Palette; scale?: number }) {
  const w = grid[0].length;
  const h = grid.length;
  const rects: React.ReactNode[] = [];
  grid.forEach((row, y) =>
    row.split("").forEach((ch, x) => {
      const c = palette[ch];
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={c} />);
    })
  );
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w * scale}
      height={h * scale}
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated", display: "block" }}
      aria-hidden
    >
      {rects}
    </svg>
  );
}

const GUARDIAN: string[] = [
  "................",
  "................",
  ".....oooo.......",
  "....oooooo......",
  "...wwwwwwww.....",
  "..wwwwwwwwww....",
  "..wwkwwwwkww....",
  "..wwkwkkwkkw....",
  "..wwwwwwwwww....",
  "...wwwoowwww....",
  "...wwwwwwww.....",
  "..wwwwwwwwww....",
  "..wwwwwwwwww....",
  "...wddwwddw.....",
  "................",
  "................",
];
const GUARDIAN_PAL: Palette = { o: "#3a2f1f", w: "#f0e6cf", k: "#1a1510", d: "#b9824a" };

const BOSS: string[] = [
  "................",
  "................",
  ".....pppppp.....",
  "...pppppppppp...",
  "..pppppppppppp..",
  ".pppppppppppppp.",
  ".ppkkppppppkkpp.",
  ".ppkpwppppwkpkp.",
  ".pppppppppppppp.",
  ".pppppmmmmppppp.",
  "..pppppppppppp..",
  "...pppppppppp...",
  "....pppppppp....",
  "................",
  "................",
  "................",
];
const BOSS_PAL: Palette = { p: "#7a5ea8", k: "#140b1f", w: "#ffffff", m: "#3a2358" };

export default function LinguistGuardian({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [arsenal, setArsenal] = useState<ArsenalWord[]>([]);
  const [phase, setPhase] = useState<Phase>("menu");
  const [mode, setMode] = useState<Mode>("definer");
  const [bossHp, setBossHp] = useState(100);
  const [playerHp, setPlayerHp] = useState(100);
  const [question, setQuestion] = useState<Q | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [anim, setAnim] = useState<Anim>("idle");
  const [shared, setShared] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [copied, setCopied] = useState(false);
  const rngRef = useRef<() => number>(Math.random);
  const animTimer = useRef<number | undefined>(undefined);

  const logMsg = (m: string) => setLog((l) => [`> ${m}`, ...l].slice(0, 40));
  const flash = (a: Anim) => {
    setAnim(a);
    window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => setAnim("idle"), 520);
  };

  const nextQuestion = (m: Mode, pool: ArsenalWord[]) => {
    const rnd = rngRef.current;
    const usable = pool.filter((w) => w.word && w.definition);
    if (usable.length < 2) {
      setQuestion({
        prompt: "Your Arsenal is too small. Highlight more words in the Kora Reader to forge spells.",
        answer: "",
        options: [],
        type: "choice",
      });
      return;
    }
    const target = usable[Math.floor(rnd() * usable.length)];
    if (m === "definer") {
      const others = shuffle(usable.filter((w) => w.word !== target.word), rnd).slice(0, 3);
      const opts = shuffle([...others.map((w) => w.word), target.word], rnd);
      setQuestion({ prompt: `DEFINITION — ${target.definition}`, answer: target.word, options: opts, type: "choice" });
    } else if (m === "cloze") {
      setQuestion({
        prompt: `CLOZE — ${blankWord(target.example, target.word) || "No sentence saved. Definition: " + target.definition}`,
        answer: target.word,
        options: [],
        type: "type",
      });
    } else {
      const others = shuffle(usable.filter((w) => w.word !== target.word), rnd).slice(0, 2);
      const opts = shuffle([...others.map((w) => w.word), target.word], rnd);
      const mood =
        target.word === "somber"
          ? "The mood is somber but hopeful — which word fits the nuance?"
          : `A passage calls for a ${target.word} tone. Which Arsenal word lands the nuance?`;
      setQuestion({ prompt: `SAGE — ${mood}`, answer: target.word, options: opts, type: "choice" });
    }
  };

  const startBattle = (m: Mode, useSharedPool = false, seed?: number) => {
    const pool = useSharedPool ? SHARED_POOL : buildArsenal();
    if (useSharedPool && seed != null) rngRef.current = mulberry32(seed);
    else rngRef.current = Math.random;
    setShared(useSharedPool);
    setArsenal(pool);
    setMode(m);
    setPhase("play");
    setBossHp(100);
    setPlayerHp(100);
    setLog([]);
    setTyped("");
    setAnim("idle");
    logMsg(`Battle begun · ${MODES.find((x) => x.id === m)?.label}${useSharedPool ? " · SHARED" : ""}`);
    nextQuestion(m, pool);
  };

  const awardMastery = (word: string) => {
    const mastery = loadMastery();
    const key = word.toLowerCase();
    mastery[key] = (mastery[key] || 0) + 1;
    saveMastery(mastery);
    setArsenal((a) => a.map((w) => (w.word.toLowerCase() === key ? { ...w, mastery: mastery[key] } : w)));
    if (mastery[key] === PRESTIGE_AT) logMsg(`★ ${word} PRESTIGED — passive buff unlocked`);
  };

  const resolve = (guess: string) => {
    if (!question) return;
    const correct = guess.trim().toLowerCase() === question.answer.toLowerCase();
    if (correct) {
      const dmg = 18 + Math.floor(Math.random() * 10);
      setBossHp((h) => Math.max(0, h - dmg));
      logMsg(`✦ ${question.answer} strikes! -${dmg} boss HP`);
      flash("bossHit");
      awardMastery(question.answer);
      if (bossHp - dmg <= 0) {
        setPhase("win");
        logMsg("ARCHIVE DEFENDED — boss vanquished");
        return;
      }
      nextQuestion(mode, arsenal);
    } else {
      const back = 12 + Math.floor(Math.random() * 8);
      setPlayerHp((h) => Math.max(0, h - back));
      logMsg(`✗ "${guess}" misses — boss strikes -${back} HP`);
      flash("playerHit");
      if (playerHp - back <= 0) {
        setPhase("lose");
        logMsg("The Archive falls…");
        return;
      }
    }
    setTyped("");
  };

  // Open shared battle from ?guardian=CODE in the URL.
  useEffect(() => {
    if (!open) return;
    const code = new URLSearchParams(location.search).get("guardian");
    if (!code || code.length < 2) return;
    const map: Record<string, Mode> = { d: "definer", c: "cloze", s: "sage" };
    const m = map[code[0]];
    const seed = parseInt(code.slice(1), 36);
    if (m && !isNaN(seed)) {
      setShareCode(code.toUpperCase());
      startBattle(m, true, seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (phase === "menu") {
      setArsenal(buildArsenal());
      setLog([]);
      setQuestion(null);
      setShared(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase]);

  useEffect(() => () => window.clearTimeout(animTimer.current), []);

  const mintShare = () => {
    const seed = Math.floor(Math.random() * 0xffffff);
    const code = `${mode[0]}${seed.toString(36)}`.toUpperCase();
    setShareCode(code);
    const url = `${location.origin}${location.pathname}?guardian=${code}`;
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {}
    );
    logMsg(`Battle code minted: ${code} (link copied)`);
  };

  if (!open) return null;

  const playerLevel = Math.max(1, arsenal.reduce((s, w) => s + MASTERY_TO_LEVEL(w.mastery), 0));

  const popup = (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="relative w-full max-w-2xl max-h-[94vh] bg-[#0f0d09] text-[#e9e2d0] rounded-3xl overflow-hidden flex flex-col shadow-2xl border-2 border-[#3a3527]"
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Linguist Guardian"
      >
        <header className="flex items-center justify-between px-4 py-2.5 border-b-2 border-[#3a3527] bg-[#1d1a13]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#d4a574]/15 border border-[#d4a574]/25">
              <Swords className="w-4 h-4 text-[#d4a574]" />
            </div>
            <div>
              <h2 className="font-serif text-base font-bold tracking-tight leading-none">Linguist Guardian</h2>
              <p className="text-[9px] uppercase tracking-widest opacity-50">Defend the Kora Archives</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full border border-white/10 hover:bg-white/5" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {phase === "menu" && (
            <div className="space-y-4">
              <p className="text-xs opacity-70 text-center">Choose your trial. Every word you master in the Reader is already in your Arsenal.</p>
              <div className="grid gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => startBattle(m.id)}
                    className="rounded-2xl border-2 border-[#3a3527] bg-[#1d1a13] hover:border-[#d4a574]/50 p-3 text-left transition flex items-center gap-3"
                  >
                    <m.icon className="w-5 h-5 text-[#d4a574]" />
                    <div>
                      <p className="font-serif font-bold">{m.label}</p>
                      <p className="text-[10px] opacity-55 mt-0.5">{m.blurb}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Share Battle */}
              <div className="rounded-2xl border-2 border-dashed border-[#3a3527] p-3 space-y-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#d4a574]">
                  <Share2 className="w-3.5 h-3.5" /> Share Battle (link)
                </div>
                <p className="text-[10px] opacity-55 leading-relaxed">
                  Mint a code + link. Whoever opens it fights the <b>same</b> battle from a fixed word pool — works fully offline. Live 1v1 sync needs Firestore rules.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={mintShare}
                    className="px-3 py-2 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"
                  >
                    <Share2 className="w-3.5 h-3.5" /> Mint &amp; Copy Link
                  </button>
                  {shareCode && (
                    <span className="self-center font-mono text-sm text-[#d4a574] tracking-widest">{shareCode}</span>
                  )}
                  {shareCode && (
                    <button
                      onClick={() => {
                        const url = `${location.origin}${location.pathname}?guardian=${shareCode}`;
                        navigator.clipboard?.writeText(url);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1600);
                      }}
                      className="self-center px-2.5 py-2 rounded-xl border border-[#3a3527] hover:border-[#d4a574]/50 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copied" : "Copy Link"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {phase === "play" && question && (
            <div className="space-y-3">
              {/* ── Battle stage ── */}
              <div className="relative rounded-2xl border-2 border-[#3a3527] overflow-hidden bg-gradient-to-b from-[#2a3a2e] via-[#243024] to-[#1a241b]">
                {/* ground */}
                <div className="absolute bottom-0 inset-x-0 h-1/3 bg-[#1c241a]" />
                <div className="relative h-56 flex items-end justify-between px-6 py-4">
                  {/* Enemy top-right */}
                  <div className="flex-1" />
                  <div className="flex flex-col items-center gap-1">
                    <HpTag name="The Forgetting" level={40} hp={bossHp} align="right" />
                    <motion.div
                      animate={
                        anim === "bossHit"
                          ? { x: [0, -10, 10, -6, 6, 0], filter: ["brightness(1)", "brightness(2.2)", "brightness(1)"] }
                          : anim === "bossStrike"
                          ? { y: [0, 8, 0] }
                          : { y: [0, -5, 0] }
                      }
                      transition={{ duration: anim === "idle" ? 2.2 : 0.5, repeat: anim === "idle" ? Infinity : 0, ease: "easeInOut" }}
                      className="drop-shadow-[0_8px_10px_rgba(0,0,0,0.45)]"
                    >
                      <PixelSprite grid={BOSS} palette={BOSS_PAL} scale={7} />
                    </motion.div>
                  </div>
                </div>

                {/* Player bottom-left */}
                <div className="relative px-6 pb-5 flex items-end">
                  <div className="flex flex-col items-center gap-1">
                    <motion.div
                      animate={
                        anim === "playerStrike"
                          ? { x: [0, 22, 0], y: [0, -4, 0] }
                          : anim === "playerHit"
                          ? { x: [0, 8, -8, 6, -6, 0], filter: ["brightness(1)", "brightness(2.4)", "brightness(1)"] }
                          : { y: [0, -4, 0] }
                      }
                      transition={{ duration: anim === "idle" ? 2.4 : 0.5, repeat: anim === "idle" ? Infinity : 0, ease: "easeInOut" }}
                      className="drop-shadow-[0_8px_10px_rgba(0,0,0,0.45)]"
                    >
                      <PixelSprite grid={GUARDIAN} palette={GUARDIAN_PAL} scale={7} />
                    </motion.div>
                    <HpTag name="Linguist" level={playerLevel} hp={playerHp} align="left" />
                  </div>
                  <div className="flex-1" />
                </div>
              </div>

              {/* Message box (prompt) */}
              <div className="rounded-2xl border-2 border-[#3a3527] bg-[#16140f] p-3 min-h-[64px] flex items-center">
                <p className="text-sm font-mono leading-relaxed">{question.prompt}</p>
              </div>

              {/* Action menu */}
              {question.type === "choice" ? (
                <div className="grid grid-cols-2 gap-2">
                  {question.options.map((o) => (
                    <button
                      key={o}
                      onClick={() => resolve(o)}
                      className="rounded-xl border-2 border-[#3a3527] hover:border-[#d4a574]/60 bg-[#1d1a13] px-3 py-2.5 text-left text-sm transition capitalize active:scale-95"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && resolve(typed)}
                    placeholder="type the missing word…"
                    className="flex-1 bg-[#16140f] border-2 border-[#3a3527] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#d4a574]/60"
                  />
                  <button
                    onClick={() => resolve(typed)}
                    className="px-4 py-2.5 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider active:scale-95"
                  >
                    Strike
                  </button>
                </div>
              )}

              {/* Arsenal snapshot */}
              <div>
                <p className="text-[10px] uppercase tracking-widest opacity-50 mb-1">Arsenal (top mastery)</p>
                <div className="flex flex-wrap gap-1.5">
                  {[...arsenal].sort((a, b) => b.mastery - a.mastery).slice(0, 8).map((w) => (
                    <span key={w.word} className="text-[10px] px-2 py-1 rounded-lg bg-[#1d1a13] border border-[#3a3527] capitalize">
                      {w.word} <span className="text-[#d4a574]">Lv{MASTERY_TO_LEVEL(w.mastery)}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(phase === "win" || phase === "lose") && (
            <div className="text-center space-y-3 py-4">
              <Crown className="w-10 h-10 text-[#d4a574] mx-auto" />
              <h3 className="font-serif text-2xl font-bold">{phase === "win" ? "Archive Defended" : "The Archive Falls"}</h3>
              <p className="text-[11px] opacity-60">
                {phase === "win" ? "The Forgetting retreats into the margins." : "Sharpen your Arsenal and try again."}
              </p>
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => setPhase("menu")} className="px-4 py-2 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider">
                  Return to Trials
                </button>
                <button
                  onClick={mintShare}
                  className="px-4 py-2 rounded-xl border-2 border-[#3a3527] hover:border-[#d4a574]/50 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"
                >
                  <Share2 className="w-3.5 h-3.5" /> Share
                </button>
              </div>
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

function HpTag({ name, level, hp, align }: { name: string; level: number; hp: number; align: "left" | "right" }) {
  return (
    <div className={`w-40 ${align === "right" ? "text-right" : "text-left"}`}>
      <div className="flex items-center justify-between text-[10px] font-bold tracking-wide">
        <span>{name}</span>
        <span className="opacity-60">Lv{level}</span>
      </div>
      <div className="h-2 rounded-full bg-[#0f0d09] overflow-hidden border border-[#3a3527] mt-0.5">
        <motion.div
          className="h-full rounded-full"
          style={{ background: hp > 50 ? "#6fbf73" : hp > 20 ? "#e0b341" : "#c0504d" }}
          animate={{ width: `${hp}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
    </div>
  );
}
