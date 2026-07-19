/**
 * Merge reading progress preferring the newer lastReadTime, with explicit
 * conflict metadata when both sides advanced independently.
 */

export interface ReadingProgress {
  percent?: number;
  chapterIndex?: number;
  pageNumber?: number;
  scrollPosition?: number;
  lastReadTime?: number;
  cfi?: string;
}

export interface ProgressConflict {
  local: ReadingProgress;
  remote: ReadingProgress;
  chosen: "local" | "remote";
  reason: string;
}

export function mergeReadingProgress(
  local?: ReadingProgress | null,
  remote?: ReadingProgress | null
): { progress: ReadingProgress; conflict?: ProgressConflict } {
  const a = local || {};
  const b = remote || {};
  const aTime = a.lastReadTime || 0;
  const bTime = b.lastReadTime || 0;

  if (!local && remote) return { progress: { ...b } };
  if (local && !remote) return { progress: { ...a } };

  // Same device / identical timestamps — take max percent / later chapter
  if (Math.abs(aTime - bTime) < 2000) {
    const useRemoteChapter = (b.chapterIndex ?? 0) > (a.chapterIndex ?? 0);
    const useRemotePercent = (b.percent ?? 0) > (a.percent ?? 0);
    return {
      progress: {
        ...a,
        ...b,
        chapterIndex: useRemoteChapter ? b.chapterIndex : a.chapterIndex,
        pageNumber: (b.pageNumber ?? 0) >= (a.pageNumber ?? 0) ? b.pageNumber : a.pageNumber,
        percent: Math.max(a.percent ?? 0, b.percent ?? 0),
        lastReadTime: Math.max(aTime, bTime),
      },
    };
  }

  const preferRemote = bTime > aTime;
  const chosen = preferRemote ? b : a;
  const other = preferRemote ? a : b;

  // Flag conflict when both have meaningful progress that diverges
  const diverged =
    Math.abs((a.percent ?? 0) - (b.percent ?? 0)) > 3 ||
    (a.chapterIndex ?? 0) !== (b.chapterIndex ?? 0);

  const progress = {
    ...other,
    ...chosen,
    lastReadTime: Math.max(aTime, bTime),
  };

  if (diverged && aTime > 0 && bTime > 0) {
    return {
      progress,
      conflict: {
        local: a,
        remote: b,
        chosen: preferRemote ? "remote" : "local",
        reason: preferRemote
          ? "Remote device read more recently"
          : "This device read more recently",
      },
    };
  }

  return { progress };
}
