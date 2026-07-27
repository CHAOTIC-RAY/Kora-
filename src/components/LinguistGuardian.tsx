import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Swords, BookOpen, ScrollText, Brain, Zap, Crown, X } from "lucide-react";
import { getCustomDictionary, DictionaryEntry } from "../lib/dictionary";

/* ── Linguist Guardian ──────────────────────────────────────────────
   Dark-Scholar word-battle. Single-player is fully playable off your
   Reader Arsenal (words you highlight → kora_custom_dictionary). Each
   correct answer damages the boss; wrong answers let the boss strike.

   Multiplayer (P2P Clash) needs backend setup not deployed from this env:
     - battleRooms require Firestore rules published in the Firebase Console
   The full game runs offline: words come from your Reader Arsenal and the
   Cloze sentence is the one you saved when highlighting.
   ─────────────────────────────────────────────────────────────────── */

type Mode = "definer" | "cloze" | "sage";
type Phase = "menu" | "play" | "win" | "lose";

interface ArsenalWord extends DictionaryEntry {
  mastery: number; // correct uses
}

const MODES: { id: Mode; label: string; blurb: string; icon: typeof Swords }[] = [
  { id: "definer", label: "The Definer", blurb: "Memory · read the definition, strike with the word", icon: BookOpen },
  { id: "cloze", label: "The Cloze", blurb: "Application · fill the missing word in your sentence", icon: ScrollText },
  { id: "sage", label: "The Sage", blurb: "Strategy · pick the word that fits the nuance", icon: Brain },
];

const MASTERY_TO_LEVEL = (m: number) => Math.floor(m / 3) + 1;
const PRESTIGE_AT = 9; // mastered after 3 levels → prestige buff

function masteryKey(w: string) {
  return `kora_arsenal_mastery`;
}

function loadMastery(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(masteryKey("")) || "{}");
  } catch {
    return {};
  }
}
function saveMastery(m: Record<string, number>) {
  localStorage.setItem(masteryKey(""), JSON.stringify(m));
}

function buildArsenal(): ArsenalWord[] {
  const custom = getCustomDictionary();
  const base: ArsenalWord[] =
    custom.length > 0
      ? custom
      : [
          { word: "ephemeral", definition: "Lasting for a very short time; transient.", example: "The beauty of the sunset was ephemeral.", isCustom: true },
          { word: "lucid", definition: "Expressed clearly; easy to understand.", example: "He gave a lucid explanation of the motif.", isCustom: true },
          { word: "sovereignty", definition: "Supreme power or authority; self-governing.", example: "Kora guarantees digital sovereignty.", isCustom: true },
          { word: "aesthetic", definition: "Concerned with beauty or appreciation of beauty.", example: "The paperwhite has a minimalist aesthetic.", isCustom: true },
          { word: "resilient", definition: "Able to recover quickly from difficulties.", example: "The resilient hero endured the trial.", isCustom: true },
          { word: "somber", definition: "Gloomy; depressing; serious.", example: "The mood was somber but hopeful.", isCustom: true },
        ];
  const mastery = loadMastery();
  return base.map((e) => ({ ...e, mastery: mastery[e.word.toLowerCase()] || 0 }));
}

function blankWord(sentence?: string, word?: string): string {
  if (!sentence || !word) return "";
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return sentence.replace(re, "______");
}

export default function LinguistGuardian({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [arsenal, setArsenal] = useState<ArsenalWord[]>([]);
  const [phase, setPhase] = useState<Phase>("menu");
  const [mode, setMode] = useState<Mode>("definer");
  const [bossHp, setBossHp] = useState(100);
  const [playerHp, setPlayerHp] = useState(100);
  const [question, setQuestion] = useState<{
    prompt: string;
    answer: string;
    options: string[];
    type: "choice" | "type";
  } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [battleCode, setBattleCode] = useState<string>("");

  useEffect(() => {
    if (open) {
      setArsenal(buildArsenal());
      setPhase("menu");
      setBossHp(100);
      setPlayerHp(100);
      setLog([]);
      setQuestion(null);
    }
  }, [open]);

  const logMsg = (m: string) =>
    setLog((l) => [`> ${m}`, ...l].slice(0, 40));

  // Build a question for the current mode from the Arsenal.
  const nextQuestion = (m: Mode, pool: ArsenalWord[]) => {
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
    const target = usable[Math.floor(Math.random() * usable.length)];
    if (m === "definer") {
      const others = usable.filter((w) => w.word !== target.word).sort(() => Math.random() - 0.5).slice(0, 3);
      const opts = [...others.map((w) => w.word), target.word].sort(() => Math.random() - 0.5);
      setQuestion({
        prompt: `DEFINITION — ${target.definition}`,
        answer: target.word,
        options: opts,
        type: "choice",
      });
    } else if (m === "cloze") {
      setQuestion({
        prompt: `CLOZE — ${blankWord(target.example, target.word) || "No sentence saved. Definition: " + target.definition}`,
        answer: target.word,
        options: [],
        type: "type",
      });
    } else {
      // Sage — pick the word matching a mood/scenario prompt
      const others = usable.filter((w) => w.word !== target.word).sort(() => Math.random() - 0.5).slice(0, 2);
      const opts = [...others.map((w) => w.word), target.word].sort(() => Math.random() - 0.5);
      const mood =
        target.word === "somber"
          ? "The mood is somber but hopeful — which word fits the nuance?"
          : `A passage calls for a ${target.word} tone. Which Arsenal word lands the nuance?`;
      setQuestion({ prompt: `SAGE — ${mood}`, answer: target.word, options: opts, type: "choice" });
    }
  };

  const startBattle = (m: Mode) => {
    setMode(m);
    setPhase("play");
    setBossHp(100);
    setPlayerHp(100);
    setLog([]);
    logMsg(`Battle begun · ${MODES.find((x) => x.id === m)?.label}`);
    nextQuestion(m, arsenal);
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
      if (playerHp - back <= 0) {
        setPhase("lose");
        logMsg("The Archive falls…");
        return;
      }
    }
    setTyped("");
  };

  if (!open) return null;

  const popup = (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="relative w-full max-w-2xl max-h-[92vh] bg-[#16140f] text-[#e9e2d0] rounded-3xl overflow-hidden flex flex-col shadow-2xl border border-[#3a3527]"
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Linguist Guardian"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-[#3a3527] bg-[#1d1a13]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#d4a574]/15 border border-[#d4a574]/25">
              <Swords className="w-4 h-4 text-[#d4a574]" />
            </div>
            <div>
              <h2 className="font-serif text-lg font-bold tracking-tight">Linguist Guardian</h2>
              <p className="text-[10px] uppercase tracking-widest opacity-50">Defend the Kora Archives</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full border border-white/10 hover:bg-white/5" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {phase === "menu" && (
            <div className="space-y-4">
              <p className="text-sm opacity-70 text-center">Choose your trial. Every word you master in the Reader is already in your Arsenal.</p>
              <div className="grid gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => startBattle(m.id)}
                    className="rounded-2xl border border-[#3a3527] bg-[#1d1a13] hover:border-[#d4a574]/50 p-3 text-left transition flex items-center gap-3"
                  >
                    <m.icon className="w-5 h-5 text-[#d4a574]" />
                    <div>
                      <p className="font-serif font-bold">{m.label}</p>
                      <p className="text-[10px] opacity-55 mt-0.5">{m.blurb}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Multiplayer / P2P Clash — requires Firestore battleRooms rules published */}
              <div className="rounded-2xl border border-dashed border-[#3a3527] p-3 space-y-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#d4a574]">
                  <Crown className="w-3.5 h-3.5" /> P2P Clash (Battle Code)
                </div>
                <p className="text-[10px] opacity-55 leading-relaxed">
                  Co-op / 1v1 sync runs on a Firestore <code>battleRooms</code> collection. Publish the
                  battleRooms rules in the Firebase Console to enable live rooms — for now, generate a
                  code to reserve your duel.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBattleCode(String(Math.floor(100000 + Math.random() * 900000)))}
                    className="px-3 py-2 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider"
                  >
                    Generate Code
                  </button>
                  {battleCode && <span className="self-center font-mono text-sm text-[#d4a574]">{battleCode}</span>}
                </div>
              </div>
            </div>
          )}

          {phase === "play" && question && (
            <div className="space-y-4">
              {/* Boss + player bars */}
              <div className="space-y-2">
                <Bar label="Boss · The Forgetting" value={bossHp} color="#c0504d" icon={<Zap className="w-3 h-3" />} />
                <Bar label="Linguist Guardian" value={playerHp} color="#5a9bd4" icon={<Swords className="w-3 h-3" />} />
              </div>

              <div className="rounded-2xl border border-[#3a3527] bg-[#1d1a13] p-4 space-y-3">
                <p className="text-sm font-mono leading-relaxed">{question.prompt}</p>
                {question.type === "choice" ? (
                  <div className="grid gap-2">
                    {question.options.map((o) => (
                      <button
                        key={o}
                        onClick={() => resolve(o)}
                        className="rounded-xl border border-[#3a3527] hover:border-[#d4a574]/50 px-3 py-2 text-left text-sm transition capitalize"
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
                      className="flex-1 bg-[#16140f] border border-[#3a3527] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#d4a574]/60"
                    />
                    <button onClick={() => resolve(typed)} className="px-4 py-2 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider">
                      Strike
                    </button>
                  </div>
                )}
              </div>

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
            <div className="text-center space-y-3 py-6">
              <Crown className="w-10 h-10 text-[#d4a574] mx-auto" />
              <h3 className="font-serif text-2xl font-bold">{phase === "win" ? "Archive Defended" : "The Archive Falls"}</h3>
              <button onClick={() => setPhase("menu")} className="px-4 py-2 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider">
                Return to Trials
              </button>
            </div>
          )}

          {/* Combat log */}
          {log.length > 0 && (
            <div className="rounded-xl border border-[#3a3527] bg-black/30 p-3 h-32 overflow-y-auto font-mono text-[10px] leading-relaxed opacity-80">
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

function Bar({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest opacity-70">
        <span className="flex items-center gap-1">{icon} {label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-[#0f0d09] overflow-hidden border border-[#3a3527]">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
    </div>
  );
}
