import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ChevronLeft, ChevronRight, BookOpen } from "lucide-react";

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

const SLIDE_MS = 8000;

export default function Quote() {
  const [quotesList] = useState<QuoteItem[]>(LITERARY_QUOTES);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isModalOpenRef = useRef(isModalOpen);
  isModalOpenRef.current = isModalOpen;

  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (isModalOpenRef.current) return;
      setCurrentIndex((prev) => (prev + 1) % quotesList.length);
    };

    const start = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(tick, SLIDE_MS);
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } else {
        start();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [quotesList.length]);

  const activeQuote = quotesList[currentIndex] || LITERARY_QUOTES[0];

  const handleNext = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % quotesList.length);
  };

  const handlePrev = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + quotesList.length) % quotesList.length);
  };

  return (
    <>
      <div
        onClick={() => setIsModalOpen(true)}
        className="flex flex-1 items-center gap-2.5 min-w-0 w-full px-1.5 md:px-2.5 overflow-hidden cursor-pointer hover:opacity-90 active:scale-[0.99] transition-all select-none group"
        title="Click to view quote scroll"
      >
        <div className="w-px h-8 bg-kindle-border shrink-0 opacity-60" />

        {/* Slidable text container */}
        <div className="relative h-9 overflow-hidden flex-1 flex items-center min-w-0">
          <AnimatePresence mode="wait">
            <motion.p
              key={currentIndex}
              initial={{ y: 15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -15, opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
              className="text-[10px] md:text-[11.5px] leading-snug text-kindle-text-muted font-serif italic w-full pr-1 flex items-center gap-1.5"
            >
              <span className="truncate flex-1">
                <span className="opacity-70 font-semibold mr-0.5">“</span>
                {activeQuote.quote}
                <span className="opacity-70 font-semibold ml-0.5">”</span>
                {" "}
                <span className="font-sans font-bold not-italic opacity-40 text-[9px] md:text-[10px] group-hover:text-kindle-accent transition-colors pl-1">
                  — {activeQuote.author}
                </span>
              </span>
            </motion.p>
          </AnimatePresence>
        </div>
      </div>

      {/* Ancient Scroll detailed full-screen modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 md:p-8"
            onClick={() => setIsModalOpen(false)}
          >
            {/* Scroll Container */}
            <motion.div
              initial={{ scaleY: 0.1, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              exit={{ scaleY: 0.1, opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="relative max-w-xl w-full flex flex-col items-center origin-center"
              onClick={(e) => e.stopPropagation()}
            >
              
              {/* Top Wooden Roller Stick */}
              <div className="w-[104%] h-4 md:h-5 bg-gradient-to-r from-amber-950 via-amber-800 to-amber-950 rounded-full shadow-lg relative z-20 flex justify-between px-2">
                <div className="w-2 h-full bg-amber-600/30 rounded-full" />
                <div className="w-2 h-full bg-amber-600/30 rounded-full" />
              </div>

              {/* Parchment scroll body */}
              <div className="w-[96%] bg-gradient-to-b from-[#eadecc] via-[#f5ede0] to-[#eadecc] text-amber-950 p-6 md:p-12 shadow-2xl relative z-10 border-l-2 border-r-2 border-amber-900/20 flex flex-col justify-between items-center overflow-hidden min-h-[350px] md:min-h-[420px]">
                
                {/* Ancient paper background textures */}
                <div className="absolute inset-0 opacity-[0.04] pointer-events-none mix-blend-multiply bg-[radial-gradient(#2c1d0f_1px,transparent_1px)] [background-size:16px_16px]" />
                
                {/* Elegant top ornament */}
                <div className="flex flex-col items-center gap-1 opacity-75">
                  <div className="w-12 h-0.5 bg-amber-900/30" />
                  <div className="text-[10px] font-sans font-bold uppercase tracking-[0.25em] text-amber-900/60 flex items-center gap-1.5">
                    <BookOpen className="w-3 h-3 text-amber-800/80" /> Literary Scroll
                  </div>
                  <div className="w-12 h-0.5 bg-amber-900/30" />
                </div>

                {/* The Quote body */}
                <div className="my-8 flex-1 flex items-center justify-center">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentIndex}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.3 }}
                      className="text-center space-y-6"
                    >
                      <p className="font-serif italic text-lg sm:text-xl md:text-2xl lg:text-3xl font-medium leading-relaxed tracking-wide text-amber-950/90 px-2 sm:px-4">
                        “{activeQuote.quote}”
                      </p>
                      
                      {/* Signature / Author */}
                      <div className="flex items-center justify-center gap-3">
                        <span className="w-6 h-px bg-amber-900/20" />
                        <span className="font-sans font-bold tracking-[0.15em] uppercase text-xs text-amber-900/70">
                          {activeQuote.author}
                        </span>
                        <span className="w-6 h-px bg-amber-900/20" />
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* Left & Right scroll flip buttons */}
                <div className="flex items-center gap-6 mt-2 relative z-20">
                  <button
                    onClick={handlePrev}
                    className="p-2 border border-amber-900/20 hover:border-amber-900/50 rounded-full bg-amber-900/5 hover:bg-amber-900/10 text-amber-900 transition active:scale-95"
                    title="Previous Scroll"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-[10px] font-mono tracking-widest text-amber-900/40 font-bold">
                    {currentIndex + 1} / {quotesList.length}
                  </span>
                  <button
                    onClick={handleNext}
                    className="p-2 border border-amber-900/20 hover:border-amber-900/50 rounded-full bg-amber-900/5 hover:bg-amber-900/10 text-amber-900 transition active:scale-95"
                    title="Next Scroll"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Wax Seal close button positioned on the scroll corner */}
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="absolute top-4 right-4 w-9 h-9 bg-red-800 hover:bg-red-700 text-amber-100 rounded-full flex items-center justify-center shadow-lg border border-red-950/40 transition-all hover:scale-110 active:scale-95 z-30 group"
                  title="Seal Scroll & Close"
                >
                  <X className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
                </button>
              </div>

              {/* Bottom Wooden Roller Stick */}
              <div className="w-[104%] h-4 md:h-5 bg-gradient-to-r from-amber-950 via-amber-800 to-amber-950 rounded-full shadow-lg relative z-20 flex justify-between px-2">
                <div className="w-2 h-full bg-amber-600/30 rounded-full" />
                <div className="w-2 h-full bg-amber-600/30 rounded-full" />
              </div>

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

