import React from "react";
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

export default function FeatureDemosGrid() {
  return (
    <div className="space-y-6 pt-4">
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-kindle-accent/10 border border-kindle-accent/20 text-kindle-accent text-[10px] font-bold uppercase tracking-widest">
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
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="bg-kindle-card border border-kindle-border rounded-2xl p-5 flex flex-col gap-3 group hover:border-kindle-accent/40 transition-colors duration-300"
          >
            <div className="p-2.5 rounded-xl bg-kindle-accent/10 text-kindle-accent w-fit">
              <Icon className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-kindle-text leading-snug">{title}</h3>
            <p className="text-xs text-kindle-text-muted leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
