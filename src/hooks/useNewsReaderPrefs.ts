import { useEffect, useState } from "react";
import {
  loadNewsReaderPrefs,
  NEWS_READER_PREFS_EVENT,
  patchNewsReaderPrefs,
  type NewsReaderPrefs,
} from "../lib/newsReaderPrefs";

/** Shared prefs for Feed article reader and Daily News Brief (persisted). */
export function useNewsReaderPrefs() {
  const [prefs, setPrefs] = useState<NewsReaderPrefs>(() => loadNewsReaderPrefs());

  useEffect(() => {
    const sync = () => setPrefs(loadNewsReaderPrefs());
    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<NewsReaderPrefs>).detail;
      if (detail) setPrefs(detail);
      else sync();
    };
    window.addEventListener(NEWS_READER_PREFS_EVENT, onCustom as EventListener);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(NEWS_READER_PREFS_EVENT, onCustom as EventListener);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const updatePrefs = (patch: Partial<NewsReaderPrefs>) => {
    setPrefs(patchNewsReaderPrefs(patch));
  };

  return { prefs, updatePrefs };
}
