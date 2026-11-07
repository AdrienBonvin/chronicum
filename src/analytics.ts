/*
 * Audience measure with Umami (cloud.umami.is): no cookie, nothing personal stored on the device.
 * The events say how Chronicum is played, never by whom. Only the real site counts: never the local
 * tests nor Firebase's preview channels, unless a test turns it on by hand (localStorage
 * "chronicum.track" set to "on")
 */

import { runsInstalled } from "./install";

const WEBSITE_ID ="ddc780b6-3334-484f-a783-1db680e83b76";
const SCRIPT_URL = "https://cloud.umami.is/script.js";

type EventData = Record<string, string | number | boolean>;
type Umami = { track: (event: string, data?: EventData) => void };

declare global {
  interface Window {
    umami?: Umami;
  }
}

/** Events sent before the script is in: kept for it, a few only (offline, it never comes) */
const queue: [string, EventData | undefined][] = [];
const QUEUE_MAX = 30;

function forced(): boolean {
  try {
    return localStorage.getItem("chronicum.track") === "on";
  } catch {
    return false;
  }
}

/** Firebase preview channels live at site--channel-hash.web.app */
const counted = (): boolean =>
  forced() || (import.meta.env.PROD && location.hostname !== "localhost" && !location.hostname.includes("--"));

export function startAnalytics(): void {
  if (!counted()) return;
  const script = document.createElement("script");
  script.defer = true;
  script.src = SCRIPT_URL;
  script.dataset.websiteId = WEBSITE_ID;
  script.addEventListener("load", () => {
    for (const [event, data] of queue.splice(0)) window.umami?.track(event, data);
  });
  document.head.append(script);
  // Where a visit comes from (the poster, the report's QR code, a forum post: ?ref=…), and each
  // opening from the home screen: Safari says nothing when the app is installed, this counts them
  const ref = new URLSearchParams(location.search).get("ref");
  if (ref || runsInstalled()) track("Arrivée", { app: appKind(), ...(ref ? { source: ref.slice(0, 40) } : {}) });
  window.addEventListener("appinstalled", () => track("App installée"));
}

/** Played in the installed app or in a browser tab */
export const appKind = (): string => (runsInstalled() ? "installée" : "navigateur");

export function track(event: string, data?: EventData): void {
  if (!counted()) return;
  if (window.umami) window.umami.track(event, data);
  else if (queue.length < QUEUE_MAX) queue.push([event, data]);
}
