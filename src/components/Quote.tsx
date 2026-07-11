import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";

interface QuoteItem {
  quote: string;
  author: string;
}

const LITERARY_QUOTES: QuoteItem[] = [
  { quote: "A room without books is like a body without a soul.", author: "Marcus Tullius Cicero" },
  { quote: "Reading is to the mind what exercise is to the body.", author: "Richard Steele" },
  { quote: "I have always imagined that Paradise will be a kind of library.", author: "Jorge Luis Borges" },
  { quote: "There is no friend as loyal as a book.", author: "Ernest Hemingway" },
  { quote: "Books are a uniquely portable magic.", author: "Stephen King" },
  { quote: "To read is to voyage through time and space.", author: "Kora Reader" },
  { quote: "The only thing you absolutely have to know is the location of the library.", author: "Albert Einstein" },
  { quote: "A book is a device to ignite the imagination.", author: "Alan Bennett" },
  { quote: "We read to know we are not alone.", author: "C.S. Lewis" },
  { quote: "Libraries will get you through times of no money better than money will get you through times of no libraries.", author: "Anne Herbert" },
  { quote: "The reading of all good books is like a conversation with the finest minds of past centuries.", author: "René Descartes" },
  { quote: "Books are the quietest and most constant of friends.", author: "Charles William Eliot" }
];

export default function Quote() {
  const [quotesList, setQuotesList] = useState<QuoteItem[]>(LITERARY_QUOTES);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to start the auto-slide timer
  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % quotesList.length);
    }, 8000); // Cycle every 8 seconds
  };

  // Click to manually slide/scroll to the next quote
  const handleQuoteClick = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % quotesList.length);
    // Reset timer on manual click to give full duration to the newly displayed quote
    startTimer();
  };

  // On mount, fetch dynamic quotes and append/prepend to list
  useEffect(() => {
    const fetchQuotes = async () => {
      try {
        const res = await fetch("https://api.api-ninjas.com/v1/quotes?category=wisdom", {
          headers: { "X-Api-Key": "gM7NAKrnJDAGWNzi56pElQtCm5MLOBWscpgbl3qk" }
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            const fetchedQuotes = data.map((q: any) => ({
              quote: q.quote,
              author: q.author || "Anonymous"
            }));
            setQuotesList((prev) => [...fetchedQuotes, ...prev]);
          }
        }
      } catch (e) {
        console.warn("Could not fetch wisdom quotes from API-Ninjas, using rich local presets.");
      }
    };
    fetchQuotes();
  }, []);

  // Setup/restart timer when quotes list length or state is initialized
  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [quotesList.length]);

  const activeQuote = quotesList[currentIndex] || LITERARY_QUOTES[0];

  return (
    <div 
      onClick={handleQuoteClick}
      className="flex flex-1 items-center gap-2 min-w-0 w-full px-2 md:px-3 overflow-hidden cursor-pointer hover:opacity-90 active:scale-[0.99] transition-all select-none group"
      title="Click to view next quote"
    >
      <div className="w-px h-8 bg-kindle-border shrink-0 opacity-60" />
      
      {/* Scrollable / Slidable text container */}
      <div className="relative h-5 overflow-hidden flex-1 flex items-center min-w-0">
        <AnimatePresence mode="wait">
          <motion.p
            key={currentIndex}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="text-[10px] md:text-[11px] leading-snug text-kindle-text-muted font-serif italic truncate w-full pr-1"
          >
            <span className="opacity-70">"</span>
            {activeQuote.quote}
            <span className="opacity-70">"</span>
            {" "}
            <span className="font-sans font-semibold not-italic opacity-50 text-[9px] md:text-[10px] group-hover:text-kindle-accent transition-colors pl-1">
              — {activeQuote.author}
            </span>
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
