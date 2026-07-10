import React, { useState, useEffect } from "react";

const FALLBACK_QUOTES = [
  { quote: "A room without books is like a body without a soul.", author: "Marcus Tullius Cicero" },
  { quote: "Reading is to the mind what exercise is to the body.", author: "Richard Steele" },
  { quote: "I have always imagined that Paradise will be a kind of library.", author: "Jorge Luis Borges" },
  { quote: "There is no friend as loyal as a book.", author: "Ernest Hemingway" },
  { quote: "Books are a uniquely portable magic.", author: "Stephen King" }
];

export default function Quote() {
  const [quote, setQuote] = useState<{ quote: string; author: string }>(() => {
    const randomIndex = Math.floor(Math.random() * FALLBACK_QUOTES.length);
    return FALLBACK_QUOTES[randomIndex];
  });

  useEffect(() => {
    const fetchQuote = async () => {
      try {
        const res = await fetch("https://api.api-ninjas.com/v1/quotes?category=wisdom", {
          headers: { "X-Api-Key": "gM7NAKrnJDAGWNzi56pElQtCm5MLOBWscpgbl3qk" }
        });
        if (!res.ok) throw new Error("API-Ninjas request failed");
        const data = await res.json();
        if (data && data.length > 0) {
          setQuote(data[0]);
        }
      } catch (e) {
        // Fallback is already initialized in state
      }
    };
    fetchQuote();
  }, []);

  return (
    <div className="hidden sm:flex flex-1 items-center gap-2 min-w-0 max-w-xs md:max-w-sm lg:max-w-md xl:max-w-lg px-3 overflow-hidden">
      <div className="w-px h-8 bg-kindle-border shrink-0 opacity-60" />
      <p
        className="text-[11px] leading-snug text-kindle-text-muted font-serif italic truncate"
        title={`"${quote.quote}" — ${quote.author}`}
      >
        <span className="opacity-70">"</span>{quote.quote}<span className="opacity-70">"</span>
        {" "}
        <span className="font-sans font-semibold not-italic opacity-60 text-[10px]">— {quote.author}</span>
      </p>
    </div>
  );
}

