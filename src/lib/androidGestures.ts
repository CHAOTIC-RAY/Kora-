type BackLayer = {
  id: string;
  handler: () => void;
};

const backStack: BackLayer[] = [];
let initialized = false;
let suppressPop = false;

function isAndroidDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

export function isAndroidGestureNavDevice(): boolean {
  return isAndroidDevice();
}

export function initAndroidGestureNavigation(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  document.documentElement.classList.add("kora-gesture-nav");

  if (isAndroidDevice()) {
    document.documentElement.classList.add("kora-android");
  }

  window.addEventListener("popstate", () => {
    if (suppressPop) {
      suppressPop = false;
      return;
    }

    const top = backStack.pop();
    if (top) {
      top.handler();
    }
  });
}

export function pushAndroidBackLayer(id: string, handler: () => void): void {
  if (typeof window === "undefined") return;

  const existingIndex = backStack.findIndex((layer) => layer.id === id);
  if (existingIndex >= 0) {
    backStack.splice(existingIndex, 1);
  }

  window.history.pushState(
    { koraBack: id, depth: backStack.length + 1 },
    "",
    window.location.pathname + window.location.search + window.location.hash
  );
  backStack.push({ id, handler });
}

export function removeAndroidBackLayer(id: string, options?: { navigateBack?: boolean }): void {
  const index = backStack.findIndex((layer) => layer.id === id);
  if (index === -1) return;

  const isTop = index === backStack.length - 1;
  backStack.splice(index, 1);

  if (options?.navigateBack && isTop && window.history.state?.koraBack === id) {
    suppressPop = true;
    window.history.back();
  }
}

export function dismissAndroidBackLayer(id: string): void {
  removeAndroidBackLayer(id, { navigateBack: true });
}

export function getAndroidBackStackDepth(): number {
  return backStack.length;
}
