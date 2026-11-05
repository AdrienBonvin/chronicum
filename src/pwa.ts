import { registerSW } from "virtual:pwa-register";

/** The service worker's cache for the music (vite.config.ts) */
const MUSIC_CACHE = "music";

let isBusy: () => boolean = () => false;
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let updateReady = false;

/**
 * Installable app, playable offline. A new version is downloaded in the background and
 * applied only when no game is on the board: on a reset, or while the app is out of sight
 */
export function setupPwa(busy: () => boolean): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  isBusy = busy;
  updateSW = registerSW({
    onNeedRefresh() {
      updateReady = true;
      if (document.visibilityState === "hidden") applyUpdateIfIdle();
    },
    onRegisteredSW(_url, registration) {
      // A home-screen app can stay open for days: look for a new version each time it comes back
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void registration?.update();
        else applyUpdateIfIdle();
      });
    },
  });
}

/** Reloads into the new version, if one is waiting and the board is free */
export function applyUpdateIfIdle(): void {
  if (updateReady && updateSW && !isBusy()) void updateSW(true);
}

/**
 * <audio> streams by byte ranges, which the service worker can't store: the whole file is
 * fetched once here, so the track plays without network next time
 */
export function keepOffline(url: string): void {
  if (!import.meta.env.PROD || !("caches" in window)) return;
  void caches
    .open(MUSIC_CACHE)
    .then(async (cache) => {
      if (!(await cache.match(url))) await cache.add(url);
    })
    .catch(() => undefined);
}
