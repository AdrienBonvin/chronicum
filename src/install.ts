/*
 * Chronicum on the home screen. Never asked when the app opens: players come to play. The end of a
 * battle offers it, and the settings keep a line for it. Chrome and the Android browsers have an
 * install window of their own; Safari has none, so its steps are shown instead
 */

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** How this device installs: the browser's own window, Safari's Share menu, or the browser's menu */
export type InstallWay = "prompt" | "apple" | "menu";

const STORAGE_KEY = "warhammerClock.install";
/** After two "Later", the end screen never offers it again */
const LATER_MAX = 2;
/** After one "Later", it waits this many battles */
const LATER_GAP = 3;

type Memory = { later: number; laterAt: number; installed: boolean };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = (): void => listeners.forEach((listener) => listener());

function memory(): Memory {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Memory> | null;
    return { later: Number(saved?.later) || 0, laterAt: Number(saved?.laterAt) || 0, installed: saved?.installed === true };
  } catch {
    return { later: 0, laterAt: 0, installed: false };
  }
}

function remember(next: Memory): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private browsing: asked again next time */
  }
}

// Chrome on Android would show its own banner whenever it likes, mid-game too: kept for the end screen
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferred = event as InstallPrompt;
  changed();
});

window.addEventListener("appinstalled", () => {
  deferred = null;
  remember({ ...memory(), installed: true });
  changed();
});

/** Opened from the home screen rather than in a browser tab */
export const runsInstalled = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPads say they are Macs, but a Mac has no touch screen */
const appleDevice = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** How this device can install the app, or null once it is installed */
export function installWay(): InstallWay | null {
  if (runsInstalled() || memory().installed) return null;
  if (deferred) return "prompt";
  return appleDevice() ? "apple" : "menu";
}

/** The browser's install window, once: null when there is none to open */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const prompt = deferred;
  if (!prompt) return null;
  deferred = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  changed();
  return outcome;
}

/** Whether the end of this battle offers it: always at first, then every few battles after a "Later" */
export function offerAfter(battle: number): boolean {
  const { later, laterAt } = memory();
  if (later >= LATER_MAX) return false;
  return later === 0 || battle >= laterAt + LATER_GAP;
}

export function installLater(battle: number): void {
  const saved = memory();
  remember({ ...saved, later: saved.later + 1, laterAt: battle });
}

export const onInstallChange = (listener: () => void): void => {
  listeners.add(listener);
};
