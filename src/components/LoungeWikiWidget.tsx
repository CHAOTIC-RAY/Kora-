import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Globe,
  Shuffle,
  Volume2,
  VolumeX,
  BookOpen,
  Sparkles,
  ExternalLink,
  Download,
  Bookmark
} from "lucide-react";
import { toast } from "react-hot-toast";
import { storeBookFile } from "../db/indexedDB";
import { syncBookToCloud, BookMetadata } from "../lib/firebase";

export interface WikiRandomArticle {
  pageid?: number;
  title: string;
  extract: string;
  description?: string;
  thumbnail?: {
    source: string;
    width: number;
    height: number;
  };
  content_urls?: {
    desktop: { page: string };
    mobile: { page: string };
  };
  lang?: string;
}

interface LoungeWikiWidgetProps {
  onOpenWikipedia?: () => void;
  userId?: string;
  onRefreshLibrary?: () => void;
  grayscaleCovers?: boolean;
}

export default function LoungeWikiWidget({
  onOpenWikipedia,
  userId,
  onRefreshLibrary,
  grayscaleCovers = false,
}: LoungeWikiWidgetProps) {
  const [article, setArticle] = useState<WikiRandomArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState("en");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch a random Wikipedia article
  const fetchRandom = async (selectedLang = lang) => {
    setLoading(true);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }

    try {
      const res = await fetch(
        `https://${selectedLang}.wikipedia.org/api/rest_v1/page/random/summary`
      );
      if (res.ok) {
        const data = await res.json();
        setArticle(data);
      } else {
        throw new Error("API returned non-200");
      }
    } catch (err) {
      console.error("Failed to fetch random Wikipedia article", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRandom(lang);
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [lang]);

  // Read Aloud / Speech Synthesis
  const handleToggleSpeech = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!('speechSynthesis' in window)) {
      toast.error("Speech synthesis not supported on this device");
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    if (!article?.extract) return;

    const textToRead = `${article.title}. ${article.description || ''}. ${article.extract}`;
    const utterance = new SpeechSynthesisUtterance(textToRead.slice(0, 1200));
    utterance.lang = lang;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  // Convert Article to Ebook
  const handleSaveToLibrary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!article) return;

    setIsSaving(true);
    const toastId = toast.loading("Saving article to Kora Ebook library...");

    try {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${article.title}</title>
          <style>
            body { font-family: serif; padding: 20px; line-height: 1.6; color: #111; }
            h1 { font-size: 2em; margin-bottom: 0.2em; }
            .desc { font-style: italic; color: #666; margin-bottom: 1.5em; }
            .thumb { max-width: 100%; height: auto; margin: 1em 0; border-radius: 8px; }
            p { font-size: 1.1em; margin-bottom: 1em; }
            footer { margin-top: 3em; border-top: 1px solid #ccc; padding-top: 1em; font-size: 0.8em; color: #888; }
          </style>
        </head>
        <body>
          <h1>${article.title}</h1>
          ${article.description ? `<div class="desc">${article.description}</div>` : ""}
          ${article.thumbnail?.source ? `<img class="thumb" src="${article.thumbnail.source}" alt="${article.title}" />` : ""}
          <p>${article.extract}</p>
          <footer>Source: Wikipedia Random • ${new Date().toLocaleDateString()}</footer>
        </body>
        </html>
      `;

      const blob = new Blob([htmlContent], { type: "text/html" });
      const bookId = `wiki-${article.pageid || Date.now()}`;
      const fileName = `${article.title.replace(/[^a-zA-Z0-9]/g, "_")}.html`;
      await storeBookFile(bookId, blob, fileName, "html");

      const metadata: BookMetadata = {
        id: bookId,
        title: article.title,
        author: "Wikipedia",
        filename: fileName,
        coverUrl: article.thumbnail?.source || undefined,
        size: `${Math.round(blob.size / 1024)} KB`,
        extension: "html",
        dateAdded: Date.now(),
        dateModified: Date.now(),
        tags: ["Wikipedia", "Random Article", "Knowledge"],
        status: "to-read",
        progress: {
          percent: 0,
          lastReadTime: Date.now(),
        },
      };

      if (userId) {
        await syncBookToCloud(userId, metadata);
      } else {
        const localLib = JSON.parse(localStorage.getItem("kora_local_library") || "[]");
        localStorage.setItem("kora_local_library", JSON.stringify([metadata, ...localLib]));
      }

      toast.success(`"${article.title}" saved to library!`, { id: toastId });
      if (onRefreshLibrary) onRefreshLibrary();
    } catch (err) {
      console.error("Failed to save Wikipedia article to library", err);
      toast.error("Failed to save article to library.", { id: toastId });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Widget Top Header Bar */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Globe className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-kindle-text truncate">
            Random Article
          </h3>
          <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            Wikipedia
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Language Selector */}
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="text-[9px] font-mono bg-kindle-bg border border-kindle-border text-kindle-text rounded-md px-1.5 py-0.5 focus:outline-none focus:border-kindle-accent cursor-pointer"
            aria-label="Wikipedia Language"
          >
            <option value="en">EN</option>
            <option value="es">ES</option>
            <option value="fr">FR</option>
            <option value="de">DE</option>
            <option value="ja">JA</option>
          </select>

          {/* Shuffle / Next Article */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fetchRandom();
            }}
            disabled={loading}
            className="p-1.5 rounded-lg bg-kindle-bg border border-kindle-border text-kindle-text hover:text-kindle-accent transition cursor-pointer disabled:opacity-50"
            title="Fetch another random Wikipedia article"
            aria-label="Fetch random article"
          >
            <Shuffle className={`w-3 h-3 ${loading ? "animate-spin text-amber-500" : ""}`} />
          </button>
        </div>
      </div>

      {/* Widget Main Card Area */}
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-2.5 py-2"
          >
            <div className="h-4 bg-kindle-text-muted/15 rounded-md w-3/4 animate-pulse" />
            <div className="h-3 bg-kindle-text-muted/10 rounded-md w-1/2 animate-pulse" />
            <div className="space-y-1.5 pt-1">
              <div className="h-2.5 bg-kindle-text-muted/10 rounded w-full animate-pulse" />
              <div className="h-2.5 bg-kindle-text-muted/10 rounded w-5/6 animate-pulse" />
            </div>
          </motion.div>
        ) : article ? (
          <motion.div
            key={article.title}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-2.5"
          >
            <div className="flex gap-3 items-start">
              {/* Optional Thumbnail */}
              {article.thumbnail?.source && (
                <div className="shrink-0 w-14 h-18 rounded-xl overflow-hidden border border-kindle-border bg-black/10 shadow-xs relative">
                  <img
                    src={article.thumbnail.source}
                    alt={article.title}
                    className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`}
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-1">
                {article.description && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 block truncate">
                    {article.description}
                  </span>
                )}
                <h4 className="text-sm font-serif font-bold text-kindle-text leading-snug line-clamp-2">
                  {article.title}
                </h4>
                <p className="text-[11px] text-kindle-text-muted leading-relaxed line-clamp-3">
                  {article.extract}
                </p>
              </div>
            </div>

            {/* Action Bar inside Tile */}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-kindle-border/40">
              <div className="flex items-center gap-1.5">
                {/* Speech TTS Button */}
                <button
                  type="button"
                  onClick={handleToggleSpeech}
                  className={`p-1.5 rounded-lg border text-[10px] font-medium transition cursor-pointer flex items-center gap-1 ${
                    isSpeaking
                      ? "bg-amber-500 text-black border-amber-500 font-bold"
                      : "bg-kindle-bg border-kindle-border text-kindle-text hover:text-amber-500"
                  }`}
                  title={isSpeaking ? "Stop listening" : "Listen to article summary"}
                >
                  {isSpeaking ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                  <span className="hidden sm:inline">{isSpeaking ? "Stop" : "Listen"}</span>
                </button>

                {/* Save to Ebook Library */}
                <button
                  type="button"
                  onClick={handleSaveToLibrary}
                  disabled={isSaving}
                  className="p-1.5 rounded-lg bg-kindle-bg border border-kindle-border text-kindle-text hover:text-kindle-accent transition cursor-pointer text-[10px] font-medium flex items-center gap-1 disabled:opacity-50"
                  title="Save this Wikipedia article as an Ebook"
                >
                  <Bookmark className="w-3 h-3" />
                  <span className="hidden sm:inline">Save Ebook</span>
                </button>
              </div>

              {/* Full Article Modal or External Link */}
              {onOpenWikipedia ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenWikipedia();
                  }}
                  className="px-2.5 py-1 rounded-lg bg-kindle-accent/15 border border-kindle-accent/30 text-kindle-accent hover:bg-kindle-accent hover:text-white transition cursor-pointer text-[10px] font-bold uppercase tracking-wider flex items-center gap-1"
                >
                  <BookOpen className="w-3 h-3" />
                  <span>Wikipedia Hub</span>
                </button>
              ) : article.content_urls?.desktop?.page ? (
                <a
                  href={article.content_urls.desktop.page}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="px-2.5 py-1 rounded-lg bg-kindle-accent/15 border border-kindle-accent/30 text-kindle-accent hover:bg-kindle-accent hover:text-white transition cursor-pointer text-[10px] font-bold uppercase tracking-wider flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Full Article</span>
                </a>
              ) : null}
            </div>
          </motion.div>
        ) : (
          <div className="py-4 text-center text-xs text-kindle-text-muted space-y-2">
            <p>Could not load random article.</p>
            <button
              type="button"
              onClick={() => fetchRandom()}
              className="text-amber-500 underline text-[10px] font-bold uppercase tracking-wider"
            >
              Retry Fetch
            </button>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
