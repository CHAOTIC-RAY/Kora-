import React, { useState, useRef } from "react";
import { motion } from "motion/react";
import {
  BookOpen,
  Columns2,
  Cloud,
  Sun,
  Share2,
  Volume2,
  Rss,
  Highlighter,
  Globe,
  Palette,
  Search,
  Library,
} from "lucide-react";

interface FeatureItem {
  icon: typeof BookOpen;
  title: string;
  desc: string;
}

const FEATURES: FeatureItem[] = [
  {
    icon: Library,
    title: "Custom Library & Shelves",
    desc: "Instant search, format tags, custom shelves and Grid/List layouts for your whole collection.",
  },
  {
    icon: Columns2,
    title: "Multi-Format Reader",
    desc: "EPUB, TXT, PDF, MOBI and AZW3 with dual-column rendering, custom typography and themes.",
  },
  {
    icon: Cloud,
    title: "Cloud Sync & Backup",
    desc: "Reading progress, annotations and collections across devices via Firestore or WebDAV.",
  },
  {
    icon: Sun,
    title: "E-Ink & Contrast Engine",
    desc: "Tuned for e-paper Android and color tablets with dedicated high-contrast ink modes.",
  },
  {
    icon: Share2,
    title: "P2P Device Transfer",
    desc: "Send books straight between two devices over WebRTC — no cloud round-trip required.",
  },
  {
    icon: Volume2,
    title: "Audiobook Player",
    desc: "Built-in audiobooks with speed, sleep timer and seamless chapter playback.",
  },
  {
    icon: Rss,
    title: "Daily News & Feed",
    desc: "Topic-based RSS sources, a TikTok-style scroll view and a daily news brief.",
  },
  {
    icon: Highlighter,
    title: "Annotations & Highlights",
    desc: "Highlight, note and export quotes — synced and searchable across your library.",
  },
  {
    icon: Globe,
    title: "Wikipedia Research Hub",
    desc: "Read, listen to and convert any Wikipedia article into a Kora ebook.",
  },
  {
    icon: Palette,
    title: "Adaptive Theming",
    desc: "Light, dark, sepia and yellow themes with a performance mode for low-power devices.",
  },
  {
    icon: Search,
    title: "Universal Search",
    desc: "Find books in your library, mirror sources and the web from one search bar.",
  },
  {
    icon: BookOpen,
    title: "Offline-First Engine",
    desc: "Service-worker powered downloads that survive app exit and resume automatically.",
  },
];

// FeatureCard component with custom cursor-tracking glare spotlight + magnifier scale
function FeatureCard({ icon: Icon, title, desc }: FeatureItem) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [glarePos, setGlarePos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setGlarePos({ x, y });
  };

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileHover={{ scale: 1.03, y: -4 }}
      transition={{ type: "spring", stiffness: 150, damping: 18 }}
      className="relative bg-kindle-card border border-kindle-border rounded-2xl p-5 flex flex-col gap-3 group hover:border-kindle-accent/40 shadow-sm overflow-hidden select-none"
    >
      <div className="p-2.5 rounded-xl bg-kindle-accent/10 text-kindle-accent w-fit z-10 transition-transform group-hover:scale-110">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-bold text-kindle-text leading-snug z-10">{title}</h3>
      <p className="text-xs text-kindle-text-muted leading-relaxed z-10">{desc}</p>

      {/* Dynamic Hover Glow */}
      <div
        className="absolute inset-0 pointer-events-none rounded-[inherit] transition-opacity duration-300"
        style={{
          opacity: isHovered ? 1 : 0,
          background: `radial-gradient(circle 120px at ${glarePos.x}px ${glarePos.y}px, rgba(217, 119, 6, 0.08), transparent 80%)`,
        }}
      />
    </motion.div>
  );
}

export default function FeatureDemosGrid() {
  return (
    <div className="space-y-6 pt-4">
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-kindle-accent/10 border border-kindle-accent/20 text-kindle-accent text-[10px] font-bold uppercase tracking-widest chromatic-amber">
          <BookOpen className="w-3.5 h-3.5" /> Kora Feature Highlights
        </div>
        <h2 className="text-2xl sm:text-3xl font-serif font-bold text-kindle-text">
          Everything in one reader
        </h2>
        <p className="text-xs sm:text-sm text-kindle-text-muted leading-relaxed">
          A focused reading ecosystem — built for e-ink, phones and desktop alike.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FEATURES.map((feature) => (
          <FeatureCard key={feature.title} {...feature} />
        ))}
      </div>
    </div>
  );
}
