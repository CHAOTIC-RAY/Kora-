import React, { useEffect, useState } from "react";
import { X, Flame, BookOpen, Quote } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface DailyReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  nickname: string;
}

const READING_QUOTES = [
  { text: "The more that you read, the more things you will know. The more that you learn, the more places you'll go.", author: "Dr. Seuss" },
  { text: "A reader lives a thousand lives before he dies. The man who never reads lives only one.", author: "George R.R. Martin" },
  { text: "Reading is essential for those who seek to rise above the ordinary.", author: "Jim Rohn" },
  { text: "Books are a uniquely portable magic.", author: "Stephen King" },
  { text: "I find television very educating. Every time somebody turns on the set, I go into the other room and read a book.", author: "Groucho Marx" },
  { text: "A room without books is like a body without a soul.", author: "Cicero" },
  { text: "Once you learn to read, you will be forever free.", author: "Frederick Douglass" },
  { text: "Books are the quietest and most constant of friends; they are the most accessible and wisest of counselors, and the most patient of teachers.", author: "Charles W. Eliot" }
];

function calculateStreak(stats: Record<string, { minutes: number }>): number {
  let streak = 0;
  let checkDate = new Date();
  
  const getCleanDateString = (d: Date) => d.toDateString();
  
  const todayStr = getCleanDateString(checkDate);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getCleanDateString(yesterday);
  
  const hasReadToday = stats[todayStr] && stats[todayStr].minutes > 0;
  const hasReadYesterday = stats[yesterdayStr] && stats[yesterdayStr].minutes > 0;
  
  if (!hasReadToday && !hasReadYesterday) {
    return 0;
  }
  
  if (!hasReadToday) {
    checkDate = yesterday;
  }
  
  while (true) {
    const dateStr = getCleanDateString(checkDate);
    if (stats[dateStr] && stats[dateStr].minutes > 0) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  return streak;
}

export default function DailyReminderModal({ isOpen, onClose, nickname }: DailyReminderModalProps) {
  const [quote, setQuote] = useState(READING_QUOTES[0]);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (isOpen) {
      // Pick a random quote
      const randomIndex = Math.floor(Math.random() * READING_QUOTES.length);
      setQuote(READING_QUOTES[randomIndex]);

      // Load streak
      const savedStats = localStorage.getItem("kora_reading_stats");
      const stats = savedStats ? JSON.parse(savedStats) : {};
      setStreak(calculateStreak(stats));
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-100 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          <motion.button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.85 }}
            className="relative w-full max-w-md bg-kindle-bg border border-kindle-border rounded-2xl shadow-2xl overflow-hidden"
          >
          {/* Top accent line */}
          <div className="h-1.5 w-full bg-kindle-accent" />
          
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-kindle-text-muted hover:text-kindle-text transition-colors rounded-full hover:bg-kindle-card"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="p-8 space-y-8">
            {/* Header */}
            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-kindle-accent/10 rounded-full border border-kindle-accent/20">
                <BookOpen className="w-4 h-4 text-kindle-text-muted" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-text">Daily Motivation</span>
              </div>
              <h2 className="text-2xl font-display font-bold text-kindle-text tracking-tight">
                Good day, {nickname}
              </h2>
            </div>

            {/* Streak Counter */}
            <div className="bg-kindle-card border border-kindle-border rounded-xl p-4 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/10 rounded-lg">
                  <Flame className="w-6 h-6 text-orange-500" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-kindle-text-muted">Reading Streak</p>
                  <p className="text-xl font-display font-bold text-kindle-text">{streak} Days</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-kindle-text-muted italic">Keep it going!</p>
              </div>
            </div>

            {/* Quote Card */}
            <div className="relative p-6 bg-kindle-card/50 border border-kindle-border rounded-xl italic">
              <Quote className="absolute -top-3 -left-3 w-8 h-8 text-kindle-accent/20 rotate-180" />
              <div className="space-y-4">
                <p className="text-sm leading-relaxed text-kindle-text font-serif">
                  &ldquo;{quote.text}&rdquo;
                </p>
                <p className="text-xs text-kindle-text-muted font-sans font-bold not-italic text-right">
                  &mdash; {quote.author}
                </p>
              </div>
            </div>

            {/* Motivation Text */}
            <div className="text-center space-y-4">
              <p className="text-xs text-kindle-text-muted leading-relaxed max-w-[280px] mx-auto">
                Take a few minutes today to escape into another world. Your library is waiting for you.
              </p>
              
              <button
                onClick={onClose}
                className="w-full py-3 bg-kindle-accent text-kindle-bg font-bold rounded-xl text-xs uppercase tracking-widest hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-md shadow-kindle-accent/20"
              >
                <BookOpen className="w-4 h-4" />
                Start Reading Today
              </button>
            </div>
          </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
