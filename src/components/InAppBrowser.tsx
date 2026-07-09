import React, { useState, useEffect, useRef } from "react";
import { storeBookFile } from "../db/indexedDB";
import { syncBookToCloud, BookMetadata } from "../lib/firebase";
import { inferBookTags } from "../lib/tagsHelper";
import JSZip from "jszip";
import { 
  ArrowLeft, ArrowRight, RotateCw, Globe, Search, Home, 
  Sparkles, CheckCircle, AlertCircle, Loader, Download, 
  X, BookOpen, ExternalLink, ShieldAlert, Lock, HelpCircle,
  Sliders, Cookie, Shield, ShieldOff, Cpu, Trash2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface InAppBrowserProps {
  userId: string;
  onBookAdded: (book: BookMetadata) => void;
  grayscaleCovers: boolean;
  initialUrl?: string;
}

interface QuickLink {
  name: string;
  url: string;
  description: string;
  domain: string;
  badge?: string;
  color: string;
}

const QUICK_LINKS: QuickLink[] = [
  {
    name: "Anna's Archive",
    url: "https://annas-archive.gl/",
    description: "The largest shadow library of books, papers, and comics.",
    domain: "annas-archive.gl",
    badge: "Recommended",
    color: "from-emerald-500/10 to-teal-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
  },
  {
    name: "Z-Library",
    url: "https://z-lib.gd/",
    description: "Access your Z-Library account directly, log in, or register to download books.",
    domain: "z-lib.gd",
    badge: "Direct Access",
    color: "from-blue-500/10 to-indigo-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400"
  },
  {
    name: "Library Genesis",
    url: "https://libgen.be/",
    description: "Scientific articles and books focus with high direct downloads.",
    domain: "libgen.be",
    badge: "Classic Mirror",
    color: "from-amber-500/10 to-orange-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400"
  }
];

export default function InAppBrowser({ userId, onBookAdded, grayscaleCovers, initialUrl }: InAppBrowserProps) {
  const [currentUrl, setCurrentUrl] = useState<string>(initialUrl || "");
  const [address, setAddress] = useState<string>(initialUrl || "");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isHome, setIsHome] = useState<boolean>(!initialUrl);
  
  // InvisiProxy configuration states
  const [adBlockActive, setAdBlockActive] = useState<boolean>(true);
  const [torActive, setTorActive] = useState<boolean>(true);
  const [proxyMode, setProxyMode] = useState<"auto" | "standard" | "puppeteer">("auto");
  const [userAgent, setUserAgent] = useState<string>("chrome"); // 'chrome' | 'tor' | 'mobile' | 'firefox'
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [activeCookies, setActiveCookies] = useState<{ name: string; value: string }[]>([]);
  const [showCookiesList, setShowCookiesList] = useState<boolean>(false);

  // Capture & Download state
  const [captureState, setCaptureState] = useState<{
    status: "idle" | "downloading" | "processing" | "saving" | "completed" | "error";
    filename: string;
    progress: number;
    errorText: string | null;
  }>({
    status: "idle",
    filename: "",
    progress: 0,
    errorText: null
  });

  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    updateActiveCookies();
  }, [currentUrl]);

  function updateActiveCookies() {
    if (!currentUrl) {
      setActiveCookies([]);
      return;
    }
    try {
      const host = new URL(currentUrl).hostname;
      const hostEncoded = host.replace(/\./g, "_");
      const prefix = `prox_${hostEncoded}___`;
      
      const parsed: { name: string; value: string }[] = [];
      const rawCookies = document.cookie.split(";");
      for (let cookie of rawCookies) {
        cookie = cookie.trim();
        if (cookie.startsWith(prefix)) {
          const eqIdx = cookie.indexOf("=");
          if (eqIdx !== -1) {
            const key = cookie.substring(prefix.length, eqIdx);
            const val = cookie.substring(eqIdx + 1);
            parsed.push({ name: key, value: decodeURIComponent(val) });
          }
        }
      }
      setActiveCookies(parsed);
    } catch (e) {
      setActiveCookies([]);
    }
  }

  function handleClearCookies() {
    if (!currentUrl) return;
    try {
      const host = new URL(currentUrl).hostname;
      const hostEncoded = host.replace(/\./g, "_");
      const prefix = `prox_${hostEncoded}___`;
      
      const rawCookies = document.cookie.split(";");
      for (let cookie of rawCookies) {
        cookie = cookie.trim();
        if (cookie.startsWith(prefix)) {
          const eqIdx = cookie.indexOf("=");
          const name = eqIdx !== -1 ? cookie.substring(0, eqIdx) : cookie;
          document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        }
      }
      updateActiveCookies();
      handleRefresh(); // reload iframe with cleared state
    } catch (e) {
      console.error("Error clearing cookies:", e);
    }
  }

  useEffect(() => {
    if (initialUrl) {
      setCurrentUrl(initialUrl);
      setAddress(initialUrl);
      setIsHome(false);
    }
  }, [initialUrl]);

  // Parse filename into title and author
  function parseBookFilename(filename: string) {
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
    let title = nameWithoutExt;
    let author = "Unknown";

    if (nameWithoutExt.includes(" - ")) {
      const parts = nameWithoutExt.split(" - ");
      if (parts.length >= 2) {
        title = parts[0].trim();
        author = parts[1].trim();
      }
    } else if (nameWithoutExt.includes(" by ")) {
      const parts = nameWithoutExt.split(" by ");
      if (parts.length >= 2) {
        title = parts[0].trim();
        author = parts[1].trim();
      }
    }

    // Clean up brackety/parenthesis clutter
    title = title.replace(/[\(\[][^\)\]]+[\)\]]/g, "").trim();
    author = author.replace(/[\(\[][^\)\]]+[\)\]]/g, "").trim();

    return { title, author };
  }

  // Handle postMessage communication from the iframe proxy
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Accept message only from same origin for security
      if (event.origin !== window.location.origin) return;

      if (event.data && event.data.type === "KORA_IMPORT_BOOK") {
        const { url, filename, contentType } = event.data;
        console.log("Captured ebook event:", filename, url, contentType);
        await startEbookImport(url, filename, contentType);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [userId]);

  // Execute the downloading, extraction, and database saving of intercepted book
  async function startEbookImport(proxyUrl: string, filename: string, contentType: string) {
    setCaptureState({
      status: "downloading",
      filename,
      progress: 25,
      errorText: null
    });

    try {
      // 1. Fetch file through our proxy to bypass CORS
      const downloadProxyUrl = `/api/proxy-file?url=${encodeURIComponent(proxyUrl)}`;
      const response = await fetch(downloadProxyUrl);
      if (!response.ok) {
        let errMsg = `Server returned HTTP ${response.status} during book retrieval.`;
        try {
          const errData = await response.json();
          if (errData && errData.error) {
            errMsg = errData.error;
          }
        } catch (e) {
          // If body was not JSON, try text
          try {
            const errText = await response.text();
            if (errText && errText.length < 200) errMsg = errText;
          } catch (e2) {}
        }
        throw new Error(errMsg);
      }

      setCaptureState(prev => ({ ...prev, status: "processing", progress: 60 }));
      
      let fileBlob = await response.blob();
      let fileExtension = filename.split('.').pop()?.toLowerCase() || "epub";

      // 2. Extract EPUB if zip encapsulated
      if (contentType.includes("zip") || fileExtension === "zip") {
        try {
          const zip = await JSZip.loadAsync(fileBlob);
          const bookFile = Object.values(zip.files).find(
            f => !f.dir && (f.name.endsWith(".epub") || f.name.endsWith(".pdf"))
          );
          if (bookFile) {
            fileBlob = await bookFile.async("blob");
            fileExtension = bookFile.name.split('.').pop()?.toLowerCase() || "epub";
            // Update filename to unzipped book name
            filename = bookFile.name;
          }
        } catch (zipErr) {
          console.warn("Zip extraction skipped or failed:", zipErr);
        }
      }

      setCaptureState(prev => ({ ...prev, status: "saving", progress: 85 }));

      // 3. Save to IndexedDB (Offline Storage)
      const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
      await storeBookFile(id, fileBlob, filename, fileExtension);

      // 4. Extract title and author metadata
      const { title, author } = parseBookFilename(filename);

      // 5. Construct book record metadata
      const newBook: BookMetadata = {
        id,
        title,
        author,
        extension: fileExtension,
        size: `${(fileBlob.size / (1024 * 1024)).toFixed(1)} MB`,
        language: "English",
        coverUrl: null,
        source: "In-App Browser",
        tags: inferBookTags(title, author, fileExtension),
        status: "to-read",
        progress: { percent: 0, lastReadTime: Date.now() },
        dateAdded: Date.now()
      };

      // 6. Sync with Cloud Storage (Firebase Firestore)
      await syncBookToCloud(userId, newBook);

      // 7. Fire event callback to reload LibraryManager
      onBookAdded(newBook);

      setCaptureState({
        status: "completed",
        filename,
        progress: 100,
        errorText: null
      });

      // Auto clear after 4 seconds
      setTimeout(() => {
        setCaptureState(prev => {
          if (prev.status === "completed") {
            return { status: "idle", filename: "", progress: 0, errorText: null };
          }
          return prev;
        });
      }, 4000);

    } catch (err: any) {
      console.error("Browser capture import failed:", err);
      setCaptureState({
        status: "error",
        filename,
        progress: 0,
        errorText: err.message || "Failed to process the downloaded file."
      });
    }
  }

  // Handle URL navigation bar form submit
  function handleGo(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;

    let targetUrl = address.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      // If it looks like a domain, prepend https. Otherwise treat as search query
      if (/\.[a-z]{2,}/i.test(targetUrl) && !/\s/.test(targetUrl)) {
        targetUrl = "https://" + targetUrl;
      } else {
        // Fallback to Google Search
        targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`;
      }
    }

    setIsHome(false);
    setCurrentUrl(targetUrl);
    setAddress(targetUrl);
    setIsLoading(true);
  }

  function navigateTo(url: string) {
    setIsHome(false);
    setCurrentUrl(url);
    setAddress(url);
    setIsLoading(true);
  }

  function handleHome() {
    setIsHome(true);
    setCurrentUrl("");
    setAddress("");
  }

  function handleBack() {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.history.back();
    }
  }

  function handleForward() {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.history.forward();
    }
  }

  function handleRefresh() {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.location.reload();
    }
  }

  // On iframe load complete, synchronize current URL address
  function handleIframeLoad() {
    setIsLoading(false);
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        const frameUrl = iframeRef.current.contentWindow.location.href;
        const urlObj = new URL(frameUrl);
        const realProxiedUrl = urlObj.searchParams.get("url");
        if (realProxiedUrl) {
          setAddress(realProxiedUrl);
          setCurrentUrl(realProxiedUrl);
        }
      } catch (e) {
        // Handle cross-origin if it navigated away from our same-origin proxy (rare due to sandbox)
        console.warn("Unable to inspect iframe window context:", e);
      }
    }
  }

  return (
    <div id="in-app-browser-root" className="w-full flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-6rem)] border-0 md:border md:border-kindle-border md:rounded-2xl overflow-hidden bg-kindle-bg shadow-sm">
      {/* 1. Browser Toolbar Header */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-3 bg-kindle-bg border-b border-kindle-border">
        {/* Navigation Arrows */}
        <div className="flex items-center gap-1.5 shrink-0 justify-between md:justify-start">
          <div className="flex items-center gap-1">
            <button
              onClick={handleBack}
              disabled={isHome}
              className="p-2 rounded-lg hover:bg-kindle-card border border-transparent hover:border-kindle-border transition text-kindle-text disabled:opacity-30 disabled:hover:bg-transparent"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleForward}
              disabled={isHome}
              className="p-2 rounded-lg hover:bg-kindle-card border border-transparent hover:border-kindle-border transition text-kindle-text disabled:opacity-30 disabled:hover:bg-transparent"
              title="Forward"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={handleRefresh}
              disabled={isHome}
              className="p-2 rounded-lg hover:bg-kindle-card border border-transparent hover:border-kindle-border transition text-kindle-text disabled:opacity-30 disabled:hover:bg-transparent"
              title="Refresh"
            >
              <RotateCw className={`w-4 h-4 ${isLoading ? "animate-spin text-kindle-accent" : ""}`} />
            </button>
            <button
              onClick={handleHome}
              className={`p-2 rounded-lg hover:bg-kindle-card border transition ${isHome ? "bg-kindle-card border-kindle-border text-kindle-accent shadow-xs" : "border-transparent text-kindle-text hover:border-kindle-border"}`}
              title="Home Start Page"
            >
              <Home className="w-4 h-4" />
            </button>
          </div>

          {/* Secure Lock and Status Badge */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-sans font-bold text-[9px] uppercase tracking-wider">
            <Lock className="w-3 h-3 text-emerald-500 shrink-0" />
            <span>Kora Intercept Active</span>
          </div>
        </div>

        {/* URL Address input bar & Control Button */}
        <div className="flex-1 flex items-center gap-2">
          <form onSubmit={handleGo} className="flex-1 flex items-center bg-kindle-card rounded-xl border border-kindle-border overflow-hidden px-3 shadow-xs">
            <Globe className="w-4 h-4 text-kindle-text-muted mr-2 shrink-0" />
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Search or enter web address..."
              className="flex-1 min-w-0 py-2 text-xs font-sans text-kindle-text focus:outline-none placeholder-kindle-text-muted bg-transparent"
            />
            <button type="submit" className="text-[10px] font-bold font-sans uppercase tracking-widest text-kindle-accent hover:text-kindle-text transition shrink-0 ml-2">
              Go
            </button>
          </form>

          {/* Proxy panel toggle button */}
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-xl border transition-all duration-200 flex items-center gap-1.5 cursor-pointer text-xs font-bold uppercase tracking-wider py-2 px-3 shrink-0 ${
              showSettings 
                ? "bg-kindle-accent/10 border-kindle-accent/30 text-kindle-accent shadow-xs" 
                : "bg-kindle-card border-kindle-border text-kindle-text hover:border-kindle-accent hover:text-kindle-accent"
            }`}
            title="InvisiProxy Core Controls"
          >
            <Sliders className={`w-3.5 h-3.5 transition-transform duration-300 ${showSettings ? "rotate-180" : ""}`} />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </div>

      {/* InvisiProxy advanced settings panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-b border-kindle-border bg-kindle-bg/85 backdrop-blur-md overflow-hidden"
          >
            <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-sans">
              
              {/* Shield Settings */}
              <div className="p-3 rounded-xl bg-kindle-card border border-kindle-border flex flex-col gap-2 shadow-xs">
                <div className="flex items-center justify-between font-bold text-[10px] uppercase tracking-wider text-kindle-text-muted mb-1">
                  <span>Core Shields</span>
                  <Sliders className="w-3.5 h-3.5 text-kindle-accent" />
                </div>
                
                {/* AdBlocker */}
                <button
                  type="button"
                  onClick={() => setAdBlockActive(!adBlockActive)}
                  className="flex items-center justify-between p-2 rounded-lg bg-kindle-bg hover:bg-kindle-border/40 border border-kindle-border/50 transition cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2">
                    {adBlockActive ? (
                      <Shield className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <ShieldOff className="w-4 h-4 text-zinc-500" />
                    )}
                    <span className="font-semibold text-kindle-text">Ad-Blocker</span>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${adBlockActive ? "bg-emerald-500/15 text-emerald-500" : "bg-zinc-500/15 text-zinc-500"}`}>
                    {adBlockActive ? "ON" : "OFF"}
                  </span>
                </button>

                {/* Tor Onion Router */}
                <button
                  type="button"
                  onClick={() => setTorActive(!torActive)}
                  className="flex items-center justify-between p-2 rounded-lg bg-kindle-bg hover:bg-kindle-border/40 border border-kindle-border/50 transition cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2">
                    <Globe className={`w-4 h-4 ${torActive ? "text-blue-400 animate-pulse" : "text-zinc-500"}`} />
                    <span className="font-semibold text-kindle-text">Tor Onion</span>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${torActive ? "bg-blue-500/15 text-blue-400" : "bg-zinc-500/15 text-zinc-500"}`}>
                    {torActive ? "ON" : "OFF"}
                  </span>
                </button>
              </div>

              {/* Bypasser Engine */}
              <div className="p-3 rounded-xl bg-kindle-card border border-kindle-border flex flex-col gap-2 shadow-xs">
                <div className="flex items-center justify-between font-bold text-[10px] uppercase tracking-wider text-kindle-text-muted mb-1">
                  <span>Routing Engine</span>
                  <Cpu className="w-3.5 h-3.5 text-kindle-accent" />
                </div>
                
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-kindle-text-muted font-medium">Bypass Level:</span>
                  <div className="grid grid-cols-3 gap-1 bg-kindle-bg p-1 rounded-lg border border-kindle-border/50">
                    {(["auto", "standard", "puppeteer"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setProxyMode(mode)}
                        className={`text-[9px] font-bold py-1.5 rounded transition capitalize cursor-pointer ${proxyMode === mode ? "bg-kindle-accent text-kindle-bg shadow-xs" : "text-kindle-text-muted hover:text-kindle-text"}`}
                      >
                        {mode === "puppeteer" ? "Puppet" : mode}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-[10px] text-kindle-text-muted italic leading-normal scale-95 origin-left">
                  {proxyMode === "auto" && "Auto: Leverages fast fetch, falls back to Puppeteer on Cloudflare blocks."}
                  {proxyMode === "standard" && "Standard: Maximum speed. Standard proxy fetch, no Puppeteer."}
                  {proxyMode === "puppeteer" && "Puppet: Run everything through Puppeteer solver (slower, bypasses blocks)."}
                </div>
              </div>

              {/* Identity Spoofer */}
              <div className="p-3 rounded-xl bg-kindle-card border border-kindle-border flex flex-col gap-2 shadow-xs">
                <div className="font-bold text-[10px] uppercase tracking-wider text-kindle-text-muted mb-1 flex items-center justify-between">
                  <span>Identity Spoofer</span>
                  <Sparkles className="w-3.5 h-3.5 text-kindle-accent" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-kindle-text-muted font-medium">Simulated User Agent:</span>
                  <select
                    value={userAgent}
                    onChange={(e) => setUserAgent(e.target.value)}
                    className="w-full bg-kindle-bg p-2 rounded-lg border border-kindle-border/50 focus:outline-none text-xs text-kindle-text"
                  >
                    <option value="chrome">Chrome Desktop (Default)</option>
                    <option value="tor">Tor Browser (Bypass Filters)</option>
                    <option value="mobile">Mobile Safari (Optimize Layout)</option>
                    <option value="firefox">Firefox Desktop (Secure)</option>
                  </select>
                </div>
                
                <div className="text-[10px] text-kindle-text-muted leading-tight mt-1 scale-95 origin-left">
                  Simulate alternate platforms to dodge firewall bans and view adaptive mobile interfaces.
                </div>
              </div>

              {/* Cookie / Session Inspector */}
              <div className="p-3 rounded-xl bg-kindle-card border border-kindle-border flex flex-col gap-2 shadow-xs">
                <div className="font-bold text-[10px] uppercase tracking-wider text-kindle-text-muted mb-1 flex items-center justify-between">
                  <span>Session Manager</span>
                  <Cookie className="w-3.5 h-3.5 text-kindle-accent" />
                </div>

                <div className="flex items-center justify-between gap-2 p-1.5 bg-kindle-bg rounded-lg border border-kindle-border/50">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-kindle-text-muted font-medium">Active cookies:</span>
                    <span className="font-mono text-xs text-kindle-text font-bold">{activeCookies.length} captured</span>
                  </div>
                  {activeCookies.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowCookiesList(!showCookiesList)}
                      className="text-[9px] font-bold px-2 py-1 rounded bg-kindle-accent/10 border border-kindle-accent/30 text-kindle-accent hover:bg-kindle-accent/20 transition cursor-pointer"
                    >
                      {showCookiesList ? "Hide" : "Inspect"}
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  disabled={activeCookies.length === 0}
                  onClick={handleClearCookies}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-500 transition font-sans font-bold text-[10px] uppercase tracking-wider cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Session
                </button>
              </div>

            </div>

            {/* Cookies List dropdown */}
            {showCookiesList && activeCookies.length > 0 && (
              <div className="px-4 pb-4 border-t border-kindle-border/40 bg-kindle-bg/50">
                <div className="max-h-[120px] overflow-y-auto mt-2 p-2 rounded-lg bg-kindle-card border border-kindle-border/50 font-mono text-[10px] text-kindle-text flex flex-col gap-1 divide-y divide-kindle-border/20">
                  {activeCookies.map((cookie, idx) => (
                    <div key={idx} className="pt-1.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 overflow-hidden">
                      <span className="font-bold text-kindle-accent text-[11px] truncate shrink-0 max-w-[150px]">{cookie.name}</span>
                      <span className="text-kindle-text-muted font-medium truncate max-w-full sm:max-w-[400px] bg-kindle-bg/30 px-1 py-0.5 rounded text-right font-mono">{cookie.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Main Browser View Area */}
      <div className="flex-1 relative bg-kindle-bg flex flex-col min-h-0">
        <AnimatePresence mode="wait">
          {isHome ? (
            /* browser Start Page (Bookmarks & Help Guide) */
            <motion.div
              key="start-page"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="flex-1 overflow-y-auto p-6 md:p-12 flex flex-col items-center justify-center text-center max-w-4xl mx-auto w-full"
            >
              <div className="mb-4">
                <div className="w-14 h-14 bg-kindle-text text-kindle-bg rounded-2xl flex items-center justify-center mx-auto shadow-md">
                  <Globe className="w-7 h-7" />
                </div>
              </div>

              <h2 className="text-xl font-bold text-kindle-text tracking-tight font-sans">Kora Downloads Loader</h2>
              <p className="text-xs text-kindle-text-muted mt-1.5 max-w-md font-sans">
                Surf shadow archives, log in securely, and grab your files. 
                Any downloaded book is captured and synced directly into your library!
              </p>

              {/* Quick Links / Bookmarks */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full mt-8 text-left">
                {QUICK_LINKS.map((link) => (
                  <button
                    key={link.name}
                    onClick={() => navigateTo(link.url)}
                    className={`p-5 rounded-2xl border bg-kindle-card hover:bg-kindle-bg border-kindle-border shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all text-left flex flex-col h-full group cursor-pointer relative overflow-hidden`}
                  >
                    <div className="flex items-center justify-between w-full mb-3">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${link.color}`}>
                        {link.badge || "Resource"}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-kindle-text-muted group-hover:text-kindle-accent transition" />
                    </div>
                    <h3 className="text-sm font-bold text-kindle-text font-sans group-hover:text-kindle-accent transition">{link.name}</h3>
                    <p className="text-[11px] text-kindle-text-muted font-sans mt-1 flex-1 leading-relaxed">{link.description}</p>
                    <div className="text-[9px] text-kindle-text-muted font-mono mt-4 truncate w-full pt-2 border-t border-kindle-border">
                      {link.domain}
                    </div>
                  </button>
                ))}
              </div>

              {/* Security and Interception Note */}
              <div className="mt-10 p-4 rounded-xl border border-dashed border-kindle-border bg-kindle-card text-left flex gap-3 max-w-lg">
                <Sparkles className="w-5 h-5 text-kindle-accent shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-kindle-text font-sans">How Does Interception Work?</h4>
                  <p className="text-[11px] text-kindle-text-muted font-sans mt-1 leading-relaxed">
                    When you click on slow downloads, direct links, or gateways, the browser intercepts the book transfer, extracts the archives, matches metadata, and stores it in your offline memory and Cloud backups instantly.
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            /* Proxied Browser Iframe */
            <motion.div
              key="browser-frame"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 w-full h-full relative"
            >
              <iframe
                ref={iframeRef}
                src={`/api/browser-proxy?url=${encodeURIComponent(currentUrl)}&adblock=${adBlockActive}&tor=${torActive}&mode=${proxyMode}&ua=${userAgent}`}
                onLoad={handleIframeLoad}
                // Allow forms, scripts, and same-origin so cookies and logins function, but block top navigation breakout
                sandbox="allow-forms allow-scripts allow-same-origin"
                className="w-full h-full border-none bg-kindle-bg"
              />

              {/* Loader overlay */}
              {isLoading && (
                <div className="absolute inset-0 bg-kindle-bg/75 flex items-center justify-center z-10 transition-opacity">
                  <div className="flex flex-col items-center gap-3">
                    <Loader className="w-8 h-8 text-kindle-accent animate-spin" />
                    <span className="text-xs font-bold text-kindle-text font-sans uppercase tracking-widest animate-pulse">Loading proxied page...</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 3. Floating Intercept Progress HUD */}
      <AnimatePresence>
        {captureState.status !== "idle" && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            className="absolute bottom-6 left-6 right-6 md:left-auto md:right-6 md:w-96 bg-neutral-900 border border-neutral-800 text-white p-5 rounded-2xl shadow-2xl z-50 overflow-hidden font-sans"
          >
            {/* Ambient Background Wave */}
            <div className="absolute -right-12 -top-12 w-28 h-28 rounded-full bg-emerald-500/10 blur-2xl" />

            {/* Header Status */}
            <div className="flex items-start justify-between relative z-10">
              <div className="flex items-center gap-2.5">
                {captureState.status === "downloading" && <Loader className="w-5 h-5 text-sky-400 animate-spin" />}
                {captureState.status === "processing" && <Loader className="w-5 h-5 text-amber-400 animate-spin" />}
                {captureState.status === "saving" && <Loader className="w-5 h-5 text-indigo-400 animate-spin" />}
                {captureState.status === "completed" && <CheckCircle className="w-5 h-5 text-emerald-400" />}
                {captureState.status === "error" && <ShieldAlert className="w-5 h-5 text-rose-500" />}
                
                <span className="text-xs font-bold uppercase tracking-wider">
                  {captureState.status === "downloading" && "Downloading Ebook..."}
                  {captureState.status === "processing" && "Extracting Zip Content..."}
                  {captureState.status === "saving" && "Indexing Database..."}
                  {captureState.status === "completed" && "Import Successful!"}
                  {captureState.status === "error" && "Capture Encountered Error"}
                </span>
              </div>
              
              <button 
                onClick={() => setCaptureState({ status: "idle", filename: "", progress: 0, errorText: null })}
                className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Book Filename Details */}
            <div className="mt-3 bg-neutral-950/80 rounded-lg p-2.5 border border-neutral-800/50">
              <p className="text-[11px] font-mono text-zinc-400 break-all select-all">{captureState.filename}</p>
            </div>

            {/* Action Progress Bar / Error Message */}
            {captureState.status === "error" ? (
              <div className="mt-4 flex items-start gap-2 text-rose-400 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="leading-normal">{captureState.errorText || "An unknown capture error has occurred."}</p>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-[10px] text-neutral-400 font-mono font-medium">
                  <span>
                    {captureState.status === "downloading" && "Retrieving binary chunks from shadow host..."}
                    {captureState.status === "processing" && "Analyzing file package and stripping containers..."}
                    {captureState.status === "saving" && "Registering indexed keys and syncing cloud storage..."}
                    {captureState.status === "completed" && "Cleanly parsed, indexed and synchronized."}
                  </span>
                  <span>{captureState.progress}%</span>
                </div>
                <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                  <motion.div 
                    className={`h-full rounded-full ${
                      captureState.status === "completed" ? "bg-emerald-500" : "bg-kindle-accent"
                    }`}
                    initial={{ width: "0%" }}
                    animate={{ width: `${captureState.progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
