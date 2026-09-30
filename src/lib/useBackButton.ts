/**
 * Make the browser/hardware Back button close the reader.
 *
 * The reader is a full-screen overlay, but nothing in the URL or the
 * history changed when it opened, so Back did what Back does everywhere
 * else: it left the app. On a phone — where Back is the single most-used
 * control in the OS and there is no address bar to recover from — that
 * meant losing your place in a chapter, mid-read, with no way back.
 *
 * The fix is a single synthetic history entry pushed when the reader opens
 * and popped when it closes, so the first Back closes the reader and the
 * second leaves the app as the user expects.
 *
 * Three things this has to get right, all of which are bugs if missed:
 *
 *   - **Double-push.** A re-render or a second mount must not stack
 *     entries, or the first Back appears to do nothing and the user has to
 *     press it twice. `active` is the guard.
 *   - **Stale entry.** If the component unmounts without the close path
 *     running — a route change, a crash, the parent re-rendering the reader
 *     away — the entry has to go anyway, or the next Back on a screen the
 *     user has already left fires a `popstate` into a dead reader.
 *   - **Not eating the first Back.** The push is what makes Back reach us
 *     at all, so the handler must close rather than re-push.
 *
 * Hook, not a component, because the reader is already a component and this
 * is a lifecycle concern with no UI of its own.
 */
import { useEffect, useRef } from "react";

export function useBackButton(onBack: () => void, active = true) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  // The entry we pushed, so cleanup pops exactly the one it owns and
  // cannot pop an entry the user's own navigation created.
  const pushed = useRef(false);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    if (!("pushState" in window.history)) return;

    // Guard against the double-push: only the first effect run for this
    // mount pushes. Re-runs are a no-op because the entry is already ours.
    if (!pushed.current) {
      window.history.pushState({ __comicReader: true }, "");
      pushed.current = true;
    }

    const onPop = () => {
      // The entry has already been consumed by the pop, so clear the flag
      // before closing — otherwise the cleanup would pop a *second* entry
      // that we never pushed and eat the user's next Back.
      pushed.current = false;
      onBackRef.current();
    };

    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (pushed.current) {
        pushed.current = false;
        // `go(-1)` fires `popstate`, which would re-enter `onBack` on an
        // unmounting component. The listener is already detached by the time
        // this runs, so the close is not re-triggered.
        window.history.go(-1);
      }
    };
  }, [active]);
}

export default useBackButton;
