import React, { useState, useEffect } from "react";

export default function Quote() {
  const [quote, setQuote] = useState<{ quote: string; author: string } | null>(null);

  useEffect(() => {
    const fetchQuote = async () => {
      try {
        const res = await fetch("https://api.api-ninjas.com/v1/quotes?category=wisdom", {
          headers: { "X-Api-Key": "gM7NAKrnJDAGWNzi56pElQtCm5MLOBWscpgbl3qk" }
        });
        const data = await res.json();
        if (data && data.length > 0) {
          setQuote(data[0]);
        } else {
          setQuote({ quote: "Reading is to the mind what exercise is to the body.", author: "Richard Steele" });
        }
      } catch (e) {
        setQuote({ quote: "A room without books is like a body without a soul.", author: "Marcus Tullius Cicero" });
      }
    };
    fetchQuote();
  }, []);

  if (!quote) return null;

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

