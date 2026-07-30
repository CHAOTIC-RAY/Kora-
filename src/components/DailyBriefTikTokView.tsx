import React, {useEffect, useRef, useState, useMemo} from"react";
import {createPortal} from"react-dom";
import {
 ChevronDown,
 X,
 Bookmark,
 Share2,
 ExternalLink,
 Sparkles,
 Zap,
 Newspaper,
 ArrowLeft,
 CheckCircle2,
} from"lucide-react";
import type {FeedItem} from"../lib/feedStorage";
import {getItemThumbnail} from"../lib/feedPreview";
import {collectTodayBriefArticles, buildTodayDailyBrief} from"../lib/dailyNewsBriefClient";
import {toast} from"react-hot-toast";
import {resolveFeedArticle, prepareFeedArticleHtml} from"../lib/feedArticle";

interface DailyBriefTikTokViewProps {
 items: FeedItem[];
 isOpen: boolean;
 onClose: () => void;
 onSave: (item: FeedItem) => void;
 onRead: (item: FeedItem) => void;
 grayscaleCovers?: boolean;
}

export default function DailyBriefTikTokView({
 items,
 isOpen,
 onClose,
 onSave,
 onRead,
 grayscaleCovers = false,
}: DailyBriefTikTokViewProps) {
 const containerRef = useRef<HTMLDivElement>(null);
 const touchStartRef = useRef<{x: number; y: number; time: number} | null>(null);
 const [dragY, setDragY] = useState(0);
 const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);
 const [resolvedStories, setResolvedStories] = useState<
 Record<string, {title: string; html: string; loading: boolean; error?: string}>
 >({});

 // Compile today's brief
 const brief = useMemo(() => {
 let articles = collectTodayBriefArticles(items);
 if (articles.length < 2 && items.length > 0) {
 const sorted = [...items].sort((a, b) => b.publishedAt - a.publishedAt);
 articles = sorted.slice(0, 24).map((item) => ({
 id: item.id,
 source: item.subscriptionTitle,
 title: item.title,
 summary: item.summary,
 link: item.link,
}));
}
 if (articles.length < 2) return null;
 return buildTodayDailyBrief(articles);
}, [items]);

 // Lock body scroll when open
 useEffect(() => {
 if (!isOpen) return;
 const originalStyle = document.body.style.overflow;
 document.body.style.overflow ="hidden";
 return () => {
 document.body.style.overflow = originalStyle;
};
}, [isOpen]);

 // Fetch story content if expanded
 useEffect(() => {
 if (!isOpen || !expandedStoryId) return;
 const item = items.find((i) => i.id === expandedStoryId);
 if (!item || resolvedStories[item.id]) return;

 setResolvedStories((prev) => ({
 ...prev,
 [item.id]: {title: item.title, html:"", loading: true},
}));

 resolveFeedArticle(item)
 .then((resolved) => {
 setResolvedStories((prev) => ({
 ...prev,
 [item.id]: {
 title: resolved.title || item.title,
 html: resolved.htmlContent || item.summary ||"",
 loading: false,
},
}));
})
 .catch((err) => {
 setResolvedStories((prev) => ({
 ...prev,
 [item.id]: {
 title: item.title,
 html: item.summary ||"",
 loading: false,
 error: (err as Error).message,
},
}));
});
}, [expandedStoryId, isOpen, items, resolvedStories]);

 // Handle Swipe Down to return to TikTok Feed
 const handleTouchStart = (e: React.TouchEvent) => {
 if (e.touches.length === 1) {
 touchStartRef.current = {
 x: e.touches[0].clientX,
 y: e.touches[0].clientY,
 time: Date.now(),
};
}
};

 const handleTouchMove = (e: React.TouchEvent) => {
 if (!touchStartRef.current) return;
 const dy = e.touches[0].clientY - touchStartRef.current.y;
 const dx = Math.abs(e.touches[0].clientX - touchStartRef.current.x);

 const scrollTop = containerRef.current?.scrollTop || 0;
 // When pulling down at the top of scroll container
 if (scrollTop <= 0 && dy > 0 && dy > dx) {
 setDragY(dy);
}
};

 const handleTouchEnd = () => {
 if (dragY > 60) {
 onClose();
}
 setDragY(0);
 touchStartRef.current = null;
};

 // Keyboard navigation: ArrowDown or Escape dismisses back to TikTok Feed
 const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
 if (e.key ==="Escape"|| e.key ==="ArrowDown") {
 e.preventDefault();
 onClose();
}
};

 const handleShareBrief = async () => {
 if (!brief) return;
 const text = `Today's Executive News Brief:\n\n${brief.lead}\n\nRead more in Kora!`;
 try {
 if (navigator.share) {
 await navigator.share({
 title:"Today's News Brief",
 text,
 url: window.location.href,
});
} else {
 await navigator.clipboard.writeText(text);
 toast.success("News brief copied to clipboard!");
}
} catch {
 await navigator.clipboard.writeText(text);
 toast.success("News brief copied to clipboard!");
}
};

 if (!isOpen) return null;

 if (!brief) {
 return createPortal(
 <div className="fixed inset-0 z-[999] bg-neutral-950 flex flex-col items-center justify-center text-white p-6">
 <div className="max-w-md text-center space-y-4">
 <Newspaper className="w-12 h-12 text-kindle-accent mx-auto animate-pulse"/>
 <h2 className="text-xl font-lexend font-bold">Assembling Your Daily Brief...</h2>
 <p className="text-sm text-neutral-400">
 Please make sure you have feed subscriptions configured and active.
 </p>
 <button
 onClick={onClose}
 className="px-6 py-2.5 rounded-xl bg-white text-black text-xs font-bold uppercase tracking-wider hover:opacity-90 transition"
 >
 Go Back
 </button>
 </div>
 </div>,
 document.body
 );
}

 const storyCount = brief.sections.reduce((acc, sec) => acc + sec.items.length, 0);
 const featuredCover = items.find((i) => getItemThumbnail(i)) ? getItemThumbnail(items.find((i) => getItemThumbnail(i))!) : null;

 return createPortal(
 <div
 tabIndex={0}
 onKeyDown={handleKeyDown}
 onTouchStart={handleTouchStart}
 onTouchMove={handleTouchMove}
 onTouchEnd={handleTouchEnd}
 style={{
 transform: dragY > 0 ? `translateY(${dragY}px)` :"none",
 opacity: dragY > 0 ? Math.max(0.4, 1 - dragY / 300) : 1,
}}
 className="fixed inset-0 z-[999] bg-kindle-bg text-kindle-text flex flex-col overflow-hidden select-none outline-none transition-transform duration-75"
 >
 {/* Background artwork overlay */}
 {featuredCover ? (
 <>
 <img
 src={featuredCover}
 alt=""
 referrerPolicy="no-referrer"
 loading="lazy"
 className={`absolute inset-0 w-full h-full object-cover opacity-15 filter blur-xl scale-110 pointer-events-none ${
 grayscaleCovers ?"grayscale":""
}`}
 />
 <div className="absolute inset-0 bg-gradient-to-t from-kindle-bg via-kindle-bg/90 to-kindle-bg/80 z-0"/>
 </>
 ) : (
 <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(212,165,116,0.15),rgba(240,238,232,1))] (ellipse_80%_80%_at_50%_-20%,rgba(212,165,116,0.15),rgba(10,10,10,1))] z-0"/>
 )}

 {/* Floating Immersive Top Bar - TikTok Style */}
 <div className="relative z-40 flex items-center justify-between gap-3 pt-[max(env(safe-area-inset-top),0.75rem)] px-4 pb-3 border-b border-kindle-border bg-kindle-card/80 backdrop-blur-md">
 <button
 type="button"
 onClick={onClose}
 className="p-2 rounded-full bg-kindle-bg hover:opacity-80 text-kindle-text transition flex items-center gap-1.5 text-xs font-bold active:scale-95 border border-kindle-border"
 title="Return to Feed"
 >
 <ArrowLeft className="w-4 h-4"/>
 <span className="font-sans text-[11px] uppercase tracking-wider hidden sm:inline">Feed</span>
 </button>

 <div className="bg-kindle-accent/20 border border-kindle-accent/40 rounded-full px-3.5 py-1 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-900 shadow-sm">
 <Zap className="w-3.5 h-3.5 fill-current animate-pulse text-amber-600"/>
 <span>News Brief</span>
 </div>

 <button
 type="button"
 onClick={onClose}
 className="p-2 rounded-full border border-kindle-border bg-kindle-bg text-kindle-text hover:opacity-80 active:scale-95 transition"
 title="Close Brief"
 >
 <X className="w-4 h-4"/>
 </button>
 </div>

 {/* SINGLE SLIDE CONTENT VIEW */}
 <div
 ref={containerRef}
 className="relative z-20 flex-1 overflow-y-auto overscroll-contain p-4 md:p-8 space-y-6 max-w-3xl mx-auto w-full select-text scrollbar-thin scrollbar-thumb-kindle-border"
 >
 {/* Executive Lead Banner */}
 <div className="bg-kindle-card border border-kindle-border rounded-2xl p-5 md:p-7 space-y-4 shadow-xl relative overflow-hidden backdrop-blur-md">
 <div className="flex items-center justify-between gap-2 border-b border-kindle-border pb-3">
 <div className="flex items-center gap-2 text-amber-800">
 <Sparkles className="w-4 h-4 fill-current"/>
 <span className="text-[10px] font-bold uppercase tracking-widest">Single Executive Brief</span>
 </div>
 <div className="text-[10px] font-mono text-kindle-text-muted">
 {storyCount} Stories · {brief.sections.length} Sources
 </div>
 </div>

 <h1 className="text-2xl md:text-4xl font-lexend font-extrabold text-kindle-text tracking-tight leading-tight">
 Today&apos;s Executive News Brief
 </h1>

 <div className="relative pl-4 border-l-2 border-amber-700">
 <p className="font-serif text-base md:text-xl text-kindle-text-muted italic leading-relaxed">
 {brief.lead}
 </p>
 </div>

 <div className="flex items-center justify-between pt-2">
 <button
 onClick={handleShareBrief}
 className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-kindle-bg hover:opacity-80 border border-kindle-border text-kindle-text text-xs font-bold transition active:scale-95 cursor-pointer"
 >
 <Share2 className="w-3.5 h-3.5"/>
 <span>Share Brief</span>
 </button>

 <button
 onClick={onClose}
 className="inline-flex items-center gap-1 text-[11px] text-kindle-text-muted hover:text-kindle-text :text-white transition cursor-pointer"
 >
 <ChevronDown className="w-4 h-4 text-amber-700 animate-bounce"/>
 <span>Swipe down for TikTok Feed</span>
 </button>
 </div>
 </div>

 {/* Stories List Grouped by Source/Section */}
 <div className="space-y-6">
 <div className="flex items-center justify-between px-1">
 <h2 className="text-sm font-lexend font-bold uppercase tracking-wider text-kindle-text">
 Key Highlights & Stories
 </h2>
 <span className="text-[10px] text-kindle-text-muted font-mono">Tap any story card to expand full text</span>
 </div>

 {brief.sections.map((section, sIdx) => (
 <div key={sIdx} className="space-y-3">
 <div className="flex items-center gap-2">
 <span className="text-xs font-bold uppercase tracking-widest text-amber-800 bg-kindle-card px-2.5 py-0.5 rounded-full border border-kindle-border">
 {section.source}
 </span>
 <div className="h-px bg-kindle-border flex-1"/>
 </div>

 <div className="space-y-3">
 {section.items.map((story) => {
 const originalItem = items.find((i) => i.id === story.id);
 const isExpanded = expandedStoryId === story.id;

 return (
 <div
 key={story.id}
 onClick={() => setExpandedStoryId(isExpanded ? null : story.id)}
 className={`bg-kindle-card border rounded-xl p-4 space-y-3 transition shadow-lg cursor-pointer ${
 isExpanded ?"border-kindle-accent/60 ring-1 ring-kindle-accent/30 bg-kindle-card":"border-kindle-border hover:border-kindle-text/30"
}`}
 >
 <div className="flex items-start justify-between gap-3">
 <div className="space-y-1 flex-1">
 <h3 className="font-lexend font-bold text-base md:text-lg text-kindle-text hover:text-kindle-accent transition leading-snug">
 {story.headline}
 </h3>
 </div>

 {/* Action buttons */}
 <div className="flex items-center gap-1 shrink-0"onClick={(e) => e.stopPropagation()}>
 {originalItem && (
 <button
 onClick={() => {
 onSave(originalItem);
 toast.success(
 originalItem.saved ?"Removed from Save Later":"Saved to Read Later!"
 );
}}
 className={`p-2 rounded-lg border transition ${
 originalItem.saved
 ?"bg-kindle-accent border-kindle-accent text-white"
 :"bg-kindle-bg border-kindle-border text-kindle-text hover:bg-kindle-border/50"
}`}
 title={originalItem.saved ?"Unsave":"Save for later"}
 >
 <Bookmark className={`w-4 h-4 ${originalItem.saved ?"fill-current":""}`} />
 </button>
 )}

 {story.link && (
 <a
 href={story.link}
 target="_blank"
 rel="noopener noreferrer"
 className="p-2 rounded-lg bg-kindle-bg border border-kindle-border text-kindle-text hover:bg-kindle-border/50 transition"
 title="Open original link"
 >
 <ExternalLink className="w-4 h-4"/>
 </a>
 )}
 </div>
 </div>

 {/* AI Brief detail */}
 <p className="text-xs md:text-sm font-serif text-kindle-text-muted leading-relaxed bg-kindle-bg p-3 rounded-lg border border-kindle-border">
 <span className="font-sans font-bold uppercase tracking-wider text-[9px] text-kindle-accent block mb-0.5">
 AI Executive Summary:
 </span>
 {story.detail}
 </p>

 {/* Expand / Read original control */}
 <div className="flex items-center justify-between text-xs pt-1 border-t border-kindle-border">
 <div className="text-kindle-accent font-sans font-medium flex items-center gap-1 text-[11px]">
 <span>{isExpanded ?"Collapse Full Story":"Tap card to expand full story"}</span>
 <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ?"rotate-180":""}`} />
 </div>

 {originalItem && (
 <button
 type="button"
 onClick={(e) => {
 e.stopPropagation();
 onRead(originalItem);
 onClose();
}}
 className="text-kindle-text-muted hover:text-kindle-text hover:underline font-medium text-[11px] flex items-center gap-1"
 title="Open full reader view"
 >
 <span>Open Reader</span>
 {originalItem.read && <CheckCircle2 className="w-3 h-3 text-emerald-500"/>}
 </button>
 )}
 </div>

 {/* Inline Expanded Full Story Content */}
 {isExpanded && originalItem && (
 <div className="mt-2 pt-3 border-t border-kindle-border space-y-2 animate-fade-in text-xs font-serif text-kindle-text">
 {(() => {
 const resolved = resolvedStories[originalItem.id];
 if (!resolved || resolved.loading) {
 return (
 <div className="flex items-center gap-2 text-kindle-text-muted italic py-2">
 <span className="w-3.5 h-3.5 border-2 border-kindle-text-muted border-t-transparent rounded-full animate-spin"/>
 <span>Fetching article body...</span>
 </div>
 );
}
 if (resolved.error) {
 return (
 <div className="text-kindle-text-muted italic py-1">
 {originalItem.summary ||"Unable to fetch online content."}
 </div>
 );
}
 const cleanHtml = prepareFeedArticleHtml(resolved.html, resolved.title);
 return (
 <div
 className="prose prose-xs max-w-none space-y-2 leading-relaxed text-kindle-text"
 dangerouslySetInnerHTML={{__html: cleanHtml || originalItem.summary ||""}}
 />
 );
})()}
 </div>
 )}
 </div>
 );
})}
 </div>
 </div>
 ))}

 {/* Bottom gesture footer */}
 <div className="pt-6 pb-12 text-center space-y-3">
 <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/15 text-neutral-300 text-xs font-medium">
 <ChevronDown className="w-4 h-4 text-kindle-accent animate-bounce"/>
 <span>Swipe down or tap back to return to TikTok Feed</span>
 </div>
 <div>
 <button
 onClick={onClose}
 className="px-6 py-2.5 rounded-xl bg-white text-black font-bold text-xs uppercase tracking-wider hover:bg-neutral-200 transition"
 >
 Back to TikTok Scroll
 </button>
 </div>
 </div>
 </div>
 </div>
 </div>,
 document.body
 );
}
