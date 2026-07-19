export interface MediaSessionState {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  duration: number;
  position: number;
  playbackRate?: number;
  isPlaying: boolean;
}

export interface MediaSessionHandlers {
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (position: number) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onStop?: () => void;
}

let activeHandlers: MediaSessionHandlers | null = null;
let positionRef = 0;
let handlersBound = false;

function artworkSrc(url?: string): MediaImage[] {
  if (!url) return [];
  return [{ src: url, sizes: "512x512", type: "image/jpeg" }];
}

function bindHandlers(session: MediaSession): void {
  const bind = (action: MediaSessionAction, handler?: MediaSessionActionHandler) => {
    try {
      if (handler) session.setActionHandler(action, handler);
      else session.setActionHandler(action, null);
    } catch {
      // action not supported
    }
  };

  bind("play", () => activeHandlers?.onPlay?.());
  bind("pause", () => activeHandlers?.onPause?.());
  bind("stop", () => activeHandlers?.onStop?.());
  bind("seekbackward", () => activeHandlers?.onSeek?.(Math.max(0, positionRef - 15)));
  bind("seekforward", () => activeHandlers?.onSeek?.(positionRef + 30));
  bind("previoustrack", () => activeHandlers?.onPrevious?.());
  bind("nexttrack", () => activeHandlers?.onNext?.());
  bind("seekto", (details) => {
    if (details.seekTime != null) activeHandlers?.onSeek?.(details.seekTime);
  });
  handlersBound = true;
}

function applyMetadata(session: MediaSession, state: MediaSessionState): void {
  session.metadata = new MediaMetadata({
    title: state.title,
    artist: state.artist || "Kora Audiobook",
    album: state.album || "Audiobook",
    artwork: artworkSrc(state.artworkUrl),
  });
  session.playbackState = state.isPlaying ? "playing" : "paused";

  if (state.duration > 0) {
    try {
      session.setPositionState?.({
        duration: state.duration,
        playbackRate: state.playbackRate ?? 1,
        position: Math.min(Math.max(0, state.position), state.duration),
      });
    } catch {
      // Some browsers reject invalid position state
    }
  }
}

export function setupAudiobookMediaSession(
  state: MediaSessionState,
  handlers: MediaSessionHandlers
): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

  activeHandlers = handlers;
  positionRef = state.position;
  const session = navigator.mediaSession;

  if (!handlersBound) {
    bindHandlers(session);
  }

  applyMetadata(session, state);
}

export function updateAudiobookMediaSession(state: MediaSessionState): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  positionRef = state.position;
  applyMetadata(navigator.mediaSession, state);
}

export function clearAudiobookMediaSession(): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  activeHandlers = null;
  positionRef = 0;
  handlersBound = false;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  } catch {
    // ignore
  }
}
